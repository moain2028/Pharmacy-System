import { describe, expect, it } from "vitest";
import { Money, divHalfUp, normalizeDigits } from "./money.js";
import { CURRENCIES, CURRENCY_CODES, isCurrencyCode, minorFactor } from "./currency.js";
import { DomainError, unwrap } from "../shared/result.js";

const Y = (minor: bigint | number | string) => Money.minor(minor, "YER_NEW");

describe("currency registry (D-027)", () => {
  it("exposes exactly the four canonical codes", () => {
    expect([...CURRENCY_CODES]).toEqual(["YER_OLD", "YER_NEW", "SAR", "USD"]);
    for (const c of CURRENCY_CODES) {
      expect(CURRENCIES[c].code).toBe(c);
      expect(minorFactor(c)).toBe(100n);
    }
  });
  it("isCurrencyCode guards unknown codes", () => {
    expect(isCurrencyCode("YER")).toBe(false);
    expect(isCurrencyCode("YER_OLD")).toBe(true);
    expect(isCurrencyCode(42)).toBe(false);
  });
});

describe("Money.ofMinor — rule A1: no floats", () => {
  it("accepts bigint, safe integer, and integer strings", () => {
    expect(unwrap(Money.ofMinor(100n, "YER_NEW")).amountMinor).toBe(100n);
    expect(unwrap(Money.ofMinor(100, "SAR")).amountMinor).toBe(100n);
    expect(unwrap(Money.ofMinor("-250", "USD")).amountMinor).toBe(-250n);
    expect(unwrap(Money.ofMinor(" +7 ", "USD")).amountMinor).toBe(7n);
  });
  it("rejects floats, NaN, Infinity, unsafe ints, bad strings, null", () => {
    for (const bad of [10.5, NaN, Infinity, 2 ** 53, "10.5", "1e3", "", "abc", "--1"]) {
      const r = Money.ofMinor(bad as never, "YER_NEW");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("money.non_integer");
    }
    const r = Money.ofMinor(null as never, "YER_NEW");
    expect(r.ok).toBe(false);
  });
  it("rejects unknown currency", () => {
    const r = Money.ofMinor(1n, "YER");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("money.invalid_currency");
  });
  it("Money.minor throws on invalid input", () => {
    expect(() => Money.minor(1.5, "YER_NEW")).toThrow(DomainError);
  });
  it("fromJSON round-trips toJSON", () => {
    const m = Y(123456n);
    expect(unwrap(Money.fromJSON(m.toJSON())).equals(m)).toBe(true);
    expect(JSON.parse(JSON.stringify({ m }))).toEqual({ m: { amountMinor: "123456", currency: "YER_NEW" } });
  });
});

describe("Money.parse — human input", () => {
  it("parses decimals, thousands separators, signs", () => {
    expect(unwrap(Money.parse("150.5", "YER_NEW")).amountMinor).toBe(15050n);
    expect(unwrap(Money.parse("1,250.00", "SAR")).amountMinor).toBe(125000n);
    expect(unwrap(Money.parse("-3", "USD")).amountMinor).toBe(-300n);
    expect(unwrap(Money.parse(".5", "USD")).amountMinor).toBe(50n);
    expect(unwrap(Money.parse("+12.", "USD")).amountMinor).toBe(1200n);
  });
  it("parses Arabic-Indic digits and Arabic decimal separator", () => {
    expect(unwrap(Money.parse("١٥٠٫٥", "YER_OLD")).amountMinor).toBe(15050n);
    expect(unwrap(Money.parse("۱۲٬۳۴۵", "YER_OLD")).amountMinor).toBe(1234500n);
    expect(normalizeDigits("٠٩۰۹x")).toBe("0909x");
  });
  it("rejects too many decimals instead of silently rounding", () => {
    const r = Money.parse("1.234", "USD");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("money.too_many_decimals");
  });
  it("rejects garbage and unknown currency", () => {
    expect(Money.parse("12a", "USD").ok).toBe(false);
    expect(Money.parse("", "USD").ok).toBe(false);
    expect(Money.parse(".", "USD").ok).toBe(false);
    expect(Money.parse("-", "USD").ok).toBe(false);
    expect(Money.parse("1", "EUR").ok).toBe(false);
  });
});

