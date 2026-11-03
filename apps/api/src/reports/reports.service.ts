import { Inject, Injectable } from "@nestjs/common";
import type { Sql } from "@pharmacore/db";
import { Db } from "../infra/db.js";
import { ApiError } from "../shared/errors.js";
import { J } from "../shared/journal.js";

export type SalesGroupBy = "day" | "month" | "cashier" | "item" | "category";
export interface DateRange { from: string; to: string }
type SRow = Record<string, string | null>;
interface AccountRow { code: string; name_ar: string; name_en: string; account_type: string; normal_balance: string; debit: string; credit: string }
interface AcctOut { code: string; nameAr: string; nameEn: string; type: string; amount: bigint }
interface ExpiryRow { lot_id: string; lot_number: string; expiry_date: string; item_id: string; item_code: string; trade_name_ar: string; trade_name_en: string; qty_ssu: string; value_minor: string; cost_currency: string; days_left: number }
interface MoveRow { id: string; shift_id: string | null; currency: string; amount_minor: string; kind: string; pair_id: string | null; document_type: string | null; document_id: string | null; reason: string | null; occurred_at: Date; created_by: string | null; running: string }
interface AuditRow { id: string; actor_user_id: string | null; approved_by: string | null; action: string; entity_type: string; entity_id: string | null; before_data: unknown; after_data: unknown; reason: string | null; device_id: string | null; ip: string | null; occurred_at: Date }
type Bucket = "EXPIRED" | "D30" | "D90" | "D180" | "LATER";

const big = (v: string | null | undefined): bigint => BigInt(v ?? "0");
const num = (v: string | null | undefined): number => Number(v ?? "0");
const bp = (part: bigint, whole: bigint): number => (whole === 0n ? 0 : Number((part * 10000n) / whole));
const acct = (r: AccountRow, amount: bigint): AcctOut => ({ code: r.code, nameAr: r.name_ar, nameEn: r.name_en, type: r.account_type, amount });
const bucketOf = (d: number): Bucket => (d <= 0 ? "EXPIRED" : d <= 30 ? "D30" : d <= 90 ? "D90" : d <= 180 ? "D180" : "LATER");

function salesRow(key: string, labelAr: string | null, labelEn: string | null, s: SRow | null, r: SRow | null) {
  const net = big(s?.["net"]), cogs = big(s?.["cogs"]), refund = big(r?.["refund"]), rcogs = big(r?.["cogs"]);
  const netSales = net - refund, grossMargin = netSales - (cogs - rcogs);
  return {
    key, labelAr, labelEn, count: num(s?.["count"]), qtySsu: big(s?.["qty_ssu"]), gross: big(s?.["gross"]), discount: big(s?.["discount"]), net, tax: big(s?.["tax"]), total: big(s?.["total"]), cogs,
    returnCount: num(r?.["count"]), returnQtySsu: big(r?.["qty_ssu"]), returnRefund: refund, returnCogs: rcogs, netSales, grossMargin, marginBp: bp(grossMargin, netSales),
  };
}

function agingOut(rows: SRow[]) {
  const byCur = new Map<string, bigint>();
  const out = rows.map((r) => {
    const cur = r["currency"] ?? ""; const total = big(r["total"]); byCur.set(cur, (byCur.get(cur) ?? 0n) + total);
    return { partyId: r["party_id"], code: r["code"], name: r["name"], currency: cur, total, current: big(r["current"]), d1_30: big(r["d1_30"]), d31_60: big(r["d31_60"]), d61_90: big(r["d61_90"]), d90Plus: big(r["d90_plus"]) };
  });
  return { rows: out, totals: [...byCur].map(([currency, amountMinor]) => ({ currency, amountMinor })) };
}

@Injectable()
export class ReportsService {
  constructor(@Inject(Db) private readonly db: Db) {}

  private async base(tx: Sql, tenantId: string): Promise<string> {
    const [t] = await tx<{ base_currency: string }[]>`SELECT base_currency FROM tenants WHERE id = ${tenantId}`;
    if (!t) throw ApiError.notFound("tenant.not_found", "Tenant not found");
    return t.base_currency;
  }

