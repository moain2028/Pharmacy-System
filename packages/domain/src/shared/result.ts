/**
 * Result<T, E> — explicit success/failure without exceptions crossing module boundaries.
 * Domain code returns Result for expected business failures (validation, invariants);
 * exceptions are reserved for programmer errors.
 */
export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E> = { readonly ok: false; readonly error: E };
export type Result<T, E = DomainError> = Ok<T> | Err<E>;

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
export const err = <E>(error: E): Err<E> => ({ ok: false, error });

export const isOk = <T, E>(r: Result<T, E>): r is Ok<T> => r.ok;
export const isErr = <T, E>(r: Result<T, E>): r is Err<E> => !r.ok;

/** Unwrap or throw — for tests and for places where failure is a programmer error. */
export function unwrap<T, E>(r: Result<T, E>): T {
  if (r.ok) return r.value;
  const e: unknown = r.error;
  throw e instanceof Error ? e : new Error(`unwrap on Err: ${String(JSON.stringify(e))}`);
}

export function map<T, U, E>(r: Result<T, E>, f: (v: T) => U): Result<U, E> {
  return r.ok ? ok(f(r.value)) : r;
}

export function andThen<T, U, E>(r: Result<T, E>, f: (v: T) => Result<U, E>): Result<U, E> {
  return r.ok ? f(r.value) : r;
}

/** Collect an array of Results into a Result of array (first error wins). */
export function all<T, E>(rs: readonly Result<T, E>[]): Result<T[], E> {
  const out: T[] = [];
  for (const r of rs) {
    if (!r.ok) return r;
    out.push(r.value);
  }
  return ok(out);
}

/**
 * DomainError — machine-readable code + human message + optional details.
 * Codes are stable identifiers used by the API layer for i18n and HTTP mapping.
 */
export class DomainError extends Error {
  readonly code: string;
  readonly details: Readonly<Record<string, unknown>>;
  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

export const domainErr = (code: string, message: string, details?: Record<string, unknown>): Err<DomainError> =>
  err(new DomainError(code, message, details));
