import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { Sql } from "@pharmacore/db";
import {
  GoodsReceipt, Money, PurchaseOrder, purchaseReceiptPosted, suggestReorder,
  type ApprovalPolicy, type BonusCostPolicy, type CurrencyCode, type DiscountValue, type GoodsReceiptLineInput, type IsoDate,
  type ItemUnit, type LandedCostInput, type PoStatus, type PurchaseOrderLineInput,
} from "@pharmacore/domain";
import { Db } from "../infra/db.js";
import { ApiError } from "../shared/errors.js";
import { J, persistEntry, rateFor, toBase } from "../shared/journal.js";

export interface Actor { readonly userId: string; readonly permissions: ReadonlySet<string> }
export type DiscountIn = { readonly bp: number } | { readonly amountMinor: string };
export interface PoLineIn { itemId: string; unitId: string; qtyInUnit: number; unitCostMinor: string; discount?: DiscountIn | undefined; bonusQtyInUnit?: number | undefined }
export interface PoCreateIn { supplierId: string; currency: CurrencyCode; expectedDate?: string | undefined; lines: PoLineIn[]; invoiceDiscount?: DiscountIn | undefined; notes?: string | undefined }
export interface PoListQ { supplierId?: string | undefined; status?: string | undefined; limit: number; offset: number }
export interface GrnLineIn {
  poLineId?: string | undefined; itemId: string; unitId: string; qtyInUnit: number; bonusQtyInUnit?: number | undefined; unitCostMinor: string;
  discount?: DiscountIn | undefined; lotNumber: string; expiryDate?: string | undefined; printedPublicPriceMinor?: string | undefined; sourceType?: "OFFICIAL" | "PARALLEL" | undefined;
}
export interface LandedIn { type: "FREIGHT" | "CUSTOMS" | "CLEARANCE" | "LOADING" | "OTHER"; amountMinor: string; currency: CurrencyCode; method?: "BY_VALUE" | "BY_QTY" | undefined }
export interface GrnIn {
  supplierId: string; purchaseOrderId?: string | undefined; locationId: string; currency: CurrencyCode; invoiceRef?: string | undefined; businessDate?: string | undefined;
  lines: GrnLineIn[]; invoiceDiscount?: DiscountIn | undefined; landedCosts?: LandedIn[] | undefined; bonusCostPolicy?: BonusCostPolicy | undefined; notes?: string | undefined;
}
export interface GrnListQ { supplierId?: string | undefined; from?: string | undefined; to?: string | undefined; limit: number; offset: number }

interface TenantRow { base_currency: CurrencyCode; settings: Record<string, unknown> | null }
interface UnitRow {
  id: string; item_id: string; name_ar: string; name_en: string; factor_to_ssu: string; level: number; is_ssu: boolean; can_sell: boolean; can_purchase: boolean;
  is_default_sale: boolean; is_default_purchase: boolean; is_stock_display: boolean; is_active: boolean; track_expiry: boolean; item_active: boolean;
}
interface PoRow {
  id: string; number: string | null; status: string; supplier_id: string; supplier_name: string; currency: CurrencyCode; rate_scaled_snapshot: string | null;
  expected_date: string | null; total_minor: string; approved_by: string | null; approved_at: Date | null; notes: string | null; created_by: string | null; created_at: Date; version: number;
}
interface PoLineRow { id: string; order_id: string; line_no: number; item_id: string; unit_id: string; factor_snapshot: string; qty_in_unit: string; ssu_qty: string; unit_price_minor: string; received_ssu: string }
interface GrnRow {
  id: string; number: string | null; status: string; supplier_id: string; supplier_name: string; order_id: string | null; location_id: string; currency: CurrencyCode;
  rate_scaled_snapshot: string | null; supplier_doc_ref: string | null; business_date: string; total_minor: string; posted_at: Date | null; posted_by: string | null; created_at: Date; version: number;
}

