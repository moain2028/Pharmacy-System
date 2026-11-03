import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { get } from "@/lib/api";
import { useT } from "@/i18n";
import { Empty, ErrorBox, Field, Spinner } from "@/components/ui";
import { Input, Pager, useDebounce } from "@/features/procurement/shared";
export interface Unit { id: string; name_ar: string; name_en: string; can_purchase: boolean }
export interface Item { id: string; trade_name_ar: string; trade_name_en: string }
export interface Pick { itemId: string; unitId: string; name: string; unitName: string }
export default function SupplierItemPicker({ onPick, stockOnly = false }: { onPick: (v: Pick) => void; stockOnly?: boolean | undefined }) {
  const { t, locale } = useT(); const [search, setSearch] = useState(""); const q = useDebounce(search); const [offset, setOffset] = useState(0); const [selected, setSelected] = useState<Item | null>(null); const [unitId, setUnit] = useState("");
  const items = useQuery({ queryKey: ["/items", q, offset], queryFn: () => get<Item[]>("/items", { q, limit: 50, offset }), enabled: q.trim().length > 0 });
  const detail = useQuery({ queryKey: ["/items", selected?.id], queryFn: () => get<Item & { units: Unit[] }>(`/items/${selected?.id}`), enabled: selected !== null && !stockOnly });
  const units = (detail.data?.units ?? []).filter(u => u.can_purchase);
  return <div className="rounded border p-3 space-y-2"><Input label="purchasing.item" value={search} autoFocus onChange={v => { setSearch(v); setOffset(0); setSelected(null); setUnit(""); }} />{items.isFetching && <Spinner />}{items.error && <ErrorBox error={items.error} />}
    {q && !selected && <><ul className="max-h-48 overflow-auto">{items.data?.map(item => <li key={item.id}><button type="button" className="w-full p-2 text-start hover:bg-ink-100" onClick={() => { if (stockOnly) { onPick({ itemId: item.id, unitId: "", name: locale === "ar" ? item.trade_name_ar : item.trade_name_en, unitName: "" }); setSearch(""); } else { setSelected(item); setUnit(""); } }}>{locale === "ar" ? item.trade_name_ar : item.trade_name_en}</button></li>)}</ul>{items.data?.length === 0 && <Empty />}<Pager offset={offset} count={items.data?.length ?? 0} onChange={setOffset} /></>}
    {selected && <><p>{locale === "ar" ? selected.trade_name_ar : selected.trade_name_en}</p>{detail.isLoading && <Spinner />}{detail.error && <ErrorBox error={detail.error} />}<Field label={t("common.unit")}><select className="input" value={unitId} onChange={e => setUnit(e.target.value)}><option value="">{t("purchasing.choose")}</option>{units.map(u => <option key={u.id} value={u.id}>{locale === "ar" ? u.name_ar : u.name_en}</option>)}</select></Field><button type="button" className="btn-secondary" disabled={!unitId} onClick={() => { const unit = units.find(u => u.id === unitId); if (!unit) return; onPick({ itemId: selected.id, unitId, name: locale === "ar" ? selected.trade_name_ar : selected.trade_name_en, unitName: locale === "ar" ? unit.name_ar : unit.name_en }); setSelected(null); setUnit(""); setSearch(""); }}>{t("purchasing.add")}</button></>}
  </div>;
}
