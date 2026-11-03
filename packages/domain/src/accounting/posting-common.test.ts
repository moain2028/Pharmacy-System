import { describe, expect, it } from "vitest";
import { Money } from "../money/money.js";
import { unwrap, type Result } from "../shared/result.js";
import { ACCOUNT_CODES as A } from "./chart-of-accounts.js";
import {
  RATE_SCALE,
  convertAtRate,
  foreignOf,
  fundsAccountCode,
  fundsDimensions,
  fxLines,
  inventoryLotLines,
  isBlank,
  postEntry,
  requireBaseAmount,
  resolvePayment,
  settleDocument,
  toBase,
  type EntryMeta,
  type PaymentPart,
} from "./posting-common.js";

const BASE = "YER_NEW" as const;
const Y = (s: string): Money => unwrap(Money.parse(s, BASE));
const USD = (s: string): Money => unwrap(Money.parse(s, "USD"));
const SAR = (s: string): Money => unwrap(Money.parse(s, "SAR"));
const rate = (n: bigint): bigint => n * RATE_SCALE;
const codeOf = (r: Result<unknown>): string => (r.ok ? "ok" : r.error.code);
const meta: EntryMeta = { entryId: "je-1", tenantId: "t-1", postedAt: new Date("2026-01-15T10:00:00Z"), baseCurrency: BASE };
const cash = (amount: Money, extra: Partial<PaymentPart> = {}): PaymentPart => ({ via: { kind: "CASH", id: "cb-1" }, amount, ...extra });

describe("isBlank", () => {
  it("treats undefined and whitespace as blank", () => {
    expect(isBlank(undefined)).toBe(true);
    expect(isBlank("  ")).toBe(true);
    expect(isBlank("x")).toBe(false);
  });
});

describe("toBase / convertAtRate", () => {
  it("returns base amounts unchanged (rate omitted or exactly 1.0)", () => {
    const r = unwrap(toBase(Y("10.00"), undefined, BASE));
    expect(r.base.equals(Y("10.00"))).toBe(true);
    expect(r.rateScaled).toBe(RATE_SCALE);
    expect(unwrap(toBase(Y("10.00"), RATE_SCALE, BASE)).base.equals(Y("10.00"))).toBe(true);
    expect(codeOf(toBase(Y("10.00"), rate(2n), BASE))).toBe("accounting.invalid_rate");
  });
  it("converts 100 USD @ 530 to 53,000.00 YER (FR-PUR-110)", () => {
    const r = unwrap(toBase(USD("100.00"), rate(530n), BASE));
    expect(r.base.toDecimalString()).toBe("53000.00");
    expect(r.rateScaled).toBe(rate(530n));
    expect(convertAtRate(USD("100.00"), rate(530n), BASE).toDecimalString()).toBe("53000.00");
  });
  it("rounds Half-Up once", () => {
    expect(unwrap(toBase(SAR("3.00"), 430_123457n, BASE)).base.toDecimalString()).toBe("1290.37");
    expect(unwrap(toBase(SAR("1.00"), 430_125000n, BASE)).base.toDecimalString()).toBe("430.13");
    expect(convertAtRate(SAR("-1.00"), 430_125000n, BASE).toDecimalString()).toBe("-430.13");
  });
  it("requires a positive rate for foreign amounts", () => {
    expect(codeOf(toBase(USD("1.00"), undefined, BASE))).toBe("accounting.rate_required");
    expect(codeOf(toBase(USD("1.00"), 0n, BASE))).toBe("accounting.invalid_rate");
    expect(codeOf(toBase(USD("1.00"), -5n, BASE))).toBe("accounting.invalid_rate");
  });
});

describe("foreignOf", () => {
  it("is null for base, a frozen snapshot otherwise", () => {
    const conv = unwrap(toBase(USD("1.00"), rate(530n), BASE));
    expect(foreignOf(Y("1.00"), unwrap(toBase(Y("1.00"), undefined, BASE)), BASE)).toBeNull();
    const f = foreignOf(USD("1.00"), conv, BASE);
    expect(f).toEqual({ amount: USD("1.00"), rateScaledSnapshot: rate(530n) });
    expect(Object.isFrozen(f)).toBe(true);
  });
});

