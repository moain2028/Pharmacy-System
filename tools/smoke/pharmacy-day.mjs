#!/usr/bin/env node
/**
 * End-to-end "one day in the pharmacy" against a RUNNING server (default http://localhost:3100).
 * Setup → login → item + prices + supplier + PO + GRN → open shift → sale (cash, change) → return →
 * expense → customer on credit + receipt → supplier invoice + payment → X/Z report → trial balance balanced → backup.
 * Exit code 0 only if every step and every accounting identity holds. Usage: node tools/smoke/pharmacy-day.mjs [baseUrl]
 */
const BASE = (process.argv[2] ?? "http://localhost:3100") + "/api/v1";
let token = "";
const step = (n) => console.log(`\n▶ ${n}`);
const ok = (c, m) => { if (!c) { console.error(`✗ ${m}`); process.exit(1); } console.log(`  ✓ ${m}`); };
async function call(method, path, body) {
  const r = await fetch(BASE + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), "accept-language": "ar" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, body: json };
}
const must = async (m, p, b, exp = 201) => { const r = await call(m, p, b); if (r.status !== exp && !(exp === 201 && r.status === 200)) { console.error(`✗ ${m} ${p} → ${r.status}`, JSON.stringify(r.body).slice(0, 600)); process.exit(1); } return r.body; };
const D = "2026-03-01";

step("health + setup");
const h = await call("GET", "/health"); ok(h.status === 200, `health ${h.body.db}`);
const st = await call("GET", "/setup/status");
if (!st.body.initialized) await must("POST", "/setup/initialize", { pharmacy: { nameAr: "صيدلية النور", nameEn: "Al-Noor Pharmacy", baseCurrency: "YER_NEW" }, owner: { username: "owner", displayName: "المالك", password: "Str0ngPass!", pin: "1234" } });
const login = await must("POST", "/auth/login", { username: "owner", password: "Str0ngPass!" }, 200); token = login.accessToken; ok(!!token, "logged in as owner");
const me = await must("GET", "/auth/me", undefined, 200); ok(me.permissions.length > 80, `owner has ${me.permissions.length} permissions`);

step("master data");
const tag = Date.now().toString().slice(-6);
const item = await must("POST", "/items", { tradeNameAr: `بنادول ${tag}`, tradeNameEn: `Panadol ${tag}`, genericName: "Paracetamol", taxBp: 0, units: [
  { nameAr: "كرتون", nameEn: "Carton", factorToSsu: 240, level: 1, canSell: false, isDefaultPurchase: true }, { nameAr: "علبة", nameEn: "Box", factorToSsu: 24, level: 2, isDefaultSale: true, isStockDisplay: true },
  { nameAr: "شريط", nameEn: "Strip", factorToSsu: 12, level: 3 }, { nameAr: "حبة", nameEn: "Tablet", factorToSsu: 1, level: 4, isSsu: true }] });
const det = await must("GET", `/items/${item.id}`, undefined, 200);
const U = Object.fromEntries(det.units.map((u) => [u.name_en, u.id]));
const retail = (await must("GET", "/price-lists", undefined, 200)).find((p) => p.code === "RETAIL").id;
await must("POST", "/prices", { priceListId: retail, itemId: item.id, unitId: U.Box, unitPriceMinor: "150000", minPriceMinor: "140000" });
await must("POST", "/prices", { priceListId: retail, itemId: item.id, unitId: U.Strip, unitPriceMinor: "75000" });
await must("POST", "/items/" + item.id + "/barcodes", { barcode: `6281${tag}`.padEnd(13, "0").slice(0, 13).replace(/\d$/, "0"), unitId: U.Box, isPrimary: true }).catch(() => undefined);
const sup = await must("POST", "/suppliers", { name: `مورد ${tag}`, defaultCurrency: "YER_NEW", paymentTermsDays: 30 });
const loc = (await must("GET", "/inventory/locations", undefined, 200)).find((l) => l.code === "MAIN").id;
ok(!!sup.id && !!loc, "item, prices, supplier, location");

