import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootTestApp, panadol, type TestCtx } from "./helpers.js";

let c: TestCtx;
let itemId = "";
let units: Array<{ id: string; level: number; name_en: string }> = [];
let retailListId = "";

beforeAll(async () => { c = await bootTestApp(); });
afterAll(async () => { await c.app.close(); });

describe("items & flexible units (D-026)", () => {
  it("creates an item with a 4-level unit ladder and auto item code", async () => {
    const r = await c.call("POST", "/items", panadol());
    expect(r.status).toBe(201);
    itemId = r.body.id;
    expect(r.body.itemCode).toMatch(/^IT-\d{6}$/);
    const g = await c.call("GET", `/items/${itemId}`);
    expect(g.status).toBe(200);
    units = g.body.units;
    expect(units.map((u) => u.name_en)).toEqual(["Carton", "Box", "Strip", "Tablet"]);
  });
  it("rejects invalid ladders: no SSU, non-multiple factors, duplicate levels", async () => {
    const noSsu = await c.call("POST", "/items", panadol({ tradeNameEn: "X1", units: [{ nameAr: "ع", nameEn: "Box", factorToSsu: 10, level: 1 }] }));
    expect(noSsu.status).toBe(422);
    expect(noSsu.body.error.code).toMatch(/^uom\./);
    const notMultiple = await c.call("POST", "/items", panadol({ tradeNameEn: "X2", units: [{ nameAr: "ع", nameEn: "Box", factorToSsu: 10, level: 1 }, { nameAr: "ش", nameEn: "Strip", factorToSsu: 3, level: 2 }, { nameAr: "ح", nameEn: "Tab", factorToSsu: 1, level: 3, isSsu: true }] }));
    expect(notMultiple.status).toBe(422);
    const dupLevel = await c.call("POST", "/items", panadol({ tradeNameEn: "X3", units: [{ nameAr: "ع", nameEn: "Box", factorToSsu: 10, level: 1 }, { nameAr: "ح", nameEn: "Tab", factorToSsu: 1, level: 1, isSsu: true }] }));
    expect(dupLevel.status).toBe(422);
  });
  it("updates with optimistic concurrency; stale version → 409", async () => {
    const g = await c.call("GET", `/items/${itemId}`);
    const body = { ...panadol({ tradeNameEn: "Panadol Extra 500" }), version: g.body.item.version, units: g.body.units.map((u: any) => ({ id: u.id, nameAr: u.name_ar, nameEn: u.name_en, factorToSsu: Number(u.factor_to_ssu), level: u.level, isSsu: u.is_ssu, canSell: u.can_sell, canPurchase: u.can_purchase, isDefaultSale: u.is_default_sale, isDefaultPurchase: u.is_default_purchase, isStockDisplay: u.is_stock_display })) };
    expect((await c.call("PUT", `/items/${itemId}`, body)).status).toBe(200);
    expect((await c.call("PUT", `/items/${itemId}`, body)).status).toBe(409); // version bumped by trigger
  });
  it("searches by code/name (Arabic & English) and lists categories", async () => {
    expect((await c.call("GET", "/items?q=بنادول")).body.items.length).toBe(1);
    expect((await c.call("GET", "/items?q=panadol")).body.items.length).toBe(1);
    expect((await c.call("GET", "/items?q=IT-")).body.items.length).toBe(1);
    expect((await c.call("GET", "/items?q=zzz")).body.items.length).toBe(0);
    const cat = await c.call("POST", "/categories", { nameAr: "مسكنات", nameEn: "Analgesics" });
    expect(cat.status).toBe(201);
    expect((await c.call("GET", "/categories")).body.length).toBe(1);
  });
});

