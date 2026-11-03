/**
 * Shared building blocks for posting rules — ACCOUNTING-DESIGN §1 (principle 4: base-currency
 * ledger, rate stored per line), FR-PUR-110, FR-SUP-105, FR-CSH-101/105/107.
 *
 * `rateScaled` is `rate_scaled_snapshot`: base-currency units per ONE unit of the foreign
 * currency, scaled by 10^6 (RATE_SCALE from fx). 1 USD = 530 YER → 530n * RATE_SCALE.
 * Conversion rounds Half-Up exactly once (A3); the rounded base amount is what gets stored.
 */
import { minorFactor, type CurrencyCode } from "../money/currency.js";
import { Money, divHalfUp } from "../money/money.js";
import { domainErr, ok, type Result } from "../shared/result.js";
import { ACCOUNT_CODES, cashAccountFor } from "./chart-of-accounts.js";
import {
  buildJournalEntry,
  type PostingDocumentRef,
  type ForeignSnapshot,
  type JournalEntry,
  type JournalLineInput,
  type LineDimensions,
} from "./journal-entry.js";

/** Rate scale is owned by the fx module (10^6, canonical dictionary §4). Re-exported for convenience. */
import { RATE_SCALE } from "../fx/exchange-rate.js";
export { RATE_SCALE };

export interface EntryMeta {
  readonly entryId: string;
  readonly tenantId: string;
  readonly postedAt: Date;
  readonly baseCurrency: CurrencyCode;
}

export type FundsKind = "CASH" | "BANK" | "WALLET";

/** Where money physically sits: cashbox (FR-CSH-101), bank account (FR-CSH-105), e-wallet (FR-CSH-107). */
export interface FundsAccount {
  readonly kind: FundsKind;
  readonly id: string;
}

/**
 * One tendered payment. `amount` may be in any currency (rate required when ≠ base).
 * `settlesBase` = base-currency portion of the document this payment settles, at the document's
 * booked rate; defaults to the converted tender (⇒ no FX difference).
 */
export interface PaymentPart {
  readonly via: FundsAccount;
  readonly amount: Money;
  readonly rateScaled?: bigint | undefined;
  readonly settlesBase?: Money | undefined;
}

/** Lot cost snapshot in base currency — C5 specific identification. */
export interface LotCostLine {
  readonly itemId: string;
  readonly lotId: string;
  readonly cost: Money;
}

export interface BaseConversion {
  readonly base: Money;
  readonly rateScaled: bigint;
}

export function isBlank(s: string | undefined): boolean {
  return s === undefined || s.trim() === "";
}

/** Pure arithmetic: amount × rate, Half-Up to base minor units. Caller has validated the rate. */
export function convertAtRate(amount: Money, rateScaled: bigint, base: CurrencyCode): Money {
  const num = amount.amountMinor * rateScaled * minorFactor(base);
  const den = RATE_SCALE * minorFactor(amount.currency);
  return Money.minor(divHalfUp(num, den), base);
}

/** Validate the rate for this amount/base pair and convert. Base amounts need no rate (or exactly 1.0). */
export function toBase(amount: Money, rateScaled: bigint | undefined, base: CurrencyCode): Result<BaseConversion> {
  if (amount.currency === base) {
    if (rateScaled !== undefined && rateScaled !== RATE_SCALE) {
      return domainErr("accounting.invalid_rate", "Base-currency amounts must use rate 1.0", { rateScaled: rateScaled.toString() });
    }
    return ok(Object.freeze({ base: amount, rateScaled: RATE_SCALE }));
  }
  if (rateScaled === undefined) {
    return domainErr("accounting.rate_required", `A rate to ${base} is required for ${amount.currency} amounts`, {
      currency: amount.currency,
      base,
    });
  }
  if (rateScaled <= 0n) {
    return domainErr("accounting.invalid_rate", "Exchange rate must be > 0", { rateScaled: rateScaled.toString() });
  }
  return ok(Object.freeze({ base: convertAtRate(amount, rateScaled, base), rateScaled }));
}

/** Line snapshot of the original currency; null when the amount already is in base. */
export function foreignOf(amount: Money, conv: BaseConversion, base: CurrencyCode): ForeignSnapshot | null {
  return amount.currency === base ? null : Object.freeze({ amount, rateScaledSnapshot: conv.rateScaled });
}

export function requireBaseAmount(m: Money, base: CurrencyCode, field: string, allowZero = true): Result<Money> {
  if (m.currency !== base) {
    return domainErr("accounting.currency_mismatch", `${field} must be in base currency ${base}`, {
      field,
      expected: base,
      actual: m.currency,
    });
  }
  if (m.isNegative()) {
    return domainErr("accounting.negative_amount", `${field} must not be negative`, { field, amount: m.toDecimalString() });
  }
  if (!allowZero && m.isZero()) {
    return domainErr("accounting.non_positive_amount", `${field} must be > 0`, { field });
  }
  return ok(m);
}

export function fundsAccountCode(via: FundsAccount, currency: CurrencyCode): string {
  if (via.kind === "CASH") return cashAccountFor(currency);
  if (via.kind === "BANK") return ACCOUNT_CODES.BANK;
  return ACCOUNT_CODES.WALLET;
}

