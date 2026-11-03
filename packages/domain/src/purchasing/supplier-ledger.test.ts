import { describe, expect, it } from "vitest";
import { Money } from "../money/money.js";
import { unwrap, type Result } from "../shared/result.js";
import {
  DEFAULT_AGING_BUCKETS, addDays, aging, allocatePayment, balance, dueDateFor, validateOpenItem,
  type EarlyPaymentTerms, type OpenItem, type OpenItemKind, type PaymentTerms,
} from "./supplier-ledger.js";

const Y = (n: number | bigint): Money => Money.minor(n, "YER_NEW");
const U = (n: number | bigint): Money => Money.minor(n, "USD");
const code = (r: Result<unknown>): string => (r.ok ? "ok" : r.error.code);
const inv = (id: string, amount: Money, date: string, dueDate?: string, remaining: Money = amount): OpenItem =>
  ({ id, kind: "INVOICE", date, amount, remaining, ...(dueDate === undefined ? {} : { dueDate }) });
const credit = (id: string, kind: OpenItemKind, amount: Money, date = "2026-01-01"): OpenItem => ({ id, kind, date, amount, remaining: amount });
const pay = (amount: Money, date = "2026-02-01") => ({ id: "pay-1", amount, date });
/** FR-SUP-103: invoices 60,000 (older) and 80,000. */
const two = [inv("i2", Y(8_000_000), "2026-01-10", "2026-02-09"), inv("i1", Y(6_000_000), "2026-01-01", "2026-01-31")];
/** FR-SUP-104: 100,000 YER, 2 % within 10 days. */
const big = [inv("i1", Y(10_000_000), "2026-01-01", "2026-01-31")];
const terms: EarlyPaymentTerms = { discountBp: 200, withinDays: 10 };

describe("validateOpenItem", () => {
  it.each<[string, OpenItem]>([
    ["ledger.invalid_kind", { ...inv("a", Y(1), "2026-01-01"), kind: "REFUND" as OpenItemKind }],
    ["ledger.invalid_date", inv("a", Y(1), "2026-13-01")],
    ["ledger.invalid_date", inv("a", Y(1), "2026-01-01", "nope")],
    ["ledger.currency_mismatch", inv("a", Y(1), "2026-01-01", undefined, U(1))],
    ["ledger.invalid_remaining", inv("a", Y(-1), "2026-01-01")],
    ["ledger.invalid_remaining", inv("a", Y(5), "2026-01-01", undefined, Y(-1))],
    ["ledger.invalid_remaining", inv("a", Y(5), "2026-01-01", undefined, Y(6))],
    ["ok", inv("a", Y(5), "2026-01-01", "2026-01-31", Y(0))],
  ])("→ %s", (expected, item) => expect(code(validateOpenItem(item))).toBe(expected));
  it("rejects duplicate ids in a ledger", () => {
    expect(code(balance([inv("a", Y(1), "2026-01-01"), inv("a", Y(1), "2026-01-01")]))).toBe("ledger.duplicate_id");
  });
});

describe("dueDateFor / addDays", () => {
  it.each<[string, PaymentTerms, string]>([
    ["2026-01-01", { type: "CASH" }, "2026-01-01"],
    ["2026-01-01", { type: "NET_DAYS", netDays: 30 }, "2026-01-31"],
    ["2026-02-10", { type: "END_OF_MONTH" }, "2026-02-28"],
    ["2025-12-31", { type: "NET_DAYS", netDays: 1 }, "2026-01-01"],
  ])("%s + %o → %s", (date, t, expected) => expect(unwrap(dueDateFor(date, t))).toBe(expected));
  it.each<[string, string, PaymentTerms]>([
    ["ledger.invalid_date", "bad", { type: "CASH" }],
    ["ledger.invalid_terms", "2026-01-01", { type: "INSTALLMENTS" as PaymentTerms["type"] }],
    ["ledger.invalid_net_days", "2026-01-01", { type: "NET_DAYS" }],
    ["ledger.invalid_net_days", "2026-01-01", { type: "NET_DAYS", netDays: -1 }],
    ["ledger.invalid_net_days", "2026-01-01", { type: "NET_DAYS", netDays: 1.5 }],
  ])("rejects %s", (expected, date, t) => expect(code(dueDateFor(date, t))).toBe(expected));
  it("addDays crosses months", () => expect(addDays("2026-01-31", 1)).toBe("2026-02-01"));
});

