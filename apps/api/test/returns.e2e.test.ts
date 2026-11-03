import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connect, type Sql } from "@pharmacore/db";
import { bootTestApp, DATABASE_URL, panadol, type TestCtx } from "./helpers.js";

type Row = Record<string, unknown>;
let c: TestCtx;
let db: Sql;
let itemId = "", boxId = "", stripId = "", lotA = "", lotB = "", mainLoc = "", cashboxId = "", invoiceId = "", boxLineId = "", returnId = "";

function rowsOf(b: unknown): Row[] {
  if (Array.isArray(b)) return b as Row[];
  const o = (b ?? {}) as Row;
  const r = o["rows"] ?? o["items"] ?? o["data"] ?? o["units"];
  return Array.isArray(r) ? (r as Row[]) : [];
}

async function q<T>(fn: (t: Sql) => Promise<T>): Promise<T> {
  return (await db.begin(async (t) => {
    await t`SELECT set_config('app.tenant_id', ${c.tenantId}, true)`;
    return fn(t as unknown as Sql);
  })) as T;
}

const ret = (lineId: string, qtySsu: string, businessDate: string) => ({ invoiceId, lines: [{ lineId, qtySsu }], reason: { code: "DAMAGED", text: "علبة تالفة" }, businessDate });

beforeAll(async () => {
  c = await bootTestApp();
  db = connect(DATABASE_URL, 1);
  const it1 = await c.call("POST", "/items", panadol());
  expect(it1.status).toBe(201);
  itemId = it1.body.id;
  const item = await c.call("GET", `/items/${itemId}`);
  const units = rowsOf(item.body?.units ?? item.body?.item?.units ?? item.body);
  boxId = units.find((u) => u["name_en"] === "Box")?.["id"] as string;
  stripId = units.find((u) => u["name_en"] === "Strip")?.["id"] as string;
  const pls = rowsOf((await c.call("GET", "/price-lists")).body);
  const pl = (pls.find((p) => p["code"] === "RETAIL") ?? pls[0])?.["id"] as string;
  for (const [unitId, price] of [[boxId, "150000"], [stripId, "75000"]] as const) {
    const p = await c.call("POST", "/prices", { priceListId: pl, itemId, unitId, unitPriceMinor: price });
    expect([200, 201]).toContain(p.status);
  }
  mainLoc = rowsOf((await c.call("GET", "/inventory/locations")).body).find((l) => l["code"] === "MAIN")?.["id"] as string;
  const rcpt = (lotNumber: string, qtyInUnit: number, expiryDate: string) =>
    c.call("POST", "/inventory/receipts", { itemId, locationId: mainLoc, unitId: boxId, qtyInUnit, lotNumber, expiryDate, unitCostMinor: "120000", costCurrency: "YER_NEW", businessDate: "2026-02-15" });
  const a = await rcpt("A", 2, "2026-04-01");
  expect(a.status).toBe(201);
  lotA = a.body.lotId;
  const b = await rcpt("B", 10, "2027-01-01");
  expect(b.status).toBe(201);
  lotB = b.body.lotId;
  cashboxId = rowsOf((await c.call("GET", "/cash/balances")).body).find((r) => r["code"] === "REG1")?.["id"] as string;
  const sh = await c.call("POST", "/shifts/open", { cashboxId, openingFloat: [{ currency: "YER_NEW", amountMinor: "500000" }] });
  expect(sh.status).toBe(201);
  const sale = await c.call("POST", "/sales", {
    businessDate: "2026-03-01",
    lines: [{ itemId, unitId: boxId, qtyInUnit: 3 }, { itemId, unitId: stripId, qtyInUnit: 1 }],
    tenders: [{ method: "CASH", currency: "YER_NEW", amountMinor: "525000" }],
  });
  expect(sale.status).toBe(201);
  invoiceId = sale.body.id;
  const lines = await q((t) => t<{ id: string; unit_id: string; ssu_qty: string }[]>`SELECT id, unit_id, ssu_qty FROM sales_invoice_lines WHERE invoice_id = ${invoiceId} ORDER BY line_no`);
  boxLineId = lines.find((l) => l.unit_id === boxId)?.id ?? "";
  expect(boxLineId).not.toBe("");
}, 120_000);

afterAll(async () => {
  await db?.end();
  await c?.app.close();
});

