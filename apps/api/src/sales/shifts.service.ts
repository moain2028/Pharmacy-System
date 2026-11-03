import { Inject, Injectable } from "@nestjs/common";
import type { Sql } from "@pharmacore/db";
import {
  CashMovement, Money, Shift, isErr, type CashMovementKind, type CurrencyCode, type ShiftRef, type ShiftTender,
} from "@pharmacore/domain";
import { Db } from "../infra/db.js";
import { AuthService } from "../identity/auth.service.js";
import { ApiError } from "../shared/errors.js";

interface ShiftRow {
  id: string; cashbox_id: string; cashier_id: string; device_id: string | null; status: "OPEN" | "CLOSED"; opened_at: Date; closed_at: Date | null;
  opening_float: Array<{ currency: CurrencyCode; amountMinor: string }>; counted_cash: unknown; expected_cash: unknown; variances: unknown; version: number;
}
interface CashRow { id: string; cashbox_id: string; shift_id: string | null; currency: CurrencyCode; amount_minor: string; kind: CashMovementKind; occurred_at: Date; created_by: string | null; document_type: string | null; document_id: string | null; pair_id: string | null; reason: string | null }

const moneyList = (list: Array<{ currency: CurrencyCode; amountMinor: string }>) => list.map((m) => Money.minor(BigInt(m.amountMinor), m.currency));
const toJsonMoney = (list: readonly Money[]) => list.map((m) => ({ currency: m.currency, amountMinor: m.amountMinor.toString() }));

@Injectable()
export class ShiftsService {
  constructor(@Inject(Db) private readonly db: Db, @Inject(AuthService) private readonly auth: AuthService) {}

  private hydrateMovements(rows: CashRow[]): CashMovement[] {
    return rows.map((r) => {
      const m = CashMovement.create({
        movementId: r.id, cashboxId: r.cashbox_id, shiftId: r.shift_id ?? undefined, kind: r.kind, amount: Money.minor(BigInt(r.amount_minor), r.currency),
        occurredAt: r.occurred_at.toISOString(), createdBy: r.created_by ?? "system", documentRef: r.document_type && r.document_id ? { type: r.document_type, id: r.document_id } : undefined,
        pairId: r.pair_id ?? undefined, reason: r.reason ?? undefined,
      });
      if (isErr(m)) throw m.error;
      return m.value;
    });
  }

  private async shiftTenders(tx: Sql, shiftId: string): Promise<ShiftTender[]> {
    const rows = await tx<Array<{ doc_id: string; kind: "SALE" | "SALE_REFUND"; method: string; currency: CurrencyCode; amount_minor: string; cashier_id: string }>>`
      SELECT i.id AS doc_id, 'SALE' AS kind, lower(p.method::text) AS method, p.currency, p.amount_minor, i.cashier_id
        FROM invoice_payments p JOIN sales_invoices i ON i.id = p.invoice_id WHERE i.shift_id = ${shiftId} AND i.status = 'POSTED'
      UNION ALL
      SELECT r.id, 'SALE_REFUND', 'cash', r.currency, r.refund_total_minor, r.cashier_id
        FROM sales_returns r WHERE r.shift_id = ${shiftId} AND r.status = 'POSTED' AND r.refund_total_minor > 0`;
    return rows.map((r) => ({ docId: r.doc_id, kind: r.kind, method: r.method as ShiftTender["method"], amount: Money.minor(BigInt(r.amount_minor), r.currency), cashierId: r.cashier_id }));
  }

  async current(tenantId: string, userId: string) {
    return this.db.tx(tenantId, async (tx) => {
      const [s] = await tx<ShiftRow[]>`SELECT * FROM shifts WHERE cashier_id = ${userId} AND status = 'OPEN'`;
      return s ? this.view(tx, s) : null;
    });
  }

