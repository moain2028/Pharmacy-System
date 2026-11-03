import { describe, expect, it } from "vitest";
import { unwrap, type Result } from "../shared/result.js";
import { PERMISSION_KEYS, type LimitName, type PermissionKey } from "./permissions.js";
import { builtInRole, Role } from "./role.js";
import {
  can,
  compileOverrides,
  EMPTY_OVERRIDES,
  limitFor,
  MANAGER_PIN_ACTIONS,
  requireManagerPin,
  UserAccess,
  type OverrideRow,
  type UserOverrides,
} from "./user-access.js";

const codeOf = (r: Result<unknown>): string | undefined => (r.ok ? undefined : r.error.code);
const cashier = builtInRole("CASHIER"); // max_discount_bp 500
const pharmacist = builtInRole("PHARMACIST"); // max_discount_bp 1000
const user = (roles: readonly Role[], overrides: Partial<UserOverrides> = {}): UserAccess =>
  unwrap(UserAccess.create({ userId: "u1", roles, overrides }));

describe("limitFor", () => {
  it("golden: role limit 500 with user override 1000 → 1000", () => {
    const u = user([cashier], { limits: new Map<LimitName, bigint>([["max_discount_bp", 1000n]]) });
    expect(limitFor(u, "max_discount_bp")).toBe(1000n);
  });

  it("takes the most permissive role value when there is no override", () => {
    expect(limitFor(user([cashier]), "max_discount_bp")).toBe(500n);
    expect(limitFor(user([cashier, pharmacist]), "max_discount_bp")).toBe(1000n);
    expect(limitFor(user([pharmacist, cashier]), "max_discount_bp")).toBe(1000n);
  });

  it("an override may also lower the limit below the roles", () => {
    expect(limitFor(user([pharmacist], { limits: new Map<LimitName, bigint>([["max_discount_bp", 300n]]) }), "max_discount_bp")).toBe(300n);
  });

  it("a role granting the capability without a cap makes the limit unbounded (undefined)", () => {
    expect(limitFor(user([cashier, builtInRole("MANAGER")]), "max_discount_bp")).toBeUndefined();
    expect(
      limitFor(user([cashier, builtInRole("MANAGER")], { limits: new Map<LimitName, bigint>([["max_discount_bp", 300n]]) }), "max_discount_bp"),
    ).toBe(300n);
  });

  it("roles that do not touch the limit are ignored", () => {
    expect(limitFor(user([cashier, builtInRole("ACCOUNTANT")]), "max_discount_bp")).toBe(500n);
    expect(limitFor(user([cashier]), "max_expense_amount_minor")).toBeUndefined();
    expect(limitFor(user([]), "max_discount_bp")).toBeUndefined();
  });
});

describe("can — precedence deny > allow > roles", () => {
  it("deny override beats role allow", () => {
    expect(can(user([cashier]), "sale.create")).toBe(true);
    expect(can(user([cashier], { deny: new Set<PermissionKey>(["sale.create"]) }), "sale.create")).toBe(false);
  });

  it("deny override beats allow override", () => {
    const u = user([], { allow: new Set<PermissionKey>(["user.manage"]), deny: new Set<PermissionKey>(["user.manage"]) });
    expect(can(u, "user.manage")).toBe(false);
  });

  it("allow override grants what no role grants", () => {
    expect(can(user([cashier]), "user.manage")).toBe(false);
    expect(can(user([cashier], { allow: new Set<PermissionKey>(["user.manage"]) }), "user.manage")).toBe(true);
  });

  it("roles are unioned", () => {
    expect(can(user([cashier]), "inventory.receive")).toBe(false);
    expect(can(user([cashier, pharmacist]), "inventory.receive")).toBe(true);
  });

  it("acceptance FR-IAM-102: cashier(5 %)+pharmacist(10 %)+deny sale.discount_invoice", () => {
    const u = user([cashier, pharmacist], { deny: new Set<PermissionKey>(["sale.discount_invoice"]) });
    expect(can(u, "sale.discount_line")).toBe(true);
    expect(can(u, "sale.discount_invoice")).toBe(false);
    expect(limitFor(u, "max_discount_bp")).toBe(1000n);
  });

  it("a disabled user can do nothing (FR-IAM-108) and re-enabling restores access", () => {
    const active = user([builtInRole("OWNER")], { allow: new Set<PermissionKey>(["user.manage"]) });
    const disabled = active.disable();
    expect(disabled.active).toBe(false);
    expect(active.active).toBe(true);
    expect(PERMISSION_KEYS.every((k) => !can(disabled, k))).toBe(true);
    expect(disabled.effectivePermissions().size).toBe(0);
    expect(can(disabled.enable(), "sale.create")).toBe(true);
    expect(disabled.userId).toBe("u1");
    expect(Object.isFrozen(disabled)).toBe(true);
  });
});

