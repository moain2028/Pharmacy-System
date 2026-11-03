/**
 * Invoice totals engine (FR-SAL-114..122, FR-SAL-142, D-028). Pure calculation, no I/O.
 * Binding order: resolved unit price x qty -> PROMO / NEAR_EXPIRY -> CUSTOMER_GROUP -> manual line
 * (pricing/discount.applyLineDiscounts) -> invoice discount distribution (largest remainder)
 * -> tax per line (bp, Half-Up) -> tenant cash rounding (Money.roundToStep) => rounding_adjustment.
 * The invoice currency is fixed; FX conversion happens only at payment (rate snapshot).
 */
import type { CurrencyCode } from "../money/currency.js";
import { Money } from "../money/money.js";
import { domainErr, ok, type Result } from "../shared/result.js";
import {
  FULL_BP,
  addToBreakdown,
  applyLineDiscounts,
  distributeInvoiceDiscount,
  sumBreakdowns,
  type AppliedDiscount,
  type DiscountBreakdown,
  type DiscountLimits,
  type DistributeOptions,
  type InvoiceDiscount,
  type LineDiscount,
  type LineDiscountResult,
} from "../pricing/discount.js";

export type CashRoundingMode = "down" | "up" | "half_up";

export interface CashRounding {
  readonly stepMinor: bigint;
  readonly mode: CashRoundingMode;
}

export interface TotalsLineInput {
  readonly lineId: string;
  readonly unitPrice: Money;
  readonly qtyInUnit: bigint;
  readonly discounts: readonly LineDiscount[];
  readonly taxBp: number;
  readonly excludeFromInvoiceDiscount?: boolean | undefined;
}

export interface TotalsInput {
  readonly currency: CurrencyCode;
  readonly lines: readonly TotalsLineInput[];
  readonly invoiceDiscount?: InvoiceDiscount | null | undefined;
  readonly limits?: DiscountLimits | undefined;
  readonly cashRounding?: CashRounding | null | undefined;
}

export interface LineTotals {
  readonly lineId: string;
  readonly gross: Money;
  readonly lineDiscount: Money;
  readonly byType: DiscountBreakdown;
  readonly applied: readonly AppliedDiscount[];
  readonly netAfterLine: Money;
  readonly invoiceDiscountAlloc: Money;
  /** Taxable net after line and invoice discounts. */
  readonly net: Money;
  readonly tax: Money;
  readonly total: Money;
}

export interface InvoiceTotals {
  readonly currency: CurrencyCode;
  readonly lines: readonly LineTotals[];
  readonly gross: Money;
  readonly lineDiscountTotal: Money;
  readonly invoiceDiscountTotal: Money;
  readonly discountTotal: Money;
  readonly byType: DiscountBreakdown;
  readonly invoiceDiscountApplied: AppliedDiscount | null;
  readonly net: Money;
  readonly tax: Money;
  readonly totalBeforeRounding: Money;
  readonly roundingAdjustment: Money;
  readonly total: Money;
}

function validateLine(line: TotalsLineInput, currency: CurrencyCode): Result<null> {
  if (line.unitPrice.currency !== currency) {
    return domainErr("sales.currency_mismatch", "Line price currency differs from the invoice currency", {
      lineId: line.lineId, expected: currency, actual: line.unitPrice.currency,
    });
  }
  if (line.qtyInUnit <= 0n) {
    return domainErr("sales.qty_not_positive", "Line quantity must be > 0", { lineId: line.lineId });
  }
  if (line.unitPrice.isNegative()) {
    return domainErr("sales.negative_price", "Unit price must be >= 0", { lineId: line.lineId });
  }
  if (!Number.isSafeInteger(line.taxBp) || line.taxBp < 0 || line.taxBp > FULL_BP) {
    return domainErr("sales.invalid_tax_bp", "Tax must be an integer between 0 and 10000 bp", {
      lineId: line.lineId, taxBp: line.taxBp,
    });
  }
  return ok(null);
}

export function computeInvoiceTotals(input: TotalsInput): Result<InvoiceTotals> {
  const { currency } = input;
  const limits = input.limits ?? {};
  const staged: { line: TotalsLineInput; d: LineDiscountResult }[] = [];
  for (const line of input.lines) {
    const v = validateLine(line, currency);
    if (!v.ok) return v;
    const r = applyLineDiscounts(line.unitPrice.multiply(line.qtyInUnit), line.discounts, limits);
    if (!r.ok) return r;
    staged.push({ line, d: r.value });
  }

  const zero = Money.zero(currency);
  let allocations: readonly Money[] = staged.map(() => zero);
  let invoiceApplied: AppliedDiscount | null = null;
  if (input.invoiceDiscount) {
    const opts: DistributeOptions = {
      excluded: staged.map((s) => s.line.excludeFromInvoiceDiscount === true),
      limits,
    };
    const r = distributeInvoiceDiscount(staged.map((s) => s.d.net), input.invoiceDiscount, opts);
    if (!r.ok) return r;
    allocations = r.value.allocations;
    invoiceApplied = r.value.applied;
  }

  const lines: readonly LineTotals[] = Object.freeze(
    staged.map((s, i) => {
      const alloc = allocations[i] ?? zero;
      const net = s.d.net.subtract(alloc);
      const tax = net.percent(s.line.taxBp);
      return Object.freeze({
        lineId: s.line.lineId,
        gross: s.d.gross,
        lineDiscount: s.d.discountTotal,
        byType: s.d.byType,
        applied: s.d.applied,
        netAfterLine: s.d.net,
        invoiceDiscountAlloc: alloc,
        net,
        tax,
        total: net.add(tax),
      });
    }),
  );

  const sum = (pick: (l: LineTotals) => Money): Money => Money.sum(lines.map(pick), currency);
  let byType = sumBreakdowns(lines.map((l) => l.byType), currency);
  if (invoiceApplied !== null) byType = addToBreakdown(byType, invoiceApplied.type, invoiceApplied.amount);

  const totalBeforeRounding = sum((l) => l.total);
  let total = totalBeforeRounding;
  if (input.cashRounding) {
    const { stepMinor, mode } = input.cashRounding;
    if (stepMinor <= 0n) {
      return domainErr("sales.bad_cash_step", "Cash rounding step must be > 0", { stepMinor: stepMinor.toString() });
    }
    total = totalBeforeRounding.roundToStep(stepMinor, mode);
  }
  const lineDiscountTotal = sum((l) => l.lineDiscount);
  const invoiceDiscountTotal = sum((l) => l.invoiceDiscountAlloc);
  return ok(
    Object.freeze({
      currency,
      lines,
      gross: sum((l) => l.gross),
      lineDiscountTotal,
      invoiceDiscountTotal,
      discountTotal: lineDiscountTotal.add(invoiceDiscountTotal),
      byType,
      invoiceDiscountApplied: invoiceApplied,
      net: sum((l) => l.net),
      tax: sum((l) => l.tax),
      totalBeforeRounding,
      roundingAdjustment: total.subtract(totalBeforeRounding),
      total,
    }),
  );
}
