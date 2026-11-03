import { Inject, Injectable } from "@nestjs/common";
import type { Sql } from "@pharmacore/db";
import {
  ACCOUNT_CODES, ExchangeRate, Lot, Money, SalesInvoice, allocateFefo, cashAccountFor, isErr, isoDateFromDate, postEntry, salesInvoicePosted, settleInvoice,
  type CurrencyCode, type GuardOverride, type InvoiceDiscount, type ItemUnit, type LineDiscount, type LotBalance, type LotManualStatus,
  type PaymentPart, type Prescription, type RxRequired, type ControlledClass, type Tender, type TenderMethod, type JournalEntry,
} from "@pharmacore/domain";
import { Db } from "../infra/db.js";
import { AuthService } from "../identity/auth.service.js";
import { ApiError } from "../shared/errors.js";

export interface SaleLineReq {
  itemId: string; unitId: string; qtyInUnit: number; unitPriceMinor?: string | undefined; lineDiscountBp?: number | undefined; lineDiscountMinor?: string | undefined;
  /** FEFO override requires `overrides` (manager approval) on the request. */
  lotOverride?: { lotId: string; reason: string } | undefined; note?: string | undefined;
}
export interface SaleReq {
  customerId?: string | undefined; locationId?: string | undefined; currency?: CurrencyCode | undefined; businessDate?: string | undefined;
  lines: SaleLineReq[]; invoiceDiscountBp?: number | undefined; invoiceDiscountMinor?: string | undefined;
  prescription?: { patientName: string; doctorName: string; rxNumber: string; rxDate: string; patientIdNo?: string | undefined } | undefined;
  tenders: Array<{ method: TenderMethod; currency: CurrencyCode; amountMinor: string; paymentRef?: string | undefined; cashboxId?: string | undefined }>;
  changeCurrency?: CurrencyCode | undefined;
  /** Manager approval: username + PIN (or password) verified server-side; the approver must hold the relevant permission. */
  overrides?: { approverUsername: string; approverSecret: string; reason: string; belowMin?: boolean | undefined; belowCost?: boolean | undefined; aboveOfficial?: boolean | undefined; credit?: boolean | undefined } | undefined;
  idempotencyKey?: string | undefined; notes?: string | undefined;
}

interface TenantRow { base_currency: CurrencyCode; official_price_policy: "BLOCK" | "BLOCK_WITH_OVERRIDE" | "WARN"; discount_posting: "NET" | "GROSS"; cash_round_step_minor: string; settings: Record<string, unknown> }
interface ItemRow { id: string; trade_name_ar: string; trade_name_en: string; is_active: boolean; rx_required: RxRequired; controlled_class: ControlledClass; tax_bp: number; is_returnable: boolean }
interface UnitRow { id: string; item_id: string; name_ar: string; name_en: string; factor_to_ssu: string; level: number; is_ssu: boolean; can_sell: boolean; can_purchase: boolean; is_active: boolean }
interface LotRow { id: string; item_id: string; lot_number: string; expiry_date: string | null; qty_received_ssu: string; total_cost_minor: string; cost_currency: CurrencyCode; supplier_id: string | null; source_type: "OFFICIAL" | "PARALLEL"; printed_public_price_minor: string | null; manual_status: LotManualStatus; received_at: Date; qty_ssu: string }

const J = (v: unknown) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x instanceof Money ? { currency: x.currency, amountMinor: x.amountMinor.toString() } : x)));
const PM: Record<TenderMethod, string> = { CASH: "CASH", CARD: "CARD", WALLET: "WALLET", CREDIT: "CREDIT" };

function hydrateLot(r: LotRow): Lot {
  const l = Lot.create({ lotId: r.id, itemId: r.item_id, lotNumber: r.lot_number, expiryDate: r.expiry_date ?? "9999-12-31", qtyReceivedSsu: BigInt(r.qty_received_ssu), totalCostMinor: Money.minor(BigInt(r.total_cost_minor), r.cost_currency), sourceType: r.source_type, supplierId: r.supplier_id ?? undefined, printedPublicPriceMinor: r.printed_public_price_minor ? Money.minor(BigInt(r.printed_public_price_minor), r.cost_currency) : undefined, manualStatus: r.manual_status });
  if (isErr(l)) throw l.error;
  return l.value;
}

@Injectable()
export class SalesService {
  constructor(@Inject(Db) private readonly db: Db, @Inject(AuthService) private readonly auth: AuthService) {}

