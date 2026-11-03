import { describe, expect, it } from "vitest";
import { Money } from "../money/money.js";
import { unwrap } from "../shared/result.js";
import type { JournalEntry } from "../accounting/journal-entry.js";
import {
  MATCH_OVERRIDE_PERMISSION, SupplierInvoice, addDaysIso, varianceBp,
  type GrnLineRef, type SupplierInvoiceLineInput, type SupplierInvoiceProps,
} from "./supplier-invoice.js";

const Y = (n: number | bigint): Money => Money.minor(n, "YER_NEW");
const ACC = { ap: "2100", grni: "2150", priceVariance: "5150", tax: "1500", direct: "1400" };
const ref = (o: Partial<GrnLineRef> = {}): GrnLineRef => ({
  grnId: "G", grnLineId: "g1", itemId: "i1", receivedSsu: 100n, factor: 1n, unitCost: Y(10_000), grniBase: Y(1_000_000), ...o,
});
const line = (o: Partial<SupplierInvoiceLineInput> = {}): SupplierInvoiceLineInput => ({
  lineId: "L1", itemId: "i1", grnLineId: "g1", qtyInUnit: 100n, factor: 1n, unitCost: Y(10_000), ...o,
});
const props = (o: Partial<SupplierInvoiceProps> = {}): SupplierInvoiceProps => ({
  invoiceId: "SI1", supplierInvoiceNo: "INV-9", tenantId: "tenant-1", supplierId: "S1", supplierStatus: "ACTIVE",
  invoiceDate: "2026-01-01", currency: "YER_NEW", baseCurrency: "YER_NEW", toleranceQtyBp: 500, tolerancePriceBp: 500,
  lines: [line()], grnLines: [ref()], ...o,
});
const opts = { entryId: "E1", postedAt: new Date("2026-01-02T10:00:00Z"), accounts: ACC };
const sums = (e: JournalEntry): Record<string, [bigint, bigint]> => {
  const m: Record<string, [bigint, bigint]> = {};
  for (const l of e.lines) {
    const c = m[l.accountCode] ?? [0n, 0n];
    m[l.accountCode] = [c[0] + l.debit.amountMinor, c[1] + l.credit.amountMinor];
  }
  return m;
};
const unmatched = (o: Partial<SupplierInvoiceProps> = {}): SupplierInvoiceProps =>
  props({ lines: [line({ grnLineId: undefined, qtyInUnit: 1n, unitCost: Y(10_000_000) })], grnLines: [], unmatchedReason: "no PO", ...o });

describe("helpers", () => {
  it.each([[110n, 100n, 1000], [102n, 100n, 200], [100n, 100n, 0], [1n, 3n, 6667]])("varianceBp(%s,%s)=%s", (a, e, bp) => {
    expect(varianceBp(a, e)).toBe(bp);
  });
  it("addDaysIso: Net 30 from 2026-01-01 is 2026-01-31", () => expect(addDaysIso("2026-01-01", 30)).toBe("2026-01-31"));
});

