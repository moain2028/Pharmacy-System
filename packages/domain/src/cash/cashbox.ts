/**
 * Cashbox (REGISTER/SAFE/BANK/WALLET) and the cash operations that span cashboxes:
 * transfers (paired TRANSFER_OUT/TRANSFER_IN), FX exchange inside one cashbox (paired FX_IN/FX_OUT
 * with a frozen rate snapshot, FR-CUR-106) and the day-end safe drop (REGISTER -> SAFE).
 * Shift ids are stamped only on REGISTER legs (shifts belong to drawers).
 */
import type { CurrencyCode } from "../money/currency.js";
import { Money } from "../money/money.js";
import { convert, snapshotRate, type ExchangeRate, type FxDirection, type RateSnapshot } from "../fx/exchange-rate.js";
import { domainErr, ok, unwrap, type Result } from "../shared/result.js";
import { CashMovement } from "./cash-movement.js";

export const CASHBOX_KINDS = ["REGISTER", "SAFE", "BANK", "WALLET"] as const;
export type CashboxKind = (typeof CASHBOX_KINDS)[number];

export interface CashboxProps {
  readonly cashboxId: string;
  readonly kind: CashboxKind;
  readonly name: string;
  readonly currencies: readonly CurrencyCode[];
  readonly active?: boolean | undefined;
}

const blank = (s: string | undefined): boolean => s === undefined || s.trim() === "";

export class Cashbox {
  readonly cashboxId: string;
  readonly kind: CashboxKind;
  readonly name: string;
  readonly currencies: readonly CurrencyCode[];
  readonly active: boolean;

  private constructor(p: CashboxProps) {
    this.cashboxId = p.cashboxId;
    this.kind = p.kind;
    this.name = p.name.trim();
    this.currencies = Object.freeze([...p.currencies]);
    this.active = p.active ?? true;
    Object.freeze(this);
  }

  static create(p: CashboxProps): Result<Cashbox> {
    if (blank(p.cashboxId)) return domainErr("cashbox.missing_id", "cashboxId is required");
    if (blank(p.name)) return domainErr("cashbox.missing_name", "Cashbox name is required");
    if (p.currencies.length === 0) return domainErr("cashbox.no_currency", "A cashbox holds at least one currency");
    if (new Set(p.currencies).size !== p.currencies.length) {
      return domainErr("cashbox.duplicate_currency", "Currencies must be unique", { currencies: [...p.currencies] });
    }
    return ok(new Cashbox(p));
  }

  accepts(currency: CurrencyCode): boolean {
    return this.currencies.includes(currency);
  }

  deactivate(): Cashbox {
    return new Cashbox({ cashboxId: this.cashboxId, kind: this.kind, name: this.name, currencies: this.currencies, active: false });
  }
}

function guardBox(box: Cashbox, currency: CurrencyCode): Result<null> {
  if (!box.active) return domainErr("cashbox.inactive", "Cashbox is inactive", { cashboxId: box.cashboxId });
  if (!box.accepts(currency)) {
    return domainErr("cashbox.currency_not_accepted", "Cashbox does not hold this currency", { cashboxId: box.cashboxId, currency });
  }
  return ok(null);
}

const shiftFor = (box: Cashbox, shiftId: string | undefined): string | undefined => (box.kind === "REGISTER" ? shiftId : undefined);

export interface CashPair {
  readonly outbound: CashMovement;
  readonly inbound: CashMovement;
}

export interface TransferInput {
  readonly pairId: string;
  readonly outMovementId: string;
  readonly inMovementId: string;
  readonly from: Cashbox;
  readonly to: Cashbox;
  readonly amount: Money;
  readonly occurredAt: string;
  readonly createdBy: string;
  readonly shiftId?: string | undefined;
  readonly reason?: string | undefined;
  /** Current balance of `from` in the amount currency; when given, overdrawing is rejected. */
  readonly fromBalance?: Money | undefined;
}

export function transferCash(i: TransferInput): Result<CashPair> {
  if (i.from.cashboxId === i.to.cashboxId) return domainErr("cashbox.same_cashbox", "Cannot transfer to the same cashbox");
  if (!i.amount.isPositive()) return domainErr("cashbox.non_positive_amount", "Amount must be > 0");
  for (const box of [i.from, i.to]) {
    const g = guardBox(box, i.amount.currency);
    if (!g.ok) return g;
  }
  if (i.fromBalance !== undefined && i.amount.gt(i.fromBalance)) {
    return domainErr("cashbox.insufficient_funds", "Not enough cash in the source cashbox", {
      balance: i.fromBalance.toDecimalString(), amount: i.amount.toDecimalString(),
    });
  }
  const documentRef = { type: "CASH_TRANSFER", id: i.pairId };
  const common = { occurredAt: i.occurredAt, createdBy: i.createdBy, documentRef, pairId: i.pairId, reason: i.reason };
  const outbound = CashMovement.create({
    ...common, movementId: i.outMovementId, cashboxId: i.from.cashboxId, shiftId: shiftFor(i.from, i.shiftId),
    kind: "TRANSFER_OUT", amount: i.amount.negate(),
  });
  if (!outbound.ok) return outbound;
  const inbound = CashMovement.create({
    ...common, movementId: i.inMovementId, cashboxId: i.to.cashboxId, shiftId: shiftFor(i.to, i.shiftId),
    kind: "TRANSFER_IN", amount: i.amount,
  });
  if (!inbound.ok) return inbound;
  return ok(Object.freeze({ outbound: outbound.value, inbound: inbound.value }));
}