  /** Verifies the approver once per needed permission; returns approver user id. */
  private async approver(tenantId: string, ov: NonNullable<SaleReq["overrides"]>): Promise<string> {
    const needed: string[] = [];
    if (ov.belowMin) needed.push("sales.sell_below_min");
    if (ov.belowCost) needed.push("sales.sell_below_cost");
    if (ov.aboveOfficial) needed.push("sales.override_official_price");
    if (ov.credit) needed.push("sales.credit");
    let id = "";
    for (const perm of needed) id = (await this.auth.elevate(tenantId, { username: ov.approverUsername, secret: ov.approverSecret }, perm)).approverId;
    return id;
  }

  private async rate(tx: Sql, from: CurrencyCode, to: CurrencyCode): Promise<ExchangeRate> {
    const [r] = await tx<Array<{ from_currency: CurrencyCode; to_currency: CurrencyCode; buy_rate_scaled: string; sell_rate_scaled: string; effective_from: Date }>>`
      SELECT * FROM exchange_rates WHERE from_currency = ${from} AND to_currency = ${to} AND effective_from <= now() ORDER BY effective_from DESC LIMIT 1`;
    if (!r) throw ApiError.conflict("fx.rate_missing", `No exchange rate ${from}→${to}`, { from, to });
    const er = ExchangeRate.create({ from: r.from_currency, to: r.to_currency, buyRateScaled: BigInt(r.buy_rate_scaled), sellRateScaled: BigInt(r.sell_rate_scaled), effectiveFrom: r.effective_from });
    if (isErr(er)) throw er.error;
    return er.value;
  }

  /** Resolve the selling price for item/unit: customer price list → retail list; min price alongside. */
  private async resolvePrice(tx: Sql, itemId: string, unitId: string, customerPriceListId: string | null, currency: CurrencyCode) {
    const rows = await tx<Array<{ unit_price_minor: string; min_price_minor: string | null; price_list_id: string; kind: string; priority: number }>>`
      SELECT p.unit_price_minor, p.min_price_minor, p.price_list_id, pl.kind, pl.priority FROM price_list_items p JOIN price_lists pl ON pl.id = p.price_list_id
      WHERE p.item_id = ${itemId} AND p.unit_id = ${unitId} AND pl.currency = ${currency} AND pl.is_active AND p.effective_from <= now() AND (p.effective_to IS NULL OR p.effective_to > now())
      ORDER BY (p.price_list_id = ${customerPriceListId}) DESC, pl.priority DESC, p.effective_from DESC`;
    const [official] = await tx<Array<{ public_price_minor: string }>>`SELECT public_price_minor FROM official_prices WHERE item_id = ${itemId} AND unit_id = ${unitId} AND currency = ${currency} AND effective_from <= CURRENT_DATE AND (effective_to IS NULL OR effective_to >= CURRENT_DATE) ORDER BY effective_from DESC LIMIT 1`;
    const best = rows[0];
    return {
      price: best ? Money.minor(BigInt(best.unit_price_minor), currency) : null,
      source: best ? (best.price_list_id === customerPriceListId ? ("CUSTOMER" as const) : ("UNIT" as const)) : null,
      min: best?.min_price_minor ? Money.minor(BigInt(best.min_price_minor), currency) : null,
      official: official ? Money.minor(BigInt(official.public_price_minor), currency) : null,
    };
  }

  /** Price + stock quote for the POS screen (no side effects). */
  async quote(tenantId: string, req: SaleReq) {
    return this.db.tx(tenantId, async (tx) => {
      const built = await this.build(tx, tenantId, "quote", req, "00000000-0000-0000-0000-000000000000");
      return { totals: J(built.totals), lines: built.lineViews, warnings: [] };
    });
  }

