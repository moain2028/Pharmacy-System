import { Inject, Injectable } from "@nestjs/common";
import type { Sql } from "@pharmacore/db";
import {
  Lot, Money, allocateFefo, expiryWorklist, isErr, isoDateFromDate, parseIsoDate,
  type CurrencyCode, type LotBalance, type LotManualStatus, type LotStock,
} from "@pharmacore/domain";
import { Db } from "../infra/db.js";
import { ApiError } from "../shared/errors.js";

interface LotRow {
  id: string; item_id: string; lot_number: string; expiry_date: string | null; qty_received_ssu: string; total_cost_minor: string; cost_currency: CurrencyCode;
  supplier_id: string | null; source_type: "OFFICIAL" | "PARALLEL"; printed_public_price_minor: string | null; manual_status: LotManualStatus; received_at: Date;
}
interface TenantRow { base_currency: CurrencyCode; settings: Record<string, unknown> }

const NO_EXPIRY = "9999-12-31";

function hydrate(r: LotRow): Lot {
  const l = Lot.create({
    lotId: r.id, itemId: r.item_id, lotNumber: r.lot_number, expiryDate: r.expiry_date ? String(r.expiry_date).slice(0, 10) : NO_EXPIRY,
    qtyReceivedSsu: BigInt(r.qty_received_ssu), totalCostMinor: Money.minor(BigInt(r.total_cost_minor), r.cost_currency),
    sourceType: r.source_type, supplierId: r.supplier_id ?? undefined,
    printedPublicPriceMinor: r.printed_public_price_minor === null ? undefined : Money.minor(BigInt(r.printed_public_price_minor), r.cost_currency),
    manualStatus: r.manual_status,
  });
  if (isErr(l)) throw l.error;
  return l.value;
}

export interface ReceiveInput {
  itemId: string; locationId: string; unitId: string; qtyInUnit: number; lotNumber: string; expiryDate?: string | null | undefined;
  unitCostMinor: string; costCurrency: CurrencyCode; rateScaled?: string | undefined; supplierId?: string | undefined; sourceType?: "OFFICIAL" | "PARALLEL" | undefined;
  printedPublicPriceMinor?: string | null | undefined; businessDate?: string | undefined; movementType?: "OPENING" | "RECEIPT" | undefined;
  documentType?: string | undefined; documentId?: string | undefined;
}

@Injectable()
export class InventoryService {
  constructor(@Inject(Db) private readonly db: Db) {}

  private async tenant(tx: Sql, tenantId: string): Promise<TenantRow> {
    const [t] = await tx<TenantRow[]>`SELECT base_currency, settings FROM tenants WHERE id = ${tenantId}`;
    return t!;
  }
  private policy(t: TenantRow) {
    const s = t.settings;
    return {
      allowNegativeStock: s["allow_negative_stock"] === true,
      nearExpiryDays: typeof s["near_expiry_days"] === "number" ? (s["near_expiry_days"] as number) : 90,
      saleBlockDaysBeforeExpiry: typeof s["sale_block_days_before_expiry"] === "number" ? (s["sale_block_days_before_expiry"] as number) : 0,
      expiryTiers: Array.isArray(s["expiry_tiers"]) ? (s["expiry_tiers"] as number[]) : [180, 90, 30],
    };
  }

