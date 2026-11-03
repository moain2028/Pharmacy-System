import { connect, type Sql } from "@pharmacore/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootTestApp, DATABASE_URL, panadol, type TestCtx } from "./helpers.js";

const D = "2026-03-01";
const list = (b: unknown): any[] => { const x = b as any; return Array.isArray(x) ? x : (x?.rows ?? x?.items ?? x?.data ?? []); };
let c: TestCtx; let sql: Sql; let itemId = ""; let boxId = ""; let stripId = ""; let cashboxId = "";
const inTenant = <T>(fn: (t: Sql) => Promise<T>): Promise<T> =>
  sql.begin(async (t) => { await t`SELECT set_config('app.tenant_id', ${c.tenantId}, true)`; return fn(t as unknown as Sql); }) as Promise<T>;

beforeAll(async () => {
  c = await bootTestApp();
  sql = connect(DATABASE_URL, 1);
  const item = await c.call("POST", "/items", panadol());
  expect(item.status, JSON.stringify(item.body)).toBe(201);
  itemId = item.body.id;
  const full = await c.call("GET", `/items/${itemId}`);
  const unit = (n: string): string => list(full.body.units).find((u) => (u.name_en ?? u.nameEn) === n)?.id;
  boxId = unit("Box"); stripId = unit("Strip");
  expect(boxId).toBeTruthy(); expect(stripId).toBeTruthy();
  const pls = await c.call("GET", "/price-lists");
  const retail = list(pls.body).find((p) => p.code === "RETAIL");
  for (const [unitId, unitPriceMinor] of [[boxId, "150000"], [stripId, "75000"]] as const) {
    const r = await c.call("POST", "/prices", { priceListId: retail.id, itemId, unitId, unitPriceMinor });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
  }
  const locs = await c.call("GET", "/inventory/locations");
  const main = list(locs.body).find((l) => l.code === "MAIN");
  for (const rc of [{ qty: 2, lot: "B1", exp: "2027-01-01" }, { qty: 10, lot: "A1", exp: "2026-04-01" }]) {
    const r = await c.call("POST", "/inventory/receipts", { itemId, locationId: main.id, unitId: boxId, qtyInUnit: rc.qty, lotNumber: rc.lot, expiryDate: rc.exp, unitCostMinor: "120000", costCurrency: "YER_NEW", businessDate: D });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
  }
  const [cb] = await inTenant((t) => t<{ id: string }[]>`SELECT id FROM cashboxes WHERE tenant_id = ${c.tenantId} AND code = 'REG1'`);
  cashboxId = cb!.id;
  const shift = await c.call("POST", "/shifts/open", { cashboxId, openingFloat: [{ currency: "YER_NEW", amountMinor: "500000" }] });
  expect(shift.status, JSON.stringify(shift.body)).toBe(201);
  const sale = await c.call("POST", "/sales", { businessDate: D, lines: [{ itemId, unitId: boxId, qtyInUnit: 3 }, { itemId, unitId: stripId, qtyInUnit: 1 }], tenders: [{ method: "CASH", currency: "YER_NEW", amountMinor: "525000" }] });
  expect(sale.status, JSON.stringify(sale.body)).toBe(201);
}, 60_000);

afterAll(async () => { await sql.end({ timeout: 5 }); await c.app.close(); });

