import { describe, expect, it } from "vitest";
import { Money } from "../money/money.js";
import { unwrap } from "../shared/result.js";
import {
  RETURN_PERMISSIONS, SalesReturn, type PostedInvoiceSnapshot, type ReturnWithoutInvoiceRequest, type SalesReturnRequest,
  type SoldLineSnapshot, type SoldLotSnapshot,
} from "./sales-return.js";

const m = (n: number): Money => Money.minor(n, "YER_OLD");
const lot = (lotId: string, qtySsu: bigint, cost: number, o: Partial<SoldLotSnapshot> = {}): SoldLotSnapshot => ({
  lotId, qtySsu, returnedQtySsu: 0n, costMinor: m(cost), expiryDate: "2027-01-01", manualStatus: "NONE", ...o,
});
const line = (o: Partial<SoldLineSnapshot> = {}): SoldLineSnapshot => ({
  lineId: "L1", itemId: "I1", qtySsu: 10n, returnedQtySsu: 0n, netMinor: m(100_000), returnable: true, lots: [lot("A", 10n, 50_000)], ...o,
});
const invoice = (o: Partial<PostedInvoiceSnapshot> = {}): PostedInvoiceSnapshot => ({
  invoiceId: "INV1", status: "POSTED", currency: "YER_OLD", businessDate: "2025-03-01", customerId: "C1", lines: [line()],
  payments: [{ method: "CASH", amount: m(100_000) }], ...o,
});
const req = (o: Partial<SalesReturnRequest> = {}): SalesReturnRequest => ({
  returnId: "R1", invoice: invoice(), businessDate: "2025-03-03", reason: { code: "DAMAGED" }, lines: [{ lineId: "L1", qtySsu: 4n }], permissions: [], ...o,
});
const policy = { defaultReturnWindowDays: 7 };
const create = (o: Partial<SalesReturnRequest> = {}): SalesReturn => unwrap(SalesReturn.create(req(o), policy));