describe("SupplierInvoice.create — 3-way match (FR-PUR-109)", () => {
  it.each([
    ["matched", 100n, 10_000, undefined, "MATCHED", 0, 0],
    ["price 5% within tolerance", 100n, 10_500, undefined, "PRICE_VARIANCE", 0, 500],
    ["qty 2%", 102n, 10_000, undefined, "QTY_VARIANCE", 200, 0],
    ["PO 100 / GRN 100 / invoice 110, tol 5%", 110n, 10_000, undefined, "OVER_TOLERANCE", 1000, 0],
    ["price 6%", 100n, 10_600, undefined, "OVER_TOLERANCE", 0, 600],
    ["vs PO box price (10 SSU @ 1000)", 100n, 10_500, { factor: 10n, unitCost: Y(100_000) }, "PRICE_VARIANCE", 0, 500],
  ] as const)("%s", (_n, qty, cost, po, status, qBp, pBp) => {
    const inv = unwrap(SupplierInvoice.create(props({ lines: [line({ qtyInUnit: qty, unitCost: Y(cost) })], grnLines: [ref({ po })] })));
    expect(inv.matchStatus).toBe(status);
    expect(inv.lines[0]?.match).toMatchObject({ status, qtyVarianceBp: qBp, priceVarianceBp: pBp });
    expect(inv.status).toBe("DRAFT");
  });

  it.each([
    ["no lines", { lines: [] }, "supinv.no_lines"],
    ["blocked supplier", { supplierStatus: "BLOCKED" }, "supinv.supplier_blocked"],
    ["blank number", { supplierInvoiceNo: " " }, "supinv.invalid_header"],
    ["bad date", { invoiceDate: "2026-13-01" }, "supinv.invalid_header"],
    ["missing rate", { currency: "USD" }, "supinv.rate_required"],
    ["negative qty tolerance", { toleranceQtyBp: -1 }, "supinv.invalid_header"],
    ["fractional price tolerance", { tolerancePriceBp: 1.5 }, "supinv.invalid_header"],
    ["tax > 100%", { taxBp: 10_001 }, "supinv.invalid_header"],
    ["negative terms", { paymentTermsDays: -1 }, "supinv.invalid_header"],
    ["bad early payment", { earlyPayment: { days: 10, bp: 20_000 } }, "supinv.invalid_header"],
    ["duplicate line", { lines: [line(), line()] }, "supinv.duplicate_line"],
    ["duplicate GRN line", { lines: [line(), line({ lineId: "L2" })] }, "supinv.duplicate_grn_line"],
    ["line currency", { lines: [line({ unitCost: Money.minor(1, "SAR") })] }, "supinv.currency_mismatch"],
    ["factor 0", { lines: [line({ factor: 0n })] }, "supinv.invalid_line"],
    ["qty 0", { lines: [line({ qtyInUnit: 0n })] }, "po.qty_not_positive"],
    ["unknown GRN line", { grnLines: [] }, "supinv.grn_line_not_found"],
    ["GRN item mismatch", { grnLines: [ref({ itemId: "x" })] }, "supinv.ref_item_mismatch"],
    ["GRN received 0", { grnLines: [ref({ receivedSsu: 0n })] }, "supinv.invalid_ref"],
    ["PO price currency", { grnLines: [ref({ po: { factor: 1n, unitCost: Money.minor(1, "SAR") } })] }, "supinv.invalid_ref"],
    ["GRNI currency", { grnLines: [ref({ grniBase: Money.minor(1, "SAR") })] }, "supinv.invalid_ref"],
    ["unmatched without reason", { lines: [line({ grnLineId: undefined })] }, "supinv.unmatched_reason_required"],
    ["invoice discount > net", { invoiceDiscount: { mode: "AMOUNT", amount: Y(10 ** 9) } }, "discount.exceeds_invoice_net"],
  ] as const)("rejects %s", (_n, o, code) => {
    const r = SupplierInvoice.create(props(o as Partial<SupplierInvoiceProps>));
    expect(r.ok ? null : r.error.code).toBe(code);
  });
});

