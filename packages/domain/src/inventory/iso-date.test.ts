import { describe, expect, it } from "vitest";
import { DomainError, unwrap, type Result } from "../shared/result.js";
import {
  assertIsoDate,
  compareIsoDate,
  daysBetween,
  endOfMonth,
  isIsoDate,
  isoDateFromDate,
  parseIsoDate,
  toEpochDays,
} from "./iso-date.js";

function errCode<T>(r: Result<T>): string {
  if (r.ok) throw new Error("expected Err");
  return r.error.code;
}

describe("parseIsoDate", () => {
  it("accepts real calendar days", () => {
    expect(unwrap(parseIsoDate("2026-03-31"))).toBe("2026-03-31");
    expect(unwrap(parseIsoDate("2024-02-29"))).toBe("2024-02-29");
    expect(unwrap(parseIsoDate("0001-01-01"))).toBe("0001-01-01");
    expect(unwrap(parseIsoDate("9999-12-31"))).toBe("9999-12-31");
  });
  it("rejects non-strings", () => {
    expect(errCode(parseIsoDate(20260331))).toBe("date.invalid");
    expect(errCode(parseIsoDate(null))).toBe("date.invalid");
  });
  it("rejects malformed strings", () => {
    for (const bad of ["2026/03/31", "2026-3-31", "", "2026-03-31T00:00:00Z", "31-03-2026"]) {
      expect(errCode(parseIsoDate(bad))).toBe("date.invalid");
    }
  });
  it("rejects impossible calendar days", () => {
    for (const bad of ["2026-02-29", "2026-13-01", "2026-04-31", "2026-00-10", "2026-03-00"]) {
      expect(errCode(parseIsoDate(bad))).toBe("date.invalid_calendar_day");
    }
  });
});

describe("isIsoDate / assertIsoDate", () => {
  it("isIsoDate is a type guard", () => {
    expect(isIsoDate("2026-01-01")).toBe(true);
    expect(isIsoDate("nope")).toBe(false);
  });
  it("assertIsoDate returns the value or throws DomainError", () => {
    expect(assertIsoDate("2026-01-01")).toBe("2026-01-01");
    expect(() => assertIsoDate("2026-02-30")).toThrow(DomainError);
  });
});

describe("day arithmetic", () => {
  it("toEpochDays counts from 1970-01-01", () => {
    expect(toEpochDays("1970-01-01")).toBe(0);
    expect(toEpochDays("1970-01-02")).toBe(1);
    expect(toEpochDays("1969-12-31")).toBe(-1);
  });
  it("daysBetween is signed and leap-aware", () => {
    expect(daysBetween("2026-01-15", "2026-03-31")).toBe(75);
    expect(daysBetween("2026-03-31", "2026-01-15")).toBe(-75);
    expect(daysBetween("2024-02-28", "2024-03-01")).toBe(2);
    expect(daysBetween("2026-01-01", "2026-01-01")).toBe(0);
  });
  it("compareIsoDate orders lexicographically", () => {
    expect(compareIsoDate("2026-01-01", "2026-01-02")).toBe(-1);
    expect(compareIsoDate("2026-01-02", "2026-01-01")).toBe(1);
    expect(compareIsoDate("2026-01-01", "2026-01-01")).toBe(0);
  });
});

describe("isoDateFromDate", () => {
  it("uses the UTC calendar date and pads", () => {
    expect(isoDateFromDate(new Date(Date.UTC(2026, 2, 31, 23, 59, 59)))).toBe("2026-03-31");
    const early = new Date(0);
    early.setUTCFullYear(5, 0, 1);
    expect(isoDateFromDate(early)).toBe("0005-01-01");
  });
});

describe("endOfMonth", () => {
  it("computes the last day including leap Februaries", () => {
    expect(unwrap(endOfMonth(2026, 2))).toBe("2026-02-28");
    expect(unwrap(endOfMonth(2024, 2))).toBe("2024-02-29");
    expect(unwrap(endOfMonth(2026, 6))).toBe("2026-06-30");
    expect(unwrap(endOfMonth(2026, 12))).toBe("2026-12-31");
    expect(unwrap(endOfMonth(0, 1))).toBe("0000-01-31");
  });
  it("rejects invalid year/month", () => {
    for (const [y, m] of [
      [2026.5, 1],
      [2026, 1.5],
      [-1, 1],
      [10000, 1],
      [2026, 0],
      [2026, 13],
    ] as const) {
      expect(errCode(endOfMonth(y, m))).toBe("date.invalid_month");
    }
  });
});