export function fundsDimensions(via: FundsAccount): LineDimensions {
  if (via.kind === "CASH") return Object.freeze({ cashboxId: via.id });
  if (via.kind === "BANK") return Object.freeze({ bankAccountId: via.id });
  return Object.freeze({ walletId: via.id });
}

export interface ResolvedPayment {
  readonly tenderBase: Money;
  readonly settlesBase: Money;
  readonly accountCode: string;
  readonly dimensions: LineDimensions;
  readonly foreign: ForeignSnapshot | null;
}

export function resolvePayment(part: PaymentPart, base: CurrencyCode): Result<ResolvedPayment> {
  if (isBlank(part.via.id)) {
    return domainErr("accounting.funds_account_required", "A cashbox/bank/wallet id is required", { kind: part.via.kind });
  }
  if (!part.amount.isPositive()) {
    return domainErr("accounting.non_positive_amount", "Payment amount must be > 0", { amount: part.amount.toDecimalString() });
  }
  const conv = toBase(part.amount, part.rateScaled, base);
  if (!conv.ok) return conv;
  const settles = part.settlesBase === undefined ? ok(conv.value.base) : requireBaseAmount(part.settlesBase, base, "settlesBase", false);
  if (!settles.ok) return settles;
  return ok(
    Object.freeze({
      tenderBase: conv.value.base,
      settlesBase: settles.value,
      accountCode: fundsAccountCode(part.via, part.amount.currency),
      dimensions: fundsDimensions(part.via),
      foreign: foreignOf(part.amount, conv.value, base),
    }),
  );
}

/** gain > 0 → Cr 4200 FX gain; gain < 0 → Dr 5400 FX loss; zero → no line (FR-SUP-105). */
export function fxLines(gain: Money, dimensions: LineDimensions, memo: string): JournalLineInput[] {
  if (gain.isZero()) return [];
  if (gain.isPositive()) return [{ accountCode: ACCOUNT_CODES.FX_GAIN, credit: gain, memo: `${memo} (FX gain)`, dimensions }];
  return [{ accountCode: ACCOUNT_CODES.FX_LOSS, debit: gain.abs(), memo: `${memo} (FX loss)`, dimensions }];
}

export type SettlementSide = "RECEIPT" | "PAYMENT";

export interface Settlement {
  readonly lines: JournalLineInput[];
  readonly settledBase: Money;
  readonly outstanding: Money;
}

/**
 * Turn tendered payments into funds lines (+ FX lines) against a document total in base.
 * RECEIPT: Dr funds, gain = tender − settled. PAYMENT: Cr funds, gain = settled − tender.
 * `outstanding` = total − Σ settled (≥ 0; the caller books it to AR/AP).
 */
export function settleDocument(
  totalBase: Money,
  parts: readonly PaymentPart[],
  side: SettlementSide,
  base: CurrencyCode,
  memo: string,
): Result<Settlement> {
  const lines: JournalLineInput[] = [];
  let settled = Money.zero(base);
  for (const part of parts) {
    const p = resolvePayment(part, base);
    if (!p.ok) return p;
    const { accountCode, tenderBase, settlesBase, dimensions, foreign } = p.value;
    lines.push(
      side === "RECEIPT"
        ? { accountCode, debit: tenderBase, memo, dimensions, foreign }
        : { accountCode, credit: tenderBase, memo, dimensions, foreign },
    );
    const gain = side === "RECEIPT" ? tenderBase.subtract(settlesBase) : settlesBase.subtract(tenderBase);
    lines.push(...fxLines(gain, dimensions, memo));
    settled = settled.add(settlesBase);
  }
  const outstanding = totalBase.subtract(settled);
  if (outstanding.isNegative()) {
    return domainErr("accounting.overpayment", "Settled payments exceed the document total", {
      total: totalBase.toDecimalString(),
      settled: settled.toDecimalString(),
    });
  }
  return ok({ lines, settledBase: settled, outstanding });
}

export interface InventoryLines {
  readonly lines: JournalLineInput[];
  readonly total: Money;
}

/** One 1400 line per lot (zero-cost lots such as `zero_cost` bonus are skipped) + Σ cost. */
export function inventoryLotLines(
  lots: readonly LotCostLine[],
  side: "DEBIT" | "CREDIT",
  base: CurrencyCode,
  memo: string,
): Result<InventoryLines> {
  const lines: JournalLineInput[] = [];
  let total = Money.zero(base);
  for (const lot of lots) {
    const cost = requireBaseAmount(lot.cost, base, `cost of lot ${lot.lotId}`);
    if (!cost.ok) return cost;
    if (cost.value.isZero()) continue;
    total = total.add(cost.value);
    const dimensions: LineDimensions = { itemId: lot.itemId, lotId: lot.lotId };
    lines.push(
      side === "DEBIT"
        ? { accountCode: ACCOUNT_CODES.INVENTORY, debit: cost.value, memo, dimensions }
        : { accountCode: ACCOUNT_CODES.INVENTORY, credit: cost.value, memo, dimensions },
    );
  }
  return ok({ lines, total });
}

export function postEntry(meta: EntryMeta, documentRef: PostingDocumentRef, lines: readonly JournalLineInput[], memo: string): Result<JournalEntry> {
  return buildJournalEntry({
    entryId: meta.entryId,
    tenantId: meta.tenantId,
    documentRef,
    postedAt: meta.postedAt,
    currency: meta.baseCurrency,
    lines,
    memo,
  });
}