describe("amounts, terms and posting", () => {
  it("FR-PUR-107: line discount then 5% invoice discount = 4,500; tax 15%; direct posting (FR-PUR-115)", () => {
    const inv = unwrap(SupplierInvoice.create(unmatched({
      lines: [
        line({ grnLineId: undefined, qtyInUnit: 1n, unitCost: Y(6_000_000), discount: { mode: "AMOUNT", amount: Y(1_000_000) } }),
        line({ lineId: "L2", itemId: "i2", grnLineId: undefined, qtyInUnit: 1n, unitCost: Y(4_000_000) }),
      ],
      invoiceDiscount: { mode: "PERCENT", bp: 500 }, taxBp: 1500,
    })));
    const t = inv.totals;
    expect([t.lineGross, t.lineDiscount, t.invoiceDiscount, t.net, t.tax, t.total].map((m) => m.amountMinor))
      .toEqual([10_000_000n, 1_000_000n, 450_000n, 8_550_000n, 1_282_500n, 9_832_500n]);
    expect(inv.matchStatus).toBe("UNMATCHED");
    const p = unwrap(inv.post(opts));
    expect(sums(p.entry)).toEqual({ "1400": [8_550_000n, 0n], "1500": [1_282_500n, 0n], "2100": [0n, 9_832_500n] });
    expect(p.priceVariances).toEqual([]);
    expect(p.override).toBeNull();
  });

  it.each([
    ["GRN 10,000 vs invoice 10,500 → variance Dr 500", 10_500, 50_000n, 0n],
    ["invoice 9,500 → variance Cr 500", 9_500, 0n, 50_000n],
  ])("FR-PUR-114: %s; GRNI cleared fully", (_n, cost, dr, cr) => {
    const p = unwrap(unwrap(SupplierInvoice.create(props({ lines: [line({ unitCost: Y(cost) })] }))).post(opts));
    const s = sums(p.entry);
    expect(s["2150"]).toEqual([1_000_000n, 0n]);
    expect(s["5150"]).toEqual([dr, cr]);
    expect(s["2100"]).toEqual([0n, BigInt(cost) * 100n]);
    expect(p.priceVariances[0]?.varianceBase.amountMinor).toBe(dr - cr);
    expect(p.invoice.status).toBe("POSTED");
    expect(p.invoice.entryId).toBe("E1");
  });

  it("FR-PUR-110: 100 USD at 530 stays 53,000 YER; AP keeps foreign snapshot; no variance", () => {
    const U = (n: number): Money => Money.minor(n, "USD");
    const inv = unwrap(SupplierInvoice.create(props({
      currency: "USD", rateScaledSnapshot: 530_000_000n,
      lines: [line({ unitCost: U(100) })], grnLines: [ref({ unitCost: U(100), grniBase: Y(5_300_000) })],
    })));
    expect(inv.totals.totalBase.equals(Y(5_300_000))).toBe(true);
    const p = unwrap(inv.post(opts));
    expect(sums(p.entry)).toEqual({ "2150": [5_300_000n, 0n], "2100": [0n, 5_300_000n] });
    const ap = p.entry.lines.find((l) => l.accountCode === "2100");
    expect(ap?.foreign?.amount.amountMinor).toBe(10_000n);
    expect(ap?.foreign?.rateScaledSnapshot).toBe(530_000_000n);
  });

  it("partial invoice clears GRNI proportionally", () => {
    const inv = unwrap(SupplierInvoice.create(props({ toleranceQtyBp: 10_000, lines: [line({ qtyInUnit: 50n })] })));
    expect(inv.matchStatus).toBe("QTY_VARIANCE");
    expect(sums(unwrap(inv.post(opts)).entry)).toEqual({ "2150": [500_000n, 0n], "2100": [0n, 500_000n] });
  });

  it("free unmatched line yields zero base totals", () => {
    const inv = unwrap(SupplierInvoice.create(unmatched({ lines: [line({ grnLineId: undefined, unitCost: Y(0) })] })));
    expect(inv.totals.totalBase.isZero()).toBe(true);
    expect(inv.totals.lineNetsBase.map((m) => m.amountMinor)).toEqual([0n]);
  });

  it("FR-SUP-102/104: Net 30 due date; 2% within 10 days of 100,000 → 2,000", () => {
    const inv = unwrap(SupplierInvoice.create(unmatched({ paymentTermsDays: 30, earlyPayment: { days: 10, bp: 200 } })));
    expect(inv.dueDate).toBe("2026-01-31");
    expect(inv.earlyPaymentDeadline).toBe("2026-01-11");
    expect(inv.earlyPaymentDiscount("2026-01-06").amountMinor).toBe(200_000n);
    expect(inv.earlyPaymentDiscount("2026-01-15").isZero()).toBe(true);
    expect(inv.earlyPaymentDiscount("2025-12-31").isZero()).toBe(true);
    const plain = unwrap(SupplierInvoice.create(props()));
    expect([plain.dueDate, plain.earlyPaymentDeadline, plain.earlyPaymentDiscount("2026-01-02").isZero()]).toEqual(["2026-01-01", null, true]);
    expect([plain.invoiceId, plain.header.supplierId]).toEqual(["SI1", "S1"]);
  });

  it("over-tolerance requires purchase.match_override", () => {
    const inv = unwrap(SupplierInvoice.create(props({ lines: [line({ qtyInUnit: 110n })] })));
    const good = { permission: MATCH_OVERRIDE_PERMISSION, approvedBy: "mgr", reason: "agreed extra" };
    for (const override of [undefined, { ...good, permission: "x" }, { ...good, approvedBy: " " }, { ...good, reason: "" }]) {
      const r = inv.post({ ...opts, override });
      expect(r.ok ? null : r.error.code).toBe("supinv.over_tolerance");
    }
    const p = unwrap(inv.post({ ...opts, override: good }));
    expect(p.override).toEqual(good);
    expect(sums(p.entry)["5150"]).toEqual([100_000n, 0n]);
  });

  it("lifecycle: post once, reverse with own entry only", () => {
    const draft = unwrap(SupplierInvoice.create(props()));
    const p = unwrap(draft.post(opts));
    const again = p.invoice.post(opts);
    expect(again.ok ? null : again.error.code).toBe("supinv.not_draft");
    const req = { entryId: "E2", reason: "wrong supplier", at: new Date("2026-01-03T00:00:00Z") };
    const onDraft = draft.reverse(p.entry, req);
    expect(onDraft.ok ? null : onDraft.error.code).toBe("supinv.not_posted");
    const other = unwrap(unwrap(SupplierInvoice.create(props())).post({ ...opts, entryId: "E9" })).entry;
    expect(p.invoice.reverse(other, req).ok).toBe(false);
    const rev = unwrap(p.invoice.reverse(p.entry, req));
    expect(rev.invoice.status).toBe("REVERSED");
    expect(sums(rev.entry)["2100"]).toEqual([1_000_000n, 0n]);
  });
});
