import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { Sql } from "@pharmacore/db";
import {
  CashMovement, Money, RATE_SCALE, buildJournalEntry,
  postCapitalInjection, postCashTransfer, postCustomerReceipt, postExpense, postFxExchange, postOpeningBalances, postOwnerDrawing,
  type CashMovementKind, type CurrencyCode, type FundsAccount, type JournalEntry, type OpeningBalanceLine, type TreasuryMeta,
} from "@pharmacore/domain";
import { Db } from "../infra/db.js";
import { ApiError } from "../shared/errors.js";
import { J, convertScaled, persistEntry, rateFor } from "../shared/journal.js";

const AR_ACCOUNT = "1300";
const DEPOSITS_ACCOUNT = "2300";
const INPUT_VAT_ACCOUNT = "1500";
const OPENING_BALANCING_ACCOUNT = "3100";

type DocRef = TreasuryMeta["documentRef"];
type LineIn = Parameters<typeof buildJournalEntry>[0]["lines"][number];
type CashboxKind = "REGISTER" | "SAFE" | "BANK" | "WALLET";
interface CashboxRow { id: string; code: string; kind: CashboxKind; is_active: boolean }

export interface CustomerReceiptReq {
  customerId: string; cashboxId: string; method: "CASH" | "CARD" | "WALLET"; currency: CurrencyCode; amountMinor: string;
  businessDate?: string | undefined; allocations?: { invoiceId: string; amountMinor: string }[] | undefined; reference?: string | undefined;
}
export interface ExpenseReq {
  categoryId: string; cashboxId: string; currency: CurrencyCode; amountMinor: string; inputVatMinor?: string | undefined;
  businessDate?: string | undefined; description: string; approver?: string | undefined;
}
export interface TransferReq {
  fromCashboxId: string; toCashboxId: string; currency: CurrencyCode; amountMinor: string;
  toCurrency?: CurrencyCode | undefined; toAmountMinor?: string | undefined; businessDate?: string | undefined; reason: string;
}
export interface FxReq {
  cashboxId: string; fromCurrency: CurrencyCode; fromAmountMinor: string; toCurrency: CurrencyCode; toAmountMinor: string; businessDate?: string | undefined;
}
export interface OwnerReq {
  kind: "CAPITAL" | "OWNER_DRAWING"; cashboxId: string; currency: CurrencyCode; amountMinor: string; businessDate?: string | undefined; memo: string;
}
export interface OpeningReq {
  businessDate: string;
  lines: { accountCode: string; side: "DEBIT" | "CREDIT"; amountMinor: string; currency?: CurrencyCode | undefined; cashboxId?: string | undefined }[];
}

function must<T>(r: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: unknown }): T {
  if (!r.ok) throw r.error;
  return r.value;
}
const unprocessable = (code: string, message: string, details?: Record<string, unknown>): ApiError =>
  new ApiError(422, details ? { code, message, details } : { code, message });
const today = (): string => new Date().toISOString().slice(0, 10);
const fundsOf = (cb: CashboxRow): FundsAccount =>
  ({ kind: cb.kind === "BANK" ? "BANK" : cb.kind === "WALLET" ? "WALLET" : "CASH", id: cb.id });
const isCash = (cb: CashboxRow): boolean => cb.kind === "REGISTER" || cb.kind === "SAFE";

@Injectable()
export class TreasuryService {
  constructor(@Inject(Db) private readonly db: Db) {}

  // ------------------------------------------------------------------ helpers

  private async base(tx: Sql, tenantId: string): Promise<CurrencyCode> {
    const [t] = await tx<{ base_currency: CurrencyCode }[]>`SELECT base_currency FROM tenants WHERE id = ${tenantId}`;
    if (!t) throw ApiError.notFound("tenant.not_found", "Tenant not found");
    return t.base_currency;
  }

