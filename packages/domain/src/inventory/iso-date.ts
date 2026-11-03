/**
 * ISO calendar dates ("YYYY-MM-DD") for the inventory domain.
 *
 * Decision: expiry_date / business_date are modelled as ISO strings, NOT Date objects — they order
 * lexicographically, map 1:1 to PostgreSQL DATE, carry no time-of-day/time-zone and serialise
 * without surprises. Day arithmetic is done on UTC day numbers.
 */
import { domainErr, ok, type Result } from "../shared/result.js";

export type IsoDate = string;

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

function utcMillis(year: number, month: number, day: number): number {
  const d = new Date(0);
  d.setUTCFullYear(year, month - 1, day);
  return d.getTime();
}

const pad = (n: number, width: number): string => String(n).padStart(width, "0");

/** Validate a YYYY-MM-DD string (real calendar day, leap years respected). */
export function parseIsoDate(x: unknown): Result<IsoDate> {
  if (typeof x !== "string") {
    return domainErr("date.invalid", "Date must be a YYYY-MM-DD string", { value: String(x) });
  }
  const m = ISO_DATE_RE.exec(x);
  if (!m) return domainErr("date.invalid", `Date must be YYYY-MM-DD: ${x}`, { value: x });
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const d = new Date(utcMillis(year, month, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return domainErr("date.invalid_calendar_day", `Not a calendar day: ${x}`, { value: x });
  }
  return ok(x);
}

export function isIsoDate(x: unknown): x is IsoDate {
  return parseIsoDate(x).ok;
}

/** Throws — for domain methods where an invalid date can only be a programmer error. */
export function assertIsoDate(x: unknown): IsoDate {
  const r = parseIsoDate(x);
  if (!r.ok) throw r.error;
  return r.value;
}

/** Whole days since 1970-01-01 (UTC). Input must be a valid IsoDate. */
export function toEpochDays(date: IsoDate): number {
  const ms = utcMillis(Number(date.slice(0, 4)), Number(date.slice(5, 7)), Number(date.slice(8, 10)));
  return Math.round(ms / MS_PER_DAY);
}

/** `to − from` in whole days; positive when `to` is after `from`. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return toEpochDays(to) - toEpochDays(from);
}

export function compareIsoDate(a: IsoDate, b: IsoDate): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** UTC calendar date of a JS Date. */
export function isoDateFromDate(d: Date): IsoDate {
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1, 2)}-${pad(d.getUTCDate(), 2)}`;
}

/** Last day of a month — "06/2026" style expiry input and GS1 AI(17) with DD=00 (FR-LOT-115). */
export function endOfMonth(year: number, month: number): Result<IsoDate> {
  if (
    !Number.isSafeInteger(year) ||
    !Number.isSafeInteger(month) ||
    year < 0 ||
    year > 9999 ||
    month < 1 ||
    month > 12
  ) {
    return domainErr("date.invalid_month", "year must be 0..9999 and month 1..12", { year, month });
  }
  const lastDay = new Date(utcMillis(year, month + 1, 0)).getUTCDate();
  return ok(`${pad(year, 4)}-${pad(month, 2)}-${pad(lastDay, 2)}`);
}
