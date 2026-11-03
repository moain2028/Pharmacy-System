import { Inject, Injectable } from "@nestjs/common";
import type { Sql } from "@pharmacore/db";
import { ExchangeRate, isErr, validateUnitLadder, type ItemUnit } from "@pharmacore/domain";
import { Db } from "../infra/db.js";
import { ApiError } from "../shared/errors.js";
import { internalEan13, parseBarcode, type BarcodeType } from "./barcode.js";

export interface UnitInput {
  id?: string | undefined;
  nameAr: string; nameEn: string; factorToSsu: number; level: number; isSsu: boolean;
  canSell: boolean; canPurchase: boolean; isDefaultSale: boolean; isDefaultPurchase: boolean; isStockDisplay: boolean;
}
export interface ItemInput {
  itemCode?: string | undefined; tradeNameAr: string; tradeNameEn: string; genericName?: string | undefined; strength?: string | undefined; dosageForm?: string | undefined;
  manufacturer?: string | undefined; agentName?: string | undefined; countryOfOrigin?: string | undefined; categoryId?: string | undefined;
  rxRequired: "NONE" | "RX" | "RX_RETAIN"; controlledClass: "NONE" | "PSYCHOTROPIC" | "NARCOTIC" | "PRECURSOR";
  trackExpiry: boolean; requiresColdChain: boolean; isReturnable: boolean; taxBp: number;
  minStockSsu: number; maxStockSsu?: number | null | undefined; reorderPointSsu?: number | null | undefined; notes?: string | undefined;
  units: UnitInput[];
}

function ladder(units: UnitInput[], itemId: string): ItemUnit[] {
  return units.map((u, i) => ({
    unitId: u.id ?? `new-${i}`, itemId, nameAr: u.nameAr, nameEn: u.nameEn, factorToSsu: BigInt(u.factorToSsu), level: u.level,
    isSsu: u.isSsu, canSell: u.canSell, canPurchase: u.canPurchase, active: true,
  }));
}

@Injectable()
export class CatalogService {
  constructor(@Inject(Db) private readonly db: Db) {}

  // ---------------------------------------------------------------- items
  async search(tenantId: string, q: { text?: string | undefined; barcode?: string | undefined; categoryId?: string | undefined; activeOnly: boolean; limit: number; offset: number }) {
    return this.db.tx(tenantId, async (tx) => {
      if (q.barcode) {
        const p = parseBarcode(q.barcode);
        const rows = await tx`SELECT i.*, b.unit_id AS scanned_unit_id, b.barcode_type FROM item_barcodes b JOIN items i ON i.id = b.item_id
          WHERE b.normalized_barcode = ${p.normalized} ${q.activeOnly ? tx`AND i.is_active` : tx``} LIMIT 5`;
        return { items: rows, parsedBarcode: p };
      }
      const text = q.text?.trim();
      const rows = await tx`SELECT i.* FROM items i
        WHERE true ${q.activeOnly ? tx`AND i.is_active` : tx``} ${q.categoryId ? tx`AND i.category_id = ${q.categoryId}` : tx``}
        ${text ? tx`AND (i.item_code ILIKE ${text + "%"} OR i.trade_name_ar ILIKE ${"%" + text + "%"} OR i.trade_name_en ILIKE ${"%" + text + "%"} OR coalesce(i.generic_name,'') ILIKE ${"%" + text + "%"}
                 OR to_tsvector('simple', coalesce(i.trade_name_ar,'') || ' ' || coalesce(i.trade_name_en,'') || ' ' || coalesce(i.generic_name,'')) @@ plainto_tsquery('simple', ${text}))` : tx``}
        ORDER BY i.trade_name_en LIMIT ${q.limit} OFFSET ${q.offset}`;
      return { items: rows };
    });
  }