const RECEIVABLE_DB = ["APPROVED", "PARTIALLY_RECEIVED"];
const toDbStatus = (s: PoStatus): string => (s === "POSTED" ? "APPROVED" : s);
const fromDbStatus = (s: string): PoStatus => (s === "APPROVED" ? "POSTED" : (s as PoStatus));
const today = (): string => new Date().toISOString().slice(0, 10);
const isoOf = (d: string | Date | null): string | undefined => (d === null ? undefined : (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10));
const hasPerm = (a: Actor, p: string): boolean => a.permissions.has(p) || a.permissions.has("*") || a.permissions.has(`${p.split(".")[0]}.*`);
const unprocessable = (code: string, message: string, details?: Record<string, unknown>): ApiError => new ApiError(422, details ? { code, message, details } : { code, message });

function settingBigint(s: Record<string, unknown>, key: string): bigint | undefined {
  const v = s[key];
  if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) return BigInt(v);
  if (typeof v === "string" && /^\d+$/.test(v)) return BigInt(v);
  return undefined;
}
function settingInt(s: Record<string, unknown>, key: string, dflt: number): number {
  const v = s[key];
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : dflt;
}
function policyOf(s: Record<string, unknown>, base: CurrencyCode): ApprovalPolicy {
  const max = settingBigint(s, "po_max_amount_minor");
  const bp = s["po_max_supplier_discount_bp"];
  return { maxPoAmount: max === undefined ? undefined : Money.minor(max, base), maxSupplierDiscountBp: typeof bp === "number" ? bp : undefined };
}
function discountOf(d: DiscountIn | undefined, c: CurrencyCode): DiscountValue | undefined {
  if (!d) return undefined;
  return "bp" in d ? { mode: "PERCENT", bp: d.bp } : { mode: "AMOUNT", amount: Money.minor(BigInt(d.amountMinor), c) };
}
/** Mirrors item_units; the factor may be overridden with the PO line snapshot (D-026). */
function toItemUnit(u: UnitRow, factor: bigint = BigInt(u.factor_to_ssu)): ItemUnit {
  return {
    unitId: u.id, itemId: u.item_id, nameAr: u.name_ar, nameEn: u.name_en, factorToSsu: factor, level: u.level, isSsu: u.is_ssu, canSell: u.can_sell,
    canPurchase: u.can_purchase, active: u.is_active,
  };
}
function unitOf(units: Map<string, UnitRow>, id: string): UnitRow {
  const u = units.get(id);
  if (!u) throw ApiError.notFound("unit.not_found", `Unit ${id} not found`);
  if (!u.is_active) throw unprocessable("unit.inactive", "Unit is inactive", { unitId: id });
  if (!u.item_active) throw unprocessable("item.inactive", "Item is inactive", { itemId: u.item_id });
  return u;
}
async function unitsOf(tx: Sql, tenantId: string, ids: readonly string[]): Promise<Map<string, UnitRow>> {
  const rows = await tx<UnitRow[]>`SELECT u.*, i.track_expiry, i.is_active AS item_active FROM item_units u JOIN items i ON i.id = u.item_id
    WHERE u.tenant_id = ${tenantId} AND u.id = ANY(${[...new Set(ids)]}::uuid[])`;
  return new Map(rows.map((r) => [r.id, r]));
}
async function tenantOf(tx: Sql, tenantId: string): Promise<{ base: CurrencyCode; settings: Record<string, unknown> }> {
  const [t] = await tx<TenantRow[]>`SELECT base_currency, settings FROM tenants WHERE id = ${tenantId}`;
  if (!t) throw ApiError.notFound("tenant.not_found", "Tenant not found");
  return { base: t.base_currency, settings: t.settings ?? {} };
}
async function supplierOf(tx: Sql, tenantId: string, id: string): Promise<void> {
  const [s] = await tx<{ is_active: boolean }[]>`SELECT is_active FROM suppliers WHERE tenant_id = ${tenantId} AND id = ${id}`;
  if (!s) throw ApiError.notFound("supplier.not_found", "Supplier not found");
  if (!s.is_active) throw unprocessable("supplier.inactive", "Supplier is inactive", { supplierId: id });
}
async function rateScaledFor(tx: Sql, from: CurrencyCode, base: CurrencyCode): Promise<bigint | undefined> {
  return from === base ? undefined : (await rateFor(tx, from, base)).sellRateScaled;
}
async function audit(tx: Sql, tenantId: string, actorId: string, action: string, entityType: string, id: string, after: unknown): Promise<void> {
  await tx`INSERT INTO audit_log (tenant_id, actor_user_id, action, entity_type, entity_id, after_data) VALUES (${tenantId}, ${actorId}, ${action}, ${entityType}, ${id}, ${tx.json(J(after))})`;
}

