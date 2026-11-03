import { describe, expect, it } from "vitest";
import { decomposeSsu, scaleBySsuFactor, snapshotUnit, toSsu, toSsuQty, validateUnitLadder, type ItemUnit } from "./quantity.js";
import { Money } from "../money/money.js";
import { DomainError, unwrap } from "../shared/result.js";

const U = (p: Partial<ItemUnit> & Pick<ItemUnit, "unitId" | "factorToSsu" | "level">): ItemUnit => ({
  itemId: "item-1", nameAr: p.unitId, nameEn: p.unitId, isSsu: p.factorToSsu === 1n, canSell: true, canPurchase: true, active: true, ...p,
});
// carton = 10 boxes, box = 3 strips, strip = 10 tablets (SSU)
const LADDER: ItemUnit[] = [
  U({ unitId: "carton", factorToSsu: 300n, level: 1 }),
  U({ unitId: "box", factorToSsu: 30n, level: 2 }),
  U({ unitId: "strip", factorToSsu: 10n, level: 3 }),
  U({ unitId: "tablet", factorToSsu: 1n, level: 4 }),
];

describe("toSsu — rule A2: integer quantities only", () => {
  it("accepts integers in all forms", () => {
    expect(unwrap(toSsu(5))).toBe(5n);
    expect(unwrap(toSsu(5n))).toBe(5n);
    expect(unwrap(toSsu("-3"))).toBe(-3n);
  });
  it("rejects fractions/NaN/garbage", () => {
    for (const bad of [1.5, NaN, "1.5", "x", null, undefined, {}]) {
      const r = toSsu(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("qty.non_integer");
    }
  });
  it("enforces positive / nonNegative options", () => {
    expect(toSsu(0, { positive: true }).ok).toBe(false);
    expect(toSsu(-1, { nonNegative: true }).ok).toBe(false);
    expect(unwrap(toSsu(0, { nonNegative: true }))).toBe(0n);
  });
});

describe("validateUnitLadder (D-026)", () => {
  it("accepts a valid descending, multiple-based ladder", () => {
    expect(validateUnitLadder(LADDER).ok).toBe(true);
  });
  it("rejects empty ladder", () => {
    expect(validateUnitLadder([]).ok).toBe(false);
  });
  it("requires exactly one SSU with factor 1", () => {
    expect(validateUnitLadder([U({ unitId: "a", factorToSsu: 10n, level: 1 })]).ok).toBe(false);
    const twoSsu = [U({ unitId: "a", factorToSsu: 1n, level: 1 }), U({ unitId: "b", factorToSsu: 1n, level: 2 })];
    const r = validateUnitLadder(twoSsu);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("uom.ssu_count");
    const badSsu = [{ ...U({ unitId: "a", factorToSsu: 5n, level: 1 }), isSsu: true }];
    const r2 = validateUnitLadder(badSsu);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error.code).toBe("uom.ssu_factor");
  });
  it("rejects factor < 1", () => {
    const r = validateUnitLadder([U({ unitId: "z", factorToSsu: 0n, level: 1 }), U({ unitId: "t", factorToSsu: 1n, level: 2 })]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("uom.bad_factor");
  });
  it("rejects duplicate levels", () => {
    const r = validateUnitLadder([U({ unitId: "a", factorToSsu: 10n, level: 1 }), U({ unitId: "b", factorToSsu: 1n, level: 1 })]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("uom.duplicate_level");
  });
  it("rejects non-descending factors", () => {
    const r = validateUnitLadder([U({ unitId: "a", factorToSsu: 10n, level: 1 }), U({ unitId: "b", factorToSsu: 20n, level: 2 }), U({ unitId: "t", factorToSsu: 1n, level: 3 })]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("uom.not_descending");
  });
  it("rejects carton=25 over box=10 (not a whole multiple)", () => {
    const r = validateUnitLadder([U({ unitId: "carton", factorToSsu: 25n, level: 1 }), U({ unitId: "box", factorToSsu: 10n, level: 2 }), U({ unitId: "t", factorToSsu: 1n, level: 3 })]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("uom.not_multiple");
  });
  it("rejects an SSU placed above a larger unit (caught as not_descending)", () => {
    const r = validateUnitLadder([U({ unitId: "t", factorToSsu: 1n, level: 1 }), { ...U({ unitId: "b", factorToSsu: 10n, level: 2 }), isSsu: false }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("uom.not_descending");
  });
  it("accepts a single-unit ladder (SSU only)", () => {
    expect(validateUnitLadder([U({ unitId: "t", factorToSsu: 1n, level: 1 })]).ok).toBe(true);
  });
});

describe("conversions & snapshots", () => {
  it("toSsuQty multiplies by factor", () => {
    expect(toSsuQty(2n, LADDER[0] as ItemUnit)).toBe(600n);
    expect(toSsuQty(7n, LADDER[3] as ItemUnit)).toBe(7n);
  });
  it("snapshotUnit freezes the line facts", () => {
    const s = unwrap(snapshotUnit(LADDER[1] as ItemUnit, 4n));
    expect(s).toEqual({ unitId: "box", unitNameAr: "box", unitNameEn: "box", factorSnapshot: 30n, qtyInUnit: 4n, ssuQty: 120n });
    expect(Object.isFrozen(s)).toBe(true);
  });
  it("snapshotUnit rejects zero/negative qty and inactive units", () => {
    expect(snapshotUnit(LADDER[1] as ItemUnit, 0n).ok).toBe(false);
    expect(snapshotUnit({ ...(LADDER[1] as ItemUnit), active: false }, 1n).ok).toBe(false);
  });
  it("decomposeSsu renders largest-first with zero parts omitted", () => {
    const parts = decomposeSsu(644n, LADDER).map((p) => [p.unit.unitId, p.qty]);
    expect(parts).toEqual([["carton", 2n], ["box", 1n], ["strip", 1n], ["tablet", 4n]]);
    expect(decomposeSsu(30n, LADDER).map((p) => [p.unit.unitId, p.qty])).toEqual([["box", 1n]]);
    expect(decomposeSsu(0n, LADDER).map((p) => [p.unit.unitId, p.qty])).toEqual([["tablet", 0n]]);
  });
  it("decomposeSsu skips inactive non-SSU units and rejects negatives", () => {
    const ladder = LADDER.map((u) => (u.unitId === "box" ? { ...u, active: false } : u));
    expect(decomposeSsu(60n, ladder).map((p) => [p.unit.unitId, p.qty])).toEqual([["strip", 6n]]);
    expect(() => decomposeSsu(-1n, LADDER)).toThrow(DomainError);
    expect(() => decomposeSsu(0n, [])).toThrow(DomainError);
  });
  it("scaleBySsuFactor turns per-SSU price into per-unit price", () => {
    const perTablet = Money.minor(1250, "YER_NEW"); // 12.50 per tablet
    expect(scaleBySsuFactor(perTablet, LADDER[2] as ItemUnit).amountMinor).toBe(12500n); // strip of 10 = 125.00
  });
});