  private async lockBase(tx: Sql, tenantId: string): Promise<void> {
    await tx`UPDATE tenants SET base_currency_locked_at = now() WHERE id = ${tenantId} AND base_currency_locked_at IS NULL`;
  }

  private async cashbox(tx: Sql, tenantId: string, id: string): Promise<CashboxRow> {
    const [cb] = await tx<CashboxRow[]>`SELECT id, code, kind, is_active FROM cashboxes WHERE id = ${id} AND tenant_id = ${tenantId}`;
    if (!cb) throw ApiError.notFound("cashbox.not_found", "Cashbox not found");
    if (!cb.is_active) throw ApiError.conflict("cashbox.inactive", "Cashbox is inactive", { cashboxId: id });
    return cb;
  }

  private async actorShift(tx: Sql, tenantId: string, cashboxId: string, actorId: string): Promise<string | null> {
    const [s] = await tx<{ id: string }[]>`SELECT id FROM shifts WHERE tenant_id = ${tenantId} AND cashbox_id = ${cashboxId} AND cashier_id = ${actorId} AND status = 'OPEN' ORDER BY opened_at DESC LIMIT 1`;
    return s?.id ?? null;
  }

  /** Book rate (valuation of foreign cash) — sell rate, consistent with shared toBase(). */
  private async bookRate(tx: Sql, cur: CurrencyCode, base: CurrencyCode): Promise<bigint | undefined> {
    if (cur === base) return undefined;
    return (await rateFor(tx, cur, base)).sellRateScaled;
  }

  /** Serialises outflows per cashbox+currency and rejects overdrawing physical cash. */
  private async ensureFunds(tx: Sql, cb: CashboxRow, currency: CurrencyCode, need: bigint): Promise<void> {
    if (!isCash(cb)) return;
    await tx`SELECT pg_advisory_xact_lock(hashtext(${cb.id}::text || ':' || ${currency}::text))`;
    const [r] = await tx<{ b: string }[]>`SELECT COALESCE(SUM(amount_minor), 0)::text AS b FROM cash_movements WHERE cashbox_id = ${cb.id} AND currency = ${currency}::currency_code`;
    const bal = BigInt(r?.b ?? "0");
    if (bal < need) {
      throw ApiError.conflict("cash.insufficient_balance", "Insufficient cash in cashbox", {
        cashboxId: cb.id, currency, balanceMinor: bal.toString(), requiredMinor: need.toString(),
      });
    }
  }

  private meta(tenantId: string, base: CurrencyCode, type: string, id: string, memo: string): TreasuryMeta {
    const documentRef = { type, id } as unknown as DocRef;
    return { entryId: randomUUID(), tenantId, postedAt: new Date(), baseCurrency: base, documentRef, memo };
  }

  private async nextNo(tx: Sql, tenantId: string, series: string): Promise<string> {
    const [n] = await tx<{ n: string }[]>`SELECT next_document_number(${tenantId}, ${series}, '') AS n`;
    if (!n) throw new Error(`numbering failed for ${series}`);
    return n.n;
  }

