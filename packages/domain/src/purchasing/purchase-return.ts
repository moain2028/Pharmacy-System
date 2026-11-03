/**
 * Purchase return to supplier with debit note (FR-PUR-111, FR-PUR-116; rules B5, C5).
 * Lines pick a specific lot; qty <= on hand at the location; cost is the lot's specific cost
 * (Lot.costForSsu). Posting is pure: PURCHASE_RETURN movements (negative SSU), a balanced entry
 * (AP Dr at the expected credit / Inventory Cr at cost / return-loss Dr when the supplier credits
 * less than cost) and `lotFullyReturned` flags so the application sets RETURNED_TO_SUPPLIER.
 * The expected credit note is expressed in the supplier currency at the frozen rate (FR-PUR-110).
 */
import { minorFactor, type CurrencyCode } from "../money/currency.js";
import { Money, divHalfUp } from "../money/money.js";
import { domainErr, ok, type Result } from "../shared/result.js";
import type { IsoDate } from "../inventory/iso-date.js";
import type { Lot, LotManualStatus } from "../inventory/lot.js";
import { StockMovement } from "../inventory/stock-movement.js";
import type { ForeignSnapshot, JournalEntry, JournalLineInput } from "../accounting/journal-entry.js";
import { RATE_SCALE, inventoryLotLines, postEntry, toBase } from "../accounting/posting-common.js";

export const PURCHASE_RETURN_STATUSES = ["DRAFT", "POSTED", "REVERSED"] as const;
export type PurchaseReturnStatus = (typeof PURCHASE_RETURN_STATUSES)[number];
export const PURCHASE_RETURN_REASONS = ["EXPIRED", "DAMAGED", "WRONG_ITEM", "RECALL", "PRICE_DISPUTE", "OTHER"] as const;
export type PurchaseReturnReason = (typeof PURCHASE_RETURN_REASONS)[number];
export const PURCHASE_RETURN_DOC_TYPE = "PURCHASE_RETURN" as const;
/** Manual lot status the application applies to lots flagged `lotFullyReturned`. */
export const RETURNED_LOT_STATUS: LotManualStatus = "RETURNED_TO_SUPPLIER";

export function isPurchaseReturnReason(x: unknown): x is PurchaseReturnReason {
  return typeof x === "string" && (PURCHASE_RETURN_REASONS as readonly string[]).includes(x);
}

// ------------------------------------------------------------------ types

export interface PurchaseReturnLineInput {
  readonly lineId: string;
  readonly itemId: string;
  readonly lot: Lot;
  /** on_hand − reserved of this lot at the return location. */
  readonly onHandSsu: bigint;
  readonly qtySsu: bigint;
  readonly reason: PurchaseReturnReason;
  /** Credit agreed with the supplier per SSU (supplier currency). Default: lot cost at the frozen rate. */
  readonly agreedCreditPerSsu?: Money | undefined;
  readonly note?: string | undefined;
}
export interface PurchaseReturnLine {
  readonly lineId: string; readonly itemId: string; readonly lotId: string; readonly qtySsu: bigint;
  readonly reason: PurchaseReturnReason;
  /** Specific lot cost of the returned quantity, base currency (C5). */
  readonly cost: Money;
  readonly creditForeign: Money; readonly creditBase: Money;
  /** cost − creditBase (>= 0). */
  readonly loss: Money;
  readonly lotFullyReturned: boolean; readonly note: string | null;
}
export interface PurchaseReturnHeader {
  readonly returnId: string; readonly returnNo: string; readonly debitNoteNo: string; readonly tenantId: string;
  readonly supplierId: string; readonly locationId: string; readonly returnDate: IsoDate;
  /** ISO timestamp of the physical return. */
  readonly occurredAt: string;
  readonly currency: CurrencyCode; readonly baseCurrency: CurrencyCode;
  /** supplier→base rate (RATE_SCALE); required when currency ≠ base, ignored otherwise. */
  readonly rateScaledSnapshot?: bigint | undefined;
  readonly linkedGrnId?: string | undefined; readonly linkedSupplierInvoiceId?: string | undefined;
}
export interface PurchaseReturnProps extends PurchaseReturnHeader { readonly lines: readonly PurchaseReturnLineInput[] }
export interface PurchaseReturnTotals { readonly cost: Money; readonly creditBase: Money; readonly creditForeign: Money; readonly loss: Money }
export interface PurchaseReturnAccounts { readonly ap: string; readonly returnLoss: string }
export interface PostPurchaseReturnOptions {
  readonly entryId: string;
  /** Pure id generator (UUID v7 port, E2) for movements. */
  readonly newId: () => string;
  readonly accounts: PurchaseReturnAccounts;
  readonly postedAt: Date;
}
export interface PostedPurchaseReturn {
  readonly purchaseReturn: PurchaseReturn;
  readonly movements: readonly StockMovement[];
  readonly entry: JournalEntry;
  readonly fullyReturnedLotIds: readonly string[];
  readonly totals: PurchaseReturnTotals;
}

