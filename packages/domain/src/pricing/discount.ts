/**
 * Discounts (FR-PRC-116..119, D-028).
 * Canonical line order: PROMO -> NEAR_EXPIRY -> CUSTOMER_GROUP -> manual (LINE_PERCENT | LINE_AMOUNT).
 * Each percentage applies to the running amount after previous steps: round_half_up(amount x bp / 10000).
 * Invoice discounts are distributed over line nets with the largest-remainder method (Money.allocate).
 */
import type { CurrencyCode } from "../money/currency.js";
import { Money, type BasisPoints } from "../money/money.js";
import { domainErr, ok, type Result } from "../shared/result.js";

export const DISCOUNT_TYPES = [
  "LINE_PERCENT",
  "LINE_AMOUNT",
  "INVOICE_PERCENT",
  "INVOICE_AMOUNT",
  "PROMO",
  "NEAR_EXPIRY",
  "CUSTOMER_GROUP",
] as const;
export type DiscountType = (typeof DISCOUNT_TYPES)[number];

/** 100 % in basis points. */
export const FULL_BP = 10_000;

export interface DiscountMeta {
  /** Origin identifier: promo id, customer-group id, "manual", ... */
  readonly source: string;
  /** Supervisor who approved a discount beyond the user's limits (FR-PRC-118). */
  readonly approvedBy?: string;
}

export type DiscountValue =
  | { readonly mode: "PERCENT"; readonly bp: BasisPoints }
  | { readonly mode: "AMOUNT"; readonly amount: Money };

export interface LinePercentDiscount extends DiscountMeta { readonly type: "LINE_PERCENT"; readonly bp: BasisPoints }
export interface LineAmountDiscount extends DiscountMeta { readonly type: "LINE_AMOUNT"; readonly amount: Money }
export interface InvoicePercentDiscount extends DiscountMeta { readonly type: "INVOICE_PERCENT"; readonly bp: BasisPoints }
export interface InvoiceAmountDiscount extends DiscountMeta { readonly type: "INVOICE_AMOUNT"; readonly amount: Money }
export interface PromoDiscount extends DiscountMeta {
  readonly type: "PROMO";
  readonly value: DiscountValue;
  /** When true the customer-group discount is not applied on this line (FR-PRC-117 step 3). */
  readonly blocksCustomerGroup?: boolean;
}
export interface NearExpiryDiscount extends DiscountMeta { readonly type: "NEAR_EXPIRY"; readonly value: DiscountValue }
export interface CustomerGroupDiscount extends DiscountMeta { readonly type: "CUSTOMER_GROUP"; readonly bp: BasisPoints }

export type LineDiscount = LinePercentDiscount | LineAmountDiscount | PromoDiscount | NearExpiryDiscount | CustomerGroupDiscount;
export type InvoiceDiscount = InvoicePercentDiscount | InvoiceAmountDiscount;
export type Discount = LineDiscount | InvoiceDiscount;

export interface AppliedDiscount {
  readonly type: DiscountType;
  readonly source: string;
  readonly amount: Money;
  readonly approvedBy?: string;
}

export type DiscountBreakdown = Readonly<Record<DiscountType, Money>>;

/** Max manual discount in bp; the effective line limit is the minimum of the defined ones. */
export interface DiscountLimits {
  readonly userMaxLineBp?: number;
  readonly itemMaxLineBp?: number;
  readonly categoryMaxLineBp?: number;
  readonly userMaxInvoiceBp?: number;
}

export interface LineDiscountResult {
  readonly gross: Money;
  readonly net: Money;
  readonly discountTotal: Money;
  readonly applied: readonly AppliedDiscount[];
  readonly byType: DiscountBreakdown;
}

export interface InvoiceDiscountAllocation {
  readonly total: Money;
  readonly allocations: readonly Money[];
  readonly applied: AppliedDiscount;
}

export interface DistributeOptions {
  /** Per line: true = exempt from the invoice discount (exclude_from_invoice_discount, FR-PRC-119). */
  readonly excluded?: readonly boolean[];
  readonly limits?: DiscountLimits;
}

// ------------------------------------------------------------------ breakdown helpers

export function emptyBreakdown(currency: CurrencyCode): DiscountBreakdown {
  const out = {} as Record<DiscountType, Money>;
  for (const t of DISCOUNT_TYPES) out[t] = Money.zero(currency);
  return Object.freeze(out);
}

export function addToBreakdown(b: DiscountBreakdown, type: DiscountType, amount: Money): DiscountBreakdown {
  return Object.freeze({ ...b, [type]: b[type].add(amount) });
}

