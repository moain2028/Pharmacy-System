import { describe, expect, it } from "vitest";
import { Money } from "../money/money.js";
import { unwrap, type Result } from "../shared/result.js";
import { ACCOUNT_CODES as A } from "./chart-of-accounts.js";
import type { JournalEntry } from "./journal-entry.js";
import { RATE_SCALE, type EntryMeta, type PaymentPart } from "./posting-common.js";
import {
  purchaseReceiptPosted,
  purchaseReturnPosted,
  supplierInvoicePosted,
  supplierPaymentPosted,
  type PurchaseReceiptPosted,
  type SupplierInvoicePosted,
  type SupplierPaymentPosted,
} from "./posting-rules-purchasing.js";

const BASE = "YER_NEW" as const;
const Y = (s: string): Money => unwrap(Money.parse(s, BASE));
const USD = (s: string): Money => unwrap(Money.parse(s, "USD"));
const SAR = (s: string): Money => unwrap(Money.parse(s, "SAR"));
const rate = (n: bigint): bigint => n * RATE_SCALE;
const codeOf = (r: Result<unknown>): string => (r.ok ? "ok" : r.error.code);
const meta: EntryMeta = { entryId: "je-1", tenantId: "t-1", postedAt: new Date("2026-01-15T10:00:00Z"), baseCurrency: BASE };
const cash = (amount: Money, extra: Partial<PaymentPart> = {}): PaymentPart => ({ via: { kind: "CASH", id: "cb-1" }, amount, ...extra });
const sum = (e: JournalEntry, code: string, side: "debit" | "credit"): string =>
  Money.sum(e.lines.filter((l) => l.accountCode === code).map((l) => l[side]), BASE).toDecimalString();
const rows = (e: JournalEntry): string[][] => e.lines.map((l) => [l.accountCode, l.debit.toDecimalString(), l.credit.toDecimalString()]);

const grn: PurchaseReceiptPosted = {
  grnId: "grn-1",
  supplierId: "sup-y",
  lots: [
    { itemId: "i1", lotId: "l1", cost: Y("30000.00") },
    { itemId: "i2", lotId: "l2", cost: Y("70000.00") },
  ],
  accrual: "GRNI",
};

describe("purchaseReceiptPosted", () => {
  it("debits inventory per lot and accrues GRNI", () => {
    const e = unwrap(purchaseReceiptPosted(meta, grn));
    expect(rows(e)).toEqual([
      [A.INVENTORY, "30000.00", "0.00"],
      [A.INVENTORY, "70000.00", "0.00"],
      [A.GRNI, "0.00", "100000.00"],
    ]);
    expect(e.lines[2]?.dimensions).toEqual({ supplierId: "sup-y" });
    expect(e.documentRef).toEqual({ type: "goods_receipt", id: "grn-1" });
  });
  it("can credit AP directly", () => {
    expect(sum(unwrap(purchaseReceiptPosted(meta, { ...grn, accrual: "AP" })), A.ACCOUNTS_PAYABLE, "credit")).toBe("100000.00");
  });
  it("rejects invalid events", () => {
    expect(codeOf(purchaseReceiptPosted(meta, { ...grn, supplierId: "" }))).toBe("accounting.supplier_required");
    expect(codeOf(purchaseReceiptPosted(meta, { ...grn, lots: [{ itemId: "i", lotId: "l", cost: SAR("1.00") }] }))).toBe("accounting.currency_mismatch");
    expect(codeOf(purchaseReceiptPosted(meta, { ...grn, lots: [{ itemId: "i", lotId: "l", cost: Y("0.00") }] }))).toBe("accounting.nothing_to_post");
  });
});

const usdInvoice: SupplierInvoicePosted = { invoiceId: "si-1", supplierId: "sup-y", amount: USD("100.00"), rateScaled: rate(530n), payments: [] };

