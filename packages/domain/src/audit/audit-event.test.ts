import { describe, expect, it } from "vitest";
import { Money } from "../money/money.js";
import { isErr, unwrap } from "../shared/result.js";
import { AUDIT_ACTIONS, AuditEvent, DEFAULT_REDACTED_FIELDS, isAuditAction, redact } from "./audit-event.js";
import { deepEqual, diff } from "./diff.js";

const base = {
  eventId: "e1",
  tenantId: "t1",
  actorUserId: "u1",
  action: "update",
  entityType: "user",
  entityId: "u2",
  deviceId: "pos-1",
  occurredAt: new Date("2026-01-15T10:00:00Z"),
};

const errCode = (r: ReturnType<typeof AuditEvent.create>): string => (isErr(r) ? r.error.code : "ok");

describe("AuditEvent.create", () => {
  it("computes changes when both snapshots are present and trims optional fields", () => {
    const ev = unwrap(
      AuditEvent.create({
        ...base,
        before: { name: "A", pin_hash: "h1", price: Money.minor(100n, "YER_NEW") },
        after: { name: "B", pin_hash: "h2", price: Money.minor(150n, "YER_NEW") },
        reason: "  fix  ",
        entityLabel: " ",
        approvedBy: "mgr",
        onBehalfOf: "",
        ip: "10.0.0.1",
      }),
    );
    expect(ev.hasChanges()).toBe(true);
    expect(ev.changedPaths()).toEqual(["name", "pin_hash", "price.amountMinor"]);
    expect(ev.reason).toBe("fix");
    expect(ev.entityLabel).toBeUndefined();
    expect(ev.onBehalfOf).toBeUndefined();
    expect(ev.approvedBy).toBe("mgr");
    expect(Object.isFrozen(ev)).toBe(true);
    // occurredAt is defensively copied
    const t = ev.occurredAt;
    t.setFullYear(2000);
    expect(ev.occurredAt.getUTCFullYear()).toBe(2026);
  });
  it("has no changes when a snapshot is missing", () => {
    const ev = unwrap(AuditEvent.create({ ...base, action: "create", after: { a: 1 } }));
    expect(ev.hasChanges()).toBe(false);
    expect(ev.before).toBeNull();
  });
  it("rejects blank required fields, unknown action, invalid time, self-approval", () => {
    expect(errCode(AuditEvent.create({ ...base, eventId: " " }))).toBe("audit.invalid_field");
    expect(errCode(AuditEvent.create({ ...base, deviceId: "" }))).toBe("audit.invalid_field");
    expect(errCode(AuditEvent.create({ ...base, action: "hack" }))).toBe("audit.invalid_action");
    expect(errCode(AuditEvent.create({ ...base, occurredAt: new Date("x") }))).toBe("audit.invalid_time");
    expect(errCode(AuditEvent.create({ ...base, occurredAt: "2026" as unknown as Date }))).toBe("audit.invalid_time");
    expect(errCode(AuditEvent.create({ ...base, approvedBy: "u1" }))).toBe("audit.self_approval");
  });
  it("isAuditAction covers the catalogue", () => {
    for (const a of AUDIT_ACTIONS) expect(isAuditAction(a)).toBe(true);
    expect(isAuditAction("nope")).toBe(false);
    expect(isAuditAction(1)).toBe(false);
  });
  it("toJSON uses null for absent optionals and ISO time", () => {
    const j = unwrap(AuditEvent.create({ ...base, action: "login" })).toJSON();
    expect(j.onBehalfOf).toBeNull();
    expect(j.approvedBy).toBeNull();
    expect(j.entityLabel).toBeNull();
    expect(j.reason).toBeNull();
    expect(j.ip).toBeNull();
    expect(j.occurredAt).toBe("2026-01-15T10:00:00.000Z");
    expect(j.changes).toEqual([]);
    const j2 = unwrap(AuditEvent.create({ ...base, action: "login", onBehalfOf: "x", approvedBy: "y", entityLabel: "L", reason: "r", ip: "1.1.1.1" })).toJSON();
    expect(j2).toMatchObject({ onBehalfOf: "x", approvedBy: "y", entityLabel: "L", reason: "r", ip: "1.1.1.1" });
  });
});