describe("SalesReturn.create", () => {
  it("partial return: proportional refund, cost, same lot, AVAILABLE, frozen draft", () => {
    const r = create();
    expect(r.status).toBe("DRAFT");
    expect(r.invoiceId).toBe("INV1");
    expect(r.refundTotal.amountMinor).toBe(40_000n);
    expect(r.cogsReversal.amountMinor).toBe(20_000n);
    expect(r.lotIntents()).toEqual([{ type: "SALE_RETURN", lineId: "L1", itemId: "I1", lotId: "A", qtySsu: 4n, costMinor: m(20_000), destination: "AVAILABLE" }]);
    expect(r.refunds).toEqual([{ method: "CASH", amount: m(40_000) }]);
    expect(Object.isFrozen(r) && Object.isFrozen(r.lines) && Object.isFrozen(r.lines[0])).toBe(true);
  });

  it("FR-SAL-148: refund uses the original net (900) regardless of today's price", () => {
    const r = create({ invoice: invoice({ lines: [line({ qtySsu: 1n, netMinor: m(90_000), lots: [lot("A", 1n, 60_000)] })], payments: [{ method: "CASH", amount: m(90_000) }] }), lines: [{ lineId: "L1", qtySsu: 1n }] });
    expect(r.refundTotal.amountMinor).toBe(90_000n);
  });

  it("successive partial returns sum exactly to the line net (largest remainder)", () => {
    const ln = (returned: bigint): SoldLineSnapshot => line({ qtySsu: 3n, returnedQtySsu: returned, netMinor: m(100), lots: [lot("A", 3n, 100, { returnedQtySsu: returned })] });
    const refunds = [0n, 1n, 2n].map((ret) => create({ invoice: invoice({ lines: [ln(ret)] }), lines: [{ lineId: "L1", qtySsu: 1n }] }).refundTotal.amountMinor);
    expect(refunds).toEqual([33n, 34n, 33n]);
  });

  it("FR-SAL-149: reverse FEFO — last allocated lot first, original cost, skipping exhausted lots", () => {
    const lots = [lot("A", 10n, 100_000), lot("B", 5n, 60_000), lot("C", 2n, 20_000, { returnedQtySsu: 2n })];
    const r = create({ invoice: invoice({ lines: [line({ qtySsu: 17n, returnedQtySsu: 2n, netMinor: m(170_000), lots })] }), lines: [{ lineId: "L1", qtySsu: 7n }] });
    expect(r.lotIntents().map((l) => [l.lotId, l.qtySsu, l.costMinor.amountMinor])).toEqual([["B", 5n, 60_000n], ["A", 2n, 20_000n]]);
    expect(r.refundTotal.amountMinor).toBe(70_000n);
  });

  it.each([
    ["expired lot", { expiryDate: "2025-03-03" }, "QUARANTINED"],
    ["recalled/blocked lot", { manualStatus: "BLOCKED" as const }, "QUARANTINED"],
    ["healthy lot", {}, "AVAILABLE"],
  ])("destination for %s", (_l, o, expected) => {
    const r = create({ invoice: invoice({ lines: [line({ lots: [lot("A", 10n, 50_000, o)] })] }) });
    expect(r.lotIntents()[0]?.destination).toBe(expected);
  });

  it("FR-SAL-150: non-returnable needs permission and goes to BLOCKED", () => {
    const inv = invoice({ lines: [line({ returnable: false })] });
    const denied = SalesReturn.create(req({ invoice: inv }), policy);
    expect(!denied.ok && denied.error.code).toBe("return.non_returnable");
    const r = create({ invoice: inv, permissions: [RETURN_PERMISSIONS.nonReturnable] });
    expect(r.lotIntents()[0]?.destination).toBe("BLOCKED");
  });

  it("FR-SAL-151: late return needs returns.late; item window overrides default", () => {
    const late = SalesReturn.create(req({ businessDate: "2025-03-11" }), policy);
    expect(!late.ok && late.error.code).toBe("return.window_expired");
    expect(create({ businessDate: "2025-03-11", permissions: [RETURN_PERMISSIONS.late] }).status).toBe("DRAFT");
    expect(create({ businessDate: "2025-03-11", invoice: invoice({ lines: [line({ returnWindowDays: 30 })] }) }).status).toBe("DRAFT");
  });

  it("FR-SAL-153: credit invoice → refund reduces the debt, no cash", () => {
    const r = create({ invoice: invoice({ payments: [{ method: "CREDIT", amount: m(100_000) }] }), lines: [{ lineId: "L1", qtySsu: 2n }] });
    expect(r.refunds).toEqual([{ method: "CREDIT", amount: m(20_000) }]);
  });

  it("mixed payments: credit first, then proportional over cash/card; customer-credit option", () => {
    const payments = [{ method: "CREDIT" as const, amount: m(10_000) }, { method: "CASH" as const, amount: m(54_000) }, { method: "CARD" as const, amount: m(36_000) }];
    const r = create({ invoice: invoice({ payments }) });
    expect(r.refunds).toEqual([{ method: "CREDIT", amount: m(10_000) }, { method: "CASH", amount: m(18_000) }, { method: "CARD", amount: m(12_000) }]);
    const cc = create({ invoice: invoice({ payments }), refundToCustomerCredit: true });
    expect(cc.refunds).toEqual([{ method: "CREDIT", amount: m(10_000) }, { method: "CUSTOMER_CREDIT", amount: m(30_000) }]);
  });

  it("no recorded tenders → customer credit; zero refund → no tenders", () => {
    expect(create({ invoice: invoice({ payments: [] }) }).refunds).toEqual([{ method: "CUSTOMER_CREDIT", amount: m(40_000) }]);
    expect(create({ invoice: invoice({ lines: [line({ netMinor: m(0) })], payments: [] }) }).refunds).toEqual([]);
  });

  const errors: readonly [string, Partial<SalesReturnRequest>, string][] = [
    ["draft invoice", { invoice: invoice({ status: "DRAFT" }) }, "return.invoice_not_posted"],
    ["blank reason", { reason: { code: " " } }, "return.reason_required"],
    ["no lines", { lines: [] }, "return.no_lines"],
    ["before sale", { businessDate: "2025-02-28" }, "return.before_sale"],
    ["duplicate line", { lines: [{ lineId: "L1", qtySsu: 1n }, { lineId: "L1", qtySsu: 1n }] }, "return.duplicate_line"],
    ["unknown line", { lines: [{ lineId: "L9", qtySsu: 1n }] }, "return.unknown_line"],
    ["zero qty", { lines: [{ lineId: "L1", qtySsu: 0n }] }, "return.non_positive_qty"],
    ["FR-SAL-147: sold 10 returned 4 → max 6", { invoice: invoice({ lines: [line({ returnedQtySsu: 4n, lots: [lot("A", 10n, 50_000, { returnedQtySsu: 4n })] })] }), lines: [{ lineId: "L1", qtySsu: 7n }] }, "return.qty_exceeds_returnable"],
    ["inconsistent lots", { invoice: invoice({ lines: [line({ lots: [lot("A", 8n, 50_000)] })] }) }, "return.inconsistent_lots"],
    ["line currency mismatch", { invoice: invoice({ lines: [line({ netMinor: Money.minor(1, "SAR") })] }) }, "return.currency_mismatch"],
    ["payment currency mismatch", { invoice: invoice({ payments: [{ method: "CASH", amount: Money.minor(1, "SAR") }] }) }, "return.currency_mismatch"],
    ["negative payment", { invoice: invoice({ payments: [{ method: "CASH", amount: m(-1) }] }) }, "return.negative_payment"],
    ["qty too large (after)", { invoice: invoice({ lines: [line({ qtySsu: 2n ** 60n, lots: [lot("A", 2n ** 60n, 1)] })] }), lines: [{ lineId: "L1", qtySsu: 1n }] }, "return.qty_too_large"],
    ["qty too large (before)", { invoice: invoice({ lines: [line({ qtySsu: 2n ** 60n + 2n, returnedQtySsu: 2n ** 60n, lots: [lot("A", 2n ** 60n + 2n, 1, { returnedQtySsu: 2n ** 60n })] })] }), lines: [{ lineId: "L1", qtySsu: 1n }] }, "return.qty_too_large"],
    ["payments too large", { invoice: invoice({ payments: [{ method: "CASH", amount: m(1) }, { method: "CARD", amount: Money.minor(2n ** 60n, "YER_OLD") }] }) }, "return.amount_too_large"],
  ];
  it.each(errors)("rejects %s", (_l, o, code) => {
    const r = SalesReturn.create(req(o), policy);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe(code);
  });
});

