import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { Sql } from "@pharmacore/db";
import {
  Money, SupplierInvoice, PurchaseReturn, Lot, MATCH_OVERRIDE_PERMISSION, PURCHASE_RETURN_REASONS,
  allocatePayment, aging, balance, postSupplierPayment, toBase as valueToBase,
} from "@pharmacore/domain";
import type {
  CurrencyCode, DiscountValue, GrnLineRef, OpenItem, AllocationStrategy, LotManualStatus, LotSourceType,
} from "@pharmacore/domain";
import { z } from "zod";
import { Db } from "../infra/db.js";
import { AuthService } from "../identity/auth.service.js";
import { ApiError } from "../shared/errors.js";
import { J, persistEntry, rateFor } from "../shared/journal.js";
import { parse } from "../shared/validation.js";

const Currency = z.enum(["YER_OLD", "YER_NEW", "SAR", "USD"]);
const Id = z.string().uuid();
const Minor = z.string().regex(/^\d+$/).max(19);
const Qty = z.union([z.string().regex(/^\d+$/).max(19), z.number().int().nonnegative().safe().transform(String)]);
const Bp = z.number().int().min(0).max(10000);
const DateIn = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => {
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
}, "Invalid calendar date");
const Discount = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("PERCENT"), bp: Bp }).strict(),
  z.object({ mode: z.literal("AMOUNT"), amountMinor: Minor }).strict(),
]);
const InvoiceRequest = z.object({
  supplierId: Id, supplierInvoiceNo: z.string().trim().min(1).max(120), invoiceDate: DateIn,
  currency: Currency, dueDate: DateIn.optional(),
  lines: z.array(z.object({
    grnLineId: Id.optional(), itemId: Id, unitId: Id, qtyInUnit: Qty, unitCostMinor: Minor,
    discount: Discount.optional(), unmatchedReason: z.string().trim().min(1).max(500).optional(),
  }).strict()).min(1).max(200),
  invoiceDiscount: Discount.optional(), taxBp: Bp.optional(),
  earlyPayment: z.object({ days: z.number().int().min(0).max(36500), bp: Bp }).strict().optional(),
  approver: z.object({ username: z.string().min(1), secret: z.string().min(1) }).strict().optional(),
  reason: z.string().trim().min(1).max(500).optional(),
}).strict();
const ReturnRequest = z.object({
  supplierId: Id, locationId: Id, businessDate: DateIn.optional(), reason: z.enum(PURCHASE_RETURN_REASONS),
  lines: z.array(z.object({ lotId: Id, qtySsu: Qty, agreedCreditPerSsuMinor: Minor.optional() }).strict()).min(1).max(200),
}).strict();
const PaymentRequest = z.object({
  supplierId: Id, cashboxId: Id, method: z.enum(["CASH", "CARD", "WALLET"]), currency: Currency,
  amountMinor: Minor, businessDate: DateIn.optional(), reference: z.string().max(200).optional(),
  allocation: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("FIFO") }).strict(),
    z.object({ mode: z.literal("PRO_RATA") }).strict(),
    z.object({ mode: z.literal("EXPLICIT"), targets: z.array(z.object({ itemId: Id, amountMinor: Minor }).strict()).max(200) }).strict(),
  ]),
}).strict();
const ListRequest = z.object({
  supplierId: Id.optional(), from: DateIn.optional(), to: DateIn.optional(),
  status: z.enum(["DRAFT", "POSTED", "REVERSED", "CANCELLED"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0),
});
const Settings = z.object({
  match_tolerance_qty_bp: z.number().int().nonnegative().default(0),
  match_tolerance_price_bp: z.number().int().nonnegative().default(200),
});
interface Actor { readonly userId: string }
interface TenantRow { base_currency: CurrencyCode; settings: unknown }
interface SupplierRow {
  id: string; is_active: boolean; default_currency: CurrencyCode | null; payment_terms_days: number;
  early_payment_days: number | null; early_payment_bp: number | null;
}
interface UnitRow { id: string; item_id: string; factor_to_ssu: string; is_ssu: boolean }
interface GrnRow {
  id: string; receipt_id: string; item_id: string; factor_snapshot: string; ssu_qty_total: string;
  unit_cost_minor: string; currency: CurrencyCode; total_cost_minor: string; cost_currency: CurrencyCode;
  po_factor: string | null; po_price: string | null;
}
interface LotRow {
  id: string; item_id: string; lot_number: string; expiry_date: string | null; qty_received_ssu: string;
  total_cost_minor: string; cost_currency: CurrencyCode; source_type: LotSourceType; manual_status: LotManualStatus;
  supplier_id: string | null; printed_public_price_minor: string | null;
}
interface InvoiceRow {
  id: string; number: string | null; supplier_id: string; supplier_invoice_no: string | null; status: string;
  currency: CurrencyCode; rate_scaled_snapshot: string | null; invoice_date: string; due_date: string | null;
  total_minor: string; subtotal_minor: string; discount_minor: string; tax_minor: string;
  early_payment_days: number | null; early_payment_bp: number | null;
}
interface OpenInvoiceRow extends InvoiceRow {
  settled_minor: string; settled_base_minor: string | null; booked_base_minor: string | null;
}
interface CarriedInvoice { amount: Money; settled: Money; bookedBase: Money; settledBase: Money }
interface OpenLedger { items: OpenItem[]; carried: Map<string, CarriedInvoice> }

function unwrap<T>(r: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: Error }): T {
  if (!r.ok) throw r.error;
  return r.value;
}
function discount(d: z.infer<typeof Discount> | undefined, currency: CurrencyCode): DiscountValue | undefined {
  if (!d) return undefined;
  return d.mode === "PERCENT" ? d : { mode: "AMOUNT", amount: Money.minor(BigInt(d.amountMinor), currency) };
}
function today(): string { return new Date().toISOString().slice(0, 10); }
function required<T>(v: T | undefined, code: string, message: string): T {
  if (v === undefined) throw ApiError.notFound(code, message);
  return v;
}
function inBase(m: Money, rate: bigint | undefined, base: CurrencyCode): Money {
  return unwrap(valueToBase(m, rate, base)).base;
}