  /** Builds the domain aggregate (DRAFT with lots allocated) + computes totals. */
  private async build(tx: Sql, tenantId: string, invoiceId: string, req: SaleReq, cashierId: string, approverId: string | null = null) {
    const [t] = await tx<TenantRow[]>`SELECT base_currency, official_price_policy, discount_posting, cash_round_step_minor, settings FROM tenants WHERE id = ${tenantId}`;
    const tenant = t!;
    const currency = req.currency ?? tenant.base_currency;
    const businessDate = req.businessDate ?? isoDateFromDate(new Date());
    const [loc] = req.locationId ? await tx<{ id: string }[]>`SELECT id FROM locations WHERE id = ${req.locationId} AND is_sellable` : await tx<{ id: string }[]>`SELECT id FROM locations WHERE code = 'MAIN'`;
    if (!loc) throw ApiError.badRequest("locations.not_sellable", "Location not found or not sellable");
    const [cust] = req.customerId ? await tx<Array<{ id: string; price_list_id: string | null; is_walk_in: boolean; credit_limit_minor: string; is_active: boolean }>>`SELECT id, price_list_id, is_walk_in, credit_limit_minor, is_active FROM customers WHERE id = ${req.customerId}` : await tx<Array<{ id: string; price_list_id: string | null; is_walk_in: boolean; credit_limit_minor: string; is_active: boolean }>>`SELECT id, price_list_id, is_walk_in, credit_limit_minor, is_active FROM customers WHERE is_walk_in LIMIT 1`;
    if (!cust || !cust.is_active) throw ApiError.badRequest("customers.not_found", "Customer not found");

    let inv = (() => { const r = SalesInvoice.create({ invoiceId, tenantId, clientUuid: req.idempotencyKey ?? invoiceId, currency, customerId: cust.id, locationId: loc.id, cashierId, createdAt: new Date().toISOString() }); if (isErr(r)) throw r.error; return r.value; })();
    const lineViews: unknown[] = [];
    const nearExpiryDays = typeof tenant.settings["near_expiry_days"] === "number" ? (tenant.settings["near_expiry_days"] as number) : 90;
    const lotMap = new Map<string, Lot>();
    /** SSU already allocated to earlier lines of this invoice, per lot — the DB balance is not yet decremented. */
    const reserved = new Map<string, bigint>();

    for (const [i, l] of req.lines.entries()) {
      const lineId = `L${i + 1}`;
      const [item] = await tx<ItemRow[]>`SELECT id, trade_name_ar, trade_name_en, is_active, rx_required, controlled_class, tax_bp, is_returnable FROM items WHERE id = ${l.itemId}`;
      if (!item) throw ApiError.notFound("items.not_found", `Item ${l.itemId} not found`);
      const [u] = await tx<UnitRow[]>`SELECT * FROM item_units WHERE id = ${l.unitId} AND item_id = ${l.itemId}`;
      if (!u) throw ApiError.badRequest("units.not_found", "Unit does not belong to item");
      if (!u.can_sell) throw ApiError.conflict("units.not_sellable", "Unit cannot be sold", { unitId: u.id });
      const unit: ItemUnit = { unitId: u.id, itemId: u.item_id, nameAr: u.name_ar, nameEn: u.name_en, factorToSsu: BigInt(u.factor_to_ssu), level: u.level, isSsu: u.is_ssu, canSell: u.can_sell, canPurchase: u.can_purchase, active: u.is_active };
      const pr = await this.resolvePrice(tx, l.itemId, l.unitId, cust.price_list_id, currency);
      const unitPrice = l.unitPriceMinor ? Money.minor(BigInt(l.unitPriceMinor), currency) : pr.price;
      if (!unitPrice) throw ApiError.conflict("prices.missing", `No ${currency} price for item/unit`, { itemId: l.itemId, unitId: l.unitId });
      const discounts: LineDiscount[] = [];
      if (l.lineDiscountBp) discounts.push({ type: "LINE_PERCENT", source: "manual", bp: l.lineDiscountBp });
      if (l.lineDiscountMinor) discounts.push({ type: "LINE_AMOUNT", source: "manual", amount: Money.minor(BigInt(l.lineDiscountMinor), currency) });
      const added = inv.addLine({
        lineId, itemId: item.id, itemNameAr: item.trade_name_ar, itemNameEn: item.trade_name_en, itemActive: item.is_active, unit, qtyInUnit: BigInt(l.qtyInUnit),
        unitPrice, priceSource: l.unitPriceMinor ? "MANUAL" : (pr.source ?? "UNIT"), regulatedUnitPriceSnapshot: pr.official, minUnitPrice: pr.min,
        rx: { rxRequired: item.rx_required, controlledClass: item.controlled_class }, discounts, taxBp: item.tax_bp, lineNote: l.note,
      });
      if (isErr(added)) throw added.error;
      inv = added.value;
      // FEFO
      const qtySsu = BigInt(l.qtyInUnit) * unit.factorToSsu;
      const lotRows = await tx<LotRow[]>`SELECT l.*, b.qty_ssu FROM stock_balances b JOIN lots l ON l.id = b.lot_id WHERE b.item_id = ${l.itemId} AND b.location_id = ${loc.id} AND b.qty_ssu > 0`;
      const balances: LotBalance[] = lotRows
        .map((r) => { const lot = hydrateLot(r); lotMap.set(lot.lotId, lot); return { lot, availableSsu: BigInt(r.qty_ssu) - (reserved.get(lot.lotId) ?? 0n), receivedAt: r.received_at.toISOString() }; })
        .filter((b) => b.availableSsu > 0n);
      const fefo = allocateFefo(
        { itemId: l.itemId, qtySsu, businessDate, lots: balances, overrideLotId: l.lotOverride?.lotId, override: l.lotOverride ? { permission: "inventory.lot_override_fefo", approvedBy: approverId ?? "unverified", reason: l.lotOverride.reason } : undefined },
        { allowNegativeStock: false, nearExpiryDays },
      );
      if (isErr(fefo)) throw fefo.error;
      const assigned = inv.assignLots(lineId, fefo.value, lotMap, businessDate);
      if (isErr(assigned)) throw assigned.error;
      inv = assigned.value;
      for (const a of fefo.value.allocations) reserved.set(a.lotId, (reserved.get(a.lotId) ?? 0n) + a.qtySsu);
      lineViews.push({ lineId, itemId: item.id, itemNameAr: item.trade_name_ar, itemNameEn: item.trade_name_en, unitId: u.id, unitNameAr: u.name_ar, unitNameEn: u.name_en, qtyInUnit: l.qtyInUnit, qtySsu: qtySsu.toString(), unitPriceMinor: unitPrice.amountMinor.toString(), priceSource: l.unitPriceMinor ? "MANUAL" : pr.source, minPriceMinor: pr.min?.amountMinor.toString() ?? null, officialPriceMinor: pr.official?.amountMinor.toString() ?? null, lots: fefo.value.allocations.map((a) => ({ lotId: a.lotId, lotNumber: lotMap.get(a.lotId)?.lotNumber, expiryDate: a.expiryDate, qtySsu: a.qtySsu.toString(), status: a.status })) });
    }
    if (req.invoiceDiscountBp || req.invoiceDiscountMinor) {
      const d: InvoiceDiscount = req.invoiceDiscountBp ? { type: "INVOICE_PERCENT", source: "manual", bp: req.invoiceDiscountBp } : { type: "INVOICE_AMOUNT", source: "manual", amount: Money.minor(BigInt(req.invoiceDiscountMinor!), currency) };
      const r = inv.setInvoiceDiscount(d); if (isErr(r)) throw r.error; inv = r.value;
    }
    if (req.prescription) {
      const p: Prescription = { patientName: req.prescription.patientName, doctorName: req.prescription.doctorName, rxNumber: req.prescription.rxNumber, rxDate: req.prescription.rxDate, patientIdNo: req.prescription.patientIdNo };
      const r = inv.setPrescription(p); if (isErr(r)) throw r.error; inv = r.value;
    }
    const step = BigInt(tenant.cash_round_step_minor);
    const cashRounding = step > 0n ? { stepMinor: step, mode: "half_up" as const } : null;
    const totals = inv.computeTotals(cashRounding);
    if (isErr(totals)) throw totals.error;
    return { inv, totals: totals.value, tenant, currency, businessDate, customer: cust, location: loc, cashRounding, lotMap, lineViews };
  }

