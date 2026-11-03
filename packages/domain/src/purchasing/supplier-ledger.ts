/**
 * Supplier open-item ledger (FR-SUP-102, 103, 104, 106, 107).
 * Pure functions over the open items of one supplier. Amounts are Money in the item's currency;
 * items are grouped per currency and never summed across currencies (YER_OLD ≠ YER_NEW).
 * Half-Up everywhere (D-028); pro-rata splits use Money.allocate (largest remainder, A5).
 * INVOICE.remaining = unpaid; CREDIT_NOTE/PAYMENT.remaining = unapplied credit (advance).
 */
import type { CurrencyCode } from "../money/currency.js";
import { Money } from "../money/money.js";
import { domainErr, ok, type Result } from "../shared/result.js";
import { compareIsoDate, daysBetween, endOfMonth, isIsoDate, isoDateFromDate, type IsoDate } from "../inventory/iso-date.js";
import { FULL_BP } from "../pricing/discount.js";

export const OPEN_ITEM_KINDS = ["INVOICE", "CREDIT_NOTE", "PAYMENT"] as const;
export type OpenItemKind = (typeof OPEN_ITEM_KINDS)[number];
export const PAYMENT_TERM_TYPES = ["CASH", "NET_DAYS", "END_OF_MONTH"] as const;
export type PaymentTermType = (typeof PAYMENT_TERM_TYPES)[number];
export const ALLOCATION_STRATEGIES = ["FIFO", "PRO_RATA", "EXPLICIT"] as const;
export type AllocationStrategyMode = (typeof ALLOCATION_STRATEGIES)[number];

export interface OpenItem {
  readonly id: string;
  readonly kind: OpenItemKind;
  readonly date: IsoDate;
  readonly dueDate?: IsoDate | undefined;
  readonly amount: Money;
  readonly remaining: Money;
}
export interface PaymentTerms { readonly type: PaymentTermType; readonly netDays?: number | undefined }
/** FR-SUP-104: `discountBp` off the open amount when paid within `withinDays` of the invoice date. */
export interface EarlyPaymentTerms { readonly discountBp: number; readonly withinDays: number }
export interface PaymentInput { readonly id: string; readonly amount: Money; readonly date: IsoDate }
export interface ExplicitTarget { readonly itemId: string; readonly amount: Money }
export type AllocationStrategy =
  | { readonly mode: "FIFO" }
  | { readonly mode: "PRO_RATA" }
  | { readonly mode: "EXPLICIT"; readonly targets: readonly ExplicitTarget[] };
export interface ItemAllocation { readonly itemId: string; readonly applied: Money; readonly discount: Money; readonly settled: boolean }
export interface PaymentAllocation {
  readonly allocations: readonly ItemAllocation[];
  readonly allocatedTotal: Money;
  readonly discountTotal: Money;
  /** Advance left on the payment (FR-SUP-103). */
  readonly unallocated: Money;
  /** Input items with updated `remaining` plus the payment itself as a PAYMENT open item. */
  readonly items: readonly OpenItem[];
}
export interface AgingBuckets { readonly b1: number; readonly b2: number; readonly b3: number }
export const DEFAULT_AGING_BUCKETS: AgingBuckets = Object.freeze({ b1: 30, b2: 60, b3: 90 });
export interface AgingRow {
  readonly currency: CurrencyCode; readonly current: Money; readonly bucket1: Money; readonly bucket2: Money;
  readonly bucket3: Money; readonly over: Money; readonly credits: Money; readonly net: Money;
}
export interface CurrencyBalance { readonly currency: CurrencyCode; readonly payable: Money; readonly credits: Money; readonly net: Money }

// ------------------------------------------------------------------ validation

export function validateOpenItem(it: OpenItem): Result<OpenItem> {
  const ctx = { itemId: it.id };
  if (!(OPEN_ITEM_KINDS as readonly string[]).includes(it.kind)) return domainErr("ledger.invalid_kind", "Unknown open item kind", ctx);
  if (!isIsoDate(it.date) || (it.dueDate !== undefined && !isIsoDate(it.dueDate))) return domainErr("ledger.invalid_date", "Dates must be ISO YYYY-MM-DD", ctx);
  if (it.amount.currency !== it.remaining.currency) return domainErr("ledger.currency_mismatch", "amount and remaining must share one currency", ctx);
  if (it.amount.isNegative() || it.remaining.isNegative() || it.remaining.gt(it.amount)) {
    return domainErr("ledger.invalid_remaining", "remaining must be within 0..amount", ctx);
  }
  return ok(it);
}

function validateAll(items: readonly OpenItem[]): Result<readonly OpenItem[]> {
  const ids = new Set<string>();
  for (const it of items) {
    if (ids.has(it.id)) return domainErr("ledger.duplicate_id", "Duplicate open item id", { itemId: it.id });
    ids.add(it.id);
    const r = validateOpenItem(it);
    if (!r.ok) return r;
  }
  return ok(items);
}

