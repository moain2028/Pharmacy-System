import { describe, expect, it } from "vitest";
import type { CurrencyCode } from "../money/currency.js";
import { Money } from "../money/money.js";
import { unwrap, type Result } from "../shared/result.js";
import { RATE_SCALE } from "../fx/exchange-rate.js";
import { ACCOUNT_CODES as C } from "./chart-of-accounts.js";
import type { JournalEntry } from "./journal-entry.js";
import { fundsDimensions, type FundsAccount } from "./posting-common.js";
import {
  postCapitalInjection, postCashOverShort, postCashTransfer, postCustomerReceipt, postExpense, postFxExchange,
  postOpeningBalances, postOwnerDrawing, postSupplierPayment, type TreasuryMeta,
} from "./posting-rules-treasury.js";

const meta = (memo?: string): TreasuryMeta => ({
  entryId: "e-1", tenantId: "t-1", postedAt: new Date("2026-01-05T10:00:00Z"), baseCurrency: "YER_NEW",
  documentRef: { type: "TREASURY", id: "doc-1" }, ...(memo === undefined ? {} : { memo }),
});
const m = (n: number, c: CurrencyCode): Money => Money.minor(BigInt(n) * 100n, c);
const y = (n: number): Money => m(n, "YER_NEW");
const usd = (n: number): Money => m(n, "USD");
const sar = (n: number): Money => m(n, "SAR");
const R = (n: bigint): bigint => n * RATE_SCALE;
const cash: FundsAccount = { kind: "CASH", id: "cb-cashier" };
const safe: FundsAccount = { kind: "CASH", id: "cb-safe" };
const bank: FundsAccount = { kind: "BANK", id: "bk-1" };
const dr = (code: string, amt: string): string => `${code} D ${amt}`;
const cr = (code: string, amt: string): string => `${code} C ${amt}`;

function sig(r: Result<JournalEntry>): string[] {
  const e = unwrap(r);
  return e.lines
    .map((l) => (l.debit.isZero() ? cr(l.accountCode, l.credit.toDecimalString()) : dr(l.accountCode, l.debit.toDecimalString())))
    .sort();
}

