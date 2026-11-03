/**
 * Goods receipt note — GRN (FR-PUR-105, 106, 107, 108, 113; C1/C3/C5).
 * Every GRN line becomes a new Lot (bonus under ZERO_COST becomes its own zero-cost lot).
 * Costing pipeline per line: gross → line discount → share of invoice discount → base currency at
 * the frozen rate (FR-PUR-110) → share of landed costs. Posting is pure: it returns the lots,
 * RECEIPT stock movements, the balanced journal entry (Inventory Dr / GRNI or AP Cr) and the
 * updated PO; the application layer persists them in one transaction.
 */
import type { CurrencyCode } from "../money/currency.js";
import { Money } from "../money/money.js";
import { snapshotUnit, type ItemUnit, type UnitSnapshot } from "../quantity/quantity.js";
import { domainErr, ok, type Result } from "../shared/result.js";
import { compareIsoDate, daysBetween, endOfMonth, isIsoDate, parseIsoDate, type IsoDate } from "../inventory/iso-date.js";
import { LOT_NUMBER_MAX_LENGTH, Lot, normalizeLotNumber, type LotProps, type LotSourceType } from "../inventory/lot.js";
import { StockMovement } from "../inventory/stock-movement.js";
import type { ForeignSnapshot, JournalEntry, JournalLineInput } from "../accounting/journal-entry.js";
import { inventoryLotLines, postEntry, toBase } from "../accounting/posting-common.js";
import { distributeInvoiceDiscount, type DiscountValue } from "../pricing/discount.js";
import { computeLineAmounts, invoiceDiscountOf, type PurchaseOrder, type ReceiptQty } from "./purchase-order.js";

export const GRN_STATUSES = ["DRAFT", "POSTED", "REVERSED"] as const;
export type GrnStatus = (typeof GRN_STATUSES)[number];
export const BONUS_COST_POLICIES = ["ZERO_COST", "SPREAD_COST_OVER_PAID_AND_BONUS"] as const;
export type BonusCostPolicy = (typeof BONUS_COST_POLICIES)[number];
export const DEFAULT_BONUS_COST_POLICY: BonusCostPolicy = "SPREAD_COST_OVER_PAID_AND_BONUS";
export const LANDED_COST_METHODS = ["BY_VALUE", "BY_QTY"] as const;
export type LandedCostMethod = (typeof LANDED_COST_METHODS)[number];
export const LANDED_EXPENSE_TYPES = ["FREIGHT", "CUSTOMS", "CLEARANCE", "LOADING", "OTHER"] as const;
export type LandedExpenseType = (typeof LANDED_EXPENSE_TYPES)[number];
export const GRN_DOC_TYPE = "GOODS_RECEIPT" as const;
/** Sentinel expiry for items that do not track expiry (see inventory/lot.ts). */
import { NO_EXPIRY_DATE } from "../inventory/expiry-alerts.js";
export { NO_EXPIRY_DATE };

/** GS1 AI(17) expiry YYMMDD; DD = 00 means last day of the month. Century fixed to 20xx. */
export function parseGs1Expiry(raw: string): Result<IsoDate> {
  const m = /^(\d{2})(\d{2})(\d{2})$/.exec(raw.trim());
  if (!m) return domainErr("grn.gs1_invalid", "GS1 expiry must be 6 digits YYMMDD", { raw });
  const year = 2000 + Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return domainErr("grn.gs1_invalid", "GS1 expiry month out of range", { raw });
  if (Number(m[3]) === 0) return endOfMonth(year, month);
  return parseIsoDate(`${year}-${m[2]}-${m[3]}`);
}

// ------------------------------------------------------------------ types

