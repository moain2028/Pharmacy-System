import { describe, expect, it } from "vitest";
import type { FefoResult } from "../inventory/fefo.js";
import { Lot } from "../inventory/lot.js";
import { Money } from "../money/money.js";
import type { ItemUnit } from "../quantity/quantity.js";
import { unwrap, type Result } from "../shared/result.js";
import { SALES_PERMISSIONS } from "./sale-guards.js";
import { SalesInvoice, type PostContext, type SalesInvoiceHeader, type SalesLineInput } from "./sales-invoice.js";

const C = "YER_OLD" as const;
const m = (x: bigint): Money => Money.minor(x, C);
const code = (r: Result<unknown>): string => (r.ok ? "OK" : r.error.code);
const BD = "2026-01-15";
const BOX: ItemUnit = {
  unitId: "box", itemId: "I1", nameAr: "box-ar", nameEn: "Box", factorToSsu: 10n, level: 1,
  isSsu: false, canSell: true, canPurchase: true, active: true,
};
const header: SalesInvoiceHeader = {
  invoiceId: "INV1", tenantId: "T1", clientUuid: "CU1", currency: C, customerId: "CUS1", locationId: "LOC1",
  cashierId: "U1", createdAt: "2026-01-15T08:00:00Z",
};
const lineInput = (over: Partial<SalesLineInput> = {}): SalesLineInput => ({
  lineId: "L1", itemId: "I1", itemNameAr: "drug-ar", itemNameEn: "Drug", itemActive: true, unit: BOX, qtyInUnit: 10n,
  unitPrice: m(10000n), priceSource: "UNIT", regulatedUnitPriceSnapshot: m(12000n), minUnitPrice: null,
  discounts: [{ type: "LINE_AMOUNT", source: "manual", amount: m(10000n) }], taxBp: 0,
  rx: { rxRequired: "NONE", controlledClass: "NONE" }, ...over,
});
const mkLot = (id: string, cost: bigint): Lot => unwrap(Lot.create({
  lotId: id, itemId: "I1", lotNumber: id, expiryDate: "2027-12-31", qtyReceivedSsu: 50n,
  totalCostMinor: m(cost), sourceType: "OFFICIAL",
}));
const LOTS = new Map([["A", mkLot("A", 30000n)], ["B", mkLot("B", 40000n)]]);
const fefo = (allocs: [string, bigint][], shortfall = 0n, expiryDate = "2027-12-31"): FefoResult => ({
  allocations: allocs.map(([lotId, qtySsu]) => ({
    lotId, expiryDate, qtySsu, costMinor: m(0n), status: "AVAILABLE" as const, viaOverride: false,
  })),
  shortfallSsu: shortfall, skippedLotIds: [], override: null,
});
const blankInv = (h: SalesInvoiceHeader = header): SalesInvoice => unwrap(SalesInvoice.create(h));
const withLine = (over: Partial<SalesLineInput> = {}, allocate = true, h: SalesInvoiceHeader = header): SalesInvoice => {
  const inv = unwrap(blankInv(h).addLine(lineInput(over)));
  return allocate ? unwrap(inv.assignLots("L1", fefo([["A", 50n], ["B", 50n]]), LOTS, BD)) : inv;
};
const ctx: PostContext = { docNo: "S1-2026-000001", businessDate: BD, postedAt: new Date("2026-01-15T09:00:00Z") };

describe("SalesInvoice.create", () => {
  it.each(["invoiceId", "customerId", "cashierId"] as const)("requires %s", (k) => {
    expect(code(SalesInvoice.create({ ...header, [k]: " " }))).toBe("sales.invalid_header");
  });
  it("rejects bad createdAt and starts in DRAFT", () => {
    expect(code(SalesInvoice.create({ ...header, createdAt: "nope" }))).toBe("sales.invalid_header");
    const inv = blankInv();
    expect([inv.state, inv.lines.length, inv.header.invoiceId, inv.posting]).toEqual(["DRAFT", 0, "INV1", null]);
  });
});