describe("requireBaseAmount", () => {
  it("validates currency, sign and zero", () => {
    expect(codeOf(requireBaseAmount(SAR("1.00"), BASE, "f"))).toBe("accounting.currency_mismatch");
    expect(codeOf(requireBaseAmount(Y("-1.00"), BASE, "f"))).toBe("accounting.negative_amount");
    expect(codeOf(requireBaseAmount(Y("0.00"), BASE, "f"))).toBe("ok");
    expect(codeOf(requireBaseAmount(Y("0.00"), BASE, "f", false))).toBe("accounting.non_positive_amount");
    expect(codeOf(requireBaseAmount(Y("1.00"), BASE, "f", false))).toBe("ok");
  });
});

describe("funds accounts", () => {
  it("maps kind + currency to the GL account and dimension", () => {
    expect(fundsAccountCode({ kind: "CASH", id: "cb" }, "SAR")).toBe(A.CASH_SAR);
    expect(fundsAccountCode({ kind: "BANK", id: "b" }, "SAR")).toBe(A.BANK);
    expect(fundsAccountCode({ kind: "WALLET", id: "w" }, "USD")).toBe(A.WALLET);
    expect(fundsDimensions({ kind: "CASH", id: "cb" })).toEqual({ cashboxId: "cb" });
    expect(fundsDimensions({ kind: "BANK", id: "b" })).toEqual({ bankAccountId: "b" });
    expect(fundsDimensions({ kind: "WALLET", id: "w" })).toEqual({ walletId: "w" });
    expect(Object.isFrozen(fundsDimensions({ kind: "WALLET", id: "w" }))).toBe(true);
  });
});

describe("resolvePayment", () => {
  it("resolves a base cash payment with settlesBase defaulting to the tender", () => {
    const p = unwrap(resolvePayment(cash(Y("100.00")), BASE));
    expect(p.tenderBase.equals(Y("100.00"))).toBe(true);
    expect(p.settlesBase.equals(Y("100.00"))).toBe(true);
    expect(p.accountCode).toBe(A.CASH_YER_NEW);
    expect(p.dimensions).toEqual({ cashboxId: "cb-1" });
    expect(p.foreign).toBeNull();
    expect(Object.isFrozen(p)).toBe(true);
  });
  it("converts a foreign payment and keeps the snapshot", () => {
    const p = unwrap(resolvePayment({ via: { kind: "BANK", id: "bank-1" }, amount: USD("100.00"), rateScaled: rate(535n), settlesBase: Y("53000.00") }, BASE));
    expect(p.tenderBase.toDecimalString()).toBe("53500.00");
    expect(p.settlesBase.toDecimalString()).toBe("53000.00");
    expect(p.accountCode).toBe(A.BANK);
    expect(p.foreign).toEqual({ amount: USD("100.00"), rateScaledSnapshot: rate(535n) });
  });
  it("rejects invalid parts", () => {
    expect(codeOf(resolvePayment(cash(Y("1.00"), { via: { kind: "CASH", id: " " } }), BASE))).toBe("accounting.funds_account_required");
    expect(codeOf(resolvePayment(cash(Y("0.00")), BASE))).toBe("accounting.non_positive_amount");
    expect(codeOf(resolvePayment(cash(USD("1.00")), BASE))).toBe("accounting.rate_required");
    expect(codeOf(resolvePayment(cash(Y("1.00"), { settlesBase: SAR("1.00") }), BASE))).toBe("accounting.currency_mismatch");
    expect(codeOf(resolvePayment(cash(Y("1.00"), { settlesBase: Y("0.00") }), BASE))).toBe("accounting.non_positive_amount");
  });
});

describe("fxLines", () => {
  it("produces nothing / Cr 4200 / Dr 5400", () => {
    expect(fxLines(Y("0.00"), {}, "m")).toEqual([]);
    expect(fxLines(Y("10.00"), { cashboxId: "cb" }, "m")).toEqual([{ accountCode: A.FX_GAIN, credit: Y("10.00"), memo: "m (FX gain)", dimensions: { cashboxId: "cb" } }]);
    expect(fxLines(Y("-10.00"), {}, "m")).toEqual([{ accountCode: A.FX_LOSS, debit: Y("10.00"), memo: "m (FX loss)", dimensions: {} }]);
  });
});