  private async view(tx: Sql, s: ShiftRow) {
    const moves = this.hydrateMovements(await tx<CashRow[]>`SELECT * FROM cash_movements WHERE shift_id = ${s.id} ORDER BY occurred_at`);
    const shift = this.rebuild(s);
    const expected = shift.expectedCash(moves);
    return { id: s.id, cashboxId: s.cashbox_id, cashierId: s.cashier_id, status: s.status, openedAt: s.opened_at, closedAt: s.closed_at, openingFloat: toJsonMoney(shift.openingFloat), expectedCash: toJsonMoney(expected), version: s.version };
  }

  private rebuild(s: ShiftRow): Shift {
    const r = Shift.open({ shiftId: s.id, shiftNo: 1, mode: "per_user", cashboxId: s.cashbox_id, deviceId: s.device_id ?? "unknown", userId: s.cashier_id, openedAt: s.opened_at, openingFloat: moneyList(s.opening_float), existingShifts: [] });
    if (isErr(r)) throw r.error;
    return r.value;
  }

  async open(tenantId: string, userId: string, input: { cashboxId: string; deviceId?: string | undefined; openingFloat: Array<{ currency: CurrencyCode; amountMinor: string }>; openingReason?: string | undefined }) {
    return this.db.tx(tenantId, async (tx) => {
      const existing = await tx<Array<{ id: string; cashier_id: string; cashbox_id: string; status: "OPEN" | "CLOSED" }>>`SELECT id, cashier_id, cashbox_id, status FROM shifts WHERE status = 'OPEN'`;
      const refs: ShiftRef[] = existing.map((e) => ({ shiftId: e.id, userId: e.cashier_id, cashboxId: e.cashbox_id, status: e.status }));
      const [prev] = await tx<Array<{ counted_cash: Array<{ currency: CurrencyCode; amountMinor: string }> | null }>>`SELECT counted_cash FROM shifts WHERE cashbox_id = ${input.cashboxId} AND status = 'CLOSED' ORDER BY closed_at DESC LIMIT 1`;
      const [seq] = await tx<{ n: string }[]>`SELECT next_document_number(${tenantId}, 'SHIFT', '') AS n`;
      const shiftId = crypto.randomUUID();
      const r = Shift.open({
        shiftId, shiftNo: Number(seq!.n.replace(/\D/g, "")) || 1, mode: "per_user", cashboxId: input.cashboxId, deviceId: input.deviceId ?? "pos", userId, openedAt: new Date(),
        openingFloat: moneyList(input.openingFloat), previousClosing: prev?.counted_cash ? moneyList(prev.counted_cash) : undefined, openingReason: input.openingReason, existingShifts: refs,
      });
      if (isErr(r)) throw r.error;
      const shift = r.value;
      await tx`INSERT INTO shifts (id, tenant_id, cashbox_id, cashier_id, device_id, status, opened_at, opening_float)
        VALUES (${shiftId}, ${tenantId}, ${input.cashboxId}, ${userId}, ${shift.deviceId}, 'OPEN', ${new Date(shift.openedAt)}, ${tx.json(toJsonMoney(shift.openingFloat))})`;
      for (const m of shift.openingFloat) {
        if (m.isZero()) continue;
        await tx`INSERT INTO cash_movements (tenant_id, cashbox_id, shift_id, currency, amount_minor, kind, document_type, document_id, created_by)
          VALUES (${tenantId}, ${input.cashboxId}, ${shiftId}, ${m.currency}, ${m.amountMinor.toString()}, 'OPENING_FLOAT', 'SHIFT', ${shiftId}, ${userId})`;
      }
      await tx`INSERT INTO audit_log (tenant_id, actor_user_id, action, entity_type, entity_id, after_data) VALUES (${tenantId}, ${userId}, 'shifts.open', 'shift', ${shiftId}, ${tx.json(JSON.parse(JSON.stringify(input)))})`;
      return { id: shiftId, shiftNo: shift.shiftNo };
    });
  }

