import { useMemo, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { get, post } from "@/lib/api";
import { fmtMinor, parseToMinor } from "@/lib/money";
import { useT } from "@/i18n";
import { Badge, Empty, ErrorBox, Field, PageHeader, Spinner, toast } from "@/components/ui";
import { ItemEditor } from "./ItemEditor";
import { KardexPanel, StockPanel } from "./ItemStock";
import { nameOf, rowsOf, type BarcodeBody, type ItemFull, type PriceBody, type PriceList, type UnitRow } from "./types";

type Tab = "units" | "barcodes" | "prices" | "stock" | "kardex";
const TABS: Tab[] = ["units", "barcodes", "prices", "stock", "kardex"];
const defaultUnitId = (it: ItemFull): string => it.units.find((u) => u.is_ssu)?.id ?? it.units[0]?.id ?? "";
const unitName = (it: ItemFull, id: string, locale: string) => nameOf(it.units.find((u) => u.id === id), locale, id);

export default function ItemDetail() {
  const { id = "" } = useParams();
  const { t, locale } = useT();
  const nav = useNavigate();
  const [tab, setTab] = useState<Tab>("units");
  const [edit, setEdit] = useState(false);
  const q = useQuery({ queryKey: ["items", id], queryFn: () => get<ItemFull>(`/items/${id}`), enabled: id !== "" });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} onRetry={() => void q.refetch()} />;
  const it = q.data;
  if (!it) return <Empty>{t("items.notFound")}</Empty>;
  const info: Array<[string, string]> = [[t("items.generic"), it.generic_name ?? "—"], [t("items.strength"), it.strength ?? "—"], [t("items.dosageForm"), it.dosage_form ?? "—"], [t("items.taxBp"), String(it.tax_bp)]];
  return (
    <div>
      <PageHeader title={`${it.code} · ${locale === "ar" ? it.trade_name_ar : it.trade_name_en}`} actions={<>
        <button className="btn-secondary" onClick={() => nav("/items")}>{t("common.back")}</button>
        <button className="btn-primary" onClick={() => setEdit(true)}>{t("common.edit")}</button></>} />
      <div className="card mb-3 grid grid-cols-2 gap-3 text-sm md:grid-cols-5">
        {info.map(([l, v]) => <div key={l}><div className="text-xs text-ink-500">{l}</div><div>{v}</div></div>)}
        <div className="flex flex-wrap items-center gap-1">{it.rx_required !== "NONE" && <Badge tone="amber">{t("items.rx")}</Badge>}<Badge tone={it.is_active ? "green" : "red"}>{t(it.is_active ? "common.active" : "common.inactive")}</Badge></div>
      </div>
      <div role="tablist" className="mb-3 flex flex-wrap gap-1 border-b border-ink-200">
        {TABS.map((k) => <button key={k} role="tab" aria-selected={tab === k} className={`px-3 py-2 text-sm ${tab === k ? "border-b-2 border-brand-600 font-medium" : "text-ink-500"}`} onClick={() => setTab(k)}>{t(`items.tab.${k}`)}</button>)}
      </div>
      {tab === "units" && <UnitsTable units={it.units} />}
      {tab === "barcodes" && <BarcodesPanel item={it} />}
      {tab === "prices" && <PricesPanel item={it} />}
      {tab === "stock" && <StockPanel itemId={it.id} />}
      {tab === "kardex" && <KardexPanel itemId={it.id} />}
      <ItemEditor open={edit} onClose={() => setEdit(false)} itemId={it.id} />
    </div>
  );
}

function UnitsTable({ units }: { units: UnitRow[] }) {
  const { t } = useT();
  const flags = (u: UnitRow) => [u.is_ssu && "items.ssu", u.can_sell && "items.canSell", u.can_purchase && "items.canPurchase", u.is_default_sale && "items.defaultSale", u.is_default_purchase && "items.defaultPurchase"].filter((x): x is string => typeof x === "string");
  return (
    <div className="card overflow-x-auto"><table>
      <thead><tr><th>{t("items.unitNameAr")}</th><th>{t("items.unitNameEn")}</th><th>{t("items.factor")}</th><th>{t("items.level")}</th><th>{t("common.status")}</th></tr></thead>
      <tbody>{units.map((u) => <tr key={u.id}><td>{u.name_ar}</td><td>{u.name_en}</td><td className="num">{u.factor_to_ssu}</td><td className="num">{u.level}</td>
        <td className="flex flex-wrap gap-1">{flags(u).map((k) => <Badge key={k} tone={k === "items.ssu" ? "blue" : "slate"}>{t(k)}</Badge>)}</td></tr>)}</tbody>
    </table></div>
  );
}

function UnitSelect({ units, value, onChange }: { units: UnitRow[]; value: string; onChange: (v: string) => void }) {
  const { t, locale } = useT();
  return <Field label={t("common.unit")}><select className="input" value={value} onChange={(e) => onChange(e.target.value)}>{units.map((u) => <option key={u.id} value={u.id}>{nameOf(u, locale)}</option>)}</select></Field>;
}