  private async move(tx: Sql, tenantId: string, actorId: string, p: {
    cashboxId: string; shiftId: string | null; kind: CashMovementKind; amount: Money; docType: string; docId: string;
    pairId?: string | undefined; rate?: bigint | null | undefined; reason?: string | null | undefined;
    /** FX movements: the counter-currency of the deal (required by the domain for FX_IN/FX_OUT). */
    counterCurrency?: CurrencyCode | undefined;
  }): Promise<string> {
    const now = new Date().toISOString();
    const rateSnapshot = p.rate !== undefined && p.rate !== null && p.counterCurrency !== undefined
      ? { from: p.kind === "FX_OUT" ? p.amount.currency : p.counterCurrency, to: p.kind === "FX_OUT" ? p.counterCurrency : p.amount.currency, direction: "sell" as const, rateScaledSnapshot: p.rate, scale: RATE_SCALE, effectiveFrom: now }
      : undefined;
    const cm = must(CashMovement.create({
      movementId: randomUUID(), cashboxId: p.cashboxId, shiftId: p.shiftId ?? undefined, kind: p.kind, amount: p.amount,
      occurredAt: now, createdBy: actorId, documentRef: { type: p.docType, id: p.docId },
      pairId: p.pairId, reason: p.reason ?? undefined, rateSnapshot,
    }));
    await tx`INSERT INTO cash_movements (id, tenant_id, cashbox_id, shift_id, currency, amount_minor, kind, pair_id, rate_scaled_snapshot, document_type, document_id, reason, occurred_at, created_by)
      VALUES (${cm.movementId}, ${tenantId}, ${cm.cashboxId}, ${cm.shiftId}, ${cm.amount.currency}::currency_code, ${cm.amount.amountMinor.toString()}, ${cm.kind},
              ${cm.pairId}, ${p.rate === undefined || p.rate === null ? null : p.rate.toString()}, ${p.docType}, ${p.docId}, ${cm.reason}, ${cm.occurredAt}, ${actorId})`;
    return cm.movementId;
  }

  private async audit(tx: Sql, tenantId: string, actorId: string, action: string, entityType: string, entityId: string, data: unknown, approvedBy: string | null = null): Promise<void> {
    await tx`INSERT INTO audit_log (tenant_id, actor_user_id, approved_by, action, entity_type, entity_id, after_data)
      VALUES (${tenantId}, ${actorId}, ${approvedBy}, ${action}, ${entityType}, ${entityId}, ${tx.json(J(data))})`;
  }

  /** Splits the AR credit of a receipt entry into AR (allocated) + customer deposits (unallocated). */
  private splitReceivable(e: JournalEntry, tenantId: string, memo: string, recv: Money, dep: Money, customerId: string): JournalEntry {
    const lines: LineIn[] = [];
    for (const l of e.lines) {
      if (l.accountCode === AR_ACCOUNT && l.credit.isPositive()) {
        if (recv.isPositive()) lines.push({ accountCode: AR_ACCOUNT, credit: recv, memo, dimensions: { customerId }, foreign: null });
        if (dep.isPositive()) lines.push({ accountCode: DEPOSITS_ACCOUNT, credit: dep, memo, dimensions: { customerId }, foreign: null });
      } else if (l.debit.isPositive()) {
        lines.push({ accountCode: l.accountCode, debit: l.debit, memo, dimensions: l.dimensions, foreign: l.foreign });
      } else {
        lines.push({ accountCode: l.accountCode, credit: l.credit, memo, dimensions: l.dimensions, foreign: l.foreign });
      }
    }
    return must(buildJournalEntry({ entryId: e.entryId, tenantId, documentRef: e.documentRef, postedAt: e.postedAt, currency: e.currency, memo, lines }));
  }

  // ------------------------------------------------------------------ customer receipt

