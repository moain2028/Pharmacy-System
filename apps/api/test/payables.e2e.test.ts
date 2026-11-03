import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connect } from "@pharmacore/db";
import type { Sql } from "@pharmacore/db";
import { bootTestApp, DATABASE_URL, panadol } from "./helpers.js";
import type { TestCtx } from "./helpers.js";

interface Fixture { supplierId: string; lotId: string; grnLineId: string; invoiceNo: string }
interface LedgerItem { id: string; kind: string; remaining: { currency: string; amountMinor: string } }

describe("payables posting", () => {
  let c: TestCtx;
  let sql: Sql;
  let itemId: string;
  let boxId: string;
  let locationId: string;
  let registerId: string;
  let ownerId: string;

  beforeAll(async () => {
    c = await bootTestApp({ baseCurrency: "YER_NEW" });
    sql = connect(DATABASE_URL, 1);
    const item = await c.call("POST", "/items", panadol());
    expect(item.status, JSON.stringify(item.body)).toBe(201);
    itemId = item.body.id as string;
    const units = await sql<{ id: string; name_en: string }[]>`SELECT id, name_en FROM item_units WHERE tenant_id = ${c.tenantId} AND item_id = ${itemId}`;
    const box = units.find((u) => u.name_en === "Box");
    if (!box) throw new Error("Box unit missing");
    boxId = box.id;
    const [location] = await sql<{ id: string }[]>`SELECT id FROM locations WHERE tenant_id = ${c.tenantId} AND code = 'MAIN'`;
    const [register] = await sql<{ id: string }[]>`SELECT id FROM cashboxes WHERE tenant_id = ${c.tenantId} AND code = 'REG1'`;
    const [owner] = await sql<{ id: string }[]>`SELECT id FROM users WHERE tenant_id = ${c.tenantId} AND username = 'owner'`;
    if (!location || !register || !owner) throw new Error("Setup fixture missing");
    locationId = location.id;
    registerId = register.id;
    ownerId = owner.id;
  }, 120000);

  afterAll(async () => {
    if (sql) await sql.end();
    if (c) await c.app.close();
  });

  async function fixture(label: string): Promise<Fixture> {
    const supplierId = randomUUID();
    await sql`INSERT INTO suppliers (id, tenant_id, code, name, default_currency)
      VALUES (${supplierId}, ${c.tenantId}, ${label}, ${`مورد ${label}`}, 'YER_NEW')`;
    const lotNumber = `PAY-${label}`;
    const receipt = await c.call("POST", "/inventory/receipts", {
      itemId, locationId, unitId: boxId, qtyInUnit: 10, lotNumber, expiryDate: "2028-12-31",
      unitCostMinor: "120000", costCurrency: "YER_NEW", businessDate: "2026-01-01",
    });
    expect(receipt.status, JSON.stringify(receipt.body)).toBe(201);
    const lotId = receipt.body.lotId as string;
    const [lot] = await sql<{ total_cost_minor: string; qty_received_ssu: string }[]>`
      SELECT total_cost_minor, qty_received_ssu FROM lots WHERE id = ${lotId}`;
    expect(lot).toMatchObject({ total_cost_minor: "1200000", qty_received_ssu: "240" });
    const grnId = randomUUID();
    const grnLineId = randomUUID();
    // Write lines while DRAFT, then post: posted-document child triggers remain enabled.
    await sql`INSERT INTO goods_receipts (id, tenant_id, number, status, supplier_id, location_id, currency, business_date, total_minor, created_by)
      VALUES (${grnId}, ${c.tenantId}, ${`GRN-${label}`}, 'DRAFT', ${supplierId}, ${locationId}, 'YER_NEW', '2026-01-01', '1200000', ${ownerId})`;
    await sql`INSERT INTO goods_receipt_lines (id, tenant_id, receipt_id, line_no, item_id, unit_id, factor_snapshot,
      qty_in_unit, bonus_qty_in_unit, ssu_qty_total, unit_cost_minor, lot_number, expiry_date, source_type, lot_id)
      VALUES (${grnLineId}, ${c.tenantId}, ${grnId}, 1, ${itemId}, ${boxId}, 24, 10, 0, 240, 120000, ${lotNumber}, '2028-12-31', 'OFFICIAL', ${lotId})`;
    await sql`UPDATE goods_receipts SET status = 'POSTED', posted_at = now(), posted_by = ${ownerId} WHERE id = ${grnId}`;
    return { supplierId, lotId, grnLineId, invoiceNo: `SI-${label}` };
  }

  function invoice(f: Fixture, price = "120000") {
    return { supplierId: f.supplierId, supplierInvoiceNo: f.invoiceNo, invoiceDate: "2026-01-02", currency: "YER_NEW",
      lines: [{ grnLineId: f.grnLineId, itemId, unitId: boxId, qtyInUnit: 10, unitCostMinor: price }] };
  }

  async function journal(id: string, expected: Record<string, { debit: string; credit: string }>) {
    const entries = await sql<{ id: string }[]>`SELECT id FROM journal_entries WHERE tenant_id = ${c.tenantId} AND document_id = ${id}`;
    expect(entries).toHaveLength(1);
    const entry = entries[0];
    if (!entry) throw new Error("Journal entry missing");
    const lines = await sql<{ account_code: string; debit: string; credit: string }[]>`
      SELECT account_code, SUM(debit_minor)::text AS debit, SUM(credit_minor)::text AS credit
      FROM journal_lines WHERE tenant_id = ${c.tenantId} AND entry_id = ${entry.id} GROUP BY account_code ORDER BY account_code`;
    expect(Object.fromEntries(lines.map((l) => [l.account_code, { debit: l.debit, credit: l.credit }]))).toEqual(expected);
    const debit = lines.reduce((n, l) => n + BigInt(l.debit), 0n);
    const credit = lines.reduce((n, l) => n + BigInt(l.credit), 0n);
    expect(debit.toString()).toBe(credit.toString());
  }

  it("matches at receipt cost; serializes duplicate supplier invoice numbers", async () => {
    const f = await fixture("MATCH");
    const request = invoice(f);
    const results = await Promise.all([c.call("POST", "/supplier-invoices", request), c.call("POST", "/supplier-invoices", request)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const posted = results.find((r) => r.status === 201);
    const duplicate = results.find((r) => r.status === 409);
    if (!posted || !duplicate) throw new Error("Unexpected posting results");
    expect(duplicate.body.error.code).toBe("supplier_invoices.duplicate_number");
    expect(posted.body.matchStatus).toBe("MATCHED");
    expect(posted.body.totals.total).toEqual({ currency: "YER_NEW", amountMinor: "1200000" });
    await journal(posted.body.id as string, { "2150": { debit: "1200000", credit: "0" }, "2100": { debit: "0", credit: "1200000" } });
    const get = await c.call("GET", `/supplier-invoices/${posted.body.id}`);
    expect(get.status).toBe(200);
    expect(get.body.invoice.total_minor).toBe("1200000");
    expect(get.body.lines).toHaveLength(1);
    expect(get.body.lines[0].amount_minor).toBe("1200000");
    const list = await c.call("GET", `/supplier-invoices?supplierId=${f.supplierId}&from=2026-01-01&to=2026-12-31`);
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(1);
    const [count] = await sql<{ n: string }[]>`SELECT count(*)::text AS n FROM supplier_invoices
      WHERE tenant_id = ${c.tenantId} AND supplier_id = ${f.supplierId} AND supplier_invoice_no = ${f.invoiceNo}`;
    expect(count?.n).toBe("1");
  });

  it("requires match elevation, books variance without changing lot cost, returns stock and pays FIFO", async () => {
    const f = await fixture("VARIANCE");
    const request = invoice(f, "125000");
    const denied = await c.call("POST", "/supplier-invoices", request);
    expect(denied.status).toBe(422);
    expect(denied.body.error.code).toBe("supinv.over_tolerance");
    const [none] = await sql<{ n: string }[]>`SELECT count(*)::text AS n FROM supplier_invoices WHERE supplier_id = ${f.supplierId}`;
    expect(none?.n).toBe("0");
    const posted = await c.call("POST", "/supplier-invoices", {
      ...request, approver: { username: "owner", secret: "Str0ngPass!" }, reason: "Approved supplier price increase",
    });
    expect(posted.status, JSON.stringify(posted.body)).toBe(201);
    expect(posted.body.approvedBy).toBe(ownerId);
    expect(posted.body.totals.total.amountMinor).toBe("1250000");
    expect(posted.body.priceVariances[0].varianceBase.amountMinor).toBe("50000");
    await journal(posted.body.id as string, {
      "2150": { debit: "1200000", credit: "0" }, "5150": { debit: "50000", credit: "0" }, "2100": { debit: "0", credit: "1250000" },
    });
    const [unchanged] = await sql<{ total_cost_minor: string; qty_received_ssu: string }[]>`
      SELECT total_cost_minor, qty_received_ssu FROM lots WHERE id = ${f.lotId}`;
    expect(unchanged).toMatchObject({ total_cost_minor: "1200000", qty_received_ssu: "240" });
    const [audit] = await sql<{ approved_by: string; after_data: unknown }[]>`
      SELECT approved_by, after_data FROM audit_log WHERE entity_id = ${posted.body.id} AND action = 'supplier_invoices.post'`;
    expect(audit?.approved_by).toBe(ownerId);
    expect(JSON.stringify(audit?.after_data)).not.toContain("Str0ngPass!");

    const excessive = await c.call("POST", "/purchase-returns", {
      supplierId: f.supplierId, locationId, businessDate: "2026-01-03", reason: "DAMAGED", lines: [{ lotId: f.lotId, qtySsu: "241" }],
    });
    expect(excessive.status).toBe(422);
    expect(excessive.body.error.code).toBe("purchase_return.qty_exceeds_available");
    const returned = await c.call("POST", "/purchase-returns", {
      supplierId: f.supplierId, locationId, businessDate: "2026-01-03", reason: "DAMAGED", lines: [{ lotId: f.lotId, qtySsu: "48" }],
    });
    expect(returned.status, JSON.stringify(returned.body)).toBe(201);
    expect(returned.body.totals.cost.amountMinor).toBe("240000");
    expect(returned.body.totals.creditBase.amountMinor).toBe("240000");
    await journal(returned.body.id as string, { "2100": { debit: "240000", credit: "0" }, "1400": { debit: "0", credit: "240000" } });
    const [movement] = await sql<{ qty_delta_ssu: string; unit_cost_minor_snapshot: string }[]>`
      SELECT qty_delta_ssu, unit_cost_minor_snapshot FROM stock_movements
      WHERE tenant_id = ${c.tenantId} AND document_id = ${returned.body.id} AND movement_type = 'PURCHASE_RETURN'`;
    expect(movement).toMatchObject({ qty_delta_ssu: "-48", unit_cost_minor_snapshot: "5000" });
    const [stock] = await sql<{ qty_ssu: string }[]>`SELECT qty_ssu::text FROM stock_balances WHERE lot_id = ${f.lotId} AND location_id = ${locationId}`;
    expect(stock?.qty_ssu).toBe("192");

    const payment = { supplierId: f.supplierId, cashboxId: registerId, method: "CASH", currency: "YER_NEW",
      amountMinor: "1000000", businessDate: "2026-01-04", allocation: { mode: "FIFO" }, reference: "Supplier cash settlement" };
    const closed = await c.call("POST", "/supplier-payments", payment);
    expect(closed.status).toBe(409);
    expect(closed.body.error.code).toBe("shifts.open_required");
    const shift = await c.call("POST", "/shifts/open", { cashboxId: registerId, openingFloat: [{ currency: "YER_NEW", amountMinor: "3000000" }] });
    expect(shift.status, JSON.stringify(shift.body)).toBe(201);
    const paid = await c.call("POST", "/supplier-payments", payment);
    expect(paid.status, JSON.stringify(paid.body)).toBe(201);
    expect(paid.body.allocatedTotal.amountMinor).toBe("1000000");
    expect(paid.body.unallocated.amountMinor).toBe("0");
    expect(paid.body.allocations).toEqual([{
      documentType: "SUPPLIER_INVOICE", documentId: posted.body.id, amountMinor: "1000000",
      cashAmountMinor: "1000000", discountMinor: "0", payableBaseMinor: "1000000",
    }]);
    await journal(paid.body.id as string, { "2100": { debit: "1000000", credit: "0" }, "1100": { debit: "0", credit: "1000000" } });
    const [cash] = await sql<{ amount_minor: string; kind: string; shift_id: string }[]>`
      SELECT amount_minor, kind, shift_id FROM cash_movements WHERE tenant_id = ${c.tenantId} AND document_id = ${paid.body.id}`;
    expect(cash).toMatchObject({ amount_minor: "-1000000", kind: "SUPPLIER_PAYMENT", shift_id: shift.body.id });
    const [saved] = await sql<{ allocations: unknown; status: string }[]>`SELECT allocations, status FROM party_payments WHERE id = ${paid.body.id}`;
    expect(saved?.status).toBe("POSTED");
    expect(saved?.allocations).toEqual(paid.body.allocations);
    const ledger = await c.call("GET", `/suppliers/${f.supplierId}/ledger`);
    expect(ledger.status).toBe(200);
    const items = ledger.body.items as LedgerItem[];
    expect(items.find((i) => i.id === posted.body.id)?.remaining.amountMinor).toBe("250000");
    expect(items.find((i) => i.id === returned.body.id)?.remaining.amountMinor).toBe("240000");
    expect(ledger.body.balances).toEqual([{
      currency: "YER_NEW", payable: { currency: "YER_NEW", amountMinor: "250000" },
      credits: { currency: "YER_NEW", amountMinor: "240000" }, net: { currency: "YER_NEW", amountMinor: "10000" },
    }]);
    expect(ledger.body.aging[0].net.amountMinor).toBe("10000");
  });

  it("uses supplier early-payment terms and persists discount settlement, not just cash", async () => {
    const f = await fixture("DISCOUNT");
    await sql`UPDATE suppliers SET early_payment_days = 10, early_payment_bp = 200 WHERE id = ${f.supplierId}`;
    const posted = await c.call("POST", "/supplier-invoices", invoice(f));
    expect(posted.status, JSON.stringify(posted.body)).toBe(201);
    const [safe] = await sql<{ id: string }[]>`SELECT id FROM cashboxes WHERE tenant_id = ${c.tenantId} AND code = 'SAFE'`;
    if (!safe) throw new Error("Safe missing");
    const funded = await c.call("POST", "/cash/movements", {
      cashboxId: safe.id, kind: "CAPITAL", currency: "YER_NEW", amountMinor: "1200000", reason: "Test supplier payment funding",
    });
    expect(funded.status, JSON.stringify(funded.body)).toBe(201);
    const paid = await c.call("POST", "/supplier-payments", { supplierId: f.supplierId, cashboxId: safe.id,
      method: "CASH", currency: "YER_NEW", amountMinor: "1176000", businessDate: "2026-01-05", allocation: { mode: "FIFO" } });
    expect(paid.status, JSON.stringify(paid.body)).toBe(201);
    expect(paid.body.discountTotal.amountMinor).toBe("24000");
    expect(paid.body.allocations[0].amountMinor).toBe("1200000");
    expect(paid.body.allocations[0].cashAmountMinor).toBe("1176000");
    await journal(paid.body.id as string, {
      "2100": { debit: "1200000", credit: "0" }, "1100": { debit: "0", credit: "1176000" }, "4300": { debit: "0", credit: "24000" },
    });
    const ledger = await c.call("GET", `/suppliers/${f.supplierId}/ledger`);
    expect(ledger.status).toBe(200);
    expect((ledger.body.items as LedgerItem[]).find((i) => i.id === posted.body.id)?.remaining.amountMinor).toBe("0");
    expect(ledger.body.balances[0].net.amountMinor).toBe("0");
  });

  it("enforces permissions before reaching posting logic", async () => {
    // Re-sign the existing test token with no permissions, retaining all issuer/audience/session claims.
    const [header, payload] = c.access.split(".");
    if (!header || !payload) throw new Error("Invalid test access token");
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
    claims["perms"] = [];
    const unsigned = `${header}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}`;
    const signature = createHmac("sha256", "test-secret-test-secret-test-secret-1234").update(unsigned).digest("base64url");
    const response = await c.call("POST", "/supplier-payments", {}, `${unsigned}.${signature}`);
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("auth.permission_denied");
  });
});
