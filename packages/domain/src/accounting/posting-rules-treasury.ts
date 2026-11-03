/**
 * Treasury posting rules (FR-CSH-103/104/106/108/109, FR-SUP-104/105/110, FR-EXP-107).
 * Pure functions: each validates its input and returns a balanced JournalEntry in base currency.
 * Foreign amounts are valued at the supplied `rateScaled` (base units per 1 foreign unit × 10^6),
 * Half-Up once (D-028), and keep a ForeignSnapshot on the funds line (FR-CUR-106).
 * Realised FX differences go to FX_GAIN (credit) / FX_LOSS (debit).
 */
import { minorFactor, type CurrencyCode } from "../money/currency.js";
import { Money, divHalfUp } from "../money/money.js";
import { domainErr, ok, type Result } from "../shared/result.js";
import { RATE_SCALE } from "../fx/exchange-rate.js";
import { ACCOUNT_CODES } from "./chart-of-accounts.js";
import {
  buildJournalEntry,
  type ForeignSnapshot, type JournalEntry, type JournalLineInput, type LineDimensions, type PostingDocumentRef,
} from "./journal-entry.js";
import { fundsAccountCode, fundsDimensions, type EntryMeta, type FundsAccount } from "./posting-common.js";

export interface TreasuryMeta extends EntryMeta {
  readonly documentRef: PostingDocumentRef;
  readonly memo?: string | undefined;
}

// ------------------------------------------------------------------ helpers

type Side = "D" | "C";
interface Line {
  readonly side: Side;
  readonly accountCode: string;
  readonly amount: Money;
  readonly dimensions: LineDimensions;
  readonly foreign: ForeignSnapshot | null;
}
const line = (side: Side, accountCode: string, amount: Money, dimensions: LineDimensions = {}, foreign: ForeignSnapshot | null = null): Line =>
  ({ side, accountCode, amount, dimensions, foreign });

interface Valued { readonly base: Money; readonly foreign: ForeignSnapshot | null }

function valueInBase(amount: Money, rateScaled: bigint | undefined, base: CurrencyCode, field: string): Result<Valued> {
  if (amount.currency === base) return ok({ base: amount, foreign: null });
  if (rateScaled === undefined || rateScaled <= 0n) {
    return domainErr("treasury.rate_required", "A positive rate to base currency is required for foreign amounts", {
      field, currency: amount.currency,
    });
  }
  const minor = divHalfUp(amount.amountMinor * rateScaled * minorFactor(base), RATE_SCALE * minorFactor(amount.currency));
  return ok({ base: Money.minor(minor, base), foreign: { amount, rateScaledSnapshot: rateScaled } });
}

function positive(m: Money, field: string): Result<Money> {
  return m.isPositive() ? ok(m) : domainErr("treasury.amount_not_positive", `${field} must be > 0`, { field, amount: m.toString() });
}

function positiveBase(m: Money, base: CurrencyCode, field: string): Result<Money> {
  if (m.currency !== base) {
    return domainErr("treasury.base_currency_required", `${field} must be in base currency`, { field, expected: base, actual: m.currency });
  }
  return positive(m, field);
}

function accountRequired(code: string | undefined, field: string, errCode = "treasury.account_required"): Result<string> {
  const c = code ?? "";
  return c.trim() === "" ? domainErr(errCode, `${field} is required`, { field }) : ok(c);
}

function fxDiff(gain: Money, dims: LineDimensions): Line[] {
  if (gain.isPositive()) return [line("C", ACCOUNT_CODES.FX_GAIN, gain, dims)];
  if (gain.isNegative()) return [line("D", ACCOUNT_CODES.FX_LOSS, gain.negate(), dims)];
  return [];
}

function toInput(l: Line, memo: string): JournalLineInput {
  return l.side === "D"
    ? { accountCode: l.accountCode, debit: l.amount, memo, dimensions: l.dimensions, foreign: l.foreign }
    : { accountCode: l.accountCode, credit: l.amount, memo, dimensions: l.dimensions, foreign: l.foreign };
}

function post(meta: TreasuryMeta, label: string, lines: readonly Line[]): Result<JournalEntry> {
  const memo = meta.memo ?? `${label} ${meta.documentRef.id}`;
  return buildJournalEntry({
    entryId: meta.entryId, tenantId: meta.tenantId, documentRef: meta.documentRef, postedAt: meta.postedAt,
    currency: meta.baseCurrency, memo,
    lines: lines.filter((l) => !l.amount.isZero()).map((l) => toInput(l, memo)),
  });
}

// ------------------------------------------------------------------ customer receipt

export interface CustomerReceiptInput {
  readonly meta: TreasuryMeta;
  readonly customerId: string;
  readonly via: FundsAccount;
  readonly amount: Money;
  readonly rateScaled?: bigint | undefined;
  /** Base value at which the settled receivable is carried (invoice rate). Defaults to the tender value. */
  readonly receivableBase?: Money | undefined;
}