  async customerReceipt(tenantId: string, actorId: string, r: CustomerReceiptReq) {
    return this.db.tx(tenantId, async (tx) => {
      const base = await this.base(tx, tenantId);
      const cb = await this.cashbox(tx, tenantId, r.cashboxId);
      const [cust] = await tx<{ id: string }[]>`SELECT id FROM customers WHERE id = ${r.customerId} AND tenant_id = ${tenantId} AND is_active`;
      if (!cust) throw ApiError.notFound("customer.not_found", "Customer not found");
      const shiftId = await this.actorShift(tx, tenantId, cb.id, actorId);
      if (cb.kind === "REGISTER" && shiftId === null) throw ApiError.conflict("shift.not_open", "An open shift on this register is required", { cashboxId: cb.id });
      const amount = Money.minor(BigInt(r.amountMinor), r.currency);
      const rate = await this.bookRate(tx, r.currency, base);
      const allocs = r.allocations ?? [];
      const ids = allocs.map((a) => a.invoiceId);
      if (new Set(ids).size !== ids.length) throw ApiError.badRequest("treasury.duplicate_allocation", "An invoice may appear only once in allocations");
      let allocated = 0n;
      let recvBase = Money.zero(base);
      if (allocs.length > 0) {
        const invs = await tx<{ id: string; customer_id: string | null; currency: CurrencyCode; credit_minor: string; rate_scaled_snapshot: string | null; status: string }[]>`
          SELECT id, customer_id, currency, credit_minor, rate_scaled_snapshot, status FROM sales_invoices
          WHERE tenant_id = ${tenantId} AND id = ANY(${tx.array(ids)}) FOR UPDATE`;
        const paidRows = await tx<{ id: string; s: string }[]>`
          SELECT a->>'documentId' AS id, SUM((a->>'amountMinor')::bigint)::text AS s
          FROM party_payments p CROSS JOIN LATERAL jsonb_array_elements(p.allocations) a
          WHERE p.tenant_id = ${tenantId} AND p.party_type = 'CUSTOMER' AND p.status = 'POSTED' AND p.customer_id = ${r.customerId}
            AND a->>'documentId' = ANY(${tx.array(ids)}) GROUP BY 1`;
        const paid = new Map(paidRows.map((p) => [p.id, BigInt(p.s)]));
        for (const a of allocs) {
          const inv = invs.find((i) => i.id === a.invoiceId);
          if (!inv) throw ApiError.notFound("sales_invoice.not_found", `Invoice ${a.invoiceId} not found`);
          if (inv.status !== "POSTED") throw ApiError.conflict("treasury.invoice_not_posted", "Only posted invoices can be settled", { invoiceId: inv.id });
          if (inv.customer_id !== r.customerId) throw unprocessable("treasury.allocation_customer_mismatch", "Invoice belongs to another customer", { invoiceId: inv.id });
          if (inv.currency !== r.currency) throw unprocessable("treasury.allocation_currency_mismatch", "Receipt currency must match invoice currency", { invoiceId: inv.id, expected: inv.currency });
          const amt = BigInt(a.amountMinor);
          const outstanding = BigInt(inv.credit_minor) - (paid.get(inv.id) ?? 0n);
          if (amt > outstanding) {
            throw unprocessable("treasury.allocation_exceeds_outstanding", "Allocation exceeds invoice outstanding", { invoiceId: inv.id, outstandingMinor: outstanding.toString(), allocationMinor: amt.toString() });
          }
          allocated += amt;
          const m = Money.minor(amt, inv.currency);
          if (inv.currency === base) recvBase = recvBase.add(m);
          else {
            const invRate = inv.rate_scaled_snapshot !== null ? BigInt(inv.rate_scaled_snapshot) : rate;
            if (invRate === undefined) throw ApiError.conflict("fx.rate_missing", "No rate for invoice currency");
            recvBase = recvBase.add(convertScaled(m, invRate, base));
          }
        }
      }
      if (allocated > amount.amountMinor) throw unprocessable("treasury.allocation_exceeds_amount", "Allocations exceed the receipt amount", { amountMinor: amount.amountMinor.toString(), allocatedMinor: allocated.toString() });
      const unalloc = amount.amountMinor - allocated;
      let depBase = Money.zero(base);
      if (unalloc > 0n) {
        const um = Money.minor(unalloc, r.currency);
        depBase = r.currency === base ? um : convertScaled(um, rate ?? 0n, base);
      }
      const id = randomUUID();
      const number = await this.nextNo(tx, tenantId, "PAYMENT");
      const businessDate = r.businessDate ?? today();
      const memo = `Customer receipt ${number}`;
      const meta = this.meta(tenantId, base, "PARTY_PAYMENT", id, memo);
      let entry = must(postCustomerReceipt({ meta, customerId: r.customerId, via: fundsOf(cb), amount, rateScaled: rate, receivableBase: recvBase.add(depBase) }));
      if (depBase.isPositive()) entry = this.splitReceivable(entry, tenantId, memo, recvBase, depBase, r.customerId);
      const allocJson = allocs.map((a) => ({ documentType: "SALES_INVOICE", documentId: a.invoiceId, amountMinor: a.amountMinor }));
      await tx`INSERT INTO party_payments (id, tenant_id, number, status, party_type, customer_id, cashbox_id, shift_id, method, currency, amount_minor, rate_scaled_snapshot, allocations, business_date, reference, posted_at, posted_by)
        VALUES (${id}, ${tenantId}, ${number}, 'POSTED', 'CUSTOMER', ${r.customerId}, ${cb.id}, ${shiftId}, ${r.method}::payment_method, ${r.currency}::currency_code,
                ${amount.amountMinor.toString()}, ${rate === undefined ? null : rate.toString()}, ${tx.json(allocJson)}, ${businessDate}, ${r.reference ?? null}, now(), ${actorId})`;
      const movementId = await this.move(tx, tenantId, actorId, { cashboxId: cb.id, shiftId, kind: "CUSTOMER_PAYMENT", amount, docType: "PARTY_PAYMENT", docId: id, rate: rate ?? null, reason: memo });
      await persistEntry(tx, tenantId, entry, businessDate, actorId);
      await this.lockBase(tx, tenantId);
      const result = { id, number, entryId: entry.entryId, movementId, amount, receivableBase: recvBase, depositBase: depBase, allocations: allocJson };
      await this.audit(tx, tenantId, actorId, "customer_receipt.post", "party_payment", id, result);
      return J(result);
    });
  }

