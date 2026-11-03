/**
 * ExchangeRate value object (FR-CUR-103/106/108/110).
 *
 * Semantics: `buyRateScaled` / `sellRateScaled` = how many whole units of `to` one whole unit of
 * `from` is worth, multiplied by RATE_SCALE (10^6). Example: 1 SAR = 140 YER_NEW gives from=SAR,
 * to=YER_NEW, rate 140_000_000n. "buy" = the pharmacy buys `from` from the customer (tenders);
 * "sell" = the pharmacy sells `from` (price conversion, change). Conversion rounds Half-Up once,
 * to the target currency's minor unit (D-028). Converting `to` -> `from` uses the inverse rate.
 */
import { isCurrencyCode, minorFactor, type CurrencyCode } from "../money/currency.js";
import { Money, divHalfUp } from "../money/money.js";
import { domainErr, ok, type Result } from "../shared/result.js";

/** Fixed-point scale of every stored rate: 10^6. */
export const RATE_SCALE = 10n ** 6n;

export type FxDirection = "buy" | "sell";

export interface ExchangeRateInput {
  readonly from: string;
  readonly to: string;
  readonly buyRateScaled: bigint;
  readonly sellRateScaled: bigint;
  readonly effectiveFrom: Date;
}

export class ExchangeRate {
  readonly from: CurrencyCode;
  readonly to: CurrencyCode;
  readonly buyRateScaled: bigint;
  readonly sellRateScaled: bigint;
  readonly scale: bigint;
  private readonly effectiveFromMs: number;

  private constructor(from: CurrencyCode, to: CurrencyCode, buy: bigint, sell: bigint, effectiveFromMs: number) {
    this.from = from;
    this.to = to;
    this.buyRateScaled = buy;
    this.sellRateScaled = sell;
    this.scale = RATE_SCALE;
    this.effectiveFromMs = effectiveFromMs;
    Object.freeze(this);
  }

  /** Validates canonical codes, from != to, positive rates, buy <= sell (FR-CUR-103), valid date. */
  static create(input: ExchangeRateInput): Result<ExchangeRate> {
    const { from, to, buyRateScaled, sellRateScaled, effectiveFrom } = input;
    if (!isCurrencyCode(from) || !isCurrencyCode(to)) {
      return domainErr("fx.invalid_currency", "Unknown currency code in exchange rate", { from, to });
    }
    if (from === to) {
      return domainErr("fx.same_currency", "An exchange rate needs two different currencies", { from });
    }
    if (buyRateScaled <= 0n || sellRateScaled <= 0n) {
      return domainErr("fx.non_positive_rate", "Exchange rates must be > 0", {
        buyRateScaled: buyRateScaled.toString(),
        sellRateScaled: sellRateScaled.toString(),
      });
    }
    if (buyRateScaled > sellRateScaled) {
      return domainErr("fx.buy_above_sell", "Buy rate must not exceed sell rate", {
        buyRateScaled: buyRateScaled.toString(),
        sellRateScaled: sellRateScaled.toString(),
      });
    }
    const ms = effectiveFrom.getTime();
    if (Number.isNaN(ms)) return domainErr("fx.invalid_date", "effectiveFrom must be a valid date");
    return ok(new ExchangeRate(from, to, buyRateScaled, sellRateScaled, ms));
  }

  /** Defensive copy: Date is mutable. */
  get effectiveFrom(): Date {
    return new Date(this.effectiveFromMs);
  }

  /** Mid rate, Half-Up. */
  get midRateScaled(): bigint {
    return divHalfUp(this.buyRateScaled + this.sellRateScaled, 2n);
  }

  rateFor(direction: FxDirection): bigint {
    return direction === "buy" ? this.buyRateScaled : this.sellRateScaled;
  }

  isEffectiveAt(at: Date): boolean {
    return this.effectiveFromMs <= at.getTime();
  }
}

/** Rate frozen on a document at posting time (rate_scaled_snapshot, FR-CUR-106). */
export interface RateSnapshot {
  readonly from: CurrencyCode;
  readonly to: CurrencyCode;
  readonly direction: FxDirection;
  readonly rateScaledSnapshot: bigint;
  readonly scale: bigint;
  /** ISO-8601 UTC. */
  readonly effectiveFrom: string;
}

function convertScaled(
  money: Money,
  from: CurrencyCode,
  to: CurrencyCode,
  rateScaled: bigint,
  target: CurrencyCode,
): Result<Money> {
  if (target === money.currency) return ok(money);
  const src = money.currency;
  let minor: bigint;
  if (src === from && target === to) {
    minor = divHalfUp(money.amountMinor * rateScaled * minorFactor(to), RATE_SCALE * minorFactor(from));
  } else if (src === to && target === from) {
    minor = divHalfUp(money.amountMinor * RATE_SCALE * minorFactor(from), rateScaled * minorFactor(to));
  } else {
    return domainErr("fx.pair_mismatch", "Rate does not cover this currency pair", {
      from, to, money: src, target,
    });
  }
  return Money.ofMinor(minor, target);
}

/**
 * Convert `money` with `rate`. Target defaults to the other side of the pair.
 * Same-currency conversion (target === money.currency) is identity.
 */
export function convert(money: Money, rate: ExchangeRate, direction: FxDirection, target?: CurrencyCode): Result<Money> {
  const dest = target ?? (money.currency === rate.from ? rate.to : rate.from);
  return convertScaled(money, rate.from, rate.to, rate.rateFor(direction), dest);
}

export function snapshotRate(rate: ExchangeRate, direction: FxDirection): RateSnapshot {
  return Object.freeze({
    from: rate.from,
    to: rate.to,
    direction,
    rateScaledSnapshot: rate.rateFor(direction),
    scale: RATE_SCALE,
    effectiveFrom: rate.effectiveFrom.toISOString(),
  });
}

/** Convert with a stored snapshot (returns / reprints never revalue, FR-CUR-106). */
export function convertWithSnapshot(money: Money, snapshot: RateSnapshot, target?: CurrencyCode): Result<Money> {
  if (snapshot.scale !== RATE_SCALE) {
    return domainErr("fx.unsupported_scale", "Rate snapshot scale must be 10^6", { scale: snapshot.scale.toString() });
  }
  if (snapshot.rateScaledSnapshot <= 0n) {
    return domainErr("fx.non_positive_rate", "Rate snapshot must be > 0", {
      rateScaledSnapshot: snapshot.rateScaledSnapshot.toString(),
    });
  }
  const dest = target ?? (money.currency === snapshot.from ? snapshot.to : snapshot.from);
  return convertScaled(money, snapshot.from, snapshot.to, snapshot.rateScaledSnapshot, dest);
}

/** Latest rate for the pair with effectiveFrom <= at (FR-CUR-103). Ties: later in the list wins. */
export function pickEffectiveRate(
  rates: readonly ExchangeRate[],
  from: CurrencyCode,
  to: CurrencyCode,
  at: Date,
): Result<ExchangeRate> {
  let best: ExchangeRate | undefined;
  for (const r of rates) {
    if (r.from !== from || r.to !== to || !r.isEffectiveAt(at)) continue;
    if (best === undefined || r.effectiveFrom.getTime() >= best.effectiveFrom.getTime()) best = r;
  }
  if (best === undefined) {
    return domainErr("fx.rate_not_found", "No effective exchange rate", { from, to, at: at.toISOString() });
  }
  return ok(best);
}
