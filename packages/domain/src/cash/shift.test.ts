import { describe, expect, it } from "vitest";
import { Money } from "../money/money.js";
import { unwrap, type Result } from "../shared/result.js";
import { CashMovement, type CashMovementKind } from "./cash-movement.js";
import {
  PAYMENT_METHODS, SHIFT_MODES, SHIFT_REOPEN_PERMISSION, SHIFT_STATUSES, Shift,
  type CloseShiftInput, type CurrencyCount, type OpenShiftInput, type ReopenShiftInput, type ShiftTender,
} from "./shift.js";

const yer = (n: bigint): Money => Money.minor(n * 100n, "YER_OLD");
const sar = (n: bigint): Money => Money.minor(n * 100n, "SAR");
const code = (r: Result<unknown>): string => (r.ok ? "ok" : r.error.code);
const t0 = new Date("2025-03-01T05:00:00Z");
const t1 = new Date("2025-03-01T21:00:00Z");
let seq = 0;
const mv = (kind: CashMovementKind, amount: Money, shiftId = "s1", cashboxId = "cb1"): CashMovement =>
  unwrap(CashMovement.create({ movementId: `m${++seq}`, cashboxId, shiftId, kind, amount, occurredAt: "2025-03-01T08:00:00Z", createdBy: "u1" }));
const openInput = (over: Partial<OpenShiftInput> = {}): OpenShiftInput => ({
  shiftId: "s1", shiftNo: 1, mode: "per_device", cashboxId: "cb1", deviceId: "d1", userId: "u1", openedAt: t0,
  openingFloat: [yer(20_000n)], existingShifts: [], ...over,
});
const movements = [
  mv("SALE", yer(35_000n)), mv("SALE", sar(50n)), mv("EXPENSE", yer(-5_000n)), mv("SALE_REFUND", yer(-2_000n)),
  mv("OPENING_FLOAT", yer(20_000n)), mv("SALE", yer(999n), "s0"), mv("SALE", yer(1n), "s1", "cb2"),
];
const tender = (docId: string, kind: ShiftTender["kind"], method: ShiftTender["method"], amount: Money, cashierId = "u1"): ShiftTender =>
  ({ docId, kind, method, amount, cashierId });
const tenders = [
  tender("A", "SALE", "cash", yer(20_000n)), tender("A", "SALE", "card", yer(10_000n)), tender("B", "SALE", "cash", yer(15_000n)),
  tender("C", "SALE", "cash", sar(50n), "u2"), tender("R", "SALE_REFUND", "cash", yer(2_000n)),
];
const yerCount: CurrencyCount = { currency: "YER_OLD", denominations: [{ faceValue: yer(1000n), count: 40n }, { faceValue: yer(500n), count: 15n }] };
const sarCount: CurrencyCount = { currency: "SAR", amount: sar(50n) };
const closeInput = (over: Partial<CloseShiftInput> = {}): CloseShiftInput => ({
  closedAt: t1, zNumber: 1, counts: [yerCount, sarCount], movements, tenders, tolerances: [yer(500n)], ...over,
});
const opened = unwrap(Shift.open(openInput()));
const closed = unwrap(opened.close(closeInput()));
const reopenInput = (over: Partial<ReopenShiftInput> = {}): ReopenShiftInput => ({
  by: "sup1", reason: "late invoice", at: new Date("2025-03-01T22:00:00Z"), permissions: [SHIFT_REOPEN_PERMISSION], existingShifts: [], ...over,
});