describe("UserAccess", () => {
  it("effectivePermissions = roles ∪ allow − deny", () => {
    const u = user([cashier], { allow: new Set<PermissionKey>(["user.manage"]), deny: new Set<PermissionKey>(["sale.post"]) });
    const eff = u.effectivePermissions();
    expect(eff.has("sale.create")).toBe(true);
    expect(eff.has("user.manage")).toBe(true);
    expect(eff.has("sale.post")).toBe(false);
    expect(eff.size).toBe(cashier.permissions.size);
  });

  it("validates id and override limits", () => {
    expect(codeOf(UserAccess.create({ userId: "  ", roles: [] }))).toBe("iam.user.invalid_id");
    expect(codeOf(UserAccess.create({ userId: "u", roles: [], overrides: { limits: new Map<LimitName, bigint>([["max_discount_bp", -1n]]) } }))).toBe(
      "iam.user.invalid_limit",
    );
    expect(
      codeOf(UserAccess.create({ userId: "u", roles: [], overrides: { limits: new Map<LimitName, bigint>([["max_days" as LimitName, 1n]]) } })),
    ).toBe("iam.user.invalid_limit");
    expect(
      codeOf(UserAccess.create({ userId: "u", roles: [], overrides: { limits: new Map<LimitName, bigint>([["max_discount_bp", 7 as unknown as bigint]]) } })),
    ).toBe("iam.user.invalid_limit");
  });

  it("trims the id, dedupes roles and defaults to active with empty overrides", () => {
    const u = unwrap(UserAccess.create({ userId: " u9 ", roles: [cashier, cashier, pharmacist] }));
    expect(u.userId).toBe("u9");
    expect(u.roles).toHaveLength(2);
    expect(u.active).toBe(true);
    expect(u.overrides.allow.size).toBe(0);
    expect(u.overrides.deny.size).toBe(0);
    expect(u.overrides.limits.size).toBe(0);
    expect(u.hasRole(cashier.id)).toBe(true);
    expect(u.hasRole("nope")).toBe(false);
    expect(Object.isFrozen(u.roles)).toBe(true);
  });

  it("isOwner reflects the OWNER template", () => {
    expect(user([builtInRole("OWNER")]).isOwner()).toBe(true);
    expect(user([builtInRole("MANAGER")]).isOwner()).toBe(false);
  });

  it("withOverrides / withRoles return new instances, originals untouched", () => {
    const u = user([cashier]);
    const changed = unwrap(u.withOverrides({ limits: new Map<LimitName, bigint>([["max_discount_bp", 900n]]) }));
    expect(limitFor(changed, "max_discount_bp")).toBe(900n);
    expect(limitFor(u, "max_discount_bp")).toBe(500n);
    expect(codeOf(u.withOverrides({ limits: new Map<LimitName, bigint>([["max_discount_bp", -9n]]) }))).toBe("iam.user.invalid_limit");
    const reRoled = u.withRoles([pharmacist]);
    expect(reRoled.hasRole(pharmacist.id)).toBe(true);
    expect(reRoled.hasRole(cashier.id)).toBe(false);
    expect(u.hasRole(cashier.id)).toBe(true);
  });
});

describe("compileOverrides", () => {
  const now = new Date("2025-06-01T12:00:00.000Z");

  it("maps rows to sets, honours expires_at and keeps the largest limit per limit name", () => {
    const rows: OverrideRow[] = [
      { permissionKey: "cash.close_other_shift", effect: "allow", expiresAt: new Date("2025-06-02T00:00:00.000Z") },
      { permissionKey: "user.manage", effect: "allow", expiresAt: new Date("2025-06-01T12:00:00.000Z") },
      { permissionKey: "sale.discount_invoice", effect: "deny", limitValue: 9000n },
      { permissionKey: "sale.discount_line", effect: "allow", limitValue: 700n },
      { permissionKey: "sale.discount_line", effect: "allow", limitValue: 1000n },
      { permissionKey: "sale.discount_invoice", effect: "allow", limitValue: 900n },
      { permissionKey: "sale.create", effect: "allow", limitValue: 5n },
      { permissionKey: "cash.expense", effect: "allow" },
    ];
    const o = compileOverrides(rows, now);
    expect([...o.allow].sort()).toEqual(["cash.close_other_shift", "cash.expense", "sale.create", "sale.discount_invoice", "sale.discount_line"]);
    expect([...o.deny]).toEqual(["sale.discount_invoice"]);
    expect(o.limits.get("max_discount_bp")).toBe(1000n);
    expect(o.limits.size).toBe(1);
    expect(Object.isFrozen(o)).toBe(true);
  });

  it("empty input and EMPTY_OVERRIDES", () => {
    const o = compileOverrides([], now);
    expect(o.allow.size + o.deny.size + o.limits.size).toBe(0);
    expect(Object.isFrozen(EMPTY_OVERRIDES)).toBe(true);
    expect(EMPTY_OVERRIDES.allow.size).toBe(0);
  });
});

describe("requireManagerPin policy table", () => {
  it("lists four-eyes actions only", () => {
    expect(requireManagerPin("sale.void")).toBe(true);
    expect(requireManagerPin("sale.override_official_price")).toBe(true);
    expect(requireManagerPin("cash.close_other_shift")).toBe(true);
    expect(requireManagerPin("sale.create")).toBe(false);
    expect(requireManagerPin("sale.discount_line")).toBe(false);
    expect(MANAGER_PIN_ACTIONS.size).toBe(3);
  });
});
