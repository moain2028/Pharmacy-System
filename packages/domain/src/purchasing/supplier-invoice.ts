/**
 * Supplier invoice aggregate (FR-PUR-109, 110, 114, 115; FR-SUP-102, 104).
 * Lines reference GRN lines for the PO-GRN-invoice match with qty/price tolerances in bp.
 * Pipeline: gross -> supplier line discount -> share of invoice discount -> tax -> base currency at
 * the frozen rate (one conversion of net and total; line bases allocated by largest remainder).
 * post() returns the posting intent only: GRNI Dr (clears the GRN accrual), price variance Dr/Cr,
 * direct-purchase Dr for unmatched lines, input tax Dr, AP Cr with the foreign snapshot.
 */
import type { CurrencyCode } from "../money/currency.js";
import { Money } from "../money/money.js";
import { domainErr, ok, type Result } from "../shared/result.js";
import { daysBetween, isIsoDate, type IsoDate } from "../inventory/iso-date.js";
import {
  reverseJournalEntry, type JournalEntry, type JournalLineInput, type LineDimensions, type ReversalRequest,
} from "../accounting/journal-entry.js";
import { postEntry, toBase } from "../accounting/posting-common.js";
import { distributeInvoiceDiscount, FULL_BP, type DiscountValue } from "../pricing/discount.js";
import { computeLineAmounts, invoiceDiscountOf, type SupplierStatus } from "./purchase-order.js";

export const SUPPLIER_INVOICE_STATUSES = ["DRAFT", "POSTED", "REVERSED"] as const;
export type SupplierInvoiceStatus = (typeof SUPPLIER_INVOICE_STATUSES)[number];
export const MATCH_STATUSES = ["MATCHED", "PRICE_VARIANCE", "QTY_VARIANCE", "OVER_TOLERANCE", "UNMATCHED"] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];
export const MATCH_OVERRIDE_PERMISSION = "purchase.match_override" as const;
export const SUPPLIER_INVOICE_DOC_TYPE = "SUPPLIER_INVOICE" as const;

const RANK: Readonly<Record<MatchStatus, number>> = Object.freeze({
  MATCHED: 0, PRICE_VARIANCE: 1, QTY_VARIANCE: 2, UNMATCHED: 3, OVER_TOLERANCE: 4,
});
const DAY_MS = 86_400_000;