export function sumBreakdowns(items: readonly DiscountBreakdown[], currency: CurrencyCode): DiscountBreakdown {
  let acc = emptyBreakdown(currency);
  for (const b of items) for (const t of DISCOUNT_TYPES) acc = addToBreakdown(acc, t, b[t]);
  return acc;
}

// ------------------------------------------------------------------ limits

const LIMIT_KEYS = ["userMaxLineBp", "itemMaxLineBp", "categoryMaxLineBp", "userMaxInvoiceBp"] as const;

const minDefined = (a: number | undefined, b: number | undefined): number | undefined =>
  a === undefined ? b : b === undefined ? a : Math.min(a, b);

/** Combine two limit sets keeping the stricter value of each field. */
export function mergeLimits(a: DiscountLimits = {}, b: DiscountLimits = {}): DiscountLimits {
  const out: Partial<Record<(typeof LIMIT_KEYS)[number], number>> = {};
  for (const k of LIMIT_KEYS) {
    const v = minDefined(a[k], b[k]);
    if (v !== undefined) out[k] = v;
  }
  return Object.freeze(out);
}

export function maxLineBp(limits: DiscountLimits): number | undefined {
  return minDefined(minDefined(limits.userMaxLineBp, limits.itemMaxLineBp), limits.categoryMaxLineBp);
}

const isApproved = (d: DiscountMeta): boolean => (d.approvedBy ?? "").trim() !== "";

/** Effective bp of an amount discount, rounded UP so truncation cannot slip under a limit. base > 0. */
function ratioBp(amount: Money, base: Money): bigint {
  if (amount.isZero()) return 0n;
  return (amount.amountMinor * BigInt(FULL_BP) + base.amountMinor - 1n) / base.amountMinor;
}

function checkLimit(d: Discount, effBp: bigint, maxBp: number | undefined): Result<null> {
  if (maxBp === undefined || effBp <= BigInt(maxBp) || isApproved(d)) return ok(null);
  return domainErr("discount.limit_exceeded", "Discount exceeds the allowed limit; supervisor approval required", {
    type: d.type, source: d.source, bp: effBp.toString(), maxBp,
  });
}

// ------------------------------------------------------------------ amount resolution

function valueOf(d: Discount): DiscountValue {
  switch (d.type) {
    case "LINE_PERCENT":
    case "INVOICE_PERCENT":
    case "CUSTOMER_GROUP":
      return { mode: "PERCENT", bp: d.bp };
    case "LINE_AMOUNT":
    case "INVOICE_AMOUNT":
      return { mode: "AMOUNT", amount: d.amount };
    case "PROMO":
    case "NEAR_EXPIRY":
      return d.value;
  }
}

function resolveAmount(base: Money, d: Discount): Result<{ amount: Money; bp: number | null }> {
  const v = valueOf(d);
  if (v.mode === "PERCENT") {
    if (!Number.isSafeInteger(v.bp) || v.bp < 0 || v.bp > FULL_BP) {
      return domainErr("discount.invalid_bp", "Discount percentage must be an integer between 0 and 10000 bp", {
        type: d.type, source: d.source, bp: v.bp,
      });
    }
    return ok({ amount: base.percent(v.bp), bp: v.bp });
  }
  if (v.amount.currency !== base.currency) {
    return domainErr("discount.currency_mismatch", "Discount currency differs from the document currency", {
      type: d.type, expected: base.currency, actual: v.amount.currency,
    });
  }
  if (v.amount.isNegative()) {
    return domainErr("discount.negative_amount", "Discount amount must be >= 0", { type: d.type, source: d.source });
  }
  return ok({ amount: v.amount, bp: null });
}

function toApplied(d: Discount, amount: Money): AppliedDiscount {
  return Object.freeze(
    d.approvedBy === undefined
      ? { type: d.type, source: d.source, amount }
      : { type: d.type, source: d.source, amount, approvedBy: d.approvedBy },
  );
}

const STAGE: Readonly<Record<LineDiscount["type"], number>> = Object.freeze({
  PROMO: 0, NEAR_EXPIRY: 1, CUSTOMER_GROUP: 2, LINE_PERCENT: 3, LINE_AMOUNT: 3,
});

const isManualLine = (d: Discount): boolean => d.type === "LINE_PERCENT" || d.type === "LINE_AMOUNT";
const isInvoiceScope = (d: Discount): d is InvoiceDiscount => d.type === "INVOICE_PERCENT" || d.type === "INVOICE_AMOUNT";

