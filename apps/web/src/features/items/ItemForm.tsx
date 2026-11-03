import { useState, type FormEvent } from "react";
import { useT } from "@/i18n";
import { ErrorBox, Field } from "@/components/ui";
import { CTL_VALUES, RX_VALUES, type Ctl, type ItemBody, type ItemFull, type Rx } from "./types";

export interface UnitDraft { id?: string | undefined; nameAr: string; nameEn: string; factor: string; level: string; isSsu: boolean; canSell: boolean; canPurchase: boolean; isDefaultSale: boolean; isDefaultPurchase: boolean; isStockDisplay: boolean }
type TextKey = "nameAr" | "nameEn" | "factor" | "level";
type FlagKey = "isSsu" | "canSell" | "canPurchase" | "isDefaultSale" | "isDefaultPurchase" | "isStockDisplay";
type RowErr = Partial<Record<TextKey, string>>;
export interface LadderErrors { form: string[]; rows: RowErr[] }
interface Props { initial?: ItemFull | undefined; onSubmit: (body: ItemBody) => void; onCancel: () => void; submitting: boolean; error?: unknown }
type StrKey = "tradeNameAr" | "tradeNameEn" | "genericName" | "strength" | "dosageForm" | "manufacturer" | "countryOfOrigin" | "taxBp" | "minStockSsu" | "notes";
interface Head extends Record<StrKey, string> { rxRequired: Rx; controlledClass: Ctl; trackExpiry: boolean; requiresColdChain: boolean; isReturnable: boolean }

const posInt = (s: string): number | null => (/^\d+$/.test(s.trim()) && Number(s) >= 1 ? Number(s) : null);
const nonNegInt = (s: string): number | null => (/^\d+$/.test(s.trim()) ? Number(s) : null);
const opt = (s: string): string | undefined => (s.trim() ? s.trim() : undefined);
const fe = (e: string | undefined) => (e ? { error: e } : {});
const TEXT_LABEL: Record<TextKey, string> = { nameAr: "items.unitNameAr", nameEn: "items.unitNameEn", factor: "items.factor", level: "items.level" };
const FLAG_LABEL: Record<FlagKey, string> = { isSsu: "items.ssu", canSell: "items.canSell", canPurchase: "items.canPurchase", isDefaultSale: "items.defaultSale", isDefaultPurchase: "items.defaultPurchase", isStockDisplay: "items.stockDisplay" };
const FLAGS = Object.keys(FLAG_LABEL) as FlagKey[];

/** Pure ladder validation. Returns i18n keys so it stays locale-independent and unit-testable. */
export function validateLadder(units: UnitDraft[]): LadderErrors {
  const rows: RowErr[] = units.map(() => ({}));
  const form: string[] = [];
  if (units.length === 0) form.push("items.err.needUnit");
  units.forEach((u, i) => {
    const e = rows[i]; if (!e) return;
    if (!u.nameAr.trim()) e.nameAr = "items.err.nameRequired";
    if (!u.nameEn.trim()) e.nameEn = "items.err.nameRequired";
    if (posInt(u.factor) === null) e.factor = "items.err.factorInt";
    if (posInt(u.level) === null) e.level = "items.err.levelInt";
  });
  const ssus = units.filter((u) => u.isSsu);
  if (units.length > 0 && ssus.length !== 1) form.push("items.err.oneSsu");
  else if (ssus[0] && posInt(ssus[0].factor) !== 1) form.push("items.err.ssuFactorOne");
  const ladder = units.map((u, i) => ({ i, f: posInt(u.factor), l: posInt(u.level) }))
    .filter((x): x is { i: number; f: number; l: number } => x.f !== null && x.l !== null).sort((a, b) => a.l - b.l);
  for (let k = 0; k + 1 < ladder.length; k++) {
    const cur = ladder[k], nxt = ladder[k + 1];
    if (!cur || !nxt) break;
    const ec = rows[cur.i], en = rows[nxt.i];
    if (cur.l === nxt.l) { if (en && !en.level) en.level = "items.err.levelDup"; continue; }
    if (cur.f <= nxt.f) { if (ec && !ec.factor) ec.factor = "items.err.descending"; }
    else if (cur.f % nxt.f !== 0 && ec && !ec.factor) ec.factor = "items.err.divisible";
  }
  return { form, rows };
}
export const ladderOk = (e: LadderErrors): boolean => e.form.length === 0 && e.rows.every((r) => Object.keys(r).length === 0);

