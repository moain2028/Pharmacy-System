import { describe, expect, it } from "vitest";
import { Money } from "../money/money.js";
import { DomainError, unwrap, type Result } from "../shared/result.js";
import {
  DEFAULT_EXPIRY_TIERS,
  NO_EXPIRY_DATE,
  classifyExpiry,
  expiryWorklist,
  tierLabel,
  validateExpiryTiers,
  type LotStock,
} from "./expiry-alerts.js";
import { Lot, type LotManualStatus } from "./lot.js";

function errCode<T>(r: Result<T>): string {
  if (r.ok) throw new Error("expected Err");
  return r.error.code;
}
function stock(
  lotId: string,
  expiry: string,
  onHand: bigint,
  opts: { itemId?: string; total?: string; currency?: "YER_NEW" | "USD"; manualStatus?: LotManualStatus; received?: bigint } = {},
): LotStock {
  const lot = unwrap(
    Lot.create({
      lotId,
      itemId: opts.itemId ?? "I1",
      lotNumber: lotId,
      expiryDate: expiry,
      qtyReceivedSsu: opts.received ?? 10n,
      totalCostMinor: unwrap(Money.parse(opts.total ?? "100.00", opts.currency ?? "YER_NEW")),
      sourceType: "OFFICIAL",
      manualStatus: opts.manualStatus,
    }),
  );
  return { lot, onHandSsu: onHand };
}
const TODAY = "2026-01-01";

describe("validateExpiryTiers", () => {
  it("sorts descending and freezes", () => {
    const t = unwrap(validateExpiryTiers([30, 180, 90]));
    expect(t).toEqual([180, 90, 30]);
    expect(Object.isFrozen(t)).toBe(true);
    expect(DEFAULT_EXPIRY_TIERS).toEqual([180, 90, 30]);
  });
  it.each<[string, number[]]>([
    ["inventory.expiry_tiers_empty", []],
    ["inventory.expiry_tier_invalid", [30, 0]],
    ["inventory.expiry_tier_invalid", [-7]],
    ["inventory.expiry_tier_invalid", [7.5]],
    ["inventory.expiry_tier_invalid", [Number.NaN]],
    ["inventory.expiry_tiers_duplicate", [30, 30]],
  ])("rejects with %s", (code, tiers) => {
    expect(errCode(validateExpiryTiers(tiers))).toBe(code);
  });
});

describe("classifyExpiry", () => {
  it("labels by the smallest matching tier, EXPIRED from the expiry day", () => {
    expect(classifyExpiry("2025-12-31", TODAY)).toBe("EXPIRED");
    expect(classifyExpiry("2026-01-01", TODAY)).toBe("EXPIRED");
    expect(classifyExpiry("2026-01-02", TODAY)).toBe("WITHIN_30D");
    expect(classifyExpiry("2026-01-31", TODAY)).toBe("WITHIN_30D");
    expect(classifyExpiry("2026-02-01", TODAY)).toBe("WITHIN_90D");
    expect(classifyExpiry("2026-04-01", TODAY)).toBe("WITHIN_90D");
    expect(classifyExpiry("2026-04-02", TODAY)).toBe("WITHIN_180D");
    expect(classifyExpiry("2026-06-30", TODAY)).toBe("WITHIN_180D"); // day 180 inclusive
    expect(classifyExpiry("2026-07-01", TODAY)).toBe("OK");
    expect(classifyExpiry(NO_EXPIRY_DATE, TODAY)).toBe("OK");
  });
  it("accepts unsorted custom tiers", () => {
    expect(classifyExpiry("2026-01-05", TODAY, [30, 7, 180])).toBe("WITHIN_7D");
    expect(classifyExpiry("2026-01-20", TODAY, [7])).toBe("OK");
    expect(tierLabel(7)).toBe("WITHIN_7D");
  });
  it("throws on invalid tiers or dates (programmer error)", () => {
    expect(() => classifyExpiry("2026-01-05", TODAY, [])).toThrow(DomainError);
    expect(() => classifyExpiry("bad", TODAY)).toThrow(DomainError);
    expect(() => classifyExpiry("2026-01-05", "2026-02-30")).toThrow(DomainError);
  });
});