describe("SalesReturn.createWithoutInvoice", () => {
  const base: ReturnWithoutInvoiceRequest = {
    returnId: "R2", itemId: "I1", newLotId: "Q1", qtySsu: 3n, currentPriceSsu: m(110_000), lastSalePriceSsu: m(90_000), unitCostSsu: m(60_000),
    businessDate: "2025-03-03", reason: { code: "NO_INVOICE" }, permissions: [RETURN_PERMISSIONS.withoutInvoice],
  };
  it("FR-SAL-152: min(current, last) price, quarantined new lot, cash refund", () => {
    const r = unwrap(SalesReturn.createWithoutInvoice(base));
    expect(r.invoiceId).toBeNull();
    expect(r.customerId).toBeNull();
    expect(r.refundTotal.amountMinor).toBe(270_000n);
    expect(r.cogsReversal.amountMinor).toBe(180_000n);
    expect(r.lotIntents()[0]).toMatchObject({ lotId: "Q1", lineId: null, qtySsu: 3n, destination: "QUARANTINED" });
    expect(r.refunds).toEqual([{ method: "CASH", amount: m(270_000) }]);
    const cc = unwrap(SalesReturn.createWithoutInvoice({ ...base, refundToCustomerCredit: true, customerId: "C9" }));
    expect(cc.refunds[0]?.method).toBe("CUSTOMER_CREDIT");
    expect(cc.customerId).toBe("C9");
    expect(unwrap(SalesReturn.createWithoutInvoice({ ...base, currentPriceSsu: m(0) })).refunds).toEqual([]);
  });
  it.each([
    ["no permission", { permissions: [] }, "return.permission_required"],
    ["blank reason", { reason: { code: "" } }, "return.reason_required"],
    ["zero qty", { qtySsu: 0n }, "return.non_positive_qty"],
    ["currency mismatch", { unitCostSsu: Money.minor(1, "SAR") }, "return.currency_mismatch"],
    ["negative price", { lastSalePriceSsu: m(-1) }, "return.negative_amount"],
  ] as const)("rejects %s", (_l, o, code) => {
    const r = SalesReturn.createWithoutInvoice({ ...base, ...o });
    expect(!r.ok && r.error.code).toBe(code);
  });
});

describe("SalesReturn.post / postingIntent", () => {
  it("posts once, keeps the draft immutable, exposes the posting intent", () => {
    const draft = create();
    expect(!draft.postingIntent().ok).toBe(true);
    const posted = unwrap(draft.post());
    expect(draft.status).toBe("DRAFT");
    expect(posted.status).toBe("POSTED");
    expect(posted.returnId).toBe("R1");
    const again = posted.post();
    expect(!again.ok && again.error.code).toBe("return.already_posted");
    const intent = unwrap(posted.postingIntent());
    expect(intent).toEqual({
      documentRef: { type: "SALES_RETURN", id: "R1" }, refundTotal: m(40_000), cogsReversal: m(20_000),
      lotCosts: [{ itemId: "I1", lotId: "A", cost: m(20_000) }], refunds: [{ method: "CASH", amount: m(40_000) }],
    });
    const notPosted = draft.postingIntent();
    expect(!notPosted.ok && notPosted.error.code).toBe("return.not_posted");
  });
});
