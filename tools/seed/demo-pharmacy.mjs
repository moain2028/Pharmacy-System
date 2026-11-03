#!/usr/bin/env node
/**
 * Seeds a realistic small Yemeni pharmacy through the public API (so every row goes through real
 * validation, FEFO, journal posting and RLS). Idempotent: re-running adds nothing if the marker item exists.
 *
 *   node tools/seed/demo-pharmacy.mjs http://localhost:3100 [username] [password]
 *
 * What you get: 24 items with unit ladders + retail prices + barcodes, 3 suppliers, 4 customers,
 * stock received via PO → GRN with mixed expiry dates (some within 90 days, one expired lot blocked by FEFO),
 * an open shift and 6 posted sales (cash / card / credit, with change and a line discount), 1 return,
 * 2 expenses, 1 customer receipt and 1 supplier payment — enough for every screen to look alive.
 */
const BASE = (process.argv[2] ?? "http://localhost:3100").replace(/\/$/, "") + "/api/v1";
const USER = process.argv[3] ?? "1", PASS = process.argv[4] ?? "1";
let token = "";
const call = async (method, path, body) => {
  const r = await fetch(BASE + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), "accept-language": "ar" }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: j };
};
const must = async (m, p, b, exp = 201) => { const r = await call(m, p, b); if (r.status !== exp && !(exp === 201 && r.status === 200)) { console.error(`✗ ${m} ${p} → ${r.status}`, JSON.stringify(r.body).slice(0, 500)); process.exit(1); } return r.body; };
const log = (s) => console.log("  " + s);
const rows = (x) => (Array.isArray(x) ? x : x?.rows ?? x?.items ?? []);
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
const today = iso(new Date());

const login = await must("POST", "/auth/login", { username: USER, password: PASS }, 200); token = login.accessToken;
console.log(`▶ seeding demo pharmacy at ${BASE} as ${USER}`);

// Idempotency: the LAST catalogue entry is the completion marker; items/suppliers/customers are reused by code/name
// so a run interrupted half-way resumes instead of duplicating.
const marker = rows(await must("GET", "/items?q=DIAP-M&limit=5", undefined, 200)).find((i) => i.item_code === "DIAP-M");
// Each phase checks its own evidence, so an interrupted run resumes at the right phase.
const stocked = marker ? BigInt((await must("GET", `/inventory/items/${marker.id}/balances`, undefined, 200)).totalSsu ?? "0") > 0n : false;
const seedSales = rows(await must("GET", "/sales?limit=200", undefined, 200)).filter((x) => String(x.notes ?? "").startsWith("seed:"));
if (stocked && seedSales.length >= 6) { console.log("✓ already seeded — nothing to do"); process.exit(0); }

