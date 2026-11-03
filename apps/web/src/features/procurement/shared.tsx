import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DICTS, useT } from "@/i18n";
import { purchasingAr, purchasingEn } from "@/i18n/purchasing.keys";
import { suppliersAr, suppliersEn } from "@/i18n/suppliers.keys";
import { payablesAr, payablesEn } from "@/i18n/payables.keys";
import { cashAr, cashEn } from "@/i18n/cash.keys";
import { expensesAr, expensesEn } from "@/i18n/expenses.keys";
import { ErrorBox, Field, Spinner } from "@/components/ui";
import { get } from "@/lib/api";
import { fmtMinor, parseToMinor } from "@/lib/money";
Object.assign(DICTS.ar, purchasingAr, suppliersAr, payablesAr, cashAr, expensesAr);
Object.assign(DICTS.en, purchasingEn, suppliersEn, payablesEn, cashEn, expensesEn);
export type Rows<T> = T[] | { rows?: T[] | undefined; total?: number | undefined };
export function rowsOf<T>(x: Rows<T> | undefined): T[] { return x === undefined ? [] : Array.isArray(x) ? x : x.rows ?? []; }
export function record(x: unknown): Record<string, unknown> { return typeof x === "object" && x !== null && !Array.isArray(x) ? x as Record<string, unknown> : {}; }
export function text(x: unknown): string { return typeof x === "string" ? x : typeof x === "number" ? String(x) : ""; }
export function array(x: unknown): unknown[] { return Array.isArray(x) ? x : []; }
export function moneyText(x: unknown, currency: string, locale: "ar" | "en"): string {
  const r = record(x); const amount = text(r["amountMinor"] ?? x);
  return /^-?\d+$/.test(amount) ? fmtMinor(amount, text(r["currency"]) || currency, locale) : "";
}
export function useDebounce<T>(value: T): T { const [v, set] = useState(value); useEffect(() => { const timer = setTimeout(() => set(value), 250); return () => clearTimeout(timer); }, [value]); return v; }
export const currencies = ["YER_OLD", "YER_NEW", "SAR", "USD"] as const;
export function positiveMoney(v: string, currency: string, zero = false): string | null { const n = parseToMinor(v, currency); return n !== null && (zero ? BigInt(n) >= 0n : BigInt(n) > 0n) ? n : null; }
export function integer(v: string, min = 0, max = Number.MAX_SAFE_INTEGER): number | null { const n = Number(v); return /^\d+$/.test(v) && Number.isSafeInteger(n) && n >= min && n <= max ? n : null; }
export function Invalid({ show }: { show: boolean }) { const { t } = useT(); return show ? <div role="alert" className="rounded bg-danger-50 p-3 text-danger-700">{t("purchasing.invalid")}</div> : null; }
export function Input({ label, value, onChange, type = "text", required = false, autoFocus = false, maxLength }: { label: string; value: string; onChange: (v: string) => void; type?: string | undefined; required?: boolean | undefined; autoFocus?: boolean | undefined; maxLength?: number | undefined }) {
  const { t } = useT(); return <Field label={t(label)}><input className={`input w-full ${type === "date" ? "num" : ""}`} value={value} onChange={e => onChange(e.target.value)} type={type} required={required} autoFocus={autoFocus} maxLength={maxLength} /></Field>;
}
export function Currency({ value, onChange, label = "common.currency" }: { value: string; onChange: (v: string) => void; label?: string | undefined }) { const { t } = useT(); return <Field label={t(label)}><select className="input w-full" value={value} onChange={e => onChange(e.target.value)}>{currencies.map(c => <option key={c} value={c}>{t(`purchasing.currency.${c}`)}</option>)}</select></Field>; }
export function EnumSelect({ label, value, onChange, options, prefix }: { label: string; value: string; onChange: (v: string) => void; options: readonly string[]; prefix: string }) { const { t } = useT(); return <Field label={t(label)}><select className="input w-full" value={value} onChange={e => onChange(e.target.value)}>{options.map(o => <option key={o} value={o}>{t(`${prefix}.${o}`)}</option>)}</select></Field>; }
export interface Named { id: string; name?: string | undefined; name_ar?: string | undefined; name_en?: string | undefined; number?: string | undefined; code?: string | undefined }
export function RemoteSelect({ path, label, value, onChange, supplierId }: { path: string; label: string; value: string; onChange: (v: string) => void; supplierId?: string | undefined }) {
  const { t, locale } = useT(); const [search, setSearch] = useState(""); const q = useDebounce(search); const [offset, setOffset] = useState(0);
  const paged = ["/suppliers", "/goods-receipts", "/purchase-orders"].includes(path);
  const result = useQuery({ queryKey: [path, { q, offset, supplierId }], queryFn: () => get<Rows<Named>>(path, { ...(path === "/suppliers" ? { q } : {}), ...(paged ? { limit: 50, offset } : {}), supplierId }) });
  const rows = rowsOf(result.data);
  return <div className="space-y-1">{path === "/suppliers" && <Input label="purchasing.supplierSearch" value={search} onChange={v => { setSearch(v); setOffset(0); }} maxLength={100} />}<Field label={t(label)}><select className="input w-full" required value={value} onChange={e => onChange(e.target.value)}><option value="">{t("purchasing.choose")}</option>{value && !rows.some(r => r.id === value) && <option value={value}>{value}</option>}{rows.map(r => <option key={r.id} value={r.id}>{r.name ?? (locale === "ar" ? r.name_ar : r.name_en) ?? r.number ?? r.code ?? r.id}</option>)}</select></Field>{result.isLoading && <Spinner />}{result.error && <ErrorBox error={result.error} />}{paged && <Pager offset={offset} count={rows.length} total={Array.isArray(result.data) ? undefined : result.data?.total} onChange={setOffset} />}</div>;
}
export function Pager({ offset, count, total, onChange }: { offset: number; count: number; total?: number | undefined; onChange: (v: number) => void }) { const { t } = useT(); return <div className="my-2 flex items-center gap-3"><button type="button" className="btn-secondary" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - 50))}>{t("common.back")}</button><span className="num">{t("purchasing.page", { n: offset / 50 + 1 })}</span><button type="button" className="btn-secondary" disabled={total === undefined ? count < 50 : offset + 50 >= total} onClick={() => onChange(offset + 50)}>{t("common.next")}</button></div>; }
export function Totals({ value, currency }: { value: unknown; currency: string }) {
  const { t, locale } = useT(); const totals = useMemo(() => Object.entries(record(value)).filter(([k]) => ["gross", "net", "tax", "total", "lineDiscountTotal", "invoiceDiscountTotal", "roundingAdjustment"].includes(k)), [value]);
  return <dl className="grid grid-cols-2 gap-2">{totals.map(([k, v]) => <div key={k}><dt>{t(`purchasing.${k}`)}</dt><dd className="num font-semibold">{moneyText(v, currency, locale)}</dd></div>)}</dl>;
}
