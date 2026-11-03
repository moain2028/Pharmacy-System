import { HttpException, HttpStatus } from "@nestjs/common";
import { DomainError } from "@pharmacore/domain";
import { PG_ERR } from "@pharmacore/db";

export interface ApiErrorBody {
  readonly code: string;
  readonly message: string;
  readonly details?: Record<string, unknown>;
}

export class ApiError extends HttpException {
  constructor(status: number, body: ApiErrorBody) {
    super(body, status);
  }
  static notFound(code: string, message: string): ApiError {
    return new ApiError(HttpStatus.NOT_FOUND, { code, message });
  }
  static conflict(code: string, message: string, details?: Record<string, unknown>): ApiError {
    return new ApiError(HttpStatus.CONFLICT, details ? { code, message, details } : { code, message });
  }
  static badRequest(code: string, message: string, details?: Record<string, unknown>): ApiError {
    return new ApiError(HttpStatus.BAD_REQUEST, details ? { code, message, details } : { code, message });
  }
  static forbidden(code: string, message: string, details?: Record<string, unknown>): ApiError {
    return new ApiError(HttpStatus.FORBIDDEN, details ? { code, message, details } : { code, message });
  }
  static unauthorized(code = "auth.unauthorized", message = "Authentication required"): ApiError {
    return new ApiError(HttpStatus.UNAUTHORIZED, { code, message });
  }
}

const PG_TO_HTTP: Record<string, { status: number; code: string }> = {
  [PG_ERR.LEDGER_IMMUTABLE]: { status: 409, code: "ledger.immutable" },
  [PG_ERR.POSTED_DOC_IMMUTABLE]: { status: 409, code: "document.posted_immutable" },
  [PG_ERR.UNIT_FACTOR_LOCKED]: { status: 409, code: "uom.factor_locked" },
  [PG_ERR.LOT_FACTS_IMMUTABLE]: { status: 409, code: "lot.facts_immutable" },
  [PG_ERR.LOT_EXPIRY_REQUIRED]: { status: 400, code: "lot.expiry_required" },
  [PG_ERR.LOT_EXPIRED]: { status: 409, code: "lot.expired" },
  [PG_ERR.LOT_NOT_SELLABLE]: { status: 409, code: "lot.not_sellable" },
  [PG_ERR.INSUFFICIENT_STOCK]: { status: 409, code: "stock.insufficient" },
  [PG_ERR.JOURNAL_UNBALANCED]: { status: 500, code: "journal.unbalanced" },
  [PG_ERR.ACCOUNT_NOT_POSTABLE]: { status: 400, code: "account.not_postable" },
  [PG_ERR.UNIQUE_VIOLATION]: { status: 409, code: "conflict.duplicate" },
  [PG_ERR.CHECK_VIOLATION]: { status: 400, code: "validation.check_failed" },
  "23503": { status: 400, code: "validation.reference_missing" },
  "23502": { status: 400, code: "validation.required" },
  "42501": { status: 403, code: "db.insufficient_privilege" },
};

/** Maps DomainError / PostgresError / unknown to a consistent ApiError. */
export function toApiError(e: unknown): HttpException {
  if (e instanceof HttpException) return e;
  if (e instanceof DomainError) {
    const status = e.code.endsWith(".not_found") ? 404 : e.code.includes("forbidden") || e.code.includes("permission") ? 403 : 422;
    return new ApiError(status, { code: e.code, message: e.message, details: { ...e.details } });
  }
  const pg = e as { code?: string; message?: string; constraint_name?: string; detail?: string };
  if (typeof pg?.code === "string" && PG_TO_HTTP[pg.code]) {
    const m = PG_TO_HTTP[pg.code]!;
    const details: Record<string, unknown> = {};
    if (pg.constraint_name) details["constraint"] = pg.constraint_name;
    if (pg.detail) details["detail"] = pg.detail;
    return new ApiError(m.status, { code: m.code, message: pg.message ?? m.code, details });
  }
  return new ApiError(HttpStatus.INTERNAL_SERVER_ERROR, { code: "internal", message: "Internal error" });
}