describe("Shift.open", () => {
  it("opens with a frozen state and canonical names", () => {
    expect([SHIFT_STATUSES, SHIFT_MODES, PAYMENT_METHODS.length]).toEqual([["OPEN", "CLOSED"], ["per_user", "per_device"], 5]);
    expect([opened.status, opened.mode, opened.deviceId, opened.shiftNo, opened.blindClose, opened.openingReason]).toEqual(["OPEN", "per_device", "d1", 1, false, null]);
    expect(opened.openedAt).toBe("2025-03-01T05:00:00.000Z");
    expect(opened.toRef()).toEqual({ shiftId: "s1", userId: "u1", cashboxId: "cb1", status: "OPEN" });
    expect(Object.isFrozen(opened)).toBe(true);
  });
  it("accepts a matching previous closing, or a differing one with a reason; ignores closed/same shifts", () => {
    expect(code(Shift.open(openInput({ previousClosing: [yer(20_000n)] })))).toBe("ok");
    const s = unwrap(Shift.open(openInput({ previousClosing: [yer(25_000n)], openingReason: " short float " })));
    expect(s.openingReason).toBe("short float");
    const existing = [{ shiftId: "s0", userId: "u1", cashboxId: "cb1", status: "CLOSED" as const }, opened.toRef()];
    expect(code(Shift.open(openInput({ existingShifts: existing, openingFloat: [sar(5n), yer(1n)] })))).toBe("ok");
  });
  it.each<[string, Partial<OpenShiftInput>, string]>([
    ["blank user", { userId: " " }, "shift.missing_field"],
    ["bad number", { shiftNo: 0 }, "shift.invalid_number"],
    ["bad date", { openedAt: new Date("x") }, "shift.invalid_date"],
    ["cashier busy", { existingShifts: [{ shiftId: "s9", userId: "u1", cashboxId: "cb9", status: "OPEN" }] }, "shift.user_has_open_shift"],
    ["cashbox busy", { existingShifts: [{ shiftId: "s9", userId: "u9", cashboxId: "cb1", status: "OPEN" }] }, "shift.cashbox_has_open_shift"],
    ["dup currency", { openingFloat: [yer(1n), yer(2n)] }, "shift.duplicate_currency"],
    ["negative", { openingFloat: [yer(-1n)] }, "shift.negative_float"],
    ["20,000 vs previous 25,000", { previousClosing: [yer(25_000n)] }, "shift.opening_reason_required"],
    ["missing SAR vs previous", { previousClosing: [yer(20_000n), sar(10n)] }, "shift.opening_reason_required"],
  ])("rejects %s", (_l, over, expected) => {
    expect(code(Shift.open(openInput(over)))).toBe(expected);
  });
});

describe("expected cash, X report and blind count", () => {
  it("expected = opening + shift movements (pay_out 5,000 reduces it) => 48,000 YER, 50 SAR", () => {
    expect(opened.expectedCash(movements)).toEqual([yer(48_000n), sar(50n)]);
    expect(unwrap(opened.expectedCashForCashier(movements))).toEqual([yer(48_000n), sar(50n)]);
  });
  it("X report is deterministic and does not change state", () => {
    const x = unwrap(opened.xReport(movements, tenders, t1));
    expect(x).toEqual(unwrap(opened.xReport(movements, tenders, t1)));
    expect([x.type, x.zNumber, x.salesCount, x.refundsCount, x.generatedAt]).toEqual(["X", null, 3, 1, "2025-03-01T21:00:00.000Z"]);
    expect(x.sales).toEqual([
      { method: "cash", currency: "YER_OLD", count: 2, total: yer(35_000n) },
      { method: "cash", currency: "SAR", count: 1, total: sar(50n) },
      { method: "card", currency: "YER_OLD", count: 1, total: yer(10_000n) },
    ]);
    expect(x.refunds).toEqual([{ method: "cash", currency: "YER_OLD", count: 1, total: yer(2_000n) }]);
    expect(x.salesByCashier).toEqual([{ cashierId: "u1", salesCount: 2 }, { cashierId: "u2", salesCount: 1 }]);
    expect([x.cashIn, x.cashOut, x.opening]).toEqual([[yer(35_000n), sar(50n)], [yer(7_000n)], [yer(20_000n)]]);
    expect(opened.status).toBe("OPEN");
  });
  it("rejects X on bad input or closed shift", () => {
    expect(code(opened.xReport(movements, tenders, new Date("x")))).toBe("shift.invalid_date");
    expect(code(closed.xReport(movements, tenders, t1))).toBe("shift.not_open");
  });
  it("blind close hides expected only while open", () => {
    const blind = unwrap(Shift.open(openInput({ blindClose: true })));
    expect(code(blind.expectedCashForCashier(movements))).toBe("shift.blind_count");
    expect(code(unwrap(blind.close(closeInput())).expectedCashForCashier(movements))).toBe("ok");
  });
});