  private accountSums(tx: Sql, from: string | null, to: string) {
    return tx<AccountRow[]>`SELECT a.code, a.name_ar, a.name_en, a.account_type, a.normal_balance, SUM(l.debit_minor) AS debit, SUM(l.credit_minor) AS credit
      FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN accounts a ON a.tenant_id = l.tenant_id AND a.code = l.account_code
      WHERE e.business_date <= ${to}::date AND (${from}::date IS NULL OR e.business_date >= ${from}::date)
      GROUP BY 1, 2, 3, 4, 5 ORDER BY 1 LIMIT 5000`;
  }

  private sk(tx: Sql, g: SalesGroupBy) {
    if (g === "day") return tx`l.business_date::text`;
    if (g === "month") return tx`to_char(l.business_date, 'YYYY-MM')`;
    if (g === "cashier") return tx`l.cashier_id::text`;
    if (g === "item") return tx`l.item_id::text`;
    return tx`COALESCE(l.category_id::text, '')`;
  }

  private sl(tx: Sql, g: SalesGroupBy) {
    if (g === "cashier") return [tx`MAX(l.cashier_name)`, tx`MAX(l.cashier_name)`] as const;
    if (g === "item") return [tx`MAX(l.trade_name_ar)`, tx`MAX(l.trade_name_en)`] as const;
    if (g === "category") return [tx`MAX(l.cat_ar)`, tx`MAX(l.cat_en)`] as const;
    return [tx`NULL::text`, tx`NULL::text`] as const;
  }

  private buckets(tx: Sql) {
    return tx`SUM(o.open_minor) AS total, SUM(CASE WHEN o.age <= 0 THEN o.open_minor ELSE 0 END) AS current,
      SUM(CASE WHEN o.age BETWEEN 1 AND 30 THEN o.open_minor ELSE 0 END) AS d1_30, SUM(CASE WHEN o.age BETWEEN 31 AND 60 THEN o.open_minor ELSE 0 END) AS d31_60,
      SUM(CASE WHEN o.age BETWEEN 61 AND 90 THEN o.open_minor ELSE 0 END) AS d61_90, SUM(CASE WHEN o.age > 90 THEN o.open_minor ELSE 0 END) AS d90_plus`;
  }

  trialBalance(tenantId: string, q: { to: string }) {
    return this.db.tx(tenantId, async (tx) => {
      const currency = await this.base(tx, tenantId);
      const rows = await this.accountSums(tx, null, q.to);
      let td = 0n, tc = 0n;
      const out = rows.map((r) => {
        const d = big(r.debit), c = big(r.credit); td += d; tc += c;
        return { code: r.code, nameAr: r.name_ar, nameEn: r.name_en, type: r.account_type, debit: d, credit: c, balance: r.normal_balance === "DEBIT" ? d - c : c - d };
      });
      return J({ currency, to: q.to, rows: out, totals: { debit: td, credit: tc, balanced: td === tc } });
    });
  }

  profitAndLoss(tenantId: string, q: DateRange) {
    return this.db.tx(tenantId, async (tx) => {
      const currency = await this.base(tx, tenantId);
      const rows = await this.accountSums(tx, q.from, q.to);
      const by = new Map(rows.map((r) => [r.code, r] as const));
      const dc = (code: string): bigint => { const r = by.get(code); return r ? big(r.debit) - big(r.credit) : 0n; };
      const revenue: AcctOut[] = [], expenses: AcctOut[] = []; let tr = 0n, te = 0n;
      for (const r of rows) {
        const d = big(r.debit), c = big(r.credit);
        if (r.account_type === "REVENUE") { tr += c - d; revenue.push(acct(r, c - d)); }
        else if (r.account_type === "EXPENSE") { te += d - c; expenses.push(acct(r, d - c)); }
      }
      const sales = -dc("4100"), returns = dc("4110"), discounts = dc("4120"), cogs = dc("5100");
      const grossProfit = sales - returns - discounts - cogs;
      return J({ currency, from: q.from, to: q.to, revenue, expenses, grossProfit: { sales, returns, discounts, cogs, grossProfit, marginBp: bp(grossProfit, sales - returns - discounts) }, totals: { revenue: tr, expenses: te, netProfit: tr - te } });
    });
  }