// ------------------------------------------------------------------ public operations

/**
 * Apply line-level discounts in canonical order on `gross` (unit price x qty).
 * Invariants: at most one manual discount; no discount may exceed the running amount (net >= 0);
 * manual discounts above the limits need `approvedBy`.
 */
export function applyLineDiscounts(
  gross: Money,
  discounts: readonly Discount[],
  limits: DiscountLimits = {},
): Result<LineDiscountResult> {
  if (gross.isNegative()) return domainErr("discount.negative_base", "Line gross must be >= 0");
  const lineDiscounts: LineDiscount[] = [];
  for (const d of discounts) {
    if (isInvoiceScope(d)) {
      return domainErr("discount.wrong_scope", "Invoice discounts cannot be applied to a line", { type: d.type });
    }
    lineDiscounts.push(d);
  }
  if (lineDiscounts.filter(isManualLine).length > 1) {
    return domainErr("discount.multiple_manual_line", "Only one manual line discount (percent OR amount) is allowed");
  }
  const groupBlocked = lineDiscounts.some((d) => d.type === "PROMO" && d.blocksCustomerGroup === true);
  const ordered = [...lineDiscounts].sort((a, b) => STAGE[a.type] - STAGE[b.type]);

  let running = gross;
  let byType = emptyBreakdown(gross.currency);
  const applied: AppliedDiscount[] = [];
  for (const d of ordered) {
    if (d.type === "CUSTOMER_GROUP" && groupBlocked) continue;
    const r = resolveAmount(running, d);
    if (!r.ok) return r;
    const { amount, bp } = r.value;
    if (amount.gt(running)) {
      return domainErr("discount.exceeds_line_gross", "Discount exceeds the line amount", {
        type: d.type, source: d.source, base: running.toDecimalString(), amount: amount.toDecimalString(),
      });
    }
    if (isManualLine(d)) {
      const lim = checkLimit(d, bp === null ? ratioBp(amount, running) : BigInt(bp), maxLineBp(limits));
      if (!lim.ok) return lim;
    }
    running = running.subtract(amount);
    applied.push(toApplied(d, amount));
    byType = addToBreakdown(byType, d.type, amount);
  }
  return ok(
    Object.freeze({ gross, net: running, discountTotal: gross.subtract(running), applied: Object.freeze(applied), byType }),
  );
}

/**
 * Distribute an invoice discount over line nets proportionally (largest remainder, exact sum).
 * Rejects a discount larger than the eligible net (FR-PRC-119).
 */
export function distributeInvoiceDiscount(
  lineNets: readonly Money[],
  discount: InvoiceDiscount,
  opts: DistributeOptions = {},
): Result<InvoiceDiscountAllocation> {
  const first = lineNets[0];
  if (first === undefined) return domainErr("discount.no_lines", "Invoice discount needs at least one line");
  const currency = first.currency;
  for (const n of lineNets) {
    if (n.currency !== currency) {
      return domainErr("discount.currency_mismatch", "Line nets must share one currency", { expected: currency, actual: n.currency });
    }
    if (n.isNegative()) return domainErr("discount.negative_base", "Line net must be >= 0");
  }
  const eligible = lineNets.map((_, i) => opts.excluded?.[i] !== true);
  const base = Money.sum(lineNets.filter((_, i) => eligible[i]), currency);
  const r = resolveAmount(base, discount);
  if (!r.ok) return r;
  const { amount, bp } = r.value;
  if (amount.gt(base)) {
    return domainErr("discount.exceeds_invoice_net", "Invoice discount exceeds the invoice net", {
      net: base.toDecimalString(), amount: amount.toDecimalString(),
    });
  }
  const lim = checkLimit(discount, bp === null ? ratioBp(amount, base) : BigInt(bp), opts.limits?.userMaxInvoiceBp);
  if (!lim.ok) return lim;

  let allocations: Money[];
  if (amount.isZero()) {
    allocations = lineNets.map(() => Money.zero(currency));
  } else {
    const ratios = lineNets.map((n, i) => (eligible[i] ? Number(n.amountMinor) : 0));
    if (ratios.some((x) => !Number.isSafeInteger(x))) {
      return domainErr("discount.amount_too_large", "Line amounts too large to distribute safely");
    }
    allocations = amount.allocate(ratios);
  }
  return ok(Object.freeze({ total: amount, allocations: Object.freeze(allocations), applied: toApplied(discount, amount) }));
}
