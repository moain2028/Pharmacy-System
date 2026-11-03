/**
 * Purchase order aggregate (FR-PUR-101, 103, 104, 107, 112; FR-SUP-101).
 * Lines are captured in purchase units with a factor snapshot (D-026) and priced per purchase
 * unit in the supplier currency. Supplier discounts reuse pricing/discount.ts: line first, then
 * invoice (FR-PUR-107). The PO rate is indicative only (FR-PUR-103) and is used for approval
 * limits in base currency (FR-PUR-104). Every intent method returns a new frozen instance.
 */
import type { CurrencyCode } from "../money/currency.js";
import { Money } from "../money/money.js";
import { snapshotUnit, type ItemUnit, type UnitSnapshot } from "../quantity/quantity.js";
import { domainErr, ok, type Result } from "../shared/result.js";
import type { IsoDate } from "../inventory/iso-date.js";
import { toBase } from "../accounting/posting-common.js";
import {
  applyLineDiscounts, distributeInvoiceDiscount, FULL_BP,
  type DiscountValue, type InvoiceDiscount, type LineDiscount,
} from "../pricing/discount.js";

export const PO_STATUSES = ["DRAFT", "PENDING_APPROVAL", "POSTED", "PARTIALLY_RECEIVED", "RECEIVED", "CLOSED", "CANCELLED"] as const;
export type PoStatus = (typeof PO_STATUSES)[number];
export const SUPPLIER_STATUSES = ["ACTIVE", "BLOCKED", "INACTIVE"] as const;
export type SupplierStatus = (typeof SUPPLIER_STATUSES)[number];
export const PO_CREATE_PERMISSION = "purchase_order.create" as const;
export const PO_APPROVE_PERMISSION = "purchase_order.approve" as const;
export const PO_REOPEN_PERMISSION = "purchase_order.reopen" as const;
export type ApprovalReason = "PO_AMOUNT_LIMIT" | "DISCOUNT_LIMIT";
export const RECEIVABLE_PO_STATUSES: readonly PoStatus[] = Object.freeze(["POSTED", "PARTIALLY_RECEIVED"]);

// ------------------------------------------------------------------ discount helpers (shared with GRN)

export function lineDiscountOf(v: DiscountValue, source = "supplier"): LineDiscount {
  return v.mode === "PERCENT" ? { type: "LINE_PERCENT", bp: v.bp, source } : { type: "LINE_AMOUNT", amount: v.amount, source };
}
export function invoiceDiscountOf(v: DiscountValue, source = "supplier"): InvoiceDiscount {
  return v.mode === "PERCENT" ? { type: "INVOICE_PERCENT", bp: v.bp, source } : { type: "INVOICE_AMOUNT", amount: v.amount, source };
}
/** Effective discount in bp, rounded UP (so truncation cannot slip under a limit). */
export function effectiveBp(discount: Money, base: Money): number {
  if (base.amountMinor <= 0n || discount.isZero()) return 0;
  return Number((discount.amountMinor * BigInt(FULL_BP) + base.amountMinor - 1n) / base.amountMinor);
}

export interface LineAmounts { readonly gross: Money; readonly discount: Money; readonly net: Money; readonly discountBp: number }

/** gross = unitCost × qtyInUnit; line discount applied Half-Up (D-028). */
export function computeLineAmounts(unitCost: Money, qtyInUnit: bigint, discount: DiscountValue | null): Result<LineAmounts> {
  if (qtyInUnit <= 0n) return domainErr("po.qty_not_positive", "Line quantity must be > 0", { qty: qtyInUnit.toString() });
  if (unitCost.isNegative()) return domainErr("po.negative_cost", "Unit cost must be >= 0");
  const gross = unitCost.multiply(qtyInUnit);
  const r = applyLineDiscounts(gross, discount ? [lineDiscountOf(discount)] : []);
  if (!r.ok) return r;
  const d = r.value.discountTotal;
  return ok(Object.freeze({ gross, discount: d, net: r.value.net, discountBp: effectiveBp(d, gross) }));
}

