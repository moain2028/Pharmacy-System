import { describe, expect, it } from "vitest";
import { Money } from "../money/money.js";
import { unwrap, type Result } from "../shared/result.js";
import { ACCOUNT_CODES as A } from "./chart-of-accounts.js";
import type { JournalEntry } from "./journal-entry.js";
import { RATE_SCALE, type EntryMeta, type PaymentPart } from "./posting-common.js";
import {
  customerPaymentPosted,
  salesInvoicePosted,
  salesReturnPosted,
  type CustomerPaymentPosted,
  type SalesInvoicePosted,
  type SalesReturnPosted,
} from "./posting-rules-sales.js";

const BASE = "YER_NEW" as const;
const Y = (s: string): Money => unwrap(Money.parse(s, BASE));
const SAR = (s: string): Money => unwrap(Money.parse(s, "SAR"));
const USD = (s: string): Money => unwrap(Money.parse(s, "USD"));
const rate = (n: bigint): bigint => n * RATE_SCALE;
const codeOf = (r: Result<unknown>): string => (r.ok ? "ok" : r.error.code);
const meta: EntryMeta = { entryId: "je-1", tenantId: "t-1", postedAt: new Date("2026-01-15T10:00:00Z"), baseCurrency: BASE };
const cash = (amount: Money, extra: Partial<PaymentPart> = {}): PaymentPart => ({ via: { kind: "CASH", id: "cb-1" }, amount, ...extra });
const sum = (e: JournalEntry, code: string, side: "debit" | "credit"): string =>
  Money.sum(e.lines.filter((l) => l.accountCode === code).map((l) => l[side]), BASE).toDecimalString();

const pr01: SalesInvoicePosted = {
  invoiceId: "inv-1",
  customerId: "cust-x",
  gross: Y("4500.00"),
  discount: Y("200.00"),
  outputVat: Y("0.00"),
  payments: [cash(Y("4300.00"))],
  cogs: [
    { itemId: "i1", lotId: "l1", cost: Y("1900.00") },
    { itemId: "i2", lotId: "l2", cost: Y("1000.00") },
  ],
  discountPosting: "GROSS",
};

