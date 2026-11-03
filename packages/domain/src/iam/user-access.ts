/**
 * UserAccess — FR-IAM-102/104/105/108. Effective permissions of one user:
 *   union of roles  <  per-user allow override  <  per-user deny override (deny always wins).
 * Numeric limits (FR-IAM-104): the user's own override value if present, otherwise the most
 * permissive value among the user's roles. A role that grants a capability bound to the limit
 * without setting the limit is unbounded, so the result is `undefined` (= no cap configured).
 * A disabled user (FR-IAM-108) has no permissions at all but keeps identity for history.
 */
import { domainErr, ok, unwrap, type Result } from "../shared/result.js";
import { isLimitName, PERMISSIONS, permissionsForLimit, type LimitName, type PermissionKey } from "./permissions.js";
import type { Role } from "./role.js";

export type OverrideEffect = "allow" | "deny";

export interface UserOverrides {
  readonly allow: ReadonlySet<PermissionKey>;
  readonly deny: ReadonlySet<PermissionKey>;
  readonly limits: ReadonlyMap<LimitName, bigint>;
}

export const EMPTY_OVERRIDES: UserOverrides = Object.freeze({
  allow: new Set<PermissionKey>(),
  deny: new Set<PermissionKey>(),
  limits: new Map<LimitName, bigint>(),
});

/** One row of `user_permission_overrides` (limit_value is mapped via the permission's numericLimit). */
export interface OverrideRow {
  readonly permissionKey: PermissionKey;
  readonly effect: OverrideEffect;
  readonly limitValue?: bigint;
  readonly expiresAt?: Date;
}

/** Compile override rows into sets, dropping rows whose `expires_at` has passed at `now`. */
export function compileOverrides(rows: readonly OverrideRow[], now: Date): UserOverrides {
  const allow = new Set<PermissionKey>();
  const deny = new Set<PermissionKey>();
  const limits = new Map<LimitName, bigint>();
  for (const row of rows) {
    if (row.expiresAt !== undefined && row.expiresAt.getTime() <= now.getTime()) continue;
    if (row.effect === "deny") {
      deny.add(row.permissionKey);
      continue;
    }
    allow.add(row.permissionKey);
    const limitName = PERMISSIONS[row.permissionKey].numericLimit;
    if (row.limitValue === undefined || limitName === undefined) continue;
    const prev = limits.get(limitName);
    if (prev === undefined || row.limitValue > prev) limits.set(limitName, row.limitValue);
  }
  return Object.freeze({ allow, deny, limits });
}

export interface UserAccessProps {
  readonly userId: string;
  readonly roles: readonly Role[];
  readonly overrides?: Partial<UserOverrides>;
  readonly active?: boolean;
}

export class UserAccess {
  readonly userId: string;
  readonly roles: readonly Role[];
  readonly overrides: UserOverrides;
  readonly active: boolean;

  private constructor(userId: string, roles: readonly Role[], overrides: UserOverrides, active: boolean) {
    this.userId = userId;
    this.roles = roles;
    this.overrides = overrides;
    this.active = active;
    Object.freeze(this);
  }

  static create(props: UserAccessProps): Result<UserAccess> {
    if (props.userId.trim().length === 0) return domainErr("iam.user.invalid_id", "User id must not be blank");
    const limits = new Map<LimitName, bigint>();
    const limitEntries: Iterable<readonly [LimitName, bigint]> = props.overrides?.limits ?? [];
    for (const [name, value] of limitEntries) {
      if (!isLimitName(name) || typeof value !== "bigint" || value < 0n) {
        return domainErr("iam.user.invalid_limit", "Override limit must be a known name with a non-negative bigint", {
          name: String(name),
          value: String(value),
        });
      }
      limits.set(name, value);
    }
    const byId = new Map<string, Role>();
    for (const role of props.roles) if (!byId.has(role.id)) byId.set(role.id, role);
    const overrides: UserOverrides = Object.freeze({
      allow: new Set(props.overrides?.allow ?? []),
      deny: new Set(props.overrides?.deny ?? []),
      limits,
    });
    return ok(new UserAccess(props.userId.trim(), Object.freeze([...byId.values()]), overrides, props.active ?? true));
  }

  isOwner(): boolean {
    return this.roles.some((r) => r.templateCode === "OWNER");
  }

  hasRole(roleId: string): boolean {
    return this.roles.some((r) => r.id === roleId);
  }

  /** Resolved permission set (empty for a disabled user). */
  effectivePermissions(): ReadonlySet<PermissionKey> {
    const out = new Set<PermissionKey>();
    if (!this.active) return out;
    for (const role of this.roles) for (const key of role.permissions) out.add(key);
    for (const key of this.overrides.allow) out.add(key);
    for (const key of this.overrides.deny) out.delete(key);
    return out;
  }

  /** FR-IAM-108: disabled users keep identity and history but lose all access. */
  disable(): UserAccess {
    return new UserAccess(this.userId, this.roles, this.overrides, false);
  }

  enable(): UserAccess {
    return new UserAccess(this.userId, this.roles, this.overrides, true);
  }

  withOverrides(overrides: Partial<UserOverrides>): Result<UserAccess> {
    return UserAccess.create({ userId: this.userId, roles: this.roles, overrides, active: this.active });
  }

  withRoles(roles: readonly Role[]): UserAccess {
    // Existing state is already valid, so re-creation cannot fail (programmer error otherwise).
    return unwrap(UserAccess.create({ userId: this.userId, roles, overrides: this.overrides, active: this.active }));
  }
}

/** Precedence: disabled → false; deny override → false; allow override → true; else any role. */
export function can(access: UserAccess, key: PermissionKey): boolean {
  if (!access.active) return false;
  if (access.overrides.deny.has(key)) return false;
  if (access.overrides.allow.has(key)) return true;
  return access.roles.some((r) => r.has(key));
}

/**
 * Numeric limit for `name`: user override if set, otherwise the largest role value. Returns
 * `undefined` when no bound is configured (a role grants the capability without a cap, or no
 * role touches the limit at all) — callers must still check `can` for the permission itself.
 */
export function limitFor(access: UserAccess, name: LimitName): bigint | undefined {
  const own = access.overrides.limits.get(name);
  if (own !== undefined) return own;
  const linked = permissionsForLimit(name);
  let best: bigint | undefined;
  for (const role of access.roles) {
    const value = role.limit(name);
    if (value !== undefined) {
      if (best === undefined || value > best) best = value;
      continue;
    }
    if (linked.some((k) => role.has(k))) return undefined;
  }
  return best;
}

/**
 * Actions that ALWAYS need a second person's manager PIN even when the actor holds the permission
 * (four-eyes): reversing a posted sale, selling above the official price (default `warn` policy)
 * and closing another user's shift. Missing permissions / exceeded limits are reported as
 * `auth.forbidden` / `auth.limit_exceeded`; the UI then opens the PIN dialog and retries with an
 * elevated context (FR-IAM-105).
 */
export const MANAGER_PIN_ACTIONS: ReadonlySet<PermissionKey> = Object.freeze(
  new Set<PermissionKey>(["sale.void", "sale.override_official_price", "cash.close_other_shift"]),
);

export function requireManagerPin(action: PermissionKey): boolean {
  return MANAGER_PIN_ACTIONS.has(action);
}