describe("expiryWorklist", () => {
  it("groups lots by tier with value at risk, most urgent first", () => {
    const entries: LotStock[] = [
      stock("E1", "2025-12-31", 10n), // expired, 100.00
      stock("E2", TODAY, 2n), // expired today, 20.00
      stock("L30", "2026-01-31", 10n), // 100.00
      stock("L20a", "2026-01-20", 5n, { itemId: "I2" }), // 50.00
      stock("L20b", "2026-01-20", 10n, { itemId: "I2", total: "200.00" }), // 200.00
      stock("L90", "2026-04-01", 10n),
      stock("L180", "2026-06-29", 1n), // 10.00
      stock("OK", "2026-07-01", 10n),
      stock("ZERO", "2026-01-10", 0n),
      stock("NEG", "2026-01-10", -1n),
      stock("NOEXP", NO_EXPIRY_DATE, 10n),
      stock("GONE1", "2026-01-10", 10n, { manualStatus: "DESTROYED" }),
      stock("GONE2", "2026-01-10", 10n, { manualStatus: "RETURNED_TO_SUPPLIER" }),
      stock("BLOCKED", "2026-01-10", 10n, { manualStatus: "BLOCKED" }), // still owned stock → listed
    ];
    const wl = unwrap(expiryWorklist(entries, TODAY, "YER_NEW"));
    expect(wl.businessDate).toBe(TODAY);
    expect(wl.currency).toBe("YER_NEW");
    expect(wl.groups.map((g) => [g.tier, g.daysBefore])).toEqual([
      ["EXPIRED", null],
      ["WITHIN_30D", 30],
      ["WITHIN_90D", 90],
      ["WITHIN_180D", 180],
    ]);
    const [expired, t30, t90, t180] = wl.groups;
    expect(expired?.lots.map((l) => [l.lotId, l.daysToExpiry])).toEqual([
      ["E1", -1],
      ["E2", 0],
    ]);
    expect(expired?.valueAtRiskMinor.toDecimalString()).toBe("120.00");
    expect(t30?.lots.map((l) => l.lotId)).toEqual(["BLOCKED", "L20b", "L20a", "L30"]);
    expect(t30?.lotCount).toBe(4);
    expect(t30?.itemCount).toBe(2);
    expect(t30?.qtySsu).toBe(35n);
    expect(t30?.valueAtRiskMinor.toDecimalString()).toBe("450.00");
    expect(t90?.lots.map((l) => l.lotNumber)).toEqual(["L90"]);
    expect(t180?.lots.map((l) => l.valueAtRiskMinor.toDecimalString())).toEqual(["10.00"]);
    expect(Object.isFrozen(wl)).toBe(true);
    expect(Object.isFrozen(wl.groups)).toBe(true);
    expect(Object.isFrozen(t30?.lots)).toBe(true);
  });
  it("orders equal expiry/value by lotId and keeps duplicate lot rows", () => {
    const q = stock("Q", "2026-01-20", 5n);
    const p = stock("P", "2026-01-20", 5n);
    const wl = unwrap(expiryWorklist([q, p, q], TODAY, "YER_NEW", [30]));
    expect(wl.groups.map((g) => g.tier)).toEqual(["EXPIRED", "WITHIN_30D"]);
    expect(wl.groups[1]?.lots.map((l) => l.lotId)).toEqual(["P", "Q", "Q"]);
    expect(wl.groups[0]?.lotCount).toBe(0);
    expect(wl.groups[0]?.valueAtRiskMinor.toDecimalString()).toBe("0.00");
  });
  it("returns empty groups for no stock", () => {
    const wl = unwrap(expiryWorklist([], TODAY, "USD"));
    expect(wl.groups.map((g) => g.lotCount)).toEqual([0, 0, 0, 0]);
  });
  it("fails on invalid tiers, dates, foreign currency or inconsistent stock", () => {
    expect(errCode(expiryWorklist([], TODAY, "YER_NEW", [0]))).toBe("inventory.expiry_tier_invalid");
    expect(errCode(expiryWorklist([], "2026-13-01", "YER_NEW"))).toBe("date.invalid_calendar_day");
    expect(errCode(expiryWorklist([stock("U", "2026-01-20", 5n, { currency: "USD" })], TODAY, "YER_NEW"))).toBe(
      "inventory.currency_mismatch",
    );
    expect(errCode(expiryWorklist([stock("X", "2026-01-20", 11n, { received: 10n })], TODAY, "YER_NEW"))).toBe(
      "inventory.qty_exceeds_lot",
    );
  });
});
