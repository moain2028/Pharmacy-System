/**
 * SalesInvoice aggregate (FR-SAL-110..133, FR-SAL-155). Pure and immutable: every intent method
 * returns a new instance. States: DRAFT -> HELD (no stock reservation: lot allocations dropped)
 * -> DRAFT; DRAFT -> PENDING_APPROVAL -> DRAFT; DRAFT -> POSTED -> REVERSED;
 * DRAFT | HELD | PENDING_APPROVAL -> CANCELLED. Posted invoices are never edited (B5).
 */
import type { LotCostLine } from "../accounting/posting-common.js";
import { convertWithSnapshot, type RateSnapshot } from "../fx/exchange-rate.js";
import type { FefoOverride, FefoResult } from "../inventory/fefo.js";
import type { IsoDate } from "../inventory/iso-date.js";
import type { Lot, LotEffectiveStatus } from "../inventory/lot.js";
import type { DocumentRef, MovementType } from "../inventory/stock-movement.js";
import type { CurrencyCode } from "../money/currency.js";
import { Money } from "../money/money.js";
import type { DiscountBreakdown, DiscountLimits, InvoiceDiscount, LineDiscount } from "../pricing/discount.js";
import { snapshotUnit, type ItemUnit, type UnitSnapshot } from "../quantity/quantity.js";
import { domainErr, ok, type Result } from "../shared/result.js";
import { computeInvoiceTotals, type CashRounding, type InvoiceTotals, type LineTotals } from "./invoice-totals.js";
import {
  DEFAULT_PRICE_GUARD_POLICIES, SALES_PERMISSIONS, checkCredit, checkItemActive, checkLinePrice, checkLotsSellable,
  checkPrescription, evaluateGuard, type CustomerCreditInfo, type GuardOverride, type GuardWarning, type LineRxInfo,
  type PriceGuardOverrides, type PriceGuardPolicies, type Prescription,
} from "./sale-guards.js";

export const SALES_INVOICE_STATES = ["DRAFT", "HELD", "PENDING_APPROVAL", "POSTED", "REVERSED", "CANCELLED"] as const;
export type SalesInvoiceState = (typeof SALES_INVOICE_STATES)[number];
export const PRICE_SOURCES = ["CUSTOMER", "GROUP", "UNIT", "SSU", "MANUAL"] as const;
export type PriceSource = (typeof PRICE_SOURCES)[number];
export const HOLD_LABEL_MAX_LENGTH = 40;
export const LINE_NOTE_MAX_LENGTH = 120;
export const SALES_INVOICE_DOC_TYPE = "SALES_INVOICE";

export interface SalesInvoiceHeader {
  readonly invoiceId: string;
  readonly tenantId: string;
  readonly clientUuid: string;
  readonly currency: CurrencyCode;
  readonly customerId: string;
  readonly locationId: string;
  readonly cashierId: string;
  /** ISO-8601 timestamp. */
  readonly createdAt: string;
}

export interface SalesLineInput {
  readonly lineId: string;
  readonly itemId: string;
  readonly itemNameAr: string;
  readonly itemNameEn: string;
  readonly itemActive: boolean;
  readonly unit: ItemUnit;
  readonly qtyInUnit: bigint;
  readonly unitPrice: Money;
  readonly priceSource: PriceSource;
  readonly regulatedUnitPriceSnapshot: Money | null;
  readonly minUnitPrice: Money | null;
  readonly rx: LineRxInfo;
  readonly discounts?: readonly LineDiscount[] | undefined;
  readonly taxBp?: number | undefined;
  readonly excludeFromInvoiceDiscount?: boolean | undefined;
  readonly lineNote?: string | undefined;
}

export interface LineLotAllocation {
  readonly lotId: string;
  readonly expiryDate: IsoDate;
  readonly qtySsu: bigint;
  /** Exact COGS from Lot.costForSsu (base currency of the lot). */
  readonly cost: Money;
  readonly status: LotEffectiveStatus;
  readonly viaOverride: boolean;
}

