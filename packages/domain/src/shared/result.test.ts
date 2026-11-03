import { describe, expect, it } from "vitest";
import { DomainError, all, andThen, domainErr, err, isErr, isOk, map, ok, unwrap } from "./result.js";

describe("Result", () => {
  it("ok/err/isOk/isErr", () => {
    expect(isOk(ok(1))).toBe(true);
    expect(isErr(err("x"))).toBe(true);
    expect(isOk(err("x"))).toBe(false);
  });
  it("unwrap returns value or throws (Error preserved, non-Error wrapped)", () => {
    expect(unwrap(ok(5))).toBe(5);
    expect(() => unwrap(domainErr("c", "m"))).toThrow(DomainError);
    expect(() => unwrap(err({ code: "x" }))).toThrow(/unwrap on Err/);
  });
  it("map/andThen short-circuit on Err", () => {
    expect(unwrap(map(ok(2), (v) => v * 2))).toBe(4);
    const e = err("bad");
    expect(map(e, (v: number) => v)).toBe(e);
    expect(unwrap(andThen(ok(2), (v) => ok(v + 1)))).toBe(3);
    expect(andThen(e, () => ok(1))).toBe(e);
  });
  it("all collects or returns first error", () => {
    expect(unwrap(all([ok(1), ok(2)]))).toEqual([1, 2]);
    const e = err("first");
    expect(all([ok(1), e, err("second")])).toBe(e);
  });
  it("DomainError carries frozen details and code", () => {
    const d = new DomainError("a.b", "msg", { k: 1 });
    expect(d.code).toBe("a.b");
    expect(d.name).toBe("DomainError");
    expect(Object.isFrozen(d.details)).toBe(true);
    expect(new DomainError("x", "y").details).toEqual({});
  });
});