// ------------------------------------------------------------------ due dates (FR-SUP-102)

export function addDays(date: IsoDate, days: number): IsoDate {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return isoDateFromDate(new Date(Date.UTC(y, m - 1, d + days)));
}

export function dueDateFor(invoiceDate: IsoDate, terms: PaymentTerms): Result<IsoDate> {
  if (!isIsoDate(invoiceDate)) return domainErr("ledger.invalid_date", "Invoice date must be ISO YYYY-MM-DD");
  if (!(PAYMENT_TERM_TYPES as readonly string[]).includes(terms.type)) return domainErr("ledger.invalid_terms", "Unknown payment term type", { type: terms.type });
  if (terms.type === "CASH") return ok(invoiceDate);
  if (terms.type === "NET_DAYS") {
    const n = terms.netDays;
    if (n === undefined || !Number.isSafeInteger(n) || n < 0) return domainErr("ledger.invalid_net_days", "netDays must be a non-negative integer");
    return ok(addDays(invoiceDate, n));
  }
  const [y, m] = invoiceDate.split("-").map(Number) as [number, number];
  return endOfMonth(y, m);
}

// ------------------------------------------------------------------ payment allocation (FR-SUP-103/104)

const validTerms = (t: EarlyPaymentTerms): boolean =>
  Number.isSafeInteger(t.discountBp) && t.discountBp >= 0 && t.discountBp <= FULL_BP && Number.isSafeInteger(t.withinDays) && t.withinDays >= 0;

const dueOf = (i: OpenItem): IsoDate => i.dueDate ?? i.date;
const fifoOrder = (a: OpenItem, b: OpenItem): number => compareIsoDate(dueOf(a), dueOf(b)) || a.id.localeCompare(b.id);

/** Early-payment discount on the open amount, Half-Up; zero outside the window. */
function discountFor(inv: OpenItem, payDate: IsoDate, terms: EarlyPaymentTerms | undefined): Money {
  if (terms === undefined) return Money.zero(inv.remaining.currency);
  const age = daysBetween(inv.date, payDate);
  if (age < 0 || age > terms.withinDays) return Money.zero(inv.remaining.currency);
  return inv.remaining.percent(terms.discountBp);
}

/**
 * FIFO: oldest due date first. PRO_RATA: proportional to remaining (no discount). EXPLICIT: given
 * cash amounts per invoice. The cash discount is taken only when the cash settles the invoice in
 * full within the window; any excess cash stays unallocated as an advance.
 */
export function allocatePayment(
  items: readonly OpenItem[],
  payment: PaymentInput,
  strategy: AllocationStrategy,
  terms?: EarlyPaymentTerms,
): Result<PaymentAllocation> {
  const v = validateAll(items);
  if (!v.ok) return v;
  if (!isIsoDate(payment.date)) return domainErr("ledger.invalid_date", "Payment date must be ISO YYYY-MM-DD");
  if (!payment.amount.isPositive()) return domainErr("ledger.payment_not_positive", "Payment amount must be > 0");
  if (items.some((i) => i.id === payment.id)) return domainErr("ledger.duplicate_id", "Payment id already exists in the ledger", { itemId: payment.id });
  if (terms !== undefined && !validTerms(terms)) return domainErr("ledger.invalid_terms", "Early payment terms must be integers: 0..10000 bp, days >= 0");
  const cur = payment.amount.currency;
  const open = items.filter((i) => i.kind === "INVOICE" && i.remaining.isPositive() && i.remaining.currency === cur);
  const allocs: ItemAllocation[] = [];
  let available = payment.amount;
  const take = (inv: OpenItem, cash: Money, discountable: boolean): void => {
    const d = discountable ? discountFor(inv, payment.date, terms) : Money.zero(cur);
    const needed = inv.remaining.subtract(d);
    const a: ItemAllocation = cash.gte(needed)
      ? { itemId: inv.id, applied: needed, discount: d, settled: true }
      : { itemId: inv.id, applied: cash, discount: Money.zero(cur), settled: false };
    if (a.applied.isZero() && a.discount.isZero()) return;
    available = available.subtract(a.applied);
    allocs.push(Object.freeze(a));
  };
  if (strategy.mode === "FIFO") {
    for (const inv of [...open].sort(fifoOrder)) {
      if (!available.isPositive()) break;
      take(inv, available, true);
    }
  } else if (strategy.mode === "PRO_RATA") {
    const total = Money.sum(open.map((i) => i.remaining), cur);
    if (payment.amount.gte(total)) {
      for (const inv of open) take(inv, inv.remaining, false);
    } else {
      const ratios = open.map((i) => Number(i.remaining.amountMinor));
      if (ratios.some((x) => !Number.isSafeInteger(x))) return domainErr("ledger.amount_too_large", "Open amounts too large to split safely");
      payment.amount.allocate(ratios).forEach((part, i) => take(open[i] as OpenItem, part, false));
    }
  } else {
    const seen = new Set<string>();
    for (const t of strategy.targets) {
      if (seen.has(t.itemId)) return domainErr("ledger.duplicate_target", "Invoice targeted twice", { itemId: t.itemId });
      seen.add(t.itemId);
      const inv = open.find((i) => i.id === t.itemId);
      if (inv === undefined) return domainErr("ledger.target_not_open", "Target is not an open invoice in the payment currency", { itemId: t.itemId });
      if (t.amount.currency !== cur || !t.amount.isPositive()) return domainErr("ledger.invalid_target_amount", "Target amount must be > 0 in the payment currency", { itemId: t.itemId });
      if (t.amount.gt(inv.remaining)) {
        return domainErr("ledger.over_allocation", "Allocation exceeds the open amount", { itemId: t.itemId, remaining: inv.remaining.toDecimalString() });
      }
      take(inv, t.amount, true);
    }
    if (available.isNegative()) return domainErr("ledger.allocation_exceeds_payment", "Allocations exceed the payment amount", { payment: payment.amount.toDecimalString() });
  }
  const byId = new Map(allocs.map((a) => [a.itemId, a] as const));
  const updated = items.map((it) => {
    const a = byId.get(it.id);
    return a === undefined ? it : Object.freeze({ ...it, remaining: it.remaining.subtract(a.applied).subtract(a.discount) });
  });
  const paymentItem: OpenItem = Object.freeze({ id: payment.id, kind: "PAYMENT", date: payment.date, amount: payment.amount, remaining: available });
  return ok(Object.freeze({
    allocations: Object.freeze(allocs),
    allocatedTotal: Money.sum(allocs.map((a) => a.applied), cur),
    discountTotal: Money.sum(allocs.map((a) => a.discount), cur),
    unallocated: available,
    items: Object.freeze([...updated, paymentItem]),
  }));
}