@Injectable()
export class PayablesService {
  constructor(@Inject(Db) private readonly db: Db, @Inject(AuthService) private readonly auth: AuthService) {}

  private async tenant(tx: Sql, tenantId: string): Promise<TenantRow> {
    const [row] = await tx<TenantRow[]>`SELECT base_currency, settings FROM tenants WHERE id = ${tenantId}`;
    return required(row, "tenant.not_found", "Tenant not found");
  }

  private async supplier(tx: Sql, tenantId: string, id: string, lock = false): Promise<SupplierRow> {
    const rows = await tx<SupplierRow[]>`SELECT id, is_active, default_currency, payment_terms_days, early_payment_days, early_payment_bp
      FROM suppliers WHERE tenant_id = ${tenantId} AND id = ${id} ${lock ? tx`FOR UPDATE` : tx``}`;
    return required(rows[0], "suppliers.not_found", "Supplier not found");
  }

  private async rate(tx: Sql, currency: CurrencyCode, base: CurrencyCode): Promise<bigint | undefined> {
    return currency === base ? undefined : (await rateFor(tx, currency, base)).sellRateScaled;
  }

  private async audit(tx: Sql, tenantId: string, actor: Actor, type: string, id: string, data: unknown, reason: string | null = null, approvedBy: string | null = null): Promise<void> {
    await tx`INSERT INTO audit_log (tenant_id, actor_user_id, approved_by, action, entity_type, entity_id, after_data, reason)
      VALUES (${tenantId}, ${actor.userId}, ${approvedBy}, ${`${type}.post`}, ${type}, ${id}, ${tx.json(J(data))}, ${reason})`;
  }

