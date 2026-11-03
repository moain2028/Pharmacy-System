import { describe, expect, it } from "vitest";
import { Money } from "../money/money.js";
import { unwrap } from "../shared/result.js";
import type { ItemUnit } from "../quantity/quantity.js";
import { PurchaseOrder } from "./purchase-order.js";
import {
  GoodsReceipt, NO_EXPIRY_DATE, parseGs1Expiry,
  type GoodsReceiptLineInput, type GoodsReceiptProps, type PostGoodsReceiptOptions,
} from "./goods-receipt.js";

const Y = (minor: number | bigint) => Money.minor(minor, "YER_NEW");
const tab: ItemUnit = {
  unitId: "u-tab", itemId: "item-1", nameAr: "حبة", nameEn: "Tablet", factorToSsu: 1n, level: 2,
  isSsu: true, canSell: true, canPurchase: true, active: true,
};
const line = (o: Partial<GoodsReceiptLineInput> = {}): GoodsReceiptLineInput => ({
  lineId: "l1", itemId: "item-1", trackExpiry: true, lotNumber: "B-100", expiryDate: "2027-06-30", unit: tab, qtyInUnit: 100n,
  unitCost: Y(10_000), sourceType: "OFFICIAL", ...o, // 100.00 per tablet
});
const props = (o: Partial<GoodsReceiptProps> = {}): GoodsReceiptProps => ({
  grnId: "grn-1", grnNo: "GRN-0001", tenantId: "t1", supplierId: "sup-1", locationId: "wh-1", receivedAt: "2026-01-10T08:00:00Z",
  businessDate: "2026-01-10", currency: "YER_NEW", baseCurrency: "YER_NEW", lines: [line()], ...o,
});
const opts = (o: Partial<PostGoodsReceiptOptions> = {}): PostGoodsReceiptOptions => {
  let n = 0;
  return { entryId: "je-1", newId: () => `id-${++n}`, accounts: { grni: "2150", ap: "2100" }, postedAt: new Date("2026-01-10T08:00:00Z"), ...o };
};
const errCode = (r: { ok: boolean }): string => (r as { error: { code: string } }).error.code;
const post = (p: Partial<GoodsReceiptProps> = {}, o: Partial<PostGoodsReceiptOptions> = {}) => unwrap(unwrap(GoodsReceipt.create(props(p))).post(opts(o)));

describe("parseGs1Expiry", () => {
  it.each([["270315", "2027-03-15"], ["261200", "2026-12-31"], ["280200", "2028-02-29"]])("%s → %s", (raw, iso) => {
    expect(unwrap(parseGs1Expiry(raw))).toBe(iso);
  });
  it.each(["27031", "271315", "abcdef"])("rejects %s", (raw) => {
    expect(parseGs1Expiry(raw).ok).toBe(false);
  });
});

describe("GoodsReceipt.create", () => {
  it("builds lines with snapshots, normalised lot number and sentinel expiry", () => {
    const g = unwrap(GoodsReceipt.create(props({ lines: [line({ trackExpiry: false, expiryDate: undefined, lotNumber: " b-100 " })] })));
    expect(g.status).toBe("DRAFT");
    expect(g.lines[0]?.expiryDate).toBe(NO_EXPIRY_DATE);
    expect(g.lines[0]?.lotNumber.trim()).not.toBe("");
    expect(g.lines[0]?.net.toDecimalString()).toBe("10000.00");
    expect(Object.isFrozen(g)).toBe(true);
  });
  it("warnings: public price mismatch and short shelf life", () => {
    const g = unwrap(GoodsReceipt.create(props({
      minShelfLifeDays: 365,
      lines: [line({ expiryDate: "2026-06-30", printedPublicPrice: Y(50_000), officialPublicPrice: Y(45_000) })],
    })));
    expect(g.warnings.map((w) => w.code).sort()).toEqual(["PUBLIC_PRICE_MISMATCH", "SHORT_SHELF_LIFE"]);
    expect(unwrap(GoodsReceipt.create(props({ lines: [line({ printedPublicPrice: Y(1), officialPublicPrice: Y(1) })] }))).warnings).toEqual([]);
  });
  it.each([
    ["grn.no_lines", { lines: [] }],
    ["grn.rate_required", { currency: "USD", lines: [line({ unitCost: Money.minor(1, "USD") })] }],
    ["grn.rate_required", { currency: "USD", rateScaledSnapshot: 0n, lines: [line({ unitCost: Money.minor(1, "USD") })] }],
    ["grn.invalid_bonus_policy", { bonusCostPolicy: "HALF" }],
    ["grn.duplicate_line", { lines: [line(), line()] }],
    ["grn.unit_item_mismatch", { lines: [line({ itemId: "x" })] }],
    ["grn.unit_not_purchasable", { lines: [line({ unit: { ...tab, canPurchase: false } })] }],
    ["grn.currency_mismatch", { lines: [line({ unitCost: Money.minor(1, "SAR") })] }],
    ["grn.negative_bonus", { lines: [line({ bonusSsu: -1n })] }],
    ["grn.invalid_lot_number", { lines: [line({ lotNumber: "   " })] }],
    ["grn.expiry_required", { lines: [line({ expiryDate: undefined })] }],
    ["grn.expired_at_receipt", { lines: [line({ expiryDate: "2026-01-10" })] }],
    ["qty.not_positive", { lines: [line({ qtyInUnit: 0n })] }],
    ["discount.exceeds_line_gross", { lines: [line({ discount: { mode: "AMOUNT", amount: Y(99_999_999) } })] }],
  ] as const)("rejects %s", (code, over) => {
    expect(errCode(GoodsReceipt.create(props(over as unknown as Partial<GoodsReceiptProps>)))).toBe(code);
  });
});