function BarcodesPanel({ item }: { item: ItemFull }) {
  const { t, locale } = useT();
  const qc = useQueryClient();
  const [code, setCode] = useState("");
  const [unitId, setUnitId] = useState(() => defaultUnitId(item));
  const [primary, setPrimary] = useState(false);
  const [gen, setGen] = useState(false);
  const [err, setErr] = useState("");
  const m = useMutation({
    mutationFn: (b: BarcodeBody) => post<unknown>(`/items/${item.id}/barcodes`, b),
    onSuccess: () => { toast.ok(t("items.barcodeAdded")); setCode(""); void qc.invalidateQueries({ queryKey: ["items", item.id] }); },
    onError: (e: Error) => toast.err(e.message),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if ((!gen && !code.trim()) || !unitId) { setErr(t("common.required")); return; }
    setErr("");
    m.mutate({ barcode: gen ? undefined : code.trim(), unitId, isPrimary: primary, generateInternal: gen });
  };
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      <div className="card md:col-span-2">{item.barcodes.length === 0 ? <Empty>{t("items.noBarcodes")}</Empty> : <table>
        <thead><tr><th>{t("items.barcode")}</th><th>{t("common.unit")}</th><th>{t("items.primary")}</th></tr></thead>
        <tbody>{item.barcodes.map((b) => <tr key={b.barcode}><td className="num">{b.barcode}</td><td>{unitName(item, b.unit_id, locale)}</td><td>{b.is_primary && <Badge tone="green">{t("items.primary")}</Badge>}</td></tr>)}</tbody></table>}</div>
      <form onSubmit={submit} className="card space-y-3">
        <Field label={t("items.barcode")} {...(err ? { error: err } : {})}><input className="input num" value={code} disabled={gen} autoFocus onChange={(e) => setCode(e.target.value)} /></Field>
        <UnitSelect units={item.units} value={unitId} onChange={setUnitId} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={gen} onChange={(e) => setGen(e.target.checked)} />{t("items.generateInternal")}</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={primary} onChange={(e) => setPrimary(e.target.checked)} />{t("items.primary")}</label>
        <button type="submit" className="btn-primary w-full" disabled={m.isPending}>{t("items.addBarcode")}</button>
      </form>
    </div>
  );
}

function PricesPanel({ item }: { item: ItemFull }) {
  const { t, locale } = useT();
  const qc = useQueryClient();
  const lists = useQuery({ queryKey: ["price-lists"], queryFn: () => get<PriceList[] | { rows: PriceList[] }>("/price-lists") });
  const pls = useMemo(() => rowsOf(lists.data), [lists.data]);
  const [plId, setPlId] = useState("");
  const [unitId, setUnitId] = useState(() => defaultUnitId(item));
  const [price, setPrice] = useState("");
  const [min, setMin] = useState("");
  const [err, setErr] = useState("");
  const pl = pls.find((p) => p.id === plId) ?? pls.find((p) => p.is_default) ?? pls[0];
  const m = useMutation({
    mutationFn: (b: PriceBody) => post<unknown>("/prices", b),
    onSuccess: () => { toast.ok(t("items.priceAdded")); setPrice(""); setMin(""); void qc.invalidateQueries({ queryKey: ["items", item.id] }); },
    onError: (e: Error) => toast.err(e.message),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!pl || !unitId) { setErr(t("common.required")); return; }
    const up = parseToMinor(price, pl.currency);
    const mp = min.trim() ? parseToMinor(min, pl.currency) : null;
    const badMin = min.trim() !== "" && (mp === null || mp.startsWith("-"));
    if (up === null || up.startsWith("-") || badMin) { setErr(t("items.invalidPrice")); return; }
    setErr("");
    m.mutate({ priceListId: pl.id, itemId: item.id, unitId, unitPriceMinor: up, ...(mp !== null ? { minPriceMinor: mp } : {}) });
  };
  const cur = (plid: string) => pls.find((p) => p.id === plid)?.currency ?? "YER_NEW";
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      <div className="card md:col-span-2">{lists.isLoading ? <Spinner /> : item.prices.length === 0 ? <Empty>{t("items.noPrices")}</Empty> : <table>
        <thead><tr><th>{t("items.priceList")}</th><th>{t("common.unit")}</th><th>{t("items.unitPrice")}</th><th>{t("items.minPrice")}</th></tr></thead>
        <tbody>{item.prices.map((p) => <tr key={`${p.price_list_id}-${p.unit_id}`}><td>{nameOf(pls.find((x) => x.id === p.price_list_id), locale, p.price_list_id)}</td><td>{unitName(item, p.unit_id, locale)}</td>
          <td className="num">{fmtMinor(p.unit_price_minor, cur(p.price_list_id), locale)}</td><td className="num">{p.min_price_minor ? fmtMinor(p.min_price_minor, cur(p.price_list_id), locale) : "—"}</td></tr>)}</tbody></table>}</div>
      <form onSubmit={submit} className="card space-y-3">
        <Field label={t("items.priceList")}><select className="input" value={pl?.id ?? ""} onChange={(e) => setPlId(e.target.value)}>{pls.map((p) => <option key={p.id} value={p.id}>{nameOf(p, locale)} ({p.currency})</option>)}</select></Field>
        <UnitSelect units={item.units} value={unitId} onChange={setUnitId} />
        <Field label={t("items.unitPrice")} {...(err ? { error: err } : {})}><input className="input num" inputMode="decimal" value={price} autoFocus onChange={(e) => setPrice(e.target.value)} /></Field>
        <Field label={t("items.minPrice")}><input className="input num" inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} /></Field>
        <button type="submit" className="btn-primary w-full" disabled={m.isPending || !pl}>{t("items.addPrice")}</button>
      </form>
    </div>
  );
}
