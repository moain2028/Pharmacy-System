import { describe, expect, it } from "vitest";
import { Money } from "../money/money.js";
import { ExchangeRate, snapshotRate } from "../fx/exchange-rate.js";
import { unwrap, type Result } from "../shared/result.js";
import {
  CASH_MOVEMENT_KINDS, CASH_MOVEMENT_SIGN, CashMovement, cashBalance, checkPair, deriveCashBalances,
  isCashMovementKind, isFxKind, isPairedKind, type CashMovementProps,
} from "./cash-movement.js";

const yer = (n: bigint): Money => Money.minor(n * 100n, "YER_OLD");
const sar = (n: bigint): Money => Money.minor(n * 100n, "SAR");
const rate = unwrap(ExchangeRate.create({
  from: "SAR", to: "YER_OLD", buyRateScaled: 138_000_000n, sellRateScaled: 140_000_000n,
  effectiveFrom: new Date("2025-01-01T00:00:00Z"),
}));
const snap = snapshotRate(rate, "buy");
const props = (over: Partial<CashMovementProps> = {}): CashMovementProps => ({
  movementId: "m1", cashboxId: "cb1", kind: "SALE", amount: yer(100n),
  occurredAt: "2025-03-01T10:00:00+03:00", createdBy: "u1", ...over,
});
const mk = (over: Partial<CashMovementProps> = {}): CashMovement => unwrap(CashMovement.create(props(over)));
const code = (r: Result<unknown>): string => (r.ok ? "ok" : r.error.code);

describe("kinds", () => {
  it("guards and classifies kinds", () => {
    expect(CASH_MOVEMENT_KINDS).toHaveLength(13);
    expect(isCashMovementKind("FX_IN")).toBe(true);
    expect(isCashMovementKind("PAY_IN")).toBe(false);
    expect(isCashMovementKind(5)).toBe(false);
    expect(isPairedKind("TRANSFER_OUT")).toBe(true);
    expect(isPairedKind("FX_OUT")).toBe(true);
    expect(isPairedKind("SALE")).toBe(false);
    expect(isFxKind("TRANSFER_IN")).toBe(false);
    expect(CASH_MOVEMENT_SIGN.EXPENSE).toBe("OUT");
  });
});

describe("CashMovement.create", () => {
  it("builds a frozen movement normalised to UTC", () => {
    const m = mk({ shiftId: "s1", documentRef: { type: "SALES_INVOICE", id: "inv1" } });
    expect(Object.isFrozen(m)).toBe(true);
    expect(m.occurredAt).toBe("2025-03-01T07:00:00.000Z");
    expect(m.currency).toBe("YER_OLD");
    expect(m.isInbound()).toBe(true);
    expect(m.documentRef).toEqual({ type: "SALES_INVOICE", id: "inv1" });
    expect([m.pairId, m.rateSnapshot, m.reason, m.shiftId]).toEqual([null, null, null, "s1"]);
  });

  it("accepts adjustments of either sign and FX legs on both sides of the snapshot", () => {
    const adj = mk({ kind: "ADJUSTMENT", amount: yer(-3n), reason: " recount " });
    expect(adj.reason).toBe("recount");
    expect(adj.isInbound()).toBe(false);
    expect(mk({ kind: "FX_IN", amount: sar(100n), pairId: "p", rateSnapshot: snap }).rateSnapshot).toBe(snap);
    expect(mk({ kind: "FX_OUT", amount: yer(-13_800n), pairId: "p", rateSnapshot: snap }).pairId).toBe("p");
  });

  it.each<[string, Partial<CashMovementProps>, string]>([
    ["blank id", { movementId: " " }, "cash.missing_field"],
    ["blank creator", { createdBy: "" }, "cash.missing_field"],
    ["zero", { amount: yer(0n) }, "cash.zero_amount"],
    ["negative sale", { amount: yer(-1n) }, "cash.sign_mismatch"],
    ["positive expense", { kind: "EXPENSE" }, "cash.sign_mismatch"],
    ["transfer without pair", { kind: "TRANSFER_IN" }, "cash.pair_required"],
    ["sale with pair", { pairId: "p" }, "cash.unexpected_pair"],
    ["fx without rate", { kind: "FX_IN", pairId: "p" }, "cash.rate_required"],
    ["fx foreign currency", { kind: "FX_IN", pairId: "p", rateSnapshot: snap, amount: Money.minor(100n, "USD") }, "cash.rate_pair_mismatch"],
    ["sale with rate", { rateSnapshot: snap }, "cash.unexpected_rate"],
    ["adjustment w/o reason", { kind: "ADJUSTMENT" }, "cash.reason_required"],
    ["bad timestamp", { occurredAt: "not-a-date" }, "cash.invalid_timestamp"],
  ])("rejects %s", (_l, over, expected) => {
    expect(code(CashMovement.create(props(over)))).toBe(expected);
  });
});

