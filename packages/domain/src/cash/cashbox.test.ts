import { describe, expect, it } from "vitest";
import { Money } from "../money/money.js";
import { ExchangeRate } from "../fx/exchange-rate.js";
import { unwrap, type Result } from "../shared/result.js";
import { checkPair } from "./cash-movement.js";
import {
  CASHBOX_KINDS, Cashbox, daySafeDrop, exchangeFx, transferCash,
  type CashboxProps, type FxExchangeInput, type SafeDropInput, type TransferInput,
} from "./cashbox.js";

const yer = (n: bigint): Money => Money.minor(n * 100n, "YER_OLD");
const sar = (n: bigint): Money => Money.minor(n * 100n, "SAR");
const code = (r: Result<unknown>): string => (r.ok ? "ok" : r.error.code);
const reg = unwrap(Cashbox.create({ cashboxId: "reg", kind: "REGISTER", name: " Drawer 1 ", currencies: ["YER_OLD", "SAR"] }));
const safe = unwrap(Cashbox.create({ cashboxId: "safe", kind: "SAFE", name: "Safe", currencies: ["YER_OLD"] }));
const rate = unwrap(ExchangeRate.create({
  from: "SAR", to: "YER_OLD", buyRateScaled: 138_000_000n, sellRateScaled: 140_000_000n,
  effectiveFrom: new Date("2025-01-01T00:00:00Z"),
}));
const at = "2025-03-01T20:00:00Z";

describe("Cashbox", () => {
  it("creates, accepts currencies and deactivates immutably", () => {
    expect(CASHBOX_KINDS).toEqual(["REGISTER", "SAFE", "BANK", "WALLET"]);
    expect(Object.isFrozen(reg)).toBe(true);
    expect(reg.name).toBe("Drawer 1");
    expect(reg.active).toBe(true);
    expect(reg.accepts("SAR")).toBe(true);
    expect(reg.accepts("USD")).toBe(false);
    const off = reg.deactivate();
    expect([off.active, reg.active, off.currencies]).toEqual([false, true, ["YER_OLD", "SAR"]]);
  });
  it.each<[Partial<CashboxProps>, string]>([
    [{ cashboxId: "" }, "cashbox.missing_id"],
    [{ name: " " }, "cashbox.missing_name"],
    [{ currencies: [] }, "cashbox.no_currency"],
    [{ currencies: ["SAR", "SAR"] }, "cashbox.duplicate_currency"],
  ])("rejects %o", (over, expected) => {
    expect(code(Cashbox.create({ cashboxId: "b", kind: "BANK", name: "Bank", currencies: ["USD"], ...over }))).toBe(expected);
  });
});

describe("transferCash", () => {
  const input = (over: Partial<TransferInput> = {}): TransferInput => ({
    pairId: "p1", outMovementId: "o1", inMovementId: "i1", from: reg, to: safe, amount: yer(5_000n),
    occurredAt: at, createdBy: "u1", shiftId: "s1", ...over,
  });
  it("creates balanced paired movements; shift only on the REGISTER leg", () => {
    const p = unwrap(transferCash(input({ fromBalance: yer(5_000n) })));
    expect(p.outbound.amount).toEqual(yer(-5_000n));
    expect(p.inbound.amount).toEqual(yer(5_000n));
    expect([p.outbound.shiftId, p.inbound.shiftId]).toEqual(["s1", null]);
    expect(p.inbound.documentRef).toEqual({ type: "CASH_TRANSFER", id: "p1" });
    expect(checkPair(p.outbound, p.inbound).ok).toBe(true);
  });
  it.each<[string, Partial<TransferInput>, string]>([
    ["same box", { to: reg }, "cashbox.same_cashbox"],
    ["zero", { amount: yer(0n) }, "cashbox.non_positive_amount"],
    ["inactive", { to: safe.deactivate() }, "cashbox.inactive"],
    ["currency", { amount: sar(10n) }, "cashbox.currency_not_accepted"],
    ["overdraw", { fromBalance: yer(1_000n) }, "cashbox.insufficient_funds"],
    ["blank pair", { pairId: "" }, "cash.pair_required"],
    ["blank in id", { inMovementId: " " }, "cash.missing_field"],
  ])("rejects %s", (_l, over, expected) => {
    expect(code(transferCash(input(over)))).toBe(expected);
  });
});

