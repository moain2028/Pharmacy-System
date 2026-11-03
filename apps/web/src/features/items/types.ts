export interface ItemRow { id: string; code: string; trade_name_ar: string; trade_name_en: string; generic_name: string | null; strength: string | null; dosage_form: string | null; rx_required: string; tax_bp: number; is_active: boolean }
export interface UnitRow { id: string; name_ar: string; name_en: string; factor_to_ssu: string; level: number; is_ssu: boolean; can_sell: boolean; can_purchase: boolean; is_default_sale: boolean; is_default_purchase?: boolean; is_stock_display?: boolean }
export interface BarcodeRow { barcode: string; unit_id: string; is_primary: boolean }
export interface PriceRow { price_list_id: string; unit_id: string; unit_price_minor: string; min_price_minor: string | null }
export interface ItemFull extends ItemRow {
  manufacturer?: string | null; country_of_origin?: string | null; controlled_class?: string | null; track_expiry?: boolean; requires_cold_chain?: boolean; is_returnable?: boolean;
  min_stock_ssu?: number | string | null; notes?: string | null; units: UnitRow[]; barcodes: BarcodeRow[]; prices: PriceRow[];
}
export interface PriceList { id: string; code: string; name_ar: string; name_en: string; currency: string; is_default: boolean }
export interface LocationRow { id: string; code: string; name_ar: string; name_en: string }
export interface BalanceRow { lot_id: string; lot_number: string; expiry_date: string | null; location_id: string; qty_ssu: string; manual_status: string; unit_cost_minor: string }

export type Rx = "NONE" | "RX" | "RX_RETAIN";
export type Ctl = "NONE" | "PSYCHOTROPIC" | "NARCOTIC" | "PRECURSOR";
export const RX_VALUES: Rx[] = ["NONE", "RX", "RX_RETAIN"];
export const CTL_VALUES: Ctl[] = ["NONE", "PSYCHOTROPIC", "NARCOTIC", "PRECURSOR"];

/** POST /items payload (matches the Item zod schema). */
export interface UnitBody { id?: string | undefined; nameAr: string; nameEn: string; factorToSsu: number; level: number; isSsu: boolean; canSell: boolean; canPurchase: boolean; isDefaultSale: boolean; isDefaultPurchase: boolean; isStockDisplay: boolean }
export interface ItemBody {
  tradeNameAr: string; tradeNameEn: string; genericName?: string | undefined; strength?: string | undefined; dosageForm?: string | undefined; manufacturer?: string | undefined; countryOfOrigin?: string | undefined;
  rxRequired: Rx; controlledClass: Ctl; trackExpiry: boolean; requiresColdChain: boolean; isReturnable: boolean; taxBp: number; minStockSsu: number; notes?: string | undefined; units: UnitBody[];
}
export interface PriceBody { priceListId: string; itemId: string; unitId: string; unitPriceMinor: string; minPriceMinor?: string | undefined }
export interface BarcodeBody { barcode?: string | undefined; unitId: string; isPrimary: boolean; generateInternal: boolean }

export interface Named { name_ar: string; name_en: string }
export const nameOf = (o: Named | undefined, locale: string, fallback = "—"): string => (o ? (locale === "ar" ? o.name_ar : o.name_en) : fallback);
export function rowsOf<T>(x: T[] | { rows?: T[] } | null | undefined): T[] { return Array.isArray(x) ? x : (x?.rows ?? []); }