/** Price reference: cost per unit with `factor` SSU per unit, invoice currency. */
export interface PriceRef { readonly factor: bigint; readonly unitCost: Money }
export interface GrnLineRef extends PriceRef {
  readonly grnId: string;
  readonly grnLineId: string;
  readonly itemId: string;
  readonly receivedSsu: bigint;
  /** GRNI accrued for this GRN line (base currency). */
  readonly grniBase: Money;
  /** Ordered price of the linked PO line; when present prices are matched against it. */
  readonly po?: PriceRef | undefined;
}
export interface SupplierInvoiceLineInput {
  readonly lineId: string;
  readonly itemId: string;
  readonly grnLineId?: string | undefined;
  readonly qtyInUnit: bigint;
  readonly factor: bigint;
  readonly unitCost: Money;
  readonly discount?: DiscountValue | undefined;
}
export interface InvoiceEarlyPaymentTerms { readonly days: number; readonly bp: number }
export interface SupplierInvoiceHeader {
  readonly invoiceId: string;
  readonly supplierInvoiceNo: string;
  readonly tenantId: string;
  readonly supplierId: string;
  readonly supplierStatus: SupplierStatus;
  readonly invoiceDate: IsoDate;
  readonly currency: CurrencyCode;
  readonly baseCurrency: CurrencyCode;
  readonly rateScaledSnapshot?: bigint | undefined;
  readonly invoiceDiscount?: DiscountValue | undefined;
  readonly taxBp?: number | undefined;
  readonly paymentTermsDays?: number | undefined;
  readonly earlyPayment?: InvoiceEarlyPaymentTerms | undefined;
  readonly toleranceQtyBp: number;
  readonly tolerancePriceBp: number;
  readonly unmatchedReason?: string | undefined;
}
export interface SupplierInvoiceProps extends SupplierInvoiceHeader {
  readonly lines: readonly SupplierInvoiceLineInput[];
  readonly grnLines: readonly GrnLineRef[];
}
export interface LineMatch {
  readonly status: MatchStatus;
  readonly qtyVarianceBp: number;
  readonly priceVarianceBp: number;
  readonly ref: GrnLineRef | null;
}
export interface SupplierInvoiceLine {
  readonly lineId: string; readonly itemId: string; readonly qtySsu: bigint; readonly factor: bigint;
  readonly unitCost: Money; readonly gross: Money; readonly discount: Money; readonly net: Money;
  readonly match: LineMatch;
}
export interface SupplierInvoiceTotals {
  readonly lineGross: Money; readonly lineDiscount: Money; readonly invoiceDiscount: Money;
  readonly net: Money; readonly tax: Money; readonly total: Money;
  readonly netBase: Money; readonly taxBase: Money; readonly totalBase: Money;
  /** Per line, after the invoice discount share (invoice currency / base currency). */
  readonly lineNets: readonly Money[];
  readonly lineNetsBase: readonly Money[];
}
export interface SupplierInvoiceAccounts {
  readonly ap: string; readonly grni: string; readonly priceVariance: string; readonly tax: string; readonly direct: string;
}
export interface MatchOverride { readonly permission: string; readonly approvedBy: string; readonly reason: string }
export interface PostSupplierInvoiceOptions {
  readonly entryId: string;
  readonly postedAt: Date;
  readonly accounts: SupplierInvoiceAccounts;
  readonly override?: MatchOverride | undefined;
}
export interface PriceVariance {
  readonly lineId: string; readonly grnId: string; readonly grnLineId: string; readonly itemId: string;
  readonly invoicedBase: Money; readonly grniClearedBase: Money; readonly varianceBase: Money;
}
export interface PostedSupplierInvoice {
  readonly invoice: SupplierInvoice;
  readonly entry: JournalEntry;
  readonly priceVariances: readonly PriceVariance[];
  readonly override: MatchOverride | null;
}

const isNonNegInt = (x: number, max = Number.MAX_SAFE_INTEGER): boolean => Number.isSafeInteger(x) && x >= 0 && x <= max;
const blank = (s: string | undefined): boolean => (s ?? "").trim() === "";