@Injectable()
export class PurchasingService {
  constructor(@Inject(Db) private readonly db: Db) {}

  // ---------------------------------------------------------------- purchase orders

  private async loadPo(tx: Sql, tenantId: string, id: string, lock: boolean): Promise<{ po: PoRow; lines: PoLineRow[] }> {
    const [po] = await tx<PoRow[]>`SELECT p.*, s.name AS supplier_name FROM purchase_orders p JOIN suppliers s ON s.id = p.supplier_id
      WHERE p.tenant_id = ${tenantId} AND p.id = ${id} ${lock ? tx`FOR UPDATE OF p` : tx``}`;
    if (!po) throw ApiError.notFound("purchase_order.not_found", "Purchase order not found");
    const lines = await tx<PoLineRow[]>`SELECT * FROM purchase_order_lines WHERE tenant_id = ${tenantId} AND order_id = ${id} ORDER BY line_no`;
    return { po, lines };
  }

  /** Rebuilds the DRAFT aggregate from stored rows (discounts are not persisted by the schema). */
  private async rehydrate(tx: Sql, tenantId: string, po: PoRow, lines: PoLineRow[], base: CurrencyCode): Promise<PurchaseOrder> {
    const units = await unitsOf(tx, tenantId, lines.map((l) => l.unit_id));
    const inputs: PurchaseOrderLineInput[] = lines.map((l) => ({
      lineId: l.id, itemId: l.item_id, unit: toItemUnit(unitOf(units, l.unit_id), BigInt(l.factor_snapshot)), qtyInUnit: BigInt(l.qty_in_unit),
      unitCost: Money.minor(BigInt(l.unit_price_minor), po.currency),
    }));
    const r = PurchaseOrder.create({
      poId: po.id, poNo: po.number ?? "", supplierId: po.supplier_id, supplierStatus: "ACTIVE", orderDate: isoOf(po.created_at) as IsoDate,
      expectedDeliveryDate: isoOf(po.expected_date) as IsoDate | undefined, currency: po.currency, baseCurrency: base,
      rateScaledSnapshot: po.rate_scaled_snapshot === null ? undefined : BigInt(po.rate_scaled_snapshot), lines: inputs,
    });
    if (!r.ok) throw r.error;
    return r.value;
  }

  private toReceivable(agg: PurchaseOrder, lines: PoLineRow[], toleranceBp: number): PurchaseOrder {
    const s = agg.submit({});
    if (!s.ok) throw s.error;
    const prev = lines.filter((l) => BigInt(l.received_ssu) > 0n).map((l) => ({ lineId: l.id, qtySsu: BigInt(l.received_ssu) }));
    if (prev.length === 0) return s.value;
    const r = s.value.recordReceipt(prev, toleranceBp);
    if (!r.ok) throw r.error;
    return r.value;
  }

  private poView(po: PoRow, lines: PoLineRow[]) {
    return {
      id: po.id, number: po.number, status: fromDbStatus(po.status), supplierId: po.supplier_id, supplierName: po.supplier_name, currency: po.currency,
      rateScaledSnapshot: po.rate_scaled_snapshot, expectedDate: isoOf(po.expected_date) ?? null, totalMinor: po.total_minor, approvedBy: po.approved_by, approvedAt: po.approved_at,
      notes: po.notes, createdBy: po.created_by, createdAt: po.created_at, version: po.version,
      lines: lines.map((l) => ({ id: l.id, lineNo: l.line_no, itemId: l.item_id, unitId: l.unit_id, factorSnapshot: l.factor_snapshot, qtyInUnit: l.qty_in_unit, ssuQty: l.ssu_qty, unitCostMinor: l.unit_price_minor, receivedSsu: l.received_ssu })),
    };
  }

