import { describe, expect, it } from "vitest";
import { Money } from "../money/money.js";
import { DomainError, unwrap, type Result } from "../shared/result.js";
import {
  LOT_EFFECTIVE_STATUSES,
  LOT_MANUAL_STATUSES,
  Lot,
  isLotManualStatus,
  isLotSourceType,
  isSellableStatus,
  normalizeLotNumber,
  type LotManualStatus,
  type LotProps,
  type LotSourceType,
} from "./lot.js";

const yer = (t: string): Money => unwrap(Money.parse(t, "YER_NEW"));
function errCode<T>(r: Result<T>): string {
  if (r.ok) throw new Error("expected Err");
  return r.error.code;
}
const base: LotProps = {
  lotId: "L1",
  itemId: "I1",
  lotNumber: "AB12",
  expiryDate: "2026-03-31",
  qtyReceivedSsu: 50n,
  totalCostMinor: yer("40000.00"),
  sourceType: "OFFICIAL",
};
const mkLot = (over: Partial<LotProps> = {}): Lot => unwrap(Lot.create({ ...base, ...over }));
const dec = (ms: readonly Money[]): string[] => ms.map((m) => m.toDecimalString());

describe("Lot.create", () => {
  it("normalises the lot number and defaults optional facts", () => {
    const lot = mkLot({ lotNumber: "  ab12 " });
    expect(lot.lotNumber).toBe("AB12");
    expect(lot.manualStatus).toBe("NONE");
    expect(lot.supplierId).toBeUndefined();
    expect(lot.printedPublicPriceMinor).toBeUndefined();
    expect(Object.isFrozen(lot)).toBe(true);
  });
  it("keeps supplied optional facts", () => {
    const lot = mkLot({
      supplierId: "S1",
      printedPublicPriceMinor: yer("1200.00"),
      manualStatus: "QUARANTINED",
      sourceType: "PARALLEL",
    });
    expect(lot.supplierId).toBe("S1");
    expect(lot.printedPublicPriceMinor?.toDecimalString()).toBe("1200.00");
    expect(lot.manualStatus).toBe("QUARANTINED");
    expect(lot.sourceType).toBe("PARALLEL");
  });
  it.each<[string, Partial<LotProps>]>([
    ["inventory.lot_identity_required", { lotId: " " }],
    ["inventory.lot_identity_required", { itemId: "" }],
    ["inventory.lot_number_required", { lotNumber: "   " }],
    ["inventory.lot_number_too_long", { lotNumber: "X".repeat(51) }],
    ["date.invalid_calendar_day", { expiryDate: "2026-02-30" }],
    ["date.invalid", { expiryDate: "30/02/2026" }],
    ["qty.not_positive", { qtyReceivedSsu: 0n }],
    ["qty.not_positive", { qtyReceivedSsu: -5n }],
    ["inventory.unknown_source_type", { sourceType: "GREY" as LotSourceType }],
    ["inventory.unknown_manual_status", { manualStatus: "LOST" as LotManualStatus }],
    ["inventory.negative_cost", { totalCostMinor: yer("-1.00") }],
    ["inventory.currency_mismatch", { printedPublicPriceMinor: Money.minor(100n, "USD") }],
    ["inventory.negative_printed_price", { printedPublicPriceMinor: yer("-1.00") }],
  ])("rejects with %s", (code, over) => {
    expect(errCode(Lot.create({ ...base, ...over }))).toBe(code);
  });
});

describe("helpers", () => {
  it("normalizeLotNumber upper-cases and trims", () => {
    expect(normalizeLotNumber(" ab12\t")).toBe("AB12");
  });
  it("type guards", () => {
    expect(isLotSourceType("OFFICIAL")).toBe(true);
    expect(isLotSourceType("x")).toBe(false);
    expect(isLotSourceType(1)).toBe(false);
    expect(LOT_MANUAL_STATUSES.every(isLotManualStatus)).toBe(true);
    expect(isLotManualStatus("EXPIRED")).toBe(false);
  });
  it("isSellableStatus is true only for AVAILABLE / NEAR_EXPIRY", () => {
    const sellable = LOT_EFFECTIVE_STATUSES.filter(isSellableStatus);
    expect(sellable).toEqual(["AVAILABLE", "NEAR_EXPIRY"]);
  });
});

describe("expiry", () => {
  const lot = mkLot();
  it("is expired from the start of the expiry date (Q4)", () => {
    expect(lot.isExpired("2026-03-30")).toBe(false);
    expect(lot.isExpired("2026-03-31")).toBe(true);
    expect(lot.isExpired("2026-04-01")).toBe(true);
  });
  it("daysToExpiry is signed", () => {
    expect(lot.daysToExpiry("2026-01-15")).toBe(75);
    expect(lot.daysToExpiry("2026-04-05")).toBe(-5);
  });
  it("throws on an invalid business date (programmer error)", () => {
    expect(() => lot.isExpired("bad")).toThrow(DomainError);
    expect(() => lot.daysToExpiry("2026-13-01")).toThrow(DomainError);
  });
});

