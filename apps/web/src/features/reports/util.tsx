import { useState, type ReactNode } from "react";
import { Field } from "@/components/ui";
import { useT } from "@/i18n";
import type { Locale } from "@/lib/auth";
import { isObj, moneyStr, str, type Row } from "./csv";

const pad = (n: number) => String(n).padStart(2, "0");
export const isoOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayIso = () => isoOf(new Date());
export const monthStart = () => { const d = new Date(); return isoOf(new Date(d.getFullYear(), d.getMonth(), 1)); };

export function rowsOf(x: unknown): Row[] {
  const inner = isObj(x) ? x["rows"] : undefined;
  const arr: unknown[] = Array.isArray(x) ? x : Array.isArray(inner) ? inner : [];
  return arr.filter(isObj);
}
export const field = (x: unknown, k: string): unknown => (isObj(x) ? x[k] : undefined);
export function pick(r: Row, ...keys: string[]): unknown {
  for (const k of keys) { const v = r[k]; if (v !== undefined && v !== null) return v; }
  return undefined;
}
export function sumMinor(rows: Row[], key: string): string {
  let s = 0n;
  for (const r of rows) s += BigInt(moneyStr(r[key]));
  return s.toString();
}
export function curOf(x: unknown, fallback = "YER_NEW"): string {
  const c = field(x, "currency");
  return typeof c === "string" && c !== "" ? c : fallback;
}
/** Client-side sums, overridden by server totals where present. */
export function totalsOf(data: unknown, rows: Row[], keys: string[]): Row {
  const out: Row = {};
  for (const k of keys) out[k] = sumMinor(rows, k);
  const srv = field(data, "totals");
  if (isObj(srv)) for (const k of keys) { const v = srv[k]; if (v !== undefined && v !== null && typeof v !== "boolean") out[k] = v; }
  return out;
}
/** Totals only when every row shares one currency (never add YER to SAR). */
export function sameCurrencyTotals(rows: Row[], keys: string[], curKey = "currency"): Row | undefined {
  const curs = [...new Set(rows.map((r) => str(r[curKey])))];
  if (curs.length !== 1) return undefined;
  const out: Row = { [curKey]: curs[0] };
  for (const k of keys) out[k] = sumMinor(rows, k);
  return out;
}
export function labelOf(r: Row, locale: Locale): string {
  const ar = pick(r, "labelAr", "label_ar", "name_ar", "trade_name_ar", "nameAr", "name");
  const en = pick(r, "labelEn", "label_en", "name_en", "trade_name_en", "nameEn", "name");
  return str(locale === "ar" ? ar ?? en : en ?? ar);
}
export function fmtDateTime(v: unknown): string {
  const s = str(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  return s && !Number.isNaN(d.getTime()) ? `${isoOf(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}` : s;
}
export const clampDays = (s: string) => { const n = Number.parseInt(s, 10); return Number.isFinite(n) ? Math.min(3650, Math.max(0, n)) : 90; };

export function DateField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return <Field label={label}><input type="date" className="input num" value={value} onChange={(e) => onChange(e.target.value)} /></Field>;
}
export function DaysField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useT();
  return <Field label={t("reports.days")}><input type="number" inputMode="numeric" min={0} max={3650} className="input num w-28" value={value} onChange={(e) => onChange(e.target.value)} /></Field>;
}
export function useRange(): { from: string; to: string; fields: ReactNode } {
  const { t } = useT();
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(todayIso);
  const fields = <><DateField label={t("common.from")} value={from} onChange={setFrom} /><DateField label={t("common.to")} value={to} onChange={setTo} /></>;
  return { from, to, fields };
}