export interface SalesInvoiceLine {
  readonly lineId: string;
  readonly itemId: string;
  readonly itemNameAr: string;
  readonly itemNameEn: string;
  readonly unit: UnitSnapshot;
  readonly unitPrice: Money;
  readonly priceSource: PriceSource;
  readonly regulatedUnitPriceSnapshot: Money | null;
  readonly minUnitPrice: Money | null;
  readonly discounts: readonly LineDiscount[];
  readonly taxBp: number;
  readonly excludeFromInvoiceDiscount: boolean;
  readonly rx: LineRxInfo;
  readonly lineNote: string | null;
  readonly allocations: readonly LineLotAllocation[];
  readonly fefoOverride: FefoOverride | null;
}

export interface PostedSnapshot {
  readonly docNo: string;
  readonly businessDate: IsoDate;
  readonly postedAt: string;
  readonly totals: InvoiceTotals;
  readonly warnings: readonly GuardWarning[];
}

export interface PostContext {
  readonly docNo: string;
  readonly businessDate: IsoDate;
  readonly postedAt: Date;
  readonly cashRounding?: CashRounding | null | undefined;
  readonly limits?: DiscountLimits | undefined;
  readonly pricePolicies?: PriceGuardPolicies | undefined;
  /** Keyed by lineId. */
  readonly priceOverrides?: Readonly<Record<string, PriceGuardOverrides>> | undefined;
  /** Needed when lot cost currency differs from the invoice currency (below-cost guard). */
  readonly costRate?: RateSnapshot | undefined;
  readonly credit?: {
    readonly customer: CustomerCreditInfo;
    readonly creditPortion: Money;
    readonly override?: GuardOverride | undefined;
  } | undefined;
  readonly zeroInvoiceOverride?: GuardOverride | undefined;
}

export interface ReversalCommand {
  readonly reversedBy: string;
  readonly reason: string;
  readonly permissions: readonly string[];
}

export interface SaleMovementIntent {
  readonly type: Extract<MovementType, "SALE">;
  readonly itemId: string;
  readonly lotId: string;
  readonly locationId: string;
  readonly qtyDeltaSsu: bigint;
  readonly unitCostSnapshot: Money;
  readonly costMinor: Money;
  readonly documentRef: DocumentRef;
  readonly businessDate: IsoDate;
}

export interface SaleAccountingData {
  readonly currency: CurrencyCode;
  readonly customerId: string;
  readonly gross: Money;
  readonly lineDiscountTotal: Money;
  readonly invoiceDiscountTotal: Money;
  readonly discountTotal: Money;
  readonly byType: DiscountBreakdown;
  readonly net: Money;
  readonly tax: Money;
  readonly roundingAdjustment: Money;
  readonly total: Money;
  readonly cogs: readonly LotCostLine[];
  readonly cogsTotal: Money;
  /** net - COGS when both share a currency; otherwise null (computed in base by the posting rule). */
  readonly grossProfit: Money | null;
}

export interface SalePostingIntent {
  readonly invoiceId: string;
  readonly tenantId: string;
  readonly docNo: string;
  readonly businessDate: IsoDate;
  readonly postedAt: string;
  readonly movements: readonly SaleMovementIntent[];
  readonly accounting: SaleAccountingData;
}

interface InvoiceData {
  readonly header: SalesInvoiceHeader;
  readonly state: SalesInvoiceState;
  readonly lines: readonly SalesInvoiceLine[];
  readonly invoiceDiscount: InvoiceDiscount | null;
  readonly prescription: Prescription | null;
  readonly holdLabel: string | null;
  readonly approvedBy: string | null;
  readonly statusReason: string | null;
  readonly posting: PostedSnapshot | null;
}

const blank = (s: string | undefined): boolean => (s ?? "").trim() === "";
const sumQty = (xs: readonly { readonly qtySsu: bigint }[]): bigint => xs.reduce((a, x) => a + x.qtySsu, 0n);
const HEADER_KEYS = ["invoiceId", "tenantId", "clientUuid", "customerId", "locationId", "cashierId"] as const;

export class SalesInvoice {
  private readonly d: InvoiceData;

  private constructor(d: InvoiceData) {
    this.d = Object.freeze(d);
    Object.freeze(this);
  }