  async postSupplierInvoice(tenantId: string, actor: Actor, body: unknown) {
    const req = parse(InvoiceRequest, body);
    if (req.dueDate && req.dueDate < req.invoiceDate) throw ApiError.badRequest("supplier_invoices.invalid_due_date", "Due date precedes invoice date");
    // Authentication owns its own transaction; never open an elevation transaction inside a posting transaction.
    const approval = req.approver ? await this.auth.elevate(tenantId, req.approver, MATCH_OVERRIDE_PERMISSION) : undefined;
    return this.db.tx(tenantId, async (tx) => {
      const tenant = await this.tenant(tx, tenantId);
      const supplier = await this.supplier(tx, tenantId, req.supplierId, true);
      // The supplier lock serializes the application-enforced unique key, including concurrent invoices/payments.
      const duplicate = await tx<{ id: string }[]>`SELECT id FROM supplier_invoices
        WHERE tenant_id = ${tenantId} AND supplier_id = ${req.supplierId} AND supplier_invoice_no = ${req.supplierInvoiceNo} LIMIT 1`;
      if (duplicate.length) throw ApiError.conflict("supplier_invoices.duplicate_number", "Supplier invoice number already exists");
      const settings = parse(Settings, tenant.settings ?? {});
      const rate = await this.rate(tx, req.currency, tenant.base_currency);
      const unitIds = [...new Set(req.lines.map((l) => l.unitId))];
      const units = await tx<UnitRow[]>`SELECT id, item_id, factor_to_ssu, is_ssu FROM item_units
        WHERE tenant_id = ${tenantId} AND id = ANY(${tx.array(unitIds)}::uuid[])`;
      const byUnit = new Map(units.map((u) => [u.id, u]));
      const refIds = req.lines.flatMap((l) => l.grnLineId ? [l.grnLineId] : []);
      const refs = refIds.length === 0 ? [] : await tx<GrnRow[]>`SELECT gl.id, gl.receipt_id, gl.item_id, gl.factor_snapshot,
          gl.ssu_qty_total, gl.unit_cost_minor, gr.currency, lot.total_cost_minor, lot.cost_currency,
          po.factor_snapshot AS po_factor, po.unit_price_minor AS po_price
        FROM goods_receipt_lines gl
        JOIN goods_receipts gr ON gr.id = gl.receipt_id AND gr.tenant_id = gl.tenant_id
        JOIN lots lot ON lot.id = gl.lot_id AND lot.tenant_id = gl.tenant_id
        LEFT JOIN purchase_order_lines po ON po.id = gl.order_line_id AND po.tenant_id = gl.tenant_id
        WHERE gl.tenant_id = ${tenantId} AND gl.id = ANY(${tx.array(refIds)}::uuid[])
          AND gr.supplier_id = ${req.supplierId} AND gr.status = 'POSTED'`;
      const grnLines: GrnLineRef[] = refs.map((r) => ({
        grnId: r.receipt_id, grnLineId: r.id, itemId: r.item_id, factor: BigInt(r.factor_snapshot),
        receivedSsu: BigInt(r.ssu_qty_total), unitCost: Money.minor(BigInt(r.unit_cost_minor), r.currency),
        grniBase: Money.minor(BigInt(r.total_cost_minor), r.cost_currency),
        po: r.po_factor !== null && r.po_price !== null
          ? { factor: BigInt(r.po_factor), unitCost: Money.minor(BigInt(r.po_price), r.currency) } : undefined,
      }));
      const lines = req.lines.map((l) => {
        const unit = required(byUnit.get(l.unitId), "units.not_found", "Unit not found");
        if (unit.item_id !== l.itemId) throw ApiError.badRequest("supplier_invoices.unit_item_mismatch", "Unit belongs to another item");
        return { lineId: randomUUID(), itemId: l.itemId, grnLineId: l.grnLineId, qtyInUnit: BigInt(l.qtyInUnit),
          factor: BigInt(unit.factor_to_ssu), unitCost: Money.minor(BigInt(l.unitCostMinor), req.currency), discount: discount(l.discount, req.currency) };
      });
      const paymentTermsDays = req.dueDate
        ? Math.round((Date.parse(req.dueDate) - Date.parse(req.invoiceDate)) / 86400000) : supplier.payment_terms_days;
      const earlyPayment = req.earlyPayment ?? (supplier.early_payment_days !== null && supplier.early_payment_bp !== null
        ? { days: supplier.early_payment_days, bp: supplier.early_payment_bp } : undefined);
      const invoice = unwrap(SupplierInvoice.create({
        invoiceId: randomUUID(), supplierInvoiceNo: req.supplierInvoiceNo, tenantId, supplierId: req.supplierId,
        supplierStatus: supplier.is_active ? "ACTIVE" : "BLOCKED", invoiceDate: req.invoiceDate,
        currency: req.currency, baseCurrency: tenant.base_currency, rateScaledSnapshot: rate,
        invoiceDiscount: discount(req.invoiceDiscount, req.currency), taxBp: req.taxBp, paymentTermsDays, earlyPayment,
        toleranceQtyBp: settings.match_tolerance_qty_bp, tolerancePriceBp: settings.match_tolerance_price_bp,
        unmatchedReason: req.lines.filter((l) => !l.grnLineId).map((l) => l.unmatchedReason ?? req.reason ?? "").filter(Boolean).join("; ") || undefined,
        lines, grnLines,
      }));
      // An aggregate-level reason must not silently excuse a different unmatched line.
      if (req.lines.some((l) => !l.grnLineId && !l.unmatchedReason && !req.reason)) {
        // Let the aggregate produce its canonical domain error.
        unwrap(SupplierInvoice.create({ ...invoice.header, lines, grnLines, unmatchedReason: undefined }));
      }
      const now = new Date();
      const posted = unwrap(invoice.post({
        entryId: randomUUID(), postedAt: now, accounts: { ap: "2100", grni: "2150", priceVariance: "5150", tax: "1500", direct: "1400" },
        override: approval ? { permission: MATCH_OVERRIDE_PERMISSION, approvedBy: approval.approverId, reason: req.reason ?? "" } : undefined,
      }));
      const [numberRow] = await tx<{ n: string }[]>`SELECT next_document_number(${tenantId}, 'SUPPLIER_INVOICE', '') AS n`;
      const number = required(numberRow, "numbering.not_found", "Invoice numbering unavailable").n;
      const t = invoice.totals;
      await tx`INSERT INTO supplier_invoices (id, tenant_id, number, status, supplier_id, supplier_invoice_no, currency,
        rate_scaled_snapshot, invoice_date, due_date, subtotal_minor, discount_minor, tax_minor, total_minor, early_payment_days, early_payment_bp)
        VALUES (${invoice.invoiceId}, ${tenantId}, ${number}, 'DRAFT', ${req.supplierId}, ${req.supplierInvoiceNo}, ${req.currency}::currency_code,
          ${rate?.toString() ?? null}, ${req.invoiceDate}, ${invoice.dueDate}, ${t.lineGross.amountMinor.toString()},
          ${t.lineDiscount.add(t.invoiceDiscount).amountMinor.toString()}, ${t.tax.amountMinor.toString()}, ${t.total.amountMinor.toString()},
          ${earlyPayment?.days ?? null}, ${earlyPayment?.bp ?? null})`;
      const lineRows = invoice.lines.map((l, i) => {
        const input = required(req.lines[i], "supplier_invoices.line_not_found", "Invoice line missing");
        const net = required(t.lineNets[i], "supplier_invoices.line_not_found", "Invoice net missing");
        return { id: l.lineId, tenant_id: tenantId, invoice_id: invoice.invoiceId, receipt_line_id: input.grnLineId ?? null,
          kind: "ITEM", description: JSON.stringify(J({ itemId: input.itemId, unitId: input.unitId, factor: l.factor,
            discount: input.discount, unmatchedReason: input.unmatchedReason ?? req.reason, match: l.match.status })),
          qty_in_unit: input.qtyInUnit, unit_price_minor: l.unitCost.amountMinor.toString(), amount_minor: net.amountMinor.toString() };
      });
      await tx`INSERT INTO supplier_invoice_lines ${tx(lineRows)}`;
      await tx`UPDATE supplier_invoices SET status = 'POSTED', posted_at = ${now}, posted_by = ${actor.userId}
        WHERE tenant_id = ${tenantId} AND id = ${invoice.invoiceId}`;
      await persistEntry(tx, tenantId, posted.entry, req.invoiceDate, actor.userId);
      const result = { id: invoice.invoiceId, number, status: posted.invoice.status, dueDate: invoice.dueDate,
        entryId: posted.entry.entryId, matchStatus: invoice.matchStatus, totals: t, priceVariances: posted.priceVariances,
        approvedBy: posted.override?.approvedBy ?? null };
      await this.audit(tx, tenantId, actor, "supplier_invoices", invoice.invoiceId, result, req.reason ?? null, posted.override?.approvedBy ?? null);
      return J(result);
    });
  }

