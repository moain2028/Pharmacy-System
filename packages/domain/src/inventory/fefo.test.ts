import { describe, expect, it } from "vitest";
import { Money } from "../money/money.js";
import { unwrap, type Result } from "../shared/result.js";
import { FEFO_OVERRIDE_PERMISSION, allocateFefo, fefoCompare, type FefoOverride, type FefoPolicy, type LotBalance } from "./fefo.js";
import { Lot, type LotManualStatus } from "./lot.js";

function errCode<T>(r: Result<T>): string {
  if (r.ok) throw new Error("expected Err");
  return r.error.code;
}
function errDetails<T>(r: Result<T>): Readonly<Record<string, unknown>> {
  if (r.ok) throw new Error("expected Err");
  return r.error.details;
}

function balance(
  lotId: string,
  expiry: string,
  qty: bigint,
  total: string,
  opts: { receivedAt?: string; manualStatus?: LotManualStatus; itemId?: string; received?: bigint } = {},
): LotBalance {
  const lot = unwrap(
    Lot.create({
      lotId,
      itemId: opts.itemId ?? "I1",
      lotNumber: lotId,
      expiryDate: expiry,
      qtyReceivedSsu: opts.received ?? qty,
      totalCostMinor: unwrap(Money.parse(total, "YER_NEW")),
      sourceType: "OFFICIAL",
      manualStatus: opts.manualStatus,
    }),
  );
  return { lot, availableSsu: qty, receivedAt: opts.receivedAt ?? "2025-10-01T00:00:00.000Z" };
}

const A = balance("A", "2026-03-31", 50n, "40000.00");
const B = balance("B", "2026-09-30", 40n, "20000.00");
const C = balance("C", "2027-01-31", 60n, "60000.00");
const policy: FefoPolicy = { allowNegativeStock: false, nearExpiryDays: 180 };
const goodOverride: FefoOverride = { permission: FEFO_OVERRIDE_PERMISSION, approvedBy: "U9", reason: "customer_requested_longer_expiry" };
const req = (qtySsu: bigint, lots: LotBalance[] = [C, B, A], businessDate = "2026-01-15") => ({ itemId: "I1", qtySsu, businessDate, lots });
const pick = (r: Result<{ allocations: readonly { lotId: string; qtySsu: bigint }[] }>) =>
  unwrap(r).allocations.map((a) => `${a.lotId}:${a.qtySsu}`);

describe("allocateFefo golden scenarios", () => {
  it("sale 30 → A only, with proportional cost", () => {
    const r = unwrap(allocateFefo(req(30n), policy));
    expect(r.allocations.map((a) => [a.lotId, a.qtySsu, a.costMinor.toDecimalString(), a.status, a.viaOverride])).toEqual([
      ["A", 30n, "24000.00", "NEAR_EXPIRY", false],
    ]);
    expect(r.shortfallSsu).toBe(0n);
    expect(r.skippedLotIds).toEqual([]);
    expect(r.override).toBeNull();
    expect(Object.isFrozen(r)).toBe(true);
    expect(Object.isFrozen(r.allocations)).toBe(true);
  });
  it("sale 70 → A50 + B20", () => {
    expect(pick(allocateFefo(req(70n), policy))).toEqual(["A:50", "B:20"]);
  });
  it("sale exactly 50 stops after A", () => {
    expect(pick(allocateFefo(req(50n), policy))).toEqual(["A:50"]);
  });
  it("on A's expiry day A is skipped → B40 + C30", () => {
    expect(pick(allocateFefo(req(70n, [C, B, A], "2026-03-31"), policy))).toEqual(["B:40", "C:30"]);
  });
  it("insufficient stock reports the shortfall", () => {
    const r = allocateFefo(req(200n), policy);
    expect(errCode(r)).toBe("inventory.insufficient_stock");
    expect(errDetails(r)).toMatchObject({ requestedSsu: "200", allocatedSsu: "150", shortfallSsu: "50", expiredSsu: "0" });
  });
  it("reports expired quantity when everything is expired (FR-LOT-105 AC)", () => {
    const r = allocateFefo(req(1n, [A, B, C], "2027-02-01"), policy);
    expect(errDetails(r)).toMatchObject({ allocatedSsu: "0", expiredSsu: "150" });
  });
  it("no lots at all → insufficient", () => {
    expect(errCode(allocateFefo(req(1n, []), policy))).toBe("inventory.insufficient_stock");
  });
  it("allowNegativeStock returns the shortfall instead of failing", () => {
    const r = unwrap(allocateFefo(req(200n), { ...policy, allowNegativeStock: true }));
    expect(r.allocations.map((a) => a.qtySsu)).toEqual([50n, 40n, 60n]);
    expect(r.shortfallSsu).toBe(50n);
  });
  it("skips non-sellable lots (BLOCKED / QUARANTINED / DEPLETED)", () => {
    const blockedB = balance("B", "2026-09-30", 40n, "20000.00", { manualStatus: "BLOCKED" });
    const emptyC = { ...C, availableSsu: 0n };
    expect(pick(allocateFefo(req(70n, [A, blockedB, C]), policy))).toEqual(["A:50", "C:20"]);
    expect(errCode(allocateFefo(req(60n, [A, blockedB, emptyC]), policy))).toBe("inventory.insufficient_stock");
  });
});

