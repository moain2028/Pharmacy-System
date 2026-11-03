/**
 * Role — FR-IAM-102/103/104. An editable permission template: a Set of permission keys plus a map
 * of numeric limits. Immutable: every intent method returns a new Role (no setters).
 * Built-in templates are seeded once (ids `builtin:<CODE>`; the seeder may copy them under UUIDv7
 * ids via `cloneAs`). The OWNER template cannot be deleted and the last active owner must remain.
 * A limit that is absent means "no cap" for a role that grants the capability.
 */
import { domainErr, ok, unwrap, type Result } from "../shared/result.js";
import { isLimitName, isPermissionKey, PERMISSION_KEYS, type LimitName, type PermissionKey } from "./permissions.js";

export const BUILT_IN_ROLE_CODES = ["OWNER", "MANAGER", "PHARMACIST", "CASHIER", "ACCOUNTANT", "STOREKEEPER"] as const;
export type BuiltInRoleCode = (typeof BUILT_IN_ROLE_CODES)[number];

export interface RoleProps {
  readonly id: string;
  readonly name: string;
  readonly nameEn: string;
  readonly permissions: Iterable<PermissionKey>;
  readonly limits?: Iterable<readonly [LimitName, bigint]>;
  readonly templateCode?: BuiltInRoleCode;
}

interface RolePatch {
  readonly name?: string;
  readonly nameEn?: string;
  readonly permissions?: ReadonlySet<PermissionKey>;
  readonly limits?: ReadonlyMap<LimitName, bigint>;
}

const isBlank = (s: string): boolean => s.trim().length === 0;

function checkLimit(name: LimitName, value: bigint): Result<void> {
  if (!isLimitName(name)) {
    return domainErr("iam.role.invalid_limit", `Unknown limit name: ${String(name)}`, { name: String(name) });
  }
  if (typeof value !== "bigint" || value < 0n) {
    return domainErr("iam.role.invalid_limit", "Limit value must be a non-negative bigint", { name, value: String(value) });
  }
  return ok(undefined);
}

export class Role {
  readonly id: string;
  readonly name: string;
  readonly nameEn: string;
  readonly permissions: ReadonlySet<PermissionKey>;
  readonly limits: ReadonlyMap<LimitName, bigint>;
  readonly templateCode: BuiltInRoleCode | undefined;

  private constructor(
    id: string,
    name: string,
    nameEn: string,
    permissions: ReadonlySet<PermissionKey>,
    limits: ReadonlyMap<LimitName, bigint>,
    templateCode: BuiltInRoleCode | undefined,
  ) {
    this.id = id;
    this.name = name;
    this.nameEn = nameEn;
    this.permissions = permissions;
    this.limits = limits;
    this.templateCode = templateCode;
    Object.freeze(this);
  }

  static create(props: RoleProps): Result<Role> {
    if (isBlank(props.id)) return domainErr("iam.role.invalid_id", "Role id must not be blank");
    if (isBlank(props.name) || isBlank(props.nameEn)) {
      return domainErr("iam.role.invalid_name", "Role name must not be blank", { id: props.id });
    }
    const permissions = new Set<PermissionKey>();
    for (const key of props.permissions) {
      if (!isPermissionKey(key)) {
        return domainErr("iam.role.unknown_permission", `Unknown permission: ${String(key)}`, { key: String(key) });
      }
      permissions.add(key);
    }
    const limits = new Map<LimitName, bigint>();
    const limitEntries: Iterable<readonly [LimitName, bigint]> = props.limits ?? [];
    for (const [name, value] of limitEntries) {
      const checked = checkLimit(name, value);
      if (!checked.ok) return checked;
      limits.set(name, value);
    }
    return ok(new Role(props.id.trim(), props.name.trim(), props.nameEn.trim(), permissions, limits, props.templateCode));
  }

  has(key: PermissionKey): boolean {
    return this.permissions.has(key);
  }

  limit(name: LimitName): bigint | undefined {
    return this.limits.get(name);
  }

  isOwnerTemplate(): boolean {
    return this.templateCode === "OWNER";
  }

  grant(key: PermissionKey): Role {
    const permissions = new Set(this.permissions);
    permissions.add(key);
    return this.copy({ permissions });
  }

  revoke(key: PermissionKey): Role {
    const permissions = new Set(this.permissions);
    permissions.delete(key);
    return this.copy({ permissions });
  }

  withLimit(name: LimitName, value: bigint): Result<Role> {
    const checked = checkLimit(name, value);
    if (!checked.ok) return checked;
    const limits = new Map(this.limits);
    limits.set(name, value);
    return ok(this.copy({ limits }));
  }

  withoutLimit(name: LimitName): Role {
    const limits = new Map(this.limits);
    limits.delete(name);
    return this.copy({ limits });
  }

  rename(name: string, nameEn: string): Result<Role> {
    if (isBlank(name) || isBlank(nameEn)) {
      return domainErr("iam.role.invalid_name", "Role name must not be blank", { id: this.id });
    }
    return ok(this.copy({ name: name.trim(), nameEn: nameEn.trim() }));
  }

