import { describe, expect, it } from "vitest";
import { Money } from "../money/money.js";
import { unwrap } from "../shared/result.js";
import type { ItemUnit } from "../quantity/quantity.js";
import {
  PO_REOPEN_PERMISSION, PurchaseOrder, computeLineAmounts, effectiveBp, invoiceDiscountOf, lineDiscountOf, suggestReorder,
  type PurchaseOrderLineInput, type PurchaseOrderProps,
} from "./purchase-order.js";

const Y = (minor: number | bigint) => Money.minor(minor, "YER_NEW");
const carton: ItemUnit = {
  unitId: "u-carton", itemId: "item-1", nameAr: "كرتون", nameEn: "Carton", factorToSsu: 120n, level: 1,
  isSsu: false, canSell: false, canPurchase: true, active: true,
};
const poLine = (o: Partial<PurchaseOrderLineInput> = {}): PurchaseOrderLineInput => ({
  lineId: "l1", itemId: "item-1", unit: carton, qtyInUnit: 2n, unitCost: Y(5_000_000), ...o, // 50,000.00 per carton
});
const props = (o: Partial<PurchaseOrderProps> = {}): PurchaseOrderProps => ({
  poId: "po-1", poNo: "PO-1", supplierId: "sup-1", supplierStatus: "ACTIVE", orderDate: "2026-01-05",
  currency: "YER_NEW", baseCurrency: "YER_NEW", lines: [poLine()], ...o,
});
const mk = (o: Partial<PurchaseOrderProps> = {}) => unwrap(PurchaseOrder.create(props(o)));
const posted = (o: Partial<PurchaseOrderProps> = {}) => unwrap(mk(o).submit());
const errCode = (r: { ok: boolean; error?: { code: string } } & object): string => (r as { error: { code: string } }).error.code;

describe("discount helpers", () => {
  it("maps discount values to pricing discounts", () => {
    expect(lineDiscountOf({ mode: "PERCENT", bp: 1000 }).type).toBe("LINE_PERCENT");
    expect(lineDiscountOf({ mode: "AMOUNT", amount: Y(100) }).type).toBe("LINE_AMOUNT");
    expect(invoiceDiscountOf({ mode: "PERCENT", bp: 500 }).type).toBe("INVOICE_PERCENT");
    expect(invoiceDiscountOf({ mode: "AMOUNT", amount: Y(100) }).type).toBe("INVOICE_AMOUNT");
  });
  it("effectiveBp rounds up and handles zero", () => {
    expect(effectiveBp(Y(0), Y(1000))).toBe(0);
    expect(effectiveBp(Y(100), Y(0))).toBe(0);
    expect(effectiveBp(Y(1), Y(3))).toBe(3334);
  });
  it("computeLineAmounts: gross, percent, amount, errors", () => {
    const a = unwrap(computeLineAmounts(Y(5_000_000), 2n, { mode: "PERCENT", bp: 1000 }));
    expect(a.gross.toDecimalString()).toBe("100000.00");
    expect(a.discount.toDecimalString()).toBe("10000.00");
    expect(a.net.toDecimalString()).toBe("90000.00");
    expect(a.discountBp).toBe(1000);
    expect(unwrap(computeLineAmounts(Y(100), 3n, null)).net.amountMinor).toBe(300n);
    expect(errCode(computeLineAmounts(Y(100), 0n, null))).toBe("po.qty_not_positive");
    expect(errCode(computeLineAmounts(Y(-1), 1n, null))).toBe("po.negative_cost");
    expect(errCode(computeLineAmounts(Y(100), 1n, { mode: "AMOUNT", amount: Y(200) }))).toBe("discount.exceeds_line_gross");
  });
});