// ------------------------------------------------------------------ aging & balance (FR-SUP-106/107)

type BucketKey = "current" | "bucket1" | "bucket2" | "bucket3" | "over";
interface Acc { readonly buckets: Record<BucketKey, Money>; payable: Money; credits: Money }

function accumulate(items: readonly OpenItem[], classify: (i: OpenItem) => BucketKey): Map<CurrencyCode, Acc> {
  const out = new Map<CurrencyCode, Acc>();
  for (const it of items) {
    const cur = it.amount.currency;
    const z = Money.zero(cur);
    const acc = out.get(cur) ?? { buckets: { current: z, bucket1: z, bucket2: z, bucket3: z, over: z }, payable: z, credits: z };
    if (it.kind === "INVOICE") {
      const k = classify(it);
      acc.buckets[k] = acc.buckets[k].add(it.remaining);
      acc.payable = acc.payable.add(it.remaining);
    } else {
      acc.credits = acc.credits.add(it.remaining);
    }
    out.set(cur, acc);
  }
  return out;
}

const sortedEntries = (m: Map<CurrencyCode, Acc>): [CurrencyCode, Acc][] => [...m].sort(([a], [b]) => a.localeCompare(b));

/** Unpaid invoices by days past due (not yet due → current); credits/advances shown separately. */
export function aging(items: readonly OpenItem[], asOf: IsoDate, buckets: AgingBuckets = DEFAULT_AGING_BUCKETS): Result<readonly AgingRow[]> {
  const v = validateAll(items);
  if (!v.ok) return v;
  if (!isIsoDate(asOf)) return domainErr("ledger.invalid_date", "asOf must be ISO YYYY-MM-DD");
  const { b1, b2, b3 } = buckets;
  if (![b1, b2, b3].every(Number.isSafeInteger) || !(b1 > 0 && b1 < b2 && b2 < b3)) {
    return domainErr("ledger.invalid_buckets", "Aging buckets must be increasing positive integers", { b1, b2, b3 });
  }
  const classify = (i: OpenItem): BucketKey => {
    const overdue = daysBetween(dueOf(i), asOf);
    return overdue <= 0 ? "current" : overdue <= b1 ? "bucket1" : overdue <= b2 ? "bucket2" : overdue <= b3 ? "bucket3" : "over";
  };
  return ok(Object.freeze(sortedEntries(accumulate(items, classify)).map(([currency, a]) =>
    Object.freeze({ currency, ...a.buckets, credits: a.credits, net: a.payable.subtract(a.credits) }))));
}

/** Net payable per currency: Σ invoice remaining − Σ unapplied credits/advances. */
export function balance(items: readonly OpenItem[]): Result<readonly CurrencyBalance[]> {
  const v = validateAll(items);
  if (!v.ok) return v;
  return ok(Object.freeze(sortedEntries(accumulate(items, () => "current")).map(([currency, a]) =>
    Object.freeze({ currency, payable: a.payable, credits: a.credits, net: a.payable.subtract(a.credits) }))));
}
