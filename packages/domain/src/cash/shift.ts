/**
 * Shift aggregate (FR-SHF-101..115).
 * - One OPEN shift per cashier and per cashbox; opening float per currency (FR-SHF-103).
 * - Expected cash = opening float + this shift's movements on its cashbox (OPENING_FLOAT movements
 *   are excluded: the float lives on the shift itself).
 * - Close: counted cash (amount or denominations) -> variance = counted - expected; above tolerance
 *   requires reason + supervisor (FR-SHF-107/109). Produces an immutable Z snapshot (FR-SHF-110).
 * - X report any time while OPEN; never changes state (FR-SHF-106). Blind close hides expected.
 * - Reopen requires permission `shifts.reopen` + reason; previous closings are kept in history.
 */
import { CURRENCY_CODES, type CurrencyCode } from "../money/currency.js";
import { Money } from "../money/money.js";
import { domainErr, ok, type Result } from "../shared/result.js";
import type { CashMovement } from "./cash-movement.js";

export const SHIFT_STATUSES = ["OPEN", "CLOSED"] as const;
export type ShiftStatus = (typeof SHIFT_STATUSES)[number];
export const SHIFT_MODES = ["per_user", "per_device"] as const;
export type ShiftMode = (typeof SHIFT_MODES)[number];
export const PAYMENT_METHODS = ["cash", "wallet", "card", "credit", "advance"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const SHIFT_REOPEN_PERMISSION = "shifts.reopen" as const;

export interface ShiftRef { readonly shiftId: string; readonly userId: string; readonly cashboxId: string; readonly status: ShiftStatus }
/** One payment line of a posted sale or refund (all methods, not only cash). */
export interface ShiftTender {
  readonly docId: string;
  readonly kind: "SALE" | "SALE_REFUND";
  readonly method: PaymentMethod;
  readonly amount: Money;
  readonly cashierId: string;
}
export interface MethodTotal { readonly method: PaymentMethod; readonly currency: CurrencyCode; readonly count: number; readonly total: Money }
export interface CashierSales { readonly cashierId: string; readonly salesCount: number }
export interface ShiftReport {
  readonly type: "X" | "Z";
  readonly shiftId: string;
  readonly shiftNo: number;
  readonly userId: string;
  readonly cashboxId: string;
  readonly generatedAt: string;
  readonly zNumber: number | null;
  readonly salesCount: number;
  readonly refundsCount: number;
  readonly sales: readonly MethodTotal[];
  readonly refunds: readonly MethodTotal[];
  readonly salesByCashier: readonly CashierSales[];
  readonly cashIn: readonly Money[];
  readonly cashOut: readonly Money[];
  readonly opening: readonly Money[];
  readonly expectedCash: readonly Money[];
}
export interface Denomination { readonly faceValue: Money; readonly count: bigint }
export interface CurrencyCount {
  readonly currency: CurrencyCode;
  readonly amount?: Money | undefined;
  readonly denominations?: readonly Denomination[] | undefined;
}
export interface CurrencyClosing {
  readonly currency: CurrencyCode;
  readonly opening: Money;
  readonly expected: Money;
  readonly counted: Money;
  readonly variance: Money;
  readonly denominations: readonly Denomination[];
  readonly reason: string | null;
  readonly approvedBy: string | null;
}
export interface ShiftClosing { readonly closedAt: string; readonly zNumber: number; readonly currencies: readonly CurrencyClosing[]; readonly zReport: ShiftReport }
export interface ReopenEntry { readonly by: string; readonly reason: string; readonly at: string; readonly zNumber: number }

export interface OpenShiftInput {
  readonly shiftId: string;
  readonly shiftNo: number;
  readonly mode: ShiftMode;
  readonly cashboxId: string;
  readonly deviceId: string;
  readonly userId: string;
  readonly openedAt: Date;
  readonly openingFloat: readonly Money[];
  /** Actual closing count of the previous shift on the same drawer. */
  readonly previousClosing?: readonly Money[] | undefined;
  readonly openingReason?: string | undefined;
  readonly blindClose?: boolean | undefined;
  readonly existingShifts: readonly ShiftRef[];
}
export interface CloseShiftInput {
  readonly closedAt: Date;
  readonly zNumber: number;
  readonly counts: readonly CurrencyCount[];
  readonly movements: readonly CashMovement[];
  readonly tenders: readonly ShiftTender[];
  readonly tolerances?: readonly Money[] | undefined;
  readonly reasons?: Readonly<Partial<Record<CurrencyCode, string>>> | undefined;
  readonly approvedBy?: string | undefined;
  /** Drafts / invoices in payment still open (FR-SHF-111). */
  readonly openDocuments?: number | undefined;
}
export interface ReopenShiftInput {
  readonly by: string;
  readonly reason: string;
  readonly at: Date;
  readonly permissions: readonly string[];
  readonly existingShifts: readonly ShiftRef[];
}

interface ShiftState {
  readonly shiftId: string; readonly shiftNo: number; readonly mode: ShiftMode; readonly cashboxId: string;
  readonly deviceId: string; readonly userId: string; readonly openedAt: string; readonly openingFloat: readonly Money[];
  readonly openingReason: string | null; readonly blindClose: boolean; readonly status: ShiftStatus;
  readonly closing: ShiftClosing | null; readonly history: readonly ShiftClosing[]; readonly reopenLog: readonly ReopenEntry[];
}
type CurrencyMap = Map<CurrencyCode, Money>;
interface Bucket { readonly method: PaymentMethod; readonly currency: CurrencyCode; readonly docs: Set<string>; total: Money }

const clean = (s: string | undefined): string | null => (s === undefined || s.trim() === "" ? null : s.trim());
const idx = (c: CurrencyCode): number => CURRENCY_CODES.indexOf(c);
const pick = (list: readonly Money[] | undefined, c: CurrencyCode): Money => list?.find((m) => m.currency === c) ?? Money.zero(c);
function addTo(map: CurrencyMap, m: Money): void {
  const prev = map.get(m.currency);
  map.set(m.currency, prev === undefined ? m : prev.add(m));
}
const ordered = (map: CurrencyMap): readonly Money[] => Object.freeze([...map.values()].sort((a, b) => idx(a.currency) - idx(b.currency)));
function duplicate(list: readonly { readonly currency: CurrencyCode }[]): CurrencyCode | undefined {
  const seen = new Set<CurrencyCode>();
  for (const x of list) {
    if (seen.has(x.currency)) return x.currency;
    seen.add(x.currency);
  }
  return undefined;
}
function conflicts(existing: readonly ShiftRef[], shiftId: string, userId: string, cashboxId: string): Result<null> {
  for (const s of existing) {
    if (s.status !== "OPEN" || s.shiftId === shiftId) continue;
    if (s.userId === userId) return domainErr("shift.user_has_open_shift", "Cashier already has an open shift", { shiftId: s.shiftId });
    if (s.cashboxId === cashboxId) return domainErr("shift.cashbox_has_open_shift", "Cashbox already has an open shift", { shiftId: s.shiftId });
  }
  return ok(null);
}
function methodTotals(tenders: readonly ShiftTender[]): readonly MethodTotal[] {
  const acc = new Map<string, Bucket>();
  for (const t of tenders) {
    const key = `${t.method}|${t.amount.currency}`;
    const b = acc.get(key);
    if (b === undefined) acc.set(key, { method: t.method, currency: t.amount.currency, docs: new Set([t.docId]), total: t.amount });
    else {
      b.docs.add(t.docId);
      b.total = b.total.add(t.amount);
    }
  }
  const rank = (b: Bucket): number => PAYMENT_METHODS.indexOf(b.method) * 10 + idx(b.currency);
  return Object.freeze([...acc.values()].sort((a, b) => rank(a) - rank(b))
    .map((b) => Object.freeze({ method: b.method, currency: b.currency, count: b.docs.size, total: b.total })));
}
function cashierSales(sales: readonly ShiftTender[]): readonly CashierSales[] {
  const acc = new Map<string, Set<string>>();
  for (const t of sales) acc.set(t.cashierId, (acc.get(t.cashierId) ?? new Set<string>()).add(t.docId));
  return Object.freeze([...acc.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([cashierId, docs]) => Object.freeze({ cashierId, salesCount: docs.size })));
}
function resolveCount(k: CurrencyCount): Result<Money> {
  const { amount, denominations } = k;
  const invalid = domainErr("shift.invalid_count", "Give either a total amount or denominations", { currency: k.currency });
  if (amount !== undefined) {
    if (denominations !== undefined) return invalid;
    if (amount.currency !== k.currency) return domainErr("shift.count_currency_mismatch", "Counted amount currency mismatch", { currency: k.currency });
    if (amount.isNegative()) return domainErr("shift.negative_count", "Counted cash must be >= 0", { currency: k.currency });
    return ok(amount);
  }
  if (denominations === undefined) return invalid;
  let total = Money.zero(k.currency);
  for (const d of denominations) {
    if (d.faceValue.currency !== k.currency || !d.faceValue.isPositive() || d.count < 0n) {
      return domainErr("shift.invalid_denomination", "Denomination must be positive, same currency, count >= 0", { currency: k.currency });
    }
    total = total.add(d.faceValue.multiply(d.count));
  }
  return ok(total);
}

export class Shift {
  private readonly s: ShiftState;
  private constructor(s: ShiftState) {
    this.s = Object.freeze(s);
    Object.freeze(this);
  }

  get shiftId(): string { return this.s.shiftId; }
  get shiftNo(): number { return this.s.shiftNo; }
  get mode(): ShiftMode { return this.s.mode; }
  get cashboxId(): string { return this.s.cashboxId; }
  get deviceId(): string { return this.s.deviceId; }
  get userId(): string { return this.s.userId; }
  get openedAt(): string { return this.s.openedAt; }
  get openingFloat(): readonly Money[] { return this.s.openingFloat; }
  get openingReason(): string | null { return this.s.openingReason; }
  get blindClose(): boolean { return this.s.blindClose; }
  get status(): ShiftStatus { return this.s.status; }
  get closing(): ShiftClosing | null { return this.s.closing; }
  get history(): readonly ShiftClosing[] { return this.s.history; }
  get reopenLog(): readonly ReopenEntry[] { return this.s.reopenLog; }

  static open(i: OpenShiftInput): Result<Shift> {
    const required = [["shiftId", i.shiftId], ["cashboxId", i.cashboxId], ["deviceId", i.deviceId], ["userId", i.userId]] as const;
    for (const [field, v] of required) if (clean(v) === null) return domainErr("shift.missing_field", `${field} is required`, { field });
    if (!Number.isSafeInteger(i.shiftNo) || i.shiftNo <= 0) return domainErr("shift.invalid_number", "shiftNo must be a positive integer");
    if (Number.isNaN(i.openedAt.getTime())) return domainErr("shift.invalid_date", "openedAt must be a valid date");
    const c = conflicts(i.existingShifts, i.shiftId, i.userId, i.cashboxId);
    if (!c.ok) return c;
    const dup = duplicate(i.openingFloat);
    if (dup !== undefined) return domainErr("shift.duplicate_currency", "Currency listed twice", { currency: dup });
    for (const m of i.openingFloat) {
      if (m.isNegative()) return domainErr("shift.negative_float", "Opening float must be >= 0", { currency: m.currency });
    }
    const reason = clean(i.openingReason);
    if (i.previousClosing !== undefined && reason === null) {
      for (const m of [...i.openingFloat, ...i.previousClosing]) {
        const prev = pick(i.previousClosing, m.currency);
        const now = pick(i.openingFloat, m.currency);
        if (!now.equals(prev)) {
          return domainErr("shift.opening_reason_required", "Opening float differs from previous closing; reason required", {
            currency: m.currency, opening: now.toDecimalString(), previous: prev.toDecimalString(),
          });
        }
      }
    }
    return ok(new Shift({
      shiftId: i.shiftId, shiftNo: i.shiftNo, mode: i.mode, cashboxId: i.cashboxId, deviceId: i.deviceId, userId: i.userId,
      openedAt: i.openedAt.toISOString(), openingFloat: Object.freeze([...i.openingFloat].sort((a, b) => idx(a.currency) - idx(b.currency))),
      openingReason: reason, blindClose: i.blindClose ?? false, status: "OPEN", closing: null, history: Object.freeze([]), reopenLog: Object.freeze([]),
    }));
  }

  toRef(): ShiftRef {
    return Object.freeze({ shiftId: this.shiftId, userId: this.userId, cashboxId: this.cashboxId, status: this.status });
  }

  expectedCash(movements: readonly CashMovement[]): readonly Money[] {
    return ordered(this.expectedMap(movements));
  }

  /** What the cashier may see: hidden while a blind-close shift is OPEN (FR-SHF-108). */
  expectedCashForCashier(movements: readonly CashMovement[]): Result<readonly Money[]> {
    if (this.blindClose && this.status === "OPEN") return domainErr("shift.blind_count", "Expected cash is hidden until counting is confirmed");
    return ok(this.expectedCash(movements));
  }

  xReport(movements: readonly CashMovement[], tenders: readonly ShiftTender[], at: Date): Result<ShiftReport> {
    if (this.status !== "OPEN") return domainErr("shift.not_open", "Shift is not open");
    return this.buildReport("X", movements, tenders, at, null);
  }

  close(i: CloseShiftInput): Result<Shift> {
    if (this.status !== "OPEN") return domainErr("shift.not_open", "Shift is not open");
    if ((i.openDocuments ?? 0) > 0) return domainErr("shift.open_documents", "Open drafts/payments block closing", { count: i.openDocuments });
    if (!Number.isSafeInteger(i.zNumber) || i.zNumber <= 0) return domainErr("shift.invalid_z_number", "zNumber must be a positive integer");
    const ms = i.closedAt.getTime();
    if (Number.isNaN(ms) || ms < Date.parse(this.openedAt)) return domainErr("shift.invalid_date", "closedAt must be a valid date after opening");
    const dup = duplicate(i.counts);
    if (dup !== undefined) return domainErr("shift.duplicate_currency", "Currency counted twice", { currency: dup });
    const expected = this.expectedMap(i.movements);
    for (const c of expected.keys()) {
      if (!i.counts.some((k) => k.currency === c)) return domainErr("shift.count_missing", "Every cash currency must be counted", { currency: c });
    }
    const closings: CurrencyClosing[] = [];
    for (const k of i.counts) {
      const counted = resolveCount(k);
      if (!counted.ok) return counted;
      const exp = expected.get(k.currency) ?? Money.zero(k.currency);
      const variance = counted.value.subtract(exp);
      const reason = clean(i.reasons?.[k.currency]);
      const approvedBy = clean(i.approvedBy);
      if (variance.abs().gt(pick(i.tolerances, k.currency))) {
        const details = { currency: k.currency, variance: variance.toDecimalString() };
        if (reason === null) return domainErr("shift.variance_reason_required", "Variance above tolerance needs a reason", details);
        if (approvedBy === null) return domainErr("shift.variance_approval_required", "Variance above tolerance needs supervisor approval", details);
      }
      closings.push(Object.freeze({
        currency: k.currency, opening: pick(this.openingFloat, k.currency), expected: exp, counted: counted.value, variance,
        denominations: Object.freeze([...(k.denominations ?? [])]), reason, approvedBy,
      }));
    }
    const z = this.buildReport("Z", i.movements, i.tenders, i.closedAt, i.zNumber);
    if (!z.ok) return z;
    const closing: ShiftClosing = Object.freeze({
      closedAt: i.closedAt.toISOString(), zNumber: i.zNumber,
      currencies: Object.freeze(closings.sort((a, b) => idx(a.currency) - idx(b.currency))), zReport: z.value,
    });
    return ok(this.with({ status: "CLOSED", closing }));
  }

  reopen(i: ReopenShiftInput): Result<Shift> {
    const closing = this.closing;
    if (closing === null) return domainErr("shift.not_closed", "Only a closed shift can be reopened");
    if (!i.permissions.includes(SHIFT_REOPEN_PERMISSION)) {
      return domainErr("shift.permission_denied", "Reopening a shift requires permission", { permission: SHIFT_REOPEN_PERMISSION });
    }
    const reason = clean(i.reason);
    if (reason === null || clean(i.by) === null) return domainErr("shift.reopen_reason_required", "Reopen needs a reason and the approving user");
    if (Number.isNaN(i.at.getTime())) return domainErr("shift.invalid_date", "at must be a valid date");
    const c = conflicts(i.existingShifts, this.shiftId, this.userId, this.cashboxId);
    if (!c.ok) return c;
    return ok(this.with({
      status: "OPEN", closing: null, history: Object.freeze([...this.history, closing]),
      reopenLog: Object.freeze([...this.reopenLog, Object.freeze({ by: i.by, reason, at: i.at.toISOString(), zNumber: closing.zNumber })]),
    }));
  }

  private with(patch: Partial<ShiftState>): Shift {
    return new Shift({ ...this.s, ...patch });
  }

  private relevant(movements: readonly CashMovement[]): CashMovement[] {
    return movements.filter((m) => m.shiftId === this.shiftId && m.cashboxId === this.cashboxId && m.kind !== "OPENING_FLOAT");
  }

  private expectedMap(movements: readonly CashMovement[]): CurrencyMap {
    const map: CurrencyMap = new Map();
    for (const m of this.openingFloat) addTo(map, m);
    for (const m of this.relevant(movements)) addTo(map, m.amount);
    return map;
  }

  private buildReport(type: "X" | "Z", movements: readonly CashMovement[], tenders: readonly ShiftTender[], at: Date, zNumber: number | null): Result<ShiftReport> {
    if (Number.isNaN(at.getTime())) return domainErr("shift.invalid_date", "Report time must be a valid date");
    for (const t of tenders) {
      if (!t.amount.isPositive() || clean(t.docId) === null) return domainErr("shift.invalid_tender", "Tender needs a docId and a positive amount", { docId: t.docId });
    }
    const cashIn: CurrencyMap = new Map();
    const cashOut: CurrencyMap = new Map();
    for (const m of this.relevant(movements)) addTo(m.isInbound() ? cashIn : cashOut, m.amount.abs());
    const sales = tenders.filter((t) => t.kind === "SALE");
    const refunds = tenders.filter((t) => t.kind === "SALE_REFUND");
    return ok(Object.freeze({
      type, shiftId: this.shiftId, shiftNo: this.shiftNo, userId: this.userId, cashboxId: this.cashboxId,
      generatedAt: at.toISOString(), zNumber,
      salesCount: new Set(sales.map((t) => t.docId)).size, refundsCount: new Set(refunds.map((t) => t.docId)).size,
      sales: methodTotals(sales), refunds: methodTotals(refunds), salesByCashier: cashierSales(sales),
      cashIn: ordered(cashIn), cashOut: ordered(cashOut), opening: this.openingFloat, expectedCash: this.expectedCash(movements),
    }));
  }
}
