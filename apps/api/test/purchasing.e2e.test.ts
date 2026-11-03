import { connect } from "@pharmacore/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootTestApp, DATABASE_URL, panadol, type TestCtx } from "./helpers.js";

describe("purchasing: suppliers → PO → GRN", () => {
  let c: TestCtx;
  let sql: ReturnType<typeof connect>;
  let itemId = "";
  let cartonId = "";
  let locationId = "";
  let supplierId = "";
  let poId = "";
  let poLineId = "";
  let grnId = "";

  const journalOf = async (docId: string) => {
    const lines = await sql<{ account_code: string; d: string; c: string }[]>`SELECT l.account_code, l.debit_minor::text AS d, l.credit_minor::text AS c
      FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id WHERE e.tenant_id = ${c.tenantId} AND e.document_id = ${docId}`;
    const sum = (f: "d" | "c") => lines.reduce((a, l) => a + BigInt(l[f]), 0n);
    const by = (acc: string, f: "d" | "c") => lines.filter((l) => l.account_code === acc).reduce((a, l) => a + BigInt(l[f]), 0n);
    return { lines, debit: sum("d"), credit: sum("c"), by };
  };

  beforeAll(async () => {
    c = await bootTestApp();
    sql = connect(DATABASE_URL, 1);
    const item = await c.call("POST", "/items", panadol());
    expect(item.status).toBe(201);
    itemId = item.body.id;
    const full = await c.call("GET", `/items/${itemId}`);
    cartonId = full.body.units.find((u: any) => u.name_en === "Carton").id;
    const [loc] = await sql<{ id: string }[]>`SELECT id FROM locations WHERE tenant_id = ${c.tenantId} ORDER BY code LIMIT 1`;
    locationId = loc!.id;
  });

  afterAll(async () => {
    await sql.end();
    await c.app.close();
  });

  it("creates a supplier with an auto code and zero AP balance", async () => {
    const r = await c.call("POST", "/suppliers", { name: "MedSupply Co", phone: "777000111", defaultCurrency: "YER_NEW", paymentTermsDays: 30 });
    expect(r.status).toBe(201);
    expect(r.body.code).toBe("S-1");
    expect(r.body.version).toBe(1);
    supplierId = r.body.id;
    const list = await c.call("GET", "/suppliers?q=Med");
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(1);
    const one = await c.call("GET", `/suppliers/${supplierId}`);
    expect(one.status).toBe(200);
    expect(one.body.apBalance).toEqual({ currency: "YER_NEW", amountMinor: "0" });
  });

  it("creates a DRAFT purchase order: 10 cartons @ 24,000.00 + 1 bonus carton", async () => {
    const r = await c.call("POST", "/purchase-orders", {
      supplierId, currency: "YER_NEW", expectedDate: "2026-03-05",
      lines: [{ itemId, unitId: cartonId, qtyInUnit: 10, unitCostMinor: "2400000", bonusQtyInUnit: 1 }],
    });
    expect(r.status).toBe(201);
    expect(r.body.status).toBe("DRAFT");
    expect(r.body.totals.total.amountMinor).toBe("24000000");
    expect(r.body.totals.totalBase.amountMinor).toBe("24000000");
    expect(r.body.lines).toHaveLength(1);
    expect(r.body.lines[0].unit.ssuQty).toBe("2400");
    expect(r.body.lines[0].expectedBonusSsu).toBe("240");
    poId = r.body.id;
    poLineId = r.body.lines[0].lineId;
    const got = await c.call("GET", `/purchase-orders/${poId}`);
    expect(got.status).toBe(200);
    expect(got.body.lines[0].id).toBe(poLineId);
    expect(got.body.totalMinor).toBe("24000000");
  });

  it("approves the PO (owner has purchase_orders.approve)", async () => {
    const r = await c.call("POST", `/purchase-orders/${poId}/approve`);
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("POSTED");
    const again = await c.call("POST", `/purchase-orders/${poId}/approve`);
    expect(again.status).toBe(422);
    const list = await c.call("GET", `/purchase-orders?supplierId=${supplierId}&status=POSTED`);
    expect(list.body.rows).toHaveLength(1);
  });

  it("posts a GRN for 10+1 cartons: one lot, bonus spreads cost, GRNI accrual, PO RECEIVED", async () => {
    const r = await c.call("POST", "/goods-receipts", {
      supplierId, purchaseOrderId: poId, locationId, currency: "YER_NEW", businessDate: "2026-03-01", invoiceRef: "INV-77",
      lines: [{ poLineId, itemId, unitId: cartonId, qtyInUnit: 10, bonusQtyInUnit: 1, unitCostMinor: "2400000", lotNumber: "P-2027", expiryDate: "2027-06-30" }],
    });
    expect(r.status).toBe(201);
    grnId = r.body.id;
    expect(r.body.status).toBe("POSTED");
    expect(r.body.warnings).toEqual([]);
    expect(r.body.lots).toHaveLength(1);
    expect(r.body.lots[0].qtyReceivedSsu).toBe("2640");
    expect(r.body.lots[0].totalCostMinor).toEqual({ currency: "YER_NEW", amountMinor: "24000000" });
    expect(r.body.lines[0].cost.unitCostBase.amountMinor).toBe("9091");
    expect(r.body.po).toEqual({ id: poId, status: "RECEIVED" });

    const lots = await sql<{ lot_number: string; q: string; cost: string; cost_currency: string; source_document_type: string }[]>`
      SELECT lot_number, qty_received_ssu::text AS q, total_cost_minor::text AS cost, cost_currency, source_document_type FROM lots WHERE tenant_id = ${c.tenantId} AND item_id = ${itemId}`;
    expect(lots).toHaveLength(1);
    expect(lots[0]).toMatchObject({ lot_number: "P-2027", q: "2640", cost: "24000000", cost_currency: "YER_NEW", source_document_type: "GOODS_RECEIPT" });

    const [bal] = await sql<{ q: string }[]>`SELECT COALESCE(SUM(qty_delta_ssu), 0)::text AS q FROM stock_movements WHERE tenant_id = ${c.tenantId} AND item_id = ${itemId}`;
    expect(bal!.q).toBe("2640");
    const [mv] = await sql<{ t: string; snap: string; doc: string }[]>`SELECT movement_type AS t, unit_cost_minor_snapshot::text AS snap, document_type AS doc FROM stock_movements WHERE document_id = ${grnId}`;
    expect(mv).toEqual({ t: "RECEIPT", snap: "9091", doc: "GOODS_RECEIPT" });

    const j = await journalOf(grnId);
    expect(j.lines).toHaveLength(2);
    expect(j.debit).toBe(24000000n);
    expect(j.credit).toBe(24000000n);
    expect(j.by("1400", "d")).toBe(24000000n);
    expect(j.by("2150", "c")).toBe(24000000n);

    const po = await c.call("GET", `/purchase-orders/${poId}`);
    expect(po.body.status).toBe("RECEIVED");
    expect(po.body.lines[0].receivedSsu).toBe("2400");

    const got = await c.call("GET", `/goods-receipts/${grnId}`);
    expect(got.status).toBe(200);
    expect(got.body.status).toBe("POSTED");
    expect(got.body.lines).toHaveLength(1);
    expect(got.body.lines[0].ssu_qty_total).toBe("2640");

    const sup = await c.call("GET", `/suppliers/${supplierId}`);
    expect(sup.body.apBalance.amountMinor).toBe("0");

    const again = await c.call("POST", "/goods-receipts", {
      supplierId, purchaseOrderId: poId, locationId, currency: "YER_NEW", businessDate: "2026-03-02",
      lines: [{ poLineId, itemId, unitId: cartonId, qtyInUnit: 1, unitCostMinor: "2400000", lotNumber: "P-2027B", expiryDate: "2027-06-30" }],
    });
    expect(again.status).toBe(422);
    expect(again.body.error.code).toBe("po.not_receivable");
  });

  it("converts a SAR receipt to base at the posted rate (1 SAR = 140 YER_NEW)", async () => {
    const fx = await c.call("POST", "/exchange-rates", { from: "SAR", to: "YER_NEW", buyRateScaled: "140000000", sellRateScaled: "140000000", effectiveFrom: "2026-01-01T00:00:00.000Z" });
    expect([200, 201]).toContain(fx.status);
    const r = await c.call("POST", "/goods-receipts", {
      supplierId, locationId, currency: "SAR", businessDate: "2026-03-01",
      lines: [{ itemId, unitId: cartonId, qtyInUnit: 1, unitCostMinor: "100000", lotNumber: "S-2027", expiryDate: "2027-06-30" }],
    });
    expect(r.status).toBe(201);
    expect(r.body.currency).toBe("SAR");
    expect(r.body.rateScaledSnapshot).toBe("140000000");
    expect(r.body.totalMinor).toBe("100000");
    expect(r.body.lots[0].totalCostMinor).toEqual({ currency: "YER_NEW", amountMinor: "14000000" });
    expect(r.body.lots[0].qtyReceivedSsu).toBe("240");
    const j = await journalOf(r.body.id);
    expect(j.debit).toBe(j.credit);
    expect(j.by("1400", "d")).toBe(14000000n);
    expect(j.by("2150", "c")).toBe(14000000n);
    const [bal] = await sql<{ q: string }[]>`SELECT COALESCE(SUM(qty_delta_ssu), 0)::text AS q FROM stock_movements WHERE tenant_id = ${c.tenantId} AND item_id = ${itemId}`;
    expect(bal!.q).toBe("2880");
  });

  it("warns about short shelf life without blocking the receipt", async () => {
    const r = await c.call("POST", "/goods-receipts", {
      supplierId, locationId, currency: "YER_NEW", businessDate: "2026-03-01",
      lines: [{ itemId, unitId: cartonId, qtyInUnit: 1, unitCostMinor: "2400000", lotNumber: "SHORT-1", expiryDate: "2026-03-10" }],
    });
    expect(r.status).toBe(201);
    expect(r.body.warnings.map((w: any) => w.code)).toContain("SHORT_SHELF_LIFE");
    const expired = await c.call("POST", "/goods-receipts", {
      supplierId, locationId, currency: "YER_NEW", businessDate: "2026-03-01",
      lines: [{ itemId, unitId: cartonId, qtyInUnit: 1, unitCostMinor: "2400000", lotNumber: "DEAD-1", expiryDate: "2026-02-01" }],
    });
    expect(expired.status).toBe(422);
    expect(expired.body.error.code).toBe("grn.expired_at_receipt");
  });

  it("suggests reorder quantities and rejects stale supplier updates", async () => {
    const s = await c.call("GET", `/purchase-orders/reorder-suggestions?itemId=${itemId}`);
    expect(s.status).toBe(200);
    expect(s.body.reason).toBe("ABOVE_REORDER_POINT");
    expect(s.body.unitId).toBe(cartonId);
    const bad = await c.call("PATCH", `/suppliers/${supplierId}`, { version: 99, phone: "711111111" });
    expect(bad.status).toBe(409);
    expect(bad.body.error.code).toBe("conflict.version");
    const ok = await c.call("PATCH", `/suppliers/${supplierId}`, { version: 1, phone: "711111111" });
    expect(ok.status).toBe(200);
    expect(ok.body.phone).toBe("711111111");
    expect(ok.body.version).toBe(2);
  });
});
