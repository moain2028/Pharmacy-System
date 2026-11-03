/**
 * Permission catalogue — `resource.action` (canonical dictionary §4). Roles hold a list of
 * permission strings (or wildcards `resource.*` / `*`); per-user overrides ALLOW/DENY individual
 * permissions and may carry numeric limits (e.g. max discount bp) — D-030.
 */
export const PERMISSIONS = [
  // identity & settings
  "users.read", "users.create", "users.update", "users.deactivate", "users.reset_password",
  "roles.read", "roles.manage",
  "settings.read", "settings.update", "settings.currency", "settings.backup",
  "audit.read",
  // catalog
  "items.read", "items.create", "items.update", "items.deactivate", "items.import", "items.export",
  "units.manage", "barcodes.manage", "categories.manage",
  "prices.read", "prices.update", "prices.official_manage", "price_lists.manage",
  // inventory
  "stock.read", "stock.adjust", "stock.transfer", "stock.stocktake",
  "lots.read", "lots.status_change", "lots.destroy",
  "expiry.read",
  // sales
  "sales.read", "sales.create", "sales.post", "sales.hold", "sales.reverse",
  "sales.discount_line", "sales.discount_invoice", "sales.sell_below_min", "sales.sell_below_cost",
  "sales.override_official_price", "sales.credit", "sales.change_price",
  "returns.create", "returns.post", "returns.without_invoice",
  "customers.read", "customers.manage", "customers.credit_limit",
  // cash & shifts
  "shifts.open", "shifts.close", "shifts.close_others", "shifts.reopen", "shifts.read",
  "cash.read", "cash.move", "cash.expense", "cash.fx",
  "cashboxes.manage",
  // purchasing
  "suppliers.read", "suppliers.manage",
  "purchase_orders.read", "purchase_orders.create", "purchase_orders.approve",
  "goods_receipts.read", "goods_receipts.create", "goods_receipts.post",
  "supplier_invoices.read", "supplier_invoices.create", "supplier_invoices.post",
  "purchase_returns.create", "purchase_returns.post",
  "payables.pay",
  // accounting & reports
  "accounts.read", "accounts.manage", "journal.read", "journal.manual",
  "reports.sales", "reports.inventory", "reports.financial", "reports.purchasing", "reports.export",
] as const;

export type Permission = (typeof PERMISSIONS)[number];
const SET: ReadonlySet<string> = new Set(PERMISSIONS);
export const isPermission = (p: string): p is Permission => SET.has(p);

export interface RoleGrant { readonly permissions: readonly string[]; readonly limits: Readonly<Record<string, number>> }
export interface Override { readonly permission: string; readonly effect: "ALLOW" | "DENY"; readonly limitValue: number | null }

export interface EffectiveAccess {
  readonly permissions: ReadonlySet<string>;
  readonly limits: Readonly<Record<string, number>>;
}

function matches(granted: string, wanted: string): boolean {
  if (granted === "*" || granted === wanted) return true;
  if (granted.endsWith(".*")) return wanted.startsWith(granted.slice(0, -1));
  return false;
}

/** Union of role permissions, then user overrides (DENY beats everything). Limits: max across roles, override wins. */
export function resolveAccess(roles: readonly RoleGrant[], overrides: readonly Override[]): EffectiveAccess {
  const perms = new Set<string>();
  const limits: Record<string, number> = {};
  for (const r of roles) {
    for (const g of r.permissions) for (const p of PERMISSIONS) if (matches(g, p)) perms.add(p);
    for (const [k, v] of Object.entries(r.limits)) limits[k] = Math.max(limits[k] ?? Number.NEGATIVE_INFINITY, v);
  }
  for (const o of overrides) {
    if (o.effect === "ALLOW") { if (isPermission(o.permission)) perms.add(o.permission); }
    else perms.delete(o.permission);
    if (o.limitValue !== null) limits[o.permission] = o.limitValue;
  }
  return { permissions: perms, limits };
}

/** Built-in roles for a brand-new pharmacy (setup wizard). Tenant admins can edit copies. */
export const BUILTIN_ROLES: Readonly<Record<string, { nameAr: string; nameEn: string; permissions: readonly string[]; limits: Record<string, number> }>> = {
  OWNER: { nameAr: "المالك", nameEn: "Owner", permissions: ["*"], limits: {} },
  PHARMACIST: {
    nameAr: "صيدلي", nameEn: "Pharmacist",
    permissions: [
      "items.*", "units.manage", "barcodes.manage", "categories.manage", "prices.read", "prices.update",
      "stock.read", "stock.adjust", "stock.transfer", "stock.stocktake", "lots.*", "expiry.read",
      "sales.read", "sales.create", "sales.post", "sales.hold", "sales.discount_line", "sales.discount_invoice", "sales.credit",
      "returns.create", "returns.post", "customers.read", "customers.manage",
      "shifts.open", "shifts.close", "shifts.read", "cash.read", "cash.move", "cash.expense",
      "suppliers.read", "purchase_orders.read", "purchase_orders.create", "goods_receipts.*", "supplier_invoices.read", "supplier_invoices.create",
      "reports.sales", "reports.inventory", "reports.purchasing", "reports.export",
    ],
    limits: { "sales.discount_line": 1000, "sales.discount_invoice": 500 },
  },
  CASHIER: {
    nameAr: "كاشير", nameEn: "Cashier",
    permissions: [
      "items.read", "prices.read", "stock.read", "lots.read", "expiry.read",
      "sales.read", "sales.create", "sales.post", "sales.hold", "sales.discount_line",
      "returns.create", "customers.read",
      "shifts.open", "shifts.close", "shifts.read", "cash.read",
    ],
    limits: { "sales.discount_line": 500 },
  },
  ACCOUNTANT: {
    nameAr: "محاسب", nameEn: "Accountant",
    permissions: ["accounts.*", "journal.*", "reports.*", "cash.read", "shifts.read", "sales.read", "returns.read" as string, "suppliers.read", "supplier_invoices.read", "payables.pay", "customers.read", "audit.read", "settings.read"],
    limits: {},
  },
};