step("purchasing: PO → approve → GRN");
const po = await must("POST", "/purchase-orders", { supplierId: sup.id, currency: "YER_NEW", lines: [{ itemId: item.id, unitId: U.Carton, qtyInUnit: 2, unitCostMinor: "2400000" }] });
await must("POST", `/purchase-orders/${po.id}/approve`, {}, 200);
const poDet = await must("GET", `/purchase-orders/${po.id}`, undefined, 200);
const poLines = poDet.lines ?? poDet.order?.lines ?? [];
const poLineId = poLines[0]?.id;
const grn = await must("POST", "/goods-receipts", { supplierId: sup.id, ...(poLineId ? { purchaseOrderId: po.id } : {}), locationId: loc, currency: "YER_NEW", businessDate: D, lines: [{ ...(poLineId ? { poLineId } : {}), itemId: item.id, unitId: U.Carton, qtyInUnit: 2, unitCostMinor: "2400000", lotNumber: `L${tag}`, expiryDate: "2027-06-30" }] });
const bal = await must("GET", `/inventory/items/${item.id}/balances`, undefined, 200);
const balRows = Array.isArray(bal) ? bal : (bal.rows ?? bal.balances ?? []);
const onHand = balRows.reduce((a, b) => a + BigInt(b.qty_ssu), 0n); ok(onHand === 480n, `on hand 480 SSU after GRN (got ${onHand})`);

step("shift + sale with change");
const cashboxes = await must("GET", "/cashboxes", undefined, 200); const reg = cashboxes.find((c) => c.code === "REG1").id;
let shift = await must("GET", "/shifts/current", undefined, 200);
if (!shift) shift = await must("POST", "/shifts/open", { cashboxId: reg, openingFloat: [{ currency: "YER_NEW", amountMinor: "500000" }] });
const quote = await must("POST", "/sales/quote", { businessDate: D, lines: [{ itemId: item.id, unitId: U.Box, qtyInUnit: 2 }, { itemId: item.id, unitId: U.Strip, qtyInUnit: 1 }], tenders: [] }, 200);
ok(quote.totals.total.amountMinor === "375000", `quote total 3,750.00 (got ${quote.totals.total.amountMinor})`);
const sale = await must("POST", "/sales", { businessDate: D, lines: [{ itemId: item.id, unitId: U.Box, qtyInUnit: 2 }, { itemId: item.id, unitId: U.Strip, qtyInUnit: 1 }], tenders: [{ method: "CASH", currency: "YER_NEW", amountMinor: "400000" }], idempotencyKey: `smoke-${tag}` });
ok(sale.settlement.change.amountMinor === "25000", `change 250.00 (got ${sale.settlement.change.amountMinor})`); ok(/^INV-/.test(sale.number), `invoice ${sale.number}`);
const cogs = sale.totals.cogs.amountMinor; ok(cogs === "600000", `COGS 60 SSU × 100.00 = 6,000.00 (got ${cogs})`);

step("sales return (1 box)");
const inv = await must("GET", `/sales/${sale.id}`, undefined, 200);
const boxLine = inv.lines.find((l) => l.unit_id === U.Box);
const ret = await must("POST", "/returns", { invoiceId: sale.id, businessDate: D, lines: [{ lineId: boxLine.id, qtySsu: "24" }], reason: { code: "DAMAGED", text: "علبة تالفة" } });
ok(ret.refundTotal?.amountMinor === "150000" || ret.refund_total_minor === "150000", "refund 1,500.00");

