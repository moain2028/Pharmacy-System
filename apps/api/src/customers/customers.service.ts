import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import { CURRENCY_CODES, Money, type CurrencyCode } from "@pharmacore/domain";
import type { Sql } from "@pharmacore/db";
import { Db } from "../infra/db.js";
import { ApiError } from "../shared/errors.js";
import { J } from "../shared/journal.js";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const intStr = z.string().regex(/^\d+$/);

export const CustomerCreateSchema = z.object({
  code: z.string().trim().min(1).max(40).optional(),
  name: z.string().trim().min(1).max(200),
  phone: z.string().trim().max(40).optional(),
  address: z.string().max(300).optional(),
  priceListId: z.string().uuid().optional(),
  creditLimitMinor: intStr.optional(),
  creditCurrency: z.enum(CURRENCY_CODES).optional(),
  notes: z.string().max(1000).optional(),
});
export type CustomerCreate = z.infer<typeof CustomerCreateSchema>;

export const CustomerPatchSchema = z.object({
  version: z.number().int().positive(),
  code: z.string().trim().min(1).max(40).optional(),
  name: z.string().trim().min(1).max(200).optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  address: z.string().max(300).nullable().optional(),
  priceListId: z.string().uuid().nullable().optional(),
  creditLimitMinor: intStr.optional(),
  creditCurrency: z.enum(CURRENCY_CODES).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
  isActive: z.boolean().optional(),
});
export type CustomerPatch = z.infer<typeof CustomerPatchSchema>;