  balanceSheet(tenantId: string, q: { to: string }) {
    return this.db.tx(tenantId, async (tx) => {
      const currency = await this.base(tx, tenantId);
      const rows = await this.accountSums(tx, null, q.to);
      const assets: AcctOut[] = [], liabilities: AcctOut[] = [], equity: AcctOut[] = []; let ta = 0n, tl = 0n, teq = 0n, tr = 0n, te = 0n;
      for (const r of rows) {
        const d = big(r.debit), c = big(r.credit);
        switch (r.account_type) {
          case "ASSET": ta += d - c; assets.push(acct(r, d - c)); break;
          case "LIABILITY": tl += c - d; liabilities.push(acct(r, c - d)); break;
          case "EQUITY": teq += c - d; equity.push(acct(r, c - d)); break;
          case "REVENUE": tr += c - d; break;
          default: te += d - c;
        }
      }
      const netProfit = tr - te; teq += netProfit;
      equity.push({ code: "3900", nameAr: "أرباح الفترة الجارية", nameEn: "Current period earnings", type: "EQUITY", amount: netProfit });
      return J({ currency, to: q.to, assets, liabilities, equity, totals: { assets: ta, liabilities: tl, equity: teq, netProfit, difference: ta - tl - teq, balanced: ta === tl + teq } });
    });
  }

  salesSummary(tenantId: string, q: DateRange & { groupBy: SalesGroupBy }) {
    return this.db.tx(tenantId, async (tx) => {
      const currency = await this.base(tx, tenantId);
      const [la, le] = this.sl(tx, q.groupBy);
      const sales = await tx<SRow[]>`WITH l AS (
          SELECT i.id AS invoice_id, i.business_date, i.cashier_id, u.display_name AS cashier_name, sl.item_id, it.trade_name_ar, it.trade_name_en, it.category_id, c.name_ar AS cat_ar, c.name_en AS cat_en,
                 sl.ssu_qty, sl.gross_minor, sl.discount_minor + sl.allocated_invoice_discount_minor AS discount_minor, sl.net_minor, sl.tax_minor, sl.total_minor,
                 COALESCE((SELECT SUM(sll.ssu_qty * sll.unit_cost_minor_snapshot) FROM sale_line_lots sll WHERE sll.line_id = sl.id), 0) AS cogs_minor
          FROM sales_invoices i JOIN sales_invoice_lines sl ON sl.invoice_id = i.id JOIN items it ON it.id = sl.item_id
          LEFT JOIN item_categories c ON c.id = it.category_id JOIN users u ON u.id = i.cashier_id
          WHERE i.status = 'POSTED' AND i.business_date BETWEEN ${q.from}::date AND ${q.to}::date)
        SELECT ${this.sk(tx, q.groupBy)} AS key, ${la} AS label_ar, ${le} AS label_en, COUNT(DISTINCT l.invoice_id) AS count, SUM(l.ssu_qty) AS qty_ssu, SUM(l.gross_minor) AS gross,
               SUM(l.discount_minor) AS discount, SUM(l.net_minor) AS net, SUM(l.tax_minor) AS tax, SUM(l.total_minor) AS total, SUM(l.cogs_minor) AS cogs
        FROM l GROUP BY 1 ORDER BY 1 LIMIT 1000`;
      const rets = await tx<SRow[]>`WITH l AS (
          SELECT r.id AS return_id, r.business_date, r.cashier_id, rl.item_id, it.category_id, rl.ssu_qty, rl.refund_minor, rl.cost_minor_snapshot AS cogs_minor
          FROM sales_returns r JOIN sales_return_lines rl ON rl.return_id = r.id JOIN items it ON it.id = rl.item_id
          WHERE r.status = 'POSTED' AND r.business_date BETWEEN ${q.from}::date AND ${q.to}::date)
        SELECT ${this.sk(tx, q.groupBy)} AS key, COUNT(DISTINCT l.return_id) AS count, SUM(l.ssu_qty) AS qty_ssu, SUM(l.refund_minor) AS refund, SUM(l.cogs_minor) AS cogs
        FROM l GROUP BY 1 ORDER BY 1 LIMIT 1000`;
      const rmap = new Map(rets.map((r) => [r["key"] ?? "", r] as const));
      const simple = q.groupBy === "day" || q.groupBy === "month";
      const out = sales.map((s) => { const k = s["key"] ?? ""; const r = rmap.get(k) ?? null; rmap.delete(k); return salesRow(k, simple ? k : (s["label_ar"] ?? null), simple ? k : (s["label_en"] ?? null), s, r); });
      for (const [k, r] of rmap) out.push(salesRow(k, simple ? k : null, simple ? k : null, null, r));
      const t = { count: 0, gross: 0n, discount: 0n, net: 0n, tax: 0n, total: 0n, cogs: 0n, returnCount: 0, returnRefund: 0n, returnCogs: 0n, netSales: 0n, grossMargin: 0n };
      for (const r of out) { t.count += r.count; t.gross += r.gross; t.discount += r.discount; t.net += r.net; t.tax += r.tax; t.total += r.total; t.cogs += r.cogs; t.returnCount += r.returnCount; t.returnRefund += r.returnRefund; t.returnCogs += r.returnCogs; t.netSales += r.netSales; t.grossMargin += r.grossMargin; }
      return J({ currency, from: q.from, to: q.to, groupBy: q.groupBy, rows: out, totals: { ...t, marginBp: bp(t.grossMargin, t.netSales) } });
    });
  }