  static create(header: SalesInvoiceHeader): Result<SalesInvoice> {
    for (const k of HEADER_KEYS) {
      if (blank(header[k])) return domainErr("sales.invalid_header", `${k} is required`, { field: k });
    }
    if (Number.isNaN(Date.parse(header.createdAt))) {
      return domainErr("sales.invalid_header", "createdAt must be an ISO timestamp", { field: "createdAt" });
    }
    return ok(new SalesInvoice({
      header: Object.freeze({ ...header }), state: "DRAFT", lines: Object.freeze([]), invoiceDiscount: null,
      prescription: null, holdLabel: null, approvedBy: null, statusReason: null, posting: null,
    }));
  }

  get header(): SalesInvoiceHeader { return this.d.header; }
  get state(): SalesInvoiceState { return this.d.state; }
  get lines(): readonly SalesInvoiceLine[] { return this.d.lines; }
  get invoiceDiscount(): InvoiceDiscount | null { return this.d.invoiceDiscount; }
  get prescription(): Prescription | null { return this.d.prescription; }
  get holdLabel(): string | null { return this.d.holdLabel; }
  get approvedBy(): string | null { return this.d.approvedBy; }
  get statusReason(): string | null { return this.d.statusReason; }
  get posting(): PostedSnapshot | null { return this.d.posting; }

  private with(patch: Partial<InvoiceData>): SalesInvoice {
    return new SalesInvoice({ ...this.d, ...patch });
  }

  private inState(allowed: readonly SalesInvoiceState[], action: string): Result<null> {
    return allowed.includes(this.d.state)
      ? ok(null)
      : domainErr("sales.invalid_transition", `Cannot ${action} an invoice in state ${this.d.state}`, { state: this.d.state, action });
  }

  private findLine(lineId: string): Result<number> {
    const i = this.d.lines.findIndex((l) => l.lineId === lineId);
    return i < 0 ? domainErr("sales.line_not_found", "Line not found", { lineId }) : ok(i);
  }

  // ------------------------------------------------------------------ draft editing

  addLine(input: SalesLineInput): Result<SalesInvoice> {
    const s = this.inState(["DRAFT"], "edit");
    if (!s.ok) return s;
    if (this.d.lines.some((l) => l.lineId === input.lineId)) {
      return domainErr("sales.duplicate_line", "Duplicate line id", { lineId: input.lineId });
    }
    for (const p of [input.unitPrice, input.regulatedUnitPriceSnapshot, input.minUnitPrice]) {
      if (p !== null && p.currency !== this.d.header.currency) {
        return domainErr("sales.currency_mismatch", "Line prices must be in the invoice currency", {
          lineId: input.lineId, expected: this.d.header.currency, actual: p.currency,
        });
      }
    }
    if (input.unitPrice.isNegative()) return domainErr("sales.negative_price", "Unit price must be >= 0", { lineId: input.lineId });
    const act = checkItemActive(input.itemId, input.itemActive);
    if (!act.ok) return act;
    if (input.unit.itemId !== input.itemId) {
      return domainErr("sales.unit_item_mismatch", "Unit belongs to another item", { lineId: input.lineId, unitId: input.unit.unitId });
    }
    if (!input.unit.canSell) return domainErr("sales.unit_not_sellable", "Unit cannot be sold", { unitId: input.unit.unitId });
    const note = input.lineNote ?? null;
    if (note !== null && note.length > LINE_NOTE_MAX_LENGTH) {
      return domainErr("sales.line_note_too_long", "Line note too long", { max: LINE_NOTE_MAX_LENGTH });
    }
    const snap = snapshotUnit(input.unit, input.qtyInUnit);
    if (!snap.ok) return snap;
    const line: SalesInvoiceLine = Object.freeze({
      lineId: input.lineId, itemId: input.itemId, itemNameAr: input.itemNameAr, itemNameEn: input.itemNameEn,
      unit: snap.value, unitPrice: input.unitPrice, priceSource: input.priceSource,
      regulatedUnitPriceSnapshot: input.regulatedUnitPriceSnapshot, minUnitPrice: input.minUnitPrice,
      discounts: Object.freeze([...(input.discounts ?? [])]), taxBp: input.taxBp ?? 0,
      excludeFromInvoiceDiscount: input.excludeFromInvoiceDiscount === true, rx: Object.freeze({ ...input.rx }),
      lineNote: note, allocations: Object.freeze([]), fefoOverride: null,
    });
    return ok(this.with({ lines: Object.freeze([...this.d.lines, line]) }));
  }

