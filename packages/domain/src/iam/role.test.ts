import { describe, expect, it } from "vitest";
import { unwrap, type Result } from "../shared/result.js";
import { PERMISSION_KEYS, type LimitName, type PermissionKey } from "./permissions.js";
import { BUILT_IN_ROLE_CODES, BUILT_IN_ROLES, builtInRole, canDeleteRole, ensureOwnerRemains, Role } from "./role.js";

const codeOf = (r: Result<unknown>): string | undefined => (r.ok ? undefined : r.error.code);
const base = { id: "r1", name: "دور", nameEn: "Role" } as const;

describe("Role.create", () => {
  it("creates a frozen role and dedupes permissions", () => {
    const role = unwrap(
      Role.create({ ...base, permissions: ["sale.create", "sale.create", "sale.discount_line"], limits: [["max_discount_bp", 500n]] }),
    );
    expect(role.id).toBe("r1");
    expect(role.name).toBe("دور");
    expect(role.nameEn).toBe("Role");
    expect(role.has("sale.create")).toBe(true);
    expect(role.has("user.manage")).toBe(false);
    expect(role.permissions.size).toBe(2);
    expect(role.limit("max_discount_bp")).toBe(500n);
    expect(role.limit("max_void_amount_minor")).toBeUndefined();
    expect(role.templateCode).toBeUndefined();
    expect(role.isOwnerTemplate()).toBe(false);
    expect(Object.isFrozen(role)).toBe(true);
  });

  it("trims id and names", () => {
    const role = unwrap(Role.create({ id: " r2 ", name: " كاشير ", nameEn: " Cashier ", permissions: [] }));
    expect(role.id).toBe("r2");
    expect(role.name).toBe("كاشير");
    expect(role.nameEn).toBe("Cashier");
    expect(role.permissions.size).toBe(0);
    expect(role.limits.size).toBe(0);
  });

  it("rejects blank id and names", () => {
    expect(codeOf(Role.create({ ...base, id: " ", permissions: [] }))).toBe("iam.role.invalid_id");
    expect(codeOf(Role.create({ ...base, name: "", permissions: [] }))).toBe("iam.role.invalid_name");
    expect(codeOf(Role.create({ ...base, nameEn: "  ", permissions: [] }))).toBe("iam.role.invalid_name");
  });

  it("rejects unknown permission keys loaded from storage", () => {
    const r = Role.create({ ...base, permissions: ["sale.teleport" as unknown as PermissionKey] });
    expect(codeOf(r)).toBe("iam.role.unknown_permission");
    if (!r.ok) expect(r.error.details).toEqual({ key: "sale.teleport" });
  });

  it("rejects invalid limits", () => {
    expect(codeOf(Role.create({ ...base, permissions: [], limits: [["max_discount_bp", -1n]] }))).toBe("iam.role.invalid_limit");
    expect(codeOf(Role.create({ ...base, permissions: [], limits: [["max_days" as unknown as LimitName, 1n]] }))).toBe(
      "iam.role.invalid_limit",
    );
    expect(codeOf(Role.create({ ...base, permissions: [], limits: [["max_discount_bp", 5 as unknown as bigint]] }))).toBe(
      "iam.role.invalid_limit",
    );
  });
});

describe("Role intent methods return new instances", () => {
  const role = unwrap(Role.create({ ...base, permissions: ["sale.create"], limits: [["max_discount_bp", 500n]] }));

  it("grant / revoke", () => {
    const granted = role.grant("sale.post");
    expect(granted.has("sale.post")).toBe(true);
    expect(role.has("sale.post")).toBe(false);
    const revoked = granted.revoke("sale.create");
    expect(revoked.has("sale.create")).toBe(false);
    expect(revoked.has("sale.post")).toBe(true);
    expect(revoked.limit("max_discount_bp")).toBe(500n);
    expect(revoked.id).toBe(role.id);
    expect(revoked.name).toBe(role.name);
  });

  it("withLimit validates and replaces; withoutLimit removes", () => {
    const raised = unwrap(role.withLimit("max_discount_bp", 1000n));
    expect(raised.limit("max_discount_bp")).toBe(1000n);
    expect(role.limit("max_discount_bp")).toBe(500n);
    expect(codeOf(role.withLimit("max_discount_bp", -5n))).toBe("iam.role.invalid_limit");
    const cleared = role.withoutLimit("max_discount_bp");
    expect(cleared.limit("max_discount_bp")).toBeUndefined();
    expect(cleared.has("sale.create")).toBe(true);
  });

  it("rename", () => {
    const renamed = unwrap(role.rename(" جديد ", " New "));
    expect(renamed.name).toBe("جديد");
    expect(renamed.nameEn).toBe("New");
    expect(renamed.permissions).toEqual(role.permissions);
    expect(codeOf(role.rename(" ", "x"))).toBe("iam.role.invalid_name");
    expect(codeOf(role.rename("x", ""))).toBe("iam.role.invalid_name");
  });

  it("cloneAs copies permissions and limits without the template code", () => {
    const copy = unwrap(builtInRole("CASHIER").cloneAs("018f-uuid", "كاشير مسائي", "Evening cashier"));
    expect(copy.templateCode).toBeUndefined();
    expect(copy.isOwnerTemplate()).toBe(false);
    expect(copy.permissions).toEqual(builtInRole("CASHIER").permissions);
    expect(copy.limit("max_discount_bp")).toBe(500n);
    expect(codeOf(builtInRole("CASHIER").cloneAs("", "x", "y"))).toBe("iam.role.invalid_id");
  });
});

