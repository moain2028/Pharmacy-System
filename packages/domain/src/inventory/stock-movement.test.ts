import { describe, expect, it } from "vitest";
import { Money } from "../money/money.js";
import { unwrap, type Result } from "../shared/result.js";
import {
  MOVEMENT_DIRECTION,
  MOVEMENT_TYPES,
  StockMovement,
  compareChronologically,
  deriveBalance,
  deriveBalances,
  isMovementType,
  kardex,
  movementKey,
  sortChronologically,
  type MovementType,
  type StockMovementProps,
} from "./stock-movement.js";

const yer = (t: string): Money => unwrap(Money.parse(t, "YER_NEW"));
function errCode<T>(r: Result<T>): string {
  if (r.ok) throw new Error("expected Err");
  return r.error.code;
}
const baseProps: StockMovementProps = {
  movementId: "m1",
  itemId: "I1",
  lotId: "L1",
  locationId: "LOC1",
  type: "RECEIPT",
  qtyDeltaSsu: 10n,
  unitCostSnapshot: yer("8.00"),
  documentRef: { docType: "purchase_receipt", docId: "PR-1", lineId: "1" },
  occurredAt: "2026-01-10T08:00:00.000Z",
  businessDate: "2026-01-10",
};
const mk = (over: Partial<StockMovementProps> = {}): StockMovement => unwrap(StockMovement.create({ ...baseProps, ...over }));

const IN_TYPES: MovementType[] = ["RECEIPT", "SALE_RETURN", "TRANSFER_IN", "OPENING"];
const OUT_TYPES: MovementType[] = ["SALE", "PURCHASE_RETURN", "TRANSFER_OUT"];
const ANY_TYPES: MovementType[] = ["ADJUSTMENT", "STOCKTAKE"];

describe("StockMovement.create", () => {
  it("derives costMinor from unit cost × |qty| and freezes", () => {
    const m = mk();
    expect(m.costMinor.toDecimalString()).toBe("80.00");
    expect(m.absQtySsu).toBe(10n);
    expect(m.isInbound()).toBe(true);
    expect(m.signedCostMinor().toDecimalString()).toBe("80.00");
    expect(m.reversalOfId).toBeUndefined();
    expect(m.note).toBeUndefined();
    expect(Object.isFrozen(m)).toBe(true);
    expect(Object.isFrozen(m.documentRef)).toBe(true);
  });
  it("accepts an explicit exact cost and outbound sign", () => {
    const m = mk({ type: "SALE", qtyDeltaSsu: -3n, costMinor: yer("24.00"), reversalOfId: "m0", note: "x" });
    expect(m.costMinor.toDecimalString()).toBe("24.00");
    expect(m.absQtySsu).toBe(3n);
    expect(m.isInbound()).toBe(false);
    expect(m.signedCostMinor().toDecimalString()).toBe("-24.00");
    expect(m.reversalOfId).toBe("m0");
  });
  it("normalises occurredAt to UTC", () => {
    expect(mk({ occurredAt: "2026-01-10T11:00:00+03:00" }).occurredAt).toBe("2026-01-10T08:00:00.000Z");
  });
  it.each(IN_TYPES)("%s must be positive", (type) => {
    expect(mk({ type, qtyDeltaSsu: 1n }).type).toBe(type);
    expect(errCode(StockMovement.create({ ...baseProps, type, qtyDeltaSsu: -1n }))).toBe("inventory.movement_sign");
  });
  it.each(OUT_TYPES)("%s must be negative", (type) => {
    expect(mk({ type, qtyDeltaSsu: -1n }).qtyDeltaSsu).toBe(-1n);
    expect(errCode(StockMovement.create({ ...baseProps, type, qtyDeltaSsu: 1n }))).toBe("inventory.movement_sign");
  });
  it.each(ANY_TYPES)("%s accepts either sign", (type) => {
    expect(mk({ type, qtyDeltaSsu: 2n }).qtyDeltaSsu).toBe(2n);
    expect(mk({ type, qtyDeltaSsu: -2n }).qtyDeltaSsu).toBe(-2n);
  });
  it.each<[string, Partial<StockMovementProps>]>([
    ["inventory.unknown_movement_type", { type: "BOGUS" as MovementType }],
    ["inventory.zero_movement", { qtyDeltaSsu: 0n }],
    ["qty.non_integer", { qtyDeltaSsu: 1.5 as unknown as bigint }],
    ["inventory.negative_cost", { unitCostSnapshot: yer("-1.00") }],
    ["inventory.currency_mismatch", { costMinor: Money.minor(100n, "USD") }],
    ["inventory.negative_cost", { costMinor: yer("-5.00") }],
    ["inventory.document_ref_required", { documentRef: { docType: " ", docId: "X" } }],
    ["inventory.document_ref_required", { documentRef: { docType: "sale", docId: "" } }],
    ["inventory.invalid_timestamp", { occurredAt: "yesterday" }],
    ["date.invalid", { businessDate: "10/01/2026" }],
  ])("rejects with %s", (code, over) => {
    expect(errCode(StockMovement.create({ ...baseProps, ...over }))).toBe(code);
  });
  it("exposes type metadata", () => {
    expect(MOVEMENT_TYPES.every(isMovementType)).toBe(true);
    expect(isMovementType("nope")).toBe(false);
    expect(isMovementType(3)).toBe(false);
    expect(MOVEMENT_DIRECTION.SALE).toBe("OUT");
    expect(movementKey(mk())).toBe("I1|L1|LOC1");
  });
});

