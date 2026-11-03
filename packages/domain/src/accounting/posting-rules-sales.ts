/**
 * Posting rules — sales cycle. ACCOUNTING-DESIGN PR-01, PR-02, PR-03, PR-04, PR-15, PR-16.
 * Pure: (meta, event) → Result<JournalEntry>. Document amounts are base-currency Money; tendered
 * payments/refunds may be foreign and are converted with their `rateScaled` snapshot.
 */
import { Money } from "../money/money.js";
import { domainErr, ok, type Result } from "../shared/result.js";
import { ACCOUNT_CODES as A } from "./chart-of-accounts.js";
import type { JournalEntry, JournalLineInput } from "./journal-entry.js";
import {
  inventoryLotLines,
  isBlank,
  postEntry,
  requireBaseAmount,
  settleDocument,
  type EntryMeta,
  type LotCostLine,
  type PaymentPart,
} from "./posting-common.js";

/** GROSS: Cr 4100 gross + Dr 4120 discounts allowed (PR-01). NET: Cr 4100 (gross − discount). */
export type DiscountPosting = "NET" | "GROSS";

export interface SalesInvoicePosted {
  readonly invoiceId: string;
  readonly customerId?: string | undefined;
  /** Σ line totals before any discount (base). */
  readonly gross: Money;
  /** Total discount granted (line + invoice), base. */
  readonly discount: Money;
  /** Output VAT, base; zero when not applicable. */
  readonly outputVat: Money;
  /** Tendered at posting; the unpaid remainder is booked to the customer's AR. */
  readonly payments: readonly PaymentPart[];
  /** Cost of the lots allocated to this invoice (FEFO / specific identification, C5). */
  readonly cogs: readonly LotCostLine[];
  readonly discountPosting: DiscountPosting;
}

/**
 * PR-01 cash sale · PR-02 credit or partial sale · PR-15 sale collected in a foreign currency.
 *   Dr funds (per tendered payment, base)       Dr 1300 AR (unpaid remainder, customer dimension)
 *   GROSS: Dr 4120 discount / Cr 4100 gross     NET: Cr 4100 (gross − discount)
 *   Cr 2200 output VAT (if any)                 Dr 5100 COGS Σ cost / Cr 1400 per lot
 * Example PR-01: gross 4,500, discount 200, cash 4,300, lot cost 2,900 → 7,400 / 7,400.
 * A foreign payment whose base value exceeds what it settles → Cr 4200; below → Dr 5400.
 */
export function salesInvoicePosted(meta: EntryMeta, ev: SalesInvoicePosted): Result<JournalEntry> {
  const base = meta.baseCurrency;
  const gross = requireBaseAmount(ev.gross, base, "gross", false);
  if (!gross.ok) return gross;
  const discount = requireBaseAmount(ev.discount, base, "discount");
  if (!discount.ok) return discount;
  const vat = requireBaseAmount(ev.outputVat, base, "outputVat");
  if (!vat.ok) return vat;
  if (discount.value.gt(gross.value)) {
    return domainErr("accounting.discount_exceeds_gross", "Discount cannot exceed gross sales", {
      gross: gross.value.toDecimalString(),
      discount: discount.value.toDecimalString(),
    });
  }
  const net = gross.value.subtract(discount.value);
  const memo = `Sales invoice ${ev.invoiceId}`;
  const settlement = settleDocument(net.add(vat.value), ev.payments, "RECEIPT", base, memo);
  if (!settlement.ok) return settlement;
  const lines: JournalLineInput[] = [...settlement.value.lines];
  if (settlement.value.outstanding.isPositive()) {
    if (isBlank(ev.customerId)) {
      return domainErr("accounting.customer_required", "Credit sales require a customer", { invoiceId: ev.invoiceId });
    }
    lines.push({ accountCode: A.ACCOUNTS_RECEIVABLE, debit: settlement.value.outstanding, memo, dimensions: { customerId: ev.customerId } });
  }
  if (ev.discountPosting === "GROSS") {
    if (discount.value.isPositive()) lines.push({ accountCode: A.DISCOUNTS_ALLOWED, debit: discount.value, memo });
    lines.push({ accountCode: A.SALES, credit: gross.value, memo });
  } else if (net.isPositive()) {
    lines.push({ accountCode: A.SALES, credit: net, memo });
  }
  if (vat.value.isPositive()) lines.push({ accountCode: A.OUTPUT_VAT, credit: vat.value, memo });
  const cogs = inventoryLotLines(ev.cogs, "CREDIT", base, memo);
  if (!cogs.ok) return cogs;
  if (cogs.value.total.isPositive()) lines.push({ accountCode: A.COGS, debit: cogs.value.total, memo }, ...cogs.value.lines);
  return postEntry(meta, { type: "sales_invoice", id: ev.invoiceId }, lines, memo);
}

export interface SalesReturnPosted {
  readonly returnId: string;
  readonly originalInvoiceId: string;
  readonly customerId?: string | undefined;
  /** Sold value being reversed (net of discounts), base. */
  readonly returnedNet: Money;
  /** Output VAT reversed, base; zero when not applicable. */
  readonly outputVat: Money;
  /** Cash/bank/wallet refunds; any remainder is credited to the customer's AR. */
  readonly refunds: readonly PaymentPart[];
  /** Cost put back on the ORIGINAL lots at their original cost (C1/C5). */
  readonly restock: readonly LotCostLine[];
}

