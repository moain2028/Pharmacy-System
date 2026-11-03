import { describe, expect, it } from "vitest";
import { Money } from "../money/money.js";
import type { Result } from "../shared/result.js";
import {
  DISCOUNT_TYPES,
  FULL_BP,
  addToBreakdown,
  applyLineDiscounts,
  distributeInvoiceDiscount,
  emptyBreakdown,
  maxLineBp,
  mergeLimits,
  sumBreakdowns,
  type Discount,
} from "./discount.js";

const yer = (major: number): Money => Money.minor(BigInt(major) * 100n, "YER_NEW");
const yerMinor = (minor: bigint): Money => Money.minor(minor, "YER_NEW");

function codeOf<T>(r: Result<T>): string {
  if (r.ok) throw new Error("expected an Err result");
  return r.error.code;
}
function val<T>(r: Result<T>): T {
  if (!r.ok) throw r.error;
  return r.value;
}

describe("breakdown helpers", () => {
  it("emptyBreakdown has a zero for every type and is frozen", () => {
    const b = emptyBreakdown("SAR");
    expect(Object.isFrozen(b)).toBe(true);
    for (const t of DISCOUNT_TYPES) expect(b[t].equals(Money.zero("SAR"))).toBe(true);
    expect(FULL_BP).toBe(10_000);
  });

  it("addToBreakdown and sumBreakdowns accumulate per type", () => {
    const a = addToBreakdown(emptyBreakdown("YER_NEW"), "PROMO", yer(10));
    const b = addToBreakdown(addToBreakdown(emptyBreakdown("YER_NEW"), "PROMO", yer(5)), "LINE_AMOUNT", yer(3));
    const s = sumBreakdowns([a, b], "YER_NEW");
    expect(s.PROMO.equals(yer(15))).toBe(true);
    expect(s.LINE_AMOUNT.equals(yer(3))).toBe(true);
    expect(sumBreakdowns([], "USD").PROMO.equals(Money.zero("USD"))).toBe(true);
  });
});

describe("limits", () => {
  it("mergeLimits keeps the stricter value per field", () => {
    expect(mergeLimits({ userMaxLineBp: 500 }, { userMaxLineBp: 300, itemMaxLineBp: 1000 })).toEqual({
      userMaxLineBp: 300, itemMaxLineBp: 1000,
    });
    expect(mergeLimits()).toEqual({});
    expect(mergeLimits(undefined, { categoryMaxLineBp: 200, userMaxInvoiceBp: 100 })).toEqual({
      categoryMaxLineBp: 200, userMaxInvoiceBp: 100,
    });
  });

  it("maxLineBp is the minimum of user/item/category limits", () => {
    expect(maxLineBp({})).toBeUndefined();
    expect(maxLineBp({ userMaxLineBp: 500, itemMaxLineBp: 300, categoryMaxLineBp: 400 })).toBe(300);
    expect(maxLineBp({ categoryMaxLineBp: 700 })).toBe(700);
  });
});

