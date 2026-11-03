/**
 * Money — ENGINEERING-RULES A1: money is never a float.
 * Immutable value object: `amountMinor` (bigint, smallest unit) + `currency` (canonical code).
 *
 * Rounding policy (D-028): Half-Up for all percentage computations; allocation uses the
 * largest-remainder method so parts always sum exactly to the total.
 */
import { CURRENCIES, isCurrencyCode, minorFactor, type CurrencyCode } from "./currency.js";
import { DomainError, domainErr, ok, type Result } from "../shared/result.js";

export type MoneyJSON = { readonly amountMinor: string; readonly currency: CurrencyCode };

/** Basis points: 1 bp = 0.01 %. 10_000 bp = 100 %. */
export type BasisPoints = number;

const BP_SCALE = 10_000n;

const INT_STRING = /^[+-]?\d+$/;
function isIntegerLike(x: unknown): x is bigint | number | string {
  if (typeof x === "bigint") return true;
  if (typeof x === "number") return Number.isSafeInteger(x);
  if (typeof x === "string") return INT_STRING.test(x.trim());
  return false;
}

/** Half-up division of a (possibly negative) bigint numerator by a positive denominator. */
export function divHalfUp(num: bigint, den: bigint): bigint {
  if (den <= 0n) throw new RangeError("denominator must be positive");
  const neg = num < 0n;
  const a = neg ? -num : num;
  const q = a / den;
  const r = a % den;
  const rounded = r * 2n >= den ? q + 1n : q;
  return neg ? -rounded : rounded;
}

export class Money {
  readonly amountMinor: bigint;
  readonly currency: CurrencyCode;

  private constructor(amountMinor: bigint, currency: CurrencyCode) {
    this.amountMinor = amountMinor;
    this.currency = currency;
    Object.freeze(this);
  }

  // ------------------------------------------------------------------ constructors

  /** Construct from minor units. Rejects floats, NaN, unsafe numbers, and unknown currencies. */
  static ofMinor(amountMinor: bigint | number | string, currency: string): Result<Money> {
    if (!isCurrencyCode(currency)) {
      return domainErr("money.invalid_currency", `Unknown currency code: ${currency}`, { currency });
    }
    if (!isIntegerLike(amountMinor)) {
      return domainErr("money.non_integer", "Money minor amount must be an integer (no floats/NaN)", {
        amountMinor: String(amountMinor),
      });
    }
    return ok(new Money(BigInt(amountMinor), currency));
  }

  /** Like ofMinor but throws — for constants, seeds, and tests. */
  static minor(amountMinor: bigint | number | string, currency: CurrencyCode): Money {
    const r = Money.ofMinor(amountMinor, currency);
    if (!r.ok) throw r.error;
    return r.value;
  }

  /**
   * Parse a decimal string entered by a human ("150.5", "1,250.00", "-3") into Money.
   * Accepts Arabic-Indic digits (٠-٩) and Arabic decimal separator (٫). Rejects more decimals
   * than the currency supports (no silent rounding of user input).
   */
  static parse(text: string, currency: string): Result<Money> {
    if (!isCurrencyCode(currency)) {
      return domainErr("money.invalid_currency", `Unknown currency code: ${currency}`, { currency });
    }
    const normalized = normalizeDigits(text).replace(/[,\s_]/g, "");
    // sign, integer part (may be empty when text starts with "."), optional fraction
    const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(normalized);
    if (!m || (m[2] === "" && (m[3] ?? "") === "")) {
      return domainErr("money.unparseable", `Cannot parse money text: ${text}`, { text });
    }
    const sign = m[1] as string;
    const intPart = (m[2] as string) || "0";
    const fracPart = m[3] ?? "";
    const scale = CURRENCIES[currency].minorUnits;
    if (fracPart.length > scale) {
      return domainErr("money.too_many_decimals", `${currency} supports ${scale} decimals`, { text, scale });
    }
    const minor = BigInt(intPart) * minorFactor(currency) + BigInt((fracPart + "0".repeat(scale)).slice(0, scale));
    return ok(new Money(sign === "-" ? -minor : minor, currency));
  }

