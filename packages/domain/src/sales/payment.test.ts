import { describe, expect, it } from "vitest";
import { ExchangeRate } from "../fx/exchange-rate.js";
import type { CurrencyCode } from "../money/currency.js";
import { Money } from "../money/money.js";
import { unwrap } from "../shared/result.js";
import {
  CREDIT_OVERRIDE_PERMISSION, computeChange, isTenderMethod, settleInvoice, type SettlementInput, type Tender,
} from "./payment.js";

const y = (n: number): Money => Money.minor(n, "YER_OLD");
const s = (n: number): Money => Money.minor(n, "SAR");
const rate = (from: CurrencyCode, to: CurrencyCode, buy: bigint, sell: bigint = buy): ExchangeRate =>
  unwrap(ExchangeRate.create({ from, to, buyRateScaled: buy, sellRateScaled: sell, effectiveFrom: new Date("2025-01-01T00:00:00Z") }));
const sarYer = rate("SAR", "YER_OLD", 140_000_000n);
const cash = (amount: Money, r?: ExchangeRate): Tender => ({ method: "CASH", amount, rate: r });
const inp = (total: Money, tenders: readonly Tender[], extra: Partial<SettlementInput> = {}): SettlementInput => ({
  total, tenders, change: { currency: "YER_OLD", cashStepMinor: 5000n }, ...extra,
});
const terms = { allowCredit: true, outstanding: y(0), creditLimit: y(5_000_000) };