  /** Opening stock / direct receipt: creates a Lot and a RECEIPT/OPENING movement in one transaction. */
  async receive(tenantId: string, actorId: string, input: ReceiveInput): Promise<{ lotId: string; qtySsu: string; unitCostMinorBase: string }> {
    return this.db.tx(tenantId, async (tx) => {
      const t = await this.tenant(tx, tenantId);
      const [item] = await tx<{ id: string; track_expiry: boolean; is_active: boolean }[]>`SELECT id, track_expiry, is_active FROM items WHERE id = ${input.itemId}`;
      if (!item) throw ApiError.notFound("items.not_found", "Item not found");
      if (!item.is_active) throw ApiError.conflict("items.inactive", "Item is inactive");
      const [unit] = await tx<{ id: string; factor_to_ssu: string; can_purchase: boolean }[]>`SELECT id, factor_to_ssu, can_purchase FROM item_units WHERE id = ${input.unitId} AND item_id = ${input.itemId} AND is_active`;
      if (!unit) throw ApiError.badRequest("units.not_found", "Unit does not belong to item");
      if (input.qtyInUnit <= 0 || !Number.isInteger(input.qtyInUnit)) throw ApiError.badRequest("qty.not_positive", "Quantity must be a positive integer");
      const factor = BigInt(unit.factor_to_ssu);
      const qtySsu = BigInt(input.qtyInUnit) * factor;
      const expiry = input.expiryDate ? parseIsoDate(input.expiryDate) : null;
      if (expiry && isErr(expiry)) throw expiry.error;
      if (item.track_expiry && !expiry) throw ApiError.badRequest("lot.expiry_required", "Expiry date is required for this item");
      const businessDate = input.businessDate ?? isoDateFromDate(new Date());
      if (expiry && expiry.value <= businessDate && (input.movementType ?? "RECEIPT") === "RECEIPT") throw ApiError.conflict("lot.expired_on_receipt", "Cannot receive an already-expired lot", { expiry: expiry.value });

      // cost → base currency (rate required when currencies differ)
      const unitCost = Money.minor(BigInt(input.unitCostMinor), input.costCurrency);
      let totalBase: Money;
      if (input.costCurrency === t.base_currency) totalBase = unitCost.multiply(BigInt(input.qtyInUnit));
      else {
        if (!input.rateScaled) throw ApiError.badRequest("fx.rate_required", "rateScaled is required for foreign-currency cost");
        const rate = BigInt(input.rateScaled);
        if (rate <= 0n) throw ApiError.badRequest("fx.invalid_rate", "rateScaled must be > 0");
        const totalForeign = unitCost.multiply(BigInt(input.qtyInUnit));
        // base = foreign × rate / 1e6 (Half-Up) — same convention as domain convertAtRate
        const num = totalForeign.amountMinor * rate;
        const den = 1_000_000n;
        const q = num / den, r = num % den;
        totalBase = Money.minor(q + (r * 2n >= den ? 1n : 0n), t.base_currency);
      }
      const unitCostSsuBase = totalBase.divide(qtySsu); // Half-Up snapshot per SSU

      // validate via domain aggregate before touching the DB
      const lotCheck = Lot.create({
        lotId: crypto.randomUUID(), itemId: input.itemId, lotNumber: input.lotNumber, expiryDate: expiry ? expiry.value : NO_EXPIRY,
        qtyReceivedSsu: qtySsu, totalCostMinor: totalBase, sourceType: input.sourceType ?? "OFFICIAL", supplierId: input.supplierId,
        printedPublicPriceMinor: input.printedPublicPriceMinor ? Money.minor(BigInt(input.printedPublicPriceMinor), t.base_currency) : undefined,
      });
      if (isErr(lotCheck)) throw lotCheck.error;
      const lot = lotCheck.value;

      const docType = input.documentType ?? (input.movementType === "OPENING" ? "OPENING_BALANCE" : "DIRECT_RECEIPT");
      const docId = input.documentId ?? crypto.randomUUID();
      const [row] = await tx<{ id: string }[]>`INSERT INTO lots (tenant_id, item_id, lot_number, expiry_date, qty_received_ssu, total_cost_minor, cost_currency, supplier_id, source_type, printed_public_price_minor, received_at, source_document_type, source_document_id)
        VALUES (${tenantId}, ${lot.itemId}, ${lot.lotNumber}, ${expiry ? expiry.value : null}, ${qtySsu.toString()}, ${totalBase.amountMinor.toString()}, ${t.base_currency}, ${input.supplierId ?? null}, ${lot.sourceType}::lot_source_type,
                ${input.printedPublicPriceMinor ?? null}, now(), ${docType}, ${docId}) RETURNING id`;
      await tx`INSERT INTO stock_movements (tenant_id, item_id, lot_id, location_id, movement_type, qty_delta_ssu, unit_cost_minor_snapshot, cost_currency, unit_id, factor_snapshot, qty_in_unit, document_type, document_id, business_date, created_by)
        VALUES (${tenantId}, ${lot.itemId}, ${row!.id}, ${input.locationId}, ${input.movementType ?? "RECEIPT"}::stock_movement_type, ${qtySsu.toString()}, ${unitCostSsuBase.amountMinor.toString()}, ${t.base_currency},
                ${input.unitId}, ${factor.toString()}, ${input.qtyInUnit}, ${docType}, ${docId}, ${businessDate}, ${actorId})`;
      await tx`INSERT INTO audit_log (tenant_id, actor_user_id, action, entity_type, entity_id, after_data) VALUES (${tenantId}, ${actorId}, 'stock.receive', 'lot', ${row!.id}, ${tx.json({ ...input, qtySsu: qtySsu.toString(), totalBaseMinor: totalBase.amountMinor.toString() })})`;
      return { lotId: row!.id, qtySsu: qtySsu.toString(), unitCostMinorBase: unitCostSsuBase.amountMinor.toString() };
    });
  }