describe("applyLineDiscounts", () => {
  it("golden: 15% of 1000.00 = 150.00", () => {
    const r = val(applyLineDiscounts(yer(1000), [{ type: "LINE_PERCENT", bp: 1500, source: "manual" }]));
    expect(r.discountTotal.toDecimalString()).toBe("150.00");
    expect(r.net.toDecimalString()).toBe("850.00");
    expect(r.byType.LINE_PERCENT.toDecimalString()).toBe("150.00");
    expect(r.applied).toEqual([{ type: "LINE_PERCENT", source: "manual", amount: yer(150) }]);
    expect(Object.isFrozen(r)).toBe(true);
  });

  it("no discounts: net = gross", () => {
    const r = val(applyLineDiscounts(yer(10), []));
    expect(r.net.equals(yer(10))).toBe(true);
    expect(r.discountTotal.isZero()).toBe(true);
  });

  it("golden: a line discount cannot exceed the line gross", () => {
    expect(codeOf(applyLineDiscounts(yer(1000), [{ type: "LINE_AMOUNT", amount: yer(1500), source: "manual" }]))).toBe(
      "discount.exceeds_line_gross",
    );
    const full = val(applyLineDiscounts(yer(1000), [{ type: "LINE_AMOUNT", amount: yer(1000), source: "manual" }]));
    expect(full.net.isZero()).toBe(true);
  });

  it("applies stages in canonical order regardless of input order", () => {
    const discounts: Discount[] = [
      { type: "LINE_PERCENT", bp: 1000, source: "manual" },
      { type: "CUSTOMER_GROUP", bp: 500, source: "grp-1" },
      { type: "NEAR_EXPIRY", value: { mode: "AMOUNT", amount: yer(50) }, source: "lot-9" },
      { type: "PROMO", value: { mode: "PERCENT", bp: 1000 }, source: "promo-1" },
    ];
    const r = val(applyLineDiscounts(yer(1000), discounts));
    expect(r.applied.map((a) => a.type)).toEqual(["PROMO", "NEAR_EXPIRY", "CUSTOMER_GROUP", "LINE_PERCENT"]);
    expect(r.applied.map((a) => a.amount.amountMinor)).toEqual([10_000n, 5_000n, 4_250n, 8_075n]);
    expect(r.net.toDecimalString()).toBe("726.75");
    expect(r.discountTotal.toDecimalString()).toBe("273.25");
  });

  it("a blocking promo suppresses the customer-group discount", () => {
    const r = val(
      applyLineDiscounts(yer(1000), [
        { type: "CUSTOMER_GROUP", bp: 500, source: "grp-1" },
        { type: "PROMO", value: { mode: "PERCENT", bp: 1000 }, source: "promo-1", blocksCustomerGroup: true },
      ]),
    );
    expect(r.applied).toHaveLength(1);
    expect(r.net.equals(yer(900))).toBe(true);
  });

  it("promo amount then near-expiry percent", () => {
    const r = val(
      applyLineDiscounts(yer(1000), [
        { type: "PROMO", value: { mode: "AMOUNT", amount: yer(100) }, source: "p" },
        { type: "NEAR_EXPIRY", value: { mode: "PERCENT", bp: 1000 }, source: "lot" },
      ]),
    );
    expect(r.net.equals(yer(810))).toBe(true);
    expect(r.byType.PROMO.equals(yer(100))).toBe(true);
    expect(r.byType.NEAR_EXPIRY.equals(yer(90))).toBe(true);
  });

  it("rejects invalid bp", () => {
    for (const bp of [10_001, -1, 1.5]) {
      expect(codeOf(applyLineDiscounts(yer(1), [{ type: "LINE_PERCENT", bp, source: "m" }]))).toBe("discount.invalid_bp");
    }
  });

  it("rejects foreign-currency and negative amounts", () => {
    expect(codeOf(applyLineDiscounts(yer(10), [{ type: "LINE_AMOUNT", amount: Money.minor(1n, "SAR"), source: "m" }]))).toBe(
      "discount.currency_mismatch",
    );
    expect(codeOf(applyLineDiscounts(yer(10), [{ type: "LINE_AMOUNT", amount: yer(-1), source: "m" }]))).toBe(
      "discount.negative_amount",
    );
  });

  it("rejects invoice-scope discounts, two manual discounts and a negative gross", () => {
    expect(codeOf(applyLineDiscounts(yer(10), [{ type: "INVOICE_PERCENT", bp: 100, source: "m" }]))).toBe("discount.wrong_scope");
    expect(
      codeOf(
        applyLineDiscounts(yer(10), [
          { type: "LINE_PERCENT", bp: 100, source: "m" },
          { type: "LINE_AMOUNT", amount: yer(1), source: "m" },
        ]),
      ),
    ).toBe("discount.multiple_manual_line");
    expect(codeOf(applyLineDiscounts(yer(-1), []))).toBe("discount.negative_base");
  });

  it("FR-PRC-118: manual discount above the limit needs approvedBy", () => {
    const limits = { userMaxLineBp: 500 };
    expect(codeOf(applyLineDiscounts(yer(1000), [{ type: "LINE_PERCENT", bp: 1000, source: "m" }], limits))).toBe(
      "discount.limit_exceeded",
    );
    expect(
      codeOf(applyLineDiscounts(yer(1000), [{ type: "LINE_PERCENT", bp: 1000, source: "m", approvedBy: "  " }], limits)),
    ).toBe("discount.limit_exceeded");
    const ok = val(applyLineDiscounts(yer(1000), [{ type: "LINE_PERCENT", bp: 1000, source: "m", approvedBy: "mgr-1" }], limits));
    expect(ok.applied[0]?.approvedBy).toBe("mgr-1");
    expect(ok.net.equals(yer(900))).toBe(true);
  });

  it("amount discounts are checked by effective bp rounded up", () => {
    const limits = { itemMaxLineBp: 500 };
    expect(val(applyLineDiscounts(yer(1000), [{ type: "LINE_AMOUNT", amount: yer(50), source: "m" }], limits)).net.equals(yer(950))).toBe(true);
    expect(
      codeOf(applyLineDiscounts(yer(1000), [{ type: "LINE_AMOUNT", amount: yerMinor(5_001n), source: "m" }], limits)),
    ).toBe("discount.limit_exceeded");
    expect(val(applyLineDiscounts(yer(0), [{ type: "LINE_AMOUNT", amount: yer(0), source: "m" }], limits)).net.isZero()).toBe(true);
  });

  it("limits do not apply to system discounts", () => {
    const r = val(
      applyLineDiscounts(yer(100), [{ type: "PROMO", value: { mode: "PERCENT", bp: 5000 }, source: "p" }], { userMaxLineBp: 100 }),
    );
    expect(r.net.equals(yer(50))).toBe(true);
  });
});

