import { describe, expect, it } from "vitest";
import { Money } from "../money/money.js";
import { unwrap, type Result } from "../shared/result.js";
import {
  ExchangeRate,
  RATE_SCALE,
  convert,
  convertWithSnapshot,
  pickEffectiveRate,
  snapshotRate,
  type RateSnapshot,
} from "./exchange-rate.js";

function codeOf<T>(r: Result<T>): string {
  if (r.ok) throw new Error("expected an Err result");
  return r.error.code;
}

const S = RATE_SCALE;
const T9 = new Date("2025-03-01T09:00:00Z");
const T14 = new Date("2025-03-01T14:00:00Z");

function sarRate(buy: bigint, sell: bigint, at: Date = T9): ExchangeRate {
  return unwrap(ExchangeRate.create({ from: "SAR", to: "YER_NEW", buyRateScaled: buy, sellRateScaled: sell, effectiveFrom: at }));
}
const R140 = sarRate(140n * S, 141n * S);

describe("ExchangeRate.create", () => {
  it("builds a frozen value object with scale 10^6", () => {
    expect(RATE_SCALE).toBe(1_000_000n);
    expect(R140.from).toBe("SAR");
    expect(R140.to).toBe("YER_NEW");
    expect(R140.buyRateScaled).toBe(140_000_000n);
    expect(R140.sellRateScaled).toBe(141_000_000n);
    expect(R140.scale).toBe(1_000_000n);
    expect(Object.isFrozen(R140)).toBe(true);
    expect(R140.midRateScaled).toBe(140_500_000n);
    expect(sarRate(1n, 2n).midRateScaled).toBe(2n);
  });

  it("protects effectiveFrom from external mutation", () => {
    const d = R140.effectiveFrom;
    d.setUTCFullYear(1999);
    expect(R140.effectiveFrom.toISOString()).toBe(T9.toISOString());
  });

  it("rejects non-canonical currency codes", () => {
    const base = { buyRateScaled: S, sellRateScaled: S, effectiveFrom: T9 };
    expect(codeOf(ExchangeRate.create({ ...base, from: "EUR", to: "YER_NEW" }))).toBe("fx.invalid_currency");
    expect(codeOf(ExchangeRate.create({ ...base, from: "SAR", to: "YER-N" }))).toBe("fx.invalid_currency");
  });

  it("rejects from === to", () => {
    expect(codeOf(ExchangeRate.create({ from: "USD", to: "USD", buyRateScaled: S, sellRateScaled: S, effectiveFrom: T9 }))).toBe(
      "fx.same_currency",
    );
  });

  it("rejects non-positive rates", () => {
    const base = { from: "SAR", to: "YER_NEW", effectiveFrom: T9 };
    expect(codeOf(ExchangeRate.create({ ...base, buyRateScaled: 0n, sellRateScaled: S }))).toBe("fx.non_positive_rate");
    expect(codeOf(ExchangeRate.create({ ...base, buyRateScaled: S, sellRateScaled: -1n }))).toBe("fx.non_positive_rate");
  });

  it("rejects buy > sell", () => {
    expect(codeOf(ExchangeRate.create({ from: "SAR", to: "YER_NEW", buyRateScaled: 2n, sellRateScaled: 1n, effectiveFrom: T9 }))).toBe(
      "fx.buy_above_sell",
    );
  });

  it("rejects invalid dates", () => {
    expect(
      codeOf(ExchangeRate.create({ from: "SAR", to: "YER_NEW", buyRateScaled: S, sellRateScaled: S, effectiveFrom: new Date("nope") })),
    ).toBe("fx.invalid_date");
  });

  it("exposes rateFor and isEffectiveAt", () => {
    expect(R140.rateFor("buy")).toBe(140n * S);
    expect(R140.rateFor("sell")).toBe(141n * S);
    expect(R140.isEffectiveAt(T9)).toBe(true);
    expect(R140.isEffectiveAt(new Date("2025-03-01T08:59:59Z"))).toBe(false);
  });
});

