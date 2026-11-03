/**
 * CashMovement: immutable, signed cash ledger entry per cashbox + currency (FR-SHF-101/105).
 * Sign rules: inbound kinds carry amount > 0, outbound kinds amount < 0, ADJUSTMENT either sign (never 0).
 * Paired kinds (TRANSFER_IN/OUT, FX_IN/OUT) share a pairId; FX_* also carry the frozen rate snapshot.
 * Balances are always derived from movements (B2), per currency. Currencies are never mixed.
 */
import { CURRENCY_CODES, type CurrencyCode } from "../money/currency.js";
import { Money } from "../money/money.js";
import type { RateSnapshot } from "../fx/exchange-rate.js";
import { domainErr, ok, type Result } from "../shared/result.js";

export const CASH_MOVEMENT_KINDS = [
  "OPENING_FLOAT",
  "SALE",
  "SALE_REFUND",
  "CUSTOMER_PAYMENT",
  "SUPPLIER_PAYMENT",
  "EXPENSE",
  "TRANSFER_IN",
  "TRANSFER_OUT",
  "FX_IN",
  "FX_OUT",
  "OWNER_DRAWING",
  "CAPITAL",
  "ADJUSTMENT",
] as const;
export type CashMovementKind = (typeof CASH_MOVEMENT_KINDS)[number];
export type CashSign = "IN" | "OUT" | "ANY";

export const CASH_MOVEMENT_SIGN: Readonly<Record<CashMovementKind, CashSign>> = Object.freeze({
  OPENING_FLOAT: "IN",
  SALE: "IN",
  SALE_REFUND: "OUT",
  CUSTOMER_PAYMENT: "IN",
  SUPPLIER_PAYMENT: "OUT",
  EXPENSE: "OUT",
  TRANSFER_IN: "IN",
  TRANSFER_OUT: "OUT",
  FX_IN: "IN",
  FX_OUT: "OUT",
  OWNER_DRAWING: "OUT",
  CAPITAL: "IN",
  ADJUSTMENT: "ANY",
});

export function isCashMovementKind(x: unknown): x is CashMovementKind {
  return typeof x === "string" && (CASH_MOVEMENT_KINDS as readonly string[]).includes(x);
}
export const isFxKind = (k: CashMovementKind): boolean => k === "FX_IN" || k === "FX_OUT";
export const isPairedKind = (k: CashMovementKind): boolean => k === "TRANSFER_IN" || k === "TRANSFER_OUT" || isFxKind(k);

export interface CashDocumentRef {
  readonly type: string;
  readonly id: string;
}

export interface CashMovementProps {
  readonly movementId: string;
  readonly cashboxId: string;
  readonly shiftId?: string | undefined;
  readonly kind: CashMovementKind;
  /** Signed amount: + into the cashbox, - out of it. */
  readonly amount: Money;
  /** ISO timestamp, any offset; stored normalised to UTC. */
  readonly occurredAt: string;
  readonly createdBy: string;
  readonly documentRef?: CashDocumentRef | undefined;
  readonly pairId?: string | undefined;
  readonly rateSnapshot?: RateSnapshot | undefined;
  readonly reason?: string | undefined;
}

const clean = (s: string | undefined): string | null => (s === undefined || s.trim() === "" ? null : s.trim());

export class CashMovement {
  readonly movementId: string;
  readonly cashboxId: string;
  readonly shiftId: string | null;
  readonly kind: CashMovementKind;
  readonly amount: Money;
  readonly occurredAt: string;
  readonly createdBy: string;
  readonly documentRef: CashDocumentRef | null;
  readonly pairId: string | null;
  readonly rateSnapshot: RateSnapshot | null;
  readonly reason: string | null;

  private constructor(p: CashMovementProps, occurredAt: string) {
    this.movementId = p.movementId;
    this.cashboxId = p.cashboxId;
    this.shiftId = clean(p.shiftId);
    this.kind = p.kind;
    this.amount = p.amount;
    this.occurredAt = occurredAt;
    this.createdBy = p.createdBy;
    this.documentRef = p.documentRef === undefined ? null : Object.freeze({ ...p.documentRef });
    this.pairId = clean(p.pairId);
    this.rateSnapshot = p.rateSnapshot ?? null;
    this.reason = clean(p.reason);
    Object.freeze(this);
  }