  createPo(tenantId: string, actor: Actor, input: PoCreateIn) {
    return this.db.tx(tenantId, async (tx) => {
      const { base } = await tenantOf(tx, tenantId);
      await supplierOf(tx, tenantId, input.supplierId);
      const units = await unitsOf(tx, tenantId, input.lines.map((l) => l.unitId));
      const rate = await rateScaledFor(tx, input.currency, base);
      const poId = randomUUID();
      const lineIds = input.lines.map(() => randomUUID());
      const inputs: PurchaseOrderLineInput[] = input.lines.map((l, i) => {
        const u = unitOf(units, l.unitId);
        return {
          lineId: lineIds[i]!, itemId: l.itemId, unit: toItemUnit(u), qtyInUnit: BigInt(l.qtyInUnit), unitCost: Money.minor(BigInt(l.unitCostMinor), input.currency),
          discount: discountOf(l.discount, input.currency), expectedBonusSsu: BigInt(l.bonusQtyInUnit ?? 0) * BigInt(u.factor_to_ssu),
        };
      });
      const [num] = await tx<{ n: string }[]>`SELECT next_document_number(${tenantId}, 'PURCHASE_ORDER', '') AS n`;
      const agg = PurchaseOrder.create({
        poId, poNo: num!.n, supplierId: input.supplierId, supplierStatus: "ACTIVE", orderDate: today() as IsoDate, expectedDeliveryDate: input.expectedDate as IsoDate | undefined,
        currency: input.currency, baseCurrency: base, rateScaledSnapshot: rate, invoiceDiscount: discountOf(input.invoiceDiscount, input.currency), lines: inputs,
      });
      if (!agg.ok) throw agg.error;
      const po = agg.value;
      await tx`INSERT INTO purchase_orders (id, tenant_id, number, status, supplier_id, currency, rate_scaled_snapshot, expected_date, total_minor, notes, created_by)
        VALUES (${poId}, ${tenantId}, ${num!.n}, 'DRAFT', ${input.supplierId}, ${input.currency}, ${rate?.toString() ?? null}, ${input.expectedDate ?? null}, ${po.totals.total.amountMinor.toString()}, ${input.notes ?? null}, ${actor.userId})`;
      const rows = po.lines.map((l, i) => ({
        id: l.lineId, tenant_id: tenantId, order_id: poId, line_no: i + 1, item_id: l.itemId, unit_id: input.lines[i]!.unitId, factor_snapshot: units.get(input.lines[i]!.unitId)!.factor_to_ssu,
        qty_in_unit: String(input.lines[i]!.qtyInUnit), ssu_qty: l.unit.ssuQty.toString(), unit_price_minor: l.unitCost.amountMinor.toString(), received_ssu: "0",
      }));
      await tx`INSERT INTO purchase_order_lines ${tx(rows)}`;
      const view = { ...this.poView((await this.loadPo(tx, tenantId, poId, false)).po, []), lines: po.lines, totals: po.totals, approval: po.approval };
      await audit(tx, tenantId, actor.userId, "purchase_order.create", "purchase_order", poId, view);
      return J(view);
    });
  }

  approvePo(tenantId: string, actor: Actor, id: string) {
    return this.db.tx(tenantId, async (tx) => {
      const { base, settings } = await tenantOf(tx, tenantId);
      const { po, lines } = await this.loadPo(tx, tenantId, id, true);
      if (po.status !== "DRAFT" && po.status !== "PENDING_APPROVAL") throw unprocessable("po.invalid_transition", `Cannot approve a ${fromDbStatus(po.status)} order`, { status: fromDbStatus(po.status) });
      const canApprove = hasPerm(actor, "purchase_orders.approve");
      if (po.status === "PENDING_APPROVAL" && !canApprove) throw ApiError.forbidden("auth.permission_denied", "Missing permission", { missing: ["purchase_orders.approve"] });
      await supplierOf(tx, tenantId, po.supplier_id);
      const agg = await this.rehydrate(tx, tenantId, po, lines, base);
      const s = agg.submit(policyOf(settings, base));
      if (!s.ok) throw s.error;
      let next = s.value;
      const now = new Date();
      if (next.status === "PENDING_APPROVAL" && canApprove) {
        const a = next.approve(actor.userId, now.toISOString());
        if (!a.ok) throw a.error;
        next = a.value;
      }
      const posted = next.status === "POSTED";
      await tx`UPDATE purchase_orders SET status = ${toDbStatus(next.status)}, approved_by = ${posted ? actor.userId : null}, approved_at = ${posted ? now : null},
        version = version + 1, updated_at = now() WHERE id = ${id} AND tenant_id = ${tenantId}`;
      const out = { id, number: po.number, status: next.status, approval: next.approval, totals: next.totals, version: po.version + 1 };
      await audit(tx, tenantId, actor.userId, posted ? "purchase_order.approve" : "purchase_order.submit", "purchase_order", id, out);
      return J(out);
    });
  }