// ---------- master data ----------
const ladder = {
  tabs: (perBox, perStrip) => {
    const l = [
      { nameAr: "كرتون", nameEn: "Carton", factorToSsu: perBox * 10, level: 1, canSell: false, isDefaultPurchase: true },
      { nameAr: "علبة", nameEn: "Box", factorToSsu: perBox, level: 2, isDefaultSale: true, isStockDisplay: true },
    ];
    if (perStrip > 1 && perStrip < perBox) l.push({ nameAr: "شريط", nameEn: "Strip", factorToSsu: perStrip, level: 3 });
    l.push({ nameAr: "حبة", nameEn: "Tablet", factorToSsu: 1, level: l.length + 1, isSsu: true });
    return l;
  },
  single: (nameAr, nameEn, perCarton = 12) => [
    { nameAr: "كرتون", nameEn: "Carton", factorToSsu: perCarton, level: 1, canSell: false, isDefaultPurchase: true },
    { nameAr, nameEn, factorToSsu: 1, level: 2, isSsu: true, isDefaultSale: true, isStockDisplay: true },
  ],
};
// [code, ar, en, generic, strength, form, manufacturer, units, boxPriceYER(major), minPrice, cost(major per default purchase unit), barcodePrefix, rx, cold, reorderBoxes]
const CATALOG = [
  ["PANADOL-DEMO", "بنادول أقراص", "Panadol Tablets", "Paracetamol", "500mg", "Tablet", "GSK", ladder.tabs(24, 12), 1500, 1400, 11000, "6281060", "NONE", false, 20],
  ["AUGM-625", "أوجمنتين", "Augmentin", "Amoxicillin/Clavulanate", "625mg", "Tablet", "GSK", ladder.tabs(14, 7), 6500, 6000, 55000, "6281061", "RX", false, 10],
  ["AMOX-500", "أموكسيل كبسول", "Amoxil Capsules", "Amoxicillin", "500mg", "Capsule", "Julphar", ladder.tabs(20, 10), 2200, 2000, 17000, "6291100", "RX", false, 15],
  ["BRUF-400", "بروفين", "Brufen", "Ibuprofen", "400mg", "Tablet", "Abbott", ladder.tabs(30, 10), 1800, 1600, 14000, "6281062", "NONE", false, 20],
  ["VOLT-50", "فولتارين", "Voltaren", "Diclofenac", "50mg", "Tablet", "Novartis", ladder.tabs(20, 10), 2800, 2500, 22000, "7680011", "NONE", false, 10],
  ["OMEP-20", "أوميبرازول", "Omeprazole", "Omeprazole", "20mg", "Capsule", "Shiphacure", ladder.tabs(14, 7), 1200, 1000, 9000, "6286001", "NONE", false, 15],
  ["METF-850", "جلوكوفاج", "Glucophage", "Metformin", "850mg", "Tablet", "Merck", ladder.tabs(30, 15), 2400, 2200, 19000, "3400930", "RX", false, 12],
  ["AMLO-5", "نورفاسك", "Norvasc", "Amlodipine", "5mg", "Tablet", "Pfizer", ladder.tabs(30, 10), 3900, 3500, 31000, "0069154", "RX", false, 10],
  ["ATOR-20", "ليبيتور", "Lipitor", "Atorvastatin", "20mg", "Tablet", "Pfizer", ladder.tabs(30, 10), 5200, 4800, 42000, "0071015", "RX", false, 8],
  ["LOSA-50", "كوزار", "Cozaar", "Losartan", "50mg", "Tablet", "MSD", ladder.tabs(28, 14), 4100, 3800, 33000, "0006095", "RX", false, 8],
  ["CETI-10", "زيرتك", "Zyrtec", "Cetirizine", "10mg", "Tablet", "UCB", ladder.tabs(20, 10), 1600, 1400, 12000, "5413787", "NONE", false, 15],
  ["LORA-10", "كلاريتين", "Claritine", "Loratadine", "10mg", "Tablet", "Bayer", ladder.tabs(10, 10), 1300, 1100, 10000, "4005808", "NONE", false, 12],
  ["AZIT-500", "زيثروماكس", "Zithromax", "Azithromycin", "500mg", "Tablet", "Pfizer", ladder.tabs(3, 3), 3200, 2900, 26000, "0069306", "RX", false, 10],
  ["CIPRO-500", "سيبروباي", "Ciprobay", "Ciprofloxacin", "500mg", "Tablet", "Bayer", ladder.tabs(10, 10), 2900, 2600, 23000, "4029668", "RX", false, 8],
  ["PARA-SYR", "بنادول شراب أطفال", "Panadol Baby Syrup", "Paracetamol", "120mg/5ml", "Syrup", "GSK", ladder.single("زجاجة", "Bottle"), 1900, 1700, 18000, "6281063", "NONE", false, 12],
  ["AMOX-SYR", "أموكسيل شراب", "Amoxil Syrup", "Amoxicillin", "250mg/5ml", "Suspension", "Julphar", ladder.single("زجاجة", "Bottle"), 2100, 1900, 20000, "6291101", "RX", false, 10],
  ["ORS", "محلول الجفاف", "ORS Sachets", "Oral Rehydration Salts", "20.5g", "Sachet", "Pharco", ladder.single("كيس", "Sachet", 50), 150, 120, 5500, "6221000", "NONE", false, 100],
  ["VIT-C", "فيتامين سي فوار", "Vitamin C Effervescent", "Ascorbic acid", "1000mg", "Effervescent", "Bayer", ladder.single("أنبوب", "Tube", 24), 2500, 2200, 44000, "4005809", "NONE", false, 12],
  ["INSU-MIX", "ميكستارد 30 أنسولين", "Mixtard 30 Insulin", "Insulin human", "100IU/ml", "Vial", "Novo Nordisk", ladder.single("فيال", "Vial", 10), 9500, 9000, 80000, "5712249", "RX", true, 6],
  ["SALB-INH", "فنتولين بخاخ", "Ventolin Inhaler", "Salbutamol", "100mcg", "Inhaler", "GSK", ladder.single("بخاخ", "Inhaler", 20), 4200, 3900, 70000, "6281064", "NONE", false, 8],
  ["BETA-CRM", "بيتاديرم كريم", "Betaderm Cream", "Betamethasone", "0.1%", "Cream", "Julphar", ladder.single("أنبوب", "Tube", 24), 1100, 950, 20000, "6291102", "NONE", false, 10],
  ["GLUC-STRIP", "شرائط سكر أكيوتشيك", "Accu-Chek Strips", "Glucose test strips", "50s", "Strips", "Roche", ladder.single("علبة", "Box", 10), 12000, 11000, 95000, "4015630", "NONE", false, 6],
  ["MASK-50", "كمامات طبية", "Surgical Masks", "", "50 pcs", "Box", "Local", ladder.single("علبة", "Box", 20), 2500, 2000, 36000, "9990001", "NONE", false, 10],
  ["DIAP-M", "حفاضات أطفال وسط", "Baby Diapers M", "", "Size 3 ×40", "Pack", "Fine", ladder.single("حزمة", "Pack", 6), 6500, 6000, 33000, "6251001", "NONE", false, 8],
];
const minor = (major) => String(Math.round(major * 100));
const retail = (await must("GET", "/price-lists", undefined, 200)).find((p) => p.code === "RETAIL").id;
const items = [];
for (const [code, ar, en, generic, strength, form, mfr, units, box, min, cost, bc, rx, cold, reorder] of CATALOG) {
  const found = rows(await must("GET", `/items?q=${encodeURIComponent(code)}&limit=5`, undefined, 200)).find((i) => i.item_code === code);
  const it = found ?? await must("POST", "/items", { itemCode: code, tradeNameAr: ar, tradeNameEn: en, ...(generic ? { genericName: generic } : {}), strength, dosageForm: form, manufacturer: mfr, rxRequired: rx, requiresColdChain: cold, taxBp: 0, reorderPointSsu: reorder * units.find((u) => u.isDefaultSale).factorToSsu, units });
  const det = await must("GET", `/items/${it.id}`, undefined, 200);
  const U = Object.fromEntries(det.units.map((u) => [u.name_en, u]));
  const sale = det.units.find((u) => u.is_default_sale), purchase = det.units.find((u) => u.is_default_purchase) ?? sale;
  if (!found) await must("POST", "/prices", { priceListId: retail, itemId: it.id, unitId: sale.id, unitPriceMinor: minor(box), minPriceMinor: minor(min) });
  if (!found && U.Strip) await must("POST", "/prices", { priceListId: retail, itemId: it.id, unitId: U.Strip.id, unitPriceMinor: minor(Math.ceil((box / (sale.factor_to_ssu / U.Strip.factor_to_ssu)) * 1.1 / 10) * 10) });
  const ean = (bc + "000000").slice(0, 12); const sum = [...ean].reduce((a, d, i) => a + Number(d) * (i % 2 ? 3 : 1), 0); const check = (10 - (sum % 10)) % 10;
  if (!found) await call("POST", `/items/${it.id}/barcodes`, { barcode: ean + check, unitId: sale.id, isPrimary: true });
  items.push({ id: it.id, code, sale, purchase, costMinor: minor(cost), box, cold });
}
log(`${items.length} items with prices + barcodes`);