// ------------------------------------------------------------------ types

export interface PurchaseOrderLineInput {
  readonly lineId: string;
  readonly itemId: string;
  readonly unit: ItemUnit;
  readonly qtyInUnit: bigint;
  /** Expected cost per purchase unit, supplier currency. */
  readonly unitCost: Money;
  readonly discount?: DiscountValue | undefined;
  readonly expectedBonusSsu?: bigint | undefined;
}
export interface PurchaseOrderLine {
  readonly lineId: string;
  readonly itemId: string;
  readonly unit: UnitSnapshot;
  readonly unitCost: Money;
  readonly discount: DiscountValue | null;
  readonly gross: Money;
  readonly discountAmount: Money;
  readonly discountBp: number;
  readonly net: Money;
  readonly expectedBonusSsu: bigint;
  readonly receivedSsu: bigint;
}
export interface PurchaseOrderHeader {
  readonly poId: string;
  readonly poNo: string;
  readonly supplierId: string;
  readonly supplierStatus: SupplierStatus;
  readonly orderDate: IsoDate;
  readonly expectedDeliveryDate?: IsoDate | undefined;
  readonly currency: CurrencyCode;
  readonly baseCurrency: CurrencyCode;
  /** Indicative supplier→base rate (RATE_SCALE); required when currency ≠ base. */
  readonly rateScaledSnapshot?: bigint | undefined;
  readonly invoiceDiscount?: DiscountValue | undefined;
}
export interface PurchaseOrderProps extends PurchaseOrderHeader { readonly lines: readonly PurchaseOrderLineInput[] }
export interface PoTotals {
  readonly lineGross: Money; readonly lineDiscount: Money; readonly lineNet: Money;
  readonly invoiceDiscount: Money; readonly total: Money; readonly totalBase: Money;
}
export interface ApprovalInfo {
  readonly required: boolean; readonly reasons: readonly ApprovalReason[];
  readonly approvedBy: string | null; readonly approvedAt: string | null;
}
export interface ApprovalPolicy { readonly maxPoAmount?: Money | undefined; readonly maxSupplierDiscountBp?: number | undefined }
export interface Closure { readonly reason: string; readonly closedBy: string; readonly closedAt: string }
export interface ReceiptQty { readonly lineId: string; readonly qtySsu: bigint }

function buildLine(l: PurchaseOrderLineInput, currency: CurrencyCode): Result<PurchaseOrderLine> {
  if (l.unit.itemId !== l.itemId) return domainErr("po.unit_item_mismatch", "Unit belongs to another item", { lineId: l.lineId });
  if (!l.unit.canPurchase) return domainErr("po.unit_not_purchasable", "Unit cannot be purchased", { lineId: l.lineId, unitId: l.unit.unitId });
  if (l.unitCost.currency !== currency) return domainErr("po.currency_mismatch", "Line cost currency differs from the order currency", { lineId: l.lineId });
  const bonus = l.expectedBonusSsu ?? 0n;
  if (bonus < 0n) return domainErr("po.negative_bonus", "Expected bonus must be >= 0", { lineId: l.lineId });
  const snap = snapshotUnit(l.unit, l.qtyInUnit);
  if (!snap.ok) return snap;
  const amounts = computeLineAmounts(l.unitCost, l.qtyInUnit, l.discount ?? null);
  if (!amounts.ok) return amounts;
  const a = amounts.value;
  return ok(Object.freeze({
    lineId: l.lineId, itemId: l.itemId, unit: snap.value, unitCost: l.unitCost, discount: l.discount ?? null,
    gross: a.gross, discountAmount: a.discount, discountBp: a.discountBp, net: a.net, expectedBonusSsu: bonus, receivedSsu: 0n,
  }));
}