/** base → supplier currency at `rateScaled` (1 supplier unit = rateScaled/RATE_SCALE base), Half-Up. */
function fromBase(base: Money, rateScaled: bigint, currency: CurrencyCode): Money {
  const minor = divHalfUp(base.amountMinor * RATE_SCALE * minorFactor(currency), rateScaled * minorFactor(base.currency));
  return Money.minor(minor, currency);
}

function buildLine(l: PurchaseReturnLineInput, h: PurchaseReturnHeader): Result<PurchaseReturnLine> {
  const ctx = { lineId: l.lineId };
  if (!isPurchaseReturnReason(l.reason)) return domainErr("purchase_return.invalid_reason", "Unknown return reason", { ...ctx, reason: String(l.reason) });
  if (l.lot.itemId !== l.itemId) return domainErr("purchase_return.lot_item_mismatch", "Lot belongs to another item", ctx);
  if (l.onHandSsu < 0n) return domainErr("purchase_return.negative_on_hand", "On-hand quantity must be >= 0", ctx);
  if (l.qtySsu <= 0n) return domainErr("purchase_return.qty_not_positive", "Return quantity must be > 0", ctx);
  if (l.qtySsu > l.onHandSsu) {
    return domainErr("purchase_return.qty_exceeds_available", "Cannot return more than the available quantity of the lot", {
      ...ctx, lotId: l.lot.lotId, available: l.onHandSsu.toString(), requested: l.qtySsu.toString(),
    });
  }
  const cost = l.lot.costForSsu(l.qtySsu);
  if (!cost.ok) return cost;
  if (cost.value.currency !== h.baseCurrency) return domainErr("purchase_return.cost_currency", "Lot cost must be in base currency", ctx);
  const rate = h.rateScaledSnapshot;
  let creditForeign: Money;
  let creditBase: Money;
  if (l.agreedCreditPerSsu === undefined) {
    creditBase = cost.value;
    creditForeign = rate === undefined ? cost.value : fromBase(cost.value, rate, h.currency);
  } else {
    if (l.agreedCreditPerSsu.currency !== h.currency) return domainErr("purchase_return.credit_currency", "Agreed credit must be in the supplier currency", ctx);
    if (l.agreedCreditPerSsu.isNegative()) return domainErr("purchase_return.negative_credit", "Agreed credit must be >= 0", ctx);
    creditForeign = l.agreedCreditPerSsu.multiply(l.qtySsu);
    const conv = toBase(creditForeign, rate, h.baseCurrency);
    if (!conv.ok) return conv;
    creditBase = conv.value.base;
    if (creditBase.gt(cost.value)) {
      return domainErr("purchase_return.credit_exceeds_cost", "Supplier credit cannot exceed the lot cost; record the excess as a separate credit note", {
        ...ctx, cost: cost.value.toDecimalString(), credit: creditBase.toDecimalString(),
      });
    }
  }
  return ok(Object.freeze({
    lineId: l.lineId, itemId: l.itemId, lotId: l.lot.lotId, qtySsu: l.qtySsu, reason: l.reason, cost: cost.value,
    creditForeign, creditBase, loss: cost.value.subtract(creditBase), lotFullyReturned: l.qtySsu === l.onHandSsu, note: l.note ?? null,
  }));
}

interface ReturnState {
  readonly header: PurchaseReturnHeader;
  readonly lines: readonly PurchaseReturnLine[];
  readonly totals: PurchaseReturnTotals;
  readonly status: PurchaseReturnStatus;
  readonly entryId: string | null;
}

// ------------------------------------------------------------------ aggregate

export class PurchaseReturn {
  private readonly s: ReturnState;
  private constructor(s: ReturnState) {
    this.s = Object.freeze({ ...s, lines: Object.freeze([...s.lines]) });
    Object.freeze(this);
  }