export interface FxExchangeInput {
  readonly pairId: string;
  readonly inMovementId: string;
  readonly outMovementId: string;
  readonly cashbox: Cashbox;
  /** Cash received from the counterparty. */
  readonly received: Money;
  readonly rate: ExchangeRate;
  readonly occurredAt: string;
  readonly createdBy: string;
  readonly shiftId?: string | undefined;
  /** Cash step for the paid-out currency; rounded DOWN (in favour of the pharmacy, D-028). */
  readonly outRoundingStepMinor?: bigint | undefined;
  readonly outBalance?: Money | undefined;
}

export interface FxExchangeResult {
  readonly pair: CashPair;
  readonly paidOut: Money;
  readonly snapshot: RateSnapshot;
}

/** Receiving `rate.from` = pharmacy buys it (buy rate); receiving `rate.to` = pharmacy sells `from` (sell rate). */
export function exchangeFx(i: FxExchangeInput): Result<FxExchangeResult> {
  const { rate, received, cashbox } = i;
  const src = received.currency;
  if (src !== rate.from && src !== rate.to) {
    return domainErr("cashbox.fx_pair_mismatch", "Rate does not cover the received currency", { currency: src });
  }
  if (!received.isPositive()) return domainErr("cashbox.non_positive_amount", "Amount must be > 0");
  const direction: FxDirection = src === rate.from ? "buy" : "sell";
  const target = src === rate.from ? rate.to : rate.from;
  for (const c of [src, target]) {
    const g = guardBox(cashbox, c);
    if (!g.ok) return g;
  }
  const converted = unwrap(convert(received, rate, direction, target));
  const paidOut = i.outRoundingStepMinor === undefined ? converted : converted.roundToStep(i.outRoundingStepMinor, "down");
  if (paidOut.isZero()) return domainErr("cashbox.fx_zero_out", "Exchange would pay out nothing");
  if (i.outBalance !== undefined && paidOut.gt(i.outBalance)) {
    return domainErr("cashbox.insufficient_funds", "Not enough cash to pay out the exchange", {
      balance: i.outBalance.toDecimalString(), amount: paidOut.toDecimalString(),
    });
  }
  const snapshot = snapshotRate(rate, direction);
  const common = {
    cashboxId: cashbox.cashboxId, shiftId: shiftFor(cashbox, i.shiftId), occurredAt: i.occurredAt, createdBy: i.createdBy,
    documentRef: { type: "FX_EXCHANGE", id: i.pairId }, pairId: i.pairId, rateSnapshot: snapshot,
  };
  const inbound = CashMovement.create({ ...common, movementId: i.inMovementId, kind: "FX_IN", amount: received });
  if (!inbound.ok) return inbound;
  const outbound = CashMovement.create({ ...common, movementId: i.outMovementId, kind: "FX_OUT", amount: paidOut.negate() });
  if (!outbound.ok) return outbound;
  return ok(Object.freeze({ pair: Object.freeze({ outbound: outbound.value, inbound: inbound.value }), paidOut, snapshot }));
}

export interface SafeDropInput {
  readonly register: Cashbox;
  readonly safe: Cashbox;
  /** Current register balance per currency. */
  readonly balances: readonly Money[];
  /** Float to leave in the drawer per currency (default 0). */
  readonly keepFloat?: readonly Money[] | undefined;
  readonly occurredAt: string;
  readonly createdBy: string;
  readonly shiftId?: string | undefined;
  /** Id source (UUID v7 port in the application layer). */
  readonly newId: () => string;
}

/** Day-end safe drop: move everything above the kept float from the REGISTER to the SAFE. */
export function daySafeDrop(i: SafeDropInput): Result<readonly CashPair[]> {
  if (i.register.kind !== "REGISTER") return domainErr("cashbox.drop_source_kind", "Safe drop source must be a REGISTER");
  if (i.safe.kind !== "SAFE") return domainErr("cashbox.drop_target_kind", "Safe drop target must be a SAFE");
  const pairs: CashPair[] = [];
  for (const bal of i.balances) {
    const keep = i.keepFloat?.find((k) => k.currency === bal.currency) ?? Money.zero(bal.currency);
    if (keep.isNegative()) return domainErr("cashbox.negative_float", "Kept float must be >= 0", { currency: bal.currency });
    const drop = bal.subtract(keep);
    if (!drop.isPositive()) continue;
    const r = transferCash({
      pairId: i.newId(), outMovementId: i.newId(), inMovementId: i.newId(), from: i.register, to: i.safe,
      amount: drop, fromBalance: bal, occurredAt: i.occurredAt, createdBy: i.createdBy, shiftId: i.shiftId,
      reason: "DAY_END_SAFE_DROP",
    });
    if (!r.ok) return r;
    pairs.push(r.value);
  }
  return ok(Object.freeze(pairs));
}