describe("redact", () => {
  it("masks secrets in before/after/changes (case/underscore-insensitive), keeps nulls, leaves other fields", () => {
    const ev = unwrap(
      AuditEvent.create({
        ...base,
        before: { username: "a", password: "old", PIN_HASH: null, tokens: [{ refreshToken: "r1" }], nested: { apiKey: "k" } },
        after: { username: "b", password: "new", PIN_HASH: "h", tokens: [{ refreshToken: "r2" }], nested: { apiKey: "k2" } },
      }),
    );
    const r = redact(ev);
    expect(r.before).toEqual({ username: "a", password: "***", PIN_HASH: null, tokens: [{ refreshToken: "***" }], nested: { apiKey: "***" } });
    expect(r.after).toEqual({ username: "b", password: "***", PIN_HASH: "***", tokens: [{ refreshToken: "***" }], nested: { apiKey: "***" } });
    const byPath = Object.fromEntries(r.changes.map((c) => [c.path, c]));
    expect(byPath["username"]).toEqual({ path: "username", before: "a", after: "b" });
    expect(byPath["password"]).toEqual({ path: "password", before: "***", after: "***" });
    expect(byPath["PIN_HASH"]).toEqual({ path: "PIN_HASH", before: null, after: "***" });
    expect(byPath["tokens[0].refreshToken"]).toEqual({ path: "tokens[0].refreshToken", before: "***", after: "***" });
    expect(byPath["nested.apiKey"]).toEqual({ path: "nested.apiKey", before: "***", after: "***" });
    // original untouched
    expect((ev.after as { password: string }).password).toBe("new");
    expect(DEFAULT_REDACTED_FIELDS).toContain("pin");
  });
  it("masks whole-object changes whose leaf is not secret but contains secrets", () => {
    const ev = unwrap(AuditEvent.create({ ...base, before: { creds: null }, after: { creds: { secret: "s", note: "n" } } }));
    const r = redact(ev, ["secret"]);
    expect(r.changes).toEqual([{ path: "creds", before: null, after: { secret: "***", note: "n" } }]);
  });
  it("secret leaf cleared to null keeps null on the after side", () => {
    const ev = unwrap(AuditEvent.create({ ...base, before: { pin: "1234" }, after: { pin: null } }));
    expect(redact(ev).changes).toEqual([{ path: "pin", before: "***", after: null }]);
  });
  it("custom field list and array-leaf masking", () => {
    const ev = unwrap(AuditEvent.create({ ...base, before: { codes: ["a", "b"] }, after: { codes: ["a", "c"] } }));
    const r = redact(ev, ["codes"]);
    expect(r.after).toEqual({ codes: "***" });
    expect(r.changes).toEqual([{ path: "codes[1]", before: "***", after: "***" }]);
  });
});

describe("diff edge cases", () => {
  it("arrays of different length are reported as a whole; equal arrays produce nothing", () => {
    expect(diff({ a: [1, 2] }, { a: [1, 2, 3] })).toEqual([{ path: "a", before: [1, 2], after: [1, 2, 3] }]);
    expect(diff([1, [2, 3]], [1, [2, 3]])).toEqual([]);
    expect(diff([1, 2], [1, 3])).toEqual([{ path: "$[1]", before: 2, after: 3 }]);
  });
  it("deepEqual handles nested arrays/objects, null padding and type mismatch", () => {
    expect(deepEqual([1, [2]], [1, [2]])).toBe(true);
    expect(deepEqual([1, 2], [1])).toBe(false);
    expect(deepEqual({ a: 1 }, { a: 1, b: null })).toBe(false);
    expect(deepEqual({ a: 1 }, [1])).toBe(false);
    expect(deepEqual(null, 0)).toBe(false);
    expect(deepEqual([null, 1], [null, 1])).toBe(true);
    expect(diff({ x: [1, null] }, { x: [1, null] })).toEqual([]);
    expect(diff([null], [2])).toEqual([{ path: "$[0]", before: null, after: 2 }]);
  });
});