  async xReport(tenantId: string, shiftId: string) {
    return this.db.tx(tenantId, async (tx) => {
      const [s] = await tx<ShiftRow[]>`SELECT * FROM shifts WHERE id = ${shiftId}`;
      if (!s) throw ApiError.notFound("shifts.not_found", "Shift not found");
      const shift = this.rebuild(s);
      const moves = this.hydrateMovements(await tx<CashRow[]>`SELECT * FROM cash_movements WHERE shift_id = ${shiftId} ORDER BY occurred_at`);
      const tenders = await this.shiftTenders(tx, shiftId);
      const rep = shift.xReport(moves, tenders, new Date());
      if (isErr(rep)) throw rep.error;
      return JSON.parse(JSON.stringify(rep.value, (_k, v) => (typeof v === "bigint" ? v.toString() : v instanceof Money ? { currency: v.currency, amountMinor: v.amountMinor.toString() } : v)));
    });
  }

  async close(tenantId: string, actorId: string, shiftId: string, input: { counts: Array<{ currency: CurrencyCode; amountMinor: string }>; reasons?: Record<string, string> | undefined; approver?: { username: string; secret: string } | undefined }) {
    // Variance above tolerance needs a supervisor: either an explicit approver (PIN/password) or the actor
    // themself when they hold `shifts.close_others` (owner/manager closing their own drawer).
    let approvedBy: string | undefined;
    if (input.approver) approvedBy = (await this.auth.elevate(tenantId, input.approver, "shifts.close_others")).approverId;
    return this.db.tx(tenantId, async (tx) => {
      if (!approvedBy && (await this.auth.loadAccess(tx, actorId)).permissions.has("shifts.close_others")) approvedBy = actorId;
      const [s] = await tx<ShiftRow[]>`SELECT * FROM shifts WHERE id = ${shiftId} FOR UPDATE`;
      if (!s) throw ApiError.notFound("shifts.not_found", "Shift not found");
      if (s.status !== "OPEN") throw ApiError.conflict("shifts.not_open", "Shift is already closed");
      if (s.cashier_id !== actorId) {
        const [me] = await tx<{ n: string }[]>`SELECT count(*)::text AS n FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ${actorId} AND ('shifts.close_others' = ANY(r.permissions) OR '*' = ANY(r.permissions) OR 'shifts.*' = ANY(r.permissions))`;
        if (me!.n === "0") throw ApiError.forbidden("shifts.close_others_denied", "Cannot close another cashier's shift");
      }
      const [openDocs] = await tx<{ n: string }[]>`SELECT count(*)::text AS n FROM sales_invoices WHERE shift_id = ${shiftId} AND status IN ('DRAFT','HELD','PENDING_APPROVAL')`;
      const shift = this.rebuild(s);
      const moves = this.hydrateMovements(await tx<CashRow[]>`SELECT * FROM cash_movements WHERE shift_id = ${shiftId} ORDER BY occurred_at`);
      const tenders = await this.shiftTenders(tx, shiftId);
      const [z] = await tx<{ n: string }[]>`SELECT next_document_number(${tenantId}, 'Z_REPORT', '') AS n`;
      const [t] = await tx<{ settings: Record<string, unknown> }[]>`SELECT settings FROM tenants WHERE id = ${tenantId}`;
      const tol = (t!.settings["cash_variance_tolerance"] as Array<{ currency: CurrencyCode; amountMinor: string }> | undefined) ?? [];
      const closed = shift.close({
        closedAt: new Date(), zNumber: Number(z!.n.replace(/\D/g, "")) || 1,
        counts: input.counts.map((c) => ({ currency: c.currency, amount: Money.minor(BigInt(c.amountMinor), c.currency) })),
        movements: moves, tenders, tolerances: moneyList(tol), reasons: input.reasons as Partial<Record<CurrencyCode, string>> | undefined, approvedBy, openDocuments: Number(openDocs!.n),
      });
      if (isErr(closed)) throw closed.error;
      const c = closed.value.closing!;
      await tx`UPDATE shifts SET status = 'CLOSED', closed_at = now(), closed_by = ${actorId},
        counted_cash = ${tx.json(c.currencies.map((x) => ({ currency: x.currency, amountMinor: x.counted.amountMinor.toString() })))},
        expected_cash = ${tx.json(c.currencies.map((x) => ({ currency: x.currency, amountMinor: x.expected.amountMinor.toString() })))},
        variances = ${tx.json(c.currencies.map((x) => ({ currency: x.currency, amountMinor: x.variance.amountMinor.toString(), reason: x.reason, approvedBy: x.approvedBy })))}
        WHERE id = ${shiftId}`;
      // variance → ADJUSTMENT cash movement so cashbox balance equals counted cash
      for (const x of c.currencies) {
        if (x.variance.isZero()) continue;
        await tx`INSERT INTO cash_movements (tenant_id, cashbox_id, shift_id, currency, amount_minor, kind, document_type, document_id, reason, created_by)
          VALUES (${tenantId}, ${s.cashbox_id}, ${shiftId}, ${x.currency}, ${x.variance.amountMinor.toString()}, 'ADJUSTMENT', 'SHIFT_VARIANCE', ${shiftId}, ${x.reason ?? "cash over/short at close"}, ${actorId})`;
      }
      await tx`INSERT INTO audit_log (tenant_id, actor_user_id, action, entity_type, entity_id, after_data, approved_by) VALUES (${tenantId}, ${actorId}, 'shifts.close', 'shift', ${shiftId}, ${tx.json(JSON.parse(JSON.stringify(c, (_k, v) => (typeof v === "bigint" ? v.toString() : v))))}, ${approvedBy ?? null})`;
      return JSON.parse(JSON.stringify({ shiftId, zNumber: c.zNumber, currencies: c.currencies, zReport: c.zReport }, (_k, v) => (typeof v === "bigint" ? v.toString() : v instanceof Money ? { currency: v.currency, amountMinor: v.amountMinor.toString() } : v)));
    });
  }