describe("draft editing", () => {
  it("adds a line with unit snapshot (factorSnapshot, SSU qty)", () => {
    const l = withLine({ lineNote: "1 tab / 8h" }, false).lines[0];
    expect([l?.unit.factorSnapshot, l?.unit.ssuQty, l?.lineNote, l?.allocations.length]).toEqual([10n, 100n, "1 tab / 8h", 0]);
    expect(Object.isFrozen(l)).toBe(true);
  });
  const addCases: [string, Partial<SalesLineInput>, string][] = [
    ["currency", { unitPrice: Money.minor(1n, "SAR") }, "sales.currency_mismatch"],
    ["official currency", { regulatedUnitPriceSnapshot: Money.minor(1n, "USD") }, "sales.currency_mismatch"],
    ["negative", { unitPrice: m(-1n) }, "sales.negative_price"],
    ["inactive", { itemActive: false }, "sales.item_inactive"],
    ["unit item", { itemId: "I2" }, "sales.unit_item_mismatch"],
    ["unit sell", { unit: { ...BOX, canSell: false } }, "sales.unit_not_sellable"],
    ["note", { lineNote: "x".repeat(121) }, "sales.line_note_too_long"],
    ["qty", { qtyInUnit: 0n }, "qty.not_positive"],
  ];
  it.each(addCases)("addLine rejects %s", (_n, over, expected) => {
    expect(code(blankInv().addLine(lineInput(over)))).toBe(expected);
  });
  it("rejects duplicates, removes lines, sets invoice discount and prescription", () => {
    const inv = withLine({}, false);
    expect(code(inv.addLine(lineInput()))).toBe("sales.duplicate_line");
    expect(code(inv.removeLine("X"))).toBe("sales.line_not_found");
    expect(unwrap(inv.removeLine("L1")).lines.length).toBe(0);
    const d = unwrap(inv.setInvoiceDiscount({ type: "INVOICE_AMOUNT", source: "m", amount: m(9000n) }));
    expect(d.invoiceDiscount?.type).toBe("INVOICE_AMOUNT");
    expect(unwrap(d.computeTotals()).net.amountMinor).toBe(81000n);
    const p = unwrap(d.setPrescription({ patientName: "P", doctorName: "D", rxNumber: "R", rxDate: BD }));
    expect(p.prescription?.rxNumber).toBe("R");
    expect(unwrap(p.setPrescription(null)).prescription).toBeNull();
  });
});

describe("assignLots (FEFO result, COGS via Lot.costForSsu)", () => {
  it("stores allocations with exact lot cost", () => {
    const l = withLine().lines[0];
    expect(l?.allocations.map((a) => [a.lotId, a.qtySsu, a.cost.amountMinor])).toEqual([["A", 50n, 30000n], ["B", 50n, 40000n]]);
  });
  const inv = withLine({}, false);
  it.each([
    ["shortfall", "L1", fefo([["A", 50n]], 50n), "sales.insufficient_stock"],
    ["mismatch", "L1", fefo([["A", 40n]]), "sales.allocation_mismatch"],
    ["zero qty", "L1", fefo([["A", 100n], ["B", 0n]]), "sales.allocation_mismatch"],
    ["unknown lot", "L1", fefo([["Z", 100n]]), "sales.lot_unknown"],
    ["expired", "L1", fefo([["A", 100n]], 0n, "2026-01-01"), "sales.lot_expired"],
    ["line", "NOPE", fefo([["A", 100n]]), "sales.line_not_found"],
  ] as const)("rejects %s", (_n, lineId, f, expected) => {
    expect(code(inv.assignLots(lineId, f, LOTS, BD))).toBe(expected);
  });
});

