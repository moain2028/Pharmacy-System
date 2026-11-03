import { describe, expect, it } from "vitest";
import { DomainError, unwrap, type Result } from "../shared/result.js";
import { authorize, createContext, elevate } from "./authorization.js";
import type { LimitName, PermissionKey } from "./permissions.js";
import { builtInRole, Role } from "./role.js";
import { UserAccess, type UserOverrides } from "./user-access.js";

const codeOf = (r: Result<unknown>): string | undefined => (r.ok ? undefined : r.error.code);
const detailsOf = (r: Result<unknown>): Readonly<Record<string, unknown>> => (r.ok ? {} : r.error.details);
function thrownCode(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (e) {
    return e instanceof DomainError ? e.code : "not-a-domain-error";
  }
}

const mkRole = (id: string, perms: readonly PermissionKey[], limits: readonly (readonly [LimitName, bigint])[] = []): Role =>
  unwrap(Role.create({ id, name: id, nameEn: id, permissions: perms, limits }));
const mkUser = (userId: string, roles: readonly Role[], overrides: Partial<UserOverrides> = {}): UserAccess =>
  unwrap(UserAccess.create({ userId, roles, overrides }));

const cashierRole = mkRole(
  "r-cashier",
  ["sale.create", "sale.discount_line", "sale.edit_price", "sale.void", "cash.expense"],
  [["max_discount_bp", 500n], ["max_price_change_bp", 1000n], ["max_expense_amount_minor", 50_000n]],
);
const cashier = mkUser("u-cashier", [cashierRole], { limits: new Map<LimitName, bigint>([["max_discount_bp", 1000n]]) });
const plainCashier = mkUser("u-plain", [cashierRole]);
const manager = mkUser("u-manager", [builtInRole("MANAGER")]);
const supervisor = mkUser("u-super", [
  mkRole("r-super", ["sale.discount_line", "sale.void", "cash.expense", "sale.return"], [["max_discount_bp", 800n], ["max_expense_amount_minor", 10_000n]]),
]);
const senior = mkUser("u-senior", [mkRole("r-senior", ["sale.discount_line"], [["max_discount_bp", 2000n]])]);
const ctx = createContext(cashier, "dev-A");

describe("authorize — permissions", () => {
  it("forbidden when no one holds the permission", () => {
    const r = authorize(ctx, "user.manage");
    expect(codeOf(r)).toBe("auth.forbidden");
    expect(detailsOf(r)).toEqual({ permission: "user.manage", userId: "u-cashier", deviceId: "dev-A" });
  });

  it("non-limited permissions ignore magnitudes", () => {
    expect(authorize(ctx, "sale.create").ok).toBe(true);
    expect(authorize(ctx, "sale.create", { bp: 99_999, amountMinor: 1n }).ok).toBe(true);
  });

  it("createContext is frozen and carries the device", () => {
    expect(Object.isFrozen(ctx)).toBe(true);
    expect(ctx.deviceId).toBe("dev-A");
    expect(ctx.approvedBy).toBeUndefined();
  });
});

describe("authorize — numeric limits (FR-IAM-104)", () => {
  it("golden: discount 1200 bp vs effective limit 1000 → limit_exceeded with details", () => {
    const r = authorize(ctx, "sale.discount_line", { bp: 1200 });
    expect(codeOf(r)).toBe("auth.limit_exceeded");
    expect(detailsOf(r)).toEqual({
      permission: "sale.discount_line", userId: "u-cashier", deviceId: "dev-A",
      limitName: "max_discount_bp", limit: "1000", requested: "1200",
    });
    expect(authorize(ctx, "sale.discount_line", { bp: 1000 }).ok).toBe(true);
    expect(authorize(ctx, "sale.discount_line", { bp: 0 }).ok).toBe(true);
  });

  it("acceptance: cashier capped at 5 % trying 5.01 % is refused (501 > 500)", () => {
    const plain = createContext(plainCashier, "dev-B");
    expect(authorize(plain, "sale.discount_line", { bp: 500 }).ok).toBe(true);
    const r = authorize(plain, "sale.discount_line", { bp: 501 });
    expect(codeOf(r)).toBe("auth.limit_exceeded");
    expect(detailsOf(r).limit).toBe("500");
  });

  it("price deviation is compared by absolute value", () => {
    expect(authorize(ctx, "sale.edit_price", { bp: -800 }).ok).toBe(true);
    const r = authorize(ctx, "sale.edit_price", { bp: -1200 });
    expect(codeOf(r)).toBe("auth.limit_exceeded");
    expect(detailsOf(r).requested).toBe("1200");
  });

  it("amount limits use minor units", () => {
    expect(authorize(ctx, "cash.expense", { amountMinor: 50_000n }).ok).toBe(true);
    expect(authorize(ctx, "cash.expense", { amountMinor: -40_000n }).ok).toBe(true);
    const r = authorize(ctx, "cash.expense", { amountMinor: 50_001n });
    expect(codeOf(r)).toBe("auth.limit_exceeded");
    expect(detailsOf(r)).toMatchObject({ limitName: "max_expense_amount_minor", limit: "50000", requested: "50001" });
  });

  it("no configured bound means unbounded (manager)", () => {
    const m = createContext(manager, "dev-M");
    expect(authorize(m, "sale.discount_line", { bp: 9_999 }).ok).toBe(true);
    expect(authorize(m, "cash.expense", { amountMinor: 1_000_000_000n }).ok).toBe(true);
  });

  it("missing or non-integer magnitudes are programmer errors", () => {
    expect(thrownCode(() => authorize(ctx, "sale.discount_line"))).toBe("auth.missing_value");
    expect(thrownCode(() => authorize(ctx, "sale.discount_line", { amountMinor: 5n }))).toBe("auth.missing_value");
    expect(thrownCode(() => authorize(ctx, "cash.expense", { bp: 5 }))).toBe("auth.missing_value");
    expect(thrownCode(() => authorize(ctx, "sale.discount_line", { bp: 1.5 }))).toBe("auth.non_integer_bp");
    expect(thrownCode(() => authorize(ctx, "sale.discount_line", { bp: Number.NaN }))).toBe("auth.non_integer_bp");
  });
});