describe("built-in role templates (FR-IAM-103)", () => {
  it("exist for every code with ids and template codes", () => {
    for (const code of BUILT_IN_ROLE_CODES) {
      const r = builtInRole(code);
      expect(r).toBe(BUILT_IN_ROLES[code]);
      expect(r.templateCode).toBe(code);
      expect(r.id).toBe(`builtin:${code}`);
    }
    expect(Object.isFrozen(BUILT_IN_ROLES)).toBe(true);
  });

  it("OWNER has every permission and no caps", () => {
    const owner = builtInRole("OWNER");
    expect(owner.permissions.size).toBe(PERMISSION_KEYS.length);
    expect(owner.isOwnerTemplate()).toBe(true);
    expect(owner.limit("max_discount_bp")).toBeUndefined();
  });

  it("MANAGER has everything except user.manage and backup.restore", () => {
    const manager = builtInRole("MANAGER");
    expect(manager.has("user.manage")).toBe(false);
    expect(manager.has("backup.restore")).toBe(false);
    expect(manager.permissions.size).toBe(PERMISSION_KEYS.length - 2);
    expect(manager.has("sale.void")).toBe(true);
    expect(manager.has("report.profit")).toBe(true);
  });

  it("PHARMACIST sells, returns, sees cost, receives, 10 % discount cap", () => {
    const r = builtInRole("PHARMACIST");
    for (const k of ["sale.create", "sale.return", "inventory.view_cost", "inventory.receive", "report.inventory"] as const) {
      expect(r.has(k)).toBe(true);
    }
    expect(r.limit("max_discount_bp")).toBe(1000n);
    expect(r.has("report.profit")).toBe(false);
    expect(r.has("user.manage")).toBe(false);
  });

  it("CASHIER sells with 5 % cap, voids drafts only, no cost/profit, own shift only", () => {
    const r = builtInRole("CASHIER");
    for (const k of ["sale.create", "sale.void_draft", "cash.open_shift", "cash.close_shift"] as const) expect(r.has(k)).toBe(true);
    expect(r.limit("max_discount_bp")).toBe(500n);
    for (const k of ["sale.void", "inventory.view_cost", "sale.view_cost", "report.profit", "cash.close_other_shift"] as const) {
      expect(r.has(k)).toBe(false);
    }
  });

  it("ACCOUNTANT does finance and journals but never sells", () => {
    const r = builtInRole("ACCOUNTANT");
    for (const k of ["report.financial", "report.profit", "accounting.journal_post"] as const) expect(r.has(k)).toBe(true);
    expect(r.has("sale.create")).toBe(false);
    expect(r.has("sale.post")).toBe(false);
  });

  it("STOREKEEPER receives/adjusts/counts/prints labels but sees no selling prices", () => {
    const r = builtInRole("STOREKEEPER");
    for (const k of ["inventory.receive", "inventory.adjust", "inventory.count", "inventory.print_labels", "catalog.print_labels"] as const) {
      expect(r.has(k)).toBe(true);
    }
    for (const k of ["catalog.edit_price", "sale.create", "inventory.view_cost"] as const) expect(r.has(k)).toBe(false);
  });
});

describe("owner protection", () => {
  it("ensureOwnerRemains rejects removing the last owner", () => {
    expect(ensureOwnerRemains(1).ok).toBe(true);
    const r = ensureOwnerRemains(0);
    expect(codeOf(r)).toBe("iam.last_owner");
    if (!r.ok) expect(r.error.details).toEqual({ activeOwnersAfterChange: 0 });
  });

  it("canDeleteRole forbids deleting the OWNER template only", () => {
    expect(codeOf(canDeleteRole(builtInRole("OWNER")))).toBe("iam.role.owner_undeletable");
    expect(canDeleteRole(builtInRole("CASHIER")).ok).toBe(true);
    expect(canDeleteRole(unwrap(builtInRole("OWNER").cloneAs("x", "نسخة", "Copy"))).ok).toBe(true);
  });
});
