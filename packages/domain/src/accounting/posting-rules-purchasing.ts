/**
 * Posting rules — purchasing & payables. ACCOUNTING-DESIGN PR-05, PR-06, PR-07, PR-08;
 * FR-PUR-105/106/108/110/111, FR-SUP-103/105. Anglo-Saxon: receipts increase 1400 Inventory;
 * supplier discounts already reduce the lot cost (no purchase-discount account).
 */
import { Money } from "../money/money.js";
import { domainErr, ok, type DomainError, type Err, type Result } from "../shared/result.js";
import { ACCOUNT_CODES as A } from "./chart-of-accounts.js";
import type { JournalEntry, JournalLineInput } from "./journal-entry.js";
import {
  foreignOf,
  inventoryLotLines,
  isBlank,
  postEntry,
  requireBaseAmount,
  settleDocument,
  toBase,
  type EntryMeta,
  type LotCostLine,
  type PaymentPart,
} from "./posting-common.js";

function supplierRequired(documentId: string): Err<DomainError> {
  return domainErr("accounting.supplier_required", "A supplier is required", { documentId });
}

function nothingToPost(documentId: string): Err<DomainError> {
  return domainErr("accounting.nothing_to_post", "All lots have zero cost; nothing to post", { documentId });
}

/** GRNI: accrue until the supplier invoice arrives (FR-PUR-109). AP: receipt and invoice are one document. */
export type ReceiptAccrual = "GRNI" | "AP";

export interface PurchaseReceiptPosted {
  readonly grnId: string;
  readonly supplierId: string;
  /** One line per lot created by the receipt (C1), landed cost in base (FR-PUR-106/108). */
  readonly lots: readonly LotCostLine[];
  readonly accrual: ReceiptAccrual;
}

/**
 * PR-05 inventory side of a goods receipt (FR-PUR-105).
 *   Dr 1400 per lot (zero-cost bonus lots skipped) / Cr 2150 GRNI or Cr 2100 AP (supplier dimension).
 */
export function purchaseReceiptPosted(meta: EntryMeta, ev: PurchaseReceiptPosted): Result<JournalEntry> {
  if (isBlank(ev.supplierId)) return supplierRequired(ev.grnId);
  const memo = `Goods receipt ${ev.grnId}`;
  const inv = inventoryLotLines(ev.lots, "DEBIT", meta.baseCurrency, memo);
  if (!inv.ok) return inv;
  if (inv.value.total.isZero()) return nothingToPost(ev.grnId);
  const accrualCode = ev.accrual === "GRNI" ? A.GRNI : A.ACCOUNTS_PAYABLE;
  const lines: JournalLineInput[] = [...inv.value.lines, { accountCode: accrualCode, credit: inv.value.total, memo, dimensions: { supplierId: ev.supplierId } }];
  return postEntry(meta, { type: "goods_receipt", id: ev.grnId }, lines, memo);
}

export interface SupplierInvoicePosted {
  readonly invoiceId: string;
  readonly supplierId: string;
  /** Invoice net of supplier discounts, in the invoice currency (FR-PUR-107). */
  readonly amount: Money;
  /** Fixed at posting (FR-PUR-110); required when `amount` is not in base. */
  readonly rateScaled?: bigint | undefined;
  /** GRNI accrued by earlier receipts that this invoice covers, base. */
  readonly clearsGrniBase?: Money | undefined;
  /** Paid immediately (PR-06); the remainder is booked to AP (PR-05). */
  readonly payments: readonly PaymentPart[];
}

/**
 * PR-05 credit purchase · PR-06 cash purchase · FR-PUR-110 fixed rate.
 *   Dr 1400 (invoice base − GRNI cleared)  [Cr 1400 when the invoice is below the accrual: price variance]
 *   Dr 2150 GRNI cleared · Cr funds (payments, base) · Cr 2100 AP remainder (supplier dimension)
 * Example: 100 USD @ 530 on credit → Dr 1400 53,000 / Cr 2100 53,000 (AP line carries the USD snapshot).
 */