const suppliers = [];
const supExisting = rows(await must("GET", "/suppliers?limit=200", undefined, 200));
for (const [name, days] of [["شركة الدواء اليمنية", 30], ["مؤسسة الشفاء للأدوية", 45], ["وكالة الخليج الطبية", 0]]) suppliers.push(supExisting.find((x) => x.name === name) ?? await must("POST", "/suppliers", { name, defaultCurrency: "YER_NEW", paymentTermsDays: days, phone: "01" + String(200000 + suppliers.length * 1111) }));
log(`${suppliers.length} suppliers`);

const customers = [];
const custExisting = rows(await must("GET", "/customers?limit=200", undefined, 200));
for (const [name, phone, limit] of [["أحمد محمد الحداد", "777111222", 50000], ["فاطمة علي الشامي", "733444555", 30000], ["عيادة د. سمير", "01333444", 200000], ["مستوصف الرحمة", "01555666", 150000]]) {
  const have = custExisting.find((x) => x.name === name);
  if (have) { customers.push(have); continue; }
  const c = await call("POST", "/customers", { name, phone, creditLimitMinor: minor(limit), creditCurrency: "YER_NEW" });
  customers.push(c.status < 300 ? c.body : await must("POST", "/customers", { name, phone }));
}
log(`${customers.length} customers`);