  salesByPaymentMethod(tenantId: string, q: DateRange) {
    return this.db.tx(tenantId, async (tx) => {
      const rows = await tx<SRow[]>`SELECT p.method, p.currency, COUNT(*) AS count, SUM(p.amount_minor) AS amount, SUM(p.amount_in_invoice_currency_minor) AS amount_in_invoice_currency
        FROM invoice_payments p JOIN sales_invoices i ON i.id = p.invoice_id
        WHERE i.status = 'POSTED' AND i.business_date BETWEEN ${q.from}::date AND ${q.to}::date GROUP BY 1, 2 ORDER BY 1, 2 LIMIT 100`;
      return J({ from: q.from, to: q.to, rows: rows.map((r) => ({ method: r["method"], currency: r["currency"], count: num(r["count"]), amountMinor: big(r["amount"]), amountInInvoiceCurrencyMinor: big(r["amount_in_invoice_currency"]) })) });
    });
  }

  topItems(tenantId: string, q: DateRange & { limit: number }) {
    return this.db.tx(tenantId, async (tx) => {
      const currency = await this.base(tx, tenantId);
      const rows = await tx<SRow[]>`SELECT it.id AS item_id, it.item_code, it.trade_name_ar, it.trade_name_en, COUNT(DISTINCT i.id) AS invoices, SUM(sl.ssu_qty) AS qty_ssu,
          SUM(sl.gross_minor) AS gross, SUM(sl.net_minor) AS net, SUM(sl.total_minor) AS total,
          COALESCE(SUM((SELECT SUM(sll.ssu_qty * sll.unit_cost_minor_snapshot) FROM sale_line_lots sll WHERE sll.line_id = sl.id)), 0) AS cogs
        FROM sales_invoices i JOIN sales_invoice_lines sl ON sl.invoice_id = i.id JOIN items it ON it.id = sl.item_id
        WHERE i.status = 'POSTED' AND i.business_date BETWEEN ${q.from}::date AND ${q.to}::date
        GROUP BY 1, 2, 3, 4 ORDER BY net DESC LIMIT ${q.limit}`;
      return J({ currency, from: q.from, to: q.to, rows: rows.map((r) => { const net = big(r["net"]), cogs = big(r["cogs"]);
        return { itemId: r["item_id"], itemCode: r["item_code"], nameAr: r["trade_name_ar"], nameEn: r["trade_name_en"], invoices: num(r["invoices"]), qtySsu: big(r["qty_ssu"]), gross: big(r["gross"]), net, total: big(r["total"]), cogs, grossMargin: net - cogs, marginBp: bp(net - cogs, net) }; }) });
    });
  }

