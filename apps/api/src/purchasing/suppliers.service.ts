import { Inject, Injectable } from "@nestjs/common";
import type { Sql } from "@pharmacore/db";
import type { CurrencyCode } from "@pharmacore/domain";
import { Db } from "../infra/db.js";
import { ApiError } from "../shared/errors.js";
import { J } from "../shared/journal.js";

export interface SupplierIn {
  code?: string | undefined; name: string; phone?: string | undefined; address?: string | undefined; taxNumber?: string | undefined;
  defaultCurrency?: CurrencyCode | undefined; paymentTermsDays?: number | undefined; earlyPaymentDays?: number | undefined; earlyPaymentBp?: number | undefined;
}
export type SupplierPatchIn = { [K in keyof SupplierIn]?: SupplierIn[K] | undefined } & { version: number; isActive?: boolean | undefined };
export interface SupplierListQ { q?: string | undefined; limit: number; offset: number }

interface SupplierRow {
  id: string; code: string; name: string; phone: string | null; address: string | null; tax_number: string | null; default_currency: CurrencyCode | null;
  payment_terms_days: number; early_payment_days: number | null; early_payment_bp: number | null; is_active: boolean; created_at: Date; updated_at: Date; version: number;
}

async function audit(tx: Sql, tenantId: string, actorId: string, action: string, id: string, before: unknown, after: unknown): Promise<void> {
  await tx`INSERT INTO audit_log (tenant_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
    VALUES (${tenantId}, ${actorId}, ${action}, 'supplier', ${id}, ${before === null ? null : tx.json(J(before))}, ${tx.json(J(after))})`;
}

@Injectable()
export class SuppliersService {
  constructor(@Inject(Db) private readonly db: Db) {}

  list(tenantId: string, q: SupplierListQ) {
    return this.db.tx(tenantId, async (tx) => {
      const like = q.q ? `%${q.q}%` : null;
      const rows = await tx<SupplierRow[]>`SELECT * FROM suppliers WHERE tenant_id = ${tenantId}
        AND (${like}::text IS NULL OR name ILIKE ${like} OR code ILIKE ${like} OR coalesce(phone, '') ILIKE ${like})
        ORDER BY code LIMIT ${q.limit} OFFSET ${q.offset}`;
      const [cnt] = await tx<{ c: number }[]>`SELECT count(*)::int AS c FROM suppliers WHERE tenant_id = ${tenantId}
        AND (${like}::text IS NULL OR name ILIKE ${like} OR code ILIKE ${like} OR coalesce(phone, '') ILIKE ${like})`;
      return J({ rows, total: cnt?.c ?? 0 });
    });
  }

  get(tenantId: string, id: string) {
    return this.db.tx(tenantId, async (tx) => {
      const [s] = await tx<SupplierRow[]>`SELECT * FROM suppliers WHERE tenant_id = ${tenantId} AND id = ${id}`;
      if (!s) throw ApiError.notFound("supplier.not_found", "Supplier not found");
      const [t] = await tx<{ base_currency: CurrencyCode }[]>`SELECT base_currency FROM tenants WHERE id = ${tenantId}`;
      const [b] = await tx<{ bal: string }[]>`SELECT COALESCE(SUM(credit_minor - debit_minor), 0)::text AS bal FROM journal_lines
        WHERE tenant_id = ${tenantId} AND dim_supplier_id = ${id} AND account_code = '2100'`;
      return J({ ...s, apBalance: { currency: t?.base_currency ?? null, amountMinor: BigInt(b?.bal ?? "0") } });
    });
  }

  create(tenantId: string, actorId: string, p: SupplierIn) {
    return this.db.tx(tenantId, (tx) => this.createIn(tx, tenantId, actorId, p));
  }

  /** Transaction-scoped create (CSV import batches). */
  async createIn(tx: Sql, tenantId: string, actorId: string, p: SupplierIn) {
    {
      const [cnt] = await tx<{ c: number }[]>`SELECT count(*)::int AS c FROM suppliers WHERE tenant_id = ${tenantId}`;
      const code = p.code ?? `S-${(cnt?.c ?? 0) + 1}`;
      const [row] = await tx<SupplierRow[]>`INSERT INTO suppliers (tenant_id, code, name, phone, address, tax_number, default_currency, payment_terms_days, early_payment_days, early_payment_bp)
        VALUES (${tenantId}, ${code}, ${p.name}, ${p.phone ?? null}, ${p.address ?? null}, ${p.taxNumber ?? null}, ${p.defaultCurrency ?? null}, ${p.paymentTermsDays ?? 0}, ${p.earlyPaymentDays ?? null}, ${p.earlyPaymentBp ?? null})
        RETURNING *`;
      await audit(tx, tenantId, actorId, "supplier.create", row!.id, null, row);
      return J(row);
    }
  }

  patch(tenantId: string, actorId: string, id: string, p: SupplierPatchIn) {
    return this.db.tx(tenantId, async (tx) => {
      const [cur] = await tx<SupplierRow[]>`SELECT * FROM suppliers WHERE tenant_id = ${tenantId} AND id = ${id} FOR UPDATE`;
      if (!cur) throw ApiError.notFound("supplier.not_found", "Supplier not found");
      if (cur.version !== p.version) throw ApiError.conflict("conflict.version", "Supplier was modified by someone else", { expected: cur.version, got: p.version });
      const [row] = await tx<SupplierRow[]>`UPDATE suppliers SET
        code = COALESCE(${p.code ?? null}, code), name = COALESCE(${p.name ?? null}, name), phone = COALESCE(${p.phone ?? null}, phone),
        address = COALESCE(${p.address ?? null}, address), tax_number = COALESCE(${p.taxNumber ?? null}, tax_number),
        default_currency = COALESCE(${p.defaultCurrency ?? null}::currency_code, default_currency),
        payment_terms_days = COALESCE(${p.paymentTermsDays ?? null}::int, payment_terms_days),
        early_payment_days = COALESCE(${p.earlyPaymentDays ?? null}::int, early_payment_days),
        early_payment_bp = COALESCE(${p.earlyPaymentBp ?? null}::int, early_payment_bp),
        is_active = COALESCE(${p.isActive ?? null}::boolean, is_active),
        version = version + 1, updated_at = now()
        WHERE id = ${id} AND tenant_id = ${tenantId} RETURNING *`;
      await audit(tx, tenantId, actorId, "supplier.update", id, cur, row);
      return J(row);
    });
  }
}
