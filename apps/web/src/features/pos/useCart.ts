import { useEffect, useState } from "react";
import { create } from "zustand";
import type { MoneyJson } from "@/lib/api";
import { fmtMinor, fmtMoney, parseToMinor } from "@/lib/money";

export const CURRENCIES = ["YER_NEW", "YER_OLD", "SAR", "USD"] as const;
export type TenderMethod = "CASH" | "CARD" | "WALLET" | "CREDIT";

export interface ItemRow { id: string; code: string; trade_name_ar: string; trade_name_en: string; strength?: string | null }
export interface ItemUnit { id: string; name_ar: string; name_en: string; factor_to_ssu: string; can_sell: boolean; is_default_sale: boolean }
export interface ItemDetail extends ItemRow { units: ItemUnit[] }
export interface LotOverride { lotId: string; reason: string }
export interface CartLine {
  key: string; itemId: string; nameAr: string; nameEn: string; unitId: string; unitName: string; factor: string; qtyInUnit: number;
  unitPriceMinor?: string | undefined; lineDiscountBp?: number | undefined; lotOverride?: LotOverride | undefined;
}
export interface CartCustomer { id: string; name: string }
export interface CartSnapshot { lines: CartLine[]; customer: CartCustomer | null; invoiceDiscountBp: number }
export interface HeldCart { id: string; at: string; snapshot: CartSnapshot }
export interface Tender { method: TenderMethod; currency: string; amountMinor: string; paymentRef?: string | undefined }
export interface Overrides { approverUsername: string; approverSecret: string; reason: string; belowMin?: boolean | undefined; belowCost?: boolean | undefined; aboveOfficial?: boolean | undefined; credit?: boolean | undefined }
export interface SaleLineBody { itemId: string; unitId: string; qtyInUnit: number; unitPriceMinor?: string | undefined; lineDiscountBp?: number | undefined; lotOverride?: LotOverride | undefined }
export interface SaleBody { customerId?: string | undefined; lines: SaleLineBody[]; invoiceDiscountBp?: number | undefined; tenders: Tender[] }
export interface Allocation { lotId: string; lotNumber?: string | null; expiryDate?: string | null; qtySsu: string }
export interface QuoteLine { lineId?: string; itemId: string; unitId: string; qtySsu: string; total: MoneyJson; allocations: Allocation[]; warnings: unknown[] }
export interface Totals { gross: MoneyJson; lineDiscountTotal: MoneyJson; invoiceDiscountTotal: MoneyJson; net: MoneyJson; tax: MoneyJson; total: MoneyJson; roundingAdjustment: MoneyJson; cogs: MoneyJson }
export interface Quote { totals: Totals; lines: QuoteLine[]; warnings: Array<{ code: string; lineId?: string }> }
export interface SaleResult { id: string; number: string; totals: Totals; settlement: { paid?: unknown; credit?: unknown; change?: unknown }; warnings: unknown[] }

export const newKey = (): string =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

interface CartState extends CartSnapshot {
  idempotencyKey: string;
  add: (l: Omit<CartLine, "key">) => void;
  setQty: (key: string, qty: number) => void;
  setUnit: (key: string, unitId: string, unitName: string, factor: string) => void;
  setLineDiscount: (key: string, bp: number | undefined) => void;
  remove: (key: string) => void;
  setInvoiceDiscount: (bp: number) => void;
  setCustomer: (c: CartCustomer | null) => void;
  reset: () => void;
  load: (s: CartSnapshot) => void;
}

const upd = (lines: CartLine[], key: string, f: (l: CartLine) => CartLine) => lines.map((l) => (l.key === key ? f(l) : l));

export const useCart = create<CartState>()((set) => ({
  lines: [], customer: null, invoiceDiscountBp: 0, idempotencyKey: newKey(),
  add: (l) => set((s) => {
    const ex = s.lines.find((x) => x.itemId === l.itemId && x.unitId === l.unitId && !x.lotOverride);
    return ex ? { lines: upd(s.lines, ex.key, (x) => ({ ...x, qtyInUnit: x.qtyInUnit + l.qtyInUnit })) } : { lines: [...s.lines, { ...l, key: newKey() }] };
  }),
  setQty: (key, qty) => set((s) => ({ lines: upd(s.lines, key, (l) => ({ ...l, qtyInUnit: Math.max(1, Math.floor(qty)) })) })),
  setUnit: (key, unitId, unitName, factor) => set((s) => ({ lines: upd(s.lines, key, (l) => ({ ...l, unitId, unitName, factor, unitPriceMinor: undefined, lotOverride: undefined })) })),
  setLineDiscount: (key, bp) => set((s) => ({ lines: upd(s.lines, key, (l) => ({ ...l, lineDiscountBp: bp })) })),
  remove: (key) => set((s) => ({ lines: s.lines.filter((l) => l.key !== key) })),
  setInvoiceDiscount: (bp) => set({ invoiceDiscountBp: bp }),
  setCustomer: (customer) => set({ customer }),
  reset: () => set({ lines: [], customer: null, invoiceDiscountBp: 0, idempotencyKey: newKey() }),
  load: (snap) => set({ ...snap, idempotencyKey: newKey() }),
}));

export const buildBody = (s: CartSnapshot): SaleBody => ({
  customerId: s.customer?.id,
  lines: s.lines.map((l) => ({ itemId: l.itemId, unitId: l.unitId, qtyInUnit: l.qtyInUnit, unitPriceMinor: l.unitPriceMinor, lineDiscountBp: l.lineDiscountBp || undefined, lotOverride: l.lotOverride })),
  invoiceDiscountBp: s.invoiceDiscountBp > 0 ? s.invoiceDiscountBp : undefined,
  tenders: [],
});

const HELD_KEY = "pharmacore.pos.held";
export function loadHeld(): HeldCart[] {
  try { const v: unknown = JSON.parse(localStorage.getItem(HELD_KEY) ?? "[]"); return Array.isArray(v) ? (v as HeldCart[]) : []; } catch { return []; }
}
export function saveHeld(list: HeldCart[]): void { localStorage.setItem(HELD_KEY, JSON.stringify(list)); }

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => { const id = setTimeout(() => setV(value), ms); return () => clearTimeout(id); }, [value, ms]);
  return v;
}

export const rowsOf = <T>(x: T[] | { rows?: T[] | undefined } | null | undefined): T[] => (Array.isArray(x) ? x : x?.rows ?? []);

/** "12.5" (percent) → 1250 bp; null when invalid or out of 0..100%. */
export function pctToBp(text: string): number | null {
  const s = text.trim();
  if (!s) return 0;
  const m = parseToMinor(s, "USD");
  if (m === null) return null;
  const n = Number(m);
  return n >= 0 && n <= 10000 ? n : null;
}

export const isMoney = (x: unknown): x is MoneyJson =>
  typeof x === "object" && x !== null && typeof (x as { amountMinor?: unknown }).amountMinor === "string" && typeof (x as { currency?: unknown }).currency === "string";

export function moneyText(x: unknown, locale: "ar" | "en", currency?: string): string {
  if (isMoney(x)) return fmtMoney(x, locale);
  if (Array.isArray(x)) { const p = (x as unknown[]).filter(isMoney).map((m) => fmtMoney(m, locale)); return p.length ? p.join(" + ") : "—"; }
  if (typeof x === "string" && currency && /^-?\d+$/.test(x)) return fmtMinor(x, currency, locale);
  return "—";
}

export const warnCode = (w: unknown): string =>
  typeof w === "string" ? w : typeof w === "object" && w !== null && "code" in w ? String(w.code) : "warning";