  /** Cash in/out, owner drawing, capital, expense payout from a cashbox during a shift. */
  async cashMovement(tenantId: string, actorId: string, input: { cashboxId: string; shiftId?: string | undefined; kind: CashMovementKind; currency: CurrencyCode; amountMinor: string; reason: string; documentType?: string | undefined; documentId?: string | undefined }) {
    return this.db.tx(tenantId, async (tx) => {
      const m = CashMovement.create({ movementId: crypto.randomUUID(), cashboxId: input.cashboxId, shiftId: input.shiftId, kind: input.kind, amount: Money.minor(BigInt(input.amountMinor), input.currency), occurredAt: new Date().toISOString(), createdBy: actorId, reason: input.reason, documentRef: input.documentType && input.documentId ? { type: input.documentType, id: input.documentId } : undefined });
      if (isErr(m)) throw m.error;
      const [row] = await tx<{ id: string }[]>`INSERT INTO cash_movements (id, tenant_id, cashbox_id, shift_id, currency, amount_minor, kind, document_type, document_id, reason, created_by)
        VALUES (${m.value.movementId}, ${tenantId}, ${input.cashboxId}, ${input.shiftId ?? null}, ${input.currency}, ${m.value.amount.amountMinor.toString()}, ${input.kind}, ${input.documentType ?? null}, ${input.documentId ?? null}, ${input.reason}, ${actorId}) RETURNING id`;
      return { id: row!.id };
    });
  }

  async cashboxBalances(tenantId: string) {
    return this.db.tx(tenantId, (tx) => tx`SELECT c.id, c.code, c.name_ar, c.name_en, c.kind, m.currency, COALESCE(SUM(m.amount_minor),0)::text AS balance_minor
      FROM cashboxes c LEFT JOIN cash_movements m ON m.cashbox_id = c.id WHERE c.is_active GROUP BY c.id, m.currency ORDER BY c.code, m.currency`);
  }
}