/** Dr funds (tender) / Cr AR (carried value); difference = realised FX gain/loss. */
export function postCustomerReceipt(i: CustomerReceiptInput): Result<JournalEntry> {
  const base = i.meta.baseCurrency;
  const a = positive(i.amount, "amount");
  if (!a.ok) return a;
  const v = valueInBase(i.amount, i.rateScaled, base, "amount");
  if (!v.ok) return v;
  const ar = i.receivableBase === undefined ? ok(v.value.base) : positiveBase(i.receivableBase, base, "receivableBase");
  if (!ar.ok) return ar;
  const dims = fundsDimensions(i.via);
  return post(i.meta, "Customer receipt", [
    line("D", fundsAccountCode(i.via, i.amount.currency), v.value.base, dims, v.value.foreign),
    line("C", ACCOUNT_CODES.ACCOUNTS_RECEIVABLE, ar.value, { customerId: i.customerId }),
    ...fxDiff(v.value.base.subtract(ar.value), dims),
  ]);
}

// ------------------------------------------------------------------ supplier payment

export interface SupplierPaymentInput {
  readonly meta: TreasuryMeta;
  readonly supplierId: string;
  readonly via: FundsAccount;
  readonly amount: Money;
  readonly rateScaled?: bigint | undefined;
  /** Base value of the payable settled (invoice rate). Defaults to tender value + discount. */
  readonly payableBase?: Money | undefined;
  /** FR-SUP-104 early-payment (cash) discount, base currency. */
  readonly earlyPaymentDiscount?: Money | undefined;
  /** cash_discount_account (OTHER_INCOME) — required when a discount is taken. */
  readonly discountAccountCode?: string | undefined;
}

/** Dr AP / Cr funds / Cr discount income; difference = realised FX gain/loss (FR-SUP-110). */
export function postSupplierPayment(i: SupplierPaymentInput): Result<JournalEntry> {
  const base = i.meta.baseCurrency;
  const a = positive(i.amount, "amount");
  if (!a.ok) return a;
  const v = valueInBase(i.amount, i.rateScaled, base, "amount");
  if (!v.ok) return v;
  let discount = Money.zero(base);
  let discountLines: Line[] = [];
  if (i.earlyPaymentDiscount !== undefined) {
    const d = positiveBase(i.earlyPaymentDiscount, base, "earlyPaymentDiscount");
    if (!d.ok) return d;
    const acc = accountRequired(i.discountAccountCode, "discountAccountCode", "treasury.discount_account_required");
    if (!acc.ok) return acc;
    discount = d.value;
    discountLines = [line("C", acc.value, discount, { supplierId: i.supplierId })];
  }
  const ap = i.payableBase === undefined ? ok(v.value.base.add(discount)) : positiveBase(i.payableBase, base, "payableBase");
  if (!ap.ok) return ap;
  if (discount.gt(ap.value)) {
    return domainErr("treasury.discount_exceeds_payable", "Early-payment discount exceeds the settled payable", {
      discount: discount.toDecimalString(), payable: ap.value.toDecimalString(),
    });
  }
  const dims = fundsDimensions(i.via);
  return post(i.meta, "Supplier payment", [
    line("D", ACCOUNT_CODES.ACCOUNTS_PAYABLE, ap.value, { supplierId: i.supplierId }),
    line("C", fundsAccountCode(i.via, i.amount.currency), v.value.base, dims, v.value.foreign),
    ...discountLines,
    ...fxDiff(ap.value.subtract(discount).subtract(v.value.base), dims),
  ]);
}

// ------------------------------------------------------------------ expense

export type ExpenseCredit =
  | { readonly kind: "FUNDS"; readonly via: FundsAccount }
  | { readonly kind: "PAYABLE"; readonly supplierId: string };

export interface ExpenseInput {
  readonly meta: TreasuryMeta;
  /** GL account linked to the expense category (FR-EXP-101). */
  readonly categoryAccountCode: string;
  /** Amount excluding input VAT; currency must be supported by the paying source (FR-EXP-102). */
  readonly amount: Money;
  readonly inputVat?: Money | undefined;
  readonly vatAccountCode?: string | undefined;
  readonly rateScaled?: bigint | undefined;
  readonly paidFrom: ExpenseCredit;
}

