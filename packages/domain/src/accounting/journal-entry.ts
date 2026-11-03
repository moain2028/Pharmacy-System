/**
 * JournalEntry — ACCOUNTING-DESIGN §1 (principles 1, 3, 4), §4.1; ENGINEERING-RULES B1, B4, B5.
 *
 * Immutable once built. Invariants enforced by `buildJournalEntry`:
 *  - at least two lines, every line one-sided (debit XOR credit > 0)
 *  - all amounts in the entry's base currency
 *  - every account exists in the chart and is postable
 *  - Σ debit === Σ credit exactly (minor units) → otherwise `accounting.unbalanced` with the diff
 * Corrections never mutate: `reverseJournalEntry` yields a mirrored entry linked through
 * `reversesEntryId` (PR-17).
 */
import type { CurrencyCode } from "../money/currency.js";
import { Money } from "../money/money.js";
import { domainErr, ok, type Result } from "../shared/result.js";
import { getPostableAccount } from "./chart-of-accounts.js";

export interface PostingDocumentRef {
  readonly type: string;
  readonly id: string;
}

/** Analytical dimensions: the GL account stays coarse, parties/lots/cashboxes live here. */
export interface LineDimensions {
  readonly cashboxId?: string | undefined;
  readonly bankAccountId?: string | undefined;
  readonly walletId?: string | undefined;
  readonly customerId?: string | undefined;
  readonly supplierId?: string | undefined;
  readonly itemId?: string | undefined;
  readonly lotId?: string | undefined;
}

/** Original-currency amount + `rate_scaled_snapshot` kept on the line (FR-PUR-110, FR-SUP-105). */
export interface ForeignSnapshot {
  readonly amount: Money;
  readonly rateScaledSnapshot: bigint;
}

export interface JournalLineInput {
  readonly accountCode: string;
  readonly debit?: Money | undefined;
  readonly credit?: Money | undefined;
  readonly memo?: string | undefined;
  readonly dimensions?: LineDimensions | undefined;
  readonly foreign?: ForeignSnapshot | null | undefined;
}

export interface JournalLine {
  readonly accountCode: string;
  readonly debit: Money;
  readonly credit: Money;
  readonly memo: string | null;
  readonly dimensions: LineDimensions;
  readonly foreign: ForeignSnapshot | null;
}

export interface JournalEntryInput {
  readonly entryId: string;
  readonly tenantId: string;
  readonly documentRef: PostingDocumentRef;
  readonly postedAt: Date;
  readonly currency: CurrencyCode;
  readonly lines: readonly JournalLineInput[];
  readonly memo?: string | undefined;
  readonly reversesEntryId?: string | undefined;
}

export interface JournalEntry {
  readonly entryId: string;
  readonly tenantId: string;
  readonly documentRef: PostingDocumentRef;
  readonly postedAt: Date;
  readonly currency: CurrencyCode;
  readonly lines: readonly JournalLine[];
  readonly memo: string | null;
  readonly reversesEntryId: string | null;
  readonly totalDebit: Money;
  readonly totalCredit: Money;
}

function normalizeLine(raw: JournalLineInput, currency: CurrencyCode, index: number): Result<JournalLine> {
  const account = getPostableAccount(raw.accountCode);
  if (!account.ok) return domainErr(account.error.code, account.error.message, { ...account.error.details, line: index });
  for (const m of [raw.debit, raw.credit]) {
    if (m === undefined) continue;
    if (m.currency !== currency) {
      return domainErr("accounting.currency_mismatch", `Line ${index} is in ${m.currency}; entry currency is ${currency}`, {
        line: index,
        expected: currency,
        actual: m.currency,
      });
    }
    if (m.isNegative()) {
      return domainErr("accounting.negative_amount", `Line ${index} has a negative amount`, { line: index, amount: m.toDecimalString() });
    }
  }
  const debit = raw.debit ?? Money.zero(currency);
  const credit = raw.credit ?? Money.zero(currency);
  if (debit.isPositive() && credit.isPositive()) {
    return domainErr("accounting.line_two_sided", `Line ${index} has both a debit and a credit`, { line: index });
  }
  if (debit.isZero() && credit.isZero()) {
    return domainErr("accounting.line_zero", `Line ${index} has neither debit nor credit`, { line: index });
  }
  const foreign = raw.foreign ?? null;
  if (foreign !== null && foreign.rateScaledSnapshot <= 0n) {
    return domainErr("accounting.invalid_rate", `Line ${index} has a non-positive rate snapshot`, { line: index });
  }
  return ok(
    Object.freeze({
      accountCode: raw.accountCode,
      debit,
      credit,
      memo: raw.memo ?? null,
      dimensions: Object.freeze({ ...(raw.dimensions ?? {}) }),
      foreign: foreign === null ? null : Object.freeze({ amount: foreign.amount, rateScaledSnapshot: foreign.rateScaledSnapshot }),
    }),
  );
}

