import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { connect, resetDatabase } from "@pharmacore/db";
import { createApp } from "../src/bootstrap.js";
import { loadConfig } from "../src/infra/config.js";

export const DATABASE_URL = process.env["DATABASE_URL"] ?? "postgres://pharmacore:pharmacore@localhost:5432/pharmacore_test";

export interface TestCtx {
  app: NestFastifyApplication;
  access: string;
  tenantId: string;
  call: (method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", url: string, body?: unknown, token?: string) => Promise<{ status: number; body: any }>;
}

/** Fresh DB + initialized pharmacy + logged-in owner. */
export async function bootTestApp(opts: { baseCurrency?: string } = {}): Promise<TestCtx> {
  const sql = connect(DATABASE_URL, 1);
  await resetDatabase(sql, { allowDestructive: true });
  await sql.end();
  const cfg = loadConfig({ ...process.env, NODE_ENV: "test", DATABASE_URL, JWT_SECRET: "test-secret-test-secret-test-secret-1234" });
  const app = await createApp(cfg);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  const ctx: TestCtx = {
    app,
    access: "",
    tenantId: "",
    async call(method, url, body, token) {
      const t = token ?? ctx.access;
      const res = await app.inject({ method, url: `/api/v1${url}`, payload: body as Record<string, unknown> | undefined, headers: t ? { authorization: `Bearer ${t}` } : {} });
      let json: unknown = null;
      try { json = res.json(); } catch { /* empty */ }
      return { status: res.statusCode, body: json };
    },
  };
  const init = await ctx.call("POST", "/setup/initialize", {
    pharmacy: { nameAr: "صيدلية الاختبار", nameEn: "Test Pharmacy", baseCurrency: opts.baseCurrency ?? "YER_NEW" },
    owner: { username: "owner", displayName: "Owner", password: "Str0ngPass!", pin: "1234" },
  });
  if (init.status !== 201) throw new Error(`setup failed: ${JSON.stringify(init.body)}`);
  ctx.tenantId = init.body.tenantId;
  const login = await ctx.call("POST", "/auth/login", { username: "owner", password: "Str0ngPass!" });
  ctx.access = login.body.accessToken;
  return ctx;
}

export const panadol = (over: Record<string, unknown> = {}) => ({
  tradeNameAr: "بنادول اكسترا", tradeNameEn: "Panadol Extra", genericName: "Paracetamol + Caffeine", strength: "500mg", dosageForm: "Tablet",
  manufacturer: "GSK", countryOfOrigin: "UK", taxBp: 0,
  units: [
    { nameAr: "كرتون", nameEn: "Carton", factorToSsu: 240, level: 1, canSell: false, isDefaultPurchase: true },
    { nameAr: "علبة", nameEn: "Box", factorToSsu: 24, level: 2, isDefaultSale: true, isStockDisplay: true },
    { nameAr: "شريط", nameEn: "Strip", factorToSsu: 12, level: 3 },
    { nameAr: "حبة", nameEn: "Tablet", factorToSsu: 1, level: 4, isSsu: true },
  ],
  ...over,
});