  static create(p: CashMovementProps): Result<CashMovement> {
    const required = [["movementId", p.movementId], ["cashboxId", p.cashboxId], ["createdBy", p.createdBy]] as const;
    for (const [field, v] of required) {
      if (clean(v) === null) return domainErr("cash.missing_field", `${field} is required`, { field });
    }
    if (p.amount.isZero()) return domainErr("cash.zero_amount", "Cash movement amount must not be zero", { kind: p.kind });
    const sign = CASH_MOVEMENT_SIGN[p.kind];
    if ((sign === "IN" && p.amount.isNegative()) || (sign === "OUT" && p.amount.isPositive())) {
      return domainErr("cash.sign_mismatch", "Amount sign does not match the movement kind", {
        kind: p.kind, amount: p.amount.toDecimalString(),
      });
    }
    const paired = isPairedKind(p.kind);
    if (paired && clean(p.pairId) === null) return domainErr("cash.pair_required", "Paired movement needs a pairId", { kind: p.kind });
    if (!paired && p.pairId !== undefined) return domainErr("cash.unexpected_pair", "Only paired kinds carry a pairId", { kind: p.kind });
    const snap = p.rateSnapshot;
    if (isFxKind(p.kind)) {
      if (snap === undefined) return domainErr("cash.rate_required", "FX movement needs a rate snapshot", { kind: p.kind });
      if (snap.from !== p.amount.currency && snap.to !== p.amount.currency) {
        return domainErr("cash.rate_pair_mismatch", "Rate snapshot does not cover the movement currency", {
          from: snap.from, to: snap.to, currency: p.amount.currency,
        });
      }
    } else if (snap !== undefined) {
      return domainErr("cash.unexpected_rate", "Only FX movements carry a rate snapshot", { kind: p.kind });
    }
    if (p.kind === "ADJUSTMENT" && clean(p.reason) === null) {
      return domainErr("cash.reason_required", "Cash adjustment requires a reason");
    }
    const ms = Date.parse(p.occurredAt);
    if (Number.isNaN(ms)) return domainErr("cash.invalid_timestamp", "occurredAt must be an ISO timestamp", { occurredAt: p.occurredAt });
    return ok(new CashMovement(p, new Date(ms).toISOString()));
  }

  get currency(): CurrencyCode {
    return this.amount.currency;
  }

  isInbound(): boolean {
    return this.amount.isPositive();
  }
}

export interface CashMovementFilter {
  readonly cashboxId?: string;
  readonly shiftId?: string;
  readonly excludeKinds?: readonly CashMovementKind[];
}

function matches(m: CashMovement, f: CashMovementFilter): boolean {
  if (f.cashboxId !== undefined && m.cashboxId !== f.cashboxId) return false;
  if (f.shiftId !== undefined && m.shiftId !== f.shiftId) return false;
  return f.excludeKinds === undefined || !f.excludeKinds.includes(m.kind);
}

/** Balance per currency (keys in canonical currency order); currencies without movements are absent. */
export function deriveCashBalances(
  movements: readonly CashMovement[],
  filter: CashMovementFilter = {},
): ReadonlyMap<CurrencyCode, Money> {
  const acc = new Map<CurrencyCode, Money>();
  for (const m of movements) {
    if (!matches(m, filter)) continue;
    const prev = acc.get(m.currency);
    acc.set(m.currency, prev === undefined ? m.amount : prev.add(m.amount));
  }
  const out = new Map<CurrencyCode, Money>();
  for (const c of CURRENCY_CODES) {
    const v = acc.get(c);
    if (v !== undefined) out.set(c, v);
  }
  return out;
}

export function cashBalance(movements: readonly CashMovement[], currency: CurrencyCode, filter: CashMovementFilter = {}): Money {
  return deriveCashBalances(movements, filter).get(currency) ?? Money.zero(currency);
}

/**
 * Verify two movements form a consistent pair. Transfer: same currency, opposite amounts, different
 * cashboxes. FX: same cashbox, different currencies.
 */
export function checkPair(a: CashMovement, b: CashMovement): Result<null> {
  if (a.pairId === null || a.pairId !== b.pairId) {
    return domainErr("cash.pair_mismatch", "Movements do not share a pairId", { a: a.movementId, b: b.movementId });
  }
  const kinds = new Set<CashMovementKind>([a.kind, b.kind]);
  const transfer = kinds.has("TRANSFER_OUT") && kinds.has("TRANSFER_IN");
  const fx = kinds.has("FX_OUT") && kinds.has("FX_IN");
  if (!transfer && !fx) return domainErr("cash.pair_kinds", "Pair must be TRANSFER_OUT+TRANSFER_IN or FX_OUT+FX_IN");
  if (transfer) {
    if (a.currency !== b.currency || a.amount.amountMinor + b.amount.amountMinor !== 0n) {
      return domainErr("cash.pair_unbalanced", "Transfer legs must be equal and opposite in one currency");
    }
    if (a.cashboxId === b.cashboxId) return domainErr("cash.pair_same_cashbox", "Transfer needs two different cashboxes");
    return ok(null);
  }
  if (a.cashboxId !== b.cashboxId) return domainErr("cash.pair_cashbox_mismatch", "FX legs must be in the same cashbox");
  if (a.currency === b.currency) return domainErr("cash.pair_same_currency", "FX legs must be in different currencies");
  return ok(null);
}