describe("supplierInvoicePosted", () => {
  it("golden: 100 USD @ 530 on credit → Dr 1400 53,000 / Cr 2100 53,000 with the USD snapshot", () => {
    const e = unwrap(supplierInvoicePosted(meta, usdInvoice));
    expect(rows(e)).toEqual([
      [A.INVENTORY, "53000.00", "0.00"],
      [A.ACCOUNTS_PAYABLE, "0.00", "53000.00"],
    ]);
    expect(e.lines[1]?.foreign).toEqual({ amount: USD("100.00"), rateScaledSnapshot: rate(530n) });
    expect(e.lines[1]?.dimensions).toEqual({ supplierId: "sup-y" });
  });
  it("PR-05 credit purchase in base: 49,000 → Dr 1400 / Cr 2100, no snapshot", () => {
    const e = unwrap(supplierInvoicePosted(meta, { ...usdInvoice, amount: Y("49000.00"), rateScaled: undefined }));
    expect(sum(e, A.INVENTORY, "debit")).toBe("49000.00");
    expect(sum(e, A.ACCOUNTS_PAYABLE, "credit")).toBe("49000.00");
    expect(e.lines[1]?.foreign).toBeNull();
  });
  it("PR-06 cash purchase: Dr 1400 49,000 / Cr 1100 49,000", () => {
    const e = unwrap(supplierInvoicePosted(meta, { ...usdInvoice, amount: Y("49000.00"), rateScaled: undefined, payments: [cash(Y("49000.00"))] }));
    expect(rows(e)).toEqual([
      [A.INVENTORY, "49000.00", "0.00"],
      [A.CASH_YER_NEW, "0.00", "49000.00"],
    ]);
  });
  it("partial payment leaves the remainder on AP without a snapshot", () => {
    const e = unwrap(supplierInvoicePosted(meta, { ...usdInvoice, amount: Y("49000.00"), rateScaled: undefined, payments: [cash(Y("20000.00"))] }));
    const ap = e.lines.find((l) => l.accountCode === A.ACCOUNTS_PAYABLE);
    expect(ap?.credit.toDecimalString()).toBe("29000.00");
    expect(ap?.foreign).toBeNull();
  });
  it("clears GRNI and books the difference to inventory (either direction)", () => {
    const up = unwrap(supplierInvoicePosted(meta, { ...usdInvoice, clearsGrniBase: Y("50000.00") }));
    expect(rows(up)).toEqual([
      [A.INVENTORY, "3000.00", "0.00"],
      [A.GRNI, "50000.00", "0.00"],
      [A.ACCOUNTS_PAYABLE, "0.00", "53000.00"],
    ]);
    const down = unwrap(supplierInvoicePosted(meta, { ...usdInvoice, clearsGrniBase: Y("55000.00") }));
    expect(rows(down)).toEqual([
      [A.INVENTORY, "0.00", "2000.00"],
      [A.GRNI, "55000.00", "0.00"],
      [A.ACCOUNTS_PAYABLE, "0.00", "53000.00"],
    ]);
    const exact = unwrap(supplierInvoicePosted(meta, { ...usdInvoice, clearsGrniBase: Y("53000.00") }));
    expect(exact.lines.map((l) => l.accountCode)).toEqual([A.GRNI, A.ACCOUNTS_PAYABLE]);
  });
  it("rejects invalid events", () => {
    expect(codeOf(supplierInvoicePosted(meta, { ...usdInvoice, supplierId: " " }))).toBe("accounting.supplier_required");
    expect(codeOf(supplierInvoicePosted(meta, { ...usdInvoice, amount: USD("0.00") }))).toBe("accounting.non_positive_amount");
    expect(codeOf(supplierInvoicePosted(meta, { ...usdInvoice, rateScaled: undefined }))).toBe("accounting.rate_required");
    expect(codeOf(supplierInvoicePosted(meta, { ...usdInvoice, clearsGrniBase: SAR("1.00") }))).toBe("accounting.currency_mismatch");
    expect(codeOf(supplierInvoicePosted(meta, { ...usdInvoice, payments: [cash(Y("53000.01"))] }))).toBe("accounting.overpayment");
  });
});

const usdPayment: SupplierPaymentPosted = {
  paymentId: "sp-1",
  supplierId: "sup-y",
  payment: cash(USD("100.00"), { rateScaled: rate(535n) }),
  apSettledBase: Y("53000.00"),
};