  async postPurchaseReturn(tenantId: string, actor: Actor, body: unknown) {
    const req = parse(ReturnRequest, body);
    return this.db.tx(tenantId, async (tx) => {
      const tenant = await this.tenant(tx, tenantId);
      const supplier = await this.supplier(tx, tenantId, req.supplierId, true);
      const [location] = await tx<{ id: string }[]>`SELECT id FROM locations WHERE tenant_id = ${tenantId} AND id = ${req.locationId}`;
      required(location, "locations.not_found", "Location not found");
      const currency = supplier.default_currency ?? tenant.base_currency;
      const rate = await this.rate(tx, currency, tenant.base_currency);
      const ids = [...new Set(req.lines.map((l) => l.lotId))].sort();
      const lots = await tx<LotRow[]>`SELECT * FROM lots WHERE tenant_id = ${tenantId} AND id = ANY(${tx.array(ids)}::uuid[]) ORDER BY id FOR UPDATE`;
      const byLot = new Map(lots.map((l) => [l.id, l]));
      const balances = await tx<{ lot_id: string; qty_ssu: string }[]>`SELECT lot_id, qty_ssu::text FROM stock_balances
        WHERE tenant_id = ${tenantId} AND location_id = ${req.locationId} AND lot_id = ANY(${tx.array(ids)}::uuid[])`;
      const byBalance = new Map(balances.map((b) => [b.lot_id, BigInt(b.qty_ssu)]));
      const itemIds = [...new Set(lots.map((l) => l.item_id))];
      const units = itemIds.length === 0 ? [] : await tx<UnitRow[]>`SELECT id, item_id, factor_to_ssu, is_ssu FROM item_units
        WHERE tenant_id = ${tenantId} AND item_id = ANY(${tx.array(itemIds)}::uuid[]) AND is_ssu = true`;
      const ssuUnits = new Map(units.map((u) => [u.item_id, u]));
      const lines = req.lines.map((l) => {
        const row = required(byLot.get(l.lotId), "lots.not_found", "Lot not found");
        if (row.supplier_id !== null && row.supplier_id !== req.supplierId) throw ApiError.conflict("purchase_returns.supplier_mismatch", "Lot belongs to another supplier");
        const unit = required(ssuUnits.get(row.item_id), "units.not_found", "SSU unit not found");
        if (BigInt(unit.factor_to_ssu) !== 1n) throw ApiError.conflict("purchase_returns.invalid_ssu_unit", "SSU unit must have factor one");
        const lot = unwrap(Lot.create({ lotId: row.id, itemId: row.item_id, lotNumber: row.lot_number,
          expiryDate: row.expiry_date ?? "9999-12-31", qtyReceivedSsu: BigInt(row.qty_received_ssu),
          totalCostMinor: Money.minor(BigInt(row.total_cost_minor), row.cost_currency), sourceType: row.source_type,
          supplierId: row.supplier_id ?? undefined, manualStatus: row.manual_status,
          printedPublicPriceMinor: row.printed_public_price_minor === null ? undefined : Money.minor(BigInt(row.printed_public_price_minor), row.cost_currency),
        }));
        return { lineId: randomUUID(), itemId: row.item_id, lot, onHandSsu: byBalance.get(row.id) ?? 0n,
          qtySsu: BigInt(l.qtySsu), reason: req.reason,
          agreedCreditPerSsu: l.agreedCreditPerSsuMinor === undefined ? undefined : Money.minor(BigInt(l.agreedCreditPerSsuMinor), currency) };
      });
      const [numberRow] = await tx<{ n: string }[]>`SELECT next_document_number(${tenantId}, 'PURCHASE_RETURN', '') AS n`;
      const number = required(numberRow, "numbering.not_found", "Return numbering unavailable").n;
      const date = req.businessDate ?? today();
      const now = new Date();
      const purchaseReturn = unwrap(PurchaseReturn.create({ returnId: randomUUID(), returnNo: number, debitNoteNo: number,
        tenantId, supplierId: req.supplierId, locationId: req.locationId, returnDate: date, occurredAt: now.toISOString(),
        currency, baseCurrency: tenant.base_currency, rateScaledSnapshot: rate, lines }));
      const movementIds: string[] = [];
      const posted = unwrap(purchaseReturn.post({ entryId: randomUUID(), postedAt: now,
        newId: () => { const id = randomUUID(); movementIds.push(id); return id; }, accounts: { ap: "2100", returnLoss: "5250" } }));
      await tx`INSERT INTO purchase_returns (id, tenant_id, number, status, supplier_id, location_id, currency, business_date, total_minor, reason)
        VALUES (${purchaseReturn.returnId}, ${tenantId}, ${number}, 'DRAFT', ${req.supplierId}, ${req.locationId}, ${currency}::currency_code,
          ${date}, ${posted.totals.creditForeign.amountMinor.toString()}, ${req.reason})`;
      const returnLines = purchaseReturn.lines.map((l) => ({ id: l.lineId, tenant_id: tenantId, return_id: purchaseReturn.returnId,
        item_id: l.itemId, lot_id: l.lotId, unit_id: required(ssuUnits.get(l.itemId), "units.not_found", "SSU unit not found").id,
        factor_snapshot: "1", qty_in_unit: l.qtySsu.toString(), ssu_qty: l.qtySsu.toString(),
        unit_cost_minor_snapshot: l.cost.divide(l.qtySsu).amountMinor.toString(), amount_minor: l.creditForeign.amountMinor.toString() }));
      await tx`INSERT INTO purchase_return_lines ${tx(returnLines)}`;
      const movements = purchaseReturn.lines.map((l, i) => ({
        id: required(movementIds[i], "purchase_returns.movement_not_found", "Return movement missing"), tenant_id: tenantId,
        item_id: l.itemId, lot_id: l.lotId, location_id: req.locationId, movement_type: "PURCHASE_RETURN",
        qty_delta_ssu: (-l.qtySsu).toString(), unit_cost_minor_snapshot: l.cost.divide(l.qtySsu).amountMinor.toString(),
        cost_currency: l.cost.currency, unit_id: required(ssuUnits.get(l.itemId), "units.not_found", "SSU unit missing").id,
        factor_snapshot: "1", qty_in_unit: l.qtySsu.toString(), document_type: "PURCHASE_RETURN", document_id: purchaseReturn.returnId,
        document_line_id: l.lineId, business_date: date, occurred_at: now, created_by: actor.userId,
      }));
      await tx`INSERT INTO stock_movements ${tx(movements)}`;
      // A location can be emptied while the same lot still exists elsewhere. Never disable that remaining stock.
      if (posted.fullyReturnedLotIds.length) {
        await tx`UPDATE lots l SET manual_status = 'RETURNED_TO_SUPPLIER'::lot_manual_status, status_reason = ${req.reason},
          status_changed_by = ${actor.userId}, status_changed_at = ${now}, updated_at = ${now}, version = version + 1
          WHERE l.tenant_id = ${tenantId} AND l.id = ANY(${tx.array([...posted.fullyReturnedLotIds])}::uuid[])
            AND NOT EXISTS (SELECT 1 FROM stock_balances b WHERE b.tenant_id = l.tenant_id AND b.lot_id = l.id AND b.qty_ssu <> 0)`;
      }
      await tx`UPDATE purchase_returns SET status = 'POSTED', posted_at = ${now}, posted_by = ${actor.userId}
        WHERE tenant_id = ${tenantId} AND id = ${purchaseReturn.returnId}`;
      await persistEntry(tx, tenantId, posted.entry, date, actor.userId);
      const result = { id: purchaseReturn.returnId, number, debitNoteNo: number, status: posted.purchaseReturn.status,
        entryId: posted.entry.entryId, totals: posted.totals, lines: purchaseReturn.lines, rateScaledSnapshot: rate };
      await this.audit(tx, tenantId, actor, "purchase_returns", purchaseReturn.returnId, result, req.reason);
      return J(result);
    });
  }