  // ------------------------------------------------------------------ expense

  async expense(tenantId: string, actorId: string, r: ExpenseReq) {
    return this.db.tx(tenantId, async (tx) => {
      const base = await this.base(tx, tenantId);
      const cb = await this.cashbox(tx, tenantId, r.cashboxId);
      const [cat] = await tx<{ id: string; account_code: string; is_active: boolean }[]>`SELECT id, account_code, is_active FROM expense_categories WHERE id = ${r.categoryId} AND tenant_id = ${tenantId}`;
      if (!cat) throw ApiError.notFound("expense_category.not_found", "Expense category not found");
      if (!cat.is_active) throw ApiError.conflict("expense_category.inactive", "Expense category is inactive");
      const amount = Money.minor(BigInt(r.amountMinor), r.currency);
      const vat = r.inputVatMinor !== undefined && BigInt(r.inputVatMinor) > 0n ? Money.minor(BigInt(r.inputVatMinor), r.currency) : undefined;
      const gross = vat === undefined ? amount : amount.add(vat);
      const rate = await this.bookRate(tx, r.currency, base);
      const id = randomUUID();
      const number = await this.nextNo(tx, tenantId, "EXPENSE");
      const businessDate = r.businessDate ?? today();
      const meta = this.meta(tenantId, base, "EXPENSE", id, `Expense ${number}: ${r.description}`);
      const entry = must(postExpense({
        meta, categoryAccountCode: cat.account_code, amount, inputVat: vat, vatAccountCode: vat === undefined ? undefined : INPUT_VAT_ACCOUNT,
        rateScaled: rate, paidFrom: { kind: "FUNDS", via: fundsOf(cb) },
      }));
      await this.ensureFunds(tx, cb, r.currency, gross.amountMinor);
      const shiftId = await this.actorShift(tx, tenantId, cb.id, actorId);
      await tx`INSERT INTO expenses (id, tenant_id, number, status, category_id, cashbox_id, shift_id, currency, amount_minor, rate_scaled_snapshot, business_date, description, approved_by, posted_at, posted_by)
        VALUES (${id}, ${tenantId}, ${number}, 'POSTED', ${cat.id}, ${cb.id}, ${shiftId}, ${r.currency}::currency_code, ${gross.amountMinor.toString()},
                ${rate === undefined ? null : rate.toString()}, ${businessDate}, ${r.description}, ${r.approver ?? null}, now(), ${actorId})`;
      const movementId = await this.move(tx, tenantId, actorId, { cashboxId: cb.id, shiftId, kind: "EXPENSE", amount: gross.negate(), docType: "EXPENSE", docId: id, rate: rate ?? null, reason: r.description });
      await persistEntry(tx, tenantId, entry, businessDate, actorId);
      await this.lockBase(tx, tenantId);
      const result = { id, number, entryId: entry.entryId, movementId, amount, inputVat: vat ?? null, gross, categoryAccountCode: cat.account_code };
      await this.audit(tx, tenantId, actorId, "expense.post", "expense", id, result, r.approver ?? null);
      return J(result);
    });
  }