describe("allocatePayment", () => {
  it("FIFO: 100,000 over 60,000 + 80,000 → 60,000 / 40,000, 40,000 stays open (FR-SUP-103)", () => {
    const r = unwrap(allocatePayment(two, pay(Y(10_000_000)), { mode: "FIFO" }));
    expect(r.allocations.map((a) => [a.itemId, a.applied.amountMinor, a.settled])).toEqual([["i1", 6_000_000n, true], ["i2", 4_000_000n, false]]);
    expect(r.unallocated.isZero()).toBe(true);
    expect(r.discountTotal.isZero()).toBe(true);
    expect(r.allocatedTotal.equals(Y(10_000_000))).toBe(true);
    expect(r.items.find((i) => i.id === "i2")?.remaining.equals(Y(4_000_000))).toBe(true);
    expect(r.items.find((i) => i.id === "i1")?.remaining.isZero()).toBe(true);
    expect(r.items.at(-1)).toMatchObject({ id: "pay-1", kind: "PAYMENT", remaining: Y(0) });
  });
  it("FIFO keeps the advance, orders by due date then id, ignores credits and other currencies", () => {
    const items = [credit("c", "CREDIT_NOTE", Y(100)), inv("u", U(100), "2026-01-01"), inv("b", Y(100), "2026-01-03"), inv("a", Y(100), "2026-01-03"), inv("p", Y(100), "2026-01-01", undefined, Y(0))];
    const r = unwrap(allocatePayment(items, pay(Y(250)), { mode: "FIFO" }));
    expect(r.allocations.map((a) => a.itemId)).toEqual(["a", "b"]);
    expect(r.unallocated.equals(Y(50))).toBe(true);
    expect(r.items.at(-1)?.remaining.equals(Y(50))).toBe(true);
  });
  it("takes 2 % on 100,000 when 98,000 settles it on day 5; no discount on day 15 (FR-SUP-104)", () => {
    const early = unwrap(allocatePayment(big, pay(Y(9_800_000), "2026-01-06"), { mode: "FIFO" }, terms));
    expect(early.allocations[0]).toMatchObject({ applied: Y(9_800_000), discount: Y(200_000), settled: true });
    expect(early.items[0]?.remaining.isZero()).toBe(true);
    const late = unwrap(allocatePayment(big, pay(Y(9_800_000), "2026-01-16"), { mode: "FIFO" }, terms));
    expect(late.allocations[0]).toMatchObject({ applied: Y(9_800_000), discount: Y(0), settled: false });
    expect(late.items[0]?.remaining.equals(Y(200_000))).toBe(true);
    const before = unwrap(allocatePayment(big, pay(Y(9_800_000), "2025-12-31"), { mode: "FIFO" }, terms));
    expect(before.discountTotal.isZero()).toBe(true);
    const full = unwrap(allocatePayment(big, pay(Y(1), "2026-01-06"), { mode: "FIFO" }, { discountBp: 10_000, withinDays: 10 }));
    expect(full.allocations[0]).toMatchObject({ applied: Y(0), discount: Y(10_000_000), settled: true });
  });
  it("PRO_RATA splits 50,000 as 28,571.43 / 21,428.57 and pays everything when the payment covers all", () => {
    const part = unwrap(allocatePayment(two, pay(Y(5_000_000)), { mode: "PRO_RATA" }));
    expect(part.allocations.map((a) => [a.itemId, a.applied.amountMinor]).sort()).toEqual([["i1", 2_142_857n], ["i2", 2_857_143n]]);
    expect(part.allocations.every((a) => !a.settled)).toBe(true);
    const all = unwrap(allocatePayment(two, pay(Y(15_000_000)), { mode: "PRO_RATA" }));
    expect(all.allocations.every((a) => a.settled)).toBe(true);
    expect(all.unallocated.equals(Y(1_000_000))).toBe(true);
    const tiny = unwrap(allocatePayment([inv("x", Y(1), "2026-01-01"), inv("y", Y(100_000), "2026-01-01")], pay(Y(10)), { mode: "PRO_RATA" }));
    expect(tiny.allocations.map((a) => a.itemId)).toEqual(["y"]);
  });
  it("EXPLICIT: cash per invoice; excess returns to the advance when the discount applies", () => {
    const r = unwrap(allocatePayment(two, pay(Y(5_000_000)), { mode: "EXPLICIT", targets: [{ itemId: "i2", amount: Y(3_000_000) }, { itemId: "i1", amount: Y(2_000_000) }] }));
    expect(r.allocations.map((a) => a.applied.amountMinor)).toEqual([3_000_000n, 2_000_000n]);
    const d = unwrap(allocatePayment(big, pay(Y(10_000_000), "2026-01-06"), { mode: "EXPLICIT", targets: [{ itemId: "i1", amount: Y(10_000_000) }] }, terms));
    expect(d.allocations[0]).toMatchObject({ applied: Y(9_800_000), discount: Y(200_000), settled: true });
    expect(d.unallocated.equals(Y(200_000))).toBe(true);
  });
  it.each<[string, Parameters<typeof allocatePayment>]>([
    ["ledger.over_allocation", [two, pay(Y(10_000_000)), { mode: "EXPLICIT", targets: [{ itemId: "i1", amount: Y(6_000_001) }] }]],
    ["ledger.target_not_open", [two, pay(Y(1)), { mode: "EXPLICIT", targets: [{ itemId: "zz", amount: Y(1) }] }]],
    ["ledger.duplicate_target", [two, pay(Y(1)), { mode: "EXPLICIT", targets: [{ itemId: "i1", amount: Y(1) }, { itemId: "i1", amount: Y(1) }] }]],
    ["ledger.invalid_target_amount", [two, pay(Y(1)), { mode: "EXPLICIT", targets: [{ itemId: "i1", amount: Y(0) }] }]],
    ["ledger.invalid_target_amount", [two, pay(Y(1)), { mode: "EXPLICIT", targets: [{ itemId: "i1", amount: U(1) }] }]],
    ["ledger.allocation_exceeds_payment", [two, pay(Y(1)), { mode: "EXPLICIT", targets: [{ itemId: "i1", amount: Y(2) }] }]],
    ["ledger.payment_not_positive", [two, pay(Y(0)), { mode: "FIFO" }]],
    ["ledger.invalid_date", [two, pay(Y(1), "x"), { mode: "FIFO" }]],
    ["ledger.duplicate_id", [two, { id: "i1", amount: Y(1), date: "2026-02-01" }, { mode: "FIFO" }]],
    ["ledger.invalid_remaining", [[inv("a", Y(-1), "2026-01-01")], pay(Y(1)), { mode: "FIFO" }]],
    ["ledger.invalid_terms", [two, pay(Y(1)), { mode: "FIFO" }, { discountBp: -1, withinDays: 1 }]],
    ["ledger.invalid_terms", [two, pay(Y(1)), { mode: "FIFO" }, { discountBp: 10_001, withinDays: 1 }]],
    ["ledger.invalid_terms", [two, pay(Y(1)), { mode: "FIFO" }, { discountBp: 1.5, withinDays: 1 }]],
    ["ledger.invalid_terms", [two, pay(Y(1)), { mode: "FIFO" }, { discountBp: 1, withinDays: -1 }]],
    ["ledger.invalid_terms", [two, pay(Y(1)), { mode: "FIFO" }, { discountBp: 1, withinDays: 0.5 }]],
    ["ledger.amount_too_large", [[inv("h", Y(2n ** 60n), "2026-01-01"), inv("k", Y(1), "2026-01-01")], pay(Y(5)), { mode: "PRO_RATA" }]],
  ])("rejects %s", (expected, args) => expect(code(allocatePayment(...args))).toBe(expected));
});