describe("Money arithmetic", () => {
  it("add/subtract/negate/abs are exact", () => {
    expect(Y(100).add(Y(250)).amountMinor).toBe(350n);
    expect(Y(100).subtract(Y(250)).amountMinor).toBe(-150n);
    expect(Y(-5).negate().amountMinor).toBe(5n);
    expect(Y(-5).abs().amountMinor).toBe(5n);
    expect(Y(5).abs().amountMinor).toBe(5n);
  });
  it("refuses to mix currencies (throws — programmer error)", () => {
    const sar = Money.minor(1, "SAR");
    expect(() => Y(1).add(sar)).toThrow(DomainError);
    expect(() => Y(1).subtract(sar)).toThrow(/subtract/);
    expect(() => Y(1).compare(sar)).toThrow(DomainError);
    try { Y(1).add(sar); } catch (e) { expect((e as DomainError).code).toBe("money.currency_mismatch"); }
  });
  it("multiply by integer quantity; rejects fractional", () => {
    expect(Y(1250).multiply(3).amountMinor).toBe(3750n);
    expect(Y(1250).multiply(3n).amountMinor).toBe(3750n);
    expect(() => Y(1).multiply(1.5)).toThrow(DomainError);
  });
  it("percent uses basis points with Half-Up (D-028)", () => {
    expect(Y(100000).percent(1500).amountMinor).toBe(15000n); // 15 % of 1000.00 = 150.00
    expect(Y(10000).percent(333).amountMinor).toBe(333n); // 3.33 % of 100.00 = 3.33
    expect(Y(1).percent(5000).amountMinor).toBe(1n); // 0.5 -> 1 (half up)
    expect(Y(-1).percent(5000).amountMinor).toBe(-1n); // symmetric
    expect(Y(3).percent(3333).amountMinor).toBe(1n); // 0.9999 -> 1
    expect(() => Y(1).percent(1.5)).toThrow(DomainError);
  });
  it("divide is Half-Up and rejects non-positive divisors", () => {
    expect(Y(1001).divide(2).amountMinor).toBe(501n);
    expect(Y(1000).divide(3n).amountMinor).toBe(333n);
    expect(Y(-1001).divide(2).amountMinor).toBe(-501n);
    expect(() => Y(1).divide(0)).toThrow(DomainError);
    expect(() => Y(1).divide(-2)).toThrow(DomainError);
  });
  it("divHalfUp guards its denominator", () => {
    expect(() => divHalfUp(1n, 0n)).toThrow(RangeError);
    expect(divHalfUp(5n, 2n)).toBe(3n);
    expect(divHalfUp(-5n, 2n)).toBe(-3n);
  });
});

describe("Money.allocate — largest remainder", () => {
  it("parts sum exactly to total; remainder goes to largest fractional parts", () => {
    const parts = Y(1000).allocate([1, 1, 1]);
    expect(parts.map((p) => p.amountMinor)).toEqual([334n, 333n, 333n]);
    expect(Money.sum(parts).amountMinor).toBe(1000n);
  });
  it("orders by remainder descending (largest-remainder method)", () => {
    // 5 over [1,2]: bases [1,3], remainders [2,1] -> idx0 bumped -> [2,3]
    expect(Y(5).allocate([1, 2]).map((p) => p.amountMinor)).toEqual([2n, 3n]);
    // 7 over [2,1,1]: bases [3,1,1], remainders [2,3,3] -> idx1, idx2 bumped -> [3,2,2]
    expect(Y(7).allocate([2, 1, 1]).map((p) => p.amountMinor)).toEqual([3n, 2n, 2n]);
    // 7 over [1,1,2]: bases [1,1,3], remainders [3,3,2] -> idx0, idx1 bumped -> [2,2,3]
    expect(Y(7).allocate([1, 1, 2]).map((p) => p.amountMinor)).toEqual([2n, 2n, 3n]);
  });
  it("is deterministic on ties (earliest index wins) and handles zeros", () => {
    expect(Y(5).allocate([1, 1, 1, 1]).map((p) => p.amountMinor)).toEqual([2n, 1n, 1n, 1n]);
    expect(Y(10).allocate([0, 1, 0]).map((p) => p.amountMinor)).toEqual([0n, 10n, 0n]);
  });
  it("handles negatives symmetrically (refund allocation)", () => {
    expect(Y(-1000).allocate([1, 1, 1]).map((p) => p.amountMinor)).toEqual([-334n, -333n, -333n]);
  });
  it("proportional invoice-discount distribution example", () => {
    // invoice discount 100.00 over lines 300 / 200 / 500 => 30 / 20 / 50
    expect(Y(10000).allocate([300, 200, 500]).map((p) => p.amountMinor)).toEqual([3000n, 2000n, 5000n]);
    // 10.00 over 3 / 3 / 3 => 3.34 / 3.33 / 3.33
    expect(Y(1000).allocate([3, 3, 3]).map((p) => p.amountMinor)).toEqual([334n, 333n, 333n]);
  });
  it("rejects empty, negative, fractional, and all-zero ratios", () => {
    expect(() => Y(1).allocate([])).toThrow(DomainError);
    expect(() => Y(1).allocate([1, -1])).toThrow(DomainError);
    expect(() => Y(1).allocate([0.5])).toThrow(DomainError);
    expect(() => Y(1).allocate([0, 0])).toThrow(DomainError);
  });
});