  /** Balances per lot/location for an item with effective status. */
  async balances(tenantId: string, itemId: string, businessDate?: string | undefined) {
    return this.db.tx(tenantId, async (tx) => {
      const t = await this.tenant(tx, tenantId);
      const p = this.policy(t);
      const date = businessDate ?? isoDateFromDate(new Date());
      const rows = await tx<Array<LotRow & { location_id: string; qty_ssu: string }>>`
        SELECT l.*, b.location_id, b.qty_ssu FROM stock_balances b JOIN lots l ON l.id = b.lot_id WHERE b.item_id = ${itemId} ORDER BY l.expiry_date NULLS LAST, l.received_at`;
      const out = rows.map((r) => {
        const lot = hydrate(r);
        const qty = BigInt(r.qty_ssu);
        return {
          lotId: lot.lotId, lotNumber: lot.lotNumber, expiryDate: lot.expiryDate === NO_EXPIRY ? null : lot.expiryDate, locationId: r.location_id,
          qtySsu: qty.toString(), manualStatus: lot.manualStatus, effectiveStatus: lot.effectiveStatus(date, qty, p.nearExpiryDays),
          daysToExpiry: lot.expiryDate === NO_EXPIRY ? null : lot.daysToExpiry(date), unitCostHintMinor: lot.unitCostHint().amountMinor.toString(),
          valueMinor: (qty > 0n ? lot.costForSsu(qty > lot.qtyReceivedSsu ? lot.qtyReceivedSsu : qty) : null),
          printedPublicPriceMinor: lot.printedPublicPriceMinor?.amountMinor.toString() ?? null,
        };
      }).map((x) => ({ ...x, valueMinor: x.valueMinor && x.valueMinor.ok ? x.valueMinor.value.amountMinor.toString() : null }));
      const totalSsu = out.reduce((a, b) => a + BigInt(b.qtySsu), 0n);
      return { itemId, businessDate: date, totalSsu: totalSsu.toString(), currency: t.base_currency, lots: out };
    });
  }

  /** FEFO preview for POS: which lots would be consumed for qtySsu at a location. */
  async fefoPreview(tenantId: string, input: { itemId: string; locationId: string; qtySsu: string; businessDate?: string | undefined; overrideLotId?: string | undefined; override?: { approvedBy: string; reason: string } | undefined }) {
    return this.db.tx(tenantId, async (tx) => {
      const t = await this.tenant(tx, tenantId);
      const p = this.policy(t);
      const date = input.businessDate ?? isoDateFromDate(new Date());
      const rows = await tx<Array<LotRow & { qty_ssu: string }>>`SELECT l.*, b.qty_ssu FROM stock_balances b JOIN lots l ON l.id = b.lot_id WHERE b.item_id = ${input.itemId} AND b.location_id = ${input.locationId} AND b.qty_ssu > 0`;
      const lots: LotBalance[] = rows.map((r) => ({ lot: hydrate(r), availableSsu: BigInt(r.qty_ssu), receivedAt: r.received_at.toISOString() }));
      const res = allocateFefo(
        { itemId: input.itemId, qtySsu: BigInt(input.qtySsu), businessDate: date, lots, overrideLotId: input.overrideLotId, override: input.override ? { permission: "inventory.lot_override_fefo", ...input.override } : undefined },
        { allowNegativeStock: p.allowNegativeStock, nearExpiryDays: p.nearExpiryDays, saleBlockDaysBeforeExpiry: p.saleBlockDaysBeforeExpiry },
      );
      if (isErr(res)) throw res.error;
      return {
        allocations: res.value.allocations.map((a) => ({ ...a, qtySsu: a.qtySsu.toString(), costMinor: a.costMinor.amountMinor.toString() })),
        shortfallSsu: res.value.shortfallSsu.toString(), skippedLotIds: res.value.skippedLotIds, override: res.value.override,
      };
    });
  }