/**
 * PR-04 sales return (partial or full).
 *   Dr 4110 sales returns (net) · Dr 2200 output VAT (if any)
 *   Cr funds (refund, base) / Cr 1300 AR (credit sale, customer dimension)
 *   Dr 1400 per original lot at original cost / Cr 5100 COGS Σ cost
 * Example PR-04: 1,500 returned, cost 1,000, cash refund → Dr 4110 1,500 / Cr 1100 1,500 ; Dr 1400 1,000 / Cr 5100 1,000.
 * Refunding more base than booked (foreign refund at a higher rate) → Dr 5400; less → Cr 4200.
 */
export function salesReturnPosted(meta: EntryMeta, ev: SalesReturnPosted): Result<JournalEntry> {
  const base = meta.baseCurrency;
  const net = requireBaseAmount(ev.returnedNet, base, "returnedNet", false);
  if (!net.ok) return net;
  const vat = requireBaseAmount(ev.outputVat, base, "outputVat");
  if (!vat.ok) return vat;
  const memo = `Sales return ${ev.returnId} of invoice ${ev.originalInvoiceId}`;
  const settlement = settleDocument(net.value.add(vat.value), ev.refunds, "PAYMENT", base, memo);
  if (!settlement.ok) return settlement;
  const lines: JournalLineInput[] = [{ accountCode: A.SALES_RETURNS, debit: net.value, memo }];
  if (vat.value.isPositive()) lines.push({ accountCode: A.OUTPUT_VAT, debit: vat.value, memo });
  lines.push(...settlement.value.lines);
  if (settlement.value.outstanding.isPositive()) {
    if (isBlank(ev.customerId)) {
      return domainErr("accounting.customer_required", "Crediting a return to account requires a customer", { returnId: ev.returnId });
    }
    lines.push({ accountCode: A.ACCOUNTS_RECEIVABLE, credit: settlement.value.outstanding, memo, dimensions: { customerId: ev.customerId } });
  }
  const restock = inventoryLotLines(ev.restock, "DEBIT", base, memo);
  if (!restock.ok) return restock;
  if (restock.value.total.isPositive()) lines.push(...restock.value.lines, { accountCode: A.COGS, credit: restock.value.total, memo });
  return postEntry(meta, { type: "sales_return", id: ev.returnId }, lines, memo);
}

export interface CustomerPaymentPosted {
  readonly paymentId: string;
  readonly customerId: string;
  /** Tender; its own `settlesBase` is ignored — the settlement is `arSettledBase + depositBase`. */
  readonly payment: PaymentPart;
  /** AR reduced at the invoices' booked rate (FR-SUP-105 mirrored for customers). */
  readonly arSettledBase: Money;
  /** Unallocated remainder kept as a customer deposit (2300). */
  readonly depositBase?: Money | undefined;
}

/**
 * PR-03 customer collection · PR-16 settlement FX difference.
 *   Dr funds (tender in base) · Cr 1300 AR (booked base) · Cr 2300 deposit (unallocated)
 *   tender − (AR + deposit) → Cr 4200 FX gain (positive) / Dr 5400 FX loss (negative)
 * Example PR-16: 100 SAR booked at 430 (43,000) collected at 440 (44,000) → Cr 4200 1,000.
 */
export function customerPaymentPosted(meta: EntryMeta, ev: CustomerPaymentPosted): Result<JournalEntry> {
  const base = meta.baseCurrency;
  if (isBlank(ev.customerId)) {
    return domainErr("accounting.customer_required", "A customer payment needs a customer", { paymentId: ev.paymentId });
  }
  const ar = requireBaseAmount(ev.arSettledBase, base, "arSettledBase");
  if (!ar.ok) return ar;
  const deposit = ev.depositBase === undefined ? ok(Money.zero(base)) : requireBaseAmount(ev.depositBase, base, "depositBase");
  if (!deposit.ok) return deposit;
  const total = ar.value.add(deposit.value);
  if (!total.isPositive()) {
    return domainErr("accounting.nothing_to_post", "Customer payment settles nothing", { paymentId: ev.paymentId });
  }
  const memo = `Customer payment ${ev.paymentId}`;
  const settlement = settleDocument(total, [{ ...ev.payment, settlesBase: total }], "RECEIPT", base, memo);
  if (!settlement.ok) return settlement;
  const lines: JournalLineInput[] = [...settlement.value.lines];
  if (ar.value.isPositive()) {
    lines.push({ accountCode: A.ACCOUNTS_RECEIVABLE, credit: ar.value, memo, dimensions: { customerId: ev.customerId } });
  }
  if (deposit.value.isPositive()) {
    lines.push({ accountCode: A.CUSTOMER_DEPOSITS, credit: deposit.value, memo, dimensions: { customerId: ev.customerId } });
  }
  return postEntry(meta, { type: "customer_payment", id: ev.paymentId }, lines, memo);
}