export function supplierInvoicePosted(meta: EntryMeta, ev: SupplierInvoicePosted): Result<JournalEntry> {
  const base = meta.baseCurrency;
  if (isBlank(ev.supplierId)) return supplierRequired(ev.invoiceId);
  if (!ev.amount.isPositive()) {
    return domainErr("accounting.non_positive_amount", "Supplier invoice amount must be > 0", { invoiceId: ev.invoiceId });
  }
  const conv = toBase(ev.amount, ev.rateScaled, base);
  if (!conv.ok) return conv;
  const total = conv.value.base;
  const grni = ev.clearsGrniBase === undefined ? ok(Money.zero(base)) : requireBaseAmount(ev.clearsGrniBase, base, "clearsGrniBase");
  if (!grni.ok) return grni;
  const memo = `Supplier invoice ${ev.invoiceId}`;
  const lines: JournalLineInput[] = [];
  const delta = total.subtract(grni.value);
  if (delta.isPositive()) lines.push({ accountCode: A.INVENTORY, debit: delta, memo });
  else if (delta.isNegative()) lines.push({ accountCode: A.INVENTORY, credit: delta.abs(), memo: `${memo} (price variance)` });
  if (grni.value.isPositive()) lines.push({ accountCode: A.GRNI, debit: grni.value, memo, dimensions: { supplierId: ev.supplierId } });
  const settlement = settleDocument(total, ev.payments, "PAYMENT", base, memo);
  if (!settlement.ok) return settlement;
  lines.push(...settlement.value.lines);
  if (settlement.value.outstanding.isPositive()) {
    lines.push({
      accountCode: A.ACCOUNTS_PAYABLE,
      credit: settlement.value.outstanding,
      memo,
      dimensions: { supplierId: ev.supplierId },
      foreign: ev.payments.length === 0 ? foreignOf(ev.amount, conv.value, base) : null,
    });
  }
  return postEntry(meta, { type: "supplier_invoice", id: ev.invoiceId }, lines, memo);
}

export interface SupplierPaymentPosted {
  readonly paymentId: string;
  readonly supplierId: string;
  /** Tender; its own `settlesBase` is ignored — the settlement is `apSettledBase + advanceBase`. */
  readonly payment: PaymentPart;
  /** AP reduced at the invoices' booked rate (FR-SUP-103 allocations). */
  readonly apSettledBase: Money;
  /** Unallocated remainder kept as a supplier advance (debit on 2100). */
  readonly advanceBase?: Money | undefined;
}

/**
 * PR-07 supplier payment · FR-SUP-105 realised FX difference.
 *   Dr 2100 AP (booked base) · Dr 2100 advance (unallocated) · Cr funds (tender, base)
 *   (AP + advance) − tender → Cr 4200 FX gain (positive) / Dr 5400 FX loss (negative)
 * Example: 100 USD booked at 530 (53,000) paid at 535 (53,500) → Dr 5400 500 ; at 540 → Dr 5400 1,000.
 */
export function supplierPaymentPosted(meta: EntryMeta, ev: SupplierPaymentPosted): Result<JournalEntry> {
  const base = meta.baseCurrency;
  if (isBlank(ev.supplierId)) return supplierRequired(ev.paymentId);
  const ap = requireBaseAmount(ev.apSettledBase, base, "apSettledBase");
  if (!ap.ok) return ap;
  const advance = ev.advanceBase === undefined ? ok(Money.zero(base)) : requireBaseAmount(ev.advanceBase, base, "advanceBase");
  if (!advance.ok) return advance;
  const total = ap.value.add(advance.value);
  if (!total.isPositive()) {
    return domainErr("accounting.nothing_to_post", "Supplier payment settles nothing", { paymentId: ev.paymentId });
  }
  const memo = `Supplier payment ${ev.paymentId}`;
  const settlement = settleDocument(total, [{ ...ev.payment, settlesBase: total }], "PAYMENT", base, memo);
  if (!settlement.ok) return settlement;
  const lines: JournalLineInput[] = [];
  if (ap.value.isPositive()) lines.push({ accountCode: A.ACCOUNTS_PAYABLE, debit: ap.value, memo, dimensions: { supplierId: ev.supplierId } });
  if (advance.value.isPositive()) {
    lines.push({ accountCode: A.ACCOUNTS_PAYABLE, debit: advance.value, memo: `${memo} (advance)`, dimensions: { supplierId: ev.supplierId } });
  }
  lines.push(...settlement.value.lines);
  return postEntry(meta, { type: "supplier_payment", id: ev.paymentId }, lines, memo);
}

export interface PurchaseReturnPosted {
  readonly returnId: string;
  readonly supplierId: string;
  /** Cost leaving each lot at its own cost (FR-PUR-111 debit note). */
  readonly lots: readonly LotCostLine[];
}

/** PR-08 return to supplier: Dr 2100 AP Σ cost (supplier dimension) / Cr 1400 per lot. Example: 5,000. */
export function purchaseReturnPosted(meta: EntryMeta, ev: PurchaseReturnPosted): Result<JournalEntry> {
  if (isBlank(ev.supplierId)) return supplierRequired(ev.returnId);
  const memo = `Purchase return ${ev.returnId}`;
  const inv = inventoryLotLines(ev.lots, "CREDIT", meta.baseCurrency, memo);
  if (!inv.ok) return inv;
  if (inv.value.total.isZero()) return nothingToPost(ev.returnId);
  const lines: JournalLineInput[] = [{ accountCode: A.ACCOUNTS_PAYABLE, debit: inv.value.total, memo, dimensions: { supplierId: ev.supplierId } }, ...inv.value.lines];
  return postEntry(meta, { type: "purchase_return", id: ev.returnId }, lines, memo);
}
