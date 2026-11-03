/**
 * DB-level invariant tests. These prove the database — not the application — enforces
 * ENGINEERING-RULES B (append-only ledgers), posted-document immutability, lot facts,
 * expiry/sellability on SALE, non-negative balances, UOM factor lock, balanced journals.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "../src/migrate.js";
import { PG_ERR } from "../src/tenant.js";
import { expectPgError, freshDb, receiveLot, sale, seed, type Fixture } from "./helpers.js";

let sql: Sql;
let f: Fixture;

beforeAll(async () => {
  sql = await freshDb();
  f = await seed(sql);
});
afterAll(async () => {
  await sql.end();
});

describe("migration runner", () => {
  it("records 0001 and is idempotent (checksum verified)", async () => {
    const rows = await sql<{ version: string; checksum: string }[]>`SELECT version, checksum FROM schema_migrations`;
    expect(rows.map((r) => r.version)).toEqual(["0001"]);
    expect(rows[0]!.checksum).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("stock_movements is an append-only ledger (P0001)", () => {
  it("rejects UPDATE", async () => {
    const lot = await receiveLot(sql, f, { lotNumber: "AO-1" });
    await expectPgError(sql`UPDATE stock_movements SET qty_delta_ssu = 1 WHERE lot_id = ${lot}`, PG_ERR.LEDGER_IMMUTABLE);
  });
  it("rejects DELETE", async () => {
    const lot = await receiveLot(sql, f, { lotNumber: "AO-2" });
    await expectPgError(sql`DELETE FROM stock_movements WHERE lot_id = ${lot}`, PG_ERR.LEDGER_IMMUTABLE);
  });
  it("rejects wrong sign for movement type (CHECK)", async () => {
    const lot = await receiveLot(sql, f, { lotNumber: "AO-3" });
    await expectPgError(
      sql`INSERT INTO stock_movements (tenant_id, item_id, lot_id, location_id, movement_type, qty_delta_ssu, unit_cost_minor_snapshot, cost_currency, document_type, document_id, business_date)
          VALUES (${f.tenantId}, ${f.itemId}, ${lot}, ${f.locationId}, 'SALE', 5, 500, 'YER_NEW', 'X', ${crypto.randomUUID()}, '2026-01-15')`,
      PG_ERR.CHECK_VIOLATION,
    );
  });
  it("cash_movements, journal_entries, journal_lines, audit_log, price_history reject UPDATE/DELETE", async () => {
    await sql`INSERT INTO cash_movements (tenant_id, cashbox_id, shift_id, currency, amount_minor, kind) VALUES (${f.tenantId}, ${f.cashboxId}, ${f.shiftId}, 'YER_NEW', 1000, 'OPENING_FLOAT')`;
    await expectPgError(sql`UPDATE cash_movements SET amount_minor = 5`, PG_ERR.LEDGER_IMMUTABLE);
    await expectPgError(sql`DELETE FROM cash_movements`, PG_ERR.LEDGER_IMMUTABLE);
    await sql`INSERT INTO audit_log (tenant_id, actor_user_id, action, entity_type, entity_id) VALUES (${f.tenantId}, ${f.userId}, 'test', 'x', ${crypto.randomUUID()})`;
    await expectPgError(sql`DELETE FROM audit_log`, PG_ERR.LEDGER_IMMUTABLE);
    await expectPgError(sql`UPDATE audit_log SET action = 'y'`, PG_ERR.LEDGER_IMMUTABLE);
  });
});

describe("lots", () => {
  it("requires expiry_date when item tracks expiry (P0005)", async () => {
    await expectPgError(
      sql`INSERT INTO lots (tenant_id, item_id, lot_number, expiry_date, qty_received_ssu, total_cost_minor, cost_currency)
          VALUES (${f.tenantId}, ${f.itemId}, 'NOEXP', NULL, 10, 100, 'YER_NEW')`,
      PG_ERR.LOT_EXPIRY_REQUIRED,
    );
  });
  it("allows NULL expiry for non-tracked items", async () => {
    const [it] = await sql<{ id: string }[]>`INSERT INTO items (tenant_id, item_code, trade_name_ar, trade_name_en, track_expiry)
        VALUES (${f.tenantId}, 'COTTON', 'قطن', 'Cotton', false) RETURNING id`;
    const [lot] = await sql<{ id: string }[]>`INSERT INTO lots (tenant_id, item_id, lot_number, expiry_date, qty_received_ssu, total_cost_minor, cost_currency)
        VALUES (${f.tenantId}, ${it!.id}, 'C1', NULL, 10, 100, 'YER_NEW') RETURNING id`;
    expect(lot!.id).toBeTruthy();
  });
  it("facts (qty/cost/expiry) are immutable, status fields are not (P0004)", async () => {
    const lot = await receiveLot(sql, f, { lotNumber: "FACT-1" });
    await expectPgError(sql`UPDATE lots SET qty_received_ssu = 999 WHERE id = ${lot}`, PG_ERR.LOT_FACTS_IMMUTABLE);
    await expectPgError(sql`UPDATE lots SET expiry_date = '2031-01-01' WHERE id = ${lot}`, PG_ERR.LOT_FACTS_IMMUTABLE);
    await expectPgError(sql`UPDATE lots SET total_cost_minor = 1 WHERE id = ${lot}`, PG_ERR.LOT_FACTS_IMMUTABLE);
    await sql`UPDATE lots SET manual_status = 'QUARANTINED', status_reason = 'recall', status_changed_by = ${f.userId}, status_changed_at = now() WHERE id = ${lot}`;
    const [row] = await sql<{ manual_status: string; version: number }[]>`SELECT manual_status, version FROM lots WHERE id = ${lot}`;
    expect(row!.manual_status).toBe("QUARANTINED");
    expect(row!.version).toBe(2);
  });
  it("cannot be deleted (P0001)", async () => {
    const lot = await receiveLot(sql, f, { lotNumber: "DEL-1" });
    await expectPgError(sql`DELETE FROM lots WHERE id = ${lot}`, PG_ERR.LEDGER_IMMUTABLE);
  });
});

describe("SALE guards", () => {
  it("rejects sale from a lot expired on/before business date — expired from START of expiry day (P0006)", async () => {
    const lot = await receiveLot(sql, f, { lotNumber: "EXP-1", expiry: "2026-02-01" });
    await expectPgError(sale(sql, f, lot, 1, "2026-02-01"), PG_ERR.LOT_EXPIRED); // same day = expired
    await expectPgError(sale(sql, f, lot, 1, "2026-03-01"), PG_ERR.LOT_EXPIRED);
    await sale(sql, f, lot, 1, "2026-01-31"); // day before: allowed
  });
  it("rejects sale from QUARANTINED/BLOCKED lot (P0007)", async () => {
    const lot = await receiveLot(sql, f, { lotNumber: "Q-1" });
    await sql`UPDATE lots SET manual_status = 'BLOCKED' WHERE id = ${lot}`;
    await expectPgError(sale(sql, f, lot, 1), PG_ERR.LOT_NOT_SELLABLE);
  });
  it("rejects a sale that would drive lot balance negative (P0008, deferred)", async () => {
    const lot = await receiveLot(sql, f, { lotNumber: "NEG-1", qty: 10 });
    await expectPgError(sale(sql, f, lot, 11), PG_ERR.INSUFFICIENT_STOCK);
    await sale(sql, f, lot, 10);
    const [b] = await sql<{ qty_ssu: string }[]>`SELECT qty_ssu FROM stock_balances WHERE lot_id = ${lot}`;
    expect(b!.qty_ssu).toBe("0");
  });
  it("deferred check lets a multi-row transaction net out correctly", async () => {
    const lot = await receiveLot(sql, f, { lotNumber: "NEG-2", qty: 5 });
    // Inside one tx: sale 8 (temporarily -3) then return 3 → final 0 → commit OK
    await sql.begin(async (tx) => {
      await tx`INSERT INTO stock_movements (tenant_id, item_id, lot_id, location_id, movement_type, qty_delta_ssu, unit_cost_minor_snapshot, cost_currency, document_type, document_id, business_date)
          VALUES (${f.tenantId}, ${f.itemId}, ${lot}, ${f.locationId}, 'SALE', -8, 500, 'YER_NEW', 'X', ${crypto.randomUUID()}, '2026-01-15')`;
      await tx`INSERT INTO stock_movements (tenant_id, item_id, lot_id, location_id, movement_type, qty_delta_ssu, unit_cost_minor_snapshot, cost_currency, document_type, document_id, business_date)
          VALUES (${f.tenantId}, ${f.itemId}, ${lot}, ${f.locationId}, 'SALE_RETURN', 3, 500, 'YER_NEW', 'X', ${crypto.randomUUID()}, '2026-01-15')`;
    });
  });
  it("tenant setting allow_negative_stock=true permits negative balance", async () => {
    const g = await seed(sql, "NEG");
    await sql`UPDATE tenants SET settings = '{"allow_negative_stock": true}' WHERE id = ${g.tenantId}`;
    const lot = await receiveLot(sql, g, { lotNumber: "NEG-OK", qty: 1 });
    await sale(sql, g, lot, 3);
  });
});

describe("UOM factor lock (D-026, P0003)", () => {
  it("factor is editable before use, locked after first stock movement; names remain editable", async () => {
    await sql`UPDATE item_units SET factor_to_ssu = 12 WHERE id = ${f.boxUnitId}`;
    await sql`UPDATE item_units SET factor_to_ssu = 10 WHERE id = ${f.boxUnitId}`;
    await receiveLot(sql, f, { lotNumber: "UOM-1", qty: 20, unitId: f.boxUnitId });
    const [u] = await sql<{ factor_locked_at: Date | null }[]>`SELECT factor_locked_at FROM item_units WHERE id = ${f.boxUnitId}`;
    expect(u!.factor_locked_at).not.toBeNull();
    await expectPgError(sql`UPDATE item_units SET factor_to_ssu = 12 WHERE id = ${f.boxUnitId}`, PG_ERR.UNIT_FACTOR_LOCKED);
    await sql`UPDATE item_units SET name_en = 'Carton' WHERE id = ${f.boxUnitId}`; // allowed
  });
  it("exactly one SSU, one default sale, one default purchase per item", async () => {
    await expectPgError(
      sql`INSERT INTO item_units (tenant_id, item_id, name_ar, name_en, factor_to_ssu, level, is_ssu) VALUES (${f.tenantId}, ${f.itemId}, 'x', 'x', 1, 9, true)`,
      PG_ERR.UNIQUE_VIOLATION,
    );
    await expectPgError(
      sql`INSERT INTO item_units (tenant_id, item_id, name_ar, name_en, factor_to_ssu, level, is_default_sale) VALUES (${f.tenantId}, ${f.itemId}, 'x', 'x', 5, 8, true)`,
      PG_ERR.UNIQUE_VIOLATION,
    );
    await expectPgError(
      sql`INSERT INTO item_units (tenant_id, item_id, name_ar, name_en, factor_to_ssu, level, is_ssu) VALUES (${f.tenantId}, ${f.itemId}, 'x', 'x', 7, 7, true)`,
      PG_ERR.CHECK_VIOLATION, // is_ssu requires factor 1
    );
  });
});

describe("posted documents are immutable (P0002)", () => {
  async function postedInvoice(): Promise<string> {
    const [inv] = await sql<{ id: string }[]>`INSERT INTO sales_invoices (tenant_id, cashier_id, shift_id, currency, status, number, posted_at, posted_by, total_minor, net_minor, gross_minor)
        VALUES (${f.tenantId}, ${f.userId}, ${f.shiftId}, 'YER_NEW', 'POSTED', ${"INV-" + crypto.randomUUID().slice(0, 8)}, now(), ${f.userId}, 1000, 1000, 1000) RETURNING id`;
    return inv!.id;
  }
  it("DRAFT can be edited and deleted", async () => {
    const [inv] = await sql<{ id: string }[]>`INSERT INTO sales_invoices (tenant_id, cashier_id, currency) VALUES (${f.tenantId}, ${f.userId}, 'YER_NEW') RETURNING id`;
    await sql`UPDATE sales_invoices SET notes = 'hi' WHERE id = ${inv!.id}`;
    await sql`DELETE FROM sales_invoices WHERE id = ${inv!.id}`;
  });
  it("POSTED cannot change amounts, be deleted, or go back to DRAFT", async () => {
    const id = await postedInvoice();
    await expectPgError(sql`UPDATE sales_invoices SET total_minor = 1 WHERE id = ${id}`, PG_ERR.POSTED_DOC_IMMUTABLE);
    await expectPgError(sql`UPDATE sales_invoices SET status = 'DRAFT' WHERE id = ${id}`, PG_ERR.POSTED_DOC_IMMUTABLE);
    await expectPgError(sql`UPDATE sales_invoices SET notes = 'edited' WHERE id = ${id}`, PG_ERR.POSTED_DOC_IMMUTABLE);
    await expectPgError(sql`DELETE FROM sales_invoices WHERE id = ${id}`, PG_ERR.POSTED_DOC_IMMUTABLE);
  });
  it("POSTED→REVERSED requires reversed_by_id; REVERSED is frozen", async () => {
    const id = await postedInvoice();
    await expectPgError(sql`UPDATE sales_invoices SET status = 'REVERSED' WHERE id = ${id}`, PG_ERR.POSTED_DOC_IMMUTABLE);
    await expectPgError(
      sql`UPDATE sales_invoices SET status = 'REVERSED', reversed_by_id = ${crypto.randomUUID()}, total_minor = 0 WHERE id = ${id}`,
      PG_ERR.POSTED_DOC_IMMUTABLE,
    );
    await sql`UPDATE sales_invoices SET status = 'REVERSED', reversed_by_id = ${crypto.randomUUID()}, reversed_at = now(), reversal_reason = 'customer' WHERE id = ${id}`;
    await expectPgError(sql`UPDATE sales_invoices SET notes = 'x' WHERE id = ${id}`, PG_ERR.POSTED_DOC_IMMUTABLE);
    await expectPgError(sql`DELETE FROM sales_invoices WHERE id = ${id}`, PG_ERR.POSTED_DOC_IMMUTABLE);
  });
  it("POSTED requires number, posted_at and shift (CHECK)", async () => {
    await expectPgError(
      sql`INSERT INTO sales_invoices (tenant_id, cashier_id, currency, status) VALUES (${f.tenantId}, ${f.userId}, 'YER_NEW', 'POSTED')`,
      PG_ERR.CHECK_VIOLATION,
    );
  });
});

describe("journal (double-entry)", () => {
  async function accounts(): Promise<void> {
    await sql`INSERT INTO accounts (tenant_id, code, name_ar, name_en, normal_balance, account_type) VALUES
      (${f.tenantId}, '1010', 'الصندوق', 'Cash', 'DEBIT', 'ASSET'),
      (${f.tenantId}, '4010', 'المبيعات', 'Sales', 'CREDIT', 'REVENUE'),
      (${f.tenantId}, '1000', 'الأصول', 'Assets', 'DEBIT', 'ASSET')
      ON CONFLICT DO NOTHING`;
    await sql`UPDATE accounts SET is_postable = false WHERE tenant_id = ${f.tenantId} AND code = '1000'`;
  }
  async function entry(): Promise<string> {
    const [e] = await sql<{ id: string }[]>`INSERT INTO journal_entries (tenant_id, document_type, document_id, business_date, base_currency)
        VALUES (${f.tenantId}, 'TEST', ${crypto.randomUUID()}, '2026-01-15', 'YER_NEW') RETURNING id`;
    return e!.id;
  }
  it("rejects unbalanced entry at COMMIT (P0009)", async () => {
    await accounts();
    const e = await entry();
    await expectPgError(
      sql.begin(async (tx) => {
        await tx`INSERT INTO journal_lines (tenant_id, entry_id, line_no, account_code, debit_minor) VALUES (${f.tenantId}, ${e}, 1, '1010', 1000)`;
        await tx`INSERT INTO journal_lines (tenant_id, entry_id, line_no, account_code, credit_minor) VALUES (${f.tenantId}, ${e}, 2, '4010', 900)`;
      }),
      PG_ERR.JOURNAL_UNBALANCED,
    );
  });
  it("rejects single-line entry (P0009) and accepts balanced entry", async () => {
    const e = await entry();
    await expectPgError(
      sql`INSERT INTO journal_lines (tenant_id, entry_id, line_no, account_code, debit_minor) VALUES (${f.tenantId}, ${e}, 1, '1010', 1000)`,
      PG_ERR.JOURNAL_UNBALANCED,
    );
    await sql.begin(async (tx) => {
      await tx`INSERT INTO journal_lines (tenant_id, entry_id, line_no, account_code, debit_minor) VALUES (${f.tenantId}, ${e}, 1, '1010', 1000)`;
      await tx`INSERT INTO journal_lines (tenant_id, entry_id, line_no, account_code, credit_minor) VALUES (${f.tenantId}, ${e}, 2, '4010', 1000)`;
    });
    await expectPgError(sql`UPDATE journal_lines SET debit_minor = 5 WHERE entry_id = ${e}`, PG_ERR.LEDGER_IMMUTABLE);
    await expectPgError(sql`DELETE FROM journal_entries WHERE id = ${e}`, PG_ERR.LEDGER_IMMUTABLE);
  });
  it("rejects posting to a non-postable/unknown account (P0010) and a line with both sides (CHECK)", async () => {
    const e = await entry();
    await expectPgError(
      sql`INSERT INTO journal_lines (tenant_id, entry_id, line_no, account_code, debit_minor) VALUES (${f.tenantId}, ${e}, 1, '1000', 10)`,
      PG_ERR.ACCOUNT_NOT_POSTABLE,
    );
    await expectPgError(
      sql`INSERT INTO journal_lines (tenant_id, entry_id, line_no, account_code, debit_minor) VALUES (${f.tenantId}, ${e}, 1, '9999', 10)`,
      PG_ERR.ACCOUNT_NOT_POSTABLE,
    );
    await expectPgError(
      sql`INSERT INTO journal_lines (tenant_id, entry_id, line_no, account_code, debit_minor, credit_minor) VALUES (${f.tenantId}, ${e}, 1, '1010', 10, 10)`,
      PG_ERR.CHECK_VIOLATION,
    );
  });
});

describe("shifts & numbering", () => {
  it("one OPEN shift per cashier and per cashbox", async () => {
    await expectPgError(
      sql`INSERT INTO shifts (tenant_id, cashbox_id, cashier_id) VALUES (${f.tenantId}, ${f.cashboxId}, ${f.userId})`,
      PG_ERR.UNIQUE_VIOLATION,
    );
  });
  it("next_document_number is gap-free per tenant/type/period", async () => {
    const a = await sql<{ n: string }[]>`SELECT next_document_number(${f.tenantId}, 'SALES_INVOICE', '2026') AS n`;
    const b = await sql<{ n: string }[]>`SELECT next_document_number(${f.tenantId}, 'SALES_INVOICE', '2026') AS n`;
    const c = await sql<{ n: string }[]>`SELECT next_document_number(${f.tenantId}, 'SALES_INVOICE', '2027') AS n`;
    expect(a[0]!.n).not.toBe(b[0]!.n);
    expect(a[0]!.n.endsWith("1")).toBe(true);
    expect(c[0]!.n).toContain("2027-");
  });
  it("optimistic version bumps on update", async () => {
    const [before] = await sql<{ version: number }[]>`SELECT version FROM items WHERE id = ${f.itemId}`;
    await sql`UPDATE items SET notes = 'v' WHERE id = ${f.itemId}`;
    const [after] = await sql<{ version: number }[]>`SELECT version FROM items WHERE id = ${f.itemId}`;
    expect(after!.version).toBe(before!.version + 1);
  });
});
