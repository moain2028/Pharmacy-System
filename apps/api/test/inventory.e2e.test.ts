import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootTestApp, panadol, type TestCtx } from "./helpers.js";

let c: TestCtx;
let itemId = "";
let boxUnit = "";
let stripUnit = "";
let main = "";
let fridge = "";
const lots: Record<string, string> = {};
const TODAY = "2026-03-01";

beforeAll(async () => {
  c = await bootTestApp();
  const r = await c.call("POST", "/items", panadol());
  itemId = r.body.id;
  const g = await c.call("GET", `/items/${itemId}`);
  boxUnit = g.body.units.find((u: any) => u.name_en === "Box").id;
  stripUnit = g.body.units.find((u: any) => u.name_en === "Strip").id;
  const locs = (await c.call("GET", "/inventory/locations")).body;
  main = locs.find((l: any) => l.code === "MAIN").id;
  fridge = locs.find((l: any) => l.code === "FRIDGE").id;
});
afterAll(async () => { await c.app.close(); });

const receive = (lotNumber: string, expiryDate: string | null, qtyInUnit: number, over: Record<string, unknown> = {}) =>
  c.call("POST", "/inventory/receipts", { itemId, locationId: main, unitId: boxUnit, qtyInUnit, lotNumber, expiryDate, unitCostMinor: "120000", costCurrency: "YER_NEW", businessDate: TODAY, ...over });

describe("receipts & lots", () => {
  it("receives in Box (×24 SSU), converts to SSU, snapshots unit cost per SSU", async () => {
    const r = await receive("A-2027", "2027-06-30", 10);
    expect(r.status).toBe(201);
    lots["A"] = r.body.lotId;
    expect(r.body.qtySsu).toBe("240");
    expect(r.body.unitCostMinorBase).toBe("5000"); // 1200.00 / 24
  });
  it("requires expiry for tracked items; rejects already-expired receipt; accepts foreign cost with rate", async () => {
    expect((await receive("NOEXP", null, 1)).body.error.code).toBe("lot.expiry_required");
    const exp = await receive("OLD", "2026-02-01", 1);
    expect(exp.status).toBe(409);
    expect(exp.body.error.code).toBe("lot.expired_on_receipt");
    const noRate = await receive("USD1", "2028-01-01", 1, { unitCostMinor: "800", costCurrency: "USD" });
    expect(noRate.body.error.code).toBe("fx.rate_required");
    const usd = await receive("B-2026-05", "2026-05-15", 5, { unitCostMinor: "800", costCurrency: "USD", rateScaled: "530000000" }); // 8.00 USD × 530 = 4240.00 YER per box
    expect(usd.status).toBe(201);
    lots["B"] = usd.body.lotId;
    expect(usd.body.unitCostMinorBase).toBe("17667"); // 424000 / 24 = 17666.67 → Half-Up
  });
  it("balances show per-lot qty, effective status (NEAR_EXPIRY within 90d) and valuation", async () => {
    await receive("C-2026-03", "2026-03-20", 2); // expires in 19 days
    const b = await c.call("GET", `/inventory/items/${itemId}/balances?businessDate=${TODAY}`);
    expect(b.status).toBe(200);
    expect(b.body.totalSsu).toBe(String(240 + 120 + 48));
    const byLot = Object.fromEntries(b.body.lots.map((l: any) => [l.lotNumber, l]));
    expect(byLot["A-2027"].effectiveStatus).toBe("AVAILABLE");
    expect(byLot["B-2026-05"].effectiveStatus).toBe("NEAR_EXPIRY");
    expect(byLot["C-2026-03"].effectiveStatus).toBe("NEAR_EXPIRY");
    expect(byLot["A-2027"].valueMinor).toBe("1200000");
    lots["C"] = byLot["C-2026-03"].lotId;
  });
});

describe("FEFO", () => {
  it("allocates earliest expiry first across lots and reports shortfall only when allowed", async () => {
    const r = await c.call("POST", "/inventory/fefo-preview", { itemId, locationId: main, qtySsu: "60", businessDate: TODAY });
    expect(r.status).toBe(200);
    expect(r.body.allocations.map((a: any) => [a.expiryDate, a.qtySsu])).toEqual([["2026-03-20", "48"], ["2026-05-15", "12"]]);
    expect(r.body.shortfallSsu).toBe("0");
    const tooMany = await c.call("POST", "/inventory/fefo-preview", { itemId, locationId: main, qtySsu: "1000", businessDate: TODAY });
    expect(tooMany.status).toBe(422);
  });
  it("skips expired lots (from the START of expiry day) and lets an override pick a later lot with audit data", async () => {
    const onExpiry = await c.call("POST", "/inventory/fefo-preview", { itemId, locationId: main, qtySsu: "10", businessDate: "2026-03-20" });
    expect(onExpiry.body.allocations[0].expiryDate).toBe("2026-05-15");
    const ov = await c.call("POST", "/inventory/fefo-preview", { itemId, locationId: main, qtySsu: "10", businessDate: TODAY, overrideLotId: lots["A"], override: { approvedBy: "mgr", reason: "customer wants long expiry" } });
    expect(ov.status).toBe(200);
    expect(ov.body.allocations[0].lotId).toBe(lots["A"]);
    expect(ov.body.allocations[0].viaOverride).toBe(true);
    expect(ov.body.skippedLotIds.length).toBeGreaterThan(0);
  });
});