describe("supplierPaymentPosted", () => {
  it("golden: 100 USD booked @ 530 paid @ 535 → FX loss 500.00 YER", () => {
    const e = unwrap(supplierPaymentPosted(meta, usdPayment));
    expect(rows(e)).toEqual([
      [A.ACCOUNTS_PAYABLE, "53000.00", "0.00"],
      [A.CASH_USD, "0.00", "53500.00"],
      [A.FX_LOSS, "500.00", "0.00"],
    ]);
    expect(e.lines[1]?.foreign).toEqual({ amount: USD("100.00"), rateScaledSnapshot: rate(535n) });
    expect(e.totalDebit.equals(e.totalCredit)).toBe(true);
    expect(e.documentRef).toEqual({ type: "supplier_payment", id: "sp-1" });
  });
  it("FR-SUP-105: paid @ 540 → FX loss 1,000 ; paid @ 525 → FX gain 500", () => {
    expect(sum(unwrap(supplierPaymentPosted(meta, { ...usdPayment, payment: cash(USD("100.00"), { rateScaled: rate(540n) }) })), A.FX_LOSS, "debit")).toBe("1000.00");
    expect(sum(unwrap(supplierPaymentPosted(meta, { ...usdPayment, payment: cash(USD("100.00"), { rateScaled: rate(525n) }) })), A.FX_GAIN, "credit")).toBe("500.00");
  });
  it("PR-07: Dr 2100 20,000 / Cr 1100 20,000", () => {
    const e = unwrap(supplierPaymentPosted(meta, { ...usdPayment, payment: cash(Y("20000.00")), apSettledBase: Y("20000.00") }));
    expect(rows(e)).toEqual([
      [A.ACCOUNTS_PAYABLE, "20000.00", "0.00"],
      [A.CASH_YER_NEW, "0.00", "20000.00"],
    ]);
  });
  it("books an unallocated advance as a separate debit on AP", () => {
    const e = unwrap(supplierPaymentPosted(meta, { ...usdPayment, payment: cash(Y("30000.00")), apSettledBase: Y("20000.00"), advanceBase: Y("10000.00") }));
    expect(e.lines.map((l) => [l.accountCode, l.debit.toDecimalString()])).toEqual([[A.ACCOUNTS_PAYABLE, "20000.00"], [A.ACCOUNTS_PAYABLE, "10000.00"], [A.CASH_YER_NEW, "0.00"]]);
    const pure = unwrap(supplierPaymentPosted(meta, { ...usdPayment, payment: cash(Y("10000.00")), apSettledBase: Y("0.00"), advanceBase: Y("10000.00") }));
    expect(pure.lines).toHaveLength(2);
  });
  it("rejects invalid events", () => {
    expect(codeOf(supplierPaymentPosted(meta, { ...usdPayment, supplierId: "" }))).toBe("accounting.supplier_required");
    expect(codeOf(supplierPaymentPosted(meta, { ...usdPayment, apSettledBase: Y("-1.00") }))).toBe("accounting.negative_amount");
    expect(codeOf(supplierPaymentPosted(meta, { ...usdPayment, advanceBase: SAR("1.00") }))).toBe("accounting.currency_mismatch");
    expect(codeOf(supplierPaymentPosted(meta, { ...usdPayment, apSettledBase: Y("0.00") }))).toBe("accounting.nothing_to_post");
    expect(codeOf(supplierPaymentPosted(meta, { ...usdPayment, payment: { via: { kind: "CASH", id: "" }, amount: Y("1.00") } }))).toBe("accounting.funds_account_required");
  });
});

describe("purchaseReturnPosted", () => {
  it("PR-08: Dr 2100 5,000 / Cr 1400 5,000", () => {
    const e = unwrap(purchaseReturnPosted(meta, { returnId: "pr-1", supplierId: "sup-y", lots: [{ itemId: "i1", lotId: "l1", cost: Y("5000.00") }] }));
    expect(rows(e)).toEqual([
      [A.ACCOUNTS_PAYABLE, "5000.00", "0.00"],
      [A.INVENTORY, "0.00", "5000.00"],
    ]);
    expect(e.lines[0]?.dimensions).toEqual({ supplierId: "sup-y" });
    expect(e.lines[1]?.dimensions).toEqual({ itemId: "i1", lotId: "l1" });
  });
  it("rejects invalid events", () => {
    expect(codeOf(purchaseReturnPosted(meta, { returnId: "pr-1", supplierId: "", lots: [] }))).toBe("accounting.supplier_required");
    expect(codeOf(purchaseReturnPosted(meta, { returnId: "pr-1", supplierId: "s", lots: [] }))).toBe("accounting.nothing_to_post");
    expect(codeOf(purchaseReturnPosted(meta, { returnId: "pr-1", supplierId: "s", lots: [{ itemId: "i", lotId: "l", cost: SAR("1.00") }] }))).toBe("accounting.currency_mismatch");
  });
});