describe("reports", () => {
  it("trial balance is balanced and cash 1100 = sale (opening float is a drawer movement, not a GL event)", async () => {
    const r = await c.call("GET", "/reports/trial-balance?to=2026-12-31");
    expect(r.status).toBe(200);
    expect(r.body.currency).toBe("YER_NEW");
    expect(r.body.totals.balanced).toBe(true);
    expect(r.body.totals.debit).toBe(r.body.totals.credit);
    const cash = r.body.rows.find((x: any) => x.code === "1100");
    expect(cash.debit).toBe("525000");
    const [j] = await inTenant((t) => t<{ d: string; c: string }[]>`SELECT COALESCE(SUM(debit_minor),0)::text AS d, COALESCE(SUM(credit_minor),0)::text AS c FROM journal_lines WHERE tenant_id = ${c.tenantId}`);
    expect(j!.d).toBe(j!.c);
    expect(r.body.totals.debit).toBe(j!.d);
  });

  it("P&L: sales 525000, COGS 420000, gross profit 105000", async () => {
    const r = await c.call("GET", "/reports/pnl?from=2026-01-01&to=2026-12-31");
    expect(r.status).toBe(200);
    expect(r.body.revenue.find((x: any) => x.code === "4100").amount).toBe("525000");
    expect(r.body.expenses.find((x: any) => x.code === "5100").amount).toBe("420000");
    expect(r.body.grossProfit.sales).toBe("525000");
    expect(r.body.grossProfit.cogs).toBe("420000");
    expect(r.body.grossProfit.grossProfit).toBe("105000");
    expect(BigInt(r.body.totals.netProfit)).toBe(BigInt(r.body.totals.revenue) - BigInt(r.body.totals.expenses));
  });

  it("balance sheet balances with current earnings", async () => {
    const r = await c.call("GET", "/reports/balance-sheet?to=2026-12-31");
    expect(r.status).toBe(200);
    expect(r.body.totals.balanced).toBe(true);
    expect(r.body.totals.difference).toBe("0");
    expect(r.body.totals.netProfit).toBe("105000");
    expect(r.body.equity.find((x: any) => x.code === "3900").amount).toBe("105000");
  });

  it("sales summary by day: one row, count 1", async () => {
    const r = await c.call("GET", "/reports/sales?from=2026-01-01&to=2026-12-31&groupBy=day");
    expect(r.status).toBe(200);
    expect(r.body.rows).toHaveLength(1);
    const row = r.body.rows[0];
    expect(row.key).toBe(D); expect(row.count).toBe(1); expect(row.qtySsu).toBe("84");
    expect(row.total).toBe("525000"); expect(row.net).toBe("525000"); expect(row.cogs).toBe("420000"); expect(row.grossMargin).toBe("105000"); expect(row.returnRefund).toBe("0");
    expect(r.body.totals.total).toBe("525000"); expect(r.body.totals.marginBp).toBe(2000);
    const byItem = await c.call("GET", "/reports/sales?from=2026-01-01&to=2026-12-31&groupBy=item");
    expect(byItem.status).toBe(200); expect(byItem.body.rows[0].key).toBe(itemId); expect(byItem.body.rows[0].labelEn).toBe("Panadol Extra");
    const bad = await c.call("GET", "/reports/sales?from=2026-12-31&to=2026-01-01");
    expect(bad.status).toBe(400); expect(bad.body.error.code).toBe("validation.failed");
  });

  it("sales by payment method and top items", async () => {
    const m = await c.call("GET", "/reports/sales-by-method?from=2026-01-01&to=2026-12-31");
    expect(m.status).toBe(200);
    const cash = m.body.rows.find((x: any) => x.method === "CASH" && x.currency === "YER_NEW");
    expect(cash.amountMinor).toBe("525000"); expect(cash.count).toBe(1);
    const t = await c.call("GET", "/reports/top-items?from=2026-01-01&to=2026-12-31&limit=5");
    expect(t.status).toBe(200); expect(t.body.rows).toHaveLength(1);
    expect(t.body.rows[0].itemId).toBe(itemId); expect(t.body.rows[0].net).toBe("525000"); expect(t.body.rows[0].cogs).toBe("420000"); expect(t.body.rows[0].qtySsu).toBe("84");
  });

  it("inventory valuation = 204 SSU × 5000 = 1,020,000", async () => {
    const r = await c.call("GET", "/reports/inventory-valuation?asOf=2026-12-31");
    expect(r.status).toBe(200);
    expect(r.body.rows).toHaveLength(1);
    expect(r.body.rows[0].qtySsu).toBe("204");
    expect(r.body.rows[0].valueMinor).toBe("1020000");
    expect(r.body.totals.valueMinor).toBe("1020000");
    expect(r.body.totals.qtySsu).toBe("204");
    const byLoc = await c.call("GET", "/reports/inventory-valuation?byLocation=true");
    expect(byLoc.status).toBe(200); expect(byLoc.body.rows[0].locationCode).toBe("MAIN"); expect(byLoc.body.totals.valueMinor).toBe("1020000");
  });

  it("expiry report days=60 asOf 2026-03-01 lists lot A1 only", async () => {
    const r = await c.call("GET", "/reports/expiry?days=60&asOf=2026-03-01");
    expect(r.status).toBe(200);
    expect(r.body.rows).toHaveLength(1);
    const row = r.body.rows[0];
    expect(row.lotNumber).toBe("A1"); expect(row.expiryDate).toBe("2026-04-01"); expect(row.daysLeft).toBe(31); expect(row.bucket).toBe("D90");
    expect(row.qtySsu).toBe("156"); expect(row.valueMinor).toBe("780000");
    expect(r.body.buckets.D90.valueMinor).toBe("780000"); expect(r.body.buckets.D30.count).toBe(0); expect(r.body.totals.valueMinor).toBe("780000");
    const wide = await c.call("GET", "/reports/expiry?days=400&asOf=2026-03-01");
    expect(wide.body.rows).toHaveLength(2); expect(wide.body.totals.valueMinor).toBe("1020000");
  });

  it("slow moving respects last SALE date", async () => {
    const none = await c.call("GET", "/reports/slow-moving?days=0&asOf=2026-03-01");
    expect(none.status).toBe(200); expect(none.body.rows).toHaveLength(0);
    const r = await c.call("GET", "/reports/slow-moving?days=30&asOf=2026-06-01");
    expect(r.body.rows).toHaveLength(1);
    expect(r.body.rows[0].lastSaleDate).toBe(D); expect(r.body.rows[0].qtySsu).toBe("204"); expect(r.body.rows[0].valueMinor).toBe("1020000");
  });

  it("aging reports are empty for a cash-only tenant", async () => {
    const ca = await c.call("GET", "/reports/customer-aging?asOf=2026-12-31");
    expect(ca.status).toBe(200); expect(ca.body.rows).toHaveLength(0); expect(ca.body.partyType).toBe("CUSTOMER");
    const sa = await c.call("GET", "/reports/supplier-aging?asOf=2026-12-31");
    expect(sa.status).toBe(200); expect(sa.body.rows).toHaveLength(0);
  });

  it("cashbook running balance ends at 1,025,000", async () => {
    const r = await c.call("GET", `/reports/cashbook?cashboxId=${cashboxId}&from=2020-01-01&to=2030-12-31`);
    expect(r.status).toBe(200);
    expect(r.body.cashbox.code).toBe("REG1");
    const yer = r.body.rows.filter((x: any) => x.currency === "YER_NEW");
    expect(yer.length).toBeGreaterThanOrEqual(2);
    expect(yer[yer.length - 1].runningBalanceMinor).toBe("1025000");
    expect(r.body.closing.find((x: any) => x.currency === "YER_NEW").amountMinor).toBe("1025000");
    const missing = await c.call("GET", "/reports/cashbook?cashboxId=00000000-0000-0000-0000-000000000000");
    expect(missing.status).toBe(404); expect(missing.body.error.code).toBe("cashbox.not_found");
  });

  it("audit trail and dashboard", async () => {
    const a = await c.call("GET", "/reports/audit?from=2020-01-01&to=2030-12-31&limit=50");
    expect(a.status).toBe(200); expect(a.body.rows.length).toBeGreaterThan(0); expect(a.body.rows[0].action).toBeTruthy();
    const d = await c.call("GET", "/reports/dashboard");
    expect(d.status).toBe(200);
    expect(d.body.cashOnHand.find((x: any) => x.currency === "YER_NEW").amountMinor).toBe("1025000");
    expect(d.body.openShifts).toBe(1);
    expect(typeof d.body.lowStockItems).toBe("number");
  });

  it("cashier without reports.financial gets 403", async () => {
    const roles = await c.call("GET", "/roles");
    const cashierRoleId = (roles.body as Array<{ id: string; code: string }>).find((x) => x.code === "CASHIER")!.id;
    const u = await c.call("POST", "/users", { username: "cash1", displayName: "Cashier One", password: "Str0ngPass!2", roleIds: [cashierRoleId] });
    expect(u.status, JSON.stringify(u.body)).toBe(201);
    const login = await c.call("POST", "/auth/login", { username: "cash1", password: "Str0ngPass!2" });
    expect(login.body.accessToken).toBeTruthy();
    const r = await c.call("GET", "/reports/trial-balance", undefined, login.body.accessToken);
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe("auth.permission_denied");
  });
});