  inventoryValuation(tenantId: string, q: { asOf?: string | undefined; locationId?: string | undefined; byLocation: boolean }) {
    return this.db.tx(tenantId, async (tx) => {
      const currency = await this.base(tx, tenantId);
      const asOf = q.asOf ?? null, loc = q.locationId ?? null;
      const rows = await tx<SRow[]>`WITH b AS (
          SELECT m.item_id, m.lot_id, m.location_id, SUM(m.qty_delta_ssu) AS qty FROM stock_movements m
          WHERE (${asOf}::date IS NULL OR m.business_date <= ${asOf}::date) AND (${loc}::uuid IS NULL OR m.location_id = ${loc}::uuid)
          GROUP BY 1, 2, 3 HAVING SUM(m.qty_delta_ssu) <> 0),
        v AS (SELECT b.item_id, b.location_id, b.qty, ROUND(b.qty * l.total_cost_minor::numeric / l.qty_received_ssu)::bigint AS value_minor FROM b JOIN lots l ON l.id = b.lot_id)
        SELECT it.id AS item_id, it.item_code, it.trade_name_ar, it.trade_name_en, lo.id AS location_id, lo.code AS location_code, SUM(v.qty) AS qty_ssu, SUM(v.value_minor) AS value_minor
        FROM v JOIN items it ON it.id = v.item_id JOIN locations lo ON lo.id = v.location_id GROUP BY 1, 2, 3, 4, 5, 6 ORDER BY 8 DESC LIMIT 5000`;
      const map = new Map<string, { itemId: string | null; itemCode: string | null; nameAr: string | null; nameEn: string | null; locationId: string | null; locationCode: string | null; qtySsu: bigint; valueMinor: bigint }>();
      let tq = 0n, tv = 0n;
      for (const r of rows) {
        const qty = big(r["qty_ssu"]), val = big(r["value_minor"]); tq += qty; tv += val;
        const k = q.byLocation ? `${r["item_id"]}:${r["location_id"]}` : (r["item_id"] ?? "");
        const cur = map.get(k);
        if (cur) { cur.qtySsu += qty; cur.valueMinor += val; }
        else map.set(k, { itemId: r["item_id"] ?? null, itemCode: r["item_code"] ?? null, nameAr: r["trade_name_ar"] ?? null, nameEn: r["trade_name_en"] ?? null, locationId: q.byLocation ? (r["location_id"] ?? null) : null, locationCode: q.byLocation ? (r["location_code"] ?? null) : null, qtySsu: qty, valueMinor: val });
      }
      return J({ currency, asOf, locationId: loc, byLocation: q.byLocation, rows: [...map.values()], totals: { items: map.size, qtySsu: tq, valueMinor: tv } });
    });
  }