describe("aging / balance", () => {
  const items = [
    inv("cur", Y(100), "2026-02-20", "2026-03-10"), inv("b1", Y(200), "2026-01-01", "2026-01-30"), inv("b2", Y(300), "2026-01-01", "2026-01-15"),
    inv("b3", Y(400), "2025-12-30"), inv("over", Y(500), "2025-11-30", "2025-11-30"), inv("paid", Y(900), "2025-01-01", undefined, Y(0)),
    credit("adv", "PAYMENT", Y(50)), credit("cn", "CREDIT_NOTE", U(10)), inv("usd", U(30), "2026-01-01"),
  ];
  it("puts a 45-day-overdue invoice in 31–60 and buckets the rest per currency (FR-SUP-107)", () => {
    const rows = unwrap(aging(items, "2026-03-01"));
    expect(rows.map((r) => r.currency)).toEqual(["USD", "YER_NEW"]);
    expect(rows[1]).toMatchObject({ current: Y(100), bucket1: Y(200), bucket2: Y(300), bucket3: Y(400), over: Y(500), credits: Y(50), net: Y(1450) });
    expect(rows[0]).toMatchObject({ bucket2: U(30), credits: U(10), net: U(20) });
    expect(DEFAULT_AGING_BUCKETS).toEqual({ b1: 30, b2: 60, b3: 90 });
  });
  it.each<[string, Parameters<typeof aging>]>([
    ["ledger.invalid_date", [items, "soon"]],
    ["ledger.invalid_buckets", [items, "2026-03-01", { b1: 0, b2: 60, b3: 90 }]],
    ["ledger.invalid_buckets", [items, "2026-03-01", { b1: 60, b2: 30, b3: 90 }]],
    ["ledger.invalid_buckets", [items, "2026-03-01", { b1: 30, b2: 90, b3: 90 }]],
    ["ledger.invalid_buckets", [items, "2026-03-01", { b1: 30, b2: 60.5, b3: 90 }]],
    ["ledger.invalid_remaining", [[inv("a", Y(-1), "2026-01-01")], "2026-03-01"]],
  ])("rejects %s", (expected, args) => expect(code(aging(...args))).toBe(expected));
  it("balance nets invoices against credits per currency", () => {
    const b = unwrap(balance(items));
    expect(b).toEqual([
      { currency: "USD", payable: U(30), credits: U(10), net: U(20) },
      { currency: "YER_NEW", payable: Y(1500), credits: Y(50), net: Y(1450) },
    ]);
    expect(unwrap(balance([]))).toEqual([]);
  });
});
