import { Inject, Injectable } from "@nestjs/common";
import { Db } from "../infra/db.js";
import { CatalogService, type ItemInput } from "../catalog/catalog.service.js";
import { CustomersService } from "../customers/customers.service.js";
import { SuppliersService } from "../purchasing/suppliers.service.js";
import { ApiError } from "../shared/errors.js";
import { csvRecords, toCsv } from "./csv.js";

export interface RowError { row: number; field?: string | undefined; code: string; message: string }
export interface ImportResult { total: number; valid: number; imported: number; errors: RowError[]; dryRun: boolean }

/**
 * CSV import/export for master data. Import is two-phase: validate every row (collect errors) and only when
 * `dryRun=false` AND zero errors write everything in ONE transaction (all-or-nothing — half-imported catalogues
 * are worse than none). Templates (`GET /import/templates/:kind`) define the exact headers.
 *
 * Items CSV columns: item_code?, trade_name_ar, trade_name_en, generic_name?, strength?, dosage_form?, manufacturer?,
 *   barcode?, tax_bp?, rx_required?, track_expiry?, units (e.g. "Carton:240|Box:24|Strip:12|Tablet:1" → ladder, last = SSU),
 *   units_ar? (same order, Arabic names), retail_price? (decimal, for the largest sellable unit = level 2 by default → stored on the unit named in price_unit?), price_unit?
 * Customers CSV: code?, name, phone?, address?, credit_limit? (decimal), credit_currency?, notes?
 * Suppliers CSV: code?, name, phone?, address?, tax_number?, default_currency?, payment_terms_days?
 */
@Injectable()
export class ImportService {
  constructor(@Inject(Db) private readonly db: Db, @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(CustomersService) private readonly customers: CustomersService, @Inject(SuppliersService) private readonly suppliers: SuppliersService) {}

  templates(kind: string): string {
    const t: Record<string, { cols: string[]; sample: Record<string, string> }> = {
      items: { cols: ["item_code", "trade_name_ar", "trade_name_en", "generic_name", "strength", "dosage_form", "manufacturer", "barcode", "tax_bp", "rx_required", "track_expiry", "units", "units_ar", "retail_price", "price_unit"],
        sample: { trade_name_ar: "بنادول اكسترا", trade_name_en: "Panadol Extra", generic_name: "Paracetamol + Caffeine", strength: "500mg", dosage_form: "Tablet", manufacturer: "GSK", barcode: "5000347012345", tax_bp: "0", rx_required: "NONE", track_expiry: "true", units: "Carton:240|Box:24|Strip:12|Tablet:1", units_ar: "كرتون|علبة|شريط|حبة", retail_price: "1500.00", price_unit: "Box" } },
      customers: { cols: ["code", "name", "phone", "address", "credit_limit", "credit_currency", "notes"], sample: { name: "محمد علي", phone: "777123456", address: "صنعاء", credit_limit: "0", credit_currency: "YER_NEW" } },
      suppliers: { cols: ["code", "name", "phone", "address", "tax_number", "default_currency", "payment_terms_days"], sample: { name: "شركة الأدوية المتحدة", phone: "01-234567", default_currency: "YER_NEW", payment_terms_days: "30" } },
    };
    const d = t[kind]; if (!d) throw ApiError.notFound("import.unknown_kind", "Unknown template");
    return toCsv([d.sample], d.cols);
  }

  private bool(v: string, dflt: boolean): boolean { return v === "" ? dflt : /^(true|1|yes|نعم)$/i.test(v); }
  private minor(v: string): string | null { if (v === "") return "0"; if (!/^\d+(\.\d{1,2})?$/.test(v)) return null; const [i = "0", f = ""] = v.split("."); return (BigInt(i) * 100n + BigInt((f + "00").slice(0, 2))).toString(); }

