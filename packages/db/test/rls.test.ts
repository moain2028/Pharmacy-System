/**
 * Row-Level Security: the application role sees/writes only its own tenant's rows,
 * cannot UPDATE ledgers, cannot DELETE anything.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import type { Sql } from "../src/migrate.js";
import { PG_ERR, withTenant } from "../src/tenant.js";
import { expectPgError, freshDb, receiveLot, seed, TEST_URL, type Fixture } from "./helpers.js";

let owner: Sql;
let app: Sql;
let a: Fixture;
let b: Fixture;

beforeAll(async () => {
  owner = await freshDb();
  a = await seed(owner, "A");
  b = await seed(owner, "B");
  await receiveLot(owner, a, { lotNumber: "A-1" });
  await receiveLot(owner, b, { lotNumber: "B-1" });
  // a LOGIN role that inherits the least-privilege application role
  await owner.unsafe(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pharmacore_app_test') THEN
      CREATE ROLE pharmacore_app_test LOGIN PASSWORD 'apptest' IN ROLE pharmacore_app;
    END IF; END $$;`);
  const u = new URL(TEST_URL);
  u.username = "pharmacore_app_test";
  u.password = "apptest";
  app = postgres(u.toString(), { max: 2, onnotice: () => undefined });
});
afterAll(async () => {
  await app.end();
  await owner.end();
});

describe("tenant isolation", () => {
  it("without tenant context the app role sees nothing", async () => {
    const rows = await app`SELECT id FROM items`;
    expect(rows.length).toBe(0);
  });
  it("with tenant context the app role sees only its tenant", async () => {
    const rowsA = await withTenant(app, a.tenantId, (tx) => tx<{ item_code: string }[]>`SELECT item_code FROM items`);
    expect(rowsA.map((r) => r.item_code)).toEqual(["PANADOL-A"]);
    const rowsB = await withTenant(app, b.tenantId, (tx) => tx<{ item_code: string }[]>`SELECT item_code FROM items`);
    expect(rowsB.map((r) => r.item_code)).toEqual(["PANADOL-B"]);
    const lotsA = await withTenant(app, a.tenantId, (tx) => tx`SELECT id FROM lots`);
    expect(lotsA.length).toBe(1);
  });
  it("stock_balances view does not bypass RLS (security_invoker)", async () => {
    const none = await app`SELECT * FROM stock_balances`;
    expect(none.length).toBe(0);
    const mine = await withTenant(app, a.tenantId, (tx) => tx<{ tenant_id: string }[]>`SELECT tenant_id FROM stock_balances`);
    expect(mine.length).toBe(1);
    expect(mine[0]!.tenant_id).toBe(a.tenantId);
  });
  it("cannot INSERT a row for another tenant (WITH CHECK)", async () => {
    await expectPgError(
      withTenant(app, a.tenantId, (tx) =>
        tx`INSERT INTO items (tenant_id, item_code, trade_name_ar, trade_name_en) VALUES (${b.tenantId}, 'EVIL', 'x', 'x')`,
      ),
      PG_ERR.RLS_VIOLATION,
    );
  });
  it("cannot UPDATE another tenant's rows (silently zero rows) and cannot re-tenant a row", async () => {
    const res = await withTenant(app, a.tenantId, (tx) => tx`UPDATE items SET notes = 'hacked' WHERE tenant_id = ${b.tenantId}`);
    expect(res.count).toBe(0);
    await expectPgError(
      withTenant(app, a.tenantId, (tx) => tx`UPDATE items SET tenant_id = ${b.tenantId} WHERE item_code = 'PANADOL-A'`),
      PG_ERR.RLS_VIOLATION,
    );
  });
  it("tenant context is transaction-local (does not leak to the pool)", async () => {
    await withTenant(app, a.tenantId, (tx) => tx`SELECT 1`);
    const rows = await app`SELECT id FROM items`;
    expect(rows.length).toBe(0);
  });
});

describe("least privilege", () => {
  it("app role cannot DELETE anything", async () => {
    await expectPgError(
      withTenant(app, a.tenantId, (tx) => tx`DELETE FROM items WHERE item_code = 'PANADOL-A'`),
      PG_ERR.INSUFFICIENT_PRIVILEGE,
    );
  });
  it("app role has no UPDATE privilege on ledgers at all", async () => {
    await expectPgError(
      withTenant(app, a.tenantId, (tx) => tx`UPDATE stock_movements SET qty_delta_ssu = 1`),
      PG_ERR.INSUFFICIENT_PRIVILEGE,
    );
  });
  it("app role can still post a sale inside its tenant", async () => {
    const [lot] = await withTenant(app, a.tenantId, (tx) => tx<{ id: string }[]>`SELECT id FROM lots`);
    await withTenant(
      app,
      a.tenantId,
      (tx) => tx`INSERT INTO stock_movements (tenant_id, item_id, lot_id, location_id, movement_type, qty_delta_ssu, unit_cost_minor_snapshot, cost_currency, document_type, document_id, business_date)
        VALUES (${a.tenantId}, ${a.itemId}, ${lot!.id}, ${a.locationId}, 'SALE', -2, 500, 'YER_NEW', 'SALES_INVOICE', ${crypto.randomUUID()}, '2026-01-15')`,
    );
    const [bal] = await withTenant(app, a.tenantId, (tx) => tx<{ qty_ssu: string }[]>`SELECT qty_ssu FROM stock_balances`);
    expect(bal!.qty_ssu).toBe("98");
  });
});
