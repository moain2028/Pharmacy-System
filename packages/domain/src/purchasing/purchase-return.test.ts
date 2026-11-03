import { describe, expect, it } from "vitest";
import { Money } from "../money/money.js";
import { unwrap, type Result } from "../shared/result.js";
import { Lot } from "../inventory/lot.js";
import {
  PURCHASE_RETURN_DOC_TYPE, PURCHASE_RETURN_REASONS, PurchaseReturn, RETURNED_LOT_STATUS, isPurchaseReturnReason,
  type PurchaseReturnLineInput, type PurchaseReturnProps, type PurchaseReturnReason,
} from "./purchase-return.js";

const Y = (n: bigint | number): Money => Money.minor(n, "YER_NEW");
const U = (n: bigint | number): Money => Money.minor(n, "USD");
const code = (r: Result<unknown>): string => (r.ok ? "ok" : r.error.code);
const lot = (id: string, received: bigint, totalMinor: bigint, itemId = "item-1"): Lot =>
  unwrap(Lot.create({ lotId: id, itemId, lotNumber: "L1", expiryDate: "2030-12-31", qtyReceivedSsu: received, totalCostMinor: Y(totalMinor), sourceType: "OFFICIAL" }));
const header = {
  returnId: "ret-1", returnNo: "PR-1", debitNoteNo: "DN-1", tenantId: "t1", supplierId: "sup-1", locationId: "loc-1",
  returnDate: "2026-02-01", occurredAt: "2026-02-01T10:00:00Z", currency: "YER_NEW", baseCurrency: "YER_NEW",
} as const;
/** Lot of 100 SSU costing 10,000.00 YER → 100.00 per SSU (FR-PUR-116 example). */
const line = (over: Partial<PurchaseReturnLineInput> = {}): PurchaseReturnLineInput =>
  ({ lineId: "l1", itemId: "item-1", lot: lot("lot-1", 100n, 1_000_000n), onHandSsu: 30n, qtySsu: 10n, reason: "DAMAGED", ...over });
const make = (over: Partial<PurchaseReturnProps> = {}, lines: readonly PurchaseReturnLineInput[] = [line()]): Result<PurchaseReturn> =>
  PurchaseReturn.create({ ...header, lines, ...over });
let seq = 0;
const opts = () => ({ entryId: "je-1", newId: () => `id-${++seq}`, accounts: { ap: "2100", returnLoss: "5250" }, postedAt: new Date("2026-02-01T10:00:00Z") });
/** USD supplier, 1 USD = 530 YER (FR-PUR-110); lot 100 SSU costing 53,000.00 YER. */
const usdHeader = { currency: "USD", baseCurrency: "YER_NEW", rateScaledSnapshot: 530_000_000n } as const;
const usdLine = (over: Partial<PurchaseReturnLineInput> = {}): PurchaseReturnLineInput =>
  line({ lot: lot("lot-u", 100n, 5_300_000n), onHandSsu: 100n, qtySsu: 100n, ...over });

describe("reasons", () => {
  it("exposes the canonical enums and type guard", () => {
    expect(PURCHASE_RETURN_REASONS).toEqual(["EXPIRED", "DAMAGED", "WRONG_ITEM", "RECALL", "PRICE_DISPUTE", "OTHER"]);
    expect(RETURNED_LOT_STATUS).toBe("RETURNED_TO_SUPPLIER");
    expect(isPurchaseReturnReason("RECALL")).toBe(true);
    expect(isPurchaseReturnReason("BROKEN")).toBe(false);
    expect(isPurchaseReturnReason(3)).toBe(false);
  });
});

describe("PurchaseReturn.create", () => {
  it.each<[string, Result<PurchaseReturn>]>([
    ["purchase_return.no_lines", make({}, [])],
    ["purchase_return.qty_exceeds_available", make({}, [line({ onHandSsu: 30n, qtySsu: 40n })])],
    ["purchase_return.qty_not_positive", make({}, [line({ qtySsu: 0n })])],
    ["purchase_return.negative_on_hand", make({}, [line({ onHandSsu: -1n, qtySsu: 1n })])],
    ["purchase_return.lot_item_mismatch", make({}, [line({ lot: lot("lot-x", 100n, 1000n, "item-2") })])],
    ["purchase_return.invalid_reason", make({}, [line({ reason: "BAD" as PurchaseReturnReason })])],
    ["purchase_return.duplicate_line", make({}, [line(), line({ lot: lot("lot-2", 10n, 100n) })])],
    ["purchase_return.duplicate_lot", make({}, [line(), line({ lineId: "l2" })])],
    ["purchase_return.rate_required", make({ currency: "USD" })],
    ["purchase_return.rate_required", make({ ...usdHeader, rateScaledSnapshot: 0n })],
    ["purchase_return.credit_currency", make({}, [line({ agreedCreditPerSsu: U(100) })])],
    ["purchase_return.negative_credit", make({}, [line({ agreedCreditPerSsu: Y(-1) })])],
    ["purchase_return.credit_exceeds_cost", make(usdHeader, [usdLine({ agreedCreditPerSsu: U(110) })])],
  ])("rejects with %s", (expected, r) => expect(code(r)).toBe(expected));

  it("accepts 30 of 30 and flags the lot as fully returned; partial return is not flagged", () => {
    const full = unwrap(make({}, [line({ qtySsu: 30n })]));
    expect(full.lines[0]?.lotFullyReturned).toBe(true);
    expect(full.lines[0]?.cost.equals(Y(300_000))).toBe(true);
    const partial = unwrap(make());
    expect(partial.lines[0]?.lotFullyReturned).toBe(false);
    expect(partial.status).toBe("DRAFT");
    expect(partial.entryId).toBeNull();
    expect(partial.returnId).toBe("ret-1");
    expect(partial.header.rateScaledSnapshot).toBeUndefined();
    expect(partial.lines[0]?.note).toBeNull();
    expect(make({}, [line({ note: "broken seal" })]).ok && unwrap(make({}, [line({ note: "x" })])).lines[0]?.note).toBe("x");
  });
});