  getPo(tenantId: string, id: string) {
    return this.db.tx(tenantId, async (tx) => {
      const { po, lines } = await this.loadPo(tx, tenantId, id, false);
      return J(this.poView(po, lines));
    });
  }

  listPos(tenantId: string, q: PoListQ) {
    return this.db.tx(tenantId, async (tx) => {
      const st = q.status ? toDbStatus(q.status as PoStatus) : null;
      const rows = await tx<PoRow[]>`SELECT p.*, s.name AS supplier_name FROM purchase_orders p JOIN suppliers s ON s.id = p.supplier_id
        WHERE p.tenant_id = ${tenantId} AND (${q.supplierId ?? null}::uuid IS NULL OR p.supplier_id = ${q.supplierId ?? null}) AND (${st}::text IS NULL OR p.status = ${st})
        ORDER BY p.created_at DESC LIMIT ${q.limit} OFFSET ${q.offset}`;
      return J({ rows: rows.map((r) => this.poView(r, [])) });
    });
  }

  reorderSuggestion(tenantId: string, itemId: string) {
    return this.db.tx(tenantId, async (tx) => {
      const [it] = await tx<{ id: string; reorder_point_ssu: string | null; min_stock_ssu: string; max_stock_ssu: string | null; unit_id: string | null; factor_to_ssu: string | null; on_hand: string; sold30: string }[]>`
        SELECT i.id, i.reorder_point_ssu, i.min_stock_ssu, i.max_stock_ssu, u.id AS unit_id, u.factor_to_ssu,
          (SELECT COALESCE(SUM(m.qty_delta_ssu), 0)::text FROM stock_movements m JOIN lots l ON l.id = m.lot_id
             WHERE m.tenant_id = i.tenant_id AND m.item_id = i.id AND l.manual_status = 'NONE' AND (l.expiry_date IS NULL OR l.expiry_date > CURRENT_DATE)) AS on_hand,
          (SELECT COALESCE(-SUM(m.qty_delta_ssu), 0)::text FROM stock_movements m
             WHERE m.tenant_id = i.tenant_id AND m.item_id = i.id AND m.movement_type = 'SALE' AND m.business_date >= CURRENT_DATE - 30) AS sold30
        FROM items i LEFT JOIN LATERAL (SELECT id, factor_to_ssu FROM item_units WHERE item_id = i.id AND is_active AND can_purchase ORDER BY is_default_purchase DESC, level ASC LIMIT 1) u ON true
        WHERE i.tenant_id = ${tenantId} AND i.id = ${itemId}`;
      if (!it) throw ApiError.notFound("item.not_found", "Item not found");
      if (!it.unit_id || !it.factor_to_ssu) throw unprocessable("item.no_purchase_unit", "Item has no purchasable unit", { itemId });
      const r = suggestReorder({
        itemId, onHandSsu: BigInt(it.on_hand), reorderPointSsu: BigInt(it.reorder_point_ssu ?? it.min_stock_ssu),
        maxStockSsu: it.max_stock_ssu === null ? undefined : BigInt(it.max_stock_ssu), avgDailySalesSsuMilli: (BigInt(it.sold30) * 1000n) / 30n,
      }, { unitId: it.unit_id, factorToSsu: BigInt(it.factor_to_ssu) });
      if (!r.ok) throw r.error;
      return J({ ...r.value, onHandSsu: BigInt(it.on_hand) });
    });
  }

  // ---------------------------------------------------------------- goods receipts