  removeLine(lineId: string): Result<SalesInvoice> {
    const s = this.inState(["DRAFT"], "edit");
    if (!s.ok) return s;
    const i = this.findLine(lineId);
    if (!i.ok) return i;
    return ok(this.with({ lines: Object.freeze(this.d.lines.filter((_, k) => k !== i.value)) }));
  }

  setInvoiceDiscount(discount: InvoiceDiscount | null): Result<SalesInvoice> {
    const s = this.inState(["DRAFT"], "edit");
    return s.ok ? ok(this.with({ invoiceDiscount: discount })) : s;
  }

  setPrescription(prescription: Prescription | null): Result<SalesInvoice> {
    const s = this.inState(["DRAFT"], "edit");
    return s.ok ? ok(this.with({ prescription: prescription === null ? null : Object.freeze({ ...prescription }) })) : s;
  }

  /** Attach a FEFO allocation (computed by inventory/fefo.ts); COGS per lot via Lot.costForSsu. */
  assignLots(lineId: string, fefo: FefoResult, lots: ReadonlyMap<string, Lot>, businessDate: IsoDate): Result<SalesInvoice> {
    const s = this.inState(["DRAFT"], "allocate");
    if (!s.ok) return s;
    const i = this.findLine(lineId);
    if (!i.ok) return i;
    const line = this.d.lines[i.value] as SalesInvoiceLine;
    if (fefo.shortfallSsu !== 0n) {
      return domainErr("sales.insufficient_stock", "Not enough sellable stock", { lineId, shortfallSsu: fefo.shortfallSsu.toString() });
    }
    if (sumQty(fefo.allocations) !== line.unit.ssuQty || fefo.allocations.some((a) => a.qtySsu <= 0n)) {
      return domainErr("sales.allocation_mismatch", "Lot allocation does not match the line quantity", {
        lineId, expectedSsu: line.unit.ssuQty.toString(),
      });
    }
    const sell = checkLotsSellable(fefo.allocations, businessDate);
    if (!sell.ok) return sell;
    const allocations: LineLotAllocation[] = [];
    for (const a of fefo.allocations) {
      const lot = lots.get(a.lotId);
      if (lot === undefined) return domainErr("sales.lot_unknown", "Lot not provided", { lotId: a.lotId });
      const cost = lot.costForSsu(a.qtySsu);
      if (!cost.ok) return cost;
      allocations.push(Object.freeze({
        lotId: a.lotId, expiryDate: a.expiryDate, qtySsu: a.qtySsu, cost: cost.value, status: a.status, viaOverride: a.viaOverride,
      }));
    }
    const updated: SalesInvoiceLine = Object.freeze({ ...line, allocations: Object.freeze(allocations), fefoOverride: fefo.override });
    return ok(this.with({ lines: Object.freeze(this.d.lines.map((l, k) => (k === i.value ? updated : l))) }));
  }

  // ------------------------------------------------------------------ lifecycle

  /** FR-SAL-123: holding never reserves stock, so allocations are released. */
  hold(label?: string): Result<SalesInvoice> {
    const s = this.inState(["DRAFT"], "hold");
    if (!s.ok) return s;
    const lbl = (label ?? "").trim();
    if (lbl.length > HOLD_LABEL_MAX_LENGTH) {
      return domainErr("sales.hold_label_too_long", "Hold label too long", { max: HOLD_LABEL_MAX_LENGTH });
    }
    const lines = this.d.lines.map((l) => Object.freeze({ ...l, allocations: Object.freeze([]), fefoOverride: null }));
    return ok(this.with({ state: "HELD", holdLabel: lbl === "" ? null : lbl, lines: Object.freeze(lines) }));
  }

  resume(): Result<SalesInvoice> {
    const s = this.inState(["HELD"], "resume");
    return s.ok ? ok(this.with({ state: "DRAFT", holdLabel: null })) : s;
  }