describe("settleDocument", () => {
  it("RECEIPT: debits funds, books FX gain, reports outstanding", () => {
    const s = unwrap(settleDocument(Y("50000.00"), [cash(Y("1000.00")), cash(SAR("100.00"), { rateScaled: rate(440n), settlesBase: Y("43000.00") })], "RECEIPT", BASE, "m"));
    expect(s.lines).toHaveLength(3);
    expect(s.lines[0]).toMatchObject({ accountCode: A.CASH_YER_NEW, debit: Y("1000.00") });
    expect(s.lines[1]).toMatchObject({ accountCode: A.CASH_SAR, debit: Y("44000.00") });
    expect(s.lines[2]).toMatchObject({ accountCode: A.FX_GAIN, credit: Y("1000.00") });
    expect(s.settledBase.toDecimalString()).toBe("44000.00");
    expect(s.outstanding.toDecimalString()).toBe("6000.00");
  });
  it("PAYMENT: credits funds and books FX loss when more base is paid than booked", () => {
    const s = unwrap(settleDocument(Y("53000.00"), [cash(USD("100.00"), { rateScaled: rate(535n), settlesBase: Y("53000.00") })], "PAYMENT", BASE, "m"));
    expect(s.lines[0]).toMatchObject({ accountCode: A.CASH_USD, credit: Y("53500.00") });
    expect(s.lines[1]).toMatchObject({ accountCode: A.FX_LOSS, debit: Y("500.00") });
    expect(s.outstanding.isZero()).toBe(true);
  });
  it("handles no payments and rejects overpayment / bad parts", () => {
    expect(unwrap(settleDocument(Y("10.00"), [], "RECEIPT", BASE, "m")).outstanding.toDecimalString()).toBe("10.00");
    expect(codeOf(settleDocument(Y("10.00"), [cash(Y("10.01"))], "RECEIPT", BASE, "m"))).toBe("accounting.overpayment");
    expect(codeOf(settleDocument(Y("10.00"), [cash(Y("0.00"))], "RECEIPT", BASE, "m"))).toBe("accounting.non_positive_amount");
  });
});

describe("inventoryLotLines", () => {
  const lots = [
    { itemId: "i1", lotId: "l1", cost: Y("1900.00") },
    { itemId: "i2", lotId: "l2", cost: Y("0.00") },
    { itemId: "i3", lotId: "l3", cost: Y("1000.00") },
  ];
  it("credits per lot, skips zero-cost lots, sums the total", () => {
    const r = unwrap(inventoryLotLines(lots, "CREDIT", BASE, "m"));
    expect(r.total.toDecimalString()).toBe("2900.00");
    expect(r.lines).toHaveLength(2);
    expect(r.lines[0]).toEqual({ accountCode: A.INVENTORY, credit: Y("1900.00"), memo: "m", dimensions: { itemId: "i1", lotId: "l1" } });
  });
  it("debits per lot and rejects foreign costs", () => {
    expect(unwrap(inventoryLotLines(lots, "DEBIT", BASE, "m")).lines[1]).toMatchObject({ debit: Y("1000.00") });
    expect(codeOf(inventoryLotLines([{ itemId: "i", lotId: "l", cost: SAR("1.00") }], "DEBIT", BASE, "m"))).toBe("accounting.currency_mismatch");
  });
});

describe("postEntry", () => {
  it("stamps meta onto the built entry", () => {
    const e = unwrap(postEntry(meta, { type: "expense", id: "x-1" }, [{ accountCode: A.RENT, debit: Y("5.00") }, { accountCode: A.CASH_YER_NEW, credit: Y("5.00") }], "rent"));
    expect(e.entryId).toBe("je-1");
    expect(e.tenantId).toBe("t-1");
    expect(e.currency).toBe(BASE);
    expect(e.memo).toBe("rent");
    expect(e.documentRef).toEqual({ type: "expense", id: "x-1" });
  });
});