describe("salesInvoicePosted", () => {
  it("PR-01 cash sale: Dr 1100 4,300 · Dr 4120 200 · Cr 4100 4,500 · Dr 5100 2,900 · Cr 1400 2,900", () => {
    const e = unwrap(salesInvoicePosted(meta, pr01));
    expect(sum(e, A.CASH_YER_NEW, "debit")).toBe("4300.00");
    expect(sum(e, A.DISCOUNTS_ALLOWED, "debit")).toBe("200.00");
    expect(sum(e, A.SALES, "credit")).toBe("4500.00");
    expect(sum(e, A.COGS, "debit")).toBe("2900.00");
    expect(sum(e, A.INVENTORY, "credit")).toBe("2900.00");
    expect(e.totalDebit.toDecimalString()).toBe("7400.00");
    expect(e.totalCredit.toDecimalString()).toBe("7400.00");
    expect(e.lines.filter((l) => l.accountCode === A.INVENTORY).map((l) => l.dimensions.lotId)).toEqual(["l1", "l2"]);
    expect(e.lines[0]?.dimensions).toEqual({ cashboxId: "cb-1" });
    expect(e.documentRef).toEqual({ type: "sales_invoice", id: "inv-1" });
    expect(e.lines.some((l) => l.accountCode === A.ACCOUNTS_RECEIVABLE)).toBe(false);
  });

  it("golden: 1,250.00 net, COGS 800.00, cash → exactly four balanced lines", () => {
    const e = unwrap(
      salesInvoicePosted(meta, { ...pr01, gross: Y("1250.00"), discount: Y("0.00"), payments: [cash(Y("1250.00"))], cogs: [{ itemId: "i", lotId: "l", cost: Y("800.00") }] }),
    );
    expect(e.lines.map((l) => [l.accountCode, l.debit.toDecimalString(), l.credit.toDecimalString()])).toEqual([
      [A.CASH_YER_NEW, "1250.00", "0.00"],
      [A.SALES, "0.00", "1250.00"],
      [A.COGS, "800.00", "0.00"],
      [A.INVENTORY, "0.00", "800.00"],
    ]);
  });

  it("PR-02 partial credit sale books the remainder to AR with the customer dimension (NET posting)", () => {
    const e = unwrap(salesInvoicePosted(meta, { ...pr01, discount: Y("0.00"), gross: Y("4300.00"), payments: [cash(Y("1000.00"))], discountPosting: "NET" }));
    expect(sum(e, A.CASH_YER_NEW, "debit")).toBe("1000.00");
    expect(sum(e, A.ACCOUNTS_RECEIVABLE, "debit")).toBe("3300.00");
    expect(e.lines.find((l) => l.accountCode === A.ACCOUNTS_RECEIVABLE)?.dimensions).toEqual({ customerId: "cust-x" });
    expect(sum(e, A.SALES, "credit")).toBe("4300.00");
    expect(sum(e, A.DISCOUNTS_ALLOWED, "debit")).toBe("0.00");
    expect(e.totalDebit.equals(e.totalCredit)).toBe(true);
  });

  it("NET posting with a discount credits net sales only", () => {
    const e = unwrap(salesInvoicePosted(meta, { ...pr01, discountPosting: "NET" }));
    expect(sum(e, A.SALES, "credit")).toBe("4300.00");
    expect(e.lines.some((l) => l.accountCode === A.DISCOUNTS_ALLOWED)).toBe(false);
  });

  it("a fully discounted NET sale posts only the COGS side", () => {
    const e = unwrap(salesInvoicePosted(meta, { ...pr01, discount: Y("4500.00"), payments: [], discountPosting: "NET" }));
    expect(e.lines.map((l) => l.accountCode)).toEqual([A.COGS, A.INVENTORY, A.INVENTORY]);
  });

  it("skips COGS when all lots are zero-cost bonus and posts VAT when present", () => {
    const e = unwrap(salesInvoicePosted(meta, { ...pr01, outputVat: Y("215.00"), payments: [cash(Y("4515.00"))], cogs: [{ itemId: "i", lotId: "l", cost: Y("0.00") }] }));
    expect(sum(e, A.OUTPUT_VAT, "credit")).toBe("215.00");
    expect(e.lines.some((l) => l.accountCode === A.COGS)).toBe(false);
    expect(e.totalDebit.toDecimalString()).toBe("4715.00");
  });

  it("PR-15 sale collected in SAR: Dr 1200 43,000 with the SAR snapshot", () => {
    const e = unwrap(salesInvoicePosted(meta, { ...pr01, gross: Y("43000.00"), discount: Y("0.00"), payments: [cash(SAR("100.00"), { rateScaled: rate(430n) })] }));
    const l = e.lines.find((x) => x.accountCode === A.CASH_SAR);
    expect(l?.debit.toDecimalString()).toBe("43000.00");
    expect(l?.foreign).toEqual({ amount: SAR("100.00"), rateScaledSnapshot: rate(430n) });
    expect(sum(e, A.SALES, "credit")).toBe("43000.00");
  });

  it("books an FX gain when the foreign tender exceeds what it settles", () => {
    const e = unwrap(salesInvoicePosted(meta, { ...pr01, gross: Y("43000.00"), discount: Y("0.00"), payments: [cash(SAR("100.00"), { rateScaled: rate(440n), settlesBase: Y("43000.00") })] }));
    expect(sum(e, A.CASH_SAR, "debit")).toBe("44000.00");
    expect(sum(e, A.FX_GAIN, "credit")).toBe("1000.00");
  });

  it("rejects invalid events", () => {
    expect(codeOf(salesInvoicePosted(meta, { ...pr01, gross: SAR("1.00") }))).toBe("accounting.currency_mismatch");
    expect(codeOf(salesInvoicePosted(meta, { ...pr01, gross: Y("0.00") }))).toBe("accounting.non_positive_amount");
    expect(codeOf(salesInvoicePosted(meta, { ...pr01, discount: Y("-1.00") }))).toBe("accounting.negative_amount");
    expect(codeOf(salesInvoicePosted(meta, { ...pr01, outputVat: SAR("1.00") }))).toBe("accounting.currency_mismatch");
    expect(codeOf(salesInvoicePosted(meta, { ...pr01, discount: Y("4500.01") }))).toBe("accounting.discount_exceeds_gross");
    expect(codeOf(salesInvoicePosted(meta, { ...pr01, payments: [cash(Y("4300.01"))] }))).toBe("accounting.overpayment");
    expect(codeOf(salesInvoicePosted(meta, { ...pr01, customerId: undefined, payments: [] }))).toBe("accounting.customer_required");
    expect(codeOf(salesInvoicePosted(meta, { ...pr01, cogs: [{ itemId: "i", lotId: "l", cost: SAR("1.00") }] }))).toBe("accounting.currency_mismatch");
    expect(codeOf(salesInvoicePosted(meta, { ...pr01, payments: [cash(USD("10.00"))] }))).toBe("accounting.rate_required");
  });
});

