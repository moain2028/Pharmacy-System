/**
 * JSON snapshot utilities for the audit log — FR-IAM-110 (`before_json`, `after_json`, `diff_json`).
 * Pure and dependency-free. bigint → decimal string, Date → ISO string, objects exposing `toJSON`
 * (e.g. Money) are honoured, `undefined`/functions are dropped. All results are deep-frozen.
 */
export type Json = string | number | boolean | null | readonly Json[] | { readonly [key: string]: Json };
export type JsonObject = { readonly [key: string]: Json };

export function isJsonObject(x: Json): x is JsonObject {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

const isJsonArray = (x: Json): x is readonly Json[] => Array.isArray(x);

export function toJson(value: unknown): Json {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return value.toString();
  if (typeof value !== "object") return null; // function, symbol
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  const custom = (value as { toJSON?: unknown }).toJSON;
  if (typeof custom === "function") return toJson((custom as (this: unknown) => unknown).call(value));
  if (Array.isArray(value)) return Object.freeze((value as unknown[]).map(toJson));
  if (value instanceof Map) {
    const out: Record<string, Json> = {};
    for (const [k, v] of value) out[String(k)] = toJson(v);
    return Object.freeze(out);
  }
  if (value instanceof Set) return Object.freeze([...value].map(toJson));
  const out: Record<string, Json> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v !== undefined && typeof v !== "function" && typeof v !== "symbol") out[k] = toJson(v);
  }
  return Object.freeze(out);
}

export function deepEqual(a: Json, b: Json): boolean {
  if (a === b) return true;
  if (isJsonArray(a) && isJsonArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i] ?? null));
  }
  if (isJsonObject(a) && isJsonObject(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return (
      ka.length === kb.length &&
      ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k] ?? null, b[k] ?? null))
    );
  }
  return false;
}

/** One changed leaf. Paths: `price.amountMinor`, `lines[1].qty`, root scalar/array = `$`. */
export interface FieldChange {
  readonly path: string;
  readonly before: Json;
  readonly after: Json;
}

const join = (path: string, key: string): string => (path === "" ? key : `${path}.${key}`);
const rootOr = (path: string): string => (path === "" ? "$" : path);

function walk(b: Json, a: Json, path: string, out: FieldChange[]): void {
  if (isJsonObject(b) && isJsonObject(a)) {
    const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].sort();
    for (const k of keys) walk(b[k] ?? null, a[k] ?? null, join(path, k), out);
    return;
  }
  if (isJsonArray(b) && isJsonArray(a) && b.length === a.length) {
    b.forEach((v, i) => walk(v, a[i] ?? null, `${rootOr(path)}[${i}]`, out));
    return;
  }
  if (!deepEqual(b, a)) out.push(Object.freeze({ path: rootOr(path), before: b, after: a }));
}

/** Changed fields only (FR-IAM-110 `diff_json`), nested paths, deterministic key order. */
export function diff(before: unknown, after: unknown): readonly FieldChange[] {
  const out: FieldChange[] = [];
  walk(toJson(before), toJson(after), "", out);
  return Object.freeze(out);
}

/** Field-name normalisation so `pin_hash`, `pinHash` and `PIN-HASH` all match. */
export function normalizeFieldName(name: string): string {
  return name.trim().toLowerCase().replace(/[_\-\s]/g, "");
}

export function normalizeFieldNames(names: Iterable<string>): ReadonlySet<string> {
  return Object.freeze(new Set([...names].map(normalizeFieldName)));
}

/** Recursively replace values of matching keys with `mask` (null stays null). `fields` must be normalised. */
export function maskFields(value: Json, fields: ReadonlySet<string>, mask = "***"): Json {
  if (isJsonArray(value)) return Object.freeze(value.map((v) => maskFields(v, fields, mask)));
  if (isJsonObject(value)) {
    const out: Record<string, Json> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = fields.has(normalizeFieldName(k)) ? (v === null ? null : mask) : maskFields(v, fields, mask);
    }
    return Object.freeze(out);
  }
  return value;
}