  postGrn(tenantId: string, actor: Actor, input: GrnIn) {
    return this.db.tx(tenantId, async (tx) => {
      const { base, settings } = await tenantOf(tx, tenantId);
      await supplierOf(tx, tenantId, input.supplierId);
      const [loc] = await tx<{ id: string }[]>`SELECT id FROM locations WHERE tenant_id = ${tenantId} AND id = ${input.locationId}`;
      if (!loc) throw ApiError.notFound("location.not_found", "Location not found");
      const units = await unitsOf(tx, tenantId, input.lines.map((l) => l.unitId));
      const rate = await rateScaledFor(tx, input.currency, base);
      const businessDate = (input.businessDate ?? today()) as IsoDate;
      const tolerance = settingInt(settings, "po_over_receipt_tolerance_bp", 0);
      let po: PurchaseOrder | undefined;
      let poRow: PoRow | undefined;
      if (input.purchaseOrderId) {
        const loaded = await this.loadPo(tx, tenantId, input.purchaseOrderId, true);
        poRow = loaded.po;
        if (poRow.supplier_id !== input.supplierId) throw unprocessable("grn.po_supplier_mismatch", "Purchase order belongs to another supplier", { poId: poRow.id });
        if (!RECEIVABLE_DB.includes(poRow.status)) throw unprocessable("po.not_receivable", "Purchase order cannot be received in its current state", { status: fromDbStatus(poRow.status) });
        po = this.toReceivable(await this.rehydrate(tx, tenantId, poRow, loaded.lines, base), loaded.lines, tolerance);
      }
      const lineIds = input.lines.map(() => randomUUID());
      const lines: GoodsReceiptLineInput[] = input.lines.map((l, i) => {
        const u = unitOf(units, l.unitId);
        return {
          lineId: lineIds[i]!, itemId: l.itemId, poLineId: l.poLineId, trackExpiry: u.track_expiry, lotNumber: l.lotNumber, expiryDate: l.expiryDate as IsoDate | undefined,
          unit: toItemUnit(u), qtyInUnit: BigInt(l.qtyInUnit), bonusSsu: BigInt(l.bonusQtyInUnit ?? 0) * BigInt(u.factor_to_ssu),
          unitCost: Money.minor(BigInt(l.unitCostMinor), input.currency), discount: discountOf(l.discount, input.currency), sourceType: l.sourceType ?? "OFFICIAL",
          printedPublicPrice: l.printedPublicPriceMinor === undefined ? undefined : Money.minor(BigInt(l.printedPublicPriceMinor), base),
        };
      });
      const landed: LandedCostInput[] = [];
      for (const lc of input.landedCosts ?? []) {
        landed.push({ expenseType: lc.type, amount: await toBase(tx, Money.minor(BigInt(lc.amountMinor), lc.currency), base), method: lc.method ?? "BY_VALUE", creditAccountCode: "2150" });
      }
      const grnId = randomUUID();
      const [num] = await tx<{ n: string }[]>`SELECT next_document_number(${tenantId}, 'GOODS_RECEIPT', '') AS n`;
      const grnNo = num!.n;
      const created = GoodsReceipt.create({
        grnId, grnNo, tenantId, supplierId: input.supplierId, locationId: input.locationId, poId: input.purchaseOrderId, receivedAt: new Date().toISOString(), businessDate,
        currency: input.currency, baseCurrency: base, rateScaledSnapshot: rate, invoiceDiscount: discountOf(input.invoiceDiscount, input.currency),
        landedCosts: landed.length > 0 ? landed : undefined, bonusCostPolicy: input.bonusCostPolicy, minShelfLifeDays: settingInt(settings, "min_shelf_life_days", 90), lines,
      });
      if (!created.ok) throw created.error;
      const postedAt = new Date();
      const entryId = randomUUID();
      const posted = created.value.post({ entryId, newId: randomUUID, accounts: { grni: "2150", ap: "2100" }, creditTo: "GRNI", po, overReceiptToleranceBp: tolerance, postedAt });
      if (!posted.ok) throw posted.error;
      const p = posted.value;
      const policy: BonusCostPolicy = input.bonusCostPolicy ?? "SPREAD_COST_OVER_PAID_AND_BONUS";
      const totalForeign = Money.sum(p.receipt.lines.map((l) => l.net), input.currency);

      await tx`INSERT INTO goods_receipts (id, tenant_id, number, status, supplier_id, order_id, location_id, currency, rate_scaled_snapshot, supplier_doc_ref, business_date, total_minor, created_by)
        VALUES (${grnId}, ${tenantId}, ${grnNo}, 'DRAFT', ${input.supplierId}, ${input.purchaseOrderId ?? null}, ${input.locationId}, ${input.currency}, ${rate?.toString() ?? null},
                ${input.invoiceRef ?? null}, ${businessDate}, ${totalForeign.amountMinor.toString()}, ${actor.userId})`;

      const lotRows: Record<string, string | number | Date | null>[] = [];
      const mvRows: Record<string, string | number | Date | null>[] = [];
      const lineRows: Record<string, string | number | null>[] = [];
      const lineLotIds: string[] = [];
      let li = 0;
      p.receipt.lines.forEach((l, i) => {
        const src = input.lines[i]!;
        const u = units.get(src.unitId)!;
        const factor = BigInt(u.factor_to_ssu);
        const count = policy === "ZERO_COST" && l.bonusSsu > 0n ? 2 : 1;
        const lots = p.lots.slice(li, li + count);
        li += count;
        const cost = p.lineCosts[i]!;
        for (const lot of lots) {
          lotRows.push({
            id: lot.lotId, tenant_id: tenantId, item_id: lot.itemId, lot_number: lot.lotNumber, expiry_date: u.track_expiry ? lot.expiryDate : null,
            qty_received_ssu: lot.qtyReceivedSsu.toString(), total_cost_minor: lot.totalCostMinor.amountMinor.toString(), cost_currency: base, supplier_id: input.supplierId,
            source_type: lot.sourceType, printed_public_price_minor: lot.printedPublicPriceMinor?.amountMinor.toString() ?? null, received_at: postedAt,
            source_document_type: "GOODS_RECEIPT", source_document_id: grnId,
          });
          mvRows.push({
            id: randomUUID(), tenant_id: tenantId, item_id: lot.itemId, lot_id: lot.lotId, location_id: input.locationId, movement_type: "RECEIPT", qty_delta_ssu: lot.qtyReceivedSsu.toString(),
            unit_cost_minor_snapshot: lot.totalCostMinor.divide(lot.qtyReceivedSsu).amountMinor.toString(), cost_currency: base, unit_id: src.unitId, factor_snapshot: factor.toString(),
            qty_in_unit: (lot.qtyReceivedSsu / factor).toString(), document_type: "GOODS_RECEIPT", document_id: grnId, document_line_id: l.lineId, business_date: businessDate,
            occurred_at: postedAt, created_by: actor.userId,
          });
        }
        lineLotIds.push(lots[0]!.lotId);
        lineRows.push({
          id: l.lineId, tenant_id: tenantId, receipt_id: grnId, line_no: i + 1, order_line_id: l.poLineId, item_id: l.itemId, unit_id: src.unitId, factor_snapshot: factor.toString(),
          qty_in_unit: String(src.qtyInUnit), bonus_qty_in_unit: String(src.bonusQtyInUnit ?? 0), ssu_qty_total: (l.qtySsu + l.bonusSsu).toString(), unit_cost_minor: l.unitCost.amountMinor.toString(),
          line_discount_minor: l.discount.amountMinor.toString(), landed_cost_minor: cost.landedBase.amountMinor.toString(), lot_number: l.lotNumber,
          expiry_date: u.track_expiry ? l.expiryDate : null, printed_public_price_minor: l.printedPublicPrice?.amountMinor.toString() ?? null, source_type: l.sourceType, lot_id: lots[0]!.lotId,
        });
      });
      await tx`INSERT INTO lots ${tx(lotRows)}`;
      await tx`INSERT INTO goods_receipt_lines ${tx(lineRows)}`;
      await tx`INSERT INTO stock_movements ${tx(mvRows)}`;
      await tx`UPDATE item_units SET factor_locked_at = now() WHERE tenant_id = ${tenantId} AND factor_locked_at IS NULL AND id = ANY(${[...units.keys()]}::uuid[])`;
      await tx`UPDATE goods_receipts SET status = 'POSTED', posted_at = ${postedAt}, posted_by = ${actor.userId}, version = version + 1, updated_at = now() WHERE id = ${grnId} AND tenant_id = ${tenantId}`;

      if (p.po && poRow) {
        const ids = p.po.lines.map((l) => l.lineId);
        const recv = p.po.lines.map((l) => l.receivedSsu.toString());
        await tx`UPDATE purchase_order_lines l SET received_ssu = v.r::bigint FROM unnest(${ids}::uuid[], ${recv}::text[]) AS v(id, r) WHERE l.id = v.id AND l.tenant_id = ${tenantId}`;
        await tx`UPDATE purchase_orders SET status = ${toDbStatus(p.po.status)}, version = version + 1, updated_at = now() WHERE id = ${poRow.id} AND tenant_id = ${tenantId}`;
      }

      const entry = purchaseReceiptPosted({ entryId, tenantId, postedAt, baseCurrency: base }, {
        grnId, supplierId: input.supplierId, lots: p.lots.map((l) => ({ itemId: l.itemId, lotId: l.lotId, cost: l.totalCostMinor })), accrual: "GRNI",
      });
      if (!entry.ok) throw entry.error;
      await persistEntry(tx, tenantId, entry.value, businessDate, actor.userId);

      const out = {
        id: grnId, number: grnNo, status: "POSTED", supplierId: input.supplierId, purchaseOrderId: input.purchaseOrderId ?? null, locationId: input.locationId, currency: input.currency,
        rateScaledSnapshot: rate ?? null, businessDate, invoiceRef: input.invoiceRef ?? null, totalMinor: totalForeign.amountMinor, totalBase: Money.sum(p.lineCosts.map((c) => c.totalBase), base),
        lines: p.receipt.lines.map((l, i) => ({
          id: l.lineId, lineNo: i + 1, poLineId: l.poLineId, itemId: l.itemId, unitId: input.lines[i]!.unitId, qtyInUnit: input.lines[i]!.qtyInUnit, qtySsu: l.qtySsu, bonusSsu: l.bonusSsu,
          unitCost: l.unitCost, gross: l.gross, discount: l.discount, net: l.net, lotNumber: l.lotNumber, expiryDate: units.get(input.lines[i]!.unitId)!.track_expiry ? l.expiryDate : null,
          sourceType: l.sourceType, lotId: lineLotIds[i], cost: p.lineCosts[i],
        })),
        lots: p.lots, warnings: p.warnings, journalEntryId: entryId, po: p.po ? { id: p.po.poId, status: p.po.status } : null,
      };
      await audit(tx, tenantId, actor.userId, "goods_receipt.post", "goods_receipt", grnId, out);
      return J(out);
    });
  }