  requestApproval(reason: string): Result<SalesInvoice> {
    const s = this.inState(["DRAFT"], "request approval for");
    if (!s.ok) return s;
    if (blank(reason)) return domainErr("sales.reason_required", "A reason is required");
    return ok(this.with({ state: "PENDING_APPROVAL", statusReason: reason.trim() }));
  }

  approve(approverId: string): Result<SalesInvoice> { return this.decide(approverId, true); }
  reject(approverId: string): Result<SalesInvoice> { return this.decide(approverId, false); }

  private decide(approverId: string, approved: boolean): Result<SalesInvoice> {
    const s = this.inState(["PENDING_APPROVAL"], approved ? "approve" : "reject");
    if (!s.ok) return s;
    if (blank(approverId)) return domainErr("sales.approver_required", "Approver id is required");
    return ok(this.with({ state: "DRAFT", approvedBy: approved ? approverId : null, statusReason: null }));
  }

  cancel(reason: string): Result<SalesInvoice> {
    const s = this.inState(["DRAFT", "HELD", "PENDING_APPROVAL"], "cancel");
    if (!s.ok) return s;
    if (blank(reason)) return domainErr("sales.reason_required", "A reason is required");
    return ok(this.with({ state: "CANCELLED", statusReason: reason.trim() }));
  }

  /** FR-SAL-155 (shift checks belong to the application layer). */
  reverse(cmd: ReversalCommand): Result<SalesInvoice> {
    const s = this.inState(["POSTED"], "reverse");
    if (!s.ok) return s;
    if (blank(cmd.reversedBy) || !cmd.permissions.includes(SALES_PERMISSIONS.reverse)) {
      return domainErr("sales.permission_denied", "Reversal requires permission", { requiredPermission: SALES_PERMISSIONS.reverse });
    }
    if (blank(cmd.reason)) return domainErr("sales.reason_required", "A reason is required");
    return ok(this.with({ state: "REVERSED", statusReason: cmd.reason.trim() }));
  }

  computeTotals(cashRounding: CashRounding | null = null, limits: DiscountLimits = {}): Result<InvoiceTotals> {
    return computeInvoiceTotals({
      currency: this.d.header.currency,
      lines: this.d.lines.map((l) => ({
        lineId: l.lineId, unitPrice: l.unitPrice, qtyInUnit: l.unit.qtyInUnit, discounts: l.discounts,
        taxBp: l.taxBp, excludeFromInvoiceDiscount: l.excludeFromInvoiceDiscount,
      })),
      invoiceDiscount: this.d.invoiceDiscount,
      limits,
      cashRounding,
    });
  }

  private lineCost(line: SalesInvoiceLine, rate: RateSnapshot | undefined): Result<Money> {
    const cost = Money.sum(line.allocations.map((a) => a.cost));
    if (cost.currency === this.d.header.currency) return ok(cost);
    if (rate === undefined) {
      return domainErr("sales.cost_rate_missing", "A rate snapshot is needed to compare cost with price", {
        costCurrency: cost.currency, invoiceCurrency: this.d.header.currency,
      });
    }
    return convertWithSnapshot(cost, rate, this.d.header.currency);
  }

