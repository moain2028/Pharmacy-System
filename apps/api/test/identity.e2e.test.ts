import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { connect, resetDatabase } from "@pharmacore/db";
import { createApp } from "../src/bootstrap.js";
import { loadConfig } from "../src/infra/config.js";

const DATABASE_URL = process.env["DATABASE_URL"] ?? "postgres://pharmacore:pharmacore@localhost:5432/pharmacore_test";
let app: NestFastifyApplication;
let access = "";
let refresh = "";
let tenantId = "";
let cashierRoleId = "";

async function call(method: "GET" | "POST" | "PATCH" | "PUT", url: string, body?: unknown, token = access) {
  const res = await app.inject({ method, url: `/api/v1${url}`, payload: body as Record<string, unknown> | undefined, headers: token ? { authorization: `Bearer ${token}` } : {} });
  let json: unknown = null;
  try { json = res.json(); } catch { /* no body */ }
  return { status: res.statusCode, body: json as Record<string, unknown> & { error?: { code: string } } };
}

beforeAll(async () => {
  const sql = connect(DATABASE_URL, 1);
  await resetDatabase(sql, { allowDestructive: true });
  await sql.end();
  const cfg = loadConfig({ ...process.env, NODE_ENV: "test", DATABASE_URL, JWT_SECRET: "test-secret-test-secret-test-secret-1234", ACCESS_TOKEN_TTL_SEC: "900" });
  app = await createApp(cfg);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});
afterAll(async () => { await app.close(); });

describe("setup wizard", () => {
  it("reports uninitialized, then initializes a brand-new pharmacy", async () => {
    const s0 = await call("GET", "/setup/status");
    expect(s0.status).toBe(200);
    expect(s0.body["initialized"]).toBe(false);
    const r = await call("POST", "/setup/initialize", {
      pharmacy: { nameAr: "صيدلية الشفاء", nameEn: "Al-Shifa Pharmacy", baseCurrency: "YER_NEW" },
      owner: { username: "moain", displayName: "معين", password: "Str0ngPass!", pin: "1234" },
    });
    expect(r.status).toBe(201);
    tenantId = r.body["tenantId"] as string;
    expect(tenantId).toMatch(/[0-9a-f-]{36}/);
    const again = await call("POST", "/setup/initialize", { pharmacy: { nameAr: "x", nameEn: "x", baseCurrency: "SAR" }, owner: { username: "abc", displayName: "x", password: "12345678" } });
    expect(again.status).toBe(409);
    expect(again.body.error?.code).toBe("setup.already_initialized");
  });
  it("validates input (400 with issues)", async () => {
    const r = await call("POST", "/setup/initialize", { pharmacy: { nameAr: "x" }, owner: {} });
    expect(r.status).toBe(400);
    expect(r.body.error?.code).toBe("validation.failed");
  });
});

describe("auth", () => {
  it("rejects wrong password, accepts right one, returns owner permissions", async () => {
    const bad = await call("POST", "/auth/login", { username: "moain", password: "wrong" });
    expect(bad.status).toBe(401);
    const ok = await call("POST", "/auth/login", { username: "MOAIN", password: "Str0ngPass!", deviceId: "pos-1" });
    expect(ok.status).toBe(200);
    access = ok.body["accessToken"] as string;
    refresh = ok.body["refreshToken"] as string;
    const user = ok.body["user"] as { permissions: string[] };
    expect(user.permissions).toContain("sales.post");
    expect(user.permissions).toContain("settings.currency");
    expect((ok.body["tenant"] as { baseCurrency: string }).baseCurrency).toBe("YER_NEW");
  });
  it("protects routes: no token → 401, token → 200", async () => {
    expect((await call("GET", "/auth/me", undefined, "")).status).toBe(401);
    const me = await call("GET", "/auth/me");
    expect(me.status).toBe(200);
    expect(me.body["username"]).toBe("moain");
  });
  it("rotates refresh tokens and detects reuse", async () => {
    const r1 = await call("POST", "/auth/refresh", { refreshToken: refresh });
    expect(r1.status).toBe(200);
    const newRefresh = r1.body["refreshToken"] as string;
    expect(newRefresh).not.toBe(refresh);
    const reuse = await call("POST", "/auth/refresh", { refreshToken: refresh });
    expect(reuse.status).toBe(401);
    expect(reuse.body.error?.code).toBe("auth.refresh_reused");
    // family revoked → the new one is dead too
    const dead = await call("POST", "/auth/refresh", { refreshToken: newRefresh });
    expect(dead.status).toBe(401);
    // login again for the rest of the suite
    const ok = await call("POST", "/auth/login", { username: "moain", password: "Str0ngPass!" });
    access = ok.body["accessToken"] as string;
    refresh = ok.body["refreshToken"] as string;
  });
  it("locks the account after 5 failed attempts", async () => {
    const r = await call("POST", "/users", { username: "locky", displayName: "L", password: "Password123", roleIds: [] });
    expect(r.status).toBe(400); // roleIds min 1
    const roles = await call("GET", "/roles");
    cashierRoleId = (roles.body as unknown as Array<{ id: string; code: string }>).find((x) => x.code === "CASHIER")!.id;
    const created = await call("POST", "/users", { username: "locky", displayName: "L", password: "Password123", roleIds: [cashierRoleId] });
    expect(created.status).toBe(201);
    for (let i = 0; i < 5; i++) expect((await call("POST", "/auth/login", { username: "locky", password: "nope" })).status).toBe(401);
    const locked = await call("POST", "/auth/login", { username: "locky", password: "Password123" });
    expect(locked.status).toBe(403);
    expect(locked.body.error?.code).toBe("auth.locked");
  });
});