export function buildJournalEntry(input: JournalEntryInput): Result<JournalEntry> {
  if (input.entryId.trim() === "") return domainErr("accounting.invalid_id", "entryId must not be empty", { field: "entryId" });
  if (input.tenantId.trim() === "") return domainErr("accounting.invalid_id", "tenantId must not be empty", { field: "tenantId" });
  if (input.documentRef.type.trim() === "" || input.documentRef.id.trim() === "") {
    return domainErr("accounting.invalid_document_ref", "documentRef needs a type and an id", { documentRef: { ...input.documentRef } });
  }
  if (Number.isNaN(input.postedAt.getTime())) {
    return domainErr("accounting.invalid_posted_at", "postedAt must be a valid date");
  }
  if (input.lines.length < 2) {
    return domainErr("accounting.too_few_lines", "A journal entry needs at least two lines", { count: input.lines.length });
  }
  let debit = Money.zero(input.currency);
  let credit = Money.zero(input.currency);
  const lines: JournalLine[] = [];
  for (let i = 0; i < input.lines.length; i++) {
    const r = normalizeLine(input.lines[i] as JournalLineInput, input.currency, i);
    if (!r.ok) return r;
    lines.push(r.value);
    debit = debit.add(r.value.debit);
    credit = credit.add(r.value.credit);
  }
  if (!debit.equals(credit)) {
    return domainErr(
      "accounting.unbalanced",
      `Journal entry is unbalanced: debit ${debit.toDecimalString()} ≠ credit ${credit.toDecimalString()}`,
      { debit: debit.toDecimalString(), credit: credit.toDecimalString(), diff: debit.subtract(credit).toDecimalString() },
    );
  }
  return ok(
    Object.freeze({
      entryId: input.entryId,
      tenantId: input.tenantId,
      documentRef: Object.freeze({ type: input.documentRef.type, id: input.documentRef.id }),
      postedAt: new Date(input.postedAt.getTime()),
      currency: input.currency,
      lines: Object.freeze(lines),
      memo: input.memo ?? null,
      reversesEntryId: input.reversesEntryId ?? null,
      totalDebit: debit,
      totalCredit: credit,
    }),
  );
}

export interface ReversalRequest {
  readonly entryId: string;
  readonly reason: string;
  readonly at: Date;
}

/** PR-17: new entry with Dr/Cr swapped on every line, `reversesEntryId` = original. */
export function reverseJournalEntry(entry: JournalEntry, req: ReversalRequest): Result<JournalEntry> {
  if (req.reason.trim() === "") {
    return domainErr("accounting.reversal_reason_required", "A reversal needs a recorded reason", { entryId: entry.entryId });
  }
  if (Number.isNaN(req.at.getTime()) || req.at.getTime() < entry.postedAt.getTime()) {
    return domainErr("accounting.reversal_before_original", "A reversal cannot be dated before the original entry", {
      entryId: entry.entryId,
    });
  }
  const lines: JournalLineInput[] = entry.lines.map((l) => ({
    accountCode: l.accountCode,
    debit: l.credit,
    credit: l.debit,
    memo: l.memo ?? undefined,
    dimensions: l.dimensions,
    foreign: l.foreign,
  }));
  return buildJournalEntry({
    entryId: req.entryId,
    tenantId: entry.tenantId,
    documentRef: entry.documentRef,
    postedAt: req.at,
    currency: entry.currency,
    lines,
    memo: req.reason,
    reversesEntryId: entry.entryId,
  });
}