describe("FEFO ordering", () => {
  it("tie-breaks by receivedAt then lotId", () => {
    const y = balance("Y", "2026-05-01", 5n, "500.00", { receivedAt: "2026-01-01T00:00:00.000Z" });
    const x = balance("X", "2026-05-01", 5n, "500.00", { receivedAt: "2026-01-02T00:00:00.000Z" });
    const w = balance("W", "2026-05-01", 5n, "500.00", { receivedAt: "2026-01-01T00:00:00.000Z" });
    expect(pick(allocateFefo(req(12n, [x, y, w]), policy))).toEqual(["W:5", "Y:5", "X:2"]);
  });
  it("fefoCompare is a total order", () => {
    expect(fefoCompare(A, B)).toBe(-1);
    expect(fefoCompare(B, A)).toBe(1);
    const y = balance("Y", "2026-05-01", 5n, "500.00", { receivedAt: "2026-01-01T00:00:00.000Z" });
    const x = balance("X", "2026-05-01", 5n, "500.00", { receivedAt: "2026-01-02T00:00:00.000Z" });
    expect(fefoCompare(y, x)).toBe(-1);
    expect(fefoCompare(x, y)).toBe(1);
    const w = balance("W", "2026-05-01", 5n, "500.00", { receivedAt: "2026-01-01T00:00:00.000Z" });
    expect(fefoCompare(w, y)).toBe(-1);
    expect(fefoCompare(y, w)).toBe(1);
    expect(fefoCompare(y, y)).toBe(0);
  });
  it("honours sale_block_days_before_expiry", () => {
    expect(pick(allocateFefo(req(10n, [A, B], "2026-03-25"), { ...policy, saleBlockDaysBeforeExpiry: 7 }))).toEqual(["B:10"]);
    expect(pick(allocateFefo(req(10n, [A, B], "2026-03-25"), { ...policy, saleBlockDaysBeforeExpiry: 0 }))).toEqual(["A:10"]);
    expect(pick(allocateFefo(req(10n, [A, B], "2026-03-25"), policy))).toEqual(["A:10"]);
  });
});

describe("override (FR-LOT-104)", () => {
  it("uses the chosen lot first, then continues FEFO, recording skipped lots", () => {
    const r = unwrap(allocateFefo({ ...req(70n), overrideLotId: "C", override: goodOverride }, policy));
    expect(r.allocations.map((a) => [a.lotId, a.qtySsu, a.viaOverride])).toEqual([
      ["C", 60n, true],
      ["A", 10n, false],
    ]);
    expect(r.skippedLotIds).toEqual(["A", "B"]);
    expect(r.override).toEqual(goodOverride);
  });
  it("choosing the FEFO-first lot skips nothing", () => {
    const r = unwrap(allocateFefo({ ...req(10n), overrideLotId: "A", override: goodOverride }, policy));
    expect(r.skippedLotIds).toEqual([]);
  });
  it.each<[string, FefoOverride | undefined]>([
    ["missing", undefined],
    ["wrong permission", { ...goodOverride, permission: "inventory.other" as typeof FEFO_OVERRIDE_PERMISSION }],
    ["empty approver", { ...goodOverride, approvedBy: " " }],
    ["empty reason", { ...goodOverride, reason: "" }],
  ])("rejects an override that is %s", (_label, override) => {
    const r = allocateFefo({ ...req(10n), overrideLotId: "C", override }, policy);
    expect(errCode(r)).toBe("inventory.fefo_override_required");
  });
  it("rejects an unknown override lot", () => {
    expect(errCode(allocateFefo({ ...req(10n), overrideLotId: "Z", override: goodOverride }, policy))).toBe("inventory.lot_not_found");
  });
  it("never issues from an expired lot, even with a valid override", () => {
    const r = allocateFefo({ ...req(10n, [A, B, C], "2026-03-31"), overrideLotId: "A", override: goodOverride }, policy);
    expect(errCode(r)).toBe("inventory.lot_expired");
  });
  it("rejects blocked or too-short lots as not sellable", () => {
    const blockedB = balance("B", "2026-09-30", 40n, "20000.00", { manualStatus: "BLOCKED" });
    const r1 = allocateFefo({ ...req(10n, [A, blockedB]), overrideLotId: "B", override: goodOverride }, policy);
    expect(errCode(r1)).toBe("inventory.lot_not_sellable");
    expect(errDetails(r1)).toMatchObject({ status: "BLOCKED" });
    const r2 = allocateFefo(
      { ...req(10n, [A, B], "2026-03-25"), overrideLotId: "A", override: goodOverride },
      { ...policy, saleBlockDaysBeforeExpiry: 7 },
    );
    expect(errCode(r2)).toBe("inventory.lot_not_sellable");
  });
  it("override still obeys the negative stock policy", () => {
    expect(errCode(allocateFefo({ ...req(200n), overrideLotId: "C", override: goodOverride }, policy))).toBe(
      "inventory.insufficient_stock",
    );
  });
});

describe("request validation", () => {
  it("rejects non-positive quantity and invalid date", () => {
    expect(errCode(allocateFefo(req(0n), policy))).toBe("qty.not_positive");
    expect(errCode(allocateFefo(req(1n, [A], "2026-02-30"), policy))).toBe("date.invalid_calendar_day");
  });
  it("rejects lots of another item", () => {
    const other = balance("O", "2026-05-01", 5n, "500.00", { itemId: "I2" });
    expect(errCode(allocateFefo(req(1n, [A, other]), policy))).toBe("inventory.item_mismatch");
  });
  it("propagates lot cost errors when a balance exceeds the lot's receipt", () => {
    const inconsistent = balance("Q", "2026-05-01", 10n, "500.00", { received: 5n });
    expect(errCode(allocateFefo(req(10n, [inconsistent]), policy))).toBe("inventory.qty_exceeds_lot");
  });
});