describe("lot status, adjustments, transfers", () => {
  it("manual status transitions follow the state machine; quarantined lots drop out of FEFO", async () => {
    const q = await c.call("POST", `/inventory/lots/${lots["C"]}/status`, { status: "QUARANTINED", reason: "recall notice", businessDate: TODAY });
    expect(q.status).toBe(201);
    const r = await c.call("POST", "/inventory/fefo-preview", { itemId, locationId: main, qtySsu: "10", businessDate: TODAY });
    expect(r.body.allocations[0].lotId).toBe(lots["B"]);
    const bad = await c.call("POST", `/inventory/lots/${lots["A"]}/status`, { status: "DESTROYED", reason: "not allowed directly", businessDate: TODAY }); // NONE→DESTROYED needs expiry or quarantine first
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe("inventory.lot_invalid_transition");
    expect((await c.call("POST", `/inventory/lots/${lots["C"]}/status`, { status: "DESTROYED", reason: "destroyed per recall", businessDate: TODAY })).status).toBe(201);
  });
  it("write-off adjustment with reason; cannot drive balance negative (DB P0008 → 409)", async () => {
    const ok = await c.call("POST", "/inventory/adjustments", { lotId: lots["C"], locationId: main, qtyDeltaSsu: "-48", reason: "destroyed stock write-off", businessDate: TODAY });
    expect(ok.status).toBe(201);
    expect(ok.body.number).toMatch(/^ADJ-/);
    const neg = await c.call("POST", "/inventory/adjustments", { lotId: lots["C"], locationId: main, qtyDeltaSsu: "-1", reason: "oops", businessDate: TODAY });
    expect(neg.status).toBe(409);
    expect(neg.body.error.code).toBe("stock.insufficient");
  });
  it("transfer moves stock between locations in one document; kardex shows running balance", async () => {
    const t = await c.call("POST", "/inventory/transfers", { lotId: lots["A"], fromLocationId: main, toLocationId: fridge, qtySsu: "24", businessDate: TODAY });
    expect(t.status).toBe(201);
    const b = await c.call("GET", `/inventory/items/${itemId}/balances?businessDate=${TODAY}`);
    const a = b.body.lots.filter((l: any) => l.lotId === lots["A"]);
    expect(a.find((x: any) => x.locationId === main).qtySsu).toBe("216");
    expect(a.find((x: any) => x.locationId === fridge).qtySsu).toBe("24");
    const k = await c.call("GET", `/inventory/items/${itemId}/kardex?lotId=${lots["A"]}`);
    expect(k.body.length).toBe(3);
    expect(k.body.map((m: any) => m.movement_type).sort()).toEqual(["RECEIPT", "TRANSFER_IN", "TRANSFER_OUT"]);
  });
  it("UOM factor is now locked for the Box unit (D-026) — API surfaces 409 uom.factor_locked", async () => {
    const g = await c.call("GET", `/items/${itemId}`);
    const units = g.body.units.map((u: any) => ({ id: u.id, nameAr: u.name_ar, nameEn: u.name_en, factorToSsu: u.name_en === "Box" ? 48 : Number(u.factor_to_ssu), level: u.level, isSsu: u.is_ssu, canSell: u.can_sell, canPurchase: u.can_purchase, isDefaultSale: u.is_default_sale, isDefaultPurchase: u.is_default_purchase, isStockDisplay: u.is_stock_display }));
    const r = await c.call("PUT", `/items/${itemId}`, { ...panadol(), version: g.body.item.version, units });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("uom.factor_locked");
  });
});

describe("expiry worklist", () => {
  it("groups lots into EXPIRED/30/90/180 tiers with value at risk; destroyed lots excluded", async () => {
    await receive("D-2026-04", "2026-04-10", 1, { unitId: stripUnit, unitCostMinor: "6000" }); // strip ×12, 40 days
    const w = await c.call("GET", `/inventory/expiry?businessDate=${TODAY}`);
    expect(w.status).toBe(200);
    expect(w.body.currency).toBe("YER_NEW");
    const tiers = Object.fromEntries(w.body.groups.map((g: any) => [g.tier, g]));
    expect(tiers["WITHIN_90D"].lots.map((l: any) => l.lotNumber).sort()).toEqual(["B-2026-05", "D-2026-04"]);
    expect(tiers["WITHIN_90D"].lots.find((l: any) => l.lotNumber === "D-2026-04").valueAtRiskMinor).toBe("6000");
    expect(w.body.groups.flatMap((g: any) => g.lots).some((l: any) => l.lotNumber === "C-2026-03")).toBe(false);
    expect(w.body.groups.flatMap((g: any) => g.lots).some((l: any) => l.lotNumber === "A-2027")).toBe(false); // 486 days
  });
});