// ---------- stock via PO → GRN, mixed expiry ----------
const loc = (await must("GET", "/inventory/locations", undefined, 200)).find((l) => l.code === "MAIN").id;
const fridge = (await must("GET", "/inventory/locations", undefined, 200)).find((l) => l.code === "FRIDGE")?.id ?? loc;
const expiryPlan = (i) => [addDays(400 + i * 17), addDays(60 + (i % 5) * 9), addDays(900)][i % 3]; // every 3rd lot is near-expiry
let grnCount = 0;
for (let s = 0; s < suppliers.length && !stocked; s++) {
  const mine = items.filter((_, i) => i % suppliers.length === s);
  const po = await must("POST", "/purchase-orders", { supplierId: suppliers[s].id, currency: "YER_NEW", lines: mine.map((it) => ({ itemId: it.id, unitId: it.purchase.id, qtyInUnit: 2 + (grnCount % 3), unitCostMinor: it.costMinor })) });
  await must("POST", `/purchase-orders/${po.id}/approve`, {}, 200);
  const det = await must("GET", `/purchase-orders/${po.id}`, undefined, 200);
  const poLines = det.lines ?? det.order?.lines ?? [];
  const lines = mine.map((it, i) => { const pl = poLines.find((l) => l.item_id === it.id || l.itemId === it.id); return { ...(pl ? { poLineId: pl.id } : {}), itemId: it.id, unitId: it.purchase.id, qtyInUnit: Number(pl?.qty_in_unit ?? pl?.qtyInUnit ?? 2), unitCostMinor: it.costMinor, lotNumber: `L${2026}${String(s + 1).padStart(2, "0")}${String(i + 1).padStart(3, "0")}`, expiryDate: expiryPlan(i + s) }; });
  // Everything sellable lands on MAIN (POS sells from MAIN); only the cold-chain item is split out to the fridge.
  const cold = lines.filter((l) => items.find((i) => i.id === l.itemId)?.cold), ambient = lines.filter((l) => !cold.includes(l));
  if (ambient.length) await must("POST", "/goods-receipts", { supplierId: suppliers[s].id, purchaseOrderId: po.id, locationId: loc, currency: "YER_NEW", businessDate: today, lines: ambient });
  if (cold.length) await must("POST", "/goods-receipts", { supplierId: suppliers[s].id, purchaseOrderId: po.id, locationId: fridge, currency: "YER_NEW", businessDate: today, lines: cold });
  grnCount++;
}
log(stocked ? "stock already received (skipped)" : `${grnCount} purchase orders received (lots with mixed expiry: long, <90 days, far)`);