describe("balances", () => {
  const ms = [
    mk({ amount: sar(50n) }),
    mk({ amount: yer(35_000n), shiftId: "s1" }),
    mk({ kind: "EXPENSE", amount: yer(-5_000n), shiftId: "s1" }),
    mk({ kind: "OPENING_FLOAT", amount: yer(20_000n), shiftId: "s1" }),
    mk({ cashboxId: "cb2", amount: yer(7n) }),
  ];
  it("derives per-currency balances in canonical order (pay_out of 5,000 reduces cash)", () => {
    const all = deriveCashBalances(ms, { cashboxId: "cb1" });
    expect([...all.keys()]).toEqual(["YER_OLD", "SAR"]);
    expect(all.get("YER_OLD")).toEqual(yer(50_000n));
    expect(cashBalance(ms, "YER_OLD", { shiftId: "s1", excludeKinds: ["OPENING_FLOAT"] })).toEqual(yer(30_000n));
    expect(cashBalance(ms, "YER_OLD")).toEqual(yer(50_007n));
    expect(cashBalance(ms, "USD")).toEqual(Money.zero("USD"));
  });
});

describe("checkPair", () => {
  const tOut = mk({ kind: "TRANSFER_OUT", amount: yer(-10n), pairId: "p" });
  const tIn = mk({ kind: "TRANSFER_IN", amount: yer(10n), pairId: "p", cashboxId: "safe" });
  const fIn = mk({ kind: "FX_IN", amount: sar(100n), pairId: "p", rateSnapshot: snap });
  const fOut = mk({ kind: "FX_OUT", amount: yer(-13_800n), pairId: "p", rateSnapshot: snap });
  it.each<[string, CashMovement, CashMovement, string]>([
    ["transfer ok", tOut, tIn, "ok"],
    ["fx ok", fIn, fOut, "ok"],
    ["different pair", tOut, mk({ kind: "TRANSFER_IN", amount: yer(10n), pairId: "q", cashboxId: "safe" }), "cash.pair_mismatch"],
    ["unpaired", mk(), mk(), "cash.pair_mismatch"],
    ["mixed kinds", tOut, fIn, "cash.pair_kinds"],
    ["unbalanced", tOut, mk({ kind: "TRANSFER_IN", amount: yer(9n), pairId: "p", cashboxId: "safe" }), "cash.pair_unbalanced"],
    ["currency", tOut, mk({ kind: "TRANSFER_IN", amount: sar(10n), pairId: "p", cashboxId: "safe" }), "cash.pair_unbalanced"],
    ["same cashbox", tOut, mk({ kind: "TRANSFER_IN", amount: yer(10n), pairId: "p" }), "cash.pair_same_cashbox"],
    ["fx two boxes", fIn, mk({ kind: "FX_OUT", amount: yer(-1n), pairId: "p", rateSnapshot: snap, cashboxId: "x" }), "cash.pair_cashbox_mismatch"],
    ["fx one currency", fIn, mk({ kind: "FX_OUT", amount: sar(-1n), pairId: "p", rateSnapshot: snap }), "cash.pair_same_currency"],
  ])("%s", (_l, a, b, expected) => {
    expect(code(checkPair(a, b))).toBe(expected);
  });
});
