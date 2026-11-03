import { describe, expect, it } from "vitest";
import {
  isBpLimit,
  isLimitName,
  isPermissionKey,
  LIMIT_NAMES,
  limitedPermissions,
  PERMISSION_CATALOG,
  PERMISSION_GROUPS,
  PERMISSION_KEYS,
  PERMISSIONS,
  permissionsByGroup,
  permissionsForLimit,
} from "./permissions.js";

describe("permission catalog", () => {
  it("flattens every catalog leaf into a unique `resource.action` key", () => {
    let count = 0;
    for (const group of PERMISSION_GROUPS) {
      for (const action of Object.keys(PERMISSION_CATALOG[group])) {
        const key = `${group}.${action}`;
        expect(isPermissionKey(key)).toBe(true);
        if (isPermissionKey(key)) {
          const def = PERMISSIONS[key];
          expect(def.key).toBe(key);
          expect(def.group).toBe(group);
          expect(def.nameAr.trim().length).toBeGreaterThan(0);
          expect(def.nameEn.trim().length).toBeGreaterThan(0);
          expect(Object.isFrozen(def)).toBe(true);
        }
        count += 1;
      }
    }
    expect(PERMISSION_KEYS).toHaveLength(count);
    expect(new Set(PERMISSION_KEYS).size).toBe(count);
    expect(Object.isFrozen(PERMISSIONS)).toBe(true);
    expect(Object.isFrozen(PERMISSION_KEYS)).toBe(true);
    expect(Object.isFrozen(PERMISSION_CATALOG.sale.create)).toBe(true);
  });

  it("covers the dictionary resources", () => {
    expect([...PERMISSION_GROUPS].sort()).toEqual([
      "accounting", "audit", "backup", "cash", "catalog", "customer", "inventory",
      "purchase", "report", "sale", "settings", "supplier", "user",
    ]);
  });

  it("binds FR-IAM-104 numeric limits to canonical limit names", () => {
    expect(PERMISSIONS["sale.discount_line"].numericLimit).toBe("max_discount_bp");
    expect(PERMISSIONS["sale.discount_invoice"].numericLimit).toBe("max_discount_bp");
    expect(PERMISSIONS["sale.edit_price"].numericLimit).toBe("max_price_change_bp");
    expect(PERMISSIONS["sale.void"].numericLimit).toBe("max_void_amount_minor");
    expect(PERMISSIONS["cash.expense"].numericLimit).toBe("max_expense_amount_minor");
    expect(PERMISSIONS["sale.create"].numericLimit).toBeUndefined();
    expect("numericLimit" in PERMISSIONS["sale.create"]).toBe(false);
    for (const def of limitedPermissions()) expect(isLimitName(def.numericLimit)).toBe(true);
    expect(limitedPermissions().map((d) => d.key).sort()).toEqual([
      "cash.expense", "sale.discount_invoice", "sale.discount_line", "sale.edit_price", "sale.void",
    ]);
    expect(Object.isFrozen(limitedPermissions())).toBe(true);
  });

  it("isPermissionKey rejects non-strings, unknown keys and prototype names", () => {
    expect(isPermissionKey("sale.create")).toBe(true);
    expect(isPermissionKey(42)).toBe(false);
    expect(isPermissionKey(null)).toBe(false);
    expect(isPermissionKey("sale.teleport")).toBe(false);
    expect(isPermissionKey("")).toBe(false);
    expect(isPermissionKey("toString")).toBe(false);
    expect(isPermissionKey("constructor")).toBe(false);
  });

  it("permissionsByGroup returns only that group's definitions", () => {
    const sale = permissionsByGroup("sale");
    expect(sale).toHaveLength(Object.keys(PERMISSION_CATALOG.sale).length);
    expect(sale.every((d) => d.group === "sale")).toBe(true);
    expect(Object.isFrozen(sale)).toBe(true);
    expect(permissionsByGroup("audit").map((d) => d.key).sort()).toEqual(["audit.export", "audit.view"]);
  });

  it("permissionsForLimit lists the permissions sharing a limit", () => {
    expect([...permissionsForLimit("max_discount_bp")].sort()).toEqual(["sale.discount_invoice", "sale.discount_line"]);
    expect(permissionsForLimit("max_void_amount_minor")).toEqual(["sale.void"]);
    expect(permissionsForLimit("max_expense_amount_minor")).toEqual(["cash.expense"]);
    expect(permissionsForLimit("max_price_change_bp")).toEqual(["sale.edit_price"]);
  });

  it("limit name helpers", () => {
    expect(LIMIT_NAMES).toEqual(["max_discount_bp", "max_price_change_bp", "max_void_amount_minor", "max_expense_amount_minor"]);
    expect(isLimitName("max_discount_bp")).toBe(true);
    expect(isLimitName("max_days")).toBe(false);
    expect(isLimitName(5)).toBe(false);
    expect(isBpLimit("max_discount_bp")).toBe(true);
    expect(isBpLimit("max_price_change_bp")).toBe(true);
    expect(isBpLimit("max_void_amount_minor")).toBe(false);
    expect(isBpLimit("max_expense_amount_minor")).toBe(false);
  });
});
