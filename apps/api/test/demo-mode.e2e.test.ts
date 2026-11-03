import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootTestApp, type TestCtx } from "./helpers.js";

describe("DEMO_MODE", () => {
  let c: TestCtx;
  beforeAll(async () => { c = await bootTestApp({ env: { DEMO_MODE: "true" }, skipSetup: true }); });
  afterAll(async () => { await c.app.close(); });

  it("seeds a demo pharmacy and advertises demo in /setup/status", async () => {
    const st = await c.call("GET", "/setup/status");
    expect(st.status).toBe(200);
    expect(st.body.initialized).toBe(true);
    expect(st.body.demo).toBe(true);
  });

  it("logs in 1/1 as owner (all permissions) and 2/2 as cashier (limited)", async () => {
    const owner = await c.call("POST", "/auth/login", { username: "1", password: "1" });
    expect(owner.status).toBe(200);
    const me1 = await c.call("GET", "/auth/me", undefined, owner.body.accessToken);
    expect(me1.body.permissions).toContain("users.create");
    expect(me1.body.permissions.length).toBeGreaterThan(80);

    const cashier = await c.call("POST", "/auth/login", { username: "2", password: "2" });
    expect(cashier.status).toBe(200);
    const me2 = await c.call("GET", "/auth/me", undefined, cashier.body.accessToken);
    expect(me2.body.permissions).toContain("sales.create");
    expect(me2.body.permissions).not.toContain("users.create");
    const users = await c.call("GET", "/users", undefined, cashier.body.accessToken);
    expect(users.status).toBe(403);
  });

  it("rejects wrong demo password", async () => {
    const r = await c.call("POST", "/auth/login", { username: "1", password: "2" });
    expect(r.status).toBe(401);
  });
});