  // ------------------------------------------------------------------ transfer

  async transfer(tenantId: string, actorId: string, r: TransferReq) {
    return this.db.tx(tenantId, async (tx) => {
      const base = await this.base(tx, tenantId);
      const from = await this.cashbox(tx, tenantId, r.fromCashboxId);
      const to = await this.cashbox(tx, tenantId, r.toCashboxId);
      const toCurrency = r.toCurrency ?? r.currency;
      if (toCurrency !== r.currency && r.toAmountMinor === undefined) {
        throw ApiError.badRequest("treasury.to_amount_required", "toAmountMinor is required for cross-currency transfers");
      }
      const amount = Money.minor(BigInt(r.amountMinor), r.currency);
      const toAmount = Money.minor(BigInt(r.toAmountMinor ?? r.amountMinor), toCurrency);
      const fromRate = await this.bookRate(tx, r.currency, base);
      const toRate = await this.bookRate(tx, toCurrency, base);
      const pairId = randomUUID();
      const businessDate = r.businessDate ?? today();
      const meta = this.meta(tenantId, base, "CASH_TRANSFER", pairId, `Cash transfer ${from.code}→${to.code}: ${r.reason}`);
      const entry = must(postCashTransfer({ meta, from: fundsOf(from), to: fundsOf(to), amount, fromRateScaled: fromRate, toAmount, toRateScaled: toRate }));
      await this.ensureFunds(tx, from, r.currency, amount.amountMinor);
      const fromShift = await this.actorShift(tx, tenantId, from.id, actorId);
      const toShift = await this.actorShift(tx, tenantId, to.id, actorId);
      const outId = await this.move(tx, tenantId, actorId, { cashboxId: from.id, shiftId: fromShift, kind: "TRANSFER_OUT", amount: amount.negate(), docType: "CASH_TRANSFER", docId: pairId, pairId, rate: fromRate ?? null, reason: r.reason });
      const inId = await this.move(tx, tenantId, actorId, { cashboxId: to.id, shiftId: toShift, kind: "TRANSFER_IN", amount: toAmount, docType: "CASH_TRANSFER", docId: pairId, pairId, rate: toRate ?? null, reason: r.reason });
      await persistEntry(tx, tenantId, entry, businessDate, actorId);
      const result = { pairId, entryId: entry.entryId, outMovementId: outId, inMovementId: inId, amount, toAmount };
      await this.audit(tx, tenantId, actorId, "cash.transfer", "cash_transfer", pairId, result);
      return J(result);
    });
  }

  // ------------------------------------------------------------------ fx exchange

