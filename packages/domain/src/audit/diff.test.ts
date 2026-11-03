import { describe, expect, it } from "vitest";
import { Money } from "../money/money.js";
import { deepEqual, diff, isJsonObject, maskFields, normalizeFieldName, normalizeFieldNames, toJson, type Json } from "./diff.js";

describe("toJson", () => {
  it("maps primitives and drops non-JSON values", () => {
    expect(toJson("a")).toBe("a");
    expect(toJson(true)).toBe(true);
    expect(toJson(1.5)).toBe(1.5);
    expect(toJson(Number.NaN)).toBeNull();
    expect(toJson(Number.POSITIVE_INFINITY)).toBeNull();
    expect(toJson(null)).toBeNull();
    expect(toJson(undefined)).toBeNull();
    expect(toJson(10n)).toBe("10");
    expect(toJson(Symbol("s"))).toBeNull();
    expect(toJson(() => 1)).toBeNull();
  });

  it("maps dates, Money (toJSON), Map, Set, arrays and nested objects; result is frozen", () => {
    expect(toJson(new Date("2025-01-01T00:00:00.000Z"))).toBe("2025-01-01T00:00:00.000Z");
    expect(toJson(new Date("nope"))).toBeNull();
    expect(toJson(Money.minor(150, "SAR"))).toEqual({ amountMinor: "150", currency: "SAR" });
    expect(toJson(new Map<string, bigint>([["k", 1n]]))).toEqual({ k: "1" });
    expect(toJson(new Set([1, 2]))).toEqual([1, 2]);
    expect(toJson({ toJSON: 1 })).toEqual({ toJSON: 1 });
    const j = toJson({ a: [1, { b: undefined, c: () => 0, d: 2n, s: Symbol("x") }], e: undefined });
    expect(j).toEqual({ a: [1, { d: "2" }] });
    expect(Object.isFrozen(j)).toBe(true);
    if (isJsonObject(j)) {
      expect(Object.isFrozen(j.a)).toBe(true);
    }
  });
});

describe("deepEqual", () => {
  it("compares structurally", () => {
    const a: Json = { x: [1, 2], y: { z: "s" } };
    expect(deepEqual(a, a)).toBe(true);
    expect(deepEqual(a, { x: [1, 2], y: { z: "s" } })).toBe(true);
    expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(deepEqual([1, 2], [1, 3])).toBe(false);
    expect(deepEqual({ a: 1 }, { b: 1 })).toBe(false);
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(deepEqual({ a: 1 }, [1])).toBe(false);
    expect(deepEqual(1, "1")).toBe(false);
    expect(deepEqual(null, null)).toBe(true);
    expect(deepEqual({ a: null }, { a: null })).toBe(true);
    expect(deepEqual({ a: null }, { a: 0 })).toBe(false);
  });
});

describe("diff", () => {
  it("reports nested paths", () => {
    expect(diff({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 3 } })).toEqual([{ path: "b.c", before: 2, after: 3 }]);
    expect(diff({ itemId: "i1", price: Money.minor(15050, "YER_NEW") }, { itemId: "i1", price: Money.minor(16000, "YER_NEW") })).toEqual([
      { path: "price.amountMinor", before: "15050", after: "16000" },
    ]);
  });

  it("reports added and removed keys with null on the missing side", () => {
    expect(diff({ a: 1 }, { a: 1, b: 2 })).toEqual([{ path: "b", before: null, after: 2 }]);
    expect(diff({ a: 1, b: 2 }, { a: 1 })).toEqual([{ path: "b", before: 2, after: null }]);
  });

  it("handles root scalars and arrays", () => {
    expect(diff(1, 2)).toEqual([{ path: "$", before: 1, after: 2 }]);
    expect(diff("x", "x")).toEqual([]);
    expect(diff([1, 2], [1, 3])).toEqual([{ path: "$[1]", before: 2, after: 3 }]);
  });

  it("walks equal-length arrays by index, otherwise treats the array as a leaf", () => {
    expect(diff({ lines: [{ qty: 1 }, { qty: 2 }] }, { lines: [{ qty: 1 }, { qty: 5 }] })).toEqual([{ path: "lines[1].qty", before: 2, after: 5 }]);
    expect(diff({ tags: ["a"] }, { tags: ["a", "b"] })).toEqual([{ path: "tags", before: ["a"], after: ["a", "b"] }]);
  });

  it("object vs scalar is a single leaf change; equal objects yield nothing; output frozen", () => {
    expect(diff({ a: { b: 1 } }, { a: 7 })).toEqual([{ path: "a", before: { b: 1 }, after: 7 }]);
    expect(diff({ a: { b: 1 } }, { a: { b: 1 } })).toEqual([]);
    const d = diff({ a: 1 }, { a: 2 });
    expect(Object.isFrozen(d)).toBe(true);
    expect(Object.isFrozen(d[0])).toBe(true);
  });
});

describe("maskFields", () => {
  const fields = normalizeFieldNames(["password", "PIN_hash"]);

  it("masks matching keys recursively, keeps null, leaves others", () => {
    const input: Json = { password: "x", pinHash: "y", n: null, keep: 1, nested: { password: null, list: [{ pin_hash: "z" }] } };
    expect(maskFields(input, fields)).toEqual({
      password: "***", pinHash: "***", n: null, keep: 1, nested: { password: null, list: [{ pin_hash: "***" }] },
    });
    expect(maskFields({ password: "x" }, fields, "#")).toEqual({ password: "#" });
    expect(Object.isFrozen(maskFields(input, fields))).toBe(true);
  });

  it("passes scalars and arrays of scalars through", () => {
    expect(maskFields("plain", fields)).toBe("plain");
    expect(maskFields(["password"], fields)).toEqual(["password"]);
    expect(maskFields(null, fields)).toBeNull();
  });

  it("normalises field names", () => {
    expect(normalizeFieldName(" Manager-PIN ")).toBe("managerpin");
    expect([...normalizeFieldNames(["A_b", " c ", "refresh token"])]).toEqual(["ab", "c", "refreshtoken"]);
  });

  it("isJsonObject", () => {
    expect(isJsonObject({})).toBe(true);
    expect(isJsonObject([])).toBe(false);
    expect(isJsonObject(null)).toBe(false);
    expect(isJsonObject("s")).toBe(false);
  });
});
