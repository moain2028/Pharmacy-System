export interface SaleRow { id: string; number: string; business_date: string; customer_name: string | null; total_minor: string; paid_minor: string; credit_minor: string; currency: string; status: string }
export interface SaleInvoice extends SaleRow { cashier_name?: string | null; gross_minor?: string; discount_minor?: string; tax_minor?: string; change_minor?: string; change_currency?: string; notes?: string | null }
export interface SaleLine { id: string; item_id: string; trade_name_ar: string; trade_name_en: string; unit_name_ar?: string; unit_name_en?: string; factor_to_ssu: string; qty_in_unit: string | number; qty_ssu: string; unit_price_minor: string; discount_minor?: string; tax_minor?: string; total_minor: string; returned_qty_ssu?: string }
export interface SaleLot { line_id: string; lot_id: string; lot_number: string; expiry_date: string | null; qty_ssu: string }
export interface SalePayment { method: string; currency: string; amount_minor: string; payment_ref?: string | null }
export interface SaleDetailDto { invoice: SaleInvoice; lines: SaleLine[]; lots: SaleLot[]; payments: SalePayment[] }
export type Paged<T> = T[] | { rows?: T[]; total?: number };

export const rowsOf = <T>(x: Paged<T> | null | undefined): T[] => (Array.isArray(x) ? x : x?.rows ?? []);
export const METHOD_KEY: Record<string, string> = { CASH: "pos.cash", CARD: "pos.card", WALLET: "pos.wallet", CREDIT: "pos.credit" };
export const statusTone = (s: string): "green" | "red" | "slate" => (s === "POSTED" ? "green" : s === "VOID" || s === "VOIDED" ? "red" : "slate");
export const statusKey = (s: string): string => (s === "POSTED" ? "sales.statusPosted" : s === "VOID" || s === "VOIDED" ? "sales.statusVoid" : "sales.statusDraft");