  expiryReport(tenantId: string, q: { days: number; asOf: string }) {
    return this.db.tx(tenantId, async (tx) => {
      const currency = await this.base(tx, tenantId);
      const rows = await tx<ExpiryRow[]>`WITH b AS (SELECT lot_id, SUM(qty_delta_ssu) AS qty FROM stock_movements WHERE business_date <= ${q.asOf}::date GROUP BY lot_id HAVING SUM(qty_delta_ssu) > 0)
        SELECT l.id AS lot_id, l.lot_number, l.expiry_date::text AS expiry_date, l.item_id, it.item_code, it.trade_name_ar, it.trade_name_en, b.qty AS qty_ssu,
               ROUND(b.qty * l.total_cost_minor::numeric / l.qty_received_ssu)::bigint AS value_minor, l.cost_currency, (l.expiry_date - ${q.asOf}::date)::int AS days_left
        FROM b JOIN lots l ON l.id = b.lot_id JOIN items it ON it.id = l.item_id
        WHERE l.expiry_date IS NOT NULL AND l.expiry_date <= ${q.asOf}::date + ${q.days}::int
        ORDER BY l.expiry_date, it.item_code, l.lot_number LIMIT 2000`;
      const mk = () => ({ count: 0, qtySsu: 0n, valueMinor: 0n });
      const buckets: Record<Bucket, { count: number; qtySsu: bigint; valueMinor: bigint }> = { EXPIRED: mk(), D30: mk(), D90: mk(), D180: mk(), LATER: mk() };
      let tq = 0n, tv = 0n;
      const out = rows.map((r) => {
        const bucket = bucketOf(r.days_left), qty = big(r.qty_ssu), val = big(r.value_minor); const b = buckets[bucket]; b.count += 1; b.qtySsu += qty; b.valueMinor += val; tq += qty; tv += val;
        return { lotId: r.lot_id, lotNumber: r.lot_number, expiryDate: r.expiry_date, daysLeft: r.days_left, bucket, itemId: r.item_id, itemCode: r.item_code, nameAr: r.trade_name_ar, nameEn: r.trade_name_en, qtySsu: qty, valueMinor: val, costCurrency: r.cost_currency };
      });
      return J({ currency, asOf: q.asOf, days: q.days, rows: out, buckets, totals: { count: out.length, qtySsu: tq, valueMinor: tv } });
    });
  }

  slowMoving(tenantId: string, q: { days: number; asOf: string }) {
    return this.db.tx(tenantId, async (tx) => {
      const currency = await this.base(tx, tenantId);
      const rows = await tx<SRow[]>`WITH b AS (SELECT m.item_id, m.lot_id, SUM(m.qty_delta_ssu) AS qty FROM stock_movements m WHERE m.business_date <= ${q.asOf}::date GROUP BY 1, 2 HAVING SUM(m.qty_delta_ssu) > 0),
        v AS (SELECT b.item_id, SUM(b.qty) AS qty, SUM(ROUND(b.qty * l.total_cost_minor::numeric / l.qty_received_ssu))::bigint AS value_minor FROM b JOIN lots l ON l.id = b.lot_id GROUP BY 1),
        s AS (SELECT item_id, MAX(business_date) AS last_sale FROM stock_movements WHERE movement_type = 'SALE' AND business_date <= ${q.asOf}::date GROUP BY item_id)
        SELECT it.id AS item_id, it.item_code, it.trade_name_ar, it.trade_name_en, v.qty AS qty_ssu, v.value_minor, s.last_sale::text AS last_sale
        FROM v JOIN items it ON it.id = v.item_id LEFT JOIN s ON s.item_id = v.item_id
        WHERE s.last_sale IS NULL OR s.last_sale < ${q.asOf}::date - ${q.days}::int ORDER BY v.value_minor DESC LIMIT 2000`;
      let tq = 0n, tv = 0n;
      const out = rows.map((r) => { const qty = big(r["qty_ssu"]), val = big(r["value_minor"]); tq += qty; tv += val;
        return { itemId: r["item_id"], itemCode: r["item_code"], nameAr: r["trade_name_ar"], nameEn: r["trade_name_en"], qtySsu: qty, valueMinor: val, lastSaleDate: r["last_sale"] ?? null }; });
      return J({ currency, asOf: q.asOf, days: q.days, rows: out, totals: { items: out.length, qtySsu: tq, valueMinor: tv } });
    });
  }

