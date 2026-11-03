import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootTestApp, type TestCtx } from "./helpers.js";

let c: TestCtx;
beforeAll(async () => { c = await bootTestApp(); });
afterAll(async () => { await c.app.close(); });

const GOOD = `trade_name_ar,trade_name_en,generic_name,barcode,tax_bp,units,units_ar,retail_price,price_unit
بنادول اكسترا,Panadol Extra,Paracetamol,5000347012345,0,Carton:240|Box:24|Strip:12|Tablet:1,كرتون|علبة|شريط|حبة,1500.00,Box
"أموكسيل, 500",Amoxil 500,Amoxicillin,,0,Box:21|Capsule:1,علبة|كبسولة,2400.50,Box
`;

describe("CSV import/export", () => {
  it("serves templates as CSV with BOM", async () => {
    const r = await c.app.inject({ method: "GET", url: "/api/v1/import/templates/items", headers: { authorization: `Bearer ${c.access}` } });
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toContain("text/csv");
    expect(r.body.charCodeAt(0)).toBe(0xfeff);
    expect(r.body).toContain("trade_name_ar");
  });
  it("dry-run reports row-level errors and imports nothing", async () => {
    const bad = GOOD + `,Missing Arabic,,,0,Box:10|Tablet:3,,,\n`;
    const r = await c.call("POST", "/import/items?dryRun=true", { csv: bad });
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(3); expect(r.body.valid).toBe(2); expect(r.body.imported).toBe(0);
    const codes = r.body.errors.map((e: { row: number; code: string }) => `${e.row}:${e.code}`);
    expect(codes).toContain("4:required"); expect(codes).toContain("4:ssu_factor");
    expect((await c.call("GET", "/items?q=Panadol")).body.items.length).toBe(0);
  });
  it("imports atomically: items, ladders, barcode, retail price", async () => {
    const r = await c.call("POST", "/import/items?dryRun=false", { csv: GOOD });
    expect(r.status).toBe(200); expect(r.body.imported).toBe(2); expect(r.body.errors).toEqual([]);
    const items = (await c.call("GET", "/items?q=Panadol")).body.items;
    expect(items.length).toBe(1);
    const d = (await c.call("GET", `/items/${items[0].id}`)).body;
    expect(d.units.map((u: { name_en: string; factor_to_ssu: string }) => `${u.name_en}:${u.factor_to_ssu}`)).toEqual(["Carton:240", "Box:24", "Strip:12", "Tablet:1"]);
    expect(d.barcodes[0].barcode).toBe("5000347012345");
    const box = d.units.find((u: { name_en: string }) => u.name_en === "Box");
    expect(d.prices.find((p: { unit_id: string }) => p.unit_id === box.id).unit_price_minor).toBe("150000");
  });
  it("re-importing the same barcode is rejected as a whole", async () => {
    const r = await c.call("POST", "/import/items?dryRun=false", { csv: GOOD });
    expect(r.body.imported).toBe(0);
    expect(r.body.errors.some((e: { code: string }) => e.code === "exists")).toBe(true);
  });
  it("exports items as CSV that round-trips the ladder; customers/suppliers import + export", async () => {
    const ex = await c.app.inject({ method: "GET", url: "/api/v1/export/items", headers: { authorization: `Bearer ${c.access}` } });
    expect(ex.statusCode).toBe(200); expect(ex.body).toContain("Carton:240|Box:24|Strip:12|Tablet:1"); expect(ex.body).toContain('"أموكسيل, 500"');
    const cu = await c.call("POST", "/import/customers?dryRun=false", { csv: "name,phone,credit_limit,credit_currency\nمحمد علي,777123456,1000.00,YER_NEW\nAli,,0,\n" });
    expect(cu.body.imported).toBe(2);
    expect((await c.call("GET", "/customers?q=777123")).body.rows[0].credit_limit_minor).toBe("100000");
    const su = await c.call("POST", "/import/suppliers?dryRun=false", { csv: "name,default_currency,payment_terms_days\nشركة الأدوية,SAR,30\n" });
    expect(su.body.imported).toBe(1);
    const sx = await c.app.inject({ method: "GET", url: "/api/v1/export/suppliers", headers: { authorization: `Bearer ${c.access}` } });
    expect(sx.body).toContain("شركة الأدوية,,,,SAR,30");
    const badCur = await c.call("POST", "/import/suppliers?dryRun=true", { csv: "name,default_currency\nX,EUR\n" });
    expect(badCur.body.errors[0].code).toBe("enum");
  });
});