describe("chronological order", () => {
  const d10 = mk({ movementId: "a", businessDate: "2026-01-10", occurredAt: "2026-01-12T00:00:00Z" });
  const d11early = mk({ movementId: "b", businessDate: "2026-01-11", occurredAt: "2026-01-11T01:00:00Z" });
  const d11late = mk({ movementId: "a", businessDate: "2026-01-11", occurredAt: "2026-01-11T02:00:00Z" });
  const d11late2 = mk({ movementId: "c", businessDate: "2026-01-11", occurredAt: "2026-01-11T02:00:00Z" });
  it("sorts by business date, then time, then id (backdated receipts go first)", () => {
    expect(sortChronologically([d11late2, d11late, d11early, d10]).map((m) => `${m.businessDate}/${m.movementId}`)).toEqual([
      "2026-01-10/a",
      "2026-01-11/b",
      "2026-01-11/a",
      "2026-01-11/c",
    ]);
  });
  it("comparator covers every branch", () => {
    expect(compareChronologically(d10, d11early)).toBe(-1);
    expect(compareChronologically(d11early, d10)).toBe(1);
    expect(compareChronologically(d11early, d11late)).toBe(-1);
    expect(compareChronologically(d11late, d11early)).toBe(1);
    expect(compareChronologically(d11late, d11late2)).toBe(-1);
    expect(compareChronologically(d11late2, d11late)).toBe(1);
    expect(compareChronologically(d11late, d11late)).toBe(0);
  });
});

describe("deriveBalances / deriveBalance", () => {
  const receipt = mk();
  const sale = mk({ movementId: "m2", type: "SALE", qtyDeltaSsu: -3n, businessDate: "2026-01-11", occurredAt: "2026-01-11T09:00:00Z" });
  const otherLoc = mk({ movementId: "m3", locationId: "LOC2", qtyDeltaSsu: 5n });
  it("rebuilds balances per key", () => {
    const b = unwrap(deriveBalances([sale, otherLoc, receipt]));
    expect([...b.entries()]).toEqual([
      ["I1|L1|LOC1", 7n],
      ["I1|L1|LOC2", 5n],
    ]);
  });
  it("refuses to go negative unless the policy allows", () => {
    const earlySale = mk({ movementId: "m2", type: "SALE", qtyDeltaSsu: -3n, businessDate: "2026-01-09" });
    const r = deriveBalances([receipt, earlySale]);
    expect(errCode(r)).toBe("inventory.negative_balance");
    if (!r.ok) expect(r.error.details).toMatchObject({ movementId: "m2", balanceSsu: "-3" });
    expect(unwrap(deriveBalances([receipt, earlySale], { allowNegativeStock: true })).get("I1|L1|LOC1")).toBe(7n);
    expect(unwrap(deriveBalance([earlySale], { allowNegativeStock: true }))).toBe(-3n);
  });
  it("deriveBalance handles empty, single and mixed keys", () => {
    expect(unwrap(deriveBalance([]))).toBe(0n);
    expect(unwrap(deriveBalance([receipt, sale]))).toBe(7n);
    expect(errCode(deriveBalance([receipt, otherLoc]))).toBe("inventory.mixed_movement_keys");
    const earlySale = mk({ movementId: "m2", type: "SALE", qtyDeltaSsu: -3n, businessDate: "2026-01-09" });
    expect(errCode(deriveBalance([earlySale]))).toBe("inventory.negative_balance");
  });
});

describe("kardex", () => {
  const receipt = mk();
  const sale = mk({ movementId: "m2", type: "SALE", qtyDeltaSsu: -3n, costMinor: yer("24.00"), businessDate: "2026-01-11" });
  it("returns an empty list for no movements", () => {
    expect(unwrap(kardex([]))).toEqual([]);
  });
  it("runs quantity and value with defaults", () => {
    const rows = unwrap(kardex([sale, receipt]));
    expect(rows.map((r) => [r.movement.movementId, r.qtyInSsu, r.qtyOutSsu, r.balanceSsu, r.costMinor.toDecimalString(), r.balanceValueMinor.toDecimalString()])).toEqual([
      ["m1", 10n, 0n, 10n, "80.00", "80.00"],
      ["m2", 0n, 3n, 7n, "24.00", "56.00"],
    ]);
    expect(Object.isFrozen(rows)).toBe(true);
  });
  it("starts from an opening balance and value", () => {
    const rows = unwrap(kardex([receipt, sale], { openingBalanceSsu: 5n, openingValueMinor: yer("40.00") }));
    expect(rows.map((r) => [r.balanceSsu, r.balanceValueMinor.toDecimalString()])).toEqual([
      [15n, "120.00"],
      [12n, "96.00"],
    ]);
  });
  it("rejects mixed items and foreign opening currency", () => {
    expect(errCode(kardex([receipt, mk({ movementId: "x", itemId: "I2" })]))).toBe("inventory.mixed_items");
    expect(errCode(kardex([receipt], { openingValueMinor: Money.minor(1n, "USD") }))).toBe("inventory.currency_mismatch");
  });
  it("enforces the negative balance invariant unless allowed", () => {
    const r = kardex([sale]);
    expect(errCode(r)).toBe("inventory.negative_balance");
    const rows = unwrap(kardex([sale], { allowNegativeStock: true }));
    expect(rows.map((x) => [x.balanceSsu, x.balanceValueMinor.toDecimalString()])).toEqual([[-3n, "-24.00"]]);
  });
});
