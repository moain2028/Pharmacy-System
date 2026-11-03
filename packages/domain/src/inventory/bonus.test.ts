import { describe, expect, it } from "vitest";
import { Money } from "../money/money.js";
import { unwrap, type Result } from "../shared/result.js";
import { landedCostAllocate, receiptWithBonus, splitBonusAcrossLots } from "./bonus.js";

const yer = (t: string): Money => unwrap(Money.parse(t, "YER_NEW"));
function errCode<T>(r: Result<T>): string {
  if (r.ok) throw new Error("expected Err");
  return r.error.code;
}

describe("receiptWithBonus (FR-LOT-113)", () => {
  it("golden: 10 + 2 at 1,200.00 → 12 units, total 1,200.00, unit cost 100.00", () => {
    const r = unwrap(receiptWithBonus(10n, 2n, yer("1200.00")));
    expect(r.qtyPaidSsu).toBe(10n);
    expect(r.qtyBonusSsu).toBe(2n);
    expect(r.qtyTotalSsu).toBe(12n);
    expect(r.totalCostMinor.toDecimalString()).toBe("1200.00");
    expect(r.unitCostHintMinor.toDecimalString()).toBe("100.00");
    expect(Object.isFrozen(r)).toBe(true);
  });
  it("spec: 10 + 2 at 1,000.00 → unit hint 83.33", () => {
    expect(unwrap(receiptWithBonus(10n, 2n, yer("1000.00"))).unitCostHintMinor.toDecimalString()).toBe("83.33");
  });
  it("works with zero bonus", () => {
    const r = unwrap(receiptWithBonus(10n, 0n, yer("1200.00")));
    expect(r.qtyTotalSsu).toBe(10n);
    expect(r.unitCostHintMinor.toDecimalString()).toBe("120.00");
  });
  it.each<[string, bigint, bigint, Money]>([
    ["qty.not_positive", 0n, 2n, yer("1200.00")],
    ["qty.not_positive", -1n, 2n, yer("1200.00")],
    ["qty.negative", 10n, -1n, yer("1200.00")],
    ["inventory.negative_cost", 10n, 2n, yer("-1.00")],
  ])("rejects with %s", (code, paid, bonus, total) => {
    expect(errCode(receiptWithBonus(paid, bonus, total))).toBe(code);
  });
});

describe("splitBonusAcrossLots", () => {
  it("splits by quantity without losing a minor unit", () => {
    const s = unwrap(splitBonusAcrossLots(10n, 2n, yer("1200.00")));
    expect(s.paidLotCostMinor.toDecimalString()).toBe("1000.00");
    expect(s.bonusLotCostMinor.toDecimalString()).toBe("200.00");
    const odd = unwrap(splitBonusAcrossLots(1n, 2n, yer("1.00")));
    expect([odd.paidLotCostMinor.toDecimalString(), odd.bonusLotCostMinor.toDecimalString()]).toEqual(["0.33", "0.67"]);
    expect(unwrap(splitBonusAcrossLots(10n, 0n, yer("1200.00"))).bonusLotCostMinor.isZero()).toBe(true);
    expect(Object.isFrozen(s)).toBe(true);
  });
  it("propagates receipt errors and rejects quantities beyond safe integers", () => {
    expect(errCode(splitBonusAcrossLots(0n, 1n, yer("1.00")))).toBe("qty.not_positive");
    expect(errCode(splitBonusAcrossLots(2n ** 60n, 1n, yer("1.00")))).toBe("inventory.ratio_overflow");
    expect(errCode(splitBonusAcrossLots(1n, 2n ** 60n, yer("1.00")))).toBe("inventory.ratio_overflow");
  });
});

describe("landedCostAllocate", () => {
  const lots = [
    { lotId: "A", totalCostMinor: yer("300.00") },
    { lotId: "B", totalCostMinor: yer("100.00") },
  ];
  it("allocates by cost ratio and updates totals", () => {
    const r = unwrap(landedCostAllocate(lots, yer("100.00")));
    expect(r.map((x) => [x.lotId, x.extraCostMinor.toDecimalString(), x.newTotalCostMinor.toDecimalString()])).toEqual([
      ["A", "75.00", "375.00"],
      ["B", "25.00", "125.00"],
    ]);
    expect(Object.isFrozen(r)).toBe(true);
  });
  it("handles credits (negative extra cost)", () => {
    const r = unwrap(landedCostAllocate(lots, yer("-30.00")));
    expect(r.map((x) => x.extraCostMinor.toDecimalString())).toEqual(["-22.50", "-7.50"]);
  });
  it("spreads equally when all lot costs are zero", () => {
    const zero = ["A", "B", "C"].map((lotId) => ({ lotId, totalCostMinor: Money.zero("YER_NEW") }));
    const r = unwrap(landedCostAllocate(zero, yer("100.00")));
    expect(r.map((x) => x.newTotalCostMinor.toDecimalString())).toEqual(["33.34", "33.33", "33.33"]);
  });
  it.each<[string, { lotId: string; totalCostMinor: Money }[], Money]>([
    ["inventory.landed_cost_no_lots", [], yer("1.00")],
    ["inventory.currency_mismatch", [{ lotId: "U", totalCostMinor: Money.minor(100n, "USD") }], yer("1.00")],
    ["inventory.negative_cost", [{ lotId: "N", totalCostMinor: yer("-1.00") }], yer("1.00")],
    ["inventory.ratio_overflow", [{ lotId: "H", totalCostMinor: Money.minor(2n ** 60n, "YER_NEW") }], yer("1.00")],
  ])("rejects with %s", (code, input, extra) => {
    expect(errCode(landedCostAllocate(input, extra))).toBe(code);
  });
});