  getGrn(tenantId: string, id: string) {
    return this.db.tx(tenantId, async (tx) => {
      const [g] = await tx<GrnRow[]>`SELECT g.*, s.name AS supplier_name FROM goods_receipts g JOIN suppliers s ON s.id = g.supplier_id WHERE g.tenant_id = ${tenantId} AND g.id = ${id}`;
      if (!g) throw ApiError.notFound("goods_receipt.not_found", "Goods receipt not found");
      const lines = await tx`SELECT l.*, lo.qty_received_ssu, lo.total_cost_minor, lo.cost_currency FROM goods_receipt_lines l LEFT JOIN lots lo ON lo.id = l.lot_id
        WHERE l.tenant_id = ${tenantId} AND l.receipt_id = ${id} ORDER BY l.line_no`;
      return J({ ...g, business_date: isoOf(g.business_date) ?? null, lines });
    });
  }

  listGrns(tenantId: string, q: GrnListQ) {
    return this.db.tx(tenantId, async (tx) => {
      const rows = await tx<GrnRow[]>`SELECT g.*, s.name AS supplier_name FROM goods_receipts g JOIN suppliers s ON s.id = g.supplier_id
        WHERE g.tenant_id = ${tenantId} AND (${q.supplierId ?? null}::uuid IS NULL OR g.supplier_id = ${q.supplierId ?? null})
          AND (${q.from ?? null}::date IS NULL OR g.business_date >= ${q.from ?? null}) AND (${q.to ?? null}::date IS NULL OR g.business_date <= ${q.to ?? null})
        ORDER BY g.created_at DESC LIMIT ${q.limit} OFFSET ${q.offset}`;
      return J({ rows: rows.map((r) => ({ ...r, business_date: isoOf(r.business_date) ?? null })) });
    });
  }
}