  async fxExchange(tenantId: string, actorId: string, r: FxReq) {
    return this.db.tx(tenantId, async (tx) => {
      const base = await this.base(tx, tenantId);
      const cb = await this.cashbox(tx, tenantId, r.cashboxId);
      const given = Money.minor(BigInt(r.fromAmountMinor), r.fromCurrency);
      const received = Money.minor(BigInt(r.toAmountMinor), r.toCurrency);
      const pairId = randomUUID();
      const meta = this.meta(tenantId, base, "FX_EXCHANGE", pairId, `Currency exchange ${r.fromCurrency}→${r.toCurrency} ${cb.code}`);
      if (given.currency === received.currency) {
        must(postFxExchange({ meta, cashbox: fundsOf(cb), given, received }));
      }
      const givenRate = await this.bookRate(tx, r.fromCurrency, base);
      const receivedRate = await this.bookRate(tx, r.toCurrency, base);
      const entry = must(postFxExchange({ meta, cashbox: fundsOf(cb), given, givenRateScaled: givenRate, received, receivedRateScaled: receivedRate }));
      await this.ensureFunds(tx, cb, r.fromCurrency, given.amountMinor);
      // deal rate: units of toCurrency (minor) per 1 fromCurrency (minor) × RATE_SCALE, Half-Up
      const g = given.amountMinor;
      const dealRate = (received.amountMinor * RATE_SCALE * 2n + g) / (2n * g);
      const shiftId = await this.actorShift(tx, tenantId, cb.id, actorId);
      const businessDate = r.businessDate ?? today();
      const outId = await this.move(tx, tenantId, actorId, { cashboxId: cb.id, shiftId, kind: "FX_OUT", amount: given.negate(), docType: "FX_EXCHANGE", docId: pairId, pairId, rate: dealRate, counterCurrency: received.currency, reason: "FX exchange" });
      const inId = await this.move(tx, tenantId, actorId, { cashboxId: cb.id, shiftId, kind: "FX_IN", amount: received, docType: "FX_EXCHANGE", docId: pairId, pairId, rate: dealRate, counterCurrency: given.currency, reason: "FX exchange" });
      await persistEntry(tx, tenantId, entry, businessDate, actorId);
      const result = { pairId, entryId: entry.entryId, outMovementId: outId, inMovementId: inId, given, received, dealRateScaled: dealRate, givenBookRateScaled: givenRate ?? null, receivedBookRateScaled: receivedRate ?? null };
      await this.audit(tx, tenantId, actorId, "cash.fx_exchange", "fx_exchange", pairId, result);
      return J(result);
    });
  }

  // ------------------------------------------------------------------ owner capital / drawings

  async ownerTxn(tenantId: string, actorId: string, r: OwnerReq) {
    return this.db.tx(tenantId, async (tx) => {
      const base = await this.base(tx, tenantId);
      const cb = await this.cashbox(tx, tenantId, r.cashboxId);
      const amount = Money.minor(BigInt(r.amountMinor), r.currency);
      const rate = await this.bookRate(tx, r.currency, base);
      const id = randomUUID();
      const businessDate = r.businessDate ?? today();
      const meta = this.meta(tenantId, base, r.kind, id, `${r.kind === "CAPITAL" ? "Capital injection" : "Owner drawing"}: ${r.memo}`);
      const input = { meta, via: fundsOf(cb), amount, rateScaled: rate };
      const entry = must(r.kind === "CAPITAL" ? postCapitalInjection(input) : postOwnerDrawing(input));
      if (r.kind === "OWNER_DRAWING") await this.ensureFunds(tx, cb, r.currency, amount.amountMinor);
      const shiftId = await this.actorShift(tx, tenantId, cb.id, actorId);
      await this.move(tx, tenantId, actorId, {
        cashboxId: cb.id, shiftId, kind: r.kind, amount: r.kind === "CAPITAL" ? amount : amount.negate(),
        docType: r.kind, docId: id, rate: rate ?? null, reason: r.memo,
      });
      await persistEntry(tx, tenantId, entry, businessDate, actorId);
      const result = { id, kind: r.kind, entryId: entry.entryId, amount };
      await this.audit(tx, tenantId, actorId, r.kind === "CAPITAL" ? "owner.capital" : "owner.drawing", "cash_movement", id, result);
      return J(result);
    });
  }

  // ------------------------------------------------------------------ opening balances