  /** Creates and POSTS a sale in ONE transaction: invoice rows, SALE movements, payments, cash movements, journal entry. */
  async post(tenantId: string, actor: { userId: string; permissions: ReadonlySet<string>; limits: Readonly<Record<string, number>> }, req: SaleReq) {
    const approverId = req.overrides ? await this.approver(tenantId, req.overrides) : null;
    return this.db.tx(tenantId, async (tx) => {
      if (req.idempotencyKey) {
        const [dup] = await tx<{ id: string; number: string }[]>`SELECT id, number FROM sales_invoices WHERE idempotency_key = ${req.idempotencyKey}`;
        if (dup) return { id: dup.id, number: dup.number, idempotent: true };
      }
      const [shift] = await tx<{ id: string; cashbox_id: string }[]>`SELECT id, cashbox_id FROM shifts WHERE cashier_id = ${actor.userId} AND status = 'OPEN'`;
      if (!shift) throw ApiError.conflict("shifts.none_open", "Open a shift before selling");
      const invoiceId = crypto.randomUUID();
      if (req.lines.some((l) => l.lotOverride) && !approverId) throw ApiError.forbidden("sales.fefo_override_needs_approval", "Lot override requires manager approval (overrides)");
      const b = await this.build(tx, tenantId, invoiceId, req, actor.userId, approverId);
      const { tenant, currency } = b;

      // ---- settlement (multi-currency tenders)
      const tenders: Tender[] = [];
      for (const td of req.tenders) {
        const amount = Money.minor(BigInt(td.amountMinor), td.currency);
        tenders.push({ method: td.method, amount, rate: td.currency === currency ? undefined : await this.rate(tx, td.currency, currency), paymentRef: td.paymentRef, accountId: td.cashboxId ?? shift.cashbox_id });
      }
      const changeCurrency = req.changeCurrency ?? currency;
      const [creditSum] = await tx<{ s: string }[]>`SELECT COALESCE(SUM(credit_minor),0)::text AS s FROM sales_invoices WHERE customer_id = ${b.customer.id} AND status = 'POSTED' AND currency = ${currency}`;
      const [paid] = await tx<{ s: string }[]>`SELECT COALESCE(SUM(amount_minor),0)::text AS s FROM party_payments WHERE party_type = 'CUSTOMER' AND customer_id = ${b.customer.id} AND status = 'POSTED' AND currency = ${currency}`;
      const outstanding = Money.minor(BigInt(creditSum!.s) - BigInt(paid!.s), currency);
      const creditLimit = Money.minor(BigInt(b.customer.credit_limit_minor), currency);
      const settlement = settleInvoice({
        total: b.totals.total, tenders,
        change: { currency: changeCurrency, cashStepMinor: BigInt(tenant.cash_round_step_minor) > 0n ? BigInt(tenant.cash_round_step_minor) : 1n, rate: changeCurrency === currency ? undefined : await this.rate(tx, currency, changeCurrency) },
        credit: { allowCredit: !b.customer.is_walk_in && creditLimit.isPositive(), outstanding, creditLimit },
        creditOverride: req.overrides?.credit && approverId ? { permission: "customers.credit_override", approvedBy: approverId, reason: req.overrides.reason } : undefined,
      });
      if (isErr(settlement)) throw settlement.error;
      const st = settlement.value;

      // ---- post via domain aggregate (guards: min/cost/official, rx, credit, zero)
      const [num] = await tx<{ n: string }[]>`SELECT next_document_number(${tenantId}, 'SALES_INVOICE', '') AS n`;
      const ov = req.overrides;
      const go = (flag: boolean | undefined, perm: string): GuardOverride | undefined => (flag && ov && approverId ? { approverId, permissions: [perm], reason: ov.reason } : undefined);
      const priceOverrides: Record<string, { belowMin?: GuardOverride | undefined; belowCost?: GuardOverride | undefined; aboveOfficial?: GuardOverride | undefined }> = {};
      for (const l of b.inv.lines) priceOverrides[l.lineId] = { belowMin: go(ov?.belowMin, "sales.sell_below_min"), belowCost: go(ov?.belowCost, "sales.sell_below_cost"), aboveOfficial: go(ov?.aboveOfficial, "sales.override_official_price") };
      // manual discount limit (bp) from the actor's effective limits
      const maxBp = actor.limits["sales.discount_line"];
      const posted = b.inv.post({
        docNo: num!.n, businessDate: b.businessDate, postedAt: new Date(), cashRounding: b.cashRounding, limits: maxBp !== undefined ? { userMaxLineBp: maxBp } : {},
        pricePolicies: { belowMin: "BLOCK_WITH_OVERRIDE", belowCost: "BLOCK_WITH_OVERRIDE", aboveOfficial: tenant.official_price_policy }, priceOverrides,
        credit: st.creditMinor.isPositive() ? { customer: { customerId: b.customer.id, isWalkIn: b.customer.is_walk_in, creditBlocked: false, creditLimit, outstanding, oldestOverdueDays: 0, maxOverdueDays: null }, creditPortion: st.creditMinor, override: go(ov?.credit, "sales.credit") } : undefined,
      });
      if (isErr(posted)) throw posted.error;
      const intent = posted.value.toPostingIntent();
      if (isErr(intent)) throw intent.error;
      const it = intent.value;
      const a = it.accounting;

      // ---- persist invoice header + lines + lots + payments
      await tx`INSERT INTO sales_invoices (id, tenant_id, number, status, customer_id, shift_id, cashier_id, currency, price_list_id, business_date, gross_minor, line_discount_minor, invoice_discount_minor, invoice_discount_bp, net_minor, tax_minor, total_minor, rounding_adjustment_minor, paid_minor, credit_minor, prescription, notes, idempotency_key, posted_at, posted_by)
        VALUES (${invoiceId}, ${tenantId}, ${it.docNo}, 'POSTED', ${b.customer.id}, ${shift.id}, ${actor.userId}, ${currency}, ${b.customer.price_list_id}, ${b.businessDate}, ${a.gross.amountMinor.toString()}, ${a.lineDiscountTotal.amountMinor.toString()}, ${a.invoiceDiscountTotal.amountMinor.toString()}, ${req.invoiceDiscountBp ?? null}, ${a.net.amountMinor.toString()}, ${a.tax.amountMinor.toString()}, ${a.total.amountMinor.toString()}, ${a.roundingAdjustment.amountMinor.toString()}, ${st.paidMinor.amountMinor.toString()}, ${st.creditMinor.amountMinor.toString()}, ${req.prescription ? tx.json(req.prescription) : null}, ${req.notes ?? null}, ${req.idempotencyKey ?? null}, now(), ${actor.userId})`;
      const lineIds = new Map<string, string>();
      for (const [i, line] of posted.value.lines.entries()) {
        const lt = posted.value.posting!.totals.lines[i]!;
        const cost = Money.sum(line.allocations.map((x) => x.cost));
        const [row] = await tx<{ id: string }[]>`INSERT INTO sales_invoice_lines (tenant_id, invoice_id, line_no, item_id, unit_id, unit_name_snapshot, factor_snapshot, qty_in_unit, ssu_qty, unit_price_minor, price_source, regulated_unit_price_snapshot, gross_minor, discount_minor, discount_breakdown, allocated_invoice_discount_minor, net_minor, tax_bp, tax_minor, total_minor, cost_minor_snapshot)
          VALUES (${tenantId}, ${invoiceId}, ${i + 1}, ${line.itemId}, ${line.unit.unitId}, ${line.unit.unitNameEn}, ${line.unit.factorSnapshot.toString()}, ${line.unit.qtyInUnit.toString()}, ${line.unit.ssuQty.toString()}, ${line.unitPrice.amountMinor.toString()}, ${line.priceSource}, ${line.regulatedUnitPriceSnapshot?.amountMinor.toString() ?? null},
                  ${lt.gross.amountMinor.toString()}, ${lt.lineDiscount.amountMinor.toString()}, ${tx.json(J(lt.applied))}, ${lt.invoiceDiscountAlloc.amountMinor.toString()}, ${lt.net.amountMinor.toString()}, ${line.taxBp}, ${lt.tax.amountMinor.toString()}, ${lt.total.amountMinor.toString()}, ${cost.amountMinor.toString()}) RETURNING id`;
        lineIds.set(line.lineId, row!.id);
        for (const al of line.allocations) {
          await tx`INSERT INTO sale_line_lots (tenant_id, line_id, lot_id, location_id, ssu_qty, unit_cost_minor_snapshot, fefo_override_by, fefo_override_reason)
            VALUES (${tenantId}, ${row!.id}, ${al.lotId}, ${b.location.id}, ${al.qtySsu.toString()}, ${al.cost.divide(al.qtySsu).amountMinor.toString()}, ${line.fefoOverride ? approverId : null}, ${line.fefoOverride?.reason ?? null})`;
        }
      }
      // ---- stock movements (DB triggers enforce expiry/sellability/non-negative)
      for (const m of it.movements) {
        await tx`INSERT INTO stock_movements (tenant_id, item_id, lot_id, location_id, movement_type, qty_delta_ssu, unit_cost_minor_snapshot, cost_currency, document_type, document_id, document_line_id, business_date, created_by)
          VALUES (${tenantId}, ${m.itemId}, ${m.lotId}, ${m.locationId}, 'SALE', ${m.qtyDeltaSsu.toString()}, ${m.unitCostSnapshot.amountMinor.toString()}, ${m.unitCostSnapshot.currency}, 'SALES_INVOICE', ${invoiceId}, ${lineIds.get(m.documentRef.lineId ?? "") ?? null}, ${b.businessDate}, ${actor.userId})`;
      }
      // ---- payments + cash movements
      // Journal gets NET cash: change is handed back from the cash tender, so the cash line = tendered − change
      // (change is always given in `changeCurrency`; when that differs from the tender we book the change as a
      // separate negative cash part in its own currency).
      const payments: PaymentPart[] = [];
      let changeLeft = st.changeMinor; // in changeCurrency
      for (const td of st.tenders) {
        if (td.method === "CREDIT") continue;
        const cashboxId = td.accountId ?? shift.cashbox_id;
        await tx`INSERT INTO invoice_payments (tenant_id, invoice_id, method, currency, amount_minor, rate_scaled_snapshot, amount_in_invoice_currency_minor, cashbox_id, reference)
          VALUES (${tenantId}, ${invoiceId}, ${PM[td.method]}::payment_method, ${td.tendered.currency}, ${td.tendered.amountMinor.toString()}, ${td.rateSnapshot?.rateScaledSnapshot.toString() ?? null}, ${td.inInvoiceCurrency.amountMinor.toString()}, ${cashboxId}, ${td.paymentRef})`;
        const baseRate = td.tendered.currency === tenant.base_currency ? undefined : (await this.rate(tx, td.tendered.currency, tenant.base_currency)).buyRateScaled;
        let amount = td.tendered;
        if (td.method === "CASH" && changeLeft.isPositive() && td.tendered.currency === changeLeft.currency) {
          const take = td.tendered.lt(changeLeft) ? td.tendered : changeLeft; // net this tender down by the change
          amount = td.tendered.subtract(take);
          changeLeft = changeLeft.subtract(take);
        }
        // Cash drawer receives the NET amount (tendered − change handed back) → a single SALE (IN) movement.
        if (td.method === "CASH" && amount.isPositive()) {
          await tx`INSERT INTO cash_movements (tenant_id, cashbox_id, shift_id, currency, amount_minor, kind, rate_scaled_snapshot, document_type, document_id, created_by)
            VALUES (${tenantId}, ${cashboxId}, ${shift.id}, ${amount.currency}, ${amount.amountMinor.toString()}, 'SALE', ${td.rateSnapshot?.rateScaledSnapshot.toString() ?? null}, 'SALES_INVOICE', ${invoiceId}, ${actor.userId})`;
        }
        if (amount.isPositive()) payments.push({ via: { kind: td.method === "CASH" ? "CASH" : td.method === "CARD" ? "BANK" : "WALLET", id: cashboxId }, amount, rateScaled: baseRate });
      }
      // Cross-currency change (e.g. SAR tendered, YER change): the tender settles only (tenderBase − changeBase);
      // the posting rule books the excess as FX gain, which we immediately wash out with a second entry
      // Dr FX gain / Cr cash(change currency) — net effect: Dr Cash SAR, Cr Cash YER, no FX result.
      let crossChangeBase: Money | null = null;
      if (changeLeft.isPositive()) {
        const toBaseChange = changeLeft.currency === tenant.base_currency ? changeLeft : (() => { throw ApiError.badRequest("sales.change_currency_unsupported", "Change must be given in the invoice/base currency or the tendered currency"); })();
        crossChangeBase = toBaseChange;
        let idx = -1;
        for (let k = payments.length - 1; k >= 0; k--) if (payments[k]!.via.kind === "CASH") { idx = k; break; }
        if (idx < 0) throw ApiError.badRequest("sales.change_without_cash", "Change requires a cash tender");
        const last = payments[idx]!;
        const rate: bigint | undefined = last.rateScaled;
        const lastBase = rate !== undefined ? (() => { const num: bigint = last.amount.amountMinor * rate; const den = 1_000_000n; const q = num / den; const rem = num % den; return Money.minor(q + (rem * 2n >= den ? 1n : 0n), tenant.base_currency); })() : last.amount;
        payments[idx] = { ...last, settlesBase: lastBase.subtract(crossChangeBase) };
      }
      if (crossChangeBase) {
        // Change handed out in a currency different from the tender: an OUT movement in its own currency.
        await tx`INSERT INTO cash_movements (tenant_id, cashbox_id, shift_id, currency, amount_minor, kind, rate_scaled_snapshot, document_type, document_id, reason, created_by)
          VALUES (${tenantId}, ${shift.cashbox_id}, ${shift.id}, ${crossChangeBase.currency}, ${(-crossChangeBase.amountMinor).toString()}, 'ADJUSTMENT', ${st.changeRateSnapshot?.rateScaledSnapshot.toString() ?? null}, 'SALES_INVOICE', ${invoiceId}, 'change', ${actor.userId})`;
      }
      if (st.changeMinor.isPositive()) {
        await tx`UPDATE invoice_payments SET change_minor = ${st.changeMinor.amountMinor.toString()}, change_currency = ${st.changeMinor.currency} WHERE invoice_id = ${invoiceId} AND method = 'CASH'`;
      }
      // ---- journal entry (base currency)
      const toBase = async (m: Money): Promise<Money> => {
        if (m.currency === tenant.base_currency) return m;
        const r = await this.rate(tx, m.currency, tenant.base_currency);
        const num = m.amountMinor * r.sellRateScaled; const den = 1_000_000n; const q = num / den; const rem = num % den;
        return Money.minor(q + (rem * 2n >= den ? 1n : 0n), tenant.base_currency);
      };
      const entry = salesInvoicePosted({ entryId: crypto.randomUUID(), tenantId, postedAt: new Date(), baseCurrency: tenant.base_currency }, {
        invoiceId, customerId: b.customer.is_walk_in ? undefined : b.customer.id, gross: await toBase(a.gross), discount: await toBase(a.discountTotal), outputVat: await toBase(a.tax), payments,
        cogs: a.cogs, discountPosting: tenant.discount_posting,
      });
      if (isErr(entry)) throw entry.error;
      await this.persistEntry(tx, tenantId, entry.value, b.businessDate, actor.userId);
      if (crossChangeBase) {
        const wash = postEntry({ entryId: crypto.randomUUID(), tenantId, postedAt: new Date(), baseCurrency: tenant.base_currency }, { type: "SALES_INVOICE_CHANGE", id: invoiceId },
          [{ accountCode: ACCOUNT_CODES.FX_GAIN, debit: crossChangeBase, memo: "change given in base currency (FX wash)" }, { accountCode: cashAccountFor(crossChangeBase.currency), credit: crossChangeBase, dimensions: { cashboxId: shift.cashbox_id } }],
          `Change for ${it.docNo}`);
        if (isErr(wash)) throw wash.error;
        await this.persistEntry(tx, tenantId, wash.value, b.businessDate, actor.userId);
      }
      await tx`INSERT INTO audit_log (tenant_id, actor_user_id, action, entity_type, entity_id, after_data, approved_by) VALUES (${tenantId}, ${actor.userId}, 'sales.post', 'sales_invoice', ${invoiceId}, ${tx.json(J({ number: it.docNo, total: a.total, paid: st.paidMinor, credit: st.creditMinor, change: st.changeMinor, warnings: posted.value.posting!.warnings }))}, ${approverId})`;
      return { id: invoiceId, number: it.docNo, totals: J(a), settlement: J({ paid: st.paidMinor, credit: st.creditMinor, change: st.changeMinor, rounding: st.roundingMinor, tenders: st.tenders }), warnings: J(posted.value.posting!.warnings), journalEntryId: entry.value.entryId };
    });
  }