describe("authorize — manager PIN (FR-IAM-105)", () => {
  it("four-eyes actions need an approver even when the actor holds the permission", () => {
    const r = authorize(ctx, "sale.void", { amountMinor: 1n });
    expect(codeOf(r)).toBe("auth.pin_required");
    expect(detailsOf(r)).toEqual({ permission: "sale.void", userId: "u-cashier", deviceId: "dev-A" });
    expect(authorize(unwrap(elevate(ctx, manager, "sale.void")), "sale.void", { amountMinor: 1n }).ok).toBe(true);
    expect(authorize(unwrap(elevate(ctx, supervisor, "sale.void")), "sale.void", { amountMinor: 999_999n }).ok).toBe(true);
  });

  it("golden: elevation records approvedBy and lifts the limit", () => {
    const elevated = unwrap(elevate(ctx, manager, "sale.discount_line"));
    expect(elevated.approvedBy?.userId).toBe("u-manager");
    expect(elevated.actor).toBe(cashier);
    expect(elevated.deviceId).toBe("dev-A");
    expect(Object.isFrozen(elevated)).toBe(true);
    expect(authorize(elevated, "sale.discount_line", { bp: 1200 }).ok).toBe(true);
  });

  it("effective limit is the most permissive of actor and approver", () => {
    const bySupervisor = unwrap(elevate(ctx, supervisor, "sale.discount_line")); // 800 < actor 1000
    expect(authorize(bySupervisor, "sale.discount_line", { bp: 1000 }).ok).toBe(true);
    const r1 = authorize(bySupervisor, "sale.discount_line", { bp: 1001 });
    expect(codeOf(r1)).toBe("auth.limit_exceeded");
    expect(detailsOf(r1).limit).toBe("1000");
    const bySenior = unwrap(elevate(ctx, senior, "sale.discount_line")); // 2000 > actor 1000
    expect(authorize(bySenior, "sale.discount_line", { bp: 1500 }).ok).toBe(true);
    const r2 = authorize(bySenior, "sale.discount_line", { bp: 2001 });
    expect(codeOf(r2)).toBe("auth.limit_exceeded");
    expect(detailsOf(r2).limit).toBe("2000");
  });

  it("approver covers a permission the actor lacks, with the approver's limit", () => {
    expect(codeOf(authorize(ctx, "sale.return"))).toBe("auth.forbidden");
    expect(authorize(unwrap(elevate(ctx, supervisor, "sale.return")), "sale.return").ok).toBe(true);
    const junior = createContext(mkUser("u-junior", [mkRole("r-junior", ["sale.create"])]), "dev-J");
    const elevated = unwrap(elevate(junior, supervisor, "cash.expense"));
    expect(authorize(elevated, "cash.expense", { amountMinor: 9_000n }).ok).toBe(true);
    const r = authorize(elevated, "cash.expense", { amountMinor: 11_000n });
    expect(codeOf(r)).toBe("auth.limit_exceeded");
    expect(detailsOf(r).limit).toBe("10000");
  });

  it("elevate rejects self, disabled and under-privileged approvers", () => {
    const self = elevate(ctx, cashier, "sale.discount_line");
    expect(codeOf(self)).toBe("auth.self_approval");
    expect(detailsOf(self)).toEqual({ permission: "sale.discount_line", userId: "u-cashier", approverId: "u-cashier" });
    expect(codeOf(elevate(ctx, manager.disable(), "sale.discount_line"))).toBe("auth.approver_inactive");
    expect(codeOf(elevate(ctx, plainCashier, "user.manage"))).toBe("auth.approver_forbidden");
  });

  it("a tampered context cannot smuggle an invalid approver", () => {
    expect(codeOf(authorize({ actor: cashier, deviceId: "d", approvedBy: cashier }, "sale.void", { amountMinor: 1n }))).toBe("auth.pin_required");
    expect(codeOf(authorize({ actor: cashier, deviceId: "d", approvedBy: manager.disable() }, "sale.void", { amountMinor: 1n }))).toBe(
      "auth.pin_required",
    );
    expect(codeOf(authorize({ actor: cashier, deviceId: "d", approvedBy: plainCashier }, "user.manage"))).toBe("auth.forbidden");
    const r = authorize({ actor: cashier, deviceId: "d", approvedBy: plainCashier }, "sale.discount_line", { bp: 1200 });
    expect(codeOf(r)).toBe("auth.limit_exceeded");
    expect(detailsOf(r).limit).toBe("1000");
  });
});