interface PoState {
  readonly header: PurchaseOrderHeader;
  readonly lines: readonly PurchaseOrderLine[];
  readonly status: PoStatus;
  readonly approval: ApprovalInfo;
  readonly totals: PoTotals;
  readonly closure: Closure | null;
}

const NO_APPROVAL: ApprovalInfo = Object.freeze({ required: false, reasons: Object.freeze([]), approvedBy: null, approvedAt: null });

// ------------------------------------------------------------------ aggregate

export class PurchaseOrder {
  private readonly s: PoState;
  private constructor(s: PoState) {
    this.s = Object.freeze({ ...s, lines: Object.freeze([...s.lines]) });
    Object.freeze(this);
  }

  static create(p: PurchaseOrderProps): Result<PurchaseOrder> {
    if (p.lines.length === 0) return domainErr("po.no_lines", "A purchase order needs at least one line");
    if (p.supplierStatus === "BLOCKED") return domainErr("po.supplier_blocked", "Supplier is blocked", { supplierId: p.supplierId });
    if (p.currency !== p.baseCurrency && p.rateScaledSnapshot === undefined) {
      return domainErr("po.rate_required", "A rate to base currency is required for foreign-currency orders");
    }
    if (p.rateScaledSnapshot !== undefined && p.rateScaledSnapshot <= 0n) return domainErr("po.invalid_rate", "Exchange rate must be > 0");
    const lines: PurchaseOrderLine[] = [];
    const ids = new Set<string>();
    for (const l of p.lines) {
      if (ids.has(l.lineId)) return domainErr("po.duplicate_line", "Duplicate line id", { lineId: l.lineId });
      ids.add(l.lineId);
      const r = buildLine(l, p.currency);
      if (!r.ok) return r;
      lines.push(r.value);
    }
    const nets = lines.map((l) => l.net);
    let invoiceDiscount = Money.zero(p.currency);
    if (p.invoiceDiscount) {
      const d = distributeInvoiceDiscount(nets, invoiceDiscountOf(p.invoiceDiscount));
      if (!d.ok) return d;
      invoiceDiscount = d.value.total;
    }
    const lineNet = Money.sum(nets, p.currency);
    const total = lineNet.subtract(invoiceDiscount);
    const conv = toBase(total, p.rateScaledSnapshot, p.baseCurrency);
    if (!conv.ok) return conv;
    const header = { ...p, lines: undefined } as Omit<typeof p, "lines"> & { lines?: undefined };
    delete (header as { lines?: unknown }).lines;
    const totals: PoTotals = Object.freeze({
      lineGross: Money.sum(lines.map((l) => l.gross), p.currency), lineDiscount: Money.sum(lines.map((l) => l.discountAmount), p.currency),
      lineNet, invoiceDiscount, total, totalBase: conv.value.base,
    });
    return ok(new PurchaseOrder({ header: Object.freeze(header), lines, status: "DRAFT", approval: NO_APPROVAL, totals, closure: null }));
  }

  get poId(): string { return this.s.header.poId; }
  get header(): PurchaseOrderHeader { return this.s.header; }
  get status(): PoStatus { return this.s.status; }
  get lines(): readonly PurchaseOrderLine[] { return this.s.lines; }
  get totals(): PoTotals { return this.s.totals; }
  get approval(): ApprovalInfo { return this.s.approval; }
  get closure(): Closure | null { return this.s.closure; }

  line(lineId: string): PurchaseOrderLine | undefined { return this.s.lines.find((l) => l.lineId === lineId); }
  remainingSsu(lineId: string): Result<bigint> {
    const l = this.line(lineId);
    if (!l) return domainErr("po.line_not_found", "Line not found", { lineId });
    const rest = l.unit.ssuQty - l.receivedSsu;
    return ok(rest > 0n ? rest : 0n);
  }
  canReceive(): boolean { return RECEIVABLE_PO_STATUSES.includes(this.s.status); }