  static create(p: PurchaseReturnProps): Result<PurchaseReturn> {
    if (p.lines.length === 0) return domainErr("purchase_return.no_lines", "A purchase return needs at least one line");
    const foreign = p.currency !== p.baseCurrency;
    if (foreign && (p.rateScaledSnapshot === undefined || p.rateScaledSnapshot <= 0n)) {
      return domainErr("purchase_return.rate_required", "A positive rate to base currency is required for foreign-currency returns");
    }
    const { lines: inputs, ...rest } = p;
    const header: PurchaseReturnHeader = Object.freeze({ ...rest, rateScaledSnapshot: foreign ? p.rateScaledSnapshot : undefined });
    const lines: PurchaseReturnLine[] = [];
    const lineIds = new Set<string>();
    const lotIds = new Set<string>();
    for (const l of inputs) {
      if (lineIds.has(l.lineId)) return domainErr("purchase_return.duplicate_line", "Duplicate line id", { lineId: l.lineId });
      lineIds.add(l.lineId);
      if (lotIds.has(l.lot.lotId)) return domainErr("purchase_return.duplicate_lot", "A lot may appear on one line only", { lotId: l.lot.lotId });
      lotIds.add(l.lot.lotId);
      const r = buildLine(l, header);
      if (!r.ok) return r;
      lines.push(r.value);
    }
    const totals: PurchaseReturnTotals = Object.freeze({
      cost: Money.sum(lines.map((l) => l.cost), p.baseCurrency),
      creditBase: Money.sum(lines.map((l) => l.creditBase), p.baseCurrency),
      creditForeign: Money.sum(lines.map((l) => l.creditForeign), p.currency),
      loss: Money.sum(lines.map((l) => l.loss), p.baseCurrency),
    });
    return ok(new PurchaseReturn({ header, lines, totals, status: "DRAFT", entryId: null }));
  }

  get returnId(): string { return this.s.header.returnId; }
  get header(): PurchaseReturnHeader { return this.s.header; }
  get status(): PurchaseReturnStatus { return this.s.status; }
  get lines(): readonly PurchaseReturnLine[] { return this.s.lines; }
  get totals(): PurchaseReturnTotals { return this.s.totals; }
  get entryId(): string | null { return this.s.entryId; }

  post(opts: PostPurchaseReturnOptions): Result<PostedPurchaseReturn> {
    const h = this.s.header;
    const t = this.s.totals;
    if (this.s.status !== "DRAFT") return domainErr("purchase_return.not_draft", "Only a draft return can be posted", { status: this.s.status });
    if (!t.cost.isPositive()) return domainErr("purchase_return.zero_value", "Return has no inventory value to post");
    const movements: StockMovement[] = [];
    for (const l of this.s.lines) {
      const mv = StockMovement.create({
        movementId: opts.newId(), itemId: l.itemId, lotId: l.lotId, locationId: h.locationId, type: "PURCHASE_RETURN",
        qtyDeltaSsu: -l.qtySsu, unitCostSnapshot: l.cost.divide(l.qtySsu), costMinor: l.cost,
        documentRef: { docType: PURCHASE_RETURN_DOC_TYPE, docId: h.returnId, lineId: l.lineId },
        occurredAt: h.occurredAt, businessDate: h.returnDate, note: l.reason,
      });
      if (!mv.ok) return mv;
      movements.push(mv.value);
    }
    const memo = `Purchase return ${h.returnNo} / debit note ${h.debitNoteNo}`;
    const valued = this.s.lines.filter((l) => !l.cost.isZero()).map((l) => ({ itemId: l.itemId, lotId: l.lotId, cost: l.cost }));
    const inv = inventoryLotLines(valued, "CREDIT", h.baseCurrency, memo);
    if (!inv.ok) return inv;
    const dimensions = { supplierId: h.supplierId };
    const foreign: ForeignSnapshot | null = h.rateScaledSnapshot === undefined ? null : { amount: t.creditForeign, rateScaledSnapshot: h.rateScaledSnapshot };
    const debits: JournalLineInput[] = [];
    if (t.creditBase.isPositive()) debits.push({ accountCode: opts.accounts.ap, debit: t.creditBase, memo: `AP ${memo}`, dimensions, foreign });
    if (t.loss.isPositive()) debits.push({ accountCode: opts.accounts.returnLoss, debit: t.loss, memo: `Return loss ${memo}`, dimensions });
    const entry = postEntry(
      { entryId: opts.entryId, tenantId: h.tenantId, postedAt: opts.postedAt, baseCurrency: h.baseCurrency },
      { type: PURCHASE_RETURN_DOC_TYPE, id: h.returnId },
      [...debits, ...inv.value.lines],
      memo,
    );
    if (!entry.ok) return entry;
    return ok(Object.freeze({
      purchaseReturn: new PurchaseReturn({ ...this.s, status: "POSTED", entryId: opts.entryId }),
      movements: Object.freeze(movements), entry: entry.value,
      fullyReturnedLotIds: Object.freeze(this.s.lines.filter((l) => l.lotFullyReturned).map((l) => l.lotId)),
      totals: t,
    }));
  }
}