export function addDaysIso(date: IsoDate, days: number): IsoDate {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** |actual − expected| / expected in bp, rounded UP. expected > 0. */
export function varianceBp(actual: bigint, expected: bigint): number {
  const diff = actual > expected ? actual - expected : expected - actual;
  return Number((diff * BigInt(FULL_BP) + expected - 1n) / expected);
}

function checkHeader(p: SupplierInvoiceProps): Result<null> {
  const bad = (field: string) => domainErr("supinv.invalid_header", `Invalid supplier invoice field: ${field}`, { field });
  if (p.lines.length === 0) return domainErr("supinv.no_lines", "A supplier invoice needs at least one line");
  if (p.supplierStatus === "BLOCKED") return domainErr("supinv.supplier_blocked", "Supplier is blocked", { supplierId: p.supplierId });
  if (blank(p.supplierInvoiceNo)) return bad("supplierInvoiceNo");
  if (!isIsoDate(p.invoiceDate)) return bad("invoiceDate");
  if (p.currency !== p.baseCurrency && (p.rateScaledSnapshot === undefined || p.rateScaledSnapshot <= 0n)) {
    return domainErr("supinv.rate_required", "A positive rate to base currency is required for foreign-currency invoices");
  }
  if (!isNonNegInt(p.toleranceQtyBp)) return bad("toleranceQtyBp");
  if (!isNonNegInt(p.tolerancePriceBp)) return bad("tolerancePriceBp");
  if (!isNonNegInt(p.taxBp ?? 0, FULL_BP)) return bad("taxBp");
  if (!isNonNegInt(p.paymentTermsDays ?? 0)) return bad("paymentTermsDays");
  const ep = p.earlyPayment;
  if (ep && (!isNonNegInt(ep.days) || !isNonNegInt(ep.bp, FULL_BP))) return bad("earlyPayment");
  return ok(null);
}

function checkRef(r: GrnLineRef, itemId: string, p: SupplierInvoiceProps): Result<null> {
  if (r.itemId !== itemId) return domainErr("supinv.ref_item_mismatch", "GRN line belongs to another item", { grnLineId: r.grnLineId });
  const prices: PriceRef[] = r.po ? [r, r.po] : [r];
  const badPrice = prices.some((x) => x.factor < 1n || !x.unitCost.isPositive() || x.unitCost.currency !== p.currency);
  if (r.receivedSsu <= 0n || badPrice || r.grniBase.currency !== p.baseCurrency || r.grniBase.isNegative()) {
    return domainErr("supinv.invalid_ref", "GRN/PO reference is invalid or in another currency", { grnLineId: r.grnLineId });
  }
  return ok(null);
}

function matchLine(qtySsu: bigint, l: SupplierInvoiceLineInput, ref: GrnLineRef | null, p: SupplierInvoiceProps): LineMatch {
  if (ref === null) return Object.freeze({ status: "UNMATCHED", qtyVarianceBp: 0, priceVarianceBp: 0, ref: null });
  const qtyVarianceBp = varianceBp(qtySsu, ref.receivedSsu);
  const pr: PriceRef = ref.po ?? ref;
  const priceVarianceBp = varianceBp(l.unitCost.amountMinor * pr.factor, pr.unitCost.amountMinor * l.factor);
  const status: MatchStatus =
    qtyVarianceBp > p.toleranceQtyBp || priceVarianceBp > p.tolerancePriceBp ? "OVER_TOLERANCE"
      : qtyVarianceBp > 0 ? "QTY_VARIANCE" : priceVarianceBp > 0 ? "PRICE_VARIANCE" : "MATCHED";
  return Object.freeze({ status, qtyVarianceBp, priceVarianceBp, ref });
}

function buildLine(
  l: SupplierInvoiceLineInput, p: SupplierInvoiceProps, refs: ReadonlyMap<string, GrnLineRef>, used: Set<string>,
): Result<SupplierInvoiceLine> {
  const ctx = { lineId: l.lineId };
  if (l.unitCost.currency !== p.currency) return domainErr("supinv.currency_mismatch", "Line cost currency differs from the invoice currency", ctx);
  if (l.factor < 1n) return domainErr("supinv.invalid_line", "Unit factor must be >= 1", ctx);
  let ref: GrnLineRef | null = null;
  if (l.grnLineId !== undefined) {
    const found = refs.get(l.grnLineId);
    if (!found) return domainErr("supinv.grn_line_not_found", "Referenced GRN line not supplied", { ...ctx, grnLineId: l.grnLineId });
    if (used.has(l.grnLineId)) return domainErr("supinv.duplicate_grn_line", "A GRN line may be referenced once per invoice", ctx);
    used.add(l.grnLineId);
    const c = checkRef(found, l.itemId, p);
    if (!c.ok) return c;
    ref = found;
  }
  const a = computeLineAmounts(l.unitCost, l.qtyInUnit, l.discount ?? null);
  if (!a.ok) return a;
  const qtySsu = l.qtyInUnit * l.factor;
  return ok(Object.freeze({
    lineId: l.lineId, itemId: l.itemId, qtySsu, factor: l.factor, unitCost: l.unitCost,
    gross: a.value.gross, discount: a.value.discount, net: a.value.net, match: matchLine(qtySsu, l, ref, p),
  }));
}

function computeTotals(lines: readonly SupplierInvoiceLine[], p: SupplierInvoiceProps): Result<SupplierInvoiceTotals> {
  const cur = p.currency;
  const nets = lines.map((l) => l.net);
  let lineNets = nets;
  let invoiceDiscount = Money.zero(cur);
  if (p.invoiceDiscount) {
    const d = distributeInvoiceDiscount(nets, invoiceDiscountOf(p.invoiceDiscount));
    if (!d.ok) return d;
    invoiceDiscount = d.value.total;
    lineNets = nets.map((n, i) => n.subtract(d.value.allocations[i] as Money));
  }
  const net = Money.sum(lineNets, cur);
  const tax = net.percent(p.taxBp ?? 0);
  const total = net.add(tax);
  const rate = cur === p.baseCurrency ? undefined : p.rateScaledSnapshot;
  const nb = toBase(net, rate, p.baseCurrency);
  if (!nb.ok) return nb;
  const tb = toBase(total, rate, p.baseCurrency);
  if (!tb.ok) return tb;
  const netBase = nb.value.base;
  const totalBase = tb.value.base;
  const lineNetsBase = netBase.isZero()
    ? lineNets.map(() => Money.zero(p.baseCurrency))
    : netBase.allocate(lineNets.map((n) => Number(n.amountMinor)));
  return ok(Object.freeze({
    lineGross: Money.sum(lines.map((l) => l.gross), cur), lineDiscount: Money.sum(lines.map((l) => l.discount), cur),
    invoiceDiscount, net, tax, total, netBase, taxBase: totalBase.subtract(netBase), totalBase,
    lineNets: Object.freeze(lineNets), lineNetsBase: Object.freeze(lineNetsBase),
  }));
}

/** Debit when positive, credit when negative, nothing when zero. */
function signedLine(accountCode: string, amount: Money, memo: string, dimensions: LineDimensions): JournalLineInput[] {
  if (amount.isZero()) return [];
  return [amount.isPositive() ? { accountCode, debit: amount, memo, dimensions } : { accountCode, credit: amount.negate(), memo, dimensions }];
}

interface State {
  readonly header: SupplierInvoiceHeader;
  readonly lines: readonly SupplierInvoiceLine[];
  readonly matchStatus: MatchStatus;
  readonly totals: SupplierInvoiceTotals;
  readonly status: SupplierInvoiceStatus;
  readonly entryId: string | null;
  readonly dueDate: IsoDate;
}

export class SupplierInvoice {
  private readonly s: State;
  private constructor(s: State) {
    this.s = Object.freeze({ ...s, lines: Object.freeze([...s.lines]) });
    Object.freeze(this);
  }

  static create(p: SupplierInvoiceProps): Result<SupplierInvoice> {
    const h = checkHeader(p);
    if (!h.ok) return h;
    const refs = new Map(p.grnLines.map((r) => [r.grnLineId, r] as const));
    const ids = new Set<string>();
    const used = new Set<string>();
    const lines: SupplierInvoiceLine[] = [];
    for (const l of p.lines) {
      if (ids.has(l.lineId)) return domainErr("supinv.duplicate_line", "Duplicate line id", { lineId: l.lineId });
      ids.add(l.lineId);
      const r = buildLine(l, p, refs, used);
      if (!r.ok) return r;
      lines.push(r.value);
    }
    if (lines.some((l) => l.match.status === "UNMATCHED") && blank(p.unmatchedReason)) {
      return domainErr("supinv.unmatched_reason_required", "Unmatched invoice lines need a recorded reason");
    }
    const t = computeTotals(lines, p);
    if (!t.ok) return t;
    const matchStatus = lines.reduce<MatchStatus>((w, l) => (RANK[l.match.status] > RANK[w] ? l.match.status : w), "MATCHED");
    const { lines: _lines, grnLines: _grn, ...header } = p;
    void _lines;
    void _grn;
    return ok(new SupplierInvoice({
      header: Object.freeze(header), lines, matchStatus, totals: t.value, status: "DRAFT", entryId: null,
      dueDate: addDaysIso(p.invoiceDate, p.paymentTermsDays ?? 0),
    }));
  }

  get invoiceId(): string { return this.s.header.invoiceId; }
  get header(): SupplierInvoiceHeader { return this.s.header; }
  get lines(): readonly SupplierInvoiceLine[] { return this.s.lines; }
  get status(): SupplierInvoiceStatus { return this.s.status; }
  get matchStatus(): MatchStatus { return this.s.matchStatus; }
  get totals(): SupplierInvoiceTotals { return this.s.totals; }
  get entryId(): string | null { return this.s.entryId; }
  get dueDate(): IsoDate { return this.s.dueDate; }
  get earlyPaymentDeadline(): IsoDate | null {
    const ep = this.s.header.earlyPayment;
    return ep ? addDaysIso(this.s.header.invoiceDate, ep.days) : null;
  }

  /** FR-SUP-104: suggested cash discount (invoice currency) when paid within the window. */
  earlyPaymentDiscount(paidOn: IsoDate): Money {
    const ep = this.s.header.earlyPayment;
    const days = daysBetween(this.s.header.invoiceDate, paidOn);
    if (!ep || days < 0 || days > ep.days) return Money.zero(this.s.header.currency);
    return this.s.totals.total.percent(ep.bp);
  }

  post(opts: PostSupplierInvoiceOptions): Result<PostedSupplierInvoice> {
    const h = this.s.header;
    if (this.s.status !== "DRAFT") return domainErr("supinv.not_draft", "Only a draft invoice can be posted", { status: this.s.status });
    let override: MatchOverride | null = null;
    if (this.s.matchStatus === "OVER_TOLERANCE") {
      const o = opts.override;
      if (!o || o.permission !== MATCH_OVERRIDE_PERMISSION || blank(o.approvedBy) || blank(o.reason)) {
        return domainErr("supinv.over_tolerance", "Invoice exceeds match tolerance; override permission required", {
          permission: MATCH_OVERRIDE_PERMISSION,
        });
      }
      override = o;
    }
    const memo = `Supplier invoice ${h.supplierInvoiceNo}`;
    const a = opts.accounts;
    const jl: JournalLineInput[] = [];
    const priceVariances: PriceVariance[] = [];
    this.s.lines.forEach((l, i) => {
      const base = this.s.totals.lineNetsBase[i] as Money;
      const dims: LineDimensions = { supplierId: h.supplierId, itemId: l.itemId };
      const ref = l.match.ref;
      if (ref === null) {
        jl.push(...signedLine(a.direct, base, `Direct purchase ${memo}`, dims));
        return;
      }
      const cleared = l.qtySsu >= ref.receivedSsu ? ref.grniBase : ref.grniBase.multiply(l.qtySsu).divide(ref.receivedSsu);
      const variance = base.subtract(cleared);
      jl.push(...signedLine(a.grni, cleared, `GRNI clear ${memo}`, dims));
      jl.push(...signedLine(a.priceVariance, variance, `Price variance ${memo}`, dims));
      if (!variance.isZero()) {
        priceVariances.push(Object.freeze({
          lineId: l.lineId, grnId: ref.grnId, grnLineId: ref.grnLineId, itemId: l.itemId,
          invoicedBase: base, grniClearedBase: cleared, varianceBase: variance,
        }));
      }
    });
    jl.push(...signedLine(a.tax, this.s.totals.taxBase, `Input tax ${memo}`, { supplierId: h.supplierId }));
    const foreign = h.currency === h.baseCurrency || h.rateScaledSnapshot === undefined
      ? null
      : { amount: this.s.totals.total, rateScaledSnapshot: h.rateScaledSnapshot };
    jl.push({ accountCode: a.ap, credit: this.s.totals.totalBase, memo: `AP ${memo}`, dimensions: { supplierId: h.supplierId }, foreign });
    const entry = postEntry(
      { entryId: opts.entryId, tenantId: h.tenantId, postedAt: opts.postedAt, baseCurrency: h.baseCurrency },
      { type: SUPPLIER_INVOICE_DOC_TYPE, id: h.invoiceId },
      jl,
      memo,
    );
    if (!entry.ok) return entry;
    return ok(Object.freeze({
      invoice: new SupplierInvoice({ ...this.s, status: "POSTED", entryId: opts.entryId }),
      entry: entry.value, priceVariances: Object.freeze(priceVariances), override,
    }));
  }

  /** B5: correction by reversal entry; the posted invoice becomes REVERSED. */
  reverse(entry: JournalEntry, req: ReversalRequest): Result<{ readonly invoice: SupplierInvoice; readonly entry: JournalEntry }> {
    if (this.s.status !== "POSTED" || entry.entryId !== this.s.entryId) {
      return domainErr("supinv.not_posted", "Only a posted invoice can be reversed with its own entry", { status: this.s.status });
    }
    const r = reverseJournalEntry(entry, req);
    if (!r.ok) return r;
    return ok(Object.freeze({ invoice: new SupplierInvoice({ ...this.s, status: "REVERSED" }), entry: r.value }));
  }
}