  private async openLedger(tx: Sql, tenantId: string, supplierId: string, base: CurrencyCode): Promise<OpenLedger> {
    const invoices = await tx<OpenInvoiceRow[]>`WITH settled AS (
        SELECT a->>'documentId' AS invoice_id, SUM((a->>'amountMinor')::bigint)::text AS settled_minor,
          CASE WHEN bool_and(a ? 'payableBaseMinor') THEN SUM((a->>'payableBaseMinor')::bigint)::text ELSE NULL END AS settled_base_minor
        FROM party_payments p CROSS JOIN LATERAL jsonb_array_elements(p.allocations) a
        WHERE p.tenant_id = ${tenantId} AND p.supplier_id = ${supplierId} AND p.party_type = 'SUPPLIER' AND p.status = 'POSTED'
          AND a->>'documentType' = 'SUPPLIER_INVOICE' GROUP BY a->>'documentId'
      ), booked AS (
        SELECT e.document_id, SUM(l.credit_minor - l.debit_minor)::text AS booked_base_minor
        FROM journal_entries e JOIN journal_lines l ON l.entry_id = e.id AND l.tenant_id = e.tenant_id
        WHERE e.tenant_id = ${tenantId} AND e.document_type = 'SUPPLIER_INVOICE' AND l.account_code = '2100'
          AND l.dim_supplier_id = ${supplierId} GROUP BY e.document_id
      ) SELECT i.*, COALESCE(s.settled_minor, '0') AS settled_minor, s.settled_base_minor, b.booked_base_minor
        FROM supplier_invoices i LEFT JOIN settled s ON s.invoice_id = i.id::text LEFT JOIN booked b ON b.document_id = i.id
        WHERE i.tenant_id = ${tenantId} AND i.supplier_id = ${supplierId} AND i.status = 'POSTED'
        ORDER BY i.due_date, i.id`;
    const items: OpenItem[] = [];
    const carried = new Map<string, CarriedInvoice>();
    for (const row of invoices) {
      const amount = Money.minor(BigInt(row.total_minor), row.currency);
      const settled = Money.minor(BigInt(row.settled_minor), row.currency);
      const bookedBase = row.booked_base_minor === null
        ? inBase(amount, row.rate_scaled_snapshot === null ? undefined : BigInt(row.rate_scaled_snapshot), base)
        : Money.minor(BigInt(row.booked_base_minor), base);
      const settledBase = row.settled_base_minor === null
        ? (amount.isZero() ? Money.zero(base) : bookedBase.multiply(settled.amountMinor).divide(amount.amountMinor))
        : Money.minor(BigInt(row.settled_base_minor), base);
      items.push({ id: row.id, kind: "INVOICE", date: row.invoice_date, dueDate: row.due_date ?? row.invoice_date,
        amount, remaining: amount.subtract(settled) });
      carried.set(row.id, { amount, settled, bookedBase, settledBase });
    }
    const credits = await tx<{ id: string; business_date: string; currency: CurrencyCode; total_minor: string }[]>`
      SELECT id, business_date, currency, total_minor FROM purchase_returns
      WHERE tenant_id = ${tenantId} AND supplier_id = ${supplierId} AND status = 'POSTED' ORDER BY business_date, id`;
    for (const row of credits) {
      const amount = Money.minor(BigInt(row.total_minor), row.currency);
      items.push({ id: row.id, kind: "CREDIT_NOTE", date: row.business_date, amount, remaining: amount });
    }
    const payments = await tx<{ id: string; business_date: string; currency: CurrencyCode; amount_minor: string; allocated_minor: string }[]>`
      SELECT p.id, p.business_date, p.currency, p.amount_minor,
        COALESCE(SUM(COALESCE(a->>'cashAmountMinor', a->>'amountMinor')::bigint), 0)::text AS allocated_minor
      FROM party_payments p LEFT JOIN LATERAL jsonb_array_elements(p.allocations) a ON true
      WHERE p.tenant_id = ${tenantId} AND p.supplier_id = ${supplierId} AND p.party_type = 'SUPPLIER' AND p.status = 'POSTED'
      GROUP BY p.id ORDER BY p.business_date, p.id`;
    for (const row of payments) {
      const amount = Money.minor(BigInt(row.amount_minor), row.currency);
      items.push({ id: row.id, kind: "PAYMENT", date: row.business_date, amount,
        remaining: amount.subtract(Money.minor(BigInt(row.allocated_minor), row.currency)) });
    }
    return { items, carried };
  }