  static zero(currency: CurrencyCode): Money {
    return new Money(0n, currency);
  }

  static fromJSON(j: MoneyJSON): Result<Money> {
    return Money.ofMinor(j.amountMinor, j.currency);
  }

  // ------------------------------------------------------------------ predicates

  isZero(): boolean { return this.amountMinor === 0n; }
  isPositive(): boolean { return this.amountMinor > 0n; }
  isNegative(): boolean { return this.amountMinor < 0n; }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.amountMinor === other.amountMinor;
  }

  /** Throws DomainError on currency mismatch — mixing currencies is a programmer error. */
  private assertSameCurrency(other: Money, op: string): void {
    if (this.currency !== other.currency) {
      throw new DomainError("money.currency_mismatch", `Cannot ${op} ${this.currency} with ${other.currency}`, {
        left: this.currency, right: other.currency, op,
      });
    }
  }

  compare(other: Money): -1 | 0 | 1 {
    this.assertSameCurrency(other, "compare");
    return this.amountMinor < other.amountMinor ? -1 : this.amountMinor > other.amountMinor ? 1 : 0;
  }
  lt(o: Money): boolean { return this.compare(o) < 0; }
  lte(o: Money): boolean { return this.compare(o) <= 0; }
  gt(o: Money): boolean { return this.compare(o) > 0; }
  gte(o: Money): boolean { return this.compare(o) >= 0; }

  // ------------------------------------------------------------------ arithmetic

  add(other: Money): Money {
    this.assertSameCurrency(other, "add");
    return new Money(this.amountMinor + other.amountMinor, this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other, "subtract");
    return new Money(this.amountMinor - other.amountMinor, this.currency);
  }

  negate(): Money { return new Money(-this.amountMinor, this.currency); }
  abs(): Money { return this.amountMinor < 0n ? this.negate() : this; }

  /** Multiply by an integer quantity (e.g. unit price × SSU qty). */
  multiply(qty: bigint | number): Money {
    if (typeof qty === "number" && !Number.isSafeInteger(qty)) {
      throw new DomainError("money.non_integer_multiplier", "Multiplier must be an integer", { qty });
    }
    return new Money(this.amountMinor * BigInt(qty), this.currency);
  }

  /**
   * Apply a percentage expressed in basis points, Half-Up. 1500 bp = 15 %.
   * percent(1500) of 1000.00 => 150.00 ; percent(333) of 100.00 => 3.33
   */
  percent(bp: BasisPoints): Money {
    if (!Number.isSafeInteger(bp)) {
      throw new DomainError("money.non_integer_bp", "Basis points must be an integer", { bp });
    }
    return new Money(divHalfUp(this.amountMinor * BigInt(bp), BP_SCALE), this.currency);
  }

  /** Divide by a positive integer with Half-Up rounding (e.g. unit cost from total). */
  divide(den: bigint | number): Money {
    const d = BigInt(den);
    if (d <= 0n) throw new DomainError("money.bad_divisor", "Divisor must be positive", { den: String(den) });
    return new Money(divHalfUp(this.amountMinor, d), this.currency);
  }

  /**
   * Split this amount into parts proportional to `ratios` (non-negative integers, not all zero)
   * using the largest-remainder method. Deterministic: ties go to the earliest index.
   * Invariant: sum(parts) === this.amountMinor exactly.
   */
  allocate(ratios: readonly number[]): Money[] {
    if (ratios.length === 0) throw new DomainError("money.allocate_empty", "ratios must not be empty");
    const rs = ratios.map((r) => {
      if (!Number.isSafeInteger(r) || r < 0) {
        throw new DomainError("money.allocate_bad_ratio", "ratios must be non-negative integers", { r });
      }
      return BigInt(r);
    });
    const total = rs.reduce((a, b) => a + b, 0n);
    if (total === 0n) throw new DomainError("money.allocate_zero_total", "ratios must not all be zero");

    const neg = this.amountMinor < 0n;
    const amount = neg ? -this.amountMinor : this.amountMinor;
    const base = rs.map((r) => (amount * r) / total);
    const leftover = Number(amount - base.reduce((a, b) => a + b, 0n)); // always < ratios.length
    const byRemainder = rs
      .map((r, i) => ({ i, rem: (amount * r) % total }))
      .sort((a, b) => (b.rem > a.rem ? 1 : b.rem < a.rem ? -1 : a.i - b.i));
    const bump = new Set(byRemainder.slice(0, leftover).map((x) => x.i));
    return base.map((v, i) => {
      const adj = bump.has(i) ? v + 1n : v;
      return new Money(neg ? -adj : adj, this.currency);
    });
  }

  /**
   * Round to a cash step expressed in minor units (e.g. 500n = nearest 5.00 YER), used ONLY for
   * cash change (D-028): mode "down" by default for change in favour of the pharmacy.
   */
  roundToStep(stepMinor: bigint, mode: "down" | "up" | "half_up" = "down"): Money {
    if (stepMinor <= 0n) throw new DomainError("money.bad_step", "step must be positive", { stepMinor: String(stepMinor) });
    const a = this.amountMinor;
    const neg = a < 0n;
    const abs = neg ? -a : a;
    const q = abs / stepMinor;
    const r = abs % stepMinor;
    let rounded: bigint;
    if (r === 0n) rounded = abs;
    else if (mode === "down") rounded = q * stepMinor;
    else if (mode === "up") rounded = (q + 1n) * stepMinor;
    else rounded = (r * 2n >= stepMinor ? q + 1n : q) * stepMinor;
    return new Money(neg ? -rounded : rounded, this.currency);
  }

  // ------------------------------------------------------------------ formatting

  /** Canonical decimal string, e.g. "1250.50", "-3.00". Locale-free; UI formats separately. */
  toDecimalString(): string {
    const scale = CURRENCIES[this.currency].minorUnits;
    const factor = minorFactor(this.currency);
    const neg = this.amountMinor < 0n;
    const abs = neg ? -this.amountMinor : this.amountMinor;
    const intPart = (abs / factor).toString();
    const frac = (abs % factor).toString().padStart(scale, "0");
    return `${neg ? "-" : ""}${intPart}.${frac}`;
  }

  toJSON(): MoneyJSON {
    return { amountMinor: this.amountMinor.toString(), currency: this.currency };
  }

  toString(): string {
    return `${this.toDecimalString()} ${this.currency}`;
  }

  // ------------------------------------------------------------------ aggregates

  static sum(items: readonly Money[], currency?: CurrencyCode): Money {
    if (items.length === 0) {
      if (!currency) throw new DomainError("money.sum_empty", "sum of empty list needs an explicit currency");
      return Money.zero(currency);
    }
    const first = items[0] as Money;
    return items.slice(1).reduce((acc, m) => acc.add(m), first);
  }

  static min(a: Money, b: Money): Money {
    return a.lte(b) ? a : b;
  }
  static max(a: Money, b: Money): Money {
    return a.gte(b) ? a : b;
  }
}

/** Convert Arabic-Indic (٠١٢٣٤٥٦٧٨٩) and Extended (۰-۹) digits to ASCII; ٫ → "." */
export function normalizeDigits(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0) as number; // for-of over a string never yields an empty chunk
    if (c >= 0x0660 && c <= 0x0669) out += String(c - 0x0660);
    else if (c >= 0x06f0 && c <= 0x06f9) out += String(c - 0x06f0);
    else if (ch === "٫") out += ".";
    else if (ch === "٬") out += ",";
    else out += ch;
  }
  return out;
}