  async get(tenantId: string, itemId: string) {
    return this.db.tx(tenantId, async (tx) => {
      const [item] = await tx`SELECT * FROM items WHERE id = ${itemId}`;
      if (!item) throw ApiError.notFound("items.not_found", "Item not found");
      const units = await tx`SELECT * FROM item_units WHERE item_id = ${itemId} ORDER BY level`;
      const barcodes = await tx`SELECT * FROM item_barcodes WHERE item_id = ${itemId} ORDER BY is_primary DESC, created_at`;
      const prices = await tx`SELECT p.*, pl.code AS price_list_code, pl.currency FROM price_list_items p JOIN price_lists pl ON pl.id = p.price_list_id
        WHERE p.item_id = ${itemId} AND (p.effective_to IS NULL OR p.effective_to > now()) ORDER BY pl.priority DESC, p.effective_from DESC`;
      const official = await tx`SELECT * FROM official_prices WHERE item_id = ${itemId} AND (effective_to IS NULL OR effective_to >= CURRENT_DATE) ORDER BY effective_from DESC`;
      const stock = await tx`SELECT lot_id, location_id, qty_ssu FROM stock_balances WHERE item_id = ${itemId} AND qty_ssu <> 0`;
      return { item, units, barcodes, prices, officialPrices: official, stock };
    });
  }

  async create(tenantId: string, actorId: string, input: ItemInput): Promise<{ id: string; itemCode: string }> {
    return this.db.tx(tenantId, (tx) => this.createIn(tx, tenantId, actorId, input));
  }

  /** Transaction-scoped create (used by CSV import to batch many items atomically). */
  async createIn(tx: Sql, tenantId: string, actorId: string, input: ItemInput): Promise<{ id: string; itemCode: string }> {
    const v = validateUnitLadder(ladder(input.units, "new"));
    if (isErr(v)) throw v.error;
    {
      const code = input.itemCode?.trim() || (await this.nextItemCode(tx, tenantId));
      const [it] = await tx<{ id: string }[]>`INSERT INTO items (tenant_id, item_code, trade_name_ar, trade_name_en, generic_name, strength, dosage_form, manufacturer, agent_name, country_of_origin, category_id,
          rx_required, controlled_class, track_expiry, requires_cold_chain, is_returnable, tax_bp, min_stock_ssu, max_stock_ssu, reorder_point_ssu, notes)
        VALUES (${tenantId}, ${code}, ${input.tradeNameAr}, ${input.tradeNameEn}, ${input.genericName ?? null}, ${input.strength ?? null}, ${input.dosageForm ?? null}, ${input.manufacturer ?? null}, ${input.agentName ?? null}, ${input.countryOfOrigin ?? null}, ${input.categoryId ?? null},
          ${input.rxRequired}::rx_requirement, ${input.controlledClass}::controlled_class, ${input.trackExpiry}, ${input.requiresColdChain}, ${input.isReturnable}, ${input.taxBp}, ${input.minStockSsu}, ${input.maxStockSsu ?? null}, ${input.reorderPointSsu ?? null}, ${input.notes ?? null}) RETURNING id`;
      for (const u of input.units) {
        await tx`INSERT INTO item_units (tenant_id, item_id, name_ar, name_en, factor_to_ssu, level, is_ssu, can_sell, can_purchase, is_default_sale, is_default_purchase, is_stock_display)
          VALUES (${tenantId}, ${it!.id}, ${u.nameAr}, ${u.nameEn}, ${u.factorToSsu}, ${u.level}, ${u.isSsu}, ${u.canSell}, ${u.canPurchase}, ${u.isDefaultSale}, ${u.isDefaultPurchase}, ${u.isStockDisplay})`;
      }
      await tx`INSERT INTO audit_log (tenant_id, actor_user_id, action, entity_type, entity_id, after_data) VALUES (${tenantId}, ${actorId}, 'items.create', 'item', ${it!.id}, ${tx.json(JSON.parse(JSON.stringify(input)))})`;
      return { id: it!.id, itemCode: code };
    }
  }