describe("Money.roundToStep — cash change only", () => {
  it("rounds down by default to nearest 5.00 (500 minor)", () => {
    expect(Y(1234).roundToStep(500n).amountMinor).toBe(1000n);
    expect(Y(1500).roundToStep(500n).amountMinor).toBe(1500n);
  });
  it("supports up and half_up, and negatives", () => {
    expect(Y(1234).roundToStep(500n, "up").amountMinor).toBe(1500n);
    expect(Y(1249).roundToStep(500n, "half_up").amountMinor).toBe(1000n);
    expect(Y(1250).roundToStep(500n, "half_up").amountMinor).toBe(1500n);
    expect(Y(-1234).roundToStep(500n).amountMinor).toBe(-1000n);
  });
  it("rejects bad step", () => {
    expect(() => Y(1).roundToStep(0n)).toThrow(DomainError);
  });
});

describe("Money comparisons, aggregates, formatting", () => {
  it("compare/lt/lte/gt/gte/equals/isZero/isPositive/isNegative", () => {
    expect(Y(1).compare(Y(2))).toBe(-1);
    expect(Y(2).compare(Y(2))).toBe(0);
    expect(Y(3).compare(Y(2))).toBe(1);
    expect(Y(1).lt(Y(2))).toBe(true);
    expect(Y(2).lte(Y(2))).toBe(true);
    expect(Y(3).gt(Y(2))).toBe(true);
    expect(Y(2).gte(Y(2))).toBe(true);
    expect(Y(2).equals(Money.minor(2, "SAR"))).toBe(false);
    expect(Money.zero("USD").isZero()).toBe(true);
    expect(Y(1).isPositive()).toBe(true);
    expect(Y(-1).isNegative()).toBe(true);
  });
  it("sum/min/max", () => {
    expect(Money.sum([Y(1), Y(2), Y(3)]).amountMinor).toBe(6n);
    expect(Money.sum([], "USD").amountMinor).toBe(0n);
    expect(() => Money.sum([])).toThrow(DomainError);
    expect(Money.min(Y(1), Y(2)).amountMinor).toBe(1n);
    expect(Money.min(Y(3), Y(2)).amountMinor).toBe(2n);
    expect(Money.max(Y(1), Y(2)).amountMinor).toBe(2n);
    expect(Money.max(Y(3), Y(2)).amountMinor).toBe(3n);
  });
  it("toDecimalString/toString are canonical and locale-free", () => {
    expect(Y(125050).toDecimalString()).toBe("1250.50");
    expect(Y(-300).toDecimalString()).toBe("-3.00");
    expect(Y(5).toDecimalString()).toBe("0.05");
    expect(Y(0).toString()).toBe("0.00 YER_NEW");
  });
  it("is frozen (immutable)", () => {
    const m = Y(1);
    expect(Object.isFrozen(m)).toBe(true);
    expect(() => { (m as { amountMinor: bigint }).amountMinor = 9n; }).toThrow();
  });
});
