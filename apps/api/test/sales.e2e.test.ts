import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connect } from "@pharmacore/db";
import { bootTestApp, DATABASE_URL, panadol, type TestCtx } from "./helpers.js";

let c: TestCtx;
let itemId = ""; let boxUnit = ""; let stripUnit = ""; let main = ""; let reg1 = ""; let retail = "";
let shiftId = ""; let invoiceId = "";
const TODAY = "2026-03-01";

beforeAll(async () => {
  c = await bootTestApp();
  const r = await c.call("POST", "/items", panadol());
  itemId = r.body.id;
  const g = await c.call("GET", `/items/${itemId}`);
  boxUnit = g.body.units.find((u: any) => u.name_en === "Box").id;
  stripUnit = g.body.units.find((u: any) => u.name_en === "Strip").id;
  main = (await c.call("GET", "/inventory/locations")).body.find((l: any) => l.code === "MAIN").id;
  reg1 = (await c.call("GET", "/cash/balances")).body.find((b: any) => b.code === "REG1").id;
  retail = (await c.call("GET", "/price-lists")).body.find((p: any) => p.code === "RETAIL").id;
  // prices: box 1500.00 (min 1400.00), strip 750.00; official box 1600.00
  await c.call("POST", "/prices", { priceListId: retail, itemId, unitId: boxUnit, unitPriceMinor: "150000", minPriceMinor: "140000" });
  await c.call("POST", "/prices", { priceListId: retail, itemId, unitId: stripUnit, unitPriceMinor: "75000" });
  await c.call("POST", "/official-prices", { itemId, unitId: boxUnit, currency: "YER_NEW", publicPriceMinor: "160000", effectiveFrom: "2026-01-01" });
  await c.call("POST", "/exchange-rates", { from: "SAR", to: "YER_NEW", buyRateScaled: "140000000", sellRateScaled: "142000000", effectiveFrom: "2026-01-01T00:00:00Z" });
  // stock: lot A (expires 2026-04-01) 2 boxes @1200.00, lot B (2027) 10 boxes @1200.00
  await c.call("POST", "/inventory/receipts", { itemId, locationId: main, unitId: boxUnit, qtyInUnit: 2, lotNumber: "A-APR", expiryDate: "2026-04-01", unitCostMinor: "120000", costCurrency: "YER_NEW", businessDate: TODAY });
  await c.call("POST", "/inventory/receipts", { itemId, locationId: main, unitId: boxUnit, qtyInUnit: 10, lotNumber: "B-2027", expiryDate: "2027-01-01", unitCostMinor: "120000", costCurrency: "YER_NEW", businessDate: TODAY });
});
afterAll(async () => { await c.app.close(); });

describe("shifts", () => {
  it("selling without an open shift is refused", async () => {
    const r = await c.call("POST", "/sales", { lines: [{ itemId, unitId: boxUnit, qtyInUnit: 1 }], tenders: [{ method: "CASH", currency: "YER_NEW", amountMinor: "150000" }] });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("shifts.none_open");
  });
  it("opens a shift with opening float; second open for same cashier is rejected", async () => {
    const r = await c.call("POST", "/shifts/open", { cashboxId: reg1, openingFloat: [{ currency: "YER_NEW", amountMinor: "500000" }] });
    expect(r.status).toBe(201);
    shiftId = r.body.id;
    const cur = await c.call("GET", "/shifts/current");
    expect(cur.body.id).toBe(shiftId);
    expect(cur.body.expectedCash).toEqual([{ currency: "YER_NEW", amountMinor: "500000" }]);
    expect((await c.call("POST", "/shifts/open", { cashboxId: reg1, openingFloat: [] })).status).toBe(422);
  });
});