describe("effectiveStatus", () => {
  it.each(LOT_MANUAL_STATUSES.filter((s) => s !== "NONE"))("manual %s wins over expiry and stock", (s) => {
    expect(mkLot({ manualStatus: s }).effectiveStatus("2027-01-01", 0n, 180)).toBe(s);
  });
  it("EXPIRED on the expiry date even with stock", () => {
    expect(mkLot().effectiveStatus("2026-03-31", 10n, 180)).toBe("EXPIRED");
  });
  it("DEPLETED when nothing available (zero or negative)", () => {
    expect(mkLot().effectiveStatus("2026-01-01", 0n, 180)).toBe("DEPLETED");
    expect(mkLot().effectiveStatus("2026-01-01", -1n, 180)).toBe("DEPLETED");
  });
  it("NEAR_EXPIRY at the tier boundary, AVAILABLE beyond it", () => {
    expect(mkLot().effectiveStatus("2025-10-02", 10n, 180)).toBe("NEAR_EXPIRY");
    expect(mkLot().effectiveStatus("2025-10-01", 10n, 180)).toBe("AVAILABLE");
  });
  it("throws on invalid nearExpiryDays", () => {
    expect(() => mkLot().effectiveStatus("2026-01-01", 1n, -1)).toThrow(DomainError);
    expect(() => mkLot().effectiveStatus("2026-01-01", 1n, 1.5)).toThrow(DomainError);
  });
});

describe("applyManualStatus (FR-LOT-102)", () => {
  const allowed: [LotManualStatus, LotManualStatus][] = [
    ["NONE", "QUARANTINED"],
    ["NONE", "BLOCKED"],
    ["QUARANTINED", "NONE"],
    ["QUARANTINED", "RETURNED_TO_SUPPLIER"],
    ["QUARANTINED", "DESTROYED"],
    ["BLOCKED", "QUARANTINED"],
    ["BLOCKED", "RETURNED_TO_SUPPLIER"],
    ["BLOCKED", "DESTROYED"],
  ];
  it.each(allowed)("%s → %s is allowed", (from, to) => {
    expect(unwrap(mkLot({ manualStatus: from }).applyManualStatus(to, "2026-01-01")).manualStatus).toBe(to);
  });
  const rejected: [LotManualStatus, LotManualStatus][] = [
    ["NONE", "NONE"],
    ["NONE", "RETURNED_TO_SUPPLIER"],
    ["NONE", "DESTROYED"],
    ["QUARANTINED", "BLOCKED"],
    ["QUARANTINED", "QUARANTINED"],
    ["BLOCKED", "NONE"],
    ["RETURNED_TO_SUPPLIER", "NONE"],
    ["RETURNED_TO_SUPPLIER", "DESTROYED"],
    ["DESTROYED", "NONE"],
    ["DESTROYED", "RETURNED_TO_SUPPLIER"],
  ];
  it.each(rejected)("%s → %s is rejected before expiry", (from, to) => {
    const r = mkLot({ manualStatus: from }).applyManualStatus(to, "2026-01-01");
    expect(errCode(r)).toBe("inventory.lot_invalid_transition");
    if (!r.ok) expect(r.error.details).toMatchObject({ from, to, specCode: "LOT_INVALID_TRANSITION" });
  });
  it("EXPIRED (manual NONE) may go to RETURNED_TO_SUPPLIER or DESTROYED", () => {
    expect(unwrap(mkLot().applyManualStatus("DESTROYED", "2026-03-31")).manualStatus).toBe("DESTROYED");
    expect(unwrap(mkLot().applyManualStatus("RETURNED_TO_SUPPLIER", "2026-04-01")).manualStatus).toBe(
      "RETURNED_TO_SUPPLIER",
    );
  });
  it("expiry does not open other transitions", () => {
    expect(errCode(mkLot().applyManualStatus("NONE", "2026-03-31"))).toBe("inventory.lot_invalid_transition");
    expect(errCode(mkLot({ manualStatus: "QUARANTINED" }).applyManualStatus("BLOCKED", "2026-03-31"))).toBe(
      "inventory.lot_invalid_transition",
    );
  });
  it("returns a new frozen Lot and leaves the original untouched", () => {
    const original = mkLot({ supplierId: "S1" });
    const next = unwrap(original.applyManualStatus("BLOCKED", "2026-01-01"));
    expect(original.manualStatus).toBe("NONE");
    expect(next).not.toBe(original);
    expect(next.supplierId).toBe("S1");
    expect(Object.isFrozen(next)).toBe(true);
  });
});