describe("barcodes (GS1 + internal)", () => {
  it("adds a manufacturer EAN-13 to the Box unit, scan resolves item+unit via GTIN-14", async () => {
    const box = units.find((u) => u.name_en === "Box")!;
    const r = await c.call("POST", `/items/${itemId}/barcodes`, { barcode: "6291041500213", unitId: box.id, isPrimary: true });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ type: "EAN13", normalized: "06291041500213" });
    const scan = await c.call("GET", "/items?barcode=06291041500213");
    expect(scan.body.items.length).toBe(1);
    expect(scan.body.items[0].scanned_unit_id).toBe(box.id);
    // GS1 DataMatrix with the same GTIN resolves too and carries lot/expiry
    const dm = await c.call("GET", `/items?barcode=${encodeURIComponent("(01)06291041500213(17)271200(10)LOT9")}`);
    expect(dm.body.items.length).toBe(1);
    expect(dm.body.parsedBarcode).toMatchObject({ lot: "LOT9", expiry: "2027-12-31" });
  });
  it("rejects the same barcode on another item (409) and generates internal EAN-13", async () => {
    const other = await c.call("POST", "/items", panadol({ tradeNameEn: "Other", tradeNameAr: "آخر" }));
    const otherUnits = (await c.call("GET", `/items/${other.body.id}`)).body.units;
    const dup = await c.call("POST", `/items/${other.body.id}/barcodes`, { barcode: "6291041500213", unitId: otherUnits[0].id });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("barcodes.duplicate");
    const gen = await c.call("POST", `/items/${other.body.id}/barcodes`, { unitId: otherUnits[1].id, generateInternal: true });
    expect(gen.status).toBe(201);
    expect(gen.body.type).toBe("INTERNAL");
    expect(gen.body.barcode).toMatch(/^2\d{12}$/);
    const scan = await c.call("GET", `/items?barcode=${gen.body.barcode}`);
    expect(scan.body.items[0].id).toBe(other.body.id);
  });
});

describe("prices, official prices, exchange rates", () => {
  it("sets a retail price, supersedes it, keeps history", async () => {
    retailListId = (await c.call("GET", "/price-lists")).body.find((p: any) => p.code === "RETAIL").id;
    const box = units.find((u) => u.name_en === "Box")!;
    expect((await c.call("POST", "/prices", { priceListId: retailListId, itemId, unitId: box.id, unitPriceMinor: "150000", minPriceMinor: "140000" })).status).toBe(201);
    expect((await c.call("POST", "/prices", { priceListId: retailListId, itemId, unitId: box.id, unitPriceMinor: "160000", reason: "supplier increase" })).status).toBe(201);
    const g = await c.call("GET", `/items/${itemId}`);
    const current = g.body.prices.filter((p: any) => p.unit_id === box.id);
    expect(current.length).toBe(1);
    expect(current[0].unit_price_minor).toBe("160000");
  });
  it("official price (D-029) with effective dating", async () => {
    const box = units.find((u) => u.name_en === "Box")!;
    expect((await c.call("POST", "/official-prices", { itemId, unitId: box.id, currency: "YER_NEW", publicPriceMinor: "165000", sourceListRef: "SBDMA 2026-01", effectiveFrom: "2026-01-01" })).status).toBe(201);
    expect((await c.call("POST", "/official-prices", { itemId, unitId: box.id, currency: "YER_NEW", publicPriceMinor: "170000", effectiveFrom: "2026-02-01" })).status).toBe(201);
    const g = await c.call("GET", `/items/${itemId}`);
    expect(g.body.officialPrices.length).toBe(1);
    expect(g.body.officialPrices[0].public_price_minor).toBe("170000");
  });
  it("exchange rates validate via domain (buy <= sell, from != to) and expose the latest per pair", async () => {
    expect((await c.call("POST", "/exchange-rates", { from: "SAR", to: "YER_NEW", buyRateScaled: "141000000", sellRateScaled: "140000000" })).status).toBe(422);
    expect((await c.call("POST", "/exchange-rates", { from: "SAR", to: "SAR", buyRateScaled: "1", sellRateScaled: "1" })).status).toBe(422);
    expect((await c.call("POST", "/exchange-rates", { from: "SAR", to: "YER_NEW", buyRateScaled: "139000000", sellRateScaled: "141000000", effectiveFrom: "2026-01-01T00:00:00Z" })).status).toBe(201);
    expect((await c.call("POST", "/exchange-rates", { from: "SAR", to: "YER_NEW", buyRateScaled: "140000000", sellRateScaled: "142000000", effectiveFrom: "2026-01-02T00:00:00Z" })).status).toBe(201);
    const rates = await c.call("GET", "/exchange-rates");
    expect(rates.body.length).toBe(1);
    expect(rates.body[0].buy_rate_scaled).toBe("140000000");
  });
  it("permission gate: cashier cannot set prices", async () => {
    const roles = await c.call("GET", "/roles");
    const cashier = roles.body.find((r: any) => r.code === "CASHIER").id;
    await c.call("POST", "/users", { username: "cash1", displayName: "C", password: "Password123", roleIds: [cashier] });
    const tok = (await c.call("POST", "/auth/login", { username: "cash1", password: "Password123" })).body.accessToken;
    expect((await c.call("GET", "/items?q=pan", undefined, tok)).status).toBe(200);
    expect((await c.call("POST", "/prices", { priceListId: retailListId, itemId, unitId: units[0].id, unitPriceMinor: "1" }, tok)).status).toBe(403);
  });
});