  async update(tenantId: string, actorId: string, itemId: string, input: ItemInput & { isActive?: boolean | undefined; version: number }) {
    const v = validateUnitLadder(ladder(input.units, itemId));
    if (isErr(v)) throw v.error;
    return this.db.tx(tenantId, async (tx) => {
      const [before] = await tx`SELECT * FROM items WHERE id = ${itemId}`;
      if (!before) throw ApiError.notFound("items.not_found", "Item not found");
      if (before["version"] !== input.version) throw ApiError.conflict("items.stale", "Item was modified by someone else; reload", { current: before["version"] });
      await tx`UPDATE items SET trade_name_ar = ${input.tradeNameAr}, trade_name_en = ${input.tradeNameEn}, generic_name = ${input.genericName ?? null}, strength = ${input.strength ?? null}, dosage_form = ${input.dosageForm ?? null},
          manufacturer = ${input.manufacturer ?? null}, agent_name = ${input.agentName ?? null}, country_of_origin = ${input.countryOfOrigin ?? null}, category_id = ${input.categoryId ?? null},
          rx_required = ${input.rxRequired}::rx_requirement, controlled_class = ${input.controlledClass}::controlled_class, track_expiry = ${input.trackExpiry}, requires_cold_chain = ${input.requiresColdChain}, is_returnable = ${input.isReturnable},
          tax_bp = ${input.taxBp}, min_stock_ssu = ${input.minStockSsu}, max_stock_ssu = ${input.maxStockSsu ?? null}, reorder_point_ssu = ${input.reorderPointSsu ?? null}, notes = ${input.notes ?? null}, is_active = ${input.isActive ?? before["is_active"]}
        WHERE id = ${itemId}`;
      const existing = await tx<{ id: string; factor_locked_at: Date | null }[]>`SELECT id, factor_locked_at FROM item_units WHERE item_id = ${itemId}`;
      const keep = new Set(input.units.map((u) => u.id).filter(Boolean));
      for (const e of existing) {
        if (!keep.has(e.id)) {
          if (e.factor_locked_at) await tx`UPDATE item_units SET is_active = false, can_sell = false, can_purchase = false, is_default_sale = false, is_default_purchase = false WHERE id = ${e.id}`;
          else await tx`DELETE FROM item_units WHERE id = ${e.id}`;
        }
      }
      for (const u of input.units) {
        if (u.id) {
          await tx`UPDATE item_units SET name_ar = ${u.nameAr}, name_en = ${u.nameEn}, factor_to_ssu = ${u.factorToSsu}, level = ${u.level}, is_ssu = ${u.isSsu}, can_sell = ${u.canSell}, can_purchase = ${u.canPurchase},
            is_default_sale = ${u.isDefaultSale}, is_default_purchase = ${u.isDefaultPurchase}, is_stock_display = ${u.isStockDisplay}, is_active = true WHERE id = ${u.id} AND item_id = ${itemId}`;
        } else {
          await tx`INSERT INTO item_units (tenant_id, item_id, name_ar, name_en, factor_to_ssu, level, is_ssu, can_sell, can_purchase, is_default_sale, is_default_purchase, is_stock_display)
            VALUES (${tenantId}, ${itemId}, ${u.nameAr}, ${u.nameEn}, ${u.factorToSsu}, ${u.level}, ${u.isSsu}, ${u.canSell}, ${u.canPurchase}, ${u.isDefaultSale}, ${u.isDefaultPurchase}, ${u.isStockDisplay})`;
        }
      }
      await tx`INSERT INTO audit_log (tenant_id, actor_user_id, action, entity_type, entity_id, before_data, after_data) VALUES (${tenantId}, ${actorId}, 'items.update', 'item', ${itemId}, ${tx.json(JSON.parse(JSON.stringify(before)))}, ${tx.json(JSON.parse(JSON.stringify(input)))})`;
      return { ok: true };
    });
  }

  private async nextItemCode(tx: Sql, tenantId: string): Promise<string> {
    const [r] = await tx<{ n: string }[]>`SELECT next_document_number(${tenantId}, 'ITEM', '') AS n`;
    return r!.n;
  }