  /** Manual lot status change through the domain state machine. */
  async setLotStatus(tenantId: string, actorId: string, lotId: string, input: { status: LotManualStatus; reason: string; businessDate?: string | undefined }) {
    return this.db.tx(tenantId, async (tx) => {
      const [r] = await tx<LotRow[]>`SELECT * FROM lots WHERE id = ${lotId}`;
      if (!r) throw ApiError.notFound("lots.not_found", "Lot not found");
      const lot = hydrate(r);
      const next = lot.applyManualStatus(input.status, input.businessDate ?? isoDateFromDate(new Date()));
      if (isErr(next)) throw next.error;
      await tx`UPDATE lots SET manual_status = ${next.value.manualStatus}::lot_manual_status, status_reason = ${input.reason}, status_changed_by = ${actorId}, status_changed_at = now() WHERE id = ${lotId}`;
      await tx`INSERT INTO audit_log (tenant_id, actor_user_id, action, entity_type, entity_id, before_data, after_data, reason) VALUES (${tenantId}, ${actorId}, 'lots.status_change', 'lot', ${lotId}, ${tx.json({ manualStatus: lot.manualStatus })}, ${tx.json({ manualStatus: next.value.manualStatus })}, ${input.reason})`;
      return { lotId, manualStatus: next.value.manualStatus };
    });
  }

  /** Stock adjustment (+/-) on a specific lot/location with mandatory reason; write-off of expired/damaged. */
  async adjust(tenantId: string, actorId: string, input: { lotId: string; locationId: string; qtyDeltaSsu: string; reason: string; businessDate?: string | undefined; movementType?: "ADJUSTMENT" | "STOCKTAKE" | undefined }) {
    return this.db.tx(tenantId, async (tx) => {
      const t = await this.tenant(tx, tenantId);
      const [r] = await tx<LotRow[]>`SELECT * FROM lots WHERE id = ${input.lotId}`;
      if (!r) throw ApiError.notFound("lots.not_found", "Lot not found");
      const lot = hydrate(r);
      const delta = BigInt(input.qtyDeltaSsu);
      if (delta === 0n) throw ApiError.badRequest("stock.zero_adjustment", "Adjustment must be non-zero");
      if (!input.reason.trim()) throw ApiError.badRequest("stock.reason_required", "Reason is required");
      const [docN] = await tx<{ n: string }[]>`SELECT next_document_number(${tenantId}, 'ADJUSTMENT', '') AS n`;
      const docId = crypto.randomUUID();
      await tx`INSERT INTO stock_movements (tenant_id, item_id, lot_id, location_id, movement_type, qty_delta_ssu, unit_cost_minor_snapshot, cost_currency, document_type, document_id, business_date, created_by)
        VALUES (${tenantId}, ${lot.itemId}, ${input.lotId}, ${input.locationId}, ${input.movementType ?? "ADJUSTMENT"}::stock_movement_type, ${delta.toString()}, ${lot.unitCostHint().amountMinor.toString()}, ${t.base_currency}, ${input.movementType ?? "ADJUSTMENT"}, ${docId}, ${input.businessDate ?? isoDateFromDate(new Date())}, ${actorId})`;
      await tx`INSERT INTO audit_log (tenant_id, actor_user_id, action, entity_type, entity_id, after_data, reason) VALUES (${tenantId}, ${actorId}, 'stock.adjust', 'lot', ${input.lotId}, ${tx.json({ number: docN!.n, qtyDeltaSsu: delta.toString(), locationId: input.locationId })}, ${input.reason})`;
      return { number: docN!.n, documentId: docId };
    });
  }

  /** Transfer between locations (paired OUT/IN, same lot). */
  async transfer(tenantId: string, actorId: string, input: { lotId: string; fromLocationId: string; toLocationId: string; qtySsu: string; businessDate?: string | undefined; reason?: string | undefined }) {
    if (input.fromLocationId === input.toLocationId) throw ApiError.badRequest("stock.same_location", "Source and destination must differ");
    return this.db.tx(tenantId, async (tx) => {
      const t = await this.tenant(tx, tenantId);
      const [r] = await tx<LotRow[]>`SELECT * FROM lots WHERE id = ${input.lotId}`;
      if (!r) throw ApiError.notFound("lots.not_found", "Lot not found");
      const lot = hydrate(r);
      const qty = BigInt(input.qtySsu);
      if (qty <= 0n) throw ApiError.badRequest("qty.not_positive", "Quantity must be > 0");
      const docId = crypto.randomUUID();
      const date = input.businessDate ?? isoDateFromDate(new Date());
      const cost = lot.unitCostHint().amountMinor.toString();
      await tx`INSERT INTO stock_movements (tenant_id, item_id, lot_id, location_id, movement_type, qty_delta_ssu, unit_cost_minor_snapshot, cost_currency, document_type, document_id, business_date, created_by)
        VALUES (${tenantId}, ${lot.itemId}, ${input.lotId}, ${input.fromLocationId}, 'TRANSFER_OUT', ${(-qty).toString()}, ${cost}, ${t.base_currency}, 'TRANSFER', ${docId}, ${date}, ${actorId})`;
      await tx`INSERT INTO stock_movements (tenant_id, item_id, lot_id, location_id, movement_type, qty_delta_ssu, unit_cost_minor_snapshot, cost_currency, document_type, document_id, business_date, created_by)
        VALUES (${tenantId}, ${lot.itemId}, ${input.lotId}, ${input.toLocationId}, 'TRANSFER_IN', ${qty.toString()}, ${cost}, ${t.base_currency}, 'TRANSFER', ${docId}, ${date}, ${actorId})`;
      await tx`INSERT INTO audit_log (tenant_id, actor_user_id, action, entity_type, entity_id, after_data, reason) VALUES (${tenantId}, ${actorId}, 'stock.transfer', 'lot', ${input.lotId}, ${tx.json({ ...input })}, ${input.reason ?? null})`;
      return { documentId: docId };
    });
  }