/** Dr expense (+ Dr input VAT) / Cr funds or AP (FR-EXP-107). */
export function postExpense(i: ExpenseInput): Result<JournalEntry> {
  const base = i.meta.baseCurrency;
  const cat = accountRequired(i.categoryAccountCode, "categoryAccountCode");
  if (!cat.ok) return cat;
  const a = positive(i.amount, "amount");
  if (!a.ok) return a;
  let gross = i.amount;
  let vatCode = "";
  if (i.inputVat !== undefined) {
    if (i.inputVat.currency !== i.amount.currency) {
      return domainErr("treasury.currency_mismatch", "Input VAT must be in the expense currency", {
        expected: i.amount.currency, actual: i.inputVat.currency,
      });
    }
    const vat = positive(i.inputVat, "inputVat");
    if (!vat.ok) return vat;
    const acc = accountRequired(i.vatAccountCode, "vatAccountCode", "treasury.vat_account_required");
    if (!acc.ok) return acc;
    vatCode = acc.value;
    gross = gross.add(vat.value);
  }
  const g = valueInBase(gross, i.rateScaled, base, "amount");
  if (!g.ok) return g;
  const n = valueInBase(i.amount, i.rateScaled, base, "amount");
  if (!n.ok) return n;
  const credit = i.paidFrom.kind === "FUNDS"
    ? line("C", fundsAccountCode(i.paidFrom.via, i.amount.currency), g.value.base, fundsDimensions(i.paidFrom.via), g.value.foreign)
    : line("C", ACCOUNT_CODES.ACCOUNTS_PAYABLE, g.value.base, { supplierId: i.paidFrom.supplierId }, g.value.foreign);
  const lines: Line[] = [line("D", cat.value, n.value.base)];
  if (vatCode !== "") lines.push(line("D", vatCode, g.value.base.subtract(n.value.base)));
  lines.push(credit);
  return post(i.meta, "Expense", lines);
}

// ------------------------------------------------------------------ transfers & exchange

interface Leg { readonly via: FundsAccount; readonly amount: Money; readonly rate: bigint | undefined }

function exchangeLines(meta: TreasuryMeta, out: Leg, inn: Leg): Result<Line[]> {
  const base = meta.baseCurrency;
  const o = positive(out.amount, "amount");
  if (!o.ok) return o;
  const n = positive(inn.amount, "toAmount");
  if (!n.ok) return n;
  const ov = valueInBase(out.amount, out.rate, base, "amount");
  if (!ov.ok) return ov;
  const iv = valueInBase(inn.amount, inn.rate, base, "toAmount");
  if (!iv.ok) return iv;
  const dims = fundsDimensions(inn.via);
  return ok([
    line("D", fundsAccountCode(inn.via, inn.amount.currency), iv.value.base, dims, iv.value.foreign),
    line("C", fundsAccountCode(out.via, out.amount.currency), ov.value.base, fundsDimensions(out.via), ov.value.foreign),
    ...fxDiff(iv.value.base.subtract(ov.value.base), dims),
  ]);
}

export interface CashTransferInput {
  readonly meta: TreasuryMeta;
  readonly from: FundsAccount;
  readonly to: FundsAccount;
  readonly amount: Money;
  readonly fromRateScaled?: bigint | undefined;
  /** Amount received when the destination holds another currency; defaults to `amount`. */
  readonly toAmount?: Money | undefined;
  readonly toRateScaled?: bigint | undefined;
}

/** Cashbox/bank/wallet transfer (FR-CSH-103/106/109); cross-currency differences → FX gain/loss. */
export function postCashTransfer(i: CashTransferInput): Result<JournalEntry> {
  const to = i.toAmount ?? i.amount;
  const sameCur = to.currency === i.amount.currency;
  if (sameCur && !to.equals(i.amount)) {
    return domainErr("treasury.transfer_amount_mismatch", "Same-currency transfer must move the same amount", {
      amount: i.amount.toString(), toAmount: to.toString(),
    });
  }
  if (sameCur && i.from.kind === i.to.kind && i.from.id === i.to.id) {
    return domainErr("treasury.same_account", "Cannot transfer to the same account", { id: i.from.id });
  }
  const lines = exchangeLines(
    i.meta,
    { via: i.from, amount: i.amount, rate: i.fromRateScaled },
    { via: i.to, amount: to, rate: sameCur ? i.fromRateScaled : i.toRateScaled },
  );
  if (!lines.ok) return lines;
  return post(i.meta, "Cash transfer", lines.value);
}

export interface FxExchangePostingInput {
  readonly meta: TreasuryMeta;
  readonly cashbox: FundsAccount;
  readonly given: Money;
  /** Book rate of the given currency to base. */
  readonly givenRateScaled?: bigint | undefined;
  readonly received: Money;
  readonly receivedRateScaled?: bigint | undefined;
}