describe("lifecycle", () => {
  it("HELD releases allocations and blocks editing; resume returns to DRAFT", () => {
    expect(code(withLine().hold("x".repeat(41)))).toBe("sales.hold_label_too_long");
    const held = unwrap(withLine().hold(" Ahmed "));
    expect([held.state, held.holdLabel, held.lines[0]?.allocations.length]).toEqual(["HELD", "Ahmed", 0]);
    expect(code(held.addLine(lineInput({ lineId: "L2" })))).toBe("sales.invalid_transition");
    expect(code(held.post(ctx))).toBe("sales.invalid_transition");
    const resumed = unwrap(held.resume());
    expect([resumed.state, resumed.holdLabel]).toEqual(["DRAFT", null]);
    expect(unwrap(withLine().hold()).holdLabel).toBeNull();
  });
  it("approval flow", () => {
    expect(code(withLine().requestApproval(" "))).toBe("sales.reason_required");
    const pending = unwrap(withLine().requestApproval("discount above limit"));
    expect([pending.state, pending.statusReason]).toEqual(["PENDING_APPROVAL", "discount above limit"]);
    expect(code(pending.approve(""))).toBe("sales.approver_required");
    expect(unwrap(pending.approve("SUP")).approvedBy).toBe("SUP");
    const rejected = unwrap(pending.reject("SUP"));
    expect([rejected.state, rejected.approvedBy]).toEqual(["DRAFT", null]);
    expect(code(withLine().approve("SUP"))).toBe("sales.invalid_transition");
  });
  it("cancel and reverse", () => {
    expect(code(withLine().cancel(""))).toBe("sales.reason_required");
    expect(unwrap(unwrap(withLine().hold()).cancel("customer left")).state).toBe("CANCELLED");
    const posted = unwrap(withLine().post(ctx));
    expect(code(posted.cancel("x"))).toBe("sales.invalid_transition");
    expect(code(posted.setInvoiceDiscount(null))).toBe("sales.invalid_transition");
    expect(code(posted.reverse({ reversedBy: "U1", reason: "err", permissions: [] }))).toBe("sales.permission_denied");
    expect(code(posted.reverse({ reversedBy: "U1", reason: " ", permissions: [SALES_PERMISSIONS.reverse] }))).toBe("sales.reason_required");
    const rev = unwrap(posted.reverse({ reversedBy: "U1", reason: "wrong item", permissions: [SALES_PERMISSIONS.reverse] }));
    expect(rev.state).toBe("REVERSED");
    expect(code(withLine().reverse({ reversedBy: "U1", reason: "x", permissions: [SALES_PERMISSIONS.reverse] }))).toBe("sales.invalid_transition");
  });
});

describe("post + toPostingIntent", () => {
  it("FR-SAL-122: gross 1000, discount 100, cost 700 -> profit 200; SALE movements per lot", () => {
    const credit = { customer: { customerId: "CUS1", isWalkIn: false, creditBlocked: false, creditLimit: m(5_000_000n),
      outstanding: m(0n), oldestOverdueDays: 0, maxOverdueDays: null }, creditPortion: m(100n) };
    const inv = withLine();
    expect(code(inv.toPostingIntent())).toBe("sales.not_posted");
    const posted = unwrap(inv.post({ ...ctx, credit }));
    expect([posted.state, posted.posting?.docNo, posted.posting?.warnings.length]).toEqual(["POSTED", "S1-2026-000001", 0]);
    const intent = unwrap(posted.toPostingIntent());
    expect(intent.movements.map((x) => [x.type, x.lotId, x.qtyDeltaSsu, x.costMinor.amountMinor, x.unitCostSnapshot.amountMinor]))
      .toEqual([["SALE", "A", -50n, 30000n, 600n], ["SALE", "B", -50n, 40000n, 800n]]);
    expect(intent.movements[0]?.documentRef).toEqual({ docType: "SALES_INVOICE", docId: "INV1", lineId: "L1" });
    const a = intent.accounting;
    expect([a.gross, a.discountTotal, a.net, a.cogsTotal, a.total].map((x) => x.amountMinor)).toEqual([100000n, 10000n, 90000n, 70000n, 90000n]);
    expect(a.grossProfit?.amountMinor).toBe(20000n);
    expect(a.cogs.map((c) => c.lotId)).toEqual(["A", "B"]);
  });
});
