/**
 * Multi-tender settlement (FR-SAL-127/128, FR-SAL-137..144, D-028).
 *
 * - Tenders may be in any canonical currency (YER_OLD/YER_NEW/SAR/USD). Foreign tenders are
 *   converted to the invoice currency with the "buy" rate (the pharmacy buys the foreign cash) and
 *   the rate used is frozen on the tender (`rate_scaled_snapshot`, FR-SAL-139).
 * - Change is paid in ONE chosen currency: overpay → "sell" rate → rounded DOWN to the tenant cash
 *   step; the difference goes to cash-rounding differences (`roundingMinor`, FR-SAL-141/142).
 * - CARD/WALLET/CREDIT may never exceed the amount due: change is only given on CASH (FR-SAL-143).
 *   CARD/WALLET require a `paymentRef` (FR-SAL-138).
 * - CREDIT requires a customer allowed to buy on account and respects the credit limit
 *   (FR-SAL-127/128) unless a supervisor override is supplied.
 * - Underpayment is rejected: the application must add a CREDIT tender explicitly.
 */
import type { CurrencyCode } from "../money/currency.js";
import { Money } from "../money/money.js";
import { convert, snapshotRate, type ExchangeRate, type FxDirection, type RateSnapshot } from "../fx/exchange-rate.js";
import { domainErr, ok, unwrap, type Result } from "../shared/result.js";

export const TENDER_METHODS = ["CASH", "CARD", "WALLET", "CREDIT"] as const;
export type TenderMethod = (typeof TENDER_METHODS)[number];

export function isTenderMethod(x: unknown): x is TenderMethod {
  return typeof x === "string" && (TENDER_METHODS as readonly string[]).includes(x);
}

/** Permission allowing a supervisor to exceed a customer's credit limit (FR-SAL-128). */
export const CREDIT_OVERRIDE_PERMISSION = "customers.credit_override" as const;

export interface Tender {
  readonly method: TenderMethod;
  /** Amount in the tender's own currency, > 0. */
  readonly amount: Money;
  /** Required when `amount.currency` differs from the invoice currency. */
  readonly rate?: ExchangeRate | undefined;
  /** Transaction number — mandatory for CARD and WALLET (FR-SAL-138). */
  readonly paymentRef?: string | undefined;
  /** Collection account (wallet / card acquirer / cashbox). */
  readonly accountId?: string | undefined;
}

export interface ChangeSpec {
  readonly currency: CurrencyCode;
  /** `cash_rounding_unit` of the change currency, in minor units (> 0). */
  readonly cashStepMinor: bigint;
  /** Required when the change currency differs from the invoice currency. */
  readonly rate?: ExchangeRate | undefined;
}

export interface CreditTerms {
  /** false for the walk-in customer and for `credit_blocked` customers. */
  readonly allowCredit: boolean;
  /** Current outstanding balance, in the invoice currency. */
  readonly outstanding: Money;
  /** Undefined = no limit check. Must be in the invoice currency. */
  readonly creditLimit?: Money | undefined;
}

export interface CreditOverride {
  readonly permission: typeof CREDIT_OVERRIDE_PERMISSION;
  readonly approvedBy: string;
  readonly reason: string;
}

export interface SettlementInput {
  /** Invoice net total in the invoice currency (>= 0). */
  readonly total: Money;
  readonly tenders: readonly Tender[];
  readonly change: ChangeSpec;
  readonly credit?: CreditTerms | undefined;
  readonly creditOverride?: CreditOverride | undefined;
}

export interface SettledTender {
  readonly method: TenderMethod;
  readonly tendered: Money;
  readonly inInvoiceCurrency: Money;
  readonly rateSnapshot: RateSnapshot | null;
  readonly paymentRef: string | null;
  readonly accountId: string | null;
}

export interface SaleSettlement {
  readonly currency: CurrencyCode;
  readonly total: Money;
  /** Non-credit tenders, converted to the invoice currency. */
  readonly paidMinor: Money;
  readonly creditMinor: Money;
  /** Change handed back, in `changeCurrency`, rounded down to the cash step. */
  readonly changeMinor: Money;
  readonly changeCurrency: CurrencyCode;
  /** Round-down difference kept by the pharmacy, in the invoice currency (>= 0). */
  readonly roundingMinor: Money;
  readonly changeRateSnapshot: RateSnapshot | null;
  readonly tenders: readonly SettledTender[];
  readonly creditOverride: CreditOverride | null;
}

export interface ChangeComputation {
  readonly change: Money;
  readonly rounding: Money;
  readonly rateSnapshot: RateSnapshot | null;
}

const blank = (s: string | undefined): boolean => (s ?? "").trim() === "";

interface Converted {
  readonly money: Money;
  readonly snapshot: RateSnapshot | null;
}

function convertTo(
  amount: Money,
  rate: ExchangeRate | undefined,
  target: CurrencyCode,
  direction: FxDirection,
  field: string,
): Result<Converted> {
  if (amount.currency === target) return ok({ money: amount, snapshot: null });
  if (rate === undefined) {
    return domainErr("payment.rate_required", `An exchange rate is required to convert ${amount.currency} to ${target}`, {
      field, from: amount.currency, to: target,
    });
  }
  const r = convert(amount, rate, direction, target);
  if (!r.ok) return r;
  return ok({ money: r.value, snapshot: snapshotRate(rate, direction) });
}