  /** Runs every posting guard, freezes totals (rounded once, A3) and moves to POSTED. */
  post(ctx: PostContext): Result<SalesInvoice> {
    const s = this.inState(["DRAFT"], "post");
    if (!s.ok) return s;
    if (blank(ctx.docNo)) return domainErr("sales.doc_no_required", "Document number is required to post");
    if (this.d.lines.length === 0) return domainErr("sales.no_lines", "Cannot post an invoice without lines");
    const totals = this.computeTotals(ctx.cashRounding ?? null, ctx.limits ?? {});
    if (!totals.ok) return totals;
    const t = totals.value;
    const warnings: GuardWarning[] = [];
    const policies = ctx.pricePolicies ?? DEFAULT_PRICE_GUARD_POLICIES;
    for (const [i, line] of this.d.lines.entries()) {
      if (sumQty(line.allocations) !== line.unit.ssuQty) {
        return domainErr("sales.lots_not_allocated", "Line has no complete lot allocation", { lineId: line.lineId });
      }
      const sell = checkLotsSellable(line.allocations, ctx.businessDate);
      if (!sell.ok) return sell;
      const cost = this.lineCost(line, ctx.costRate);
      if (!cost.ok) return cost;
      const lt = t.lines[i] as LineTotals;
      const pr = checkLinePrice({
        lineId: line.lineId, qtyInUnit: line.unit.qtyInUnit, unitPrice: line.unitPrice, lineNet: lt.net,
        minUnitPrice: line.minUnitPrice, regulatedUnitPrice: line.regulatedUnitPriceSnapshot, lineCost: cost.value,
      }, policies, ctx.priceOverrides?.[line.lineId] ?? {});
      if (!pr.ok) return pr;
      warnings.push(...pr.value);
    }
    const rx = checkPrescription(this.d.lines.map((l) => ({ lineId: l.lineId, rx: l.rx, ssuQty: l.unit.ssuQty })), this.d.prescription);
    if (!rx.ok) return rx;
    warnings.push(...rx.value);
    if (ctx.credit !== undefined) {
      if (ctx.credit.customer.customerId !== this.d.header.customerId) {
        return domainErr("sales.customer_mismatch", "Credit info belongs to another customer");
      }
      const c = checkCredit(ctx.credit.customer, ctx.credit.creditPortion, ctx.credit.override);
      if (!c.ok) return c;
      warnings.push(...c.value);
    }
    if (t.total.isZero()) {
      const z = evaluateGuard({
        code: "sales.zero_invoice", message: "Zero-value invoices need permission", policy: "BLOCK_WITH_OVERRIDE",
        permission: SALES_PERMISSIONS.zeroInvoice,
      }, ctx.zeroInvoiceOverride);
      if (!z.ok) return z;
      warnings.push(z.value);
    }
    return ok(this.with({
      state: "POSTED",
      posting: Object.freeze({
        docNo: ctx.docNo.trim(), businessDate: ctx.businessDate, postedAt: ctx.postedAt.toISOString(),
        totals: t, warnings: Object.freeze(warnings),
      }),
    }));
  }

  /** Pure data for the application: SALE stock movements per lot + accounting posting inputs. */
  toPostingIntent(): Result<SalePostingIntent> {
    const p = this.d.posting;
    if (this.d.state !== "POSTED" || p === null) return domainErr("sales.not_posted", "Only posted invoices produce a posting intent");
    const h = this.d.header;
    const movements: SaleMovementIntent[] = [];
    const cogs: LotCostLine[] = [];
    for (const line of this.d.lines) {
      for (const a of line.allocations) {
        movements.push(Object.freeze({
          type: "SALE", itemId: line.itemId, lotId: a.lotId, locationId: h.locationId, qtyDeltaSsu: -a.qtySsu,
          unitCostSnapshot: a.cost.divide(a.qtySsu), costMinor: a.cost,
          documentRef: Object.freeze({ docType: SALES_INVOICE_DOC_TYPE, docId: h.invoiceId, lineId: line.lineId }),
          businessDate: p.businessDate,
        }));
        cogs.push(Object.freeze({ itemId: line.itemId, lotId: a.lotId, cost: a.cost }));
      }
    }
    const t = p.totals;
    const cogsTotal = Money.sum(cogs.map((c) => c.cost));
    return ok(Object.freeze({
      invoiceId: h.invoiceId, tenantId: h.tenantId, docNo: p.docNo, businessDate: p.businessDate, postedAt: p.postedAt,
      movements: Object.freeze(movements),
      accounting: Object.freeze({
        currency: h.currency, customerId: h.customerId, gross: t.gross, lineDiscountTotal: t.lineDiscountTotal,
        invoiceDiscountTotal: t.invoiceDiscountTotal, discountTotal: t.discountTotal, byType: t.byType, net: t.net,
        tax: t.tax, roundingAdjustment: t.roundingAdjustment, total: t.total, cogs: Object.freeze(cogs), cogsTotal,
        grossProfit: cogsTotal.currency === h.currency ? t.net.subtract(cogsTotal) : null,
      }),
    }));
  }
}
