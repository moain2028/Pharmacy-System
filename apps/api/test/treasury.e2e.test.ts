import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connect } from "@pharmacore/db";
import { bootTestApp, DATABASE_URL, type TestCtx } from "./helpers.js";

interface LineRow { account_code: string; d: string; c: string; cb: string | null; cust: string | null }
interface MoveRow { kind: string; a: string; currency: string; cashbox_id: string; pair_id: string | null; shift_id: string | null }

describe("treasury API", () => {
  let c: TestCtx;
  let sql: ReturnType<typeof connect>;
  let reg1 = "";
  let safe = "";

  const lines = async (entryId: string): Promise<LineRow[]> =>
    sql<LineRow[]>`SELECT account_code, debit_minor::text AS d, credit_minor::text AS c, dim_cashbox_id::text AS cb, dim_customer_id::text AS cust
      FROM journal_lines WHERE entry_id = ${entryId} ORDER BY line_no`;
  const balanced = (ls: LineRow[]): void => {
    const d = ls.reduce((s, l) => s + BigInt(l.d), 0n);
    const cr = ls.reduce((s, l) => s + BigInt(l.c), 0n);
    expect(d).toBe(cr);
    expect(d > 0n).toBe(true);
  };

  beforeAll(async () => {
    c = await bootTestApp();
    sql = connect(DATABASE_URL, 1);
    const cbs = await c.call("GET", "/cashboxes");
    expect(cbs.status).toBe(200);
    reg1 = cbs.body.find((x: { code: string }) => x.code === "REG1").id;
    safe = cbs.body.find((x: { code: string }) => x.code === "SAFE").id;
    const sh = await c.call("POST", "/shifts/open", { cashboxId: reg1, openingFloat: [{ currency: "YER_NEW", amountMinor: "500000" }] });
    expect(sh.status).toBe(201);
  }, 60_000);

  afterAll(async () => {
    await sql.end();
    await c.app.close();
  });

  it("posts an expense from the register", async () => {
    const cats = await c.call("GET", "/expense-categories");
    expect(cats.status).toBe(200);
    const elec = cats.body.find((x: { code: string }) => x.code === "UTIL");
    expect(elec.account_code).toBe("5510");
    const r = await c.call("POST", "/expenses", { categoryId: elec.id, cashboxId: reg1, currency: "YER_NEW", amountMinor: "120000", businessDate: "2026-03-01", description: "فاتورة كهرباء" });
    expect(r.status).toBe(201);
    expect(r.body.number).toBeTruthy();
    const mv = await sql<MoveRow[]>`SELECT kind, amount_minor::text AS a, currency::text, cashbox_id::text, pair_id::text, shift_id::text FROM cash_movements WHERE document_id = ${r.body.id}`;
    expect(mv).toHaveLength(1);
    expect(mv[0]!.kind).toBe("EXPENSE");
    expect(mv[0]!.a).toBe("-120000");
    expect(mv[0]!.shift_id).not.toBeNull();
    const ls = await lines(r.body.entryId);
    expect(ls.map((l) => [l.account_code, l.d, l.c])).toEqual([["5510", "120000", "0"], ["1100", "0", "120000"]]);
    const [ex] = await sql<{ status: string; amount_minor: string }[]>`SELECT status::text, amount_minor::text FROM expenses WHERE id = ${r.body.id}`;
    expect(ex).toEqual({ status: "POSTED", amount_minor: "120000" });
  });

  it("transfers REG1 → SAFE with paired movements and updates balances", async () => {
    const r = await c.call("POST", "/cash/transfers", { fromCashboxId: reg1, toCashboxId: safe, currency: "YER_NEW", amountMinor: "100000", businessDate: "2026-03-01", reason: "إيداع في الخزنة" });
    expect(r.status).toBe(201);
    const mv = await sql<MoveRow[]>`SELECT kind, amount_minor::text AS a, currency::text, cashbox_id::text, pair_id::text, shift_id::text FROM cash_movements WHERE pair_id = ${r.body.pairId} ORDER BY amount_minor`;
    expect(mv.map((m) => [m.kind, m.a, m.cashbox_id])).toEqual([["TRANSFER_OUT", "-100000", reg1], ["TRANSFER_IN", "100000", safe]]);
    const ls = await lines(r.body.entryId);
    expect(ls.map((l) => [l.account_code, l.d, l.c, l.cb])).toEqual([["1100", "100000", "0", safe], ["1100", "0", "100000", reg1]]);
    balanced(ls);
    const bal = await c.call("GET", "/cash/balances");
    expect(bal.status).toBe(200);
    const row = bal.body.find((x: { code: string; currency: string }) => x.code === "REG1" && x.currency === "YER_NEW");
    expect(String(row.balance_minor)).toBe("280000");
  });

  it("injects SAR capital and exchanges SAR → YER_NEW at book rate", async () => {
    const er = await c.call("POST", "/exchange-rates", { from: "SAR", to: "YER_NEW", buyRateScaled: "140000000", sellRateScaled: "142000000", effectiveFrom: "2024-01-01T00:00:00.000Z" });
    expect(er.status).toBeLessThan(300);
    const cap = await c.call("POST", "/cash/owner", { kind: "CAPITAL", cashboxId: safe, currency: "SAR", amountMinor: "20000", businessDate: "2026-03-02", memo: "رأس مال" });
    expect(cap.status).toBe(201);
    const capLines = await lines(cap.body.entryId);
    balanced(capLines);
    expect(capLines.find((l) => l.account_code === "3100")?.c).toBe("2840000");

    const fx = await c.call("POST", "/cash/fx", { cashboxId: safe, fromCurrency: "SAR", fromAmountMinor: "10000", toCurrency: "YER_NEW", toAmountMinor: "1400000", businessDate: "2026-03-02" });
    expect(fx.status).toBe(201);
    const mv = await sql<MoveRow[]>`SELECT kind, amount_minor::text AS a, currency::text, cashbox_id::text, pair_id::text, shift_id::text FROM cash_movements WHERE pair_id = ${fx.body.pairId} ORDER BY amount_minor`;
    expect(mv.map((m) => [m.kind, m.a, m.currency])).toEqual([["FX_OUT", "-10000", "SAR"], ["FX_IN", "1400000", "YER_NEW"]]);
    const [snap] = await sql<{ r: string | null }[]>`SELECT rate_scaled_snapshot::text AS r FROM cash_movements WHERE pair_id = ${fx.body.pairId} AND kind = 'FX_IN'`;
    expect(snap?.r).toBe("140000000");
    const ls = await lines(fx.body.entryId);
    balanced(ls);
    expect(ls.find((l) => l.account_code === "1100")?.d).toBe("1400000");
    expect(ls.find((l) => l.account_code === "5400")?.d).toBe("20000");
  });

  it("rejects invalid treasury operations", async () => {
    const same = await c.call("POST", "/cash/fx", { cashboxId: safe, fromCurrency: "SAR", fromAmountMinor: "100", toCurrency: "SAR", toAmountMinor: "100" });
    expect(same.status).toBe(422);
    expect(same.body.error.code).toBe("treasury.same_currency");
    const over = await c.call("POST", "/cash/owner", { kind: "OWNER_DRAWING", cashboxId: safe, currency: "YER_NEW", amountMinor: "100000000", memo: "سحب" });
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe("cash.insufficient_balance");
  });

  it("records an unallocated customer receipt as a deposit", async () => {
    const custId = await sql.begin(async (t) => {
      await t`SELECT set_config('app.tenant_id', ${c.tenantId}, true)`;
      const [row] = await t<{ id: string }[]>`INSERT INTO customers (tenant_id, code, name) VALUES (${c.tenantId}, 'C-001', 'أحمد علي') RETURNING id::text`;
      return row!.id;
    });
    const r = await c.call("POST", "/customer-receipts", { customerId: custId, cashboxId: reg1, method: "CASH", currency: "YER_NEW", amountMinor: "50000", businessDate: "2026-03-03" });
    expect(r.status).toBe(201);
    const ls = await lines(r.body.entryId);
    expect(ls.map((l) => [l.account_code, l.d, l.c])).toEqual([["1100", "50000", "0"], ["2300", "0", "50000"]]);
    expect(ls[1]!.cust).toBe(custId);
    const [pp] = await sql<{ status: string; number: string | null; shift_id: string | null; party_type: string }[]>`SELECT status::text, number, shift_id::text, party_type FROM party_payments WHERE id = ${r.body.id}`;
    expect(pp?.status).toBe("POSTED");
    expect(pp?.number).toBeTruthy();
    expect(pp?.shift_id).not.toBeNull();
    const [mv] = await sql<MoveRow[]>`SELECT kind, amount_minor::text AS a, currency::text, cashbox_id::text, pair_id::text, shift_id::text FROM cash_movements WHERE document_id = ${r.body.id}`;
    expect([mv?.kind, mv?.a]).toEqual(["CUSTOMER_PAYMENT", "50000"]);
  });

  it("posts opening balances once", async () => {
    const body = { businessDate: "2026-01-01", lines: [{ accountCode: "1400", side: "DEBIT", amountMinor: "100000000" }, { accountCode: "2100", side: "CREDIT", amountMinor: "30000000" }] };
    const r = await c.call("POST", "/accounting/opening-balances", body);
    expect(r.status).toBe(201);
    const ls = await lines(r.body.entryId);
    expect(ls.map((l) => [l.account_code, l.d, l.c])).toEqual([["1400", "100000000", "0"], ["2100", "0", "30000000"], ["3100", "0", "70000000"]]);
    balanced(ls);
    const again = await c.call("POST", "/accounting/opening-balances", body);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("treasury.opening_already_posted");
  });
});