describe("permissions (D-030)", () => {
  let cashierAccess = "";
  it("cashier gets role permissions only; DENY override removes one; ALLOW adds one", async () => {
    const created = await call("POST", "/users", { username: "sara", displayName: "سارة", password: "Password123", roleIds: [cashierRoleId], locale: "ar" });
    expect(created.status).toBe(201);
    const uid = created.body["id"] as string;
    const login = await call("POST", "/auth/login", { username: "sara", password: "Password123" });
    expect(login.status).toBe(200);
    let perms = (login.body["user"] as { permissions: string[] }).permissions;
    expect(perms).toContain("sales.post");
    expect(perms).not.toContain("users.read");
    cashierAccess = login.body["accessToken"] as string;
    expect((await call("GET", "/users", undefined, cashierAccess)).status).toBe(403);
    const forbidden = await call("GET", "/users", undefined, cashierAccess);
    expect(forbidden.body.error?.code).toBe("auth.permission_denied");

    const ov = await call("PUT", `/users/${uid}/overrides`, { overrides: [{ permission: "sales.post", effect: "DENY" }, { permission: "users.read", effect: "ALLOW" }, { permission: "sales.discount_line", effect: "ALLOW", limitValue: 1500 }] });
    expect(ov.status).toBe(200);
    const login2 = await call("POST", "/auth/login", { username: "sara", password: "Password123" });
    perms = (login2.body["user"] as { permissions: string[] }).permissions;
    expect(perms).not.toContain("sales.post");
    expect(perms).toContain("users.read");
    expect((login2.body["user"] as { limits: Record<string, number> }).limits["sales.discount_line"]).toBe(1500);
    expect((await call("GET", "/users", undefined, login2.body["accessToken"] as string)).status).toBe(200);
  });
  it("rejects unknown permission names and protects OWNER role", async () => {
    const bad = await call("POST", "/roles", { code: "X_ROLE", nameAr: "x", nameEn: "x", permissions: ["sales.fly"] });
    expect(bad.status).toBe(400);
    const roles = await call("GET", "/roles");
    const owner = (roles.body as unknown as Array<{ id: string; code: string }>).find((x) => x.code === "OWNER")!;
    const r = await call("POST", "/roles", { id: owner.id, code: "OWNER", nameAr: "x", nameEn: "x", permissions: ["items.read"] });
    expect(r.status).toBe(409);
  });
  it("deactivating a user revokes sessions; cannot deactivate self", async () => {
    const users = await call("GET", "/users");
    const sara = (users.body as unknown as Array<{ id: string; username: string }>).find((u) => u.username === "sara")!;
    const me = (users.body as unknown as Array<{ id: string; username: string }>).find((u) => u.username === "moain")!;
    expect((await call("PATCH", `/users/${me.id}`, { isActive: false })).status).toBe(409);
    expect((await call("PATCH", `/users/${sara.id}`, { isActive: false })).status).toBe(200);
    const login = await call("POST", "/auth/login", { username: "sara", password: "Password123" });
    expect(login.status).toBe(403);
    expect(login.body.error?.code).toBe("auth.user_inactive");
  });
});

describe("health & headers", () => {
  it("health is public and security headers are set", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/health" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["cache-control"]).toBe("no-store");
  });
});
