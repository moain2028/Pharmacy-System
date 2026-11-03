import type { Sql } from "@pharmacore/db";
import { ExchangeRate, Money, RATE_SCALE, type CurrencyCode, type JournalEntry } from "@pharmacore/domain";
import { ApiError } from "./errors.js";

/** Shared JSON serializer: bigint → string, Money → {currency, amountMinor}. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const J = (v: unknown): any =>
  JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x instanceof Money ? { currency: x.currency, amountMinor: x.amountMinor.toString() } : x)));

/** Writes a domain JournalEntry (header + lines) inside the caller's transaction. */
export async function persistEntry(tx: Sql, tenantId: string, e: JournalEntry, businessDate: string, actorId: string): Promise<void> {
  const [n] = await tx<{ n: string }[]>`SELECT next_document_number(${tenantId}, 'JOURNAL', '') AS n`;
  await tx`INSERT INTO journal_entries (id, tenant_id, entry_no, document_type, document_id, business_date, posted_at, base_currency, memo, created_by)
    VALUES (${e.entryId}, ${tenantId}, ${Number(n!.n.replace(/\D/g, ""))}, ${e.documentRef.type}, ${e.documentRef.id}, ${businessDate}, ${e.postedAt}, ${e.currency}, ${e.memo}, ${actorId})`;
  for (const [i, l] of e.lines.entries()) {
    await tx`INSERT INTO journal_lines (tenant_id, entry_id, line_no, account_code, debit_minor, credit_minor, original_currency, original_amount_minor, rate_scaled_snapshot, memo, dim_cashbox_id, dim_customer_id, dim_supplier_id, dim_item_id, dim_lot_id)
      VALUES (${tenantId}, ${e.entryId}, ${i + 1}, ${l.accountCode}, ${l.debit.amountMinor.toString()}, ${l.credit.amountMinor.toString()}, ${l.foreign?.amount.currency ?? null}, ${l.foreign?.amount.amountMinor.toString() ?? null}, ${l.foreign?.rateScaledSnapshot.toString() ?? null}, ${l.memo},
              ${l.dimensions.cashboxId ?? null}, ${l.dimensions.customerId ?? null}, ${l.dimensions.supplierId ?? null}, ${l.dimensions.itemId ?? null}, ${l.dimensions.lotId ?? null})`;
  }
}

interface RateRow { from_currency: CurrencyCode; to_currency: CurrencyCode; buy_rate_scaled: string; sell_rate_scaled: string; effective_from: Date }

/** Latest effective exchange rate `from → to`; 409 `fx.rate_missing` when none. */
export async function rateFor(tx: Sql, from: CurrencyCode, to: CurrencyCode): Promise<ExchangeRate> {
  const [r] = await tx<RateRow[]>`SELECT * FROM exchange_rates WHERE from_currency = ${from} AND to_currency = ${to} AND effective_from <= now() ORDER BY effective_from DESC LIMIT 1`;
  if (!r) throw ApiError.conflict("fx.rate_missing", `No exchange rate ${from}→${to}`, { from, to });
  const er = ExchangeRate.create({ from: r.from_currency, to: r.to_currency, buyRateScaled: BigInt(r.buy_rate_scaled), sellRateScaled: BigInt(r.sell_rate_scaled), effectiveFrom: r.effective_from });
  if (!er.ok) throw er.error;
  return er.value;
}

/** amount × rateScaled / RATE_SCALE, Half-Up, in `to`. */
export function convertScaled(amount: Money, rateScaled: bigint, to: CurrencyCode): Money {
  const num = amount.amountMinor * rateScaled; const den = RATE_SCALE; const q = num / den; const rem = num % den;
  return Money.minor(q + (rem * 2n >= den ? 1n : 0n), to);
}

/** Converts `m` to base using the sell rate (what the pharmacy values foreign cash at); identity when already base. */
export async function toBase(tx: Sql, m: Money, base: CurrencyCode): Promise<Money> {
  if (m.currency === base) return m;
  return convertScaled(m, (await rateFor(tx, m.currency, base)).sellRateScaled, base);
}