/** Currency exchange inside one cashbox (FR-CSH-104): A out at book value, B in, difference to FX. */
export function postFxExchange(i: FxExchangePostingInput): Result<JournalEntry> {
  if (i.given.currency === i.received.currency) {
    return domainErr("treasury.same_currency", "Currency exchange needs two different currencies", { currency: i.given.currency });
  }
  const lines = exchangeLines(
    i.meta,
    { via: i.cashbox, amount: i.given, rate: i.givenRateScaled },
    { via: i.cashbox, amount: i.received, rate: i.receivedRateScaled },
  );
  if (!lines.ok) return lines;
  return post(i.meta, "Currency exchange", lines.value);
}

// ------------------------------------------------------------------ owner & variance

export interface OwnerTxnInput {
  readonly meta: TreasuryMeta;
  readonly via: FundsAccount;
  readonly amount: Money;
  readonly rateScaled?: bigint | undefined;
}

function ownerTxn(i: OwnerTxnInput, equityCode: string, inbound: boolean, label: string): Result<JournalEntry> {
  const a = positive(i.amount, "amount");
  if (!a.ok) return a;
  const v = valueInBase(i.amount, i.rateScaled, i.meta.baseCurrency, "amount");
  if (!v.ok) return v;
  const funds = line(inbound ? "D" : "C", fundsAccountCode(i.via, i.amount.currency), v.value.base, fundsDimensions(i.via), v.value.foreign);
  const equity = line(inbound ? "C" : "D", equityCode, v.value.base);
  return post(i.meta, label, [funds, equity]);
}

/** Dr OWNER_DRAWINGS / Cr funds — never an operating expense (FR-CSH-108). */
export function postOwnerDrawing(i: OwnerTxnInput): Result<JournalEntry> {
  return ownerTxn(i, ACCOUNT_CODES.OWNER_DRAWINGS, false, "Owner drawing");
}

/** Dr funds / Cr CAPITAL (FR-CSH-108). */
export function postCapitalInjection(i: OwnerTxnInput): Result<JournalEntry> {
  return ownerTxn(i, ACCOUNT_CODES.CAPITAL, true, "Capital injection");
}

export interface CashOverShortInput {
  readonly meta: TreasuryMeta;
  readonly cashbox: FundsAccount;
  /** counted − expected: positive = over, negative = short. */
  readonly variance: Money;
  readonly rateScaled?: bigint | undefined;
  readonly overShortAccountCode: string;
}

/** Shift variance: over → Dr cash / Cr over-short; short → Dr over-short / Cr cash. */
export function postCashOverShort(i: CashOverShortInput): Result<JournalEntry> {
  if (i.variance.isZero()) return domainErr("treasury.zero_variance", "No cash variance to post");
  const acc = accountRequired(i.overShortAccountCode, "overShortAccountCode");
  if (!acc.ok) return acc;
  const v = valueInBase(i.variance.abs(), i.rateScaled, i.meta.baseCurrency, "variance");
  if (!v.ok) return v;
  const over = i.variance.isPositive();
  return post(i.meta, "Cash over/short", [
    line(over ? "D" : "C", fundsAccountCode(i.cashbox, i.variance.currency), v.value.base, fundsDimensions(i.cashbox), v.value.foreign),
    line(over ? "C" : "D", acc.value, v.value.base),
  ]);
}

// ------------------------------------------------------------------ opening balances

export interface OpeningBalanceLine {
  readonly accountCode: string;
  readonly side: "DEBIT" | "CREDIT";
  readonly amount: Money;
  readonly rateScaled?: bigint | undefined;
  readonly dimensions?: LineDimensions | undefined;
}

export interface OpeningBalancesInput {
  readonly meta: TreasuryMeta;
  readonly lines: readonly OpeningBalanceLine[];
  /** Opening-balance equity (e.g. 3900) absorbing the difference. */
  readonly balancingAccountCode: string;
}

export function postOpeningBalances(i: OpeningBalancesInput): Result<JournalEntry> {
  if (i.lines.length === 0) return domainErr("treasury.no_lines", "Opening balances need at least one line");
  const bal = accountRequired(i.balancingAccountCode, "balancingAccountCode");
  if (!bal.ok) return bal;
  const base = i.meta.baseCurrency;
  const out: Line[] = [];
  let diff = Money.zero(base);
  for (const l of i.lines) {
    const code = accountRequired(l.accountCode, "accountCode");
    if (!code.ok) return code;
    const a = positive(l.amount, "amount");
    if (!a.ok) return a;
    const v = valueInBase(l.amount, l.rateScaled, base, "amount");
    if (!v.ok) return v;
    const debit = l.side === "DEBIT";
    out.push(line(debit ? "D" : "C", code.value, v.value.base, l.dimensions ?? {}, v.value.foreign));
    diff = debit ? diff.add(v.value.base) : diff.subtract(v.value.base);
  }
  if (diff.isPositive()) out.push(line("C", bal.value, diff));
  else if (diff.isNegative()) out.push(line("D", bal.value, diff.negate()));
  return post(i.meta, "Opening balances", out);
}