export const CustomerListSchema = z.object({
  q: z.string().trim().max(100).optional(),
  includeInactive: z.enum(["true", "false"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type CustomerListQuery = z.infer<typeof CustomerListSchema>;

export const StatementQuerySchema = z.object({ from: isoDate.optional(), to: isoDate.optional() });
export type StatementQuery = z.infer<typeof StatementQuerySchema>;

export interface CustomerActor {
  readonly userId: string;
  readonly permissions: ReadonlySet<string>;
}

const AR = "1300";
const CREDIT_PERM = "customers.credit_limit";
const DOC_TYPES: Record<string, string> = { sales_invoice: "SALES_INVOICE", sales_return: "SALES_RETURN", customer_payment: "PAYMENT" };

interface CustomerRow {
  id: string; code: string; name: string; phone: string | null; address: string | null; price_list_id: string | null;
  credit_limit_minor: string; credit_currency: CurrencyCode | null; is_walk_in: boolean; is_active: boolean; notes: string | null; version: number;
}
interface StmtRow { document_type: string; document_id: string; business_date: string; number: string | null; debit: string; credit: string }

function escLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

function creditDenied(): ApiError {
  return ApiError.forbidden("customers.credit_limit_denied", "Changing a credit limit requires a permission", { permission: CREDIT_PERM });
}

@Injectable()
export class CustomersService {
  constructor(@Inject(Db) private readonly db: Db) {}

  async list(tenantId: string, q: CustomerListQuery): Promise<unknown> {
    const pat = q.q ? `%${escLike(q.q)}%` : null;
    const all = q.includeInactive === "true";
    return this.db.tx(tenantId, async (tx) => {
      const rows = await tx<CustomerRow[]>`SELECT id, code, name, phone, address, price_list_id, credit_limit_minor, credit_currency, is_walk_in, is_active, notes, version
        FROM customers
        WHERE (${pat}::text IS NULL OR code ILIKE ${pat} OR name ILIKE ${pat} OR phone ILIKE ${pat}) AND (${all} OR is_active)
        ORDER BY code LIMIT ${q.limit} OFFSET ${q.offset}`;
      return J({ rows, limit: q.limit, offset: q.offset });
    });
  }

  async get(tenantId: string, id: string): Promise<unknown> {
    return this.db.tx(tenantId, async (tx) => {
      const row = await this.find(tx, id, false);
      const base = await this.base(tx, tenantId);
      const [b] = await tx<{ b: string }[]>`SELECT COALESCE(SUM(debit_minor - credit_minor), 0)::text AS b FROM journal_lines WHERE dim_customer_id = ${id} AND account_code = ${AR}`;
      return J({ ...row, balance: Money.minor(BigInt(b?.b ?? "0"), base) });
    });
  }

  async create(tenantId: string, actor: CustomerActor, body: CustomerCreate): Promise<unknown> {
    return this.db.tx(tenantId, (tx) => this.createIn(tx, tenantId, actor, body));
  }

  /** Transaction-scoped create (CSV import batches). */
  async createIn(tx: Sql, tenantId: string, actor: CustomerActor, body: CustomerCreate): Promise<unknown> {
    const limit = BigInt(body.creditLimitMinor ?? "0");
    if (limit > 0n && !actor.permissions.has(CREDIT_PERM)) throw creditDenied();
    {
      let code = body.code;
      if (code === undefined) {
        const [r] = await tx<{ n: string }[]>`SELECT GREATEST(count(*), COALESCE(MAX(substring(code from '^C-([0-9]+)$')::bigint), 0))::text AS n FROM customers`;
        code = `C-${(BigInt(r?.n ?? "0") + 1n).toString().padStart(5, "0")}`;
      }
      const [row] = await tx<CustomerRow[]>`INSERT INTO customers (tenant_id, code, name, phone, address, price_list_id, credit_limit_minor, credit_currency, notes)
        VALUES (${tenantId}, ${code}, ${body.name}, ${body.phone ?? null}, ${body.address ?? null}, ${body.priceListId ?? null}, ${limit.toString()}, ${body.creditCurrency ?? null}::currency_code, ${body.notes ?? null})
        RETURNING id, code, name, phone, address, price_list_id, credit_limit_minor, credit_currency, is_walk_in, is_active, notes, version`;
      if (!row) throw ApiError.conflict("customer.create_failed", "Customer not created");
      await tx`INSERT INTO audit_log (tenant_id, actor_user_id, action, entity_type, entity_id, after_data)
        VALUES (${tenantId}, ${actor.userId}, 'customers.create', 'customer', ${row.id}, ${tx.json(J(row))})`;
      return J(row);
    }
  }

  async update(tenantId: string, actor: CustomerActor, id: string, body: CustomerPatch): Promise<unknown> {
    return this.db.tx(tenantId, async (tx) => {
      const cur = await this.find(tx, id, true);
      if (cur.version !== body.version) {
        throw ApiError.conflict("customer.version_conflict", "Customer was modified by someone else", { expected: body.version, actual: cur.version });
      }
      const limit = body.creditLimitMinor !== undefined ? BigInt(body.creditLimitMinor) : BigInt(cur.credit_limit_minor);
      const ccy = body.creditCurrency !== undefined ? body.creditCurrency : cur.credit_currency;
      if ((limit !== BigInt(cur.credit_limit_minor) || ccy !== cur.credit_currency) && !actor.permissions.has(CREDIT_PERM)) throw creditDenied();
      const code = body.code ?? cur.code;
      const name = body.name ?? cur.name;
      const phone = body.phone !== undefined ? body.phone : cur.phone;
      const address = body.address !== undefined ? body.address : cur.address;
      const priceListId = body.priceListId !== undefined ? body.priceListId : cur.price_list_id;
      const notes = body.notes !== undefined ? body.notes : cur.notes;
      const active = body.isActive ?? cur.is_active;
      const [row] = await tx<CustomerRow[]>`UPDATE customers SET code = ${code}, name = ${name}, phone = ${phone}, address = ${address}, price_list_id = ${priceListId},
          credit_limit_minor = ${limit.toString()}, credit_currency = ${ccy}::currency_code, notes = ${notes}, is_active = ${active},
          updated_at = now(), version = version + 1
        WHERE id = ${id} AND version = ${body.version}
        RETURNING id, code, name, phone, address, price_list_id, credit_limit_minor, credit_currency, is_walk_in, is_active, notes, version`;
      if (!row) throw ApiError.conflict("customer.version_conflict", "Customer was modified by someone else");
      await tx`INSERT INTO audit_log (tenant_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
        VALUES (${tenantId}, ${actor.userId}, 'customers.update', 'customer', ${id}, ${tx.json(J(cur))}, ${tx.json(J(row))})`;
      return J(row);
    });
  }

  /** Customer statement from the AR sub-ledger (1300 lines with the customer dimension), base currency. */
  async statement(tenantId: string, id: string, q: StatementQuery): Promise<unknown> {
    const from = q.from ?? "0001-01-01";
    const to = q.to ?? "9999-12-31";
    if (from > to) throw ApiError.badRequest("validation.date_range", "from must be <= to");
    return this.db.tx(tenantId, async (tx) => {
      const customer = await this.find(tx, id, false);
      const base = await this.base(tx, tenantId);
      const [o] = await tx<{ b: string }[]>`SELECT COALESCE(SUM(jl.debit_minor - jl.credit_minor), 0)::text AS b
        FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
        WHERE jl.dim_customer_id = ${id} AND jl.account_code = ${AR} AND je.business_date < ${from}::date`;
      const rows = await tx<StmtRow[]>`SELECT je.document_type, je.document_id, je.business_date, COALESCE(si.number, sr.number) AS number,
          SUM(jl.debit_minor)::text AS debit, SUM(jl.credit_minor)::text AS credit
        FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
        LEFT JOIN sales_invoices si ON je.document_type = 'sales_invoice' AND si.id = je.document_id
        LEFT JOIN sales_returns sr ON je.document_type = 'sales_return' AND sr.id = je.document_id
        WHERE jl.dim_customer_id = ${id} AND jl.account_code = ${AR} AND je.business_date BETWEEN ${from}::date AND ${to}::date
        GROUP BY je.id, je.document_type, je.document_id, je.business_date, je.posted_at, si.number, sr.number
        ORDER BY je.business_date, je.posted_at, je.id`;
      const opening = Money.minor(BigInt(o?.b ?? "0"), base);
      let running = opening;
      const lines = rows.map((r) => {
        const debit = Money.minor(BigInt(r.debit), base);
        const credit = Money.minor(BigInt(r.credit), base);
        running = running.add(debit).subtract(credit);
        return { date: r.business_date, documentType: DOC_TYPES[r.document_type] ?? r.document_type, documentId: r.document_id, number: r.number, debit, credit, balance: running };
      });
      return J({ customer: { id: customer.id, code: customer.code, name: customer.name }, from: q.from ?? null, to: q.to ?? null, currency: base, opening, rows: lines, closing: running });
    });
  }

  private async find(tx: Sql, id: string, lock: boolean): Promise<CustomerRow> {
    const [row] = lock
      ? await tx<CustomerRow[]>`SELECT id, code, name, phone, address, price_list_id, credit_limit_minor, credit_currency, is_walk_in, is_active, notes, version FROM customers WHERE id = ${id} FOR UPDATE`
      : await tx<CustomerRow[]>`SELECT id, code, name, phone, address, price_list_id, credit_limit_minor, credit_currency, is_walk_in, is_active, notes, version FROM customers WHERE id = ${id}`;
    if (!row) throw ApiError.notFound("customer.not_found", "Customer not found");
    return row;
  }

  private async base(tx: Sql, tenantId: string): Promise<CurrencyCode> {
    const [t] = await tx<{ base_currency: CurrencyCode }[]>`SELECT base_currency FROM tenants WHERE id = ${tenantId}`;
    if (!t) throw ApiError.notFound("tenant.not_found", "Tenant not found");
    return t.base_currency;
  }
}
