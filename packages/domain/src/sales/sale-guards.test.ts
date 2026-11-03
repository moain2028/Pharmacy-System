import { describe, expect, it } from "vitest";
import { Money } from "../money/money.js";
import { unwrap, type Result } from "../shared/result.js";
import {
  SALES_PERMISSIONS, checkCredit, checkItemActive, checkLinePrice, checkLotsSellable, checkPrescription, evaluateGuard,
  type CustomerCreditInfo, type GuardOverride, type LinePriceCheck, type PriceGuardPolicy, type Prescription, type RxLineRef,
} from "./sale-guards.js";

const C = "YER_OLD" as const;
const m = (x: bigint): Money => Money.minor(x, C);
const code = (r: Result<unknown>): string => (r.ok ? "OK" : r.error.code);
const ov = (perm: string, approverId = "SUP", reason = "ok"): GuardOverride => ({ approverId, permissions: [perm], reason });

describe("evaluateGuard", () => {
  const spec = (policy: PriceGuardPolicy) => ({ code: "x.y", message: "m", policy, permission: "p.q" });
  it.each([
    ["WARN", undefined, "OK"],
    ["BLOCK", ov("p.q"), "x.y"],
    ["BLOCK_WITH_OVERRIDE", ov("p.q"), "OK"],
    ["BLOCK_WITH_OVERRIDE", undefined, "x.y"],
    ["BLOCK_WITH_OVERRIDE", ov("other"), "x.y"],
    ["BLOCK_WITH_OVERRIDE", ov("p.q", " "), "x.y"],
    ["BLOCK_WITH_OVERRIDE", ov("p.q", "SUP", ""), "x.y"],
  ] as const)("%s with override %# -> %s", (policy, o, expected) => {
    expect(code(evaluateGuard(spec(policy), o))).toBe(expected);
  });
  it("records approver on override and exposes required permission on block", () => {
    expect(unwrap(evaluateGuard(spec("BLOCK_WITH_OVERRIDE"), ov("p.q"))).approvedBy).toBe("SUP");
    const r = evaluateGuard(spec("BLOCK_WITH_OVERRIDE"));
    expect(r.ok ? null : r.error.details["requiredPermission"]).toBe("p.q");
  });
});

describe("checkLinePrice", () => {
  const base: LinePriceCheck = {
    lineId: "L1", qtyInUnit: 2n, unitPrice: m(1000n), lineNet: m(2000n), minUnitPrice: null, regulatedUnitPrice: null, lineCost: null,
  };
  it.each([
    ["no limits", base, "OK"],
    ["within all", { ...base, minUnitPrice: m(900n), regulatedUnitPrice: m(1000n), lineCost: m(1500n) }, "OK"],
    ["above official", { ...base, regulatedUnitPrice: m(999n) }, "sales.above_official_price"],
    ["below min", { ...base, minUnitPrice: m(1001n) }, "sales.below_min_price"],
    ["below cost", { ...base, lineCost: m(2001n) }, "sales.below_cost"],
  ])("%s", (_n, c, expected) => expect(code(checkLinePrice(c))).toBe(expected));

  it("WARN policy and overrides produce warnings", () => {
    const c = { ...base, lineCost: m(2001n), minUnitPrice: m(1001n) };
    const w = unwrap(checkLinePrice(c, { belowMin: "WARN", belowCost: "BLOCK_WITH_OVERRIDE", aboveOfficial: "BLOCK" },
      { belowCost: ov(SALES_PERMISSIONS.sellBelowCost) }));
    expect(w.map((x) => x.code)).toEqual(["sales.below_min_price", "sales.below_cost"]);
  });
});

describe("checkLotsSellable / checkItemActive", () => {
  it.each([
    ["2026-01-16", "AVAILABLE", "OK"],
    ["2026-01-15", "AVAILABLE", "sales.lot_expired"],
    ["2025-12-01", "NEAR_EXPIRY", "sales.lot_expired"],
    ["2027-01-01", "QUARANTINED", "sales.lot_not_sellable"],
  ] as const)("expiry %s status %s -> %s", (expiryDate, status, expected) => {
    expect(code(checkLotsSellable([{ lotId: "A", expiryDate, status }], "2026-01-15"))).toBe(expected);
  });
  it("inactive item is rejected", () => {
    expect(code(checkItemActive("I1", true))).toBe("OK");
    expect(code(checkItemActive("I1", false))).toBe("sales.item_inactive");
  });
});

describe("checkPrescription", () => {
  const rx: Prescription = { patientName: "P", doctorName: "D", rxNumber: "R1", rxDate: "2026-01-15" };
  const ln = (rxRequired: RxLineRef["rx"]["rxRequired"], controlledClass: RxLineRef["rx"]["controlledClass"], ssuQty = 10n, max?: bigint): RxLineRef =>
    ({ lineId: "L1", ssuQty, rx: max === undefined ? { rxRequired, controlledClass } : { rxRequired, controlledClass, maxQtyPerRxSsu: max } });
  it.each([
    ["none", ln("NONE", "NONE"), null, "OK", 0],
    ["rx advisory", ln("RX", "NONE"), null, "OK", 1],
    ["rx with prescription", ln("RX", "NONE"), rx, "OK", 0],
    ["controlled missing", ln("NONE", "NARCOTIC"), null, "sales.prescription_required", 0],
    ["controlled incomplete", ln("NONE", "NARCOTIC"), { ...rx, doctorName: " " }, "sales.prescription_required", 0],
    ["retain missing", ln("RX_RETAIN", "NONE"), null, "sales.prescription_required", 0],
    ["controlled ok", ln("RX", "PSYCHOTROPIC", 20n, 20n), rx, "OK", 0],
    ["FR-SAL-130 qty exceeded", ln("RX", "PSYCHOTROPIC", 30n, 20n), rx, "sales.rx_qty_exceeded", 0],
  ] as const)("%s", (_n, l, p, expected, warnings) => {
    const r = checkPrescription([l], p);
    expect(code(r)).toBe(expected);
    if (r.ok) expect(r.value.length).toBe(warnings);
  });
});

describe("checkCredit (FR-SAL-127/128)", () => {
  const cust: CustomerCreditInfo = {
    customerId: "CUS1", isWalkIn: false, creditBlocked: false, creditLimit: m(5_000_000n), outstanding: m(4_500_000n),
    oldestOverdueDays: 0, maxOverdueDays: 30,
  };
  const perm = ov(SALES_PERMISSIONS.creditOverride);
  it.each([
    ["zero credit", cust, 0n, undefined, "OK"],
    ["negative", cust, -1n, undefined, "sales.negative_credit"],
    ["walk-in", { ...cust, isWalkIn: true }, 100n, perm, "sales.credit_walk_in"],
    ["blocked", { ...cust, creditBlocked: true }, 100n, perm, "sales.credit_blocked"],
    ["limit 50,000 balance 45,000 buy 6,000", cust, 600_000n, undefined, "sales.credit_limit_exceeded"],
    ["within limit", cust, 500_000n, undefined, "OK"],
    ["overridden", cust, 600_000n, perm, "OK"],
    ["overdue", { ...cust, oldestOverdueDays: 31 }, 100n, undefined, "sales.credit_overdue"],
    ["no overdue limit", { ...cust, oldestOverdueDays: 400, maxOverdueDays: null }, 100n, undefined, "OK"],
  ] as const)("%s", (_n, c, amount, o, expected) => {
    expect(code(checkCredit(c, m(amount), o))).toBe(expected);
  });
});