  private transition(to: PoStatus, from: readonly PoStatus[], patch: Partial<PoState> = {}): Result<PurchaseOrder> {
    if (!from.includes(this.s.status)) {
      return domainErr("po.invalid_transition", `Cannot move from ${this.s.status} to ${to}`, { from: this.s.status, to });
    }
    return ok(new PurchaseOrder({ ...this.s, ...patch, status: to }));
  }

  /** FR-PUR-104: approval needed above the user's PO amount or supplier-discount limit. */
  submit(policy: ApprovalPolicy = {}): Result<PurchaseOrder> {
    if (this.s.status !== "DRAFT") return this.transition("PENDING_APPROVAL", ["DRAFT"]);
    const reasons: ApprovalReason[] = [];
    if (policy.maxPoAmount !== undefined) {
      if (policy.maxPoAmount.currency !== this.s.header.baseCurrency) {
        return domainErr("po.limit_currency", "PO amount limit must be in base currency", { currency: policy.maxPoAmount.currency });
      }
      if (this.s.totals.totalBase.gt(policy.maxPoAmount)) reasons.push("PO_AMOUNT_LIMIT");
    }
    const maxBp = policy.maxSupplierDiscountBp;
    if (maxBp !== undefined) {
      const invBp = effectiveBp(this.s.totals.invoiceDiscount, this.s.totals.lineNet);
      if (invBp > maxBp || this.s.lines.some((l) => l.discountBp > maxBp)) reasons.push("DISCOUNT_LIMIT");
    }
    if (reasons.length > 0) {
      return this.transition("PENDING_APPROVAL", ["DRAFT"], { approval: Object.freeze({ ...NO_APPROVAL, required: true, reasons: Object.freeze(reasons) }) });
    }
    return this.transition("POSTED", ["DRAFT"]);
  }

  approve(approvedBy: string, approvedAt: string): Result<PurchaseOrder> {
    if (approvedBy.trim() === "") return domainErr("po.approver_required", "Approver is required");
    return this.transition("POSTED", ["PENDING_APPROVAL"], { approval: Object.freeze({ ...this.s.approval, approvedBy, approvedAt }) });
  }

  /** Partial receipts accumulate; over-receipt allowed up to `toleranceBp` of the ordered SSU. */
  recordReceipt(receipts: readonly ReceiptQty[], toleranceBp = 0): Result<PurchaseOrder> {
    if (!this.canReceive()) return domainErr("po.not_receivable", "Purchase order cannot be received in its current state", { status: this.s.status });
    if (!Number.isSafeInteger(toleranceBp) || toleranceBp < 0) return domainErr("po.invalid_tolerance", "Tolerance must be a non-negative integer (bp)");
    const received = new Map(this.s.lines.map((l) => [l.lineId, l.receivedSsu]));
    for (const r of receipts) {
      const l = this.line(r.lineId);
      if (!l) return domainErr("po.line_not_found", "Line not found", { lineId: r.lineId });
      if (r.qtySsu <= 0n) return domainErr("po.qty_not_positive", "Received quantity must be > 0", { lineId: r.lineId });
      const max = (l.unit.ssuQty * BigInt(FULL_BP + toleranceBp)) / BigInt(FULL_BP);
      const next = (received.get(r.lineId) ?? 0n) + r.qtySsu;
      if (next > max) {
        return domainErr("po.over_receipt", "Received quantity exceeds ordered quantity plus tolerance", {
          lineId: r.lineId, ordered: l.unit.ssuQty.toString(), received: next.toString(), max: max.toString(),
        });
      }
      received.set(r.lineId, next);
    }
    const lines = this.s.lines.map((l) => Object.freeze({ ...l, receivedSsu: received.get(l.lineId) ?? l.receivedSsu }));
    const complete = lines.every((l) => l.receivedSsu >= l.unit.ssuQty);
    return ok(new PurchaseOrder({ ...this.s, lines, status: complete ? "RECEIVED" : "PARTIALLY_RECEIVED" }));
  }