describe("POS sale", () => {
  it("quote resolves price/min/official and FEFO lots without side effects", async () => {
    const q = await c.call("POST", "/sales/quote", { lines: [{ itemId, unitId: boxUnit, qtyInUnit: 3 }], businessDate: TODAY });
    expect(q.status).toBe(200);
    expect(q.body.lines[0].unitPriceMinor).toBe("150000");
    expect(q.body.lines[0].officialPriceMinor).toBe("160000");
    expect(q.body.lines[0].lots.map((l: any) => [l.lotNumber, l.qtySsu])).toEqual([["A-APR", "48"], ["B-2027", "24"]]);
    expect(q.body.totals.total.amountMinor).toBe("450000");
    expect((await c.call("GET", `/inventory/items/${itemId}/balances`)).body.totalSsu).toBe("288");
  });
  it("posts a cash sale with line discount and change; stock, payments, cash and journal all move in one transaction", async () => {
    const r = await c.call("POST", "/sales", {
      businessDate: TODAY, idempotencyKey: "pos-1-0001",
      lines: [{ itemId, unitId: boxUnit, qtyInUnit: 3, lineDiscountBp: 500 }, { itemId, unitId: stripUnit, qtyInUnit: 2 }], // 4500 - 5% = 4275 ; + 1500 = 5775.00
      tenders: [{ method: "CASH", currency: "YER_NEW", amountMinor: "600000" }],
    });
    expect(r.status).toBe(201);
    invoiceId = r.body.id;
    expect(r.body.number).toMatch(/^INV-/);
    expect(r.body.totals.total.amountMinor).toBe("577500");
    expect(r.body.settlement.change.amountMinor).toBe("22500");
    // idempotent replay returns same invoice
    const again = await c.call("POST", "/sales", { businessDate: TODAY, idempotencyKey: "pos-1-0001", lines: [{ itemId, unitId: boxUnit, qtyInUnit: 1 }], tenders: [{ method: "CASH", currency: "YER_NEW", amountMinor: "150000" }] });
    expect(again.body.id).toBe(invoiceId);
    expect(again.body.idempotent).toBe(true);
    // stock: 288 - 72 - 24 = 192; lot A depleted first
    const b = await c.call("GET", `/inventory/items/${itemId}/balances?businessDate=${TODAY}`);
    expect(b.body.totalSsu).toBe("192");
    expect(b.body.lots.find((l: any) => l.lotNumber === "A-APR").qtySsu).toBe("0"); // lot A consumed first (FEFO)
    // journal balanced + ledger immutability
    const sql = connect(DATABASE_URL, 1);
    const [je] = await sql`SELECT e.id, SUM(l.debit_minor) AS d, SUM(l.credit_minor) AS c FROM journal_entries e JOIN journal_lines l ON l.entry_id = e.id WHERE e.document_id = ${invoiceId} GROUP BY e.id`;
    expect(je!["d"]).toBe(je!["c"]);
    const lines = await sql`SELECT account_code, debit_minor, credit_minor FROM journal_lines WHERE entry_id = ${je!["id"]} ORDER BY account_code`;
    const by = Object.fromEntries(lines.map((l) => [l["account_code"], [String(l["debit_minor"]), String(l["credit_minor"])]]));
    expect(by["4100"]).toEqual(["0", "577500"]); // NET posting: sales = net
    expect(by["5100"]![0]).toBe("480000"); // COGS: 96 SSU × 5000
    expect(by["1100"]).toEqual(["577500", "0"]); // cash YER_NEW
    const cash = await sql`SELECT kind, amount_minor FROM cash_movements WHERE document_id = ${invoiceId} ORDER BY amount_minor`;
    expect(cash.map((x) => String(x["amount_minor"]))).toEqual(["577500"]); // net of change (600000 − 22500)
    await sql.end();
    const g = await c.call("GET", `/sales/${invoiceId}`);
    expect(g.body.lines.length).toBe(2);
    expect(g.body.lots.length).toBe(3); // box line split across 2 lots + strip line 1 lot
    expect(g.body.payments[0].change_minor).toBe("22500");
  });
  it("blocks selling below min price without override; allows with manager override and records warning", async () => {
    const bad = await c.call("POST", "/sales", { businessDate: TODAY, lines: [{ itemId, unitId: boxUnit, qtyInUnit: 1, unitPriceMinor: "130000" }], tenders: [{ method: "CASH", currency: "YER_NEW", amountMinor: "130000" }] });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toMatch(/below_min/);
    const ok = await c.call("POST", "/sales", { businessDate: TODAY, lines: [{ itemId, unitId: boxUnit, qtyInUnit: 1, unitPriceMinor: "130000" }], tenders: [{ method: "CASH", currency: "YER_NEW", amountMinor: "130000" }], overrides: { approverUsername: "owner", approverSecret: "1234", reason: "near expiry promo", belowMin: true } });
    expect(ok.status).toBe(201);
    expect(ok.body.warnings.length).toBeGreaterThan(0);
    const wrongPin = await c.call("POST", "/sales", { businessDate: TODAY, lines: [{ itemId, unitId: boxUnit, qtyInUnit: 1, unitPriceMinor: "130000" }], tenders: [{ method: "CASH", currency: "YER_NEW", amountMinor: "130000" }], overrides: { approverUsername: "owner", approverSecret: "0000", reason: "x", belowMin: true } });
    expect(wrongPin.status).toBe(403);
  });
  it("blocks above official price (D-029, BLOCK_WITH_OVERRIDE)", async () => {
    const r = await c.call("POST", "/sales", { businessDate: TODAY, lines: [{ itemId, unitId: boxUnit, qtyInUnit: 1, unitPriceMinor: "170000" }], tenders: [{ method: "CASH", currency: "YER_NEW", amountMinor: "170000" }] });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toMatch(/official/);
  });
  it("accepts SAR tender converted at buy rate with change in YER", async () => {
    const r = await c.call("POST", "/sales", { businessDate: TODAY, lines: [{ itemId, unitId: stripUnit, qtyInUnit: 1 }], tenders: [{ method: "CASH", currency: "SAR", amountMinor: "1000" }] }); // 10 SAR × 140 = 1400 YER ≥ 750
    expect(r.status).toBe(201);
    expect(r.body.settlement.change.amountMinor).toBe("65000");
    expect(r.body.settlement.change.currency).toBe("YER_NEW");
  });
  it("walk-in customer cannot buy on credit; insufficient tender rejected", async () => {
    const r = await c.call("POST", "/sales", { businessDate: TODAY, lines: [{ itemId, unitId: stripUnit, qtyInUnit: 1 }], tenders: [{ method: "CASH", currency: "YER_NEW", amountMinor: "1000" }] });
    expect(r.status).toBe(422);
  });
  it("refuses more than available stock (FEFO shortfall)", async () => {
    const r = await c.call("POST", "/sales", { businessDate: TODAY, lines: [{ itemId, unitId: boxUnit, qtyInUnit: 50 }], tenders: [{ method: "CASH", currency: "YER_NEW", amountMinor: "99999999" }] });
    expect(r.status).toBe(422);
  });
});