/**
 * Change for an overpayment (FR-SAL-141): convert with the sell rate, round DOWN to the cash step.
 * `rounding` = overpay − (rounded change expressed back in the invoice currency).
 */
export function computeChange(overpay: Money, spec: ChangeSpec): Result<ChangeComputation> {
  if (spec.cashStepMinor <= 0n) {
    return domainErr("payment.bad_cash_step", "Cash rounding step must be > 0", { cashStepMinor: spec.cashStepMinor.toString() });
  }
  if (overpay.isNegative()) return domainErr("payment.negative_overpay", "Overpay must be >= 0");
  if (overpay.isZero()) {
    return ok(Object.freeze({ change: Money.zero(spec.currency), rounding: overpay, rateSnapshot: null }));
  }
  const fwd = convertTo(overpay, spec.rate, spec.currency, "sell", "change");
  if (!fwd.ok) return fwd;
  const change = fwd.value.money.roundToStep(spec.cashStepMinor, "down");
  // Converting back with the very rate that just converted forward cannot fail → unwrap is safe.
  const back = fwd.value.snapshot === null ? change : unwrap(convert(change, spec.rate as ExchangeRate, "sell", overpay.currency));
  return ok(Object.freeze({ change, rounding: overpay.subtract(back), rateSnapshot: fwd.value.snapshot }));
}

function checkCredit(credit: Money, terms: CreditTerms | undefined, override: CreditOverride | undefined): Result<null> {
  if (terms === undefined || !terms.allowCredit) {
    return domainErr("payment.credit_not_allowed", "Credit sales need a registered customer allowed to buy on account");
  }
  const limit = terms.creditLimit;
  if (limit === undefined) return ok(null);
  if (limit.currency !== credit.currency || terms.outstanding.currency !== credit.currency) {
    return domainErr("payment.currency_mismatch", "Credit terms must be expressed in the invoice currency", {
      expected: credit.currency, limit: limit.currency, outstanding: terms.outstanding.currency,
    });
  }
  const exposure = terms.outstanding.add(credit);
  if (exposure.lte(limit) || override !== undefined) return ok(null);
  return domainErr("payment.credit_limit_exceeded", "Customer credit limit exceeded; supervisor override required", {
    exposure: exposure.toDecimalString(), creditLimit: limit.toDecimalString(), permission: CREDIT_OVERRIDE_PERMISSION,
  });
}

export function settleInvoice(input: SettlementInput): Result<SaleSettlement> {
  const { total } = input;
  const cur = total.currency;
  if (total.isNegative()) return domainErr("payment.negative_total", "Invoice total must be >= 0");
  const override = input.creditOverride;
  if (override !== undefined && (blank(override.approvedBy) || blank(override.reason))) {
    return domainErr("payment.invalid_override", "Credit override needs approvedBy and a reason");
  }
  let paid = Money.zero(cur);
  let credit = Money.zero(cur);
  let nonCash = Money.zero(cur);
  const settled: SettledTender[] = [];
  for (const [i, t] of input.tenders.entries()) {
    if (!t.amount.isPositive()) {
      return domainErr("payment.non_positive_tender", "Tender amount must be > 0", { index: i, method: t.method });
    }
    if ((t.method === "CARD" || t.method === "WALLET") && blank(t.paymentRef)) {
      return domainErr("payment.ref_required", "Card and wallet tenders require a transaction reference", { index: i, method: t.method });
    }
    const c = convertTo(t.amount, t.rate, cur, "buy", `tenders[${i}]`);
    if (!c.ok) return c;
    if (t.method === "CREDIT") credit = credit.add(c.value.money);
    else {
      paid = paid.add(c.value.money);
      if (t.method !== "CASH") nonCash = nonCash.add(c.value.money);
    }
    settled.push(
      Object.freeze({
        method: t.method, tendered: t.amount, inInvoiceCurrency: c.value.money, rateSnapshot: c.value.snapshot,
        paymentRef: t.paymentRef ?? null, accountId: t.accountId ?? null,
      }),
    );
  }
  const covered = paid.add(credit);
  if (covered.lt(total)) {
    return domainErr("payment.insufficient", "Tenders do not cover the amount due", {
      due: total.toDecimalString(), covered: covered.toDecimalString(), remaining: total.subtract(covered).toDecimalString(),
    });
  }
  if (nonCash.add(credit).gt(total)) {
    return domainErr("payment.non_cash_exceeds_total", "Card, wallet and credit tenders may not exceed the amount due; change is given only on cash", {
      due: total.toDecimalString(), nonCash: nonCash.add(credit).toDecimalString(),
    });
  }
  if (credit.isPositive()) {
    const chk = checkCredit(credit, input.credit, override);
    if (!chk.ok) return chk;
  }
  const ch = computeChange(covered.subtract(total), input.change);
  if (!ch.ok) return ch;
  return ok(
    Object.freeze({
      currency: cur, total, paidMinor: paid, creditMinor: credit, changeMinor: ch.value.change, changeCurrency: input.change.currency,
      roundingMinor: ch.value.rounding, changeRateSnapshot: ch.value.rateSnapshot, tenders: Object.freeze(settled),
      creditOverride: credit.isPositive() && override !== undefined ? override : null,
    }),
  );
}
