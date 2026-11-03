import { describe, expect, it } from "vitest";
import { Money } from "../money/money.js";
import type { InvoiceDiscount, LineDiscount } from "../pricing/discount.js";
import { unwrap } from "../shared/result.js";
import { computeInvoiceTotals, type TotalsInput, type TotalsLineInput } from "./invoice-totals.js";

const C = "YER_OLD" as const;
const m = (x: bigint): Money => Money.minor(x, C);
const line = (
  lineId: string, price: bigint, qty: bigint, discounts: readonly LineDiscount[] = [], taxBp = 0, exclude = false,
): TotalsLineInput => ({ lineId, unitPrice: m(price), qtyInUnit: qty, discounts, taxBp, excludeFromInvoiceDiscount: exclude });
const invAmt = (x: bigint): InvoiceDiscount => ({ type: "INVOICE_AMOUNT", source: "manual", amount: m(x) });

describe("computeInvoiceTotals", () => {
  it("empty invoice is all zero", () => {
    const t = unwrap(computeInvoiceTotals({ currency: C, lines: [] }));
    expect([t.gross, t.net, t.tax, t.total, t.roundingAdjustment].every((x) => x.isZero())).toBe(true);
    expect(t.invoiceDiscountApplied).toBeNull();
  });

  it("applies the canonical order PROMO -> CUSTOMER_GROUP -> manual regardless of input order", () => {
    const t = unwrap(computeInvoiceTotals({ currency: C, lines: [line("L1", 10000n, 10n, [
      { type: "LINE_PERCENT", source: "manual", bp: 1000 },
      { type: "CUSTOMER_GROUP", source: "g", bp: 500 },
      { type: "PROMO", source: "p", value: { mode: "PERCENT", bp: 1000 } },
    ])] }));
    expect(t.gross.amountMinor).toBe(100000n);
    expect(t.byType.PROMO.amountMinor).toBe(10000n);
    expect(t.byType.CUSTOMER_GROUP.amountMinor).toBe(4500n);
    expect(t.byType.LINE_PERCENT.amountMinor).toBe(8550n);
    expect(t.net.amountMinor).toBe(76950n);
    expect(t.lineDiscountTotal.amountMinor).toBe(23050n);
  });

  it("FR-SAL-118 line 1,005 with 10% (Half-Up per D-028, 2 minor digits)", () => {
    const t = unwrap(computeInvoiceTotals({ currency: C, lines: [line("L1", 100500n, 1n, [{ type: "LINE_PERCENT", source: "m", bp: 1000 }])] }));
    expect(t.lineDiscountTotal.amountMinor).toBe(10050n);
    expect(t.net.amountMinor).toBe(90450n);
  });

  it.each([
    [[60000n, 40000n], 10000n, [6000n, 4000n]],
    [[100n, 100n, 100n], 100n, [34n, 33n, 33n]],
  ])("FR-SAL-119 distributes invoice discount exactly %#", (nets, disc, expected) => {
    const t = unwrap(computeInvoiceTotals({
      currency: C, lines: nets.map((n, i) => line(`L${i}`, n, 1n)), invoiceDiscount: invAmt(disc),
    }));
    expect(t.lines.map((l) => l.invoiceDiscountAlloc.amountMinor)).toEqual(expected);
    expect(Money.sum(t.lines.map((l) => l.invoiceDiscountAlloc), C).equals(t.invoiceDiscountTotal)).toBe(true);
    expect(t.invoiceDiscountTotal.amountMinor).toBe(disc);
    expect(t.byType.INVOICE_AMOUNT.amountMinor).toBe(disc);
    expect(t.discountTotal.amountMinor).toBe(disc);
  });

  it("excluded lines receive no invoice discount", () => {
    const t = unwrap(computeInvoiceTotals({
      currency: C, lines: [line("A", 50000n, 1n), line("B", 50000n, 1n, [], 0, true)],
      invoiceDiscount: { type: "INVOICE_PERCENT", source: "m", bp: 1000 },
    }));
    expect(t.lines.map((l) => l.invoiceDiscountAlloc.amountMinor)).toEqual([5000n, 0n]);
  });

  it("tax is computed per line on the net after invoice discount", () => {
    const t = unwrap(computeInvoiceTotals({ currency: C, lines: [line("L1", 110000n, 1n, [], 1500)], invoiceDiscount: invAmt(10000n) }));
    expect(t.net.amountMinor).toBe(100000n);
    expect(t.tax.amountMinor).toBe(15000n);
    expect(t.total.amountMinor).toBe(115000n);
  });

  it.each([
    ["down", 123000n, -700n],
    ["half_up", 124000n, 300n],
    ["up", 124000n, 300n],
  ] as const)("FR-SAL-142 cash rounding 1,237 to step 10 (%s)", (mode, total, adj) => {
    const t = unwrap(computeInvoiceTotals({ currency: C, lines: [line("L1", 123700n, 1n)], cashRounding: { stepMinor: 1000n, mode } }));
    expect(t.totalBeforeRounding.amountMinor).toBe(123700n);
    expect(t.total.amountMinor).toBe(total);
    expect(t.roundingAdjustment.amountMinor).toBe(adj);
  });

  const errCases: [string, TotalsInput, string][] = [
    ["currency", { currency: C, lines: [{ ...line("L", 1n, 1n), unitPrice: Money.minor(1n, "SAR") }] }, "sales.currency_mismatch"],
    ["qty", { currency: C, lines: [line("L", 1n, 0n)] }, "sales.qty_not_positive"],
    ["negative", { currency: C, lines: [line("L", -1n, 1n)] }, "sales.negative_price"],
    ["tax high", { currency: C, lines: [line("L", 1n, 1n, [], 10001)] }, "sales.invalid_tax_bp"],
    ["tax float", { currency: C, lines: [line("L", 1n, 1n, [], 1.5)] }, "sales.invalid_tax_bp"],
    ["tax negative", { currency: C, lines: [line("L", 1n, 1n, [], -1)] }, "sales.invalid_tax_bp"],
    ["step", { currency: C, lines: [line("L", 1n, 1n)], cashRounding: { stepMinor: 0n, mode: "down" } }, "sales.bad_cash_step"],
    ["line disc", { currency: C, lines: [line("L", 100n, 1n, [{ type: "LINE_AMOUNT", source: "m", amount: m(200n) }])] }, "discount.exceeds_line_gross"],
    ["inv disc", { currency: C, lines: [line("L", 100n, 1n)], invoiceDiscount: invAmt(200n) }, "discount.exceeds_invoice_net"],
  ];
  it.each(errCases)("rejects %s", (_n, input, code) => {
    const r = computeInvoiceTotals(input);
    expect(r.ok ? "OK" : r.error.code).toBe(code);
  });
});