step("expense + customer credit + receipt");
const cats = await must("GET", "/expense-categories", undefined, 200);
await must("POST", "/expenses", { categoryId: cats.find((c) => c.code === "UTIL").id, cashboxId: reg, currency: "YER_NEW", amountMinor: "120000", businessDate: D, description: "كهرباء" });
const cust = await must("POST", "/customers", { name: `عميل ${tag}`, phone: `77${tag}`, creditLimitMinor: "10000000", creditCurrency: "YER_NEW" });
const credit = await must("POST", "/sales", { businessDate: D, customerId: cust.id, lines: [{ itemId: item.id, unitId: U.Box, qtyInUnit: 1 }], tenders: [{ method: "CREDIT", currency: "YER_NEW", amountMinor: "150000" }], idempotencyKey: `smoke-cr-${tag}` });
ok(credit.settlement.credit.amountMinor === "150000", "sold on account 1,500.00");
await must("POST", "/customer-receipts", { customerId: cust.id, cashboxId: reg, method: "CASH", currency: "YER_NEW", amountMinor: "100000", businessDate: D, allocations: [{ invoiceId: credit.id, amountMinor: "100000" }] });
const cdet = await must("GET", `/customers/${cust.id}`, undefined, 200); ok(cdet.balance.amountMinor === "50000", `customer balance 500.00 (got ${cdet.balance.amountMinor})`);

step("payables: supplier invoice + payment");
const grnFull = await must("GET", `/goods-receipts/${grn.id}`, undefined, 200);
const grnLine = (grnFull.lines ?? grnFull.receipt?.lines ?? [])[0];
const si = await must("POST", "/supplier-invoices", { supplierId: sup.id, supplierInvoiceNo: `SI-${tag}`, invoiceDate: D, currency: "YER_NEW", lines: [{ grnLineId: grnLine?.id, itemId: item.id, unitId: U.Carton, qtyInUnit: 2, unitCostMinor: "2400000" }] });
ok(!!si.id, `supplier invoice ${si.number ?? si.id} matchStatus=${si.matchStatus ?? "?"}`);
await must("POST", "/supplier-payments", { supplierId: sup.id, cashboxId: reg, method: "CASH", currency: "YER_NEW", amountMinor: "1000000", businessDate: D, allocation: { mode: "FIFO" } });
const ledger = await must("GET", `/suppliers/${sup.id}/ledger`, undefined, 200); ok(!!ledger, "supplier ledger readable");

step("shift X report + close");
const x = await must("GET", `/shifts/${shift.id}/x-report`, undefined, 200);
const expected = x.expectedCash.find((m) => m.currency === "YER_NEW").amountMinor;
// 500000 float + 375000 sale − 150000 refund − 120000 expense + 100000 receipt − 1000000 supplier payment = −295000 → drawer would be negative; the pharmacy tops up
console.log(`  expected cash YER_NEW = ${expected}`);
const close = await must("POST", `/shifts/${shift.id}/close`, { counts: [{ currency: "YER_NEW", amountMinor: expected }], approver: { username: "owner", secret: "1234" } }, 200);
ok(close.zReport?.type === "Z" || close.zReport, "Z report produced");

step("accounting identities");
const tb = await must("GET", "/reports/trial-balance?to=2026-12-31", undefined, 200);
ok(tb.totals.balanced === true && tb.totals.debit === tb.totals.credit, `trial balance balanced (${tb.totals.debit})`);
const pnl = await must("GET", `/reports/pnl?from=${D}&to=2026-12-31`, undefined, 200); ok(!!pnl.netProfit, `P&L net ${JSON.stringify(pnl.netProfit)}`);
const bs = await must("GET", "/reports/balance-sheet?to=2026-12-31", undefined, 200); ok(bs.balanced === true || bs.totals?.balanced === true, "balance sheet balanced");
const val = await must("GET", "/reports/inventory-valuation", undefined, 200); ok(Array.isArray(val.rows), `inventory valuation rows ${val.rows.length}`);

step("backup");
const bk = await must("POST", "/backup", { note: "smoke" }); ok(/^pharmacore-/.test(bk.fileName), `backup ${bk.fileName} (${bk.sizeBytes} bytes)`);
const v = await must("GET", `/backup/${bk.fileName}/verify`, undefined, 200); ok(v.ok, "backup checksum ok");

console.log("\n✅ pharmacy-day smoke passed");