const pr04: SalesReturnPosted = {
  returnId: "ret-1",
  originalInvoiceId: "inv-1",
  customerId: "cust-x",
  returnedNet: Y("1500.00"),
  outputVat: Y("0.00"),
  refunds: [cash(Y("1500.00"))],
  restock: [{ itemId: "i1", lotId: "l1", cost: Y("1000.00") }],
};

describe("salesReturnPosted", () => {
  it("PR-04: Dr 4110 1,500 / Cr 1100 1,500 ; Dr 1400 1,000 / Cr 5100 1,000", () => {
    const e = unwrap(salesReturnPosted(meta, pr04));
    expect(e.lines.map((l) => [l.accountCode, l.debit.toDecimalString(), l.credit.toDecimalString()])).toEqual([
      [A.SALES_RETURNS, "1500.00", "0.00"],
      [A.CASH_YER_NEW, "0.00", "1500.00"],
      [A.INVENTORY, "1000.00", "0.00"],
      [A.COGS, "0.00", "1000.00"],
    ]);
    expect(e.lines[2]?.dimensions).toEqual({ itemId: "i1", lotId: "l1" });
    expect(e.documentRef).toEqual({ type: "sales_return", id: "ret-1" });
  });

  it("golden: return of 270.00 with cost 160.00 reverses proportionally", () => {
    const e = unwrap(salesReturnPosted(meta, { ...pr04, returnedNet: Y("270.00"), refunds: [cash(Y("270.00"))], restock: [{ itemId: "i1", lotId: "l1", cost: Y("160.00") }] }));
    expect(sum(e, A.SALES_RETURNS, "debit")).toBe("270.00");
    expect(sum(e, A.CASH_YER_NEW, "credit")).toBe("270.00");
    expect(sum(e, A.INVENTORY, "debit")).toBe("160.00");
    expect(sum(e, A.COGS, "credit")).toBe("160.00");
    expect(e.totalDebit.toDecimalString()).toBe("430.00");
  });

  it("credits the customer's AR when nothing is refunded in cash and reverses VAT", () => {
    const e = unwrap(salesReturnPosted(meta, { ...pr04, outputVat: Y("75.00"), refunds: [], restock: [] }));
    expect(sum(e, A.OUTPUT_VAT, "debit")).toBe("75.00");
    const ar = e.lines.find((l) => l.accountCode === A.ACCOUNTS_RECEIVABLE);
    expect(ar?.credit.toDecimalString()).toBe("1575.00");
    expect(ar?.dimensions).toEqual({ customerId: "cust-x" });
    expect(e.lines.some((l) => l.accountCode === A.INVENTORY)).toBe(false);
  });

  it("books an FX loss when a foreign refund costs more base than booked", () => {
    const e = unwrap(salesReturnPosted(meta, { ...pr04, returnedNet: Y("43000.00"), refunds: [cash(SAR("100.00"), { rateScaled: rate(440n), settlesBase: Y("43000.00") })] }));
    expect(sum(e, A.CASH_SAR, "credit")).toBe("44000.00");
    expect(sum(e, A.FX_LOSS, "debit")).toBe("1000.00");
  });

  it("rejects invalid events", () => {
    expect(codeOf(salesReturnPosted(meta, { ...pr04, returnedNet: Y("0.00") }))).toBe("accounting.non_positive_amount");
    expect(codeOf(salesReturnPosted(meta, { ...pr04, outputVat: Y("-1.00") }))).toBe("accounting.negative_amount");
    expect(codeOf(salesReturnPosted(meta, { ...pr04, refunds: [cash(Y("1500.01"))] }))).toBe("accounting.overpayment");
    expect(codeOf(salesReturnPosted(meta, { ...pr04, customerId: " ", refunds: [] }))).toBe("accounting.customer_required");
    expect(codeOf(salesReturnPosted(meta, { ...pr04, restock: [{ itemId: "i", lotId: "l", cost: SAR("1.00") }] }))).toBe("accounting.currency_mismatch");
  });
});