  async importItems(tenantId: string, actorId: string, csv: string, dryRun: boolean): Promise<ImportResult> {
    const { headers, records } = csvRecords(csv);
    const errors: RowError[] = [];
    for (const h of ["trade_name_ar", "trade_name_en", "units"]) if (!headers.includes(h)) throw ApiError.badRequest("import.missing_column", `Missing column ${h}`, { column: h });
    const inputs: Array<{ input: ItemInput; barcode: string | null; price: { unitName: string; minor: string } | null }> = [];
    const seenCodes = new Set<string>();
    records.forEach((r, idx) => {
      const row = idx + 2; const e = (field: string, code: string, message: string) => errors.push({ row, field, code, message });
      if (!r["trade_name_ar"]) e("trade_name_ar", "required", "Arabic trade name required");
      if (!r["trade_name_en"]) e("trade_name_en", "required", "English trade name required");
      const code = r["item_code"] ?? ""; if (code) { if (seenCodes.has(code)) e("item_code", "duplicate_in_file", `Duplicate item_code ${code}`); seenCodes.add(code); }
      const parts = (r["units"] ?? "").split("|").map((p) => p.trim()).filter(Boolean);
      const ar = (r["units_ar"] ?? "").split("|").map((p) => p.trim());
      const units: ItemInput["units"] = [];
      parts.forEach((p, i) => {
        const [name, f] = p.split(":"); const factor = Number(f);
        if (!name || !Number.isInteger(factor) || factor < 1) { e("units", "bad_unit", `Unit "${p}" must be Name:factor`); return; }
        units.push({ nameAr: ar[i] || name, nameEn: name, factorToSsu: factor, level: i + 1, isSsu: i === parts.length - 1, canSell: i !== 0 || parts.length === 1, canPurchase: true, isDefaultSale: i === (parts.length > 1 ? 1 : 0), isDefaultPurchase: i === 0, isStockDisplay: i === (parts.length > 1 ? 1 : 0) });
      });
      if (units.length && units[units.length - 1]!.factorToSsu !== 1) e("units", "ssu_factor", "Last unit must have factor 1 (SSU)");
      for (let i = 1; i < units.length; i++) if (units[i - 1]!.factorToSsu <= units[i]!.factorToSsu || units[i - 1]!.factorToSsu % units[i]!.factorToSsu !== 0) e("units", "ladder", `Factor ${units[i - 1]!.factorToSsu} must be a multiple of ${units[i]!.factorToSsu}`);
      const taxBp = r["tax_bp"] ? Number(r["tax_bp"]) : 0; if (!Number.isInteger(taxBp) || taxBp < 0 || taxBp > 10000) e("tax_bp", "range", "tax_bp must be 0..10000");
      const rx = (r["rx_required"] || "NONE").toUpperCase(); if (!["NONE", "RX", "RX_RETAIN"].includes(rx)) e("rx_required", "enum", "rx_required must be NONE|RX|RX_RETAIN");
      let price: { unitName: string; minor: string } | null = null;
      if (r["retail_price"]) { const m = this.minor(r["retail_price"]); if (m === null) e("retail_price", "decimal", "retail_price must be a decimal with ≤2 places"); else price = { unitName: r["price_unit"] || (units[1] ?? units[0])?.nameEn || "", minor: m }; }
      if (price && !units.some((u) => u.nameEn === price!.unitName)) e("price_unit", "unknown_unit", `price_unit ${price.unitName} not in units`);
      inputs.push({ input: { itemCode: code || undefined, tradeNameAr: r["trade_name_ar"] ?? "", tradeNameEn: r["trade_name_en"] ?? "", genericName: r["generic_name"] || undefined, strength: r["strength"] || undefined, dosageForm: r["dosage_form"] || undefined, manufacturer: r["manufacturer"] || undefined,
        rxRequired: rx as ItemInput["rxRequired"], controlledClass: "NONE", trackExpiry: this.bool(r["track_expiry"] ?? "", true), requiresColdChain: false, isReturnable: true, taxBp, minStockSsu: 0, units }, barcode: r["barcode"] || null, price });
    });
    // existence checks (codes / barcodes) in one query
    const codes = inputs.map((i) => i.input.itemCode).filter((c): c is string => !!c); const barcodes = inputs.map((i) => i.barcode).filter((b): b is string => !!b);
    await this.db.tx(tenantId, async (tx) => {
      if (codes.length) for (const r of await tx<{ item_code: string }[]>`SELECT item_code FROM items WHERE item_code = ANY(${codes}::text[])`) errors.push({ row: inputs.findIndex((i) => i.input.itemCode === r.item_code) + 2, field: "item_code", code: "exists", message: `item_code ${r.item_code} already exists` });
      if (barcodes.length) for (const r of await tx<{ barcode: string }[]>`SELECT barcode FROM item_barcodes WHERE barcode = ANY(${barcodes}::text[]) OR normalized_barcode = ANY(${barcodes.map((b) => b.padStart(14, "0"))}::text[])`) errors.push({ row: inputs.findIndex((i) => i.barcode === r.barcode) + 2, field: "barcode", code: "exists", message: `barcode ${r.barcode} already exists` });
    });
    errors.sort((a, b) => a.row - b.row);
    const result: ImportResult = { total: records.length, valid: records.length - new Set(errors.map((e) => e.row)).size, imported: 0, errors, dryRun };
    if (dryRun || errors.length) return result;
    // all-or-nothing
    await this.db.tx(tenantId, async (tx) => {
      const [retail] = await tx<{ id: string }[]>`SELECT id FROM price_lists WHERE code = 'RETAIL' LIMIT 1`;
      for (const it of inputs) {
        const created = await this.catalog.createIn(tx, tenantId, actorId, it.input);
        if (it.barcode) {
          const [u] = await tx<{ id: string }[]>`SELECT id FROM item_units WHERE item_id = ${created.id} ORDER BY is_default_sale DESC, level DESC LIMIT 1`;
          if (u) await this.catalog.addBarcodeIn(tx, tenantId, actorId, created.id, { barcode: it.barcode, unitId: u.id, isPrimary: true, generateInternal: false });
        }
        if (it.price && retail) await tx`INSERT INTO price_list_items (tenant_id, price_list_id, item_id, unit_id, unit_price_minor) SELECT ${tenantId}, ${retail.id}, ${created.id}, id, ${it.price.minor} FROM item_units WHERE item_id = ${created.id} AND name_en = ${it.price.unitName} LIMIT 1`;
        result.imported++;
      }
      await tx`INSERT INTO audit_log (tenant_id, actor_user_id, action, entity_type, entity_id, after_data) VALUES (${tenantId}, ${actorId}, 'items.import', 'import', gen_random_uuid(), ${tx.json({ imported: result.imported })})`;
    });
    return result;
  }