describe("settleInvoice", () => {
  it("FR-SAL-141: due 8,700 YER_OLD, paid 100 SAR @140 → change 5,300 YER_OLD, step 50", () => {
    const r = unwrap(settleInvoice(inp(y(870_000), [cash(s(10_000), sarYer)])));
    expect(r.paidMinor.amountMinor).toBe(1_400_000n);
    expect(r.changeMinor.amountMinor).toBe(530_000n);
    expect(r.changeCurrency).toBe("YER_OLD");
    expect(r.roundingMinor.isZero()).toBe(true);
    expect(r.creditMinor.isZero()).toBe(true);
    expect(r.changeRateSnapshot).toBeNull();
    const t = r.tenders[0];
    expect(t?.rateSnapshot).toMatchObject({ from: "SAR", to: "YER_OLD", direction: "buy", rateScaledSnapshot: 140_000_000n });
    expect(t?.inInvoiceCurrency.amountMinor).toBe(1_400_000n);
    expect(t?.paymentRef).toBeNull();
    expect(Object.isFrozen(r)).toBe(true);
    expect(Object.isFrozen(r.tenders)).toBe(true);
  });

  it("FR-SAL-137: 50 SAR + 5,000 YER_OLD cash + rest on credit", () => {
    const r = unwrap(
      settleInvoice(inp(y(1_500_000), [cash(s(5_000), sarYer), cash(y(500_000)), { method: "CREDIT", amount: y(300_000) }], { credit: terms })),
    );
    expect(r.paidMinor.amountMinor).toBe(1_200_000n);
    expect(r.creditMinor.amountMinor).toBe(300_000n);
    expect(r.changeMinor.isZero()).toBe(true);
    expect(r.creditOverride).toBeNull();
    expect(r.tenders.map((t) => t.rateSnapshot === null)).toEqual([false, true, true]);
  });

  it("FR-SAL-142: 1,237 due, 2,000 cash, step 10 → change 760, rounding 3", () => {
    const r = unwrap(settleInvoice(inp(y(123_700), [cash(y(200_000))], { change: { currency: "YER_OLD", cashStepMinor: 1000n } })));
    expect(r.changeMinor.amountMinor).toBe(76_000n);
    expect(r.roundingMinor.amountMinor).toBe(300n);
  });

  it("change in SAR with sell rate, rounded down to 0.50 and difference to rounding", () => {
    const r = unwrap(settleInvoice(inp(y(1_000_000), [cash(y(1_140_700))], { change: { currency: "SAR", cashStepMinor: 50n, rate: sarYer } })));
    expect(r.changeMinor.toString()).toBe("10.00 SAR");
    expect(r.roundingMinor.amountMinor).toBe(700n);
    expect(r.changeRateSnapshot?.direction).toBe("sell");
  });

  it("uses buy rate for tenders and sell rate for change", () => {
    const spread = rate("SAR", "YER_OLD", 139_000_000n, 140_000_000n);
    const r = unwrap(settleInvoice(inp(y(1_000_000), [cash(s(10_000), spread)], { change: { currency: "SAR", cashStepMinor: 50n, rate: spread } })));
    expect(r.paidMinor.amountMinor).toBe(1_390_000n);
    expect(r.changeMinor.amountMinor).toBe(2750n);
    expect(r.roundingMinor.amountMinor).toBe(5000n);
  });

  it("card + wallet exactly covering, with refs and accounts", () => {
    const r = unwrap(
      settleInvoice(inp(y(800_000), [
        { method: "CARD", amount: y(500_000), paymentRef: "C1", accountId: "acq" },
        { method: "WALLET", amount: y(300_000), paymentRef: "W1" },
      ])),
    );
    expect(r.paidMinor.amountMinor).toBe(800_000n);
    expect(r.tenders[0]?.accountId).toBe("acq");
    expect(r.tenders[1]?.accountId).toBeNull();
  });

  it("zero total with no tenders settles to zero", () => {
    const r = unwrap(settleInvoice(inp(y(0), [])));
    expect(r.paidMinor.isZero() && r.changeMinor.isZero() && r.roundingMinor.isZero()).toBe(true);
  });

  it("credit override allows exceeding the limit (FR-SAL-128)", () => {
    const over = { permission: CREDIT_OVERRIDE_PERMISSION, approvedBy: "sup", reason: "VIP" };
    const r = unwrap(settleInvoice(inp(y(600_000), [{ method: "CREDIT", amount: y(600_000) }], {
      credit: { ...terms, outstanding: y(4_500_000) }, creditOverride: over,
    })));
    expect(r.creditOverride).toEqual(over);
  });

  it("credit without a limit skips the check", () => {
    const r = settleInvoice(inp(y(100), [{ method: "CREDIT", amount: y(100) }], { credit: { allowCredit: true, outstanding: y(0) } }));
    expect(r.ok).toBe(true);
  });

  const errors: readonly [string, SettlementInput, string][] = [
    ["underpayment", inp(y(100_000), [cash(y(50_000))]), "payment.insufficient"],
    ["FR-SAL-143 card above due", inp(y(800_000), [{ method: "CARD", amount: y(1_000_000), paymentRef: "x" }]), "payment.non_cash_exceeds_total"],
    ["wallet without ref", inp(y(100), [{ method: "WALLET", amount: y(100), paymentRef: " " }]), "payment.ref_required"],
    ["credit for walk-in", inp(y(100), [{ method: "CREDIT", amount: y(100) }]), "payment.credit_not_allowed"],
    ["credit blocked", inp(y(100), [{ method: "CREDIT", amount: y(100) }], { credit: { ...terms, allowCredit: false } }), "payment.credit_not_allowed"],
    ["FR-SAL-128 limit 50,000 / outstanding 45,000 / +6,000", inp(y(600_000), [{ method: "CREDIT", amount: y(600_000) }], { credit: { ...terms, outstanding: y(4_500_000) } }), "payment.credit_limit_exceeded"],
    ["credit terms in other currency", inp(y(100), [{ method: "CREDIT", amount: y(100) }], { credit: { ...terms, creditLimit: s(100) } }), "payment.currency_mismatch"],
    ["non-positive tender", inp(y(100), [cash(y(0))]), "payment.non_positive_tender"],
    ["foreign tender without rate", inp(y(100), [cash(s(100))]), "payment.rate_required"],
    ["rate for wrong pair", inp(y(100), [cash(Money.minor(100, "USD"), sarYer)]), "fx.pair_mismatch"],
    ["negative total", inp(y(-1), []), "payment.negative_total"],
    ["bad cash step", inp(y(100), [cash(y(100))], { change: { currency: "YER_OLD", cashStepMinor: 0n } }), "payment.bad_cash_step"],
    ["change currency without rate", inp(y(100), [cash(y(200))], { change: { currency: "SAR", cashStepMinor: 5n } }), "payment.rate_required"],
    ["blank override", inp(y(100), [cash(y(100))], { creditOverride: { permission: CREDIT_OVERRIDE_PERMISSION, approvedBy: "", reason: "r" } }), "payment.invalid_override"],
  ];
  it.each(errors)("rejects %s", (_label, input, code) => {
    const r = settleInvoice(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe(code);
  });
});

describe("computeChange", () => {
  it("rejects negative overpay", () => {
    const r = computeChange(y(-1), { currency: "YER_OLD", cashStepMinor: 1n });
    expect(!r.ok && r.error.code).toBe("payment.negative_overpay");
  });
  it("zero overpay → zero change in the change currency", () => {
    const r = unwrap(computeChange(y(0), { currency: "SAR", cashStepMinor: 5n }));
    expect(r.change.currency).toBe("SAR");
    expect(r.rounding.isZero()).toBe(true);
    expect(r.rateSnapshot).toBeNull();
  });
});

describe("isTenderMethod", () => {
  it.each([["CASH", true], ["CREDIT", true], ["ADVANCE", false], [1, false]])("%s → %s", (x, expected) => {
    expect(isTenderMethod(x)).toBe(expected);
  });
});