describe("costing (FR-INV-107)", () => {
  it("unitCostHint is Half-Up", () => {
    expect(mkLot().unitCostHint().toDecimalString()).toBe("800.00");
    expect(mkLot({ qtyReceivedSsu: 12n, totalCostMinor: yer("1000.00") }).unitCostHint().toDecimalString()).toBe("83.33");
  });
  it("golden: lot 50 @ 40,000.00 → cost for 30 = 24,000.00", () => {
    expect(unwrap(mkLot().costForSsu(30n)).toDecimalString()).toBe("24000.00");
    expect(unwrap(mkLot().costForSsu(50n)).toDecimalString()).toBe("40000.00");
    expect(unwrap(mkLot().costForSsu(0n)).toDecimalString()).toBe("0.00");
  });
  it("rounds Half-Up and values inventory after a sale", () => {
    const lot = mkLot({ qtyReceivedSsu: 12n, totalCostMinor: yer("1000.00") });
    expect(unwrap(lot.costForSsu(1n)).toDecimalString()).toBe("83.33");
    expect(unwrap(lot.costForSsu(11n)).toDecimalString()).toBe("916.67");
    expect(unwrap(mkLot({ qtyReceivedSsu: 3n, totalCostMinor: yer("100.00") }).costForSsu(2n)).toDecimalString()).toBe(
      "66.67",
    );
  });
  it("costForSsu rejects out-of-range quantities", () => {
    expect(errCode(mkLot().costForSsu(51n))).toBe("inventory.qty_exceeds_lot");
    expect(errCode(mkLot().costForSsu(-1n))).toBe("qty.negative");
  });
  const lot100 = mkLot({ qtyReceivedSsu: 3n, totalCostMinor: yer("100.00") });
  it("golden residual: 100.00 over 3 in issues 1,1,1 → 33.33 + 33.33 + 33.34", () => {
    const costs = unwrap(lot100.costSchedule([1n, 1n, 1n]));
    expect(dec(costs)).toEqual(["33.33", "33.33", "33.34"]);
    expect(Money.sum(costs).toDecimalString()).toBe("100.00");
  });
  it("spec: 1000.00 over 12 sold one by one → 11 × 83.33 then 83.37", () => {
    const lot = mkLot({ qtyReceivedSsu: 12n, totalCostMinor: yer("1000.00") });
    const costs = unwrap(lot.costSchedule(Array.from({ length: 12 }, () => 1n)));
    expect(dec(costs.slice(0, 11))).toEqual(Array.from({ length: 11 }, () => "83.33"));
    expect(dec(costs.slice(11))).toEqual(["83.37"]);
    expect(Money.sum(costs).toDecimalString()).toBe("1000.00");
  });
  it("clamps intermediate issues so costs never go negative", () => {
    const tiny = mkLot({ qtyReceivedSsu: 5n, totalCostMinor: yer("0.03") });
    const costs = unwrap(tiny.costSchedule([1n, 1n, 1n, 1n, 1n]));
    expect(dec(costs)).toEqual(["0.01", "0.01", "0.01", "0.00", "0.00"]);
  });
  it("last unit out takes the whole remaining cost", () => {
    expect(unwrap(lot100.costForSsuWithResidual(3n, 3n, yer("100.00"))).toDecimalString()).toBe("100.00");
    expect(unwrap(lot100.costForSsuWithResidual(1n, 1n, yer("33.34"))).toDecimalString()).toBe("33.34");
    expect(unwrap(lot100.costForSsuWithResidual(1n, 2n, yer("66.67"))).toDecimalString()).toBe("33.33");
  });
  it.each<[string, bigint, bigint, Money]>([
    ["qty.not_positive", 0n, 3n, yer("100.00")],
    ["qty.not_positive", 1n, 0n, yer("100.00")],
    ["inventory.qty_exceeds_lot", 1n, 4n, yer("100.00")],
    ["inventory.qty_exceeds_lot", 3n, 2n, yer("100.00")],
    ["inventory.currency_mismatch", 1n, 3n, Money.minor(1n, "USD")],
    ["inventory.remaining_cost_out_of_range", 1n, 3n, yer("-1.00")],
    ["inventory.remaining_cost_out_of_range", 1n, 3n, yer("100.01")],
  ])("costForSsuWithResidual rejects with %s", (code, qty, rem, cost) => {
    expect(errCode(lot100.costForSsuWithResidual(qty, rem, cost))).toBe(code);
  });
  it("costSchedule propagates errors", () => {
    expect(errCode(lot100.costSchedule([2n, 2n]))).toBe("inventory.qty_exceeds_lot");
  });
});