  customerAging(tenantId: string, q: { asOf: string }) {
    return this.db.tx(tenantId, async (tx) => {
      const rows = await tx<SRow[]>`WITH alloc AS (
          SELECT (a->>'documentId')::uuid AS doc_id, SUM((a->>'amountMinor')::bigint) AS amt
          FROM party_payments p CROSS JOIN LATERAL jsonb_array_elements(p.allocations) a
          WHERE p.status = 'POSTED' AND p.party_type = 'CUSTOMER' AND p.business_date <= ${q.asOf}::date GROUP BY 1),
        o AS (SELECT i.customer_id AS party_id, i.currency, i.credit_minor - COALESCE(al.amt, 0) AS open_minor, (${q.asOf}::date - i.business_date)::int AS age
              FROM sales_invoices i LEFT JOIN alloc al ON al.doc_id = i.id WHERE i.status = 'POSTED' AND i.credit_minor > 0 AND i.business_date <= ${q.asOf}::date)
        SELECT c.id AS party_id, c.code, c.name, o.currency, ${this.buckets(tx)}
        FROM o JOIN customers c ON c.id = o.party_id WHERE o.open_minor <> 0 GROUP BY 1, 2, 3, 4 HAVING SUM(o.open_minor) <> 0 ORDER BY 5 DESC LIMIT 1000`;
      return J({ asOf: q.asOf, partyType: "CUSTOMER", ...agingOut(rows) });
    });
  }

  supplierAging(tenantId: string, q: { asOf: string }) {
    return this.db.tx(tenantId, async (tx) => {
      const rows = await tx<SRow[]>`WITH o AS (
          SELECT si.supplier_id AS party_id, si.currency, si.total_minor - si.paid_minor AS open_minor, (${q.asOf}::date - COALESCE(si.due_date, si.invoice_date + s.payment_terms_days))::int AS age
          FROM supplier_invoices si JOIN suppliers s ON s.id = si.supplier_id
          WHERE si.status = 'POSTED' AND si.invoice_date <= ${q.asOf}::date AND si.total_minor <> si.paid_minor)
        SELECT s.id AS party_id, s.code, s.name, o.currency, ${this.buckets(tx)}
        FROM o JOIN suppliers s ON s.id = o.party_id GROUP BY 1, 2, 3, 4 HAVING SUM(o.open_minor) <> 0 ORDER BY 5 DESC LIMIT 1000`;
      return J({ asOf: q.asOf, partyType: "SUPPLIER", ...agingOut(rows) });
    });
  }

  cashbook(tenantId: string, q: DateRange & { cashboxId: string }) {
    return this.db.tx(tenantId, async (tx) => {
      const [cb] = await tx<{ id: string; code: string; name_ar: string; name_en: string; kind: string }[]>`SELECT id, code, name_ar, name_en, kind FROM cashboxes WHERE id = ${q.cashboxId}`;
      if (!cb) throw ApiError.notFound("cashbox.not_found", "Cashbox not found");
      const opening = await tx<SRow[]>`SELECT currency, SUM(amount_minor) AS balance FROM cash_movements WHERE cashbox_id = ${q.cashboxId} AND occurred_at < ${q.from}::date GROUP BY currency ORDER BY currency`;
      const moves = await tx<MoveRow[]>`SELECT m.id, m.shift_id, m.currency, m.amount_minor, m.kind, m.pair_id, m.document_type, m.document_id, m.reason, m.occurred_at, m.created_by,
          COALESCE(o.balance, 0) + SUM(m.amount_minor) OVER (PARTITION BY m.currency ORDER BY m.occurred_at, m.id) AS running
        FROM cash_movements m LEFT JOIN (SELECT currency, SUM(amount_minor) AS balance FROM cash_movements WHERE cashbox_id = ${q.cashboxId} AND occurred_at < ${q.from}::date GROUP BY currency) o ON o.currency = m.currency
        WHERE m.cashbox_id = ${q.cashboxId} AND m.occurred_at >= ${q.from}::date AND m.occurred_at < ${q.to}::date + 1
        ORDER BY m.currency, m.occurred_at, m.id LIMIT 5000`;
      const closing = new Map<string, bigint>(opening.map((o) => [o["currency"] ?? "", big(o["balance"])] as const));
      const rows = moves.map((m) => { closing.set(m.currency, (closing.get(m.currency) ?? 0n) + big(m.amount_minor));
        return { id: m.id, shiftId: m.shift_id, currency: m.currency, amountMinor: big(m.amount_minor), kind: m.kind, pairId: m.pair_id, documentType: m.document_type, documentId: m.document_id, reason: m.reason, occurredAt: m.occurred_at, createdBy: m.created_by, runningBalanceMinor: big(m.running) }; });
      return J({ cashbox: { id: cb.id, code: cb.code, nameAr: cb.name_ar, nameEn: cb.name_en, kind: cb.kind }, from: q.from, to: q.to,
        opening: opening.map((o) => ({ currency: o["currency"], amountMinor: big(o["balance"]) })), rows, closing: [...closing].map(([currency, amountMinor]) => ({ currency, amountMinor })) });
    });
  }