describe("treasury posting rules — balanced entries", () => {
  it.each<[string, () => Result<JournalEntry>, string[]]>([
    ["receipt base", () => postCustomerReceipt({ meta: meta(), customerId: "c1", via: cash, amount: y(10000) }),
      [dr(C.CASH_YER_NEW, "10000.00"), cr(C.ACCOUNTS_RECEIVABLE, "10000.00")]],
    ["receipt 100 USD @540 vs 53,000 → gain 1,000", () => postCustomerReceipt({ meta: meta(), customerId: "c1", via: cash, amount: usd(100), rateScaled: R(540n), receivableBase: y(53000) }),
      [dr(C.CASH_USD, "54000.00"), cr(C.ACCOUNTS_RECEIVABLE, "53000.00"), cr(C.FX_GAIN, "1000.00")]],
    ["receipt @520 → loss", () => postCustomerReceipt({ meta: meta(), customerId: "c1", via: cash, amount: usd(100), rateScaled: R(520n), receivableBase: y(53000) }),
      [dr(C.CASH_USD, "52000.00"), dr(C.FX_LOSS, "1000.00"), cr(C.ACCOUNTS_RECEIVABLE, "53000.00")]],
    ["supplier payment 53,000 cash", () => postSupplierPayment({ meta: meta(), supplierId: "s1", via: safe, amount: y(53000) }),
      [dr(C.ACCOUNTS_PAYABLE, "53000.00"), cr(C.CASH_YER_NEW, "53000.00")]],
    ["FR-SUP-105: 100 USD @540 vs 53,000 → loss 1,000", () => postSupplierPayment({ meta: meta(), supplierId: "s1", via: safe, amount: usd(100), rateScaled: R(540n), payableBase: y(53000) }),
      [dr(C.ACCOUNTS_PAYABLE, "53000.00"), dr(C.FX_LOSS, "1000.00"), cr(C.CASH_USD, "54000.00")]],
    ["supplier @520 → gain", () => postSupplierPayment({ meta: meta(), supplierId: "s1", via: safe, amount: usd(100), rateScaled: R(520n), payableBase: y(53000) }),
      [dr(C.ACCOUNTS_PAYABLE, "53000.00"), cr(C.CASH_USD, "52000.00"), cr(C.FX_GAIN, "1000.00")]],
    ["FR-SUP-104: 2% of 100,000 early discount", () => postSupplierPayment({ meta: meta(), supplierId: "s1", via: bank, amount: y(98000), payableBase: y(100000), earlyPaymentDiscount: y(2000), discountAccountCode: "4300" }),
      [dr(C.ACCOUNTS_PAYABLE, "100000.00"), cr(C.BANK, "98000.00"), cr("4300", "2000.00")]],
    ["discount with default payable", () => postSupplierPayment({ meta: meta(), supplierId: "s1", via: safe, amount: y(98000), earlyPaymentDiscount: y(2000), discountAccountCode: "4300" }),
      [dr(C.ACCOUNTS_PAYABLE, "100000.00"), cr(C.CASH_YER_NEW, "98000.00"), cr("4300", "2000.00")]],
    ["FR-EXP-107: electricity 15,000 from cashbox", () => postExpense({ meta: meta(), categoryAccountCode: "5510", amount: y(15000), paidFrom: { kind: "FUNDS", via: cash } }),
      [dr("5510", "15000.00"), cr(C.CASH_YER_NEW, "15000.00")]],
    ["expense + input VAT on credit", () => postExpense({ meta: meta(), categoryAccountCode: "5510", amount: y(10000), inputVat: y(1500), vatAccountCode: "1500", paidFrom: { kind: "PAYABLE", supplierId: "s1" } }),
      [dr("5510", "10000.00"), dr("1500", "1500.00"), cr(C.ACCOUNTS_PAYABLE, "11500.00")]],
    ["expense 100 SAR @140", () => postExpense({ meta: meta(), categoryAccountCode: "5510", amount: sar(100), rateScaled: R(140n), paidFrom: { kind: "FUNDS", via: cash } }),
      [dr("5510", "14000.00"), cr(C.CASH_SAR, "14000.00")]],
    ["VAT rounding to zero base drops the line", () => postExpense({ meta: meta(), categoryAccountCode: "5510", amount: sar(100), inputVat: Money.minor(1n, "SAR"), vatAccountCode: "1500", rateScaled: 400_000n, paidFrom: { kind: "FUNDS", via: cash } }),
      [dr("5510", "40.00"), cr(C.CASH_SAR, "40.00")]],
    ["FR-CSH-103: 50,000 cashier → safe", () => postCashTransfer({ meta: meta(), from: cash, to: safe, amount: y(50000) }),
      [dr(C.CASH_YER_NEW, "50000.00"), cr(C.CASH_YER_NEW, "50000.00")]],
    ["FR-CSH-109: deposit 100,000 safe → bank", () => postCashTransfer({ meta: meta(), from: safe, to: bank, amount: y(100000) }),
      [dr(C.BANK, "100000.00"), cr(C.CASH_YER_NEW, "100000.00")]],
    ["same-currency SAR transfer ignores toRate", () => postCashTransfer({ meta: meta(), from: safe, to: cash, amount: sar(100), fromRateScaled: R(140n), toRateScaled: R(150n) }),
      [dr(C.CASH_SAR, "14000.00"), cr(C.CASH_SAR, "14000.00")]],
    ["cross-currency transfer → gain 200", () => postCashTransfer({ meta: meta(), from: safe, to: bank, amount: sar(100), fromRateScaled: R(140n), toAmount: y(14200) }),
      [dr(C.BANK, "14200.00"), cr(C.CASH_SAR, "14000.00"), cr(C.FX_GAIN, "200.00")]],
    ["FR-CSH-104: 100 SAR → 14,000 YER @140", () => postFxExchange({ meta: meta(), cashbox: safe, given: sar(100), givenRateScaled: R(140n), received: y(14000) }),
      [dr(C.CASH_YER_NEW, "14000.00"), cr(C.CASH_SAR, "14000.00")]],
    ["exchange at book 138 → gain 200", () => postFxExchange({ meta: meta(), cashbox: safe, given: sar(100), givenRateScaled: R(138n), received: y(14000) }),
      [dr(C.CASH_YER_NEW, "14000.00"), cr(C.CASH_SAR, "13800.00"), cr(C.FX_GAIN, "200.00")]],
    ["YER_OLD → YER_NEW at 0.25 → loss 100", () => postFxExchange({ meta: meta(), cashbox: safe, given: m(10000, "YER_OLD"), givenRateScaled: 250_000n, received: y(2400) }),
      [dr(C.CASH_YER_NEW, "2400.00"), dr(C.FX_LOSS, "100.00"), cr(C.CASH_YER_OLD, "2500.00")]],
    ["FR-CSH-108: owner drawing 20,000", () => postOwnerDrawing({ meta: meta(), via: safe, amount: y(20000) }),
      [dr(C.OWNER_DRAWINGS, "20000.00"), cr(C.CASH_YER_NEW, "20000.00")]],
    ["capital 1,000 USD @530 into bank", () => postCapitalInjection({ meta: meta(), via: bank, amount: usd(1000), rateScaled: R(530n) }),
      [dr(C.BANK, "530000.00"), cr(C.CAPITAL, "530000.00")]],
    ["cash over 500", () => postCashOverShort({ meta: meta(), cashbox: cash, variance: y(500), overShortAccountCode: "5530" }),
      [dr(C.CASH_YER_NEW, "500.00"), cr("5530", "500.00")]],
    ["cash short 300", () => postCashOverShort({ meta: meta(), cashbox: cash, variance: y(-300), overShortAccountCode: "5530" }),
      [dr("5530", "300.00"), cr(C.CASH_YER_NEW, "300.00")]],
    ["opening: debits exceed credits", () => postOpeningBalances({ meta: meta(), balancingAccountCode: "3100", lines: [
      { accountCode: C.CASH_YER_NEW, side: "DEBIT", amount: y(500000), dimensions: { cashboxId: "cb-safe" } },
      { accountCode: "1400", side: "DEBIT", amount: y(1000000) },
      { accountCode: C.ACCOUNTS_PAYABLE, side: "CREDIT", amount: y(300000) }] }),
    [dr(C.CASH_YER_NEW, "500000.00"), dr("1400", "1000000.00"), cr(C.ACCOUNTS_PAYABLE, "300000.00"), cr("3100", "1200000.00")]],
    ["opening: credits exceed debits", () => postOpeningBalances({ meta: meta(), balancingAccountCode: "3100", lines: [{ accountCode: C.ACCOUNTS_PAYABLE, side: "CREDIT", amount: y(300000) }] }),
      [dr("3100", "300000.00"), cr(C.ACCOUNTS_PAYABLE, "300000.00")]],
    ["opening: already balanced + USD line", () => postOpeningBalances({ meta: meta(), balancingAccountCode: "3100", lines: [
      { accountCode: C.CASH_USD, side: "DEBIT", amount: usd(100), rateScaled: R(530n) },
      { accountCode: C.ACCOUNTS_PAYABLE, side: "CREDIT", amount: y(53000) }] }),
    [dr(C.CASH_USD, "53000.00"), cr(C.ACCOUNTS_PAYABLE, "53000.00")]],
  ])("%s", (_name, run, expected) => {
    expect(sig(run())).toEqual([...expected].sort());
  });

  it("snapshots foreign amount, dimensions and memo", () => {
    const e = unwrap(postCustomerReceipt({ meta: meta("custom"), customerId: "c1", via: cash, amount: usd(100), rateScaled: R(540n), receivableBase: y(53000) }));
    expect(e.memo).toBe("custom");
    const cashLine = e.lines.find((l) => l.accountCode === C.CASH_USD);
    expect(cashLine?.foreign?.amount.equals(usd(100))).toBe(true);
    expect(cashLine?.foreign?.rateScaledSnapshot).toBe(R(540n));
    expect(cashLine?.dimensions).toEqual(fundsDimensions(cash));
    expect(e.lines.find((l) => l.accountCode === C.ACCOUNTS_RECEIVABLE)?.dimensions.customerId).toBe("c1");
    expect(e.totalDebit.equals(e.totalCredit)).toBe(true);
    expect(unwrap(postOwnerDrawing({ meta: meta(), via: safe, amount: y(1) })).memo).toBe("Owner drawing doc-1");
  });
});