export const blankUnit = (level: number, isSsu: boolean): UnitDraft => ({ nameAr: "", nameEn: "", factor: isSsu ? "1" : "", level: String(level), isSsu, canSell: true, canPurchase: true, isDefaultSale: isSsu, isDefaultPurchase: !isSsu, isStockDisplay: isSsu });
const draftsOf = (it: ItemFull | undefined): UnitDraft[] => it
  ? it.units.map((u) => ({ id: u.id, nameAr: u.name_ar, nameEn: u.name_en, factor: String(u.factor_to_ssu), level: String(u.level), isSsu: u.is_ssu, canSell: u.can_sell, canPurchase: u.can_purchase, isDefaultSale: u.is_default_sale, isDefaultPurchase: u.is_default_purchase ?? false, isStockDisplay: u.is_stock_display ?? false }))
  : [blankUnit(1, true)];
const headOf = (it: ItemFull | undefined): Head => {
  const rx = it?.rx_required, ctl = it?.controlled_class;
  return {
    tradeNameAr: it?.trade_name_ar ?? "", tradeNameEn: it?.trade_name_en ?? "", genericName: it?.generic_name ?? "", strength: it?.strength ?? "", dosageForm: it?.dosage_form ?? "",
    manufacturer: it?.manufacturer ?? "", countryOfOrigin: it?.country_of_origin ?? "", taxBp: String(it?.tax_bp ?? 0), minStockSsu: String(it?.min_stock_ssu ?? 0), notes: it?.notes ?? "",
    rxRequired: RX_VALUES.find((v) => v === rx) ?? "NONE", controlledClass: CTL_VALUES.find((v) => v === ctl) ?? "NONE",
    trackExpiry: it?.track_expiry ?? true, requiresColdChain: it?.requires_cold_chain ?? false, isReturnable: it?.is_returnable ?? true,
  };
};