describe("X report & close", () => {
  it("X report aggregates sales by method/currency and expected cash", async () => {
    const x = await c.call("GET", `/shifts/${shiftId}/x-report`);
    expect(x.status).toBe(200);
    expect(x.body.type).toBe("X");
    expect(x.body.salesCount).toBe(3);
    const yer = x.body.expectedCash.find((m: any) => m.currency === "YER_NEW");
    // 500000 float + 577500 + 130000 - 65000 change(SAR sale) = 1142500
    expect(yer.amountMinor).toBe("1142500");
    expect(x.body.expectedCash.find((m: any) => m.currency === "SAR").amountMinor).toBe("1000");
  });
  it("closes with counted cash; variance recorded and cashbox balance equals counted; shift cannot close twice", async () => {
    const r = await c.call("POST", `/shifts/${shiftId}/close`, { counts: [{ currency: "YER_NEW", amountMinor: "1142000" }, { currency: "SAR", amountMinor: "1000" }], reasons: { YER_NEW: "5 YER short — rounding" } });
    expect(r.status).toBe(200);
    const yer = r.body.currencies.find((x: any) => x.currency === "YER_NEW");
    expect(yer.variance.amountMinor).toBe("-500");
    expect(r.body.zReport.type).toBe("Z");
    const bal = (await c.call("GET", "/cash/balances")).body.find((b: any) => b.code === "REG1" && b.currency === "YER_NEW");
    expect(bal.balance_minor).toBe("1142000");
    expect((await c.call("POST", `/shifts/${shiftId}/close`, { counts: [{ currency: "YER_NEW", amountMinor: "1" }] })).status).toBe(409);
    expect((await c.call("GET", "/shifts/current")).body).toBeNull();
  });
});