describe("exchangeFx", () => {
  const input = (over: Partial<FxExchangeInput> = {}): FxExchangeInput => ({
    pairId: "fx1", inMovementId: "i", outMovementId: "o", cashbox: reg, received: sar(100n), rate,
    occurredAt: at, createdBy: "u1", shiftId: "s1", ...over,
  });
  it("buys 100 SAR at 138 => pays 13,800 YER_OLD with frozen buy snapshot", () => {
    const r = unwrap(exchangeFx(input()));
    expect(r.paidOut).toEqual(yer(13_800n));
    expect(r.snapshot.direction).toBe("buy");
    expect(r.snapshot.rateScaledSnapshot).toBe(138_000_000n);
    expect([r.pair.inbound.kind, r.pair.outbound.kind, r.pair.outbound.shiftId]).toEqual(["FX_IN", "FX_OUT", "s1"]);
    expect(checkPair(r.pair.inbound, r.pair.outbound).ok).toBe(true);
  });
  it("sells SAR: 14,000 YER_OLD at 140 => 100 SAR", () => {
    const r = unwrap(exchangeFx(input({ received: yer(14_000n) })));
    expect([r.paidOut, r.snapshot.direction]).toEqual([sar(100n), "sell"]);
  });
  it("rounds the paid-out cash down to the step (10.37 SAR => 1,431.06 => 1,400 by 50)", () => {
    const r = unwrap(exchangeFx(input({ received: Money.minor(1037n, "SAR"), outRoundingStepMinor: 5000n })));
    expect(r.paidOut).toEqual(yer(1_400n));
  });
  it.each<[string, Partial<FxExchangeInput>, string]>([
    ["pair", { received: Money.minor(100n, "USD") }, "cashbox.fx_pair_mismatch"],
    ["zero", { received: sar(0n) }, "cashbox.non_positive_amount"],
    ["currency", { cashbox: safe }, "cashbox.currency_not_accepted"],
    ["inactive", { cashbox: reg.deactivate() }, "cashbox.inactive"],
    ["balance", { outBalance: yer(100n) }, "cashbox.insufficient_funds"],
    ["zero out", { received: Money.minor(1n, "SAR"), outRoundingStepMinor: 5000n }, "cashbox.fx_zero_out"],
    ["blank in id", { inMovementId: "" }, "cash.missing_field"],
    ["blank out id", { outMovementId: "" }, "cash.missing_field"],
  ])("rejects %s", (_l, over, expected) => {
    expect(code(exchangeFx(input(over)))).toBe(expected);
  });
});

describe("daySafeDrop", () => {
  const input = (over: Partial<SafeDropInput> = {}): SafeDropInput => {
    let n = 0;
    return {
      register: reg, safe, balances: [yer(30_000n), sar(50n)], keepFloat: [yer(10_000n), sar(50n)],
      occurredAt: at, createdBy: "u1", shiftId: "s1", newId: () => `id${++n}`, ...over,
    };
  };
  it("drops everything above the kept float", () => {
    const pairs = unwrap(daySafeDrop(input()));
    expect(pairs).toHaveLength(1);
    const p = pairs[0];
    expect(p?.inbound.amount).toEqual(yer(20_000n));
    expect([p?.outbound.pairId, p?.outbound.movementId, p?.inbound.movementId, p?.inbound.reason]).toEqual(["id1", "id2", "id3", "DAY_END_SAFE_DROP"]);
    expect(unwrap(daySafeDrop(input({ keepFloat: undefined, balances: [yer(1n)] })))[0]?.inbound.amount).toEqual(yer(1n));
  });
  it.each<[string, Partial<SafeDropInput>, string]>([
    ["source", { register: safe }, "cashbox.drop_source_kind"],
    ["target", { safe: reg }, "cashbox.drop_target_kind"],
    ["negative float", { keepFloat: [yer(-1n)] }, "cashbox.negative_float"],
    ["safe lacks SAR", { keepFloat: [], balances: [sar(100n)] }, "cashbox.currency_not_accepted"],
  ])("rejects %s", (_l, over, expected) => {
    expect(code(daySafeDrop(input(over)))).toBe(expected);
  });
});