describe("PurchaseReturn.post", () => {
  it("posts 10 × 100.00 = 1,000.00: Inventory Cr / AP Dr, one negative movement (FR-PUR-116)", () => {
    const posted = unwrap(unwrap(make()).post(opts()));
    expect(posted.purchaseReturn.status).toBe("POSTED");
    expect(posted.purchaseReturn.entryId).toBe("je-1");
    expect(posted.totals.cost.equals(Y(100_000))).toBe(true);
    expect(posted.totals.loss.isZero()).toBe(true);
    expect(posted.movements).toHaveLength(1);
    expect(posted.movements[0]?.absQtySsu).toBe(10n);
    expect(posted.movements[0]?.isInbound()).toBe(false);
    expect(posted.entry.totalDebit.equals(posted.entry.totalCredit)).toBe(true);
    expect(posted.entry.totalDebit.equals(Y(100_000))).toBe(true);
    expect(posted.entry.documentRef).toEqual({ type: PURCHASE_RETURN_DOC_TYPE, id: "ret-1" });
    const ap = posted.entry.lines.find((l) => l.accountCode === "2100");
    expect(ap?.debit.equals(Y(100_000))).toBe(true);
    expect(ap?.foreign).toBeNull();
    expect(posted.entry.lines.some((l) => l.accountCode === "5250")).toBe(false);
    expect(posted.fullyReturnedLotIds).toEqual([]);
    expect(code(posted.purchaseReturn.post(opts()))).toBe("purchase_return.not_draft");
  });

  it("expresses the credit note in USD at the frozen rate: 53,000 YER → 100.00 USD", () => {
    const posted = unwrap(unwrap(make(usdHeader, [usdLine()])).post(opts()));
    expect(posted.totals.creditForeign.equals(U(10_000))).toBe(true);
    expect(posted.totals.creditBase.equals(Y(5_300_000))).toBe(true);
    expect(posted.fullyReturnedLotIds).toEqual(["lot-u"]);
    const ap = posted.entry.lines.find((l) => l.accountCode === "2100");
    expect(ap?.foreign?.amount.equals(U(10_000))).toBe(true);
    expect(ap?.foreign?.rateScaledSnapshot).toBe(530_000_000n);
    expect(posted.entry.totalDebit.equals(posted.entry.totalCredit)).toBe(true);
  });

  it("books a return loss when the agreed credit is below cost: 90 USD = 47,700 → loss 5,300", () => {
    const posted = unwrap(unwrap(make(usdHeader, [usdLine({ agreedCreditPerSsu: U(90) })])).post(opts()));
    expect(posted.totals.creditForeign.equals(U(9_000))).toBe(true);
    expect(posted.totals.creditBase.equals(Y(4_770_000))).toBe(true);
    expect(posted.totals.loss.equals(Y(530_000))).toBe(true);
    expect(posted.entry.lines.find((l) => l.accountCode === "5250")?.debit.equals(Y(530_000))).toBe(true);
    expect(posted.entry.totalDebit.equals(Y(5_300_000))).toBe(true);
    expect(posted.entry.totalCredit.equals(Y(5_300_000))).toBe(true);
  });

  it("with zero agreed credit the whole cost is a loss and no AP line is created", () => {
    const posted = unwrap(unwrap(make({}, [line({ agreedCreditPerSsu: Y(0) })])).post(opts()));
    expect(posted.entry.lines.some((l) => l.accountCode === "2100")).toBe(false);
    expect(posted.entry.lines.find((l) => l.accountCode === "5250")?.debit.equals(Y(100_000))).toBe(true);
    expect(posted.entry.totalDebit.equals(posted.entry.totalCredit)).toBe(true);
  });

  it("rejects posting a return of zero-cost lots only", () => {
    const r = unwrap(make({}, [line({ lot: lot("lot-0", 100n, 0n) })]));
    expect(code(r.post(opts()))).toBe("purchase_return.zero_value");
  });
});