  async persistEntry(tx: Sql, tenantId: string, e: JournalEntry, businessDate: string, actorId: string): Promise<void> {
    const [n] = await tx<{ n: string }[]>`SELECT next_document_number(${tenantId}, 'JOURNAL', '') AS n`;
    await tx`INSERT INTO journal_entries (id, tenant_id, entry_no, document_type, document_id, business_date, posted_at, base_currency, memo, created_by)
      VALUES (${e.entryId}, ${tenantId}, ${Number(n!.n.replace(/\D/g, ""))}, ${e.documentRef.type}, ${e.documentRef.id}, ${businessDate}, ${e.postedAt}, ${e.currency}, ${e.memo}, ${actorId})`;
    for (const [i, l] of e.lines.entries()) {
      await tx`INSERT INTO journal_lines (tenant_id, entry_id, line_no, account_code, debit_minor, credit_minor, original_currency, original_amount_minor, rate_scaled_snapshot, memo, dim_cashbox_id, dim_customer_id, dim_supplier_id, dim_item_id, dim_lot_id)
        VALUES (${tenantId}, ${e.entryId}, ${i + 1}, ${l.accountCode}, ${l.debit.amountMinor.toString()}, ${l.credit.amountMinor.toString()}, ${l.foreign?.amount.currency ?? null}, ${l.foreign?.amount.amountMinor.toString() ?? null}, ${l.foreign?.rateScaledSnapshot.toString() ?? null}, ${l.memo},
                ${l.dimensions.cashboxId ?? null}, ${l.dimensions.customerId ?? null}, ${l.dimensions.supplierId ?? null}, ${l.dimensions.itemId ?? null}, ${l.dimensions.lotId ?? null})`;
    }
  }