  /** Copy of this role (e.g. of a built-in template) as an independent, deletable custom role. */
  cloneAs(id: string, name: string, nameEn: string): Result<Role> {
    return Role.create({ id, name, nameEn, permissions: this.permissions, limits: this.limits });
  }

  private copy(patch: RolePatch): Role {
    return new Role(
      this.id,
      patch.name ?? this.name,
      patch.nameEn ?? this.nameEn,
      patch.permissions ?? this.permissions,
      patch.limits ?? this.limits,
      this.templateCode,
    );
  }
}

// ------------------------------------------------------------------ built-in templates (FR-IAM-103)

const without = (keys: readonly PermissionKey[], drop: readonly PermissionKey[]): readonly PermissionKey[] =>
  keys.filter((k) => !drop.includes(k));

const PHARMACIST_PERMISSIONS: readonly PermissionKey[] = [
  "catalog.view", "inventory.view", "inventory.view_cost", "inventory.receive", "inventory.manage_lots",
  "purchase.view", "sale.create", "sale.post", "sale.discount_line", "sale.discount_invoice", "sale.credit",
  "sale.void_draft", "sale.return", "sale.reprint", "sale.view_cost", "customer.view", "customer.create",
  "customer.receive_payment", "customer.view_statement", "cash.open_shift", "cash.close_shift", "cash.receipt",
  "report.sales", "report.inventory", "report.expiry",
];

const CASHIER_PERMISSIONS: readonly PermissionKey[] = [
  "catalog.view", "inventory.view", "sale.create", "sale.post", "sale.discount_line", "sale.discount_invoice",
  "sale.void_draft", "sale.reprint", "customer.view", "customer.receive_payment", "cash.open_shift",
  "cash.close_shift", "cash.receipt",
];

const ACCOUNTANT_PERMISSIONS: readonly PermissionKey[] = [
  "inventory.view", "inventory.view_cost", "purchase.view", "customer.view", "customer.view_statement",
  "supplier.view", "supplier.view_statement", "supplier.pay", "cash.view_all_shifts", "cash.expense",
  "cash.transfer", "cash.exchange", "report.sales", "report.inventory", "report.expiry", "report.financial",
  "report.profit", "report.cost", "report.export", "accounting.view", "accounting.journal_create",
  "accounting.journal_post", "accounting.journal_reverse", "accounting.close_period", "accounting.chart_edit",
  "audit.view",
];

const STOREKEEPER_PERMISSIONS: readonly PermissionKey[] = [
  "catalog.view", "catalog.manage_barcodes", "catalog.print_labels", "inventory.view", "inventory.receive",
  "inventory.adjust", "inventory.count", "inventory.transfer", "inventory.manage_lots", "inventory.print_labels",
  "purchase.view", "purchase.order", "purchase.create", "supplier.view", "report.inventory", "report.expiry",
];

function template(
  code: BuiltInRoleCode,
  name: string,
  nameEn: string,
  permissions: readonly PermissionKey[],
  limits: readonly (readonly [LimitName, bigint])[] = [],
): Role {
  return unwrap(Role.create({ id: `builtin:${code}`, name, nameEn, permissions, limits, templateCode: code }));
}

export const BUILT_IN_ROLES: Readonly<Record<BuiltInRoleCode, Role>> = Object.freeze({
  OWNER: template("OWNER", "مالك", "Owner", PERMISSION_KEYS),
  MANAGER: template("MANAGER", "مدير", "Manager", without(PERMISSION_KEYS, ["user.manage", "backup.restore"])),
  PHARMACIST: template("PHARMACIST", "صيدلي", "Pharmacist", PHARMACIST_PERMISSIONS, [["max_discount_bp", 1000n]]),
  CASHIER: template("CASHIER", "كاشير", "Cashier", CASHIER_PERMISSIONS, [["max_discount_bp", 500n]]),
  ACCOUNTANT: template("ACCOUNTANT", "محاسب", "Accountant", ACCOUNTANT_PERMISSIONS),
  STOREKEEPER: template("STOREKEEPER", "أمين مخزن", "Storekeeper", STOREKEEPER_PERMISSIONS),
});

export function builtInRole(code: BuiltInRoleCode): Role {
  return BUILT_IN_ROLES[code];
}

/** FR-IAM-103: disabling a user or revoking OWNER must leave at least one active owner. */
export function ensureOwnerRemains(activeOwnersAfterChange: number): Result<void> {
  if (activeOwnersAfterChange < 1) {
    return domainErr("iam.last_owner", "At least one active owner must remain", { activeOwnersAfterChange });
  }
  return ok(undefined);
}

/** FR-IAM-103: the OWNER template itself is never deletable (copies are). */
export function canDeleteRole(role: Role): Result<void> {
  if (role.isOwnerTemplate()) {
    return domainErr("iam.role.owner_undeletable", "The built-in OWNER role cannot be deleted", { roleId: role.id });
  }
  return ok(undefined);
}