// ---------- shift + sales ----------
const reg = (await must("GET", "/cashboxes", undefined, 200)).find((c) => c.code === "REG1").id;
let shift = await must("GET", "/shifts/current", undefined, 200);
if (!shift) shift = await must("POST", "/shifts/open", { cashboxId: reg, openingFloat: [{ currency: "YER_NEW", amountMinor: minor(20000) }], openingReason: "رصيد افتتاحي من الخزنة (بيانات تجريبية)" });
const byCode = Object.fromEntries(items.map((i) => [i.code, i]));
let saleNo = 0;
const sale = (lines, tenders, extra = {}) => { saleNo++; return must("POST", "/sales", { businessDate: today, lines, tenders, idempotencyKey: `seed-sale-${saleNo}`, notes: `seed:${saleNo}`, ...extra }); };
const L = (code, qty, extra = {}) => ({ itemId: byCode[code].id, unitId: byCode[code].sale.id, qtyInUnit: qty, ...extra });
const cash = (major) => [{ method: "CASH", currency: "YER_NEW", amountMinor: minor(major) }];
const sales = [];
if (seedSales.length >= 6) { console.log("✓ sales already seeded — nothing more to do"); process.exit(0); }
sales.push(await sale([L("PANADOL-DEMO", 2), L("VIT-C", 1)], cash(6000)));
sales.push(await sale([L("BRUF-400", 1), L("OMEP-20", 1), L("ORS", 4)], cash(4000)));
sales.push(await sale([L("CETI-10", 1), L("PARA-SYR", 1)], [{ method: "CARD", currency: "YER_NEW", amountMinor: minor(3500), paymentRef: "POS-7781" }]));
sales.push(await sale([L("MASK-50", 2), L("DIAP-M", 1)], cash(12000)));
sales.push(await sale([L("GLUC-STRIP", 1), L("METF-850", 2)], [{ method: "CREDIT", currency: "YER_NEW", amountMinor: minor(16800) }], { customerId: customers[2].id }));
sales.push(await sale([L("SALB-INH", 1), L("LORA-10", 1, { lineDiscountBp: 500 })], cash(6000)));
log(`${sales.length} sales posted (cash/card/credit, change, line discount)`);

const first = sales[0];
const q = await call("POST", "/returns/quote", { invoiceId: first.id, lines: [{ lineId: first.lines?.[0]?.id ?? first.lines?.[0]?.lineId, qtySsu: String(byCode["PANADOL-DEMO"].sale.factor_to_ssu) }], reason: "عبوة تالفة" });
if (q.status === 200) { const r = await call("POST", "/returns", { invoiceId: first.id, lines: [{ lineId: first.lines?.[0]?.id ?? first.lines?.[0]?.lineId, qtySsu: String(byCode["PANADOL-DEMO"].sale.factor_to_ssu) }], reason: "عبوة تالفة", refund: { method: "CASH", currency: "YER_NEW" } }); if (r.status < 300) log("1 return posted"); }

const cats = await must("GET", "/expense-categories", undefined, 200);
const cat = (c) => (cats.find((x) => x.code === c) ?? cats[0]).id;
await must("POST", "/expenses", { categoryId: cat("UTIL"), cashboxId: reg, currency: "YER_NEW", amountMinor: minor(3500), businessDate: today, description: "فاتورة كهرباء" });
await must("POST", "/expenses", { categoryId: cat("RENT") ?? cat("UTIL"), cashboxId: reg, currency: "YER_NEW", amountMinor: minor(1200), businessDate: today, description: "مياه شرب للموظفين" });
log("2 expenses");

await must("POST", "/customer-receipts", { customerId: customers[2].id, cashboxId: reg, method: "CASH", currency: "YER_NEW", amountMinor: minor(10000), businessDate: today, allocations: [{ invoiceId: sales[4].id, amountMinor: minor(10000) }] });
log("1 customer receipt (partial, allocated)");

const r = await call("POST", "/supplier-payments", { supplierId: suppliers[0].id, cashboxId: reg, method: "CASH", currency: "YER_NEW", amountMinor: minor(15000), businessDate: today, allocation: { mode: "FIFO" } });
if (r.status < 300) log("1 supplier payment (FIFO)");

console.log("✅ demo pharmacy seeded — dashboard, POS, expiry, reports and ledgers now have data");