  auditTrail(tenantId: string, q: DateRange & { actorId?: string | undefined; action?: string | undefined; limit: number; offset: number }) {
    return this.db.tx(tenantId, async (tx) => {
      const rows = await tx<AuditRow[]>`SELECT a.id, a.actor_user_id, a.approved_by, a.action, a.entity_type, a.entity_id, a.before_data, a.after_data, a.reason, a.device_id, a.ip, a.occurred_at
        FROM audit_log a WHERE a.occurred_at >= ${q.from}::date AND a.occurred_at < ${q.to}::date + 1
        ${q.actorId ? tx`AND a.actor_user_id = ${q.actorId}` : tx``} ${q.action ? tx`AND a.action = ${q.action}` : tx``}
        ORDER BY a.occurred_at DESC LIMIT ${q.limit} OFFSET ${q.offset}`;
      return J({ from: q.from, to: q.to, limit: q.limit, offset: q.offset, rows: rows.map((r) => ({ id: r.id, actorUserId: r.actor_user_id, approvedBy: r.approved_by, action: r.action, entityType: r.entity_type, entityId: r.entity_id, before: r.before_data, after: r.after_data, reason: r.reason, deviceId: r.device_id, ip: r.ip, occurredAt: r.occurred_at })) });
    });
  }

  dashboard(tenantId: string) {
    return this.db.tx(tenantId, async (tx) => {
      const currency = await this.base(tx, tenantId);
      const [d] = await tx<{ today: string }[]>`SELECT CURRENT_DATE::text AS today`;
      const sales = await tx<SRow[]>`SELECT currency, COUNT(*) AS count, SUM(total_minor) AS total FROM sales_invoices WHERE status = 'POSTED' AND business_date = CURRENT_DATE GROUP BY currency ORDER BY currency`;
      const [sh] = await tx<{ n: string }[]>`SELECT COUNT(*) AS n FROM shifts WHERE status = 'OPEN'`;
      const [low] = await tx<{ n: string }[]>`SELECT COUNT(*) AS n FROM items it LEFT JOIN (SELECT item_id, SUM(qty_delta_ssu) AS qty FROM stock_movements GROUP BY item_id) b ON b.item_id = it.id
        WHERE it.is_active AND it.reorder_point_ssu IS NOT NULL AND COALESCE(b.qty, 0) <= it.reorder_point_ssu`;
      const [exp] = await tx<{ n: string; qty: string }[]>`SELECT COUNT(*) AS n, COALESCE(SUM(b.qty), 0) AS qty FROM (SELECT lot_id, SUM(qty_delta_ssu) AS qty FROM stock_movements GROUP BY lot_id HAVING SUM(qty_delta_ssu) > 0) b
        JOIN lots l ON l.id = b.lot_id WHERE l.expiry_date IS NOT NULL AND l.expiry_date <= CURRENT_DATE + 90`;
      const cash = await tx<SRow[]>`SELECT m.currency, SUM(m.amount_minor) AS balance FROM cash_movements m JOIN cashboxes cb ON cb.id = m.cashbox_id WHERE cb.kind IN ('REGISTER', 'SAFE') GROUP BY m.currency ORDER BY m.currency`;
      return J({ currency, date: d?.today ?? null, todaySales: sales.map((r) => ({ currency: r["currency"], count: num(r["count"]), totalMinor: big(r["total"]) })), openShifts: num(sh?.n), lowStockItems: num(low?.n),
        expiringWithin90Days: { lots: num(exp?.n), qtySsu: big(exp?.qty) }, cashOnHand: cash.map((r) => ({ currency: r["currency"], amountMinor: big(r["balance"]) })) });
    });
  }
}
