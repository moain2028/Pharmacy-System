import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import { Money, SalesReturn, salesReturnPosted, type CurrencyCode, type PostedInvoiceSnapshot } from "@pharmacore/domain";
import type { Sql } from "@pharmacore/db";
import { AuthService } from "../identity/auth.service.js";
import { Db } from "../infra/db.js";
import { ApiError } from "../shared/errors.js";
import { convertScaled, J, persistEntry, rateFor } from "../shared/journal.js";

type Snap = PostedInvoiceSnapshot;
type IsoDate = Snap["businessDate"];
type SoldLine = Snap["lines"][number];
type SoldLot = SoldLine["lots"][number];
type ManualStatus = SoldLot["manualStatus"];
type Paid = Snap["payments"][number];
type ReturnEvent = Parameters<typeof salesReturnPosted>[1];
type Refund = ReturnEvent["refunds"][number];
type LotIntent = ReturnType<SalesReturn["lotIntents"]>[number];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const intStr = z.string().regex(/^\d+$/);

export const ReturnRequestSchema = z.object({
  invoiceId: z.string().uuid(),
  lines: z.array(z.object({ lineId: z.string().uuid(), qtySsu: intStr })).min(1).max(200),
  reason: z.object({ code: z.string().trim().min(1).max(40), text: z.string().max(500).optional() }),
  businessDate: isoDate.optional(),
  refundToCustomerCredit: z.boolean().optional(),
  approver: z.object({ username: z.string().min(1), secret: z.string().min(1) }).optional(),
});
export type ReturnRequest = z.infer<typeof ReturnRequestSchema>;

export const ReturnListSchema = z.object({
  from: isoDate.optional(), to: isoDate.optional(), invoiceId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0),
});
export type ReturnListQuery = z.infer<typeof ReturnListSchema>;

export interface ReturnActor {
  readonly userId: string;
  readonly permissions: ReadonlySet<string>;
}

interface InvRow { id: string; number: string | null; status: string; currency: CurrencyCode; business_date: string | Date; customer_id: string | null; rate_scaled_snapshot: string | null; credit_minor: string }
interface LineRow { id: string; item_id: string; unit_id: string; factor_snapshot: string; ssu_qty: string; net_minor: string; tax_minor: string; tax_bp: number; is_returnable: boolean | null }
interface LotRow { line_id: string; lot_id: string; location_id: string; ssu_qty: string; cost_minor: string; expiry_date: string | Date | null; manual_status: string }
interface RetRow { original_line_id: string; lot_id: string; q: string }
interface PayRow { method: string; amt: string }
interface Loaded { inv: InvRow; base: CurrencyCode; windowDays: number; snap: Snap; lines: Map<string, LineRow>; lotLoc: Map<string, string> }
interface Plan { id: string; src: LineRow; lot: LotIntent; refund: Money; unitId: string; factor: bigint; qtyInUnit: bigint; ssuFallback: boolean; location: string }