  /** Expiry worklist (180/90/30 + EXPIRED) across the tenant, valued at remaining cost. */
  async expiry(tenantId: string, businessDate?: string | undefined) {
    return this.db.tx(tenantId, async (tx) => {
      const t = await this.tenant(tx, tenantId);
      const p = this.policy(t);
      const rows = await tx<Array<LotRow & { on_hand: string; trade_name_ar: string; trade_name_en: string }>>`
        SELECT l.*, SUM(b.qty_ssu) AS on_hand, i.trade_name_ar, i.trade_name_en FROM stock_balances b JOIN lots l ON l.id = b.lot_id JOIN items i ON i.id = l.item_id
        GROUP BY l.id, i.trade_name_ar, i.trade_name_en HAVING SUM(b.qty_ssu) > 0`;
      const names = new Map(rows.map((r) => [r.id, { ar: r.trade_name_ar, en: r.trade_name_en }]));
      const stock: LotStock[] = rows.map((r) => ({ lot: hydrate(r), onHandSsu: BigInt(r.on_hand) }));
      const wl = expiryWorklist(stock, businessDate ?? isoDateFromDate(new Date()), t.base_currency, p.expiryTiers);
      if (isErr(wl)) throw wl.error;
      return {
        businessDate: wl.value.businessDate, currency: wl.value.currency,
        groups: wl.value.groups.map((g) => ({
          tier: g.tier, daysBefore: g.daysBefore, lotCount: g.lotCount, itemCount: g.itemCount, qtySsu: g.qtySsu.toString(), valueAtRiskMinor: g.valueAtRiskMinor.amountMinor.toString(),
          lots: g.lots.map((l) => ({ ...l, onHandSsu: l.onHandSsu.toString(), valueAtRiskMinor: l.valueAtRiskMinor.amountMinor.toString(), itemNameAr: names.get(l.lotId)?.ar, itemNameEn: names.get(l.lotId)?.en })),
        })),
      };
    });
  }

  /** Kardex: movement history for an item (optionally per lot). */
  async kardex(tenantId: string, itemId: string, q: { lotId?: string | undefined; from?: string | undefined; to?: string | undefined; limit: number }) {
    return this.db.tx(tenantId, (tx) => tx`SELECT m.id, m.lot_id, l.lot_number, m.location_id, m.movement_type, m.qty_delta_ssu, m.unit_cost_minor_snapshot, m.cost_currency, m.unit_id, m.factor_snapshot, m.qty_in_unit, m.document_type, m.document_id, m.business_date, m.occurred_at, m.created_by,
        SUM(m.qty_delta_ssu) OVER (PARTITION BY m.lot_id, m.location_id ORDER BY m.business_date, m.occurred_at, m.id) AS running_lot_location
      FROM stock_movements m JOIN lots l ON l.id = m.lot_id WHERE m.item_id = ${itemId}
        ${q.lotId ? tx`AND m.lot_id = ${q.lotId}` : tx``} ${q.from ? tx`AND m.business_date >= ${q.from}` : tx``} ${q.to ? tx`AND m.business_date <= ${q.to}` : tx``}
      ORDER BY m.business_date DESC, m.occurred_at DESC LIMIT ${q.limit}`);
  }

  async locations(tenantId: string) {
    return this.db.tx(tenantId, (tx) => tx`SELECT * FROM locations WHERE is_active ORDER BY code`);
  }
}