export interface GoodsReceiptLineInput {
  readonly lineId: string;
  readonly itemId: string;
  readonly poLineId?: string | undefined;
  readonly trackExpiry: boolean;
  readonly lotNumber: string;
  readonly expiryDate?: IsoDate | undefined;
  readonly unit: ItemUnit;
  readonly qtyInUnit: bigint;
  readonly bonusSsu?: bigint | undefined;
  /** Cost per purchase unit in the GRN (supplier) currency. */
  readonly unitCost: Money;
  readonly discount?: DiscountValue | undefined;
  readonly sourceType: LotSourceType;
  readonly printedPublicPrice?: Money | undefined;
  /** Current official public price (FR-PRC-103) — mismatch produces a warning. */
  readonly officialPublicPrice?: Money | undefined;
  readonly supplierBatchRef?: string | undefined;
}
export interface GoodsReceiptLine {
  readonly lineId: string; readonly itemId: string; readonly poLineId: string | null;
  readonly lotNumber: string; readonly expiryDate: IsoDate; readonly unit: UnitSnapshot;
  readonly qtySsu: bigint; readonly bonusSsu: bigint; readonly unitCost: Money;
  readonly gross: Money; readonly discount: Money; readonly net: Money;
  readonly sourceType: LotSourceType; readonly printedPublicPrice: Money | null; readonly supplierBatchRef: string | null;
}
export interface LandedCostInput {
  readonly expenseType: LandedExpenseType;
  /** Base currency. */
  readonly amount: Money;
  readonly method: LandedCostMethod;
  /** Credit side (accrued freight/customs payable) — cost of goods is debited to Inventory. */
  readonly creditAccountCode: string;
}
export interface GoodsReceiptHeader {
  readonly grnId: string; readonly grnNo: string; readonly tenantId: string; readonly supplierId: string;
  readonly locationId: string; readonly poId?: string | undefined;
  /** ISO timestamp of receipt. */
  readonly receivedAt: string; readonly businessDate: IsoDate;
  readonly currency: CurrencyCode; readonly baseCurrency: CurrencyCode;
  readonly rateScaledSnapshot?: bigint | undefined;
  readonly invoiceDiscount?: DiscountValue | undefined;
  readonly landedCosts?: readonly LandedCostInput[] | undefined;
  readonly bonusCostPolicy?: BonusCostPolicy | undefined;
  /** Warn when the lot expires within fewer days than this ("small things" #22). */
  readonly minShelfLifeDays?: number | undefined;
}
export interface GoodsReceiptProps extends GoodsReceiptHeader { readonly lines: readonly GoodsReceiptLineInput[] }
export type GrnWarningCode = "PUBLIC_PRICE_MISMATCH" | "SHORT_SHELF_LIFE";
export interface GrnWarning { readonly code: GrnWarningCode; readonly lineId: string }
export interface GoodsReceiptAccounts { readonly grni: string; readonly ap: string }
export interface PostGoodsReceiptOptions {
  readonly entryId: string;
  /** Pure id generator (UUID v7 port, E2) for lots and movements. */
  readonly newId: () => string;
  readonly accounts: GoodsReceiptAccounts;
  /** GRNI (default, FR-PUR-113) or AP for receipts posted together with the supplier invoice. */
  readonly creditTo?: "GRNI" | "AP" | undefined;
  readonly po?: PurchaseOrder | undefined;
  readonly overReceiptToleranceBp?: number | undefined;
  readonly postedAt: Date;
}
export interface LineCost {
  readonly lineId: string; readonly netBase: Money; readonly landedBase: Money; readonly totalBase: Money;
  /** Per-SSU effective cost (FR-PUR-106), Half-Up. */
  readonly unitCostBase: Money;
}
export interface PostedGoodsReceipt {
  readonly receipt: GoodsReceipt;
  readonly lots: readonly LotProps[];
  readonly movements: readonly StockMovement[];
  readonly entry: JournalEntry;
  readonly po: PurchaseOrder | null;
  readonly lineCosts: readonly LineCost[];
  readonly warnings: readonly GrnWarning[];
}

