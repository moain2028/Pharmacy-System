import { connect, migrate, resetDatabase, type Sql } from "../src/migrate.js";

export const TEST_URL =
  process.env["DATABASE_URL"] ?? "postgres://pharmacore:pharmacore@localhost:5432/pharmacore_test";

export interface Fixture {
  tenantId: string;
  userId: string;
  itemId: string;
  ssuUnitId: string;
  boxUnitId: string;
  locationId: string;
  cashboxId: string;
  shiftId: string;
  supplierId: string;
}

/** Fresh schema for the whole test file (superuser/owner connection bypasses RLS). */
export async function freshDb(): Promise<Sql> {
  const sql = connect(TEST_URL, 4);
  await resetDatabase(sql, { allowDestructive: true });
  await migrate(sql);
  return sql;
}

export async function seed(sql: Sql, suffix = "A", baseCurrency = "YER_NEW"): Promise<Fixture> {
  const [t] = await sql<{ id: string }[]>`INSERT INTO tenants (name_ar, name_en, base_currency)
      VALUES (${"صيدلية " + suffix}, ${"Pharmacy " + suffix}, ${baseCurrency}::currency_code) RETURNING id`;
  const tenantId = t!.id;
  const [u] = await sql<{ id: string }[]>`INSERT INTO users (tenant_id, username, display_name, password_hash)
      VALUES (${tenantId}, ${"admin" + suffix}, 'Admin', 'x') RETURNING id`;
  const [it] = await sql<{ id: string }[]>`INSERT INTO items (tenant_id, item_code, trade_name_ar, trade_name_en, generic_name)
      VALUES (${tenantId}, ${"PANADOL-" + suffix}, 'بنادول', 'Panadol', 'Paracetamol') RETURNING id`;
  const itemId = it!.id;
  const [ssu] = await sql<{ id: string }[]>`INSERT INTO item_units (tenant_id, item_id, name_ar, name_en, factor_to_ssu, level, is_ssu, is_default_sale)
      VALUES (${tenantId}, ${itemId}, 'شريط', 'Strip', 1, 3, true, true) RETURNING id`;
  const [box] = await sql<{ id: string }[]>`INSERT INTO item_units (tenant_id, item_id, name_ar, name_en, factor_to_ssu, level, is_default_purchase)
      VALUES (${tenantId}, ${itemId}, 'علبة', 'Box', 10, 2, true) RETURNING id`;
  const [loc] = await sql<{ id: string }[]>`INSERT INTO locations (tenant_id, code, name_ar, name_en)
      VALUES (${tenantId}, 'MAIN', 'الرف الرئيسي', 'Main shelf') RETURNING id`;
  const [cb] = await sql<{ id: string }[]>`INSERT INTO cashboxes (tenant_id, code, name_ar, name_en)
      VALUES (${tenantId}, 'REG1', 'الصندوق 1', 'Register 1') RETURNING id`;
  const [sh] = await sql<{ id: string }[]>`INSERT INTO shifts (tenant_id, cashbox_id, cashier_id)
      VALUES (${tenantId}, ${cb!.id}, ${u!.id}) RETURNING id`;
  const [sup] = await sql<{ id: string }[]>`INSERT INTO suppliers (tenant_id, code, name)
      VALUES (${tenantId}, 'SUP1', 'Supplier 1') RETURNING id`;
  return {
    tenantId,
    userId: u!.id,
    itemId,
    ssuUnitId: ssu!.id,
    boxUnitId: box!.id,
    locationId: loc!.id,
    cashboxId: cb!.id,
    shiftId: sh!.id,
    supplierId: sup!.id,
  };
}

export async function receiveLot(
  sql: Sql,
  f: Fixture,
  opts: { lotNumber?: string; expiry?: string | null; qty?: number; unitId?: string } = {},
): Promise<string> {
  const qty = opts.qty ?? 100;
  const expiry = opts.expiry === undefined ? "2030-01-01" : opts.expiry;
  const [lot] = await sql<{ id: string }[]>`INSERT INTO lots
      (tenant_id, item_id, lot_number, expiry_date, qty_received_ssu, total_cost_minor, cost_currency, supplier_id)
      VALUES (${f.tenantId}, ${f.itemId}, ${opts.lotNumber ?? "L1"}, ${expiry}, ${qty}, ${qty * 500}, 'YER_NEW', ${f.supplierId}) RETURNING id`;
  const docId = crypto.randomUUID();
  await sql`INSERT INTO stock_movements
      (tenant_id, item_id, lot_id, location_id, movement_type, qty_delta_ssu, unit_cost_minor_snapshot, cost_currency, unit_id, factor_snapshot, qty_in_unit, document_type, document_id, business_date, created_by)
      VALUES (${f.tenantId}, ${f.itemId}, ${lot!.id}, ${f.locationId}, 'RECEIPT', ${qty}, 500, 'YER_NEW', ${opts.unitId ?? null}, ${opts.unitId ? 10 : null}, ${opts.unitId ? qty / 10 : null}, 'GOODS_RECEIPT', ${docId}, '2026-01-10', ${f.userId})`;
  return lot!.id;
}

export async function sale(sql: Sql, f: Fixture, lotId: string, qty: number, businessDate = "2026-01-15"): Promise<void> {
  await sql`INSERT INTO stock_movements
      (tenant_id, item_id, lot_id, location_id, movement_type, qty_delta_ssu, unit_cost_minor_snapshot, cost_currency, document_type, document_id, business_date, created_by)
      VALUES (${f.tenantId}, ${f.itemId}, ${lotId}, ${f.locationId}, 'SALE', ${-qty}, 500, 'YER_NEW', 'SALES_INVOICE', ${crypto.randomUUID()}, ${businessDate}, ${f.userId})`;
}

/** Asserts a promise rejects with the given SQLSTATE; returns the error message. */
export async function expectPgError(p: Promise<unknown>, code: string): Promise<string> {
  try {
    await p;
  } catch (e) {
    const err = e as { code?: string; message?: string };
    if (err.code !== code) {
      throw new Error(`expected SQLSTATE ${code} but got ${err.code ?? "none"}: ${err.message ?? String(e)}`);
    }
    return err.message ?? "";
  }
  throw new Error(`expected SQLSTATE ${code} but statement succeeded`);
}