  // ---------------------------------------------------------------- barcodes
  async addBarcode(tenantId: string, actorId: string, itemId: string, input: { barcode?: string | undefined; unitId: string; isPrimary: boolean; generateInternal: boolean }) {
    return this.db.tx(tenantId, (tx) => this.addBarcodeIn(tx, tenantId, actorId, itemId, input));
  }

  /** Transaction-scoped barcode add (normalisation + duplicate check in one place; used by CSV import). */
  async addBarcodeIn(tx: Sql, tenantId: string, actorId: string, itemId: string, input: { barcode?: string | undefined; unitId: string; isPrimary: boolean; generateInternal: boolean }) {
    {
      let raw = input.barcode?.trim() ?? "";
      let type: BarcodeType;
      let normalized: string;
      let source: "MANUFACTURER" | "INTERNAL" | "GS1";
      if (input.generateInternal || !raw) {
        const [seq] = await tx<{ n: string }[]>`SELECT next_document_number(${tenantId}, 'INTERNAL_BARCODE', '') AS n`;
        raw = internalEan13(Number(seq!.n.replace(/\D/g, "")));
        type = "INTERNAL"; normalized = raw.padStart(14, "0"); source = "INTERNAL";
      } else {
        const p = parseBarcode(raw);
        type = p.type; normalized = p.normalized; source = p.type === "GS1_DATAMATRIX" ? "GS1" : p.type === "INTERNAL" ? "INTERNAL" : "MANUFACTURER";
      }
      const dup = await tx<{ item_id: string }[]>`SELECT item_id FROM item_barcodes WHERE normalized_barcode = ${normalized}`;
      if (dup.length && dup.some((d) => d.item_id !== itemId)) throw ApiError.conflict("barcodes.duplicate", "Barcode already assigned to another item", { itemId: dup[0]!.item_id });
      if (input.isPrimary) await tx`UPDATE item_barcodes SET is_primary = false WHERE item_id = ${itemId}`;
      const [b] = await tx<{ id: string }[]>`INSERT INTO item_barcodes (tenant_id, item_id, unit_id, barcode, normalized_barcode, barcode_type, source, is_primary)
        VALUES (${tenantId}, ${itemId}, ${input.unitId}, ${raw}, ${normalized}, ${type}, ${source}, ${input.isPrimary}) RETURNING id`;
      await tx`INSERT INTO audit_log (tenant_id, actor_user_id, action, entity_type, entity_id, after_data) VALUES (${tenantId}, ${actorId}, 'barcodes.add', 'item', ${itemId}, ${tx.json({ barcode: raw, type, unitId: input.unitId })})`;
      return { id: b!.id, barcode: raw, type, normalized };
    }
  }

  // ---------------------------------------------------------------- prices
  async setPrice(tenantId: string, actorId: string, input: { priceListId: string; itemId: string; unitId: string; unitPriceMinor: string; minPriceMinor?: string | null | undefined; reason?: string | undefined }) {
    return this.db.tx(tenantId, async (tx) => {
      const [cur] = await tx<{ id: string; unit_price_minor: string }[]>`SELECT id, unit_price_minor FROM price_list_items WHERE price_list_id = ${input.priceListId} AND item_id = ${input.itemId} AND unit_id = ${input.unitId} AND effective_to IS NULL ORDER BY effective_from DESC LIMIT 1`;
      if (cur) await tx`UPDATE price_list_items SET effective_to = now() WHERE id = ${cur.id}`;
      const [row] = await tx<{ id: string }[]>`INSERT INTO price_list_items (tenant_id, price_list_id, item_id, unit_id, unit_price_minor, min_price_minor, created_by)
        VALUES (${tenantId}, ${input.priceListId}, ${input.itemId}, ${input.unitId}, ${input.unitPriceMinor}, ${input.minPriceMinor ?? null}, ${actorId}) RETURNING id`;
      await tx`INSERT INTO price_history (tenant_id, item_id, unit_id, price_list_id, old_price_minor, new_price_minor, reason, changed_by)
        VALUES (${tenantId}, ${input.itemId}, ${input.unitId}, ${input.priceListId}, ${cur?.unit_price_minor ?? null}, ${input.unitPriceMinor}, ${input.reason ?? null}, ${actorId})`;
      return { id: row!.id };
    });
  }