  cancel(): Result<PurchaseOrder> {
    if (this.s.lines.some((l) => l.receivedSsu > 0n)) return domainErr("po.cancel_after_receipt", "A partially received order must be closed, not cancelled");
    return this.transition("CANCELLED", ["DRAFT", "PENDING_APPROVAL", "POSTED"]);
  }

  /** FR-PUR-112: manual close keeps remaining quantities non-receivable. */
  close(reason: string, closedBy: string, closedAt: string): Result<PurchaseOrder> {
    return this.transition("CLOSED", ["POSTED", "PARTIALLY_RECEIVED"], { closure: Object.freeze({ reason, closedBy, closedAt }) });
  }

  reopen(permission: string): Result<PurchaseOrder> {
    if (permission !== PO_REOPEN_PERMISSION) return domainErr("po.permission_required", "Reopening requires permission", { permission: PO_REOPEN_PERMISSION });
    const to: PoStatus = this.s.lines.some((l) => l.receivedSsu > 0n) ? "PARTIALLY_RECEIVED" : "POSTED";
    return this.transition(to, ["CLOSED"], { closure: null });
  }
}

// ------------------------------------------------------------------ reorder suggestion (FR-PUR-101)

export type ReorderReason = "BELOW_REORDER_POINT" | "ABOVE_REORDER_POINT";
export interface ReorderInput {
  readonly itemId: string;
  /** Available stock: expired/quarantined/blocked lots already excluded by the caller. */
  readonly onHandSsu: bigint;
  readonly reorderPointSsu: bigint;
  readonly maxStockSsu?: bigint | undefined;
  /** Average daily sales in milli-SSU (SSU × 1000) — integer, never float. */
  readonly avgDailySalesSsuMilli?: bigint | undefined;
  readonly leadTimeDays?: number | undefined;
}
export interface ReorderSuggestion {
  readonly itemId: string; readonly targetSsu: bigint; readonly suggestedQtySsu: bigint;
  readonly qtyInUnit: bigint; readonly unitId: string; readonly reason: ReorderReason;
}

/** Suggested qty rounded UP to whole default purchase units; stored in SSU. */
export function suggestReorder(input: ReorderInput, unit: Pick<ItemUnit, "unitId" | "factorToSsu">): Result<ReorderSuggestion> {
  if (input.reorderPointSsu < 0n) return domainErr("reorder.negative_point", "Reorder point must be >= 0");
  if (input.maxStockSsu !== undefined && input.maxStockSsu < input.reorderPointSsu) {
    return domainErr("reorder.max_below_point", "Max stock must be >= reorder point");
  }
  if (unit.factorToSsu < 1n) return domainErr("reorder.bad_factor", "Unit factor must be >= 1");
  const lead = input.leadTimeDays ?? 0;
  if (!Number.isSafeInteger(lead) || lead < 0) return domainErr("reorder.bad_lead_time", "Lead time must be a non-negative integer");
  const avg = input.avgDailySalesSsuMilli ?? 0n;
  if (avg < 0n) return domainErr("reorder.negative_sales", "Average daily sales must be >= 0");
  const leadDemand = (avg * BigInt(lead) + 999n) / 1000n;
  const targetSsu = input.maxStockSsu ?? input.reorderPointSsu + leadDemand;
  const base = { itemId: input.itemId, targetSsu, unitId: unit.unitId };
  if (input.onHandSsu >= input.reorderPointSsu) {
    return ok(Object.freeze({ ...base, suggestedQtySsu: 0n, qtyInUnit: 0n, reason: "ABOVE_REORDER_POINT" }));
  }
  const need = targetSsu - input.onHandSsu;
  const qtyInUnit = (need + unit.factorToSsu - 1n) / unit.factorToSsu;
  return ok(Object.freeze({ ...base, suggestedQtySsu: qtyInUnit * unit.factorToSsu, qtyInUnit, reason: "BELOW_REORDER_POINT" }));
}