describe("treasury posting rules — rejections", () => {
  const pay = { meta: meta(), supplierId: "s1", via: safe } as const;
  const exp = { meta: meta(), categoryAccountCode: "5510", paidFrom: { kind: "FUNDS", via: cash } } as const;
  const ob = (amount: Money, accountCode = "1100") => ({ meta: meta(), balancingAccountCode: "3100", lines: [{ accountCode, side: "DEBIT" as const, amount }] });
  it.each<[string, () => Result<JournalEntry>, string]>([
    ["receipt zero", () => postCustomerReceipt({ meta: meta(), customerId: "c", via: cash, amount: y(0) }), "treasury.amount_not_positive"],
    ["receipt no rate", () => postCustomerReceipt({ meta: meta(), customerId: "c", via: cash, amount: usd(1) }), "treasury.rate_required"],
    ["receipt bad rate", () => postCustomerReceipt({ meta: meta(), customerId: "c", via: cash, amount: usd(1), rateScaled: 0n }), "treasury.rate_required"],
    ["receivable not base", () => postCustomerReceipt({ meta: meta(), customerId: "c", via: cash, amount: y(1), receivableBase: usd(1) }), "treasury.base_currency_required"],
    ["receivable zero", () => postCustomerReceipt({ meta: meta(), customerId: "c", via: cash, amount: y(1), receivableBase: y(0) }), "treasury.amount_not_positive"],
    ["payment negative", () => postSupplierPayment({ ...pay, amount: y(-1) }), "treasury.amount_not_positive"],
    ["payment no rate", () => postSupplierPayment({ ...pay, amount: usd(1) }), "treasury.rate_required"],
    ["discount no account", () => postSupplierPayment({ ...pay, amount: y(98), earlyPaymentDiscount: y(2) }), "treasury.discount_account_required"],
    ["discount blank account", () => postSupplierPayment({ ...pay, amount: y(98), earlyPaymentDiscount: y(2), discountAccountCode: " " }), "treasury.discount_account_required"],
    ["discount not base", () => postSupplierPayment({ ...pay, amount: y(98), earlyPaymentDiscount: usd(2), discountAccountCode: "4300" }), "treasury.base_currency_required"],
    ["discount > payable", () => postSupplierPayment({ ...pay, amount: y(98), payableBase: y(1), earlyPaymentDiscount: y(2), discountAccountCode: "4300" }), "treasury.discount_exceeds_payable"],
    ["payable not base", () => postSupplierPayment({ ...pay, amount: y(1), payableBase: sar(1) }), "treasury.base_currency_required"],
    ["expense blank category", () => postExpense({ ...exp, categoryAccountCode: "", amount: y(1) }), "treasury.account_required"],
    ["expense zero", () => postExpense({ ...exp, amount: y(0) }), "treasury.amount_not_positive"],
    ["vat currency", () => postExpense({ ...exp, amount: y(1), inputVat: sar(1), vatAccountCode: "1500" }), "treasury.currency_mismatch"],
    ["vat zero", () => postExpense({ ...exp, amount: y(1), inputVat: y(0), vatAccountCode: "1500" }), "treasury.amount_not_positive"],
    ["vat no account", () => postExpense({ ...exp, amount: y(1), inputVat: y(1) }), "treasury.vat_account_required"],
    ["expense no rate", () => postExpense({ ...exp, amount: sar(1) }), "treasury.rate_required"],
    ["same account", () => postCashTransfer({ meta: meta(), from: cash, to: cash, amount: y(1) }), "treasury.same_account"],
    ["amount mismatch", () => postCashTransfer({ meta: meta(), from: cash, to: safe, amount: y(1), toAmount: y(2) }), "treasury.transfer_amount_mismatch"],
    ["transfer zero", () => postCashTransfer({ meta: meta(), from: cash, to: safe, amount: y(0) }), "treasury.amount_not_positive"],
    ["transfer toAmount zero", () => postCashTransfer({ meta: meta(), from: cash, to: safe, amount: y(1), toAmount: sar(0) }), "treasury.amount_not_positive"],
    ["transfer from no rate", () => postCashTransfer({ meta: meta(), from: cash, to: safe, amount: sar(1), toAmount: y(1) }), "treasury.rate_required"],
    ["transfer to no rate", () => postCashTransfer({ meta: meta(), from: cash, to: safe, amount: y(1), toAmount: usd(1) }), "treasury.rate_required"],
    ["exchange same currency", () => postFxExchange({ meta: meta(), cashbox: safe, given: y(1), received: y(1) }), "treasury.same_currency"],
    ["drawing zero", () => postOwnerDrawing({ meta: meta(), via: safe, amount: y(0) }), "treasury.amount_not_positive"],
    ["capital no rate", () => postCapitalInjection({ meta: meta(), via: bank, amount: usd(1) }), "treasury.rate_required"],
    ["zero variance", () => postCashOverShort({ meta: meta(), cashbox: cash, variance: y(0), overShortAccountCode: "5530" }), "treasury.zero_variance"],
    ["variance blank account", () => postCashOverShort({ meta: meta(), cashbox: cash, variance: y(1), overShortAccountCode: "" }), "treasury.account_required"],
    ["variance no rate", () => postCashOverShort({ meta: meta(), cashbox: cash, variance: sar(1), overShortAccountCode: "5530" }), "treasury.rate_required"],
    ["opening empty", () => postOpeningBalances({ meta: meta(), balancingAccountCode: "3100", lines: [] }), "treasury.no_lines"],
    ["opening blank balancing", () => postOpeningBalances({ ...ob(y(1)), balancingAccountCode: "" }), "treasury.account_required"],
    ["opening blank account", () => postOpeningBalances(ob(y(1), "")), "treasury.account_required"],
    ["opening zero", () => postOpeningBalances(ob(y(0))), "treasury.amount_not_positive"],
    ["opening no rate", () => postOpeningBalances(ob(usd(1))), "treasury.rate_required"],
  ])("%s", (_name, run, code) => {
    const r = run();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe(code);
  });
});