  async importParties(tenantId: string, actor: { userId: string; permissions: ReadonlySet<string> }, kind: "customers" | "suppliers", csv: string, dryRun: boolean): Promise<ImportResult> {
    const { headers, records } = csvRecords(csv);
    if (!headers.includes("name")) throw ApiError.badRequest("import.missing_column", "Missing column name", { column: "name" });
    const errors: RowError[] = []; const CUR = ["YER_OLD", "YER_NEW", "SAR", "USD"];
    records.forEach((r, idx) => {
      const row = idx + 2;
      if (!r["name"]) errors.push({ row, field: "name", code: "required", message: "name required" });
      const cur = r["credit_currency"] || r["default_currency"]; if (cur && !CUR.includes(cur)) errors.push({ row, field: "currency", code: "enum", message: `currency must be ${CUR.join("|")}` });
      if (r["credit_limit"] && this.minor(r["credit_limit"]) === null) errors.push({ row, field: "credit_limit", code: "decimal", message: "credit_limit must be a decimal" });
      if (r["payment_terms_days"] && !/^\d+$/.test(r["payment_terms_days"])) errors.push({ row, field: "payment_terms_days", code: "integer", message: "payment_terms_days must be an integer" });
    });
    const result: ImportResult = { total: records.length, valid: records.length - new Set(errors.map((e) => e.row)).size, imported: 0, errors, dryRun };
    if (dryRun || errors.length) return result;
    await this.db.tx(tenantId, async (tx) => {
      for (const r of records) {
        if (kind === "customers") {
          await this.customers.createIn(tx, tenantId, actor, { code: r["code"] || undefined, name: r["name"] ?? "", phone: r["phone"] || undefined, address: r["address"] || undefined, creditLimitMinor: this.minor(r["credit_limit"] ?? "") ?? "0", creditCurrency: (r["credit_currency"] || undefined) as never, notes: r["notes"] || undefined });
        } else {
          await this.suppliers.createIn(tx, tenantId, actor.userId, { code: r["code"] || undefined, name: r["name"] ?? "", phone: r["phone"] || undefined, address: r["address"] || undefined, taxNumber: r["tax_number"] || undefined, defaultCurrency: (r["default_currency"] || undefined) as never, paymentTermsDays: r["payment_terms_days"] ? Number(r["payment_terms_days"]) : 0 });
        }
        result.imported++;
      }
    });
    return result;
  }

  async exportItems(tenantId: string): Promise<string> {
    return this.db.tx(tenantId, async (tx) => {
      const rows = await tx<Record<string, unknown>[]>`
        SELECT i.item_code, i.trade_name_ar, i.trade_name_en, i.generic_name, i.strength, i.dosage_form, i.manufacturer, i.tax_bp, i.rx_required, i.track_expiry, i.is_active,
               (SELECT string_agg(u.name_en || ':' || u.factor_to_ssu, '|' ORDER BY u.level) FROM item_units u WHERE u.item_id = i.id AND u.is_active) AS units,
               (SELECT string_agg(u.name_ar, '|' ORDER BY u.level) FROM item_units u WHERE u.item_id = i.id AND u.is_active) AS units_ar,
               (SELECT b.barcode FROM item_barcodes b WHERE b.item_id = i.id ORDER BY b.is_primary DESC LIMIT 1) AS barcode
        FROM items i ORDER BY i.item_code`;
      return toCsv(rows, ["item_code", "trade_name_ar", "trade_name_en", "generic_name", "strength", "dosage_form", "manufacturer", "barcode", "tax_bp", "rx_required", "track_expiry", "units", "units_ar", "is_active"]);
    });
  }
  async exportParties(tenantId: string, kind: "customers" | "suppliers"): Promise<string> {
    return this.db.tx(tenantId, async (tx) => {
      if (kind === "customers") return toCsv(await tx<Record<string, unknown>[]>`SELECT code, name, phone, address, (credit_limit_minor::numeric / 100)::text AS credit_limit, credit_currency, notes, is_active FROM customers WHERE NOT is_walk_in ORDER BY code`, ["code", "name", "phone", "address", "credit_limit", "credit_currency", "notes", "is_active"]);
      return toCsv(await tx<Record<string, unknown>[]>`SELECT code, name, phone, address, tax_number, default_currency, payment_terms_days, is_active FROM suppliers ORDER BY code`, ["code", "name", "phone", "address", "tax_number", "default_currency", "payment_terms_days", "is_active"]);
    });
  }
}