describe("close", () => {
  it("counts denominations 47,500 vs expected 48,000 => variance -500 within tolerance; Z snapshot frozen", () => {
    const c = closed.closing;
    expect(closed.status).toBe("CLOSED");
    expect(c?.zNumber).toBe(1);
    expect(c?.currencies[0]).toMatchObject({ currency: "YER_OLD", opening: yer(20_000n), expected: yer(48_000n), counted: yer(47_500n), variance: yer(-500n), reason: null, approvedBy: null });
    expect(c?.currencies[1]).toMatchObject({ currency: "SAR", variance: sar(0n), denominations: [] });
    expect([c?.zReport.type, c?.zReport.zNumber]).toEqual(["Z", 1]);
    expect(Object.isFrozen(c?.zReport)).toBe(true);
  });
  it("shortage 2,000 with tolerance 500 needs reason + supervisor", () => {
    const over = { counts: [{ currency: "YER_OLD" as const, amount: yer(46_000n) }, sarCount, { currency: "USD" as const, amount: Money.zero("USD") }] };
    expect(code(opened.close(closeInput(over)))).toBe("shift.variance_reason_required");
    expect(code(opened.close(closeInput({ ...over, reasons: { YER_OLD: "miscount" } })))).toBe("shift.variance_approval_required");
    const s = unwrap(opened.close(closeInput({ ...over, reasons: { YER_OLD: "miscount" }, approvedBy: "sup1" })));
    expect(s.closing?.currencies.map((x) => x.currency)).toEqual(["YER_OLD", "SAR", "USD"]);
    expect(s.closing?.currencies[0]).toMatchObject({ variance: yer(-2_000n), reason: "miscount", approvedBy: "sup1" });
  });
  it.each<[string, Partial<CloseShiftInput>, string]>([
    ["open docs", { openDocuments: 2 }, "shift.open_documents"],
    ["z number", { zNumber: 0 }, "shift.invalid_z_number"],
    ["before opening", { closedAt: new Date("2025-03-01T04:00:00Z") }, "shift.invalid_date"],
    ["bad date", { closedAt: new Date("x") }, "shift.invalid_date"],
    ["dup count", { counts: [yerCount, yerCount] }, "shift.duplicate_currency"],
    ["missing SAR", { counts: [yerCount] }, "shift.count_missing"],
    ["neither", { counts: [{ currency: "YER_OLD" }, sarCount] }, "shift.invalid_count"],
    ["both", { counts: [{ currency: "YER_OLD", amount: yer(1n), denominations: [] }, sarCount] }, "shift.invalid_count"],
    ["currency", { counts: [{ currency: "YER_OLD", amount: sar(1n) }, sarCount] }, "shift.count_currency_mismatch"],
    ["negative", { counts: [{ currency: "YER_OLD", amount: yer(-1n) }, sarCount] }, "shift.negative_count"],
    ["denom count", { counts: [{ currency: "YER_OLD", denominations: [{ faceValue: yer(100n), count: -1n }] }, sarCount] }, "shift.invalid_denomination"],
    ["denom currency", { counts: [{ currency: "YER_OLD", denominations: [{ faceValue: sar(1n), count: 1n }] }, sarCount] }, "shift.invalid_denomination"],
    ["denom zero", { counts: [{ currency: "YER_OLD", denominations: [{ faceValue: yer(0n), count: 1n }] }, sarCount] }, "shift.invalid_denomination"],
    ["no tolerance", { tolerances: [] }, "shift.variance_reason_required"],
    ["tender", { tenders: [tender("A", "SALE", "cash", yer(0n))] }, "shift.invalid_tender"],
    ["tender doc", { tenders: [tender(" ", "SALE", "cash", yer(1n))] }, "shift.invalid_tender"],
  ])("rejects %s", (_l, over, expected) => {
    expect(code(opened.close(closeInput(over)))).toBe(expected);
  });
  it("cannot close twice", () => {
    expect(code(closed.close(closeInput()))).toBe("shift.not_open");
  });
});

describe("reopen", () => {
  it("reopens with permission + reason, keeps the Z history and closes again with the next Z", () => {
    const r = unwrap(closed.reopen(reopenInput()));
    expect([r.status, r.closing, r.history.length]).toEqual(["OPEN", null, 1]);
    expect(r.reopenLog).toEqual([{ by: "sup1", reason: "late invoice", at: "2025-03-01T22:00:00.000Z", zNumber: 1 }]);
    expect(unwrap(r.close(closeInput({ zNumber: 2, closedAt: new Date("2025-03-01T23:00:00Z") }))).closing?.zNumber).toBe(2);
    expect(closed.status).toBe("CLOSED");
  });
  it.each<[string, Partial<ReopenShiftInput>, string]>([
    ["permission", { permissions: ["shift.close"] }, "shift.permission_denied"],
    ["reason", { reason: " " }, "shift.reopen_reason_required"],
    ["by", { by: "" }, "shift.reopen_reason_required"],
    ["date", { at: new Date("x") }, "shift.invalid_date"],
    ["conflict", { existingShifts: [{ shiftId: "s2", userId: "u1", cashboxId: "cb2", status: "OPEN" }] }, "shift.user_has_open_shift"],
  ])("rejects %s", (_l, over, expected) => {
    expect(code(closed.reopen(reopenInput(over)))).toBe(expected);
  });
  it("rejects reopening an open shift", () => {
    expect(code(opened.reopen(reopenInput()))).toBe("shift.not_closed");
  });
});
