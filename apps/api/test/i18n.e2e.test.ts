import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootTestApp, type TestCtx } from "./helpers.js";

let c: TestCtx;
beforeAll(async () => { c = await bootTestApp(); });
afterAll(async () => { await c.app.close(); });

describe("error envelope localisation", () => {
  it("owner (locale ar) gets Arabic message + English original", async () => {
    const r = await c.call("GET", "/sales/00000000-0000-0000-0000-000000000000");
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe("sales.not_found");
    expect(r.body.error.message).toBe("الفاتورة غير موجودة");
    expect(r.body.error.messageEn).toBe("Invoice not found");
    expect(typeof r.body.requestId).toBe("string");
  });
  it("anonymous request honours Accept-Language: en", async () => {
    const res = await c.app.inject({ method: "GET", url: "/api/v1/sales", headers: { "accept-language": "en-US,en;q=0.9" } });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.message).toBe("Authentication required");
  });
  it("anonymous request defaults to Arabic", async () => {
    const res = await c.app.inject({ method: "GET", url: "/api/v1/sales" });
    expect(res.json().error.message).toBe("يلزم تسجيل الدخول");
  });
  it("unknown code falls back to family message in Arabic", async () => {
    const r = await c.call("POST", "/sales/quote", { lines: [] });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("validation.failed");
    expect(r.body.error.message).toBe("البيانات المدخلة غير صالحة");
  });
});

describe("openapi", () => {
  it("serves the OpenAPI document with all controllers", async () => {
    const res = await c.app.inject({ method: "GET", url: "/api/docs.json" });
    expect(res.statusCode).toBe(200);
    const doc = res.json() as { openapi: string; paths: Record<string, unknown> };
    expect(doc.openapi).toMatch(/^3\./);
    const paths = Object.keys(doc.paths);
    expect(paths.length).toBeGreaterThan(80);
    for (const p of ["/api/v1/sales", "/api/v1/shifts/open", "/api/v1/returns", "/api/v1/purchase-orders", "/api/v1/supplier-invoices", "/api/v1/reports/trial-balance", "/api/v1/backup"]) expect(paths).toContain(p);
  });
});