export default function ItemForm({ initial, onSubmit, onCancel, submitting, error }: Props) {
  const { t } = useT();
  const [h, setH] = useState<Head>(() => headOf(initial));
  const [units, setUnits] = useState<UnitDraft[]>(() => draftsOf(initial));
  const [he, setHe] = useState<Partial<Record<StrKey, string>>>({});
  const [le, setLe] = useState<LadderErrors>({ form: [], rows: [] });
  const setS = (k: StrKey, v: string) => setH((p) => ({ ...p, [k]: v }));
  const upd = (i: number, patch: Partial<UnitDraft>) => setUnits((p) => p.map((u, j) => (j === i ? { ...u, ...patch } : u)));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const errs: Partial<Record<StrKey, string>> = {};
    if (!h.tradeNameAr.trim()) errs.tradeNameAr = t("items.err.nameRequired");
    if (!h.tradeNameEn.trim()) errs.tradeNameEn = t("items.err.nameRequired");
    const tax = nonNegInt(h.taxBp || "0"), minS = nonNegInt(h.minStockSsu || "0");
    if (tax === null || tax > 10000) errs.taxBp = t("items.err.taxRange");
    if (minS === null) errs.minStockSsu = t("items.err.intMin0");
    const lad = validateLadder(units);
    setHe(errs); setLe(lad);
    if (Object.keys(errs).length > 0 || !ladderOk(lad) || tax === null || minS === null) return;
    onSubmit({
      tradeNameAr: h.tradeNameAr.trim(), tradeNameEn: h.tradeNameEn.trim(), genericName: opt(h.genericName), strength: opt(h.strength), dosageForm: opt(h.dosageForm), manufacturer: opt(h.manufacturer), countryOfOrigin: opt(h.countryOfOrigin),
      rxRequired: h.rxRequired, controlledClass: h.controlledClass, trackExpiry: h.trackExpiry, requiresColdChain: h.requiresColdChain, isReturnable: h.isReturnable, taxBp: tax, minStockSsu: minS, notes: opt(h.notes),
      units: units.map((u) => ({ id: u.id, nameAr: u.nameAr.trim(), nameEn: u.nameEn.trim(), factorToSsu: Number(u.factor), level: Number(u.level), isSsu: u.isSsu, canSell: u.canSell, canPurchase: u.canPurchase, isDefaultSale: u.isDefaultSale, isDefaultPurchase: u.isDefaultPurchase, isStockDisplay: u.isStockDisplay })),
    });
  };

  const text = (k: StrKey, label: string, num = false) => (
    <Field label={label} {...fe(he[k])}><input className={`input${num ? " num" : ""}`} {...(num ? { inputMode: "numeric" as const } : {})} value={h[k]} onChange={(e) => setS(k, e.target.value)} data-testid={`f-${k}`} autoFocus={k === "tradeNameAr"} /></Field>
  );
  const cb = (label: string, checked: boolean, on: (v: boolean) => void) => (
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={checked} onChange={(e) => on(e.target.checked)} />{label}</label>
  );
  const cell = (i: number, k: TextKey, v: string, err: string | undefined, num: boolean) => (
    <td><input className={`input min-w-24${num ? " num" : ""}`} aria-label={t(TEXT_LABEL[k])} value={v} onChange={(e) => upd(i, { [k]: e.target.value } as Pick<UnitDraft, TextKey>)} data-testid={`u-${k}-${i}`} />
      {err && <span role="alert" className="mt-1 block text-xs text-red-600">{t(err)}</span>}</td>
  );

  return (
    <form onSubmit={submit} data-testid="item-form" className="space-y-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {text("tradeNameAr", t("items.nameAr"))}{text("tradeNameEn", t("items.nameEn"))}{text("genericName", t("items.generic"))}{text("strength", t("items.strength"))}
        {text("dosageForm", t("items.dosageForm"))}{text("manufacturer", t("items.manufacturer"))}{text("countryOfOrigin", t("items.country"))}{text("taxBp", t("items.taxBp"), true)}
        <Field label={t("items.rx")}><select className="input" value={h.rxRequired} onChange={(e) => setH((p) => ({ ...p, rxRequired: RX_VALUES.find((v) => v === e.target.value) ?? "NONE" }))}>{RX_VALUES.map((v) => <option key={v} value={v}>{t(`items.rx.${v}`)}</option>)}</select></Field>
        <Field label={t("items.controlled")}><select className="input" value={h.controlledClass} onChange={(e) => setH((p) => ({ ...p, controlledClass: CTL_VALUES.find((v) => v === e.target.value) ?? "NONE" }))}>{CTL_VALUES.map((v) => <option key={v} value={v}>{t(`items.ctl.${v}`)}</option>)}</select></Field>
        {text("minStockSsu", t("items.minStock"), true)}{text("notes", t("common.notes"))}
      </div>
      <div className="flex flex-wrap gap-4">
        {cb(t("items.trackExpiry"), h.trackExpiry, (v) => setH((p) => ({ ...p, trackExpiry: v })))}
        {cb(t("items.coldChain"), h.requiresColdChain, (v) => setH((p) => ({ ...p, requiresColdChain: v })))}
        {cb(t("items.returnable"), h.isReturnable, (v) => setH((p) => ({ ...p, isReturnable: v })))}
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between"><h3 className="font-medium">{t("items.units")}</h3>
          <button type="button" className="btn-secondary" onClick={() => setUnits((p) => [...p, blankUnit(p.length + 1, p.length === 0)])}>{t("items.addUnit")}</button></div>
        <p className="mb-2 text-xs text-slate-500">{t("items.ladderHint")}</p>
        {le.form.map((k) => <div key={k} role="alert" className="mb-2 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">{t(k)}</div>)}
        <div className="overflow-x-auto"><table>
          <thead><tr><th>{t("items.unitNameAr")}</th><th>{t("items.unitNameEn")}</th><th>{t("items.factor")}</th><th>{t("items.level")}</th>{FLAGS.map((f) => <th key={f}>{t(FLAG_LABEL[f])}</th>)}<th /></tr></thead>
          <tbody>{units.map((u, i) => { const re = le.rows[i] ?? {}; return (
            <tr key={i}>
              {cell(i, "nameAr", u.nameAr, re.nameAr, false)}{cell(i, "nameEn", u.nameEn, re.nameEn, false)}{cell(i, "factor", u.factor, re.factor, true)}{cell(i, "level", u.level, re.level, true)}
              {FLAGS.map((f) => <td key={f} className="text-center"><input type="checkbox" aria-label={t(FLAG_LABEL[f])} checked={u[f]} onChange={(e) => upd(i, { [f]: e.target.checked } as Pick<UnitDraft, FlagKey>)} data-testid={`u-${f}-${i}`} /></td>)}
              <td><button type="button" aria-label={t("items.removeUnit")} className="text-red-600" onClick={() => setUnits((p) => p.filter((_, j) => j !== i))}>✕</button></td>
            </tr>); })}</tbody>
        </table></div>
      </div>
      {error ? <ErrorBox error={error} /> : null}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel}>{t("common.cancel")}</button>
        <button type="submit" className="btn-primary" disabled={submitting}>{t("common.save")}</button>
      </div>
    </form>
  );
}