  async paySupplier(tenantId: string, actor: Actor, body: unknown) {
    const req = parse(PaymentRequest, body);
    return this.db.tx(tenantId, async (tx) => {
      const tenant = await this.tenant(tx, tenantId);
      const supplier = await this.supplier(tx, tenantId, req.supplierId, true);
      const [cashbox] = await tx<{ id: string; kind: "REGISTER" | "SAFE" | "BANK" | "WALLET"; is_active: boolean }[]>`
        SELECT id, kind, is_active FROM cashboxes WHERE tenant_id = ${tenantId} AND id = ${req.cashboxId} FOR UPDATE`;
      const box = required(cashbox, "cashboxes.not_found", "Cashbox not found");
      if (!box.is_active) throw ApiError.conflict("cashboxes.inactive", "Cashbox is inactive");
      if ((req.method === "CASH" && box.kind !== "REGISTER" && box.kind !== "SAFE") ||
          (req.method === "CARD" && box.kind !== "BANK") || (req.method === "WALLET" && box.kind !== "WALLET")) {
        throw ApiError.badRequest("payables.method_cashbox_mismatch", "Payment method does not match funds account");
      }
      let shiftId: string | null = null;
      if (box.kind === "REGISTER") {
        const [shift] = await tx<{ id: string }[]>`SELECT id FROM shifts WHERE tenant_id = ${tenantId} AND cashbox_id = ${box.id}
          AND cashier_id = ${actor.userId} AND status = 'OPEN' ORDER BY opened_at DESC LIMIT 1 FOR UPDATE`;
        if (!shift) throw ApiError.conflict("shifts.open_required", "An open shift for this cashier and register is required");
        shiftId = shift.id;
      }
      const rate = await this.rate(tx, req.currency, tenant.base_currency);
      const ledger = await this.openLedger(tx, tenantId, req.supplierId, tenant.base_currency);
      const id = randomUUID();
      const date = req.businessDate ?? today();
      const amount = Money.minor(BigInt(req.amountMinor), req.currency);
      const strategy: AllocationStrategy = req.allocation.mode === "EXPLICIT"
        ? { mode: "EXPLICIT", targets: req.allocation.targets.map((t) => ({ itemId: t.itemId, amount: Money.minor(BigInt(t.amountMinor), req.currency) })) }
        : { mode: req.allocation.mode };
      const terms = supplier.early_payment_days !== null && supplier.early_payment_bp !== null
        ? { withinDays: supplier.early_payment_days, discountBp: supplier.early_payment_bp } : undefined;
      const allocation = unwrap(allocatePayment(ledger.items, { id, date, amount }, strategy, terms));
      let payableBase = inBase(allocation.unallocated, rate, tenant.base_currency);
      const allocations = allocation.allocations.map((a) => {
        const invoice = required(ledger.carried.get(a.itemId), "supplier_invoices.not_found", "Allocated invoice missing");
        const settled = a.applied.add(a.discount);
        // Cumulative valuation leaves the exact booked residual on the final settlement.
        const cumulative = invoice.settled.add(settled);
        const cumulativeBase = cumulative.equals(invoice.amount) ? invoice.bookedBase
          : invoice.bookedBase.multiply(cumulative.amountMinor).divide(invoice.amount.amountMinor);
        const carriedBase = cumulativeBase.subtract(invoice.settledBase);
        payableBase = payableBase.add(carriedBase);
        return { documentType: "SUPPLIER_INVOICE", documentId: a.itemId, amountMinor: settled.amountMinor.toString(),
          cashAmountMinor: a.applied.amountMinor.toString(), discountMinor: a.discount.amountMinor.toString(), payableBaseMinor: carriedBase.amountMinor.toString() };
      });
      const discountBase = inBase(allocation.discountTotal, rate, tenant.base_currency);
      const now = new Date();
      const entry = unwrap(postSupplierPayment({
        meta: { entryId: randomUUID(), tenantId, baseCurrency: tenant.base_currency, postedAt: now, documentRef: { type: "SUPPLIER_PAYMENT", id } },
        supplierId: req.supplierId, via: { kind: box.kind === "BANK" ? "BANK" : box.kind === "WALLET" ? "WALLET" : "CASH", id: box.id },
        amount, rateScaled: rate, payableBase,
        ...(discountBase.isPositive() ? { earlyPaymentDiscount: discountBase, discountAccountCode: "4300" } : {}),
      }));
      const [numberRow] = await tx<{ n: string }[]>`SELECT next_document_number(${tenantId}, 'PAYMENT', '') AS n`;
      const number = required(numberRow, "numbering.not_found", "Payment numbering unavailable").n;
      await tx`INSERT INTO party_payments (id, tenant_id, number, status, party_type, supplier_id, cashbox_id, shift_id,
        method, currency, amount_minor, rate_scaled_snapshot, allocations, business_date, reference, posted_at, posted_by)
        VALUES (${id}, ${tenantId}, ${number}, 'POSTED', 'SUPPLIER', ${req.supplierId}, ${box.id}, ${shiftId},
          ${req.method}::payment_method, ${req.currency}::currency_code, ${amount.amountMinor.toString()}, ${rate?.toString() ?? null},
          ${tx.json(J(allocations))}, ${date}, ${req.reference ?? null}, ${now}, ${actor.userId})`;
      await tx`INSERT INTO cash_movements (tenant_id, cashbox_id, shift_id, currency, amount_minor, kind, rate_scaled_snapshot,
        document_type, document_id, reason, occurred_at, created_by)
        VALUES (${tenantId}, ${box.id}, ${shiftId}, ${req.currency}::currency_code, ${amount.negate().amountMinor.toString()},
          'SUPPLIER_PAYMENT', ${rate?.toString() ?? null}, 'SUPPLIER_PAYMENT', ${id}, ${req.reference ?? null}, ${now}, ${actor.userId})`;
      await persistEntry(tx, tenantId, entry, date, actor.userId);
      const result = { id, number, status: "POSTED", entryId: entry.entryId, amount, allocations,
        allocatedTotal: allocation.allocatedTotal, discountTotal: allocation.discountTotal, unallocated: allocation.unallocated };
      await this.audit(tx, tenantId, actor, "supplier_payments", id, result);
      return J(result);
    });
  }

