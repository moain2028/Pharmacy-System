import type { Sql } from "./migrate.js";

/** Application-level SQLSTATE codes raised by PharmaCore triggers (see migrations/0001). */
export const PG_ERR = {
  LEDGER_IMMUTABLE: "P0001",
  POSTED_DOC_IMMUTABLE: "P0002",
  UNIT_FACTOR_LOCKED: "P0003",
  LOT_FACTS_IMMUTABLE: "P0004",
  LOT_EXPIRY_REQUIRED: "P0005",
  LOT_EXPIRED: "P0006",
  LOT_NOT_SELLABLE: "P0007",
  INSUFFICIENT_STOCK: "P0008",
  JOURNAL_UNBALANCED: "P0009",
  ACCOUNT_NOT_POSTABLE: "P0010",
  RLS_VIOLATION: "42501",
  INSUFFICIENT_PRIVILEGE: "42501",
  CHECK_VIOLATION: "23514",
  UNIQUE_VIOLATION: "23505",
} as const;

/**
 * Runs `fn` inside a transaction scoped to one tenant: every statement sees only
 * rows where tenant_id = app.tenant_id (RLS policy `tenant_isolation`).
 * `SET LOCAL` is transaction-scoped, so the setting cannot leak to pooled connections.
 */
export async function withTenant<T>(sql: Sql, tenantId: string, fn: (tx: Sql) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx as unknown as Sql);
  }) as Promise<T>;
}