function buildLine(l: GoodsReceiptLineInput, h: GoodsReceiptHeader, warnings: GrnWarning[]): Result<GoodsReceiptLine> {
  const ctx = { lineId: l.lineId };
  if (l.unit.itemId !== l.itemId) return domainErr("grn.unit_item_mismatch", "Unit belongs to another item", ctx);
  if (!l.unit.canPurchase) return domainErr("grn.unit_not_purchasable", "Unit cannot be purchased", ctx);
  if (l.unitCost.currency !== h.currency) return domainErr("grn.currency_mismatch", "Line cost currency differs from the GRN currency", ctx);
  const bonus = l.bonusSsu ?? 0n;
  if (bonus < 0n) return domainErr("grn.negative_bonus", "Bonus quantity must be >= 0", ctx);
  const lotNumber = normalizeLotNumber(l.lotNumber);
  if (lotNumber === "" || lotNumber.length > LOT_NUMBER_MAX_LENGTH) return domainErr("grn.invalid_lot_number", "Lot number is required", ctx);
  let expiryDate: IsoDate = NO_EXPIRY_DATE;
  if (l.trackExpiry) {
    if (!isIsoDate(l.expiryDate)) return domainErr("grn.expiry_required", "Expiry date is required for items that track expiry", ctx);
    expiryDate = l.expiryDate;
    if (compareIsoDate(expiryDate, h.businessDate) <= 0) return domainErr("grn.expired_at_receipt", "Cannot receive an expired lot", { ...ctx, expiryDate });
    if (h.minShelfLifeDays !== undefined && daysBetween(h.businessDate, expiryDate) < h.minShelfLifeDays) warnings.push({ code: "SHORT_SHELF_LIFE", lineId: l.lineId });
  }
  if (l.printedPublicPrice && l.officialPublicPrice && !l.printedPublicPrice.equals(l.officialPublicPrice)) {
    warnings.push({ code: "PUBLIC_PRICE_MISMATCH", lineId: l.lineId });
  }
  const snap = snapshotUnit(l.unit, l.qtyInUnit);
  if (!snap.ok) return snap;
  const a = computeLineAmounts(l.unitCost, l.qtyInUnit, l.discount ?? null);
  if (!a.ok) return a;
  return ok(Object.freeze({
    lineId: l.lineId, itemId: l.itemId, poLineId: l.poLineId ?? null, lotNumber, expiryDate, unit: snap.value,
    qtySsu: snap.value.ssuQty, bonusSsu: bonus, unitCost: l.unitCost, gross: a.value.gross, discount: a.value.discount, net: a.value.net,
    sourceType: l.sourceType, printedPublicPrice: l.printedPublicPrice ?? null, supplierBatchRef: l.supplierBatchRef ?? null,
  }));
}

interface GrnState {
  readonly header: GoodsReceiptHeader;
  readonly lines: readonly GoodsReceiptLine[];
  readonly status: GrnStatus;
  readonly warnings: readonly GrnWarning[];
  readonly entryId: string | null;
}

// ------------------------------------------------------------------ aggregate

export class GoodsReceipt {
  private readonly s: GrnState;
  private constructor(s: GrnState) {
    this.s = Object.freeze({ ...s, lines: Object.freeze([...s.lines]), warnings: Object.freeze([...s.warnings]) });
    Object.freeze(this);
  }

  static create(p: GoodsReceiptProps): Result<GoodsReceipt> {
    if (p.lines.length === 0) return domainErr("grn.no_lines", "A goods receipt needs at least one line");
    if (p.currency !== p.baseCurrency && (p.rateScaledSnapshot === undefined || p.rateScaledSnapshot <= 0n)) {
      return domainErr("grn.rate_required", "A positive rate to base currency is required for foreign-currency receipts");
    }
    if (p.bonusCostPolicy !== undefined && !BONUS_COST_POLICIES.includes(p.bonusCostPolicy)) {
      return domainErr("grn.invalid_bonus_policy", "Unknown bonus cost policy", { policy: p.bonusCostPolicy });
    }
    const { lines: inputs, ...header } = p;
    const warnings: GrnWarning[] = [];
    const lines: GoodsReceiptLine[] = [];
    const ids = new Set<string>();
    for (const l of inputs) {
      if (ids.has(l.lineId)) return domainErr("grn.duplicate_line", "Duplicate line id", { lineId: l.lineId });
      ids.add(l.lineId);
      const r = buildLine(l, header, warnings);
      if (!r.ok) return r;
      lines.push(r.value);
    }
    return ok(new GoodsReceipt({ header: Object.freeze(header), lines, status: "DRAFT", warnings, entryId: null }));
  }

