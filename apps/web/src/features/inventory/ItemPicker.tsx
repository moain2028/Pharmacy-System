import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { get } from "@/lib/api";
import { useT } from "@/i18n";
import { Empty, ErrorBox, Field, Spinner } from "@/components/ui";

export interface ItemRow { id: string; code: string; trade_name_ar: string; trade_name_en: string; generic_name?: string | null; strength?: string | null }
export interface ItemUnit { id: string; name_ar: string; name_en: string; factor_to_ssu: string; level: number; is_ssu: boolean; can_sell: boolean; can_purchase: boolean; is_default_sale: boolean; is_default_purchase?: boolean }
export interface ItemWithUnits extends ItemRow { units: ItemUnit[] }
export interface Location { id: string; code: string; name_ar: string; name_en: string }
export interface Balance { lot_id: string; lot_number: string; expiry_date: string | null; location_id: string; qty_ssu: string; manual_status: string; unit_cost_minor: string }

export const rowsOf = <T,>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : ((x as { rows?: T[] } | null)?.rows ?? []));
export const today = () => new Date().toISOString().slice(0, 10);
export const toDigits = (s: string) => s.replace(/[٠-٩]/g, (c) => String("٠١٢٣٤٥٦٧٨٩".indexOf(c))).trim();
/** Spread helper so `error={undefined}` never hits `Field` (exactOptionalPropertyTypes). */
export const fe = (e: string | undefined) => (e ? { error: e } : {});
export const nameOf = (o: { name_ar: string; name_en: string }, locale: string) => (locale === "ar" ? o.name_ar : o.name_en || o.name_ar);
export const itemNameOf = (i: ItemRow, locale: string) => (locale === "ar" ? i.trade_name_ar : i.trade_name_en || i.trade_name_ar);
export const defaultUnit = (units: ItemUnit[]): ItemUnit | null => units.find((u) => u.is_default_purchase) ?? units.find((u) => u.is_ssu) ?? units[0] ?? null;

export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => { const h = setTimeout(() => setV(value), ms); return () => clearTimeout(h); }, [value, ms]);
  return v;
}
export const useLocations = () => useQuery({ queryKey: ["inv", "locations"], queryFn: async () => rowsOf<Location>(await get<unknown>("/inventory/locations")) });
export const useBalances = (itemId: string | null) => useQuery({
  queryKey: ["inv", "balances", itemId], enabled: itemId !== null,
  queryFn: async () => rowsOf<Balance>(await get<unknown>(`/inventory/items/${itemId ?? ""}/balances`)),
});

/** Search items (debounced 250ms, limit 50) → on pick loads GET /items/:id so the caller gets units. */
export function ItemPicker({ value, onSelect, autoFocus }: { value: ItemWithUnits | null; onSelect: (i: ItemWithUnits | null) => void; autoFocus?: boolean | undefined }) {
  const { t, locale } = useT();
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim());
  const search = useQuery({
    queryKey: ["items", "search", dq], enabled: value === null && dq.length > 0,
    queryFn: async () => rowsOf<ItemRow>(await get<unknown>("/items", { q: dq, limit: 50, offset: 0 })),
  });
  const pick = useMutation({ mutationFn: (id: string) => get<ItemWithUnits>(`/items/${id}`), onSuccess: (it) => { onSelect(it); setQ(""); } });
  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border border-ink-200 bg-ink-50 p-2 text-sm">
        <div><span className="font-medium">{itemNameOf(value, locale)}</span> <span className="num text-xs text-ink-500">{value.code}</span></div>
        <button type="button" className="btn-secondary" onClick={() => onSelect(null)}>{t("inv.change")}</button>
      </div>
    );
  }
  return (
    <div>
      <Field label={t("inv.item")}>
        <input className="input" autoFocus={autoFocus} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("inv.searchItem")} autoComplete="off" />
      </Field>
      {search.isFetching && <Spinner />}
      {search.error && <ErrorBox error={search.error} />}
      {pick.error && <ErrorBox error={pick.error} />}
      {search.data && dq && (search.data.length === 0 ? <Empty>{t("inv.noResults")}</Empty> : (
        <ul role="listbox" aria-label={t("inv.item")} className="mt-1 max-h-60 overflow-auto rounded-md border border-ink-200 bg-white">
          {search.data.map((r) => (
            <li key={r.id}>
              <button type="button" role="option" aria-selected={false} disabled={pick.isPending} className="flex w-full items-center justify-between px-3 py-2 text-start text-sm hover:bg-ink-50" onClick={() => pick.mutate(r.id)}>
                <span>{itemNameOf(r, locale)}{r.strength ? ` ${r.strength}` : ""}</span><span className="num text-xs text-ink-500">{r.code}</span>
              </button>
            </li>
          ))}
        </ul>
      ))}
    </div>
  );
}

export function LocationSelect({ label, value, onChange, locations, error }: { label: string; value: string; onChange: (v: string) => void; locations: Location[]; error?: string | undefined }) {
  const { t, locale } = useT();
  return (
    <Field label={label} {...fe(error)}>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t("inv.selectLocation")}</option>
        {locations.map((l) => <option key={l.id} value={l.id}>{nameOf(l, locale)}</option>)}
      </select>
    </Field>
  );
}

/** Lot (+location) picker from GET /inventory/items/:id/balances. */
export function LotPicker({ itemId, value, onSelect, locations, error }: { itemId: string; value: Balance | null; onSelect: (b: Balance | null) => void; locations: Location[]; error?: string | undefined }) {
  const { t, locale } = useT();
  const bal = useBalances(itemId);
  if (bal.isLoading) return <Spinner />;
  if (bal.error) return <ErrorBox error={bal.error} onRetry={() => void bal.refetch()} />;
  const rows = bal.data ?? [];
  if (rows.length === 0) return <Empty>{t("inv.noLots")}</Empty>;
  const key = (b: Balance) => `${b.lot_id}|${b.location_id}`;
  const locName = (id: string) => { const l = locations.find((x) => x.id === id); return l ? nameOf(l, locale) : id; };
  return (
    <Field label={t("inv.lot")} {...fe(error)}>
      <select className="input num" value={value ? key(value) : ""} onChange={(e) => onSelect(rows.find((r) => key(r) === e.target.value) ?? null)}>
        <option value="">{t("inv.selectLot")}</option>
        {rows.map((r) => (
          <option key={key(r)} value={key(r)}>
            {r.lot_number} · {r.expiry_date ?? t("inv.noExpiry")} · {locName(r.location_id)} · {r.qty_ssu}{r.manual_status && r.manual_status !== "NONE" ? ` · ${t(`inv.status.${r.manual_status}`)}` : ""}
          </option>
        ))}
      </select>
    </Field>
  );
}