  async setOfficialPrice(tenantId: string, actorId: string, input: { itemId: string; unitId: string; currency: string; publicPriceMinor: string; sourceListRef?: string | undefined; effectiveFrom: string }) {
    return this.db.tx(tenantId, async (tx) => {
      await tx`UPDATE official_prices SET effective_to = (${input.effectiveFrom}::date - 1) WHERE item_id = ${input.itemId} AND unit_id = ${input.unitId} AND effective_to IS NULL AND effective_from < ${input.effectiveFrom}::date`;
      const [row] = await tx<{ id: string }[]>`INSERT INTO official_prices (tenant_id, item_id, unit_id, currency, public_price_minor, source_list_ref, effective_from)
        VALUES (${tenantId}, ${input.itemId}, ${input.unitId}, ${input.currency}::currency_code, ${input.publicPriceMinor}, ${input.sourceListRef ?? null}, ${input.effectiveFrom}) RETURNING id`;
      await tx`INSERT INTO audit_log (tenant_id, actor_user_id, action, entity_type, entity_id, after_data) VALUES (${tenantId}, ${actorId}, 'prices.official_set', 'item', ${input.itemId}, ${tx.json(input)})`;
      return { id: row!.id };
    });
  }

  async priceLists(tenantId: string) {
    return this.db.tx(tenantId, (tx) => tx`SELECT * FROM price_lists ORDER BY priority DESC, code`);
  }

  async categories(tenantId: string) {
    return this.db.tx(tenantId, (tx) => tx`SELECT * FROM item_categories ORDER BY name_en`);
  }
  async createCategory(tenantId: string, input: { nameAr: string; nameEn: string; parentId?: string | undefined }) {
    return this.db.tx(tenantId, async (tx) => {
      const [r] = await tx<{ id: string }[]>`INSERT INTO item_categories (tenant_id, name_ar, name_en, parent_id) VALUES (${tenantId}, ${input.nameAr}, ${input.nameEn}, ${input.parentId ?? null}) RETURNING id`;
      return { id: r!.id };
    });
  }

  // ---------------------------------------------------------------- exchange rates
  async setRate(tenantId: string, actorId: string, input: { from: string; to: string; buyRateScaled: string; sellRateScaled: string; effectiveFrom?: string | undefined }) {
    const r = ExchangeRate.create({ from: input.from, to: input.to, buyRateScaled: BigInt(input.buyRateScaled), sellRateScaled: BigInt(input.sellRateScaled), effectiveFrom: input.effectiveFrom ? new Date(input.effectiveFrom) : new Date() });
    if (isErr(r)) throw r.error;
    const rate = r.value;
    return this.db.tx(tenantId, async (tx) => {
      const [row] = await tx<{ id: string }[]>`INSERT INTO exchange_rates (tenant_id, from_currency, to_currency, buy_rate_scaled, sell_rate_scaled, effective_from, created_by)
        VALUES (${tenantId}, ${rate.from}, ${rate.to}, ${rate.buyRateScaled.toString()}, ${rate.sellRateScaled.toString()}, ${rate.effectiveFrom}, ${actorId}) RETURNING id`;
      await tx`INSERT INTO audit_log (tenant_id, actor_user_id, action, entity_type, entity_id, after_data) VALUES (${tenantId}, ${actorId}, 'settings.rate_set', 'exchange_rate', ${row!.id}, ${tx.json(input)})`;
      return { id: row!.id };
    });
  }
  async currentRates(tenantId: string) {
    return this.db.tx(tenantId, (tx) => tx`SELECT DISTINCT ON (from_currency, to_currency) id, from_currency, to_currency, buy_rate_scaled, sell_rate_scaled, effective_from
      FROM exchange_rates WHERE effective_from <= now() ORDER BY from_currency, to_currency, effective_from DESC`);
  }
}