  get grnId(): string { return this.s.header.grnId; }
  get header(): GoodsReceiptHeader { return this.s.header; }
  get status(): GrnStatus { return this.s.status; }
  get lines(): readonly GoodsReceiptLine[] { return this.s.lines; }
  get warnings(): readonly GrnWarning[] { return this.s.warnings; }
  get entryId(): string | null { return this.s.entryId; }

  private updatePo(opts: PostGoodsReceiptOptions): Result<PurchaseOrder | null> {
    const poId = this.s.header.poId;
    if (poId === undefined) return ok(null);
    if (!opts.po || opts.po.poId !== poId) return domainErr("grn.po_missing", "Linked purchase order must be supplied", { poId });
    const agg = new Map<string, bigint>();
    for (const l of this.s.lines) {
      if (l.poLineId === null) return domainErr("grn.po_line_required", "Each line of a PO-linked receipt must reference a PO line", { lineId: l.lineId });
      agg.set(l.poLineId, (agg.get(l.poLineId) ?? 0n) + l.qtySsu);
    }
    const receipts: ReceiptQty[] = [...agg].map(([lineId, qtySsu]) => ({ lineId, qtySsu }));
    return opts.po.recordReceipt(receipts, opts.overReceiptToleranceBp ?? 0);
  }

  /** Net per line in GRN currency after the invoice discount share, then converted to base. */
  private baseNets(): Result<{ foreign: Money[]; base: Money[] }> {
    const h = this.s.header;
    let foreign = this.s.lines.map((l) => l.net);
    if (h.invoiceDiscount) {
      const d = distributeInvoiceDiscount(foreign, invoiceDiscountOf(h.invoiceDiscount));
      if (!d.ok) return d;
      foreign = foreign.map((n, i) => n.subtract(d.value.allocations[i] ?? Money.zero(h.currency)));
    }
    const base: Money[] = [];
    for (const n of foreign) {
      const c = toBase(n, h.rateScaledSnapshot, h.baseCurrency);
      if (!c.ok) return c;
      base.push(c.value.base);
    }
    return ok({ foreign, base });
  }

  /** FR-PUR-108: each landed cost allocated by value or quantity with the largest-remainder method. */
  private allocateLanded(base: readonly Money[]): Result<{ landed: Money[]; credits: JournalLineInput[] }> {
    const h = this.s.header;
    const landed = this.s.lines.map(() => Money.zero(h.baseCurrency));
    const credits: JournalLineInput[] = [];
    for (const lc of h.landedCosts ?? []) {
      if (lc.amount.currency !== h.baseCurrency) return domainErr("grn.landed_currency", "Landed costs must be in base currency", { expenseType: lc.expenseType });
      if (!lc.amount.isPositive()) return domainErr("grn.landed_not_positive", "Landed cost must be > 0", { expenseType: lc.expenseType });
      const ratios = this.s.lines.map((l, i) => (lc.method === "BY_VALUE" ? Number(base[i]?.amountMinor ?? 0n) : Number(l.qtySsu + l.bonusSsu)));
      if (ratios.some((x) => !Number.isSafeInteger(x))) return domainErr("grn.amount_too_large", "Amounts too large to allocate safely");
      if (ratios.every((x) => x === 0)) return domainErr("grn.landed_no_basis", "Nothing to allocate landed cost over", { method: lc.method });
      lc.amount.allocate(ratios).forEach((part, i) => { landed[i] = (landed[i] ?? Money.zero(h.baseCurrency)).add(part); });
      credits.push({ accountCode: lc.creditAccountCode, credit: lc.amount, memo: `Landed cost ${lc.expenseType} GRN ${h.grnNo}`, dimensions: { supplierId: h.supplierId } });
    }
    return ok({ landed, credits });
  }