const pr03: CustomerPaymentPosted = { paymentId: "pay-1", customerId: "cust-x", payment: cash(Y("3300.00")), arSettledBase: Y("3300.00") };

describe("customerPaymentPosted", () => {
  it("PR-03: Dr 1100 3,300 / Cr 1300 3,300", () => {
    const e = unwrap(customerPaymentPosted(meta, pr03));
    expect(e.lines.map((l) => [l.accountCode, l.debit.toDecimalString(), l.credit.toDecimalString()])).toEqual([
      [A.CASH_YER_NEW, "3300.00", "0.00"],
      [A.ACCOUNTS_RECEIVABLE, "0.00", "3300.00"],
    ]);
    expect(e.lines[1]?.dimensions).toEqual({ customerId: "cust-x" });
    expect(e.documentRef).toEqual({ type: "customer_payment", id: "pay-1" });
  });

  it("PR-16: 100 SAR booked at 430, collected at 440 → Dr 1200 44,000 / Cr 1300 43,000 / Cr 4200 1,000", () => {
    const e = unwrap(customerPaymentPosted(meta, { ...pr03, payment: cash(SAR("100.00"), { rateScaled: rate(440n) }), arSettledBase: Y("43000.00") }));
    expect(sum(e, A.CASH_SAR, "debit")).toBe("44000.00");
    expect(sum(e, A.ACCOUNTS_RECEIVABLE, "credit")).toBe("43000.00");
    expect(sum(e, A.FX_GAIN, "credit")).toBe("1000.00");
    expect(e.totalDebit.equals(e.totalCredit)).toBe(true);
  });

  it("books an FX loss when collected below the booked rate", () => {
    const e = unwrap(customerPaymentPosted(meta, { ...pr03, payment: cash(SAR("100.00"), { rateScaled: rate(420n) }), arSettledBase: Y("43000.00") }));
    expect(sum(e, A.FX_LOSS, "debit")).toBe("1000.00");
  });

  it("keeps an unallocated remainder as a customer deposit, even with no AR", () => {
    const e = unwrap(customerPaymentPosted(meta, { ...pr03, payment: cash(Y("5000.00")), depositBase: Y("1700.00") }));
    expect(sum(e, A.ACCOUNTS_RECEIVABLE, "credit")).toBe("3300.00");
    expect(sum(e, A.CUSTOMER_DEPOSITS, "credit")).toBe("1700.00");
    const pure = unwrap(customerPaymentPosted(meta, { ...pr03, payment: cash(Y("1000.00")), arSettledBase: Y("0.00"), depositBase: Y("1000.00") }));
    expect(pure.lines.map((l) => l.accountCode)).toEqual([A.CASH_YER_NEW, A.CUSTOMER_DEPOSITS]);
  });

  it("rejects invalid events", () => {
    expect(codeOf(customerPaymentPosted(meta, { ...pr03, customerId: "" }))).toBe("accounting.customer_required");
    expect(codeOf(customerPaymentPosted(meta, { ...pr03, arSettledBase: Y("-1.00") }))).toBe("accounting.negative_amount");
    expect(codeOf(customerPaymentPosted(meta, { ...pr03, depositBase: SAR("1.00") }))).toBe("accounting.currency_mismatch");
    expect(codeOf(customerPaymentPosted(meta, { ...pr03, arSettledBase: Y("0.00") }))).toBe("accounting.nothing_to_post");
    expect(codeOf(customerPaymentPosted(meta, { ...pr03, payment: cash(USD("10.00")) }))).toBe("accounting.rate_required");
  });
});