  async supplierLedger(tenantId: string, supplierId: string) {
    parse(Id, supplierId);
    return this.db.tx(tenantId, async (tx) => {
      const tenant = await this.tenant(tx, tenantId);
      await this.supplier(tx, tenantId, supplierId);
      const ledger = await this.openLedger(tx, tenantId, supplierId, tenant.base_currency);
      const asOf = today();
      return J({ supplierId, asOf, items: ledger.items, aging: unwrap(aging(ledger.items, asOf)), balances: unwrap(balance(ledger.items)) });
    });
  }

  async listInvoices(tenantId: string, query: unknown = {}) {
    const q = parse(ListRequest, query);
    return this.db.tx(tenantId, async (tx) => {
      const rows = await tx<InvoiceRow[]>`SELECT * FROM supplier_invoices WHERE tenant_id = ${tenantId}
        ${q.supplierId ? tx`AND supplier_id = ${q.supplierId}` : tx``}
        ${q.from ? tx`AND invoice_date >= ${q.from}::date` : tx``}
        ${q.to ? tx`AND invoice_date <= ${q.to}::date` : tx``}
        ${q.status ? tx`AND status = ${q.status}::document_status` : tx``}
        ORDER BY invoice_date DESC, id DESC LIMIT ${q.limit} OFFSET ${q.offset}`;
      return J({ items: rows, limit: q.limit, offset: q.offset });
    });
  }

  async getInvoice(tenantId: string, id: string) {
    parse(Id, id);
    return this.db.tx(tenantId, async (tx) => {
      const [invoice] = await tx<InvoiceRow[]>`SELECT * FROM supplier_invoices WHERE tenant_id = ${tenantId} AND id = ${id}`;
      required(invoice, "supplier_invoices.not_found", "Supplier invoice not found");
      const lines = await tx`SELECT * FROM supplier_invoice_lines WHERE tenant_id = ${tenantId} AND invoice_id = ${id} ORDER BY id`;
      return J({ invoice, lines });
    });
  }
}