describe("GoodsReceipt.post", () => {
  it("FR-PUR-113: 100 × 100.00 → Inventory Dr 10,000 / GRNI Cr 10,000, one lot, one RECEIPT movement", () => {
    const r = post();
    expect(r.receipt.status).toBe("POSTED");
    expect(r.receipt.entryId).toBe("je-1");
    expect(r.lots).toHaveLength(1);
    expect(r.lots[0]?.qtyReceivedSsu).toBe(100n);
    expect(r.lots[0]?.totalCostMinor.toDecimalString()).toBe("10000.00");
    expect(r.lots[0]?.supplierId).toBe("sup-1");
    expect(r.movements).toHaveLength(1);
    expect(r.movements[0]?.absQtySsu).toBe(100n);
    expect(r.movements[0]?.isInbound()).toBe(true);
    expect(r.entry.totalDebit.toDecimalString()).toBe("10000.00");
    expect(r.entry.totalCredit.equals(r.entry.totalDebit)).toBe(true);
    const grni = r.entry.lines.find((l) => l.accountCode === "2150");
    expect(grni?.credit.toDecimalString()).toBe("10000.00");
    expect(grni?.foreign).toBeNull();
    expect(r.po).toBeNull();
    expect(r.lineCosts[0]?.unitCostBase.toDecimalString()).toBe("100.00");
  });
  it("credits AP when requested", () => {
    const r = post({}, { creditTo: "AP" });
    expect(r.entry.lines.some((l) => l.accountCode === "2100" && l.credit.amountMinor === 1_000_000n)).toBe(true);
  });
  it("FR-PUR-106: 100 paid + 20 bonus for 10,000 → 83.33 per tablet (spread policy)", () => {
    const r = post({ lines: [line({ bonusSsu: 20n })] });
    expect(r.lots).toHaveLength(1);
    expect(r.lots[0]?.qtyReceivedSsu).toBe(120n);
    expect(r.lineCosts[0]?.unitCostBase.toDecimalString()).toBe("83.33");
    expect(r.movements[0]?.absQtySsu).toBe(120n);
  });
  it("ZERO_COST policy: separate zero-cost bonus lot, paid lot carries the full cost", () => {
    const r = post({ bonusCostPolicy: "ZERO_COST", lines: [line({ bonusSsu: 20n })] });
    expect(r.lots.map((l) => [l.qtyReceivedSsu, l.totalCostMinor.amountMinor])).toEqual([[100n, 1_000_000n], [20n, 0n]]);
    expect(r.movements).toHaveLength(2);
    expect(r.lineCosts[0]?.unitCostBase.toDecimalString()).toBe("100.00");
    expect(r.entry.totalDebit.toDecimalString()).toBe("10000.00");
    expect(post({ bonusCostPolicy: "ZERO_COST" }).lots).toHaveLength(1);
  });
  it("FR-PUR-108: freight 10,000 over 30,000 / 70,000 BY_VALUE → 3,000 / 7,000; BY_QTY splits by SSU", () => {
    const two = [line({ unitCost: Y(30_000) }), line({ lineId: "l2", lotNumber: "B-200", unitCost: Y(70_000) })];
    const r = post({ lines: two, landedCosts: [{ expenseType: "FREIGHT", amount: Y(1_000_000), method: "BY_VALUE", creditAccountCode: "2100" }] }); // freight payable → AP
    expect(r.lineCosts.map((c) => c.landedBase.toDecimalString())).toEqual(["3000.00", "7000.00"]);
    expect(r.lots.map((l) => l.totalCostMinor.toDecimalString())).toEqual(["33000.00", "77000.00"]);
    expect(r.entry.totalDebit.toDecimalString()).toBe("110000.00");
    expect(r.entry.lines.find((l) => l.accountCode === "2150")?.credit.toDecimalString()).toBe("100000.00"); // goods → GRNI
    expect(r.entry.lines.find((l) => l.accountCode === "2100")?.credit.toDecimalString()).toBe("10000.00"); // freight → AP
    const q = post({ lines: two, landedCosts: [{ expenseType: "CUSTOMS", amount: Y(1_000_000), method: "BY_QTY", creditAccountCode: "2150" }] });
    expect(q.lineCosts.map((c) => c.landedBase.toDecimalString())).toEqual(["5000.00", "5000.00"]);
  });
  it.each([
    ["grn.landed_currency", { expenseType: "OTHER", amount: Money.minor(1, "USD"), method: "BY_VALUE", creditAccountCode: "x" }],
    ["grn.landed_not_positive", { expenseType: "OTHER", amount: Y(0), method: "BY_VALUE", creditAccountCode: "x" }],
  ] as const)("landed cost rejects %s", (code, lc) => {
    expect(errCode(unwrap(GoodsReceipt.create(props({ landedCosts: [lc] }))).post(opts()))).toBe(code);
  });
  it("FR-PUR-107 + FR-PUR-110: line/invoice discounts then frozen FX rate 530 → 53,000 YER", () => {
    const r = post({
      currency: "USD", rateScaledSnapshot: 530_000_000n, invoiceDiscount: { mode: "PERCENT", bp: 500 },
      lines: [line({ qtyInUnit: 1n, unitCost: Money.minor(10_000, "USD") })], // 100 USD
    });
    expect(r.lineCosts[0]?.netBase.toString()).toBe("50350.00 YER_NEW"); // 95 USD × 530
    const grni = r.entry.lines.find((l) => l.accountCode === "2150");
    expect(grni?.foreign?.amount.toString()).toBe("95.00 USD");
    expect(grni?.foreign?.rateScaledSnapshot).toBe(530_000_000n);
    expect(r.entry.totalDebit.equals(r.entry.totalCredit)).toBe(true);
    const plain = post({ currency: "USD", rateScaledSnapshot: 530_000_000n, lines: [line({ qtyInUnit: 1n, unitCost: Money.minor(10_000, "USD") })] });
    expect(plain.lineCosts[0]?.totalBase.toString()).toBe("53000.00 YER_NEW");
  });
  it("FR-PUR-105: two expiry dates → two FEFO-able lots", () => {
    const r = post({ lines: [line({ qtyInUnit: 6n }), line({ lineId: "l2", qtyInUnit: 4n, expiryDate: "2026-09-30" })] });
    expect(r.lots.map((l) => [l.expiryDate, l.qtyReceivedSsu])).toEqual([["2027-06-30", 6n], ["2026-09-30", 4n]]);
  });
  it("PO link: partial receipt updates PO; over-receipt rejected unless within tolerance", () => {
    const po = unwrap(unwrap(PurchaseOrder.create({
      poId: "po-1", poNo: "PO-1", supplierId: "sup-1", supplierStatus: "ACTIVE", orderDate: "2026-01-01", currency: "YER_NEW", baseCurrency: "YER_NEW",
      lines: [{ lineId: "p1", itemId: "item-1", unit: tab, qtyInUnit: 100n, unitCost: Y(10_000) }],
    })).submit());
    const r = post({ poId: "po-1", lines: [line({ qtyInUnit: 80n, poLineId: "p1" })] }, { po });
    expect(r.po?.status).toBe("PARTIALLY_RECEIVED");
    expect(r.po?.lines[0]?.receivedSsu).toBe(80n);
    const over = unwrap(GoodsReceipt.create(props({ poId: "po-1", lines: [line({ qtyInUnit: 110n, poLineId: "p1" })] })));
    expect(errCode(over.post(opts({ po })))).toBe("po.over_receipt");
    expect(unwrap(over.post(opts({ po, overReceiptToleranceBp: 1000 }))).po?.status).toBe("RECEIVED");
    expect(errCode(over.post(opts()))).toBe("grn.po_missing");
    const noRef = unwrap(GoodsReceipt.create(props({ poId: "po-1" })));
    expect(errCode(noRef.post(opts({ po })))).toBe("grn.po_line_required");
  });
  it("cannot post twice; invoice discount larger than net is rejected at post", () => {
    const r = post();
    expect(errCode(r.receipt.post(opts()))).toBe("grn.not_draft");
    const g = unwrap(GoodsReceipt.create(props({ invoiceDiscount: { mode: "AMOUNT", amount: Y(99_999_999) } })));
    expect(errCode(g.post(opts()))).toBe("discount.exceeds_invoice_net");
  });
});