  async openingBalances(tenantId: string, actorId: string, r: OpeningReq) {
    return this.db.tx(tenantId, async (tx) => {
      const [t] = await tx<{ base_currency: CurrencyCode; posted: string | null }[]>`
        SELECT base_currency, settings->>'opening_posted' AS posted FROM tenants WHERE id = ${tenantId} FOR UPDATE`;
      if (!t) throw ApiError.notFound("tenant.not_found", "Tenant not found");
      if (t.posted === "true") throw ApiError.conflict("treasury.opening_already_posted", "Opening balances were already posted");
      const base = t.base_currency;
      const cbIds = [...new Set(r.lines.flatMap((l) => (l.cashboxId === undefined ? [] : [l.cashboxId])))];
      const cbs = cbIds.length === 0 ? [] : await tx<CashboxRow[]>`SELECT id, code, kind, is_active FROM cashboxes WHERE tenant_id = ${tenantId} AND id = ANY(${tx.array(cbIds)})`;
      const cbMap = new Map(cbs.map((c) => [c.id, c]));
      for (const id of cbIds) if (!cbMap.has(id)) throw ApiError.notFound("cashbox.not_found", `Cashbox ${id} not found`);
      const rates = new Map<CurrencyCode, bigint | undefined>();
      for (const cur of new Set(r.lines.map((l) => l.currency ?? base))) rates.set(cur, await this.bookRate(tx, cur, base));
      const lines: OpeningBalanceLine[] = r.lines.map((l) => {
        const cur = l.currency ?? base;
        if (l.cashboxId !== undefined && l.side !== "DEBIT") {
          throw unprocessable("treasury.opening_cash_credit", "Cashbox opening balances must be debits", { accountCode: l.accountCode, cashboxId: l.cashboxId });
        }
        return {
          accountCode: l.accountCode, side: l.side, amount: Money.minor(BigInt(l.amountMinor), cur), rateScaled: rates.get(cur),
          ...(l.cashboxId !== undefined ? { dimensions: { cashboxId: l.cashboxId } } : {}),
        };
      });
      const docId = randomUUID();
      const meta = this.meta(tenantId, base, "OPENING_BALANCE", docId, `Opening balances ${r.businessDate}`);
      const entry = must(postOpeningBalances({ meta, lines, balancingAccountCode: OPENING_BALANCING_ACCOUNT }));
      for (const l of r.lines) {
        if (l.cashboxId === undefined) continue;
        await this.move(tx, tenantId, actorId, {
          cashboxId: l.cashboxId, shiftId: null, kind: "CAPITAL", amount: Money.minor(BigInt(l.amountMinor), l.currency ?? base),
          docType: "OPENING_BALANCE", docId, rate: rates.get(l.currency ?? base) ?? null, reason: "Opening balance",
        });
      }
      await persistEntry(tx, tenantId, entry, r.businessDate, actorId);
      await tx`UPDATE tenants SET settings = settings || jsonb_build_object('opening_posted', true), updated_at = now() WHERE id = ${tenantId}`;
      await this.lockBase(tx, tenantId);
      const result = { id: docId, entryId: entry.entryId, businessDate: r.businessDate, lines: entry.lines.length };
      await this.audit(tx, tenantId, actorId, "opening_balances.post", "journal_entry", entry.entryId, result);
      return J(result);
    });
  }

  // ------------------------------------------------------------------ lists

  async expenseCategories(tenantId: string) {
    return this.db.tx(tenantId, async (tx) =>
      J(await tx`SELECT id, parent_id, code, name_ar, name_en, account_code, is_active FROM expense_categories WHERE tenant_id = ${tenantId} ORDER BY code`));
  }

  async cashboxes(tenantId: string) {
    return this.db.tx(tenantId, async (tx) =>
      J(await tx`SELECT id, code, name_ar, name_en, kind, is_active FROM cashboxes WHERE tenant_id = ${tenantId} ORDER BY code`));
  }
}