describe("sales returns", () => {
  it("sale allocated FEFO: 48 SSU from lot A, 24 from lot B on the box line", async () => {
    const lots = await q((t) => t<{ lot_id: string; q: string }[]>`SELECT lot_id, SUM(ssu_qty)::text AS q FROM sale_line_lots WHERE line_id = ${boxLineId} GROUP BY lot_id`);
    expect(lots.find((l) => l.lot_id === lotA)?.q).toBe("48");
    expect(lots.find((l) => l.lot_id === lotB)?.q).toBe("24");
  });

  it("(a) quote then post a return of 1 box → refund 1500.00, restock lot B, cash refund, balanced journal", async () => {
    const qt = await c.call("POST", "/returns/quote", ret(boxLineId, "24", "2026-03-02"));
    expect(qt.status).toBe(200);
    expect(qt.body.refundTotalMinor).toBe("150000");
    const r = await c.call("POST", "/returns", ret(boxLineId, "24", "2026-03-02"));
    expect(r.status).toBe(201);
    expect(r.body.refundTotalMinor).toBe("150000");
    expect(r.body.refunds).toEqual([{ method: "CASH", amount: { currency: "YER_NEW", amountMinor: "150000" } }]);
    expect(r.body.lines[0].lots[0].lotId).toBe(lotB);
    returnId = r.body.id;

    const hdr = await q((t) => t<{ status: string; refund_total_minor: string; number: string | null }[]>`SELECT status, refund_total_minor, number FROM sales_returns WHERE id = ${returnId}`);
    expect(hdr[0]?.status).toBe("POSTED");
    expect(hdr[0]?.refund_total_minor).toBe("150000");
    expect(hdr[0]?.number).toBeTruthy();

    const rl = await q((t) => t<{ lot_id: string; ssu_qty: string; qty_in_unit: string; unit_id: string; refund_minor: string; refund_unit_price_minor: string; cost_minor_snapshot: string }[]>`SELECT lot_id, ssu_qty, qty_in_unit, unit_id, refund_minor, refund_unit_price_minor, cost_minor_snapshot FROM sales_return_lines WHERE return_id = ${returnId}`);
    expect(rl).toHaveLength(1);
    expect(rl[0]).toMatchObject({ lot_id: lotB, ssu_qty: "24", qty_in_unit: "1", unit_id: boxId, refund_minor: "150000", refund_unit_price_minor: "6250", cost_minor_snapshot: "120000" });

    const mv = await q((t) => t<{ lot_id: string; location_id: string; qty_delta_ssu: string; unit_cost_minor_snapshot: string; movement_type: string }[]>`SELECT lot_id, location_id, qty_delta_ssu, unit_cost_minor_snapshot, movement_type::text AS movement_type FROM stock_movements WHERE document_id = ${returnId}`);
    expect(mv).toHaveLength(1);
    expect(mv[0]).toMatchObject({ lot_id: lotB, location_id: mainLoc, qty_delta_ssu: "24", unit_cost_minor_snapshot: "5000", movement_type: "SALE_RETURN" });

    const cm = await q((t) => t<{ kind: string; amount_minor: string; currency: string; cashbox_id: string }[]>`SELECT kind, amount_minor, currency::text AS currency, cashbox_id FROM cash_movements WHERE document_id = ${returnId}`);
    expect(cm).toEqual([{ kind: "SALE_REFUND", amount_minor: "-150000", currency: "YER_NEW", cashbox_id: cashboxId }]);

    const jl = await q((t) => t<{ account_code: string; d: string; cr: string; dim_lot_id: string | null }[]>`SELECT jl.account_code, jl.debit_minor::text AS d, jl.credit_minor::text AS cr, jl.dim_lot_id
      FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id WHERE je.document_type = 'sales_return' AND je.document_id = ${returnId} ORDER BY jl.line_no`);
    expect(jl).toHaveLength(4);
    const by = (code: string) => jl.find((l) => l.account_code === code);
    expect(by("4110")).toMatchObject({ d: "150000", cr: "0" });
    expect(by("1100")).toMatchObject({ d: "0", cr: "150000" });
    expect(by("1400")).toMatchObject({ d: "120000", cr: "0", dim_lot_id: lotB });
    expect(by("5100")).toMatchObject({ d: "0", cr: "120000" });
    const sd = jl.reduce((a, l) => a + BigInt(l.d), 0n);
    const sc = jl.reduce((a, l) => a + BigInt(l.cr), 0n);
    expect(sd).toBe(sc);
    expect(sd).toBe(270000n);

    const g = await c.call("GET", `/returns/${returnId}`);
    expect(g.status).toBe(200);
    expect(g.body.lines).toHaveLength(1);
    const l = await c.call("GET", `/returns?invoiceId=${invoiceId}`);
    expect(l.status).toBe(200);
    expect(l.body.rows.map((x: { id: string }) => x.id)).toContain(returnId);
  });

  it("(b) returning 3 more boxes exceeds the returnable quantity → 422", async () => {
    const r = await c.call("POST", "/returns", ret(boxLineId, "72", "2026-03-02"));
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe("return.qty_exceeds_returnable");
    const n = await q((t) => t<{ n: string }[]>`SELECT count(*)::text AS n FROM sales_returns WHERE original_invoice_id = ${invoiceId}`);
    expect(n[0]?.n).toBe("1");
  });

  let cashierToken = "";
  it("(c) return after the 7-day window → 422 return.window_expired for a cashier (owner holds returns.late)", async () => {
    const roles = await c.call("GET", "/roles");
    const cashierRoleId = (roles.body as Array<{ id: string; code: string }>).find((x) => x.code === "CASHIER")!.id;
    const u = await c.call("POST", "/users", { username: "cashier1", displayName: "Cashier One", password: "Str0ngPass!", roleIds: [cashierRoleId] });
    expect(u.status).toBe(201);
    const login = await c.call("POST", "/auth/login", { username: "cashier1", password: "Str0ngPass!" });
    cashierToken = login.body.accessToken as string;
    expect(cashierToken).toBeTruthy();
    const r = await c.call("POST", "/returns/quote", ret(boxLineId, "24", "2026-03-20"), cashierToken);
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe("return.window_expired");
    // owner is allowed (returns.late) — quote only, no posting
    const ok = await c.call("POST", "/returns/quote", ret(boxLineId, "24", "2026-03-20"));
    expect(ok.status).toBe(200);
  });

  it("(d) customers create / patch / get / statement; credit limit change needs customers.credit_limit", async () => {
    const cr = await c.call("POST", "/customers", { name: "محمد علي", phone: "777123456", creditLimitMinor: "1000000", creditCurrency: "YER_NEW" });
    expect(cr.status).toBe(201);
    expect(cr.body.code).toMatch(/^C-\d{5}$/);
    expect(cr.body.credit_limit_minor).toBe("1000000");
    expect(cr.body.version).toBe(1);
    const id = cr.body.id as string;
    const cr2 = await c.call("POST", "/customers", { name: "Ali Saleh" });
    expect(cr2.status).toBe(201);
    expect(cr2.body.code).not.toBe(cr.body.code);

    const ls = await c.call("GET", "/customers?q=777123");
    expect(ls.status).toBe(200);
    expect(ls.body.rows.map((r: { id: string }) => r.id)).toEqual([id]);

    const p = await c.call("PATCH", `/customers/${id}`, { version: 1, address: "صنعاء" });
    expect(p.status).toBe(200);
    expect(p.body.version).toBe(2);
    expect(p.body.address).toBe("صنعاء");
    const stale = await c.call("PATCH", `/customers/${id}`, { version: 1, name: "X" });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("customer.version_conflict");

    const g = await c.call("GET", `/customers/${id}`);
    expect(g.status).toBe(200);
    expect(g.body.balance).toEqual({ currency: "YER_NEW", amountMinor: "0" });

    const st = await c.call("GET", `/customers/${id}/statement?from=2026-01-01&to=2026-12-31`);
    expect(st.status).toBe(200);
    expect(st.body.rows).toEqual([]);
    expect(st.body.opening.amountMinor).toBe("0");
    expect(st.body.closing.amountMinor).toBe("0");

    const denied = await c.call("PATCH", `/customers/${id}`, { version: 2, creditLimitMinor: "2000000" }, cashierToken);
    expect(denied.status).toBe(403);
    const after = await c.call("GET", `/customers/${id}`);
    expect(after.body.credit_limit_minor).toBe("1000000");
    expect(after.body.version).toBe(2);
  });
});