describe("PurchaseOrder.create", () => {
  it("FR-PUR-103: 2 cartons × 120 = 240 SSU, totals computed", () => {
    const po = mk();
    const l = po.lines[0];
    expect(l?.unit.ssuQty).toBe(240n);
    expect(l?.unit.factorSnapshot).toBe(120n);
    expect(po.totals.total.toDecimalString()).toBe("100000.00");
    expect(po.totals.totalBase.equals(po.totals.total)).toBe(true);
    expect(po.status).toBe("DRAFT");
    expect(Object.isFrozen(po)).toBe(true);
    expect(unwrap(po.remainingSsu("l1"))).toBe(240n);
    expect(errCode(po.remainingSsu("nope"))).toBe("po.line_not_found");
  });
  it("FR-PUR-107: line discount 10,000 then 5% invoice discount = 4,500", () => {
    const po = mk({ lines: [poLine({ discount: { mode: "PERCENT", bp: 1000 } })], invoiceDiscount: { mode: "PERCENT", bp: 500 } });
    expect(po.totals.lineGross.toDecimalString()).toBe("100000.00");
    expect(po.totals.lineDiscount.toDecimalString()).toBe("10000.00");
    expect(po.totals.invoiceDiscount.toDecimalString()).toBe("4500.00");
    expect(po.totals.total.toDecimalString()).toBe("85500.00");
  });
  it("converts foreign totals to base with the indicative rate", () => {
    const po = mk({ currency: "USD", rateScaledSnapshot: 530_000_000n, lines: [poLine({ qtyInUnit: 1n, unitCost: Money.minor(10_000, "USD") })] });
    expect(po.totals.totalBase.toString()).toBe("53000.00 YER_NEW");
  });
  it.each([
    ["po.no_lines", { lines: [] }],
    ["po.supplier_blocked", { supplierStatus: "BLOCKED" }],
    ["po.rate_required", { currency: "USD", lines: [poLine({ unitCost: Money.minor(1, "USD") })] }],
    ["po.invalid_rate", { rateScaledSnapshot: 0n }],
    ["po.duplicate_line", { lines: [poLine(), poLine()] }],
    ["po.unit_item_mismatch", { lines: [poLine({ itemId: "other" })] }],
    ["po.unit_not_purchasable", { lines: [poLine({ unit: { ...carton, canPurchase: false } })] }],
    ["po.currency_mismatch", { lines: [poLine({ unitCost: Money.minor(1, "SAR") })] }],
    ["po.negative_bonus", { lines: [poLine({ expectedBonusSsu: -1n })] }],
    ["qty.not_positive", { lines: [poLine({ qtyInUnit: 0n })] }],
    ["discount.exceeds_invoice_net", { invoiceDiscount: { mode: "AMOUNT", amount: Y(999_999_999) } }],
  ] as const)("rejects %s", (code, over) => {
    expect(errCode(PurchaseOrder.create(props(over as Partial<PurchaseOrderProps>)))).toBe(code);
  });
});

describe("approval (FR-PUR-104)", () => {
  it("150,000 above a 100,000 limit stays PENDING_APPROVAL and cannot be received", () => {
    const po = unwrap(mk({ lines: [poLine({ qtyInUnit: 3n })] }).submit({ maxPoAmount: Y(10_000_000) }));
    expect(po.status).toBe("PENDING_APPROVAL");
    expect(po.approval.reasons).toEqual(["PO_AMOUNT_LIMIT"]);
    expect(po.canReceive()).toBe(false);
    expect(errCode(po.recordReceipt([{ lineId: "l1", qtySsu: 1n }]))).toBe("po.not_receivable");
    const ap = unwrap(po.approve("mgr", "2026-01-06T10:00:00Z"));
    expect(ap.status).toBe("POSTED");
    expect(ap.approval.approvedBy).toBe("mgr");
    expect(errCode(po.approve(" ", "x"))).toBe("po.approver_required");
  });
  it("within limits posts directly; discount above limit needs approval", () => {
    expect(unwrap(mk().submit({ maxPoAmount: Y(10_000_000), maxSupplierDiscountBp: 500 })).status).toBe("POSTED");
    const d = unwrap(mk({ lines: [poLine({ discount: { mode: "PERCENT", bp: 1000 } })] }).submit({ maxSupplierDiscountBp: 500 }));
    expect(d.approval.reasons).toEqual(["DISCOUNT_LIMIT"]);
    const inv = unwrap(mk({ invoiceDiscount: { mode: "PERCENT", bp: 1000 } }).submit({ maxSupplierDiscountBp: 500 }));
    expect(inv.status).toBe("PENDING_APPROVAL");
  });
  it("rejects wrong-currency limit, double submit, approve from DRAFT", () => {
    expect(errCode(mk().submit({ maxPoAmount: Money.minor(1, "USD") }))).toBe("po.limit_currency");
    expect(errCode(posted().submit())).toBe("po.invalid_transition");
    expect(errCode(mk().approve("mgr", "t"))).toBe("po.invalid_transition");
  });
});