const isoOf = (v: string | Date | null): string | null => (v === null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const today = (): string => new Date().toISOString().slice(0, 10);
/** Half-Up division for non-negative operands. */
const halfUp = (n: bigint, d: bigint): bigint => (2n * n + d) / (2n * d);

@Injectable()
export class ReturnsService {
  constructor(@Inject(Db) private readonly db: Db, @Inject(AuthService) private readonly auth: AuthService) {}

  async quote(tenantId: string, actor: ReturnActor, req: ReturnRequest): Promise<unknown> {
    const approverId = await this.elevate(tenantId, req);
    const businessDate = req.businessDate ?? today();
    return this.db.tx(tenantId, async (tx) => {
      const L = await this.load(tx, tenantId, req.invoiceId, false);
      const perms = await this.permsFor(tx, actor, approverId);
      const draft = this.draft(L, req, perms, randomUUID(), businessDate);
      return J({ invoiceId: L.inv.id, invoiceNumber: L.inv.number, ...this.view(draft, this.vatShare(L, draft)) });
    });
  }

  async post(tenantId: string, actor: ReturnActor, req: ReturnRequest): Promise<unknown> {
    const approverId = await this.elevate(tenantId, req);
    const businessDate = req.businessDate ?? today();
    const returnId = randomUUID();
    return this.db.tx(tenantId, async (tx) => {
      const L = await this.load(tx, tenantId, req.invoiceId, true);
      const perms = await this.permsFor(tx, actor, approverId);
      const draft = this.draft(L, req, perms, returnId, businessDate);
      const vat = this.vatShare(L, draft);
      const posted = draft.post();
      if (!posted.ok) throw posted.error;
      const ret = posted.value;
      const intentR = ret.postingIntent();
      if (!intentR.ok) throw intentR.error;
      const intent = intentR.value;
      const cashRefunds = ret.refunds.filter((r) => r.method === "CASH" && r.amount.isPositive());
      const [shift] = await tx<{ id: string; cashbox_id: string }[]>`SELECT id, cashbox_id FROM shifts WHERE cashier_id = ${actor.userId} AND status = 'OPEN' ORDER BY opened_at DESC LIMIT 1`;
      if (cashRefunds.length > 0 && !shift) throw ApiError.conflict("shift.not_open", "An open shift is required to refund cash");
      const [num] = await tx<{ n: string }[]>`SELECT next_document_number(${tenantId}, 'SALES_RETURN', '') AS n`;
      if (!num) throw ApiError.conflict("numbering.failed", "Could not allocate a return number");
      const reasonText = req.reason.text ? `${req.reason.code}: ${req.reason.text}` : req.reason.code;

      await tx`INSERT INTO sales_returns (id, tenant_id, number, status, original_invoice_id, customer_id, shift_id, cashier_id, currency, business_date, refund_total_minor, reason, approved_by)
        VALUES (${returnId}, ${tenantId}, ${num.n}, 'DRAFT', ${L.inv.id}, ${L.inv.customer_id}, ${shift?.id ?? null}, ${actor.userId}, ${ret.currency}::currency_code, ${businessDate}::date,
                ${ret.refundTotal.amountMinor.toString()}, ${reasonText}, ${approverId})`;

      const plans: Plan[] = [];
      const ssuItems = new Set<string>();
      for (const rl of ret.lines) {
        const src = rl.lineId === null ? undefined : L.lines.get(rl.lineId);
        if (!src) throw ApiError.conflict("return.line_missing", "Original invoice line not found", { lineId: rl.lineId });
        if (rl.lots.length === 0) continue;
        const shares = rl.refundMinor.allocate(rl.lots.map((x) => Number(x.qtySsu)));
        const factor = BigInt(src.factor_snapshot);
        rl.lots.forEach((lot, i) => {
          const location = L.lotLoc.get(`${src.id}|${lot.lotId}`);
          if (location === undefined) throw ApiError.conflict("return.lot_missing", "Lot allocation not found", { lineId: src.id, lotId: lot.lotId });
          const divisible = lot.qtySsu % factor === 0n;
          if (!divisible) ssuItems.add(src.item_id);
          plans.push({
            id: randomUUID(), src, lot, refund: shares[i] ?? Money.zero(ret.currency), unitId: src.unit_id,
            factor: divisible ? factor : 1n, qtyInUnit: divisible ? lot.qtySsu / factor : lot.qtySsu, ssuFallback: !divisible, location,
          });
        });
      }
      if (ssuItems.size > 0) {
        const us = await tx<{ item_id: string; id: string }[]>`SELECT DISTINCT ON (item_id) item_id, id FROM item_units
          WHERE item_id = ANY(${[...ssuItems]}::uuid[]) AND factor_to_ssu = 1 ORDER BY item_id, id`;
        const byItem = new Map(us.map((u) => [u.item_id, u.id] as const));
        for (const p of plans) {
          if (!p.ssuFallback) continue;
          const u = byItem.get(p.src.item_id);
          if (u === undefined) throw ApiError.conflict("uom.ssu_unit_missing", "Item has no SSU unit", { itemId: p.src.item_id });
          p.unitId = u;
        }
      }
      if (plans.length > 0) {
        const lineRows = plans.map((p) => ({
          id: p.id, tenant_id: tenantId, return_id: returnId, original_line_id: p.src.id, item_id: p.lot.itemId, lot_id: p.lot.lotId,
          unit_id: p.unitId, factor_snapshot: p.factor.toString(), qty_in_unit: p.qtyInUnit.toString(), ssu_qty: p.lot.qtySsu.toString(),
          refund_unit_price_minor: (p.refund.amountMinor / p.lot.qtySsu).toString(), refund_minor: p.refund.amountMinor.toString(),
          cost_minor_snapshot: p.lot.costMinor.amountMinor.toString(),
        }));
        await tx`INSERT INTO sales_return_lines ${tx(lineRows)}`;
        const moveRows = plans.map((p) => ({
          tenant_id: tenantId, item_id: p.lot.itemId, lot_id: p.lot.lotId, location_id: p.location, movement_type: "SALE_RETURN",
          qty_delta_ssu: p.lot.qtySsu.toString(), unit_cost_minor_snapshot: (p.lot.costMinor.amountMinor / p.lot.qtySsu).toString(), cost_currency: L.base,
          unit_id: p.unitId, factor_snapshot: p.factor.toString(), qty_in_unit: p.qtyInUnit.toString(), document_type: "SALES_RETURN",
          document_id: returnId, document_line_id: p.id, business_date: businessDate, created_by: actor.userId,
        }));
        await tx`INSERT INTO stock_movements ${tx(moveRows)}`;
      }
      for (const dest of ["QUARANTINED", "BLOCKED"] as const) {
        const ids = [...new Set(plans.filter((p) => p.lot.destination === dest).map((p) => p.lot.lotId))];
        if (ids.length === 0) continue;
        await tx`UPDATE lots SET manual_status = ${dest}::lot_manual_status, status_reason = ${`Sales return ${num.n}: ${reasonText}`},
            status_changed_by = ${actor.userId}, status_changed_at = now(), updated_at = now(), version = version + 1
          WHERE id = ANY(${ids}::uuid[]) AND manual_status = 'NONE'`;
      }

      let rate: bigint | undefined;
      if (ret.currency !== L.base) {
        rate = L.inv.rate_scaled_snapshot !== null ? BigInt(L.inv.rate_scaled_snapshot) : (await rateFor(tx, ret.currency, L.base)).sellRateScaled;
      }
      const conv = (m: Money): Money => (rate === undefined ? m : convertScaled(m, rate, L.base));

      if (cashRefunds.length > 0 && shift) {
        const cashRows = cashRefunds.map((r) => ({
          tenant_id: tenantId, cashbox_id: shift.cashbox_id, shift_id: shift.id, currency: ret.currency, amount_minor: (-r.amount.amountMinor).toString(),
          kind: "SALE_REFUND", rate_scaled_snapshot: rate === undefined ? null : rate.toString(), document_type: "SALES_RETURN", document_id: returnId,
          reason: reasonText, created_by: actor.userId,
        }));
        await tx`INSERT INTO cash_movements ${tx(cashRows)}`;
      }

      const refunds: Refund[] = [];
      for (const r of ret.refunds) {
        if (!r.amount.isPositive()) continue;
        if (r.method === "CASH" && shift) refunds.push({ via: { kind: "CASH", id: shift.cashbox_id }, amount: r.amount, rateScaled: rate });
        else if (r.method === "CARD") refunds.push({ via: { kind: "BANK", id: "BANK" }, amount: r.amount, rateScaled: rate });
        else if (r.method === "WALLET") refunds.push({ via: { kind: "WALLET", id: "WALLET" }, amount: r.amount, rateScaled: rate });
      }
      const entryR = salesReturnPosted(
        { entryId: randomUUID(), tenantId, postedAt: new Date(), baseCurrency: L.base },
        {
          returnId, originalInvoiceId: L.inv.id, customerId: L.inv.customer_id ?? undefined,
          returnedNet: conv(ret.refundTotal.subtract(vat)), outputVat: conv(vat), refunds,
          restock: intent.lotCosts.map((lc) => ({ itemId: lc.itemId, lotId: lc.lotId, cost: Money.minor(lc.cost.amountMinor, L.base) })),
        },
      );
      if (!entryR.ok) throw entryR.error;
      await tx`UPDATE sales_returns SET status = 'POSTED', posted_at = now(), posted_by = ${actor.userId}, updated_at = now() WHERE id = ${returnId}`;
      await persistEntry(tx, tenantId, entryR.value, businessDate, actor.userId);
      const view = this.view(ret, vat);
      await tx`INSERT INTO audit_log (tenant_id, actor_user_id, approved_by, action, entity_type, entity_id, after_data, reason)
        VALUES (${tenantId}, ${actor.userId}, ${approverId}, 'returns.post', 'sales_return', ${returnId},
                ${tx.json(J({ number: num.n, invoiceId: L.inv.id, refundTotalMinor: view.refundTotalMinor, refunds: ret.refunds, lines: plans.length }))}, ${reasonText})`;
      return J({ id: returnId, number: num.n, status: "POSTED", invoiceId: L.inv.id, shiftId: shift?.id ?? null, approvedBy: approverId, journalEntryId: entryR.value.entryId, ...view });
    });
  }

  async get(tenantId: string, id: string): Promise<unknown> {
    return this.db.tx(tenantId, async (tx) => {
      const [h] = await tx`SELECT r.*, si.number AS invoice_number FROM sales_returns r LEFT JOIN sales_invoices si ON si.id = r.original_invoice_id WHERE r.id = ${id}`;
      if (!h) throw ApiError.notFound("return.not_found", "Sales return not found");
      const lines = await tx`SELECT * FROM sales_return_lines WHERE return_id = ${id} ORDER BY original_line_id, lot_id`;
      return J({ return: h, lines });
    });
  }

  async list(tenantId: string, q: ReturnListQuery): Promise<unknown> {
    const from = q.from ?? null;
    const to = q.to ?? null;
    const inv = q.invoiceId ?? null;
    return this.db.tx(tenantId, async (tx) => {
      const rows = await tx`SELECT r.id, r.number, r.status, r.original_invoice_id, si.number AS invoice_number, r.customer_id, r.currency, r.business_date,
          r.refund_total_minor, r.reason, r.cashier_id, r.posted_at
        FROM sales_returns r LEFT JOIN sales_invoices si ON si.id = r.original_invoice_id
        WHERE (${from}::date IS NULL OR r.business_date >= ${from}::date) AND (${to}::date IS NULL OR r.business_date <= ${to}::date)
          AND (${inv}::uuid IS NULL OR r.original_invoice_id = ${inv}::uuid)
        ORDER BY r.business_date DESC, r.created_at DESC LIMIT ${q.limit} OFFSET ${q.offset}`;
      return J({ rows, limit: q.limit, offset: q.offset });
    });
  }

  // ------------------------------------------------------------------ internals

  private async elevate(tenantId: string, req: ReturnRequest): Promise<string | null> {
    if (req.approver === undefined) return null;
    const { approverId } = await this.auth.elevate(tenantId, req.approver, "returns.post");
    return approverId;
  }

  private async permsFor(tx: Sql, actor: ReturnActor, approverId: string | null): Promise<Set<string>> {
    const s = new Set<string>(actor.permissions);
    if (approverId !== null) {
      const a = await this.auth.loadAccess(tx, approverId);
      for (const p of a.permissions) s.add(p);
    }
    return s;
  }

  private draft(L: Loaded, req: ReturnRequest, perms: ReadonlySet<string>, returnId: string, businessDate: string): SalesReturn {
    const r = SalesReturn.create(
      {
        returnId, invoice: L.snap, businessDate: businessDate as IsoDate, reason: { code: req.reason.code, text: req.reason.text },
        lines: req.lines.map((l) => ({ lineId: l.lineId, qtySsu: BigInt(l.qtySsu) })), refundToCustomerCredit: req.refundToCustomerCredit,
        permissions: [...perms],
      },
      { defaultReturnWindowDays: L.windowDays },
    );
    if (!r.ok) throw r.error;
    return r.value;
  }

  /** Σ per returned line: original tax_minor × returned qty / line qty (Half-Up); zero when tax_bp = 0. */
  private vatShare(L: Loaded, ret: SalesReturn): Money {
    let v = 0n;
    for (const rl of ret.lines) {
      const src = rl.lineId === null ? undefined : L.lines.get(rl.lineId);
      if (!src || src.tax_bp === 0) continue;
      v += halfUp(BigInt(src.tax_minor) * rl.qtySsu, BigInt(src.ssu_qty));
    }
    return Money.minor(v, ret.currency);
  }

  private view(ret: SalesReturn, vat: Money) {
    return {
      currency: ret.currency, businessDate: ret.businessDate, refundTotalMinor: ret.refundTotal.amountMinor.toString(), refundTotal: ret.refundTotal,
      vatShare: vat, cogsReversal: ret.cogsReversal, refunds: ret.refunds.map((r) => ({ method: r.method, amount: r.amount })),
      lines: ret.lines.map((l) => ({
        lineId: l.lineId, itemId: l.itemId, qtySsu: l.qtySsu, refundMinor: l.refundMinor, costMinor: l.costMinor,
        lots: l.lots.map((x) => ({ lotId: x.lotId, qtySsu: x.qtySsu, costMinor: x.costMinor, destination: x.destination })),
      })),
    };
  }

  private async load(tx: Sql, tenantId: string, invoiceId: string, lock: boolean): Promise<Loaded> {
    const [t] = await tx<{ base_currency: CurrencyCode; rwd: string | null }[]>`SELECT base_currency, settings->>'return_window_days' AS rwd FROM tenants WHERE id = ${tenantId}`;
    if (!t) throw ApiError.notFound("tenant.not_found", "Tenant not found");
    const [inv] = lock
      ? await tx<InvRow[]>`SELECT id, number, status, currency, business_date, customer_id, rate_scaled_snapshot, credit_minor FROM sales_invoices WHERE id = ${invoiceId} FOR UPDATE`
      : await tx<InvRow[]>`SELECT id, number, status, currency, business_date, customer_id, rate_scaled_snapshot, credit_minor FROM sales_invoices WHERE id = ${invoiceId}`;
    if (!inv) throw ApiError.notFound("sales_invoice.not_found", "Sales invoice not found");
    if (inv.status !== "POSTED") {
      throw new ApiError(422, { code: "return.invoice_not_posted", message: "Returns are only possible against a POSTED invoice", details: { status: inv.status } });
    }
    const lineRows = await tx<LineRow[]>`SELECT l.id, l.item_id, l.unit_id, l.factor_snapshot, l.ssu_qty, l.net_minor, l.tax_minor, l.tax_bp, i.is_returnable
      FROM sales_invoice_lines l JOIN items i ON i.id = l.item_id WHERE l.invoice_id = ${invoiceId} ORDER BY l.line_no`;
    const lotRows = await tx<LotRow[]>`SELECT s.line_id, s.lot_id, (array_agg(s.location_id ORDER BY s.id))[1] AS location_id, SUM(s.ssu_qty)::text AS ssu_qty,
        SUM(s.ssu_qty * s.unit_cost_minor_snapshot)::text AS cost_minor, MIN(lo.expiry_date) AS expiry_date, MIN(lo.manual_status::text) AS manual_status
      FROM sale_line_lots s JOIN sales_invoice_lines l ON l.id = s.line_id JOIN lots lo ON lo.id = s.lot_id
      WHERE l.invoice_id = ${invoiceId}
      GROUP BY s.line_id, s.lot_id ORDER BY s.line_id, MIN(lo.expiry_date) ASC NULLS LAST, s.lot_id`;
    const retRows = await tx<RetRow[]>`SELECT rl.original_line_id, rl.lot_id, SUM(rl.ssu_qty)::text AS q
      FROM sales_return_lines rl JOIN sales_returns r ON r.id = rl.return_id
      WHERE r.original_invoice_id = ${invoiceId} AND r.status = 'POSTED' AND rl.original_line_id IS NOT NULL
      GROUP BY rl.original_line_id, rl.lot_id`;
    const payRows = await tx<PayRow[]>`SELECT method::text AS method, SUM(amount_in_invoice_currency_minor)::text AS amt FROM invoice_payments WHERE invoice_id = ${invoiceId} GROUP BY method ORDER BY method`;

    const retByKey = new Map<string, bigint>();
    const lineRet = new Map<string, bigint>();
    for (const r of retRows) {
      const q = BigInt(r.q);
      retByKey.set(`${r.original_line_id}|${r.lot_id}`, q);
      lineRet.set(r.original_line_id, (lineRet.get(r.original_line_id) ?? 0n) + q);
    }
    const lotsBy = new Map<string, SoldLot[]>();
    const lotLoc = new Map<string, string>();
    for (const r of lotRows) {
      const key = `${r.line_id}|${r.lot_id}`;
      lotLoc.set(key, r.location_id);
      const arr = lotsBy.get(r.line_id) ?? [];
      arr.push({
        lotId: r.lot_id, qtySsu: BigInt(r.ssu_qty), returnedQtySsu: retByKey.get(key) ?? 0n, costMinor: Money.minor(BigInt(r.cost_minor), inv.currency),
        expiryDate: (isoOf(r.expiry_date) ?? "9999-12-31") as IsoDate, manualStatus: r.manual_status as ManualStatus,
      });
      lotsBy.set(r.line_id, arr);
    }
    const lines = new Map<string, LineRow>();
    const sold: SoldLine[] = [];
    for (const l of lineRows) {
      lines.set(l.id, l);
      sold.push({
        lineId: l.id, itemId: l.item_id, qtySsu: BigInt(l.ssu_qty), returnedQtySsu: lineRet.get(l.id) ?? 0n,
        netMinor: Money.minor(BigInt(l.net_minor), inv.currency), returnable: l.is_returnable !== false, lots: lotsBy.get(l.id) ?? [],
      });
    }
    const payments: Paid[] = payRows.map((p) => ({ method: p.method as Paid["method"], amount: Money.minor(BigInt(p.amt), inv.currency) }));
    const credit = BigInt(inv.credit_minor);
    if (credit > 0n && !payRows.some((p) => p.method === "CREDIT")) payments.push({ method: "CREDIT" as Paid["method"], amount: Money.minor(credit, inv.currency) });
    const w = t.rwd === null ? Number.NaN : Number(t.rwd);
    const snap: Snap = {
      invoiceId: inv.id, status: "POSTED", currency: inv.currency, businessDate: (isoOf(inv.business_date) ?? "") as IsoDate,
      customerId: inv.customer_id, lines: sold, payments,
    };
    return { inv, base: t.base_currency, windowDays: Number.isInteger(w) && w >= 0 ? w : 7, snap, lines, lotLoc };
  }
}