  post(opts: PostGoodsReceiptOptions): Result<PostedGoodsReceipt> {
    const h = this.s.header;
    if (this.s.status !== "DRAFT") return domainErr("grn.not_draft", "Only a draft receipt can be posted", { status: this.s.status });
    const po = this.updatePo(opts);
    if (!po.ok) return po;
    const nets = this.baseNets();
    if (!nets.ok) return nets;
    const alloc = this.allocateLanded(nets.value.base);
    if (!alloc.ok) return alloc;
    const policy = h.bonusCostPolicy ?? DEFAULT_BONUS_COST_POLICY;
    const lots: LotProps[] = [];
    const movements: StockMovement[] = [];
    const lineCosts: LineCost[] = [];
    for (let i = 0; i < this.s.lines.length; i++) {
      const l = this.s.lines[i] as GoodsReceiptLine;
      const netBase = nets.value.base[i] as Money;
      const landedBase = alloc.value.landed[i] as Money;
      const cost = netBase.add(landedBase);
      const split = policy === "ZERO_COST" && l.bonusSsu > 0n;
      const parts = split ? [{ qty: l.qtySsu, cost }, { qty: l.bonusSsu, cost: Money.zero(h.baseCurrency) }] : [{ qty: l.qtySsu + l.bonusSsu, cost }];
      for (const part of parts) {
        const lotId = opts.newId();
        const props: LotProps = Object.freeze({
          lotId, itemId: l.itemId, lotNumber: l.lotNumber, expiryDate: l.expiryDate, qtyReceivedSsu: part.qty, totalCostMinor: part.cost,
          sourceType: l.sourceType, supplierId: h.supplierId, printedPublicPriceMinor: l.printedPublicPrice ?? undefined,
        });
        const lot = Lot.create(props);
        if (!lot.ok) return lot;
        const mv = StockMovement.create({
          movementId: opts.newId(), itemId: l.itemId, lotId, locationId: h.locationId, type: "RECEIPT", qtyDeltaSsu: part.qty,
          unitCostSnapshot: part.cost.divide(part.qty), costMinor: part.cost,
          documentRef: { docType: GRN_DOC_TYPE, docId: h.grnId, lineId: l.lineId }, occurredAt: h.receivedAt, businessDate: h.businessDate,
        });
        if (!mv.ok) return mv;
        lots.push(props);
        movements.push(mv.value);
      }
      lineCosts.push(Object.freeze({ lineId: l.lineId, netBase, landedBase, totalBase: cost, unitCostBase: cost.divide(split ? l.qtySsu : l.qtySsu + l.bonusSsu) }));
    }
    const memo = `GRN ${h.grnNo}`;
    const valued = lots.filter((p) => !p.totalCostMinor.isZero()).map((p) => ({ itemId: p.itemId, lotId: p.lotId, cost: p.totalCostMinor }));
    const inv = inventoryLotLines(valued, "DEBIT", h.baseCurrency, memo);
    if (!inv.ok) return inv;
    const creditBase = Money.sum(nets.value.base, h.baseCurrency);
    const foreign: ForeignSnapshot | null = h.currency === h.baseCurrency || h.rateScaledSnapshot === undefined
      ? null
      : { amount: Money.sum(nets.value.foreign, h.currency), rateScaledSnapshot: h.rateScaledSnapshot };
    const creditTo = opts.creditTo ?? "GRNI";
    const credit: JournalLineInput = {
      accountCode: creditTo === "GRNI" ? opts.accounts.grni : opts.accounts.ap, credit: creditBase,
      memo: `${creditTo} ${memo}`, dimensions: { supplierId: h.supplierId }, foreign,
    };
    const entry = postEntry(
      { entryId: opts.entryId, tenantId: h.tenantId, postedAt: opts.postedAt, baseCurrency: h.baseCurrency },
      { type: GRN_DOC_TYPE, id: h.grnId },
      [...inv.value.lines, credit, ...alloc.value.credits],
      memo,
    );
    if (!entry.ok) return entry;
    return ok(Object.freeze({
      receipt: new GoodsReceipt({ ...this.s, status: "POSTED", entryId: opts.entryId }),
      lots: Object.freeze(lots), movements: Object.freeze(movements), entry: entry.value, po: po.value,
      lineCosts: Object.freeze(lineCosts), warnings: this.s.warnings,
    }));
  }
}