describe("convert", () => {
  it("FR-CUR-110: 100 SAR at buy 140 = 14,000.00 YER_NEW; 200 SAR = 28,000.00", () => {
    const r = unwrap(convert(Money.minor(10_000n, "SAR"), R140, "buy"));
    expect(r.currency).toBe("YER_NEW");
    expect(r.amountMinor).toBe(1_400_000n);
    expect(unwrap(convert(Money.minor(20_000n, "SAR"), R140, "buy", "YER_NEW")).amountMinor).toBe(2_800_000n);
  });

  it("FR-CUR-108: 2,000.00 YER_NEW at sell 140 = 14.29 SAR (inverse, Half-Up)", () => {
    const rate = sarRate(139n * S, 140n * S);
    const r = unwrap(convert(Money.minor(200_000n, "YER_NEW"), rate, "sell"));
    expect(r.currency).toBe("SAR");
    expect(r.toDecimalString()).toBe("14.29");
    expect(unwrap(convert(Money.minor(200_000n, "YER_NEW"), rate, "sell", "SAR")).amountMinor).toBe(1429n);
  });

  it("rounds Half-Up for positive and negative amounts", () => {
    const usd = unwrap(
      ExchangeRate.create({ from: "USD", to: "YER_NEW", buyRateScaled: 530_500_000n, sellRateScaled: 535_000_000n, effectiveFrom: T9 }),
    );
    expect(unwrap(convert(Money.minor(1n, "USD"), usd, "buy")).amountMinor).toBe(531n);
    expect(unwrap(convert(Money.minor(-1n, "USD"), usd, "buy")).amountMinor).toBe(-531n);
  });

  it("same-currency conversion is identity", () => {
    const m = Money.minor(12_345n, "YER_NEW");
    expect(convert(m, R140, "sell", "YER_NEW")).toEqual({ ok: true, value: m });
    const r = convert(m, R140, "sell", "YER_NEW");
    expect(r.ok && r.value).toBe(m);
  });

  it("rejects currencies outside the pair", () => {
    expect(codeOf(convert(Money.minor(100n, "USD"), R140, "buy"))).toBe("fx.pair_mismatch");
    expect(codeOf(convert(Money.minor(100n, "SAR"), R140, "buy", "USD"))).toBe("fx.pair_mismatch");
  });
});

describe("RateSnapshot", () => {
  const snap = snapshotRate(R140, "buy");

  it("captures the directional rate, frozen", () => {
    expect(Object.isFrozen(snap)).toBe(true);
    expect(snap).toEqual({
      from: "SAR", to: "YER_NEW", direction: "buy", rateScaledSnapshot: 140n * S, scale: S, effectiveFrom: T9.toISOString(),
    });
    expect(snapshotRate(R140, "sell").rateScaledSnapshot).toBe(141n * S);
  });

  it("converts both directions and identity with the snapshot", () => {
    expect(unwrap(convertWithSnapshot(Money.minor(10_000n, "SAR"), snap)).amountMinor).toBe(1_400_000n);
    expect(unwrap(convertWithSnapshot(Money.minor(1_400_000n, "YER_NEW"), snap)).amountMinor).toBe(10_000n);
    const m = Money.minor(5n, "SAR");
    const r = convertWithSnapshot(m, snap, "SAR");
    expect(r.ok && r.value).toBe(m);
  });

  it("rejects corrupted snapshots", () => {
    const badScale: RateSnapshot = { ...snap, scale: 1000n };
    expect(codeOf(convertWithSnapshot(Money.minor(1n, "SAR"), badScale))).toBe("fx.unsupported_scale");
    const badRate: RateSnapshot = { ...snap, rateScaledSnapshot: 0n };
    expect(codeOf(convertWithSnapshot(Money.minor(1n, "SAR"), badRate))).toBe("fx.non_positive_rate");
  });
});

describe("pickEffectiveRate", () => {
  const r9 = sarRate(140n * S, 141n * S, T9);
  const r14 = sarRate(150n * S, 151n * S, T14);
  const usd = unwrap(ExchangeRate.create({ from: "USD", to: "YER_NEW", buyRateScaled: S, sellRateScaled: S, effectiveFrom: T9 }));
  const old = unwrap(ExchangeRate.create({ from: "SAR", to: "YER_OLD", buyRateScaled: S, sellRateScaled: S, effectiveFrom: T9 }));

  it("FR-CUR-103: rates at 09:00 and 14:00; an operation at 13:59 uses the first", () => {
    const rates = [r14, usd, old, r9];
    expect(unwrap(pickEffectiveRate(rates, "SAR", "YER_NEW", new Date("2025-03-01T13:59:00Z")))).toBe(r9);
    expect(unwrap(pickEffectiveRate(rates, "SAR", "YER_NEW", T14))).toBe(r14);
  });

  it("ties go to the later-entered rate", () => {
    const again = sarRate(145n * S, 146n * S, T9);
    expect(unwrap(pickEffectiveRate([r9, again], "SAR", "YER_NEW", T14))).toBe(again);
  });

  it("fails when nothing is effective", () => {
    expect(codeOf(pickEffectiveRate([r9, r14], "SAR", "YER_NEW", new Date("2025-03-01T08:00:00Z")))).toBe("fx.rate_not_found");
  });
});