describe("receiving, closing, cancelling", () => {
  it("partial then full receipt; tolerance; errors", () => {
    const p1 = unwrap(posted().recordReceipt([{ lineId: "l1", qtySsu: 100n }]));
    expect(p1.status).toBe("PARTIALLY_RECEIVED");
    expect(unwrap(p1.remainingSsu("l1"))).toBe(140n);
    const p2 = unwrap(p1.recordReceipt([{ lineId: "l1", qtySsu: 140n }]));
    expect(p2.status).toBe("RECEIVED");
    expect(p2.canReceive()).toBe(false);
    expect(errCode(p1.recordReceipt([{ lineId: "l1", qtySsu: 141n }]))).toBe("po.over_receipt");
    expect(unwrap(p1.recordReceipt([{ lineId: "l1", qtySsu: 150n }], 500)).lines[0]?.receivedSsu).toBe(250n);
    expect(errCode(p1.recordReceipt([{ lineId: "l1", qtySsu: 1n }], -1))).toBe("po.invalid_tolerance");
    expect(errCode(p1.recordReceipt([{ lineId: "zz", qtySsu: 1n }]))).toBe("po.line_not_found");
    expect(errCode(p1.recordReceipt([{ lineId: "l1", qtySsu: 0n }]))).toBe("po.qty_not_positive");
  });
  it("FR-PUR-112: close keeps remaining 20 non-receivable; reopen needs permission", () => {
    const po = unwrap(posted({ lines: [poLine({ qtyInUnit: 1n })] }).recordReceipt([{ lineId: "l1", qtySsu: 100n }]));
    const closed = unwrap(po.close("supplier out of stock", "u1", "2026-02-01T00:00:00Z"));
    expect(closed.status).toBe("CLOSED");
    expect(closed.closure?.reason).toBe("supplier out of stock");
    expect(unwrap(closed.remainingSsu("l1"))).toBe(20n);
    expect(closed.canReceive()).toBe(false);
    expect(errCode(closed.reopen("purchase_orders.create"))).toBe("po.permission_required");
    const reopened = unwrap(closed.reopen(PO_REOPEN_PERMISSION));
    expect(reopened.status).toBe("PARTIALLY_RECEIVED");
    expect(reopened.closure).toBeNull();
    expect(unwrap(unwrap(posted().close("r", "u", "t")).reopen(PO_REOPEN_PERMISSION)).status).toBe("POSTED");
    expect(errCode(mk().close("r", "u", "t"))).toBe("po.invalid_transition");
    expect(errCode(po.reopen(PO_REOPEN_PERMISSION))).toBe("po.invalid_transition");
  });
  it("cancel from DRAFT/POSTED, never after receipts", () => {
    expect(unwrap(mk().cancel()).status).toBe("CANCELLED");
    expect(unwrap(posted().cancel()).status).toBe("CANCELLED");
    const part = unwrap(posted().recordReceipt([{ lineId: "l1", qtySsu: 1n }]));
    expect(errCode(part.cancel())).toBe("po.cancel_after_receipt");
    expect(errCode(unwrap(mk().cancel()).cancel())).toBe("po.invalid_transition");
  });
});

describe("suggestReorder (FR-PUR-101)", () => {
  const ssu = { unitId: "u-tab", factorToSsu: 1n };
  it("20 on hand, reorder 50, max 100 → 80 SSU", () => {
    const s = unwrap(suggestReorder({ itemId: "i", onHandSsu: 20n, reorderPointSsu: 50n, maxStockSsu: 100n }, ssu));
    expect(s.suggestedQtySsu).toBe(80n);
    expect(s.reason).toBe("BELOW_REORDER_POINT");
  });
  it("no max: target = reorder point + avg daily × lead time (ceil); rounds up to purchase unit", () => {
    const s = unwrap(suggestReorder({ itemId: "i", onHandSsu: 20n, reorderPointSsu: 50n, avgDailySalesSsuMilli: 2500n, leadTimeDays: 7 }, ssu));
    expect(s.targetSsu).toBe(68n);
    expect(s.suggestedQtySsu).toBe(48n);
    const u = unwrap(suggestReorder({ itemId: "i", onHandSsu: 20n, reorderPointSsu: 50n, maxStockSsu: 100n }, { unitId: "u-box", factorToSsu: 12n }));
    expect(u.qtyInUnit).toBe(7n);
    expect(u.suggestedQtySsu).toBe(84n);
  });
  it("above reorder point suggests zero; validation errors", () => {
    expect(unwrap(suggestReorder({ itemId: "i", onHandSsu: 50n, reorderPointSsu: 50n }, ssu)).reason).toBe("ABOVE_REORDER_POINT");
    expect(errCode(suggestReorder({ itemId: "i", onHandSsu: 0n, reorderPointSsu: -1n }, ssu))).toBe("reorder.negative_point");
    expect(errCode(suggestReorder({ itemId: "i", onHandSsu: 0n, reorderPointSsu: 50n, maxStockSsu: 10n }, ssu))).toBe("reorder.max_below_point");
    expect(errCode(suggestReorder({ itemId: "i", onHandSsu: 0n, reorderPointSsu: 5n }, { unitId: "x", factorToSsu: 0n }))).toBe("reorder.bad_factor");
    expect(errCode(suggestReorder({ itemId: "i", onHandSsu: 0n, reorderPointSsu: 5n, leadTimeDays: -1 }, ssu))).toBe("reorder.bad_lead_time");
    expect(errCode(suggestReorder({ itemId: "i", onHandSsu: 0n, reorderPointSsu: 5n, avgDailySalesSsuMilli: -1n }, ssu))).toBe("reorder.negative_sales");
  });
});