describe("distributeInvoiceDiscount", () => {
  it("golden: 300/200/500 with 100.00 invoice discount -> 30/20/50", () => {
    const r = val(distributeInvoiceDiscount([yer(300), yer(200), yer(500)], { type: "INVOICE_AMOUNT", amount: yer(100), source: "m" }));
    expect(r.allocations.map((m) => m.toDecimalString())).toEqual(["30.00", "20.00", "50.00"]);
    expect(r.total.equals(yer(100))).toBe(true);
    expect(r.applied).toEqual({ type: "INVOICE_AMOUNT", source: "m", amount: yer(100) });
  });

  it("FR-PRC-117: 3000/1000 with 100 -> 75/25; with 101 -> 76/25", () => {
    const nets = [yerMinor(3000n), yerMinor(1000n)];
    const a = val(distributeInvoiceDiscount(nets, { type: "INVOICE_AMOUNT", amount: yerMinor(100n), source: "m" }));
    expect(a.allocations.map((m) => m.amountMinor)).toEqual([75n, 25n]);
    const b = val(distributeInvoiceDiscount(nets, { type: "INVOICE_AMOUNT", amount: yerMinor(101n), source: "m" }));
    expect(b.allocations.map((m) => m.amountMinor)).toEqual([76n, 25n]);
  });

  it("percent invoice discount is computed on the eligible net", () => {
    const r = val(distributeInvoiceDiscount([yer(300), yer(200), yer(500)], { type: "INVOICE_PERCENT", bp: 1000, source: "m" }));
    expect(r.total.equals(yer(100))).toBe(true);
    expect(r.allocations.map((m) => m.toDecimalString())).toEqual(["30.00", "20.00", "50.00"]);
  });

  it("excluded lines receive no share", () => {
    const r = val(
      distributeInvoiceDiscount([yer(300), yer(200), yer(500)], { type: "INVOICE_AMOUNT", amount: yer(80), source: "m" }, {
        excluded: [false, true, false],
      }),
    );
    expect(r.allocations.map((m) => m.toDecimalString())).toEqual(["30.00", "0.00", "50.00"]);
  });

  it("FR-PRC-119: 500 on a 400 net is rejected; all-excluded also rejected", () => {
    expect(codeOf(distributeInvoiceDiscount([yer(400)], { type: "INVOICE_AMOUNT", amount: yer(500), source: "m" }))).toBe(
      "discount.exceeds_invoice_net",
    );
    expect(
      codeOf(distributeInvoiceDiscount([yer(400)], { type: "INVOICE_AMOUNT", amount: yer(1), source: "m" }, { excluded: [true] })),
    ).toBe("discount.exceeds_invoice_net");
  });

  it("zero discount yields zero allocations", () => {
    const r = val(distributeInvoiceDiscount([yer(1), yer(2)], { type: "INVOICE_AMOUNT", amount: yer(0), source: "m" }));
    expect(r.allocations.every((m) => m.isZero())).toBe(true);
  });

  it("validates inputs", () => {
    const d = { type: "INVOICE_AMOUNT", amount: yer(1), source: "m" } as const;
    expect(codeOf(distributeInvoiceDiscount([], d))).toBe("discount.no_lines");
    expect(codeOf(distributeInvoiceDiscount([yer(5), Money.minor(5n, "SAR")], d))).toBe("discount.currency_mismatch");
    expect(codeOf(distributeInvoiceDiscount([yer(5)], { ...d, amount: Money.minor(1n, "SAR") }))).toBe("discount.currency_mismatch");
    expect(codeOf(distributeInvoiceDiscount([yer(-5)], d))).toBe("discount.negative_base");
    expect(codeOf(distributeInvoiceDiscount([yer(5)], { type: "INVOICE_PERCENT", bp: 20_000, source: "m" }))).toBe("discount.invalid_bp");
  });

  it("enforces userMaxInvoiceBp unless approved", () => {
    const limits = { userMaxInvoiceBp: 500 };
    const pct = { type: "INVOICE_PERCENT", bp: 1000, source: "m" } as const;
    expect(codeOf(distributeInvoiceDiscount([yer(100)], pct, { limits }))).toBe("discount.limit_exceeded");
    const approved = val(distributeInvoiceDiscount([yer(100)], { ...pct, approvedBy: "mgr-2" }, { limits }));
    expect(approved.applied.approvedBy).toBe("mgr-2");
    const amt = val(distributeInvoiceDiscount([yer(100)], { type: "INVOICE_AMOUNT", amount: yer(5), source: "m" }, { limits }));
    expect(amt.total.equals(yer(5))).toBe(true);
  });

  it("refuses amounts beyond safe integer ratios", () => {
    const huge = Money.minor(2n ** 60n, "YER_NEW");
    expect(codeOf(distributeInvoiceDiscount([huge], { type: "INVOICE_AMOUNT", amount: yerMinor(1n), source: "m" }))).toBe(
      "discount.amount_too_large",
    );
  });
});