  async get(tenantId: string, id: string) {
    return this.db.tx(tenantId, async (tx) => {
      const [inv] = await tx`SELECT i.*, c.name AS customer_name, u.display_name AS cashier_name FROM sales_invoices i LEFT JOIN customers c ON c.id = i.customer_id JOIN users u ON u.id = i.cashier_id WHERE i.id = ${id}`;
      if (!inv) throw ApiError.notFound("sales.not_found", "Invoice not found");
      const lines = await tx`SELECT l.*, it.trade_name_ar, it.trade_name_en FROM sales_invoice_lines l JOIN items it ON it.id = l.item_id WHERE l.invoice_id = ${id} ORDER BY line_no`;
      const lots = await tx`SELECT sl.*, lo.lot_number, lo.expiry_date FROM sale_line_lots sl JOIN lots lo ON lo.id = sl.lot_id WHERE sl.line_id IN (SELECT id FROM sales_invoice_lines WHERE invoice_id = ${id})`;
      const payments = await tx`SELECT * FROM invoice_payments WHERE invoice_id = ${id}`;
      return { invoice: inv, lines, lots, payments };
    });
  }

  async list(tenantId: string, q: { from?: string | undefined; to?: string | undefined; customerId?: string | undefined; status?: string | undefined; limit: number; offset: number }) {
    return this.db.tx(tenantId, (tx) => tx`SELECT i.id, i.number, i.status, i.business_date, i.currency, i.total_minor, i.paid_minor, i.credit_minor, i.customer_id, c.name AS customer_name, i.cashier_id, i.posted_at
      FROM sales_invoices i LEFT JOIN customers c ON c.id = i.customer_id WHERE true
      ${q.from ? tx`AND i.business_date >= ${q.from}` : tx``} ${q.to ? tx`AND i.business_date <= ${q.to}` : tx``} ${q.customerId ? tx`AND i.customer_id = ${q.customerId}` : tx``} ${q.status ? tx`AND i.status = ${q.status}::document_status` : tx``}
      ORDER BY i.posted_at DESC NULLS LAST, i.created_at DESC LIMIT ${q.limit} OFFSET ${q.offset}`);
  }
}
