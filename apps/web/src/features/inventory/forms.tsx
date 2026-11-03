import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { post } from "@/lib/api";
import { CURRENCY_LABEL, parseToMinor } from "@/lib/money";
import { useT } from "@/i18n";
import { ErrorBox, Field, toast } from "@/components/ui";
import { ItemPicker, LocationSelect, LotPicker, defaultUnit, fe, nameOf, toDigits, today, type Balance, type ItemWithUnits, type Location } from "./ItemPicker";

const isPosInt = (s: string) => /^\d+$/.test(s) && /[1-9]/.test(s);
const isSignedInt = (s: string) => /^[+-]?\d+$/.test(s) && /[1-9]/.test(s);
const STATUSES = ["NONE", "QUARANTINED", "BLOCKED", "RETURNED_TO_SUPPLIER", "DESTROYED"] as const;

function usePost<TRes>(onOk: (r: TRes) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { path: string; body: unknown }) => post<TRes>(v.path, v.body),
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ["inv"] }); onOk(r); },
  });
}
function Actions({ error, pending, label }: { error: unknown; pending: boolean; label: string }) {
  return (
    <div className="flex flex-col gap-2 md:col-span-2">
      {error ? <ErrorBox error={error} /> : null}
      <div className="flex justify-end"><button type="submit" className="btn-primary" disabled={pending}>{label}</button></div>
    </div>
  );
}
function DateInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return <Field label={label}><input type="date" className="input num" value={value} onChange={(e) => onChange(e.target.value)} /></Field>;
}
function ReasonInput({ value, onChange, error }: { value: string; onChange: (v: string) => void; error?: string | undefined }) {
  const { t } = useT();
  return <Field label={t("common.reason")} {...fe(error)}><input className="input" value={value} onChange={(e) => onChange(e.target.value)} /></Field>;
}
function ItemLot(p: { item: ItemWithUnits | null; lot: Balance | null; onItem: (i: ItemWithUnits | null) => void; onLot: (b: Balance | null) => void; locations: Location[]; itemErr?: string | undefined; lotErr?: string | undefined }) {
  return (
    <div className="grid gap-3 md:col-span-2">
      <ItemPicker value={p.item} onSelect={p.onItem} autoFocus />
      {p.itemErr && <div role="alert" className="text-xs text-danger-700">{p.itemErr}</div>}
      {p.item && <LotPicker itemId={p.item.id} value={p.lot} onSelect={p.onLot} locations={p.locations} error={p.lotErr} />}
    </div>
  );
}

export function ReceiveForm({ locations }: { locations: Location[] }) {
  const { t, locale } = useT();
  const [item, setItem] = useState<ItemWithUnits | null>(null);
  const [f, setF] = useState({ locationId: "", unitId: "", qty: "", lotNumber: "", expiry: "", cost: "", currency: "YER_NEW", date: today() });
  type K = keyof typeof f;
  const [errs, setErrs] = useState<Partial<Record<K | "item", string>>>({});
  const set = (k: K) => (v: string) => setF((s) => ({ ...s, [k]: v }));
  const units = useMemo(() => { const u = item?.units ?? []; const p = u.filter((x) => x.can_purchase); return p.length ? p : u; }, [item]);
  const m = usePost<{ lotId: string }>(() => { toast.ok(t("inv.receiveOk", { lot: f.lotNumber })); setF((s) => ({ ...s, qty: "", lotNumber: "", expiry: "", cost: "" })); });
  const pickItem = (it: ItemWithUnits | null) => { setItem(it); setF((s) => ({ ...s, unitId: it ? (defaultUnit(it.units)?.id ?? "") : "" })); };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const er: typeof errs = {};
    if (!item) er.item = t("common.required");
    if (!f.locationId) er.locationId = t("common.required");
    if (!f.unitId) er.unitId = t("common.required");
    const qty = toDigits(f.qty);
    if (!isPosInt(qty)) er.qty = t("inv.errPositiveInt");
    if (!f.lotNumber.trim()) er.lotNumber = t("common.required");
    const cost = parseToMinor(f.cost, f.currency);
    if (cost === null || cost.startsWith("-")) er.cost = t("inv.errMoney");
    setErrs(er);
    if (Object.keys(er).length > 0 || !item || cost === null) return;
    const body: Record<string, unknown> = { itemId: item.id, locationId: f.locationId, unitId: f.unitId, qtyInUnit: Number(qty), lotNumber: f.lotNumber.trim(), expiryDate: f.expiry || null, unitCostMinor: cost, costCurrency: f.currency };
    if (f.date) body["businessDate"] = f.date;
    m.mutate({ path: "/inventory/receipts", body });
  };
  return (
    <form onSubmit={submit} noValidate className="card grid gap-3 md:grid-cols-2">
      <div className="md:col-span-2"><ItemPicker value={item} onSelect={pickItem} autoFocus />{errs.item && <div role="alert" className="text-xs text-danger-700">{errs.item}</div>}</div>
      <LocationSelect label={t("inv.location")} value={f.locationId} onChange={set("locationId")} locations={locations} error={errs.locationId} />
      <Field label={t("inv.unit")} {...fe(errs.unitId)}>
        <select className="input" value={f.unitId} onChange={(e) => set("unitId")(e.target.value)} disabled={!item}>
          {!f.unitId && <option value="">—</option>}
          {units.map((u) => <option key={u.id} value={u.id}>{nameOf(u, locale)} ×{u.factor_to_ssu}</option>)}
        </select>
      </Field>
      <Field label={t("inv.qty")} {...fe(errs.qty)}><input className="input num" inputMode="numeric" value={f.qty} onChange={(e) => set("qty")(e.target.value)} /></Field>
      <Field label={t("inv.lotNumber")} {...fe(errs.lotNumber)}><input className="input" value={f.lotNumber} onChange={(e) => set("lotNumber")(e.target.value)} /></Field>
      <DateInput label={t("inv.expiryDate")} value={f.expiry} onChange={set("expiry")} />
      <DateInput label={t("inv.businessDate")} value={f.date} onChange={set("date")} />
      <Field label={t("inv.unitCost")} {...fe(errs.cost)}><input className="input num" inputMode="decimal" value={f.cost} onChange={(e) => set("cost")(e.target.value)} /></Field>
      <Field label={t("inv.costCurrency")}>
        <select className="input" value={f.currency} onChange={(e) => set("currency")(e.target.value)}>
          {Object.keys(CURRENCY_LABEL).map((c) => <option key={c} value={c}>{CURRENCY_LABEL[c]?.[locale] ?? c}</option>)}
        </select>
      </Field>
      <Actions error={m.error} pending={m.isPending} label={t("inv.submitReceive")} />
    </form>
  );
}

export function AdjustForm({ locations }: { locations: Location[] }) {
  const { t } = useT();
  const [item, setItem] = useState<ItemWithUnits | null>(null);
  const [lot, setLot] = useState<Balance | null>(null);
  const [f, setF] = useState({ locationId: "", delta: "", reason: "", mt: "ADJUSTMENT", date: today() });
  type K = keyof typeof f;
  const [errs, setErrs] = useState<Partial<Record<K | "item" | "lot", string>>>({});
  const set = (k: K) => (v: string) => setF((s) => ({ ...s, [k]: v }));
  const m = usePost<unknown>(() => { toast.ok(t("inv.adjustOk")); setF((s) => ({ ...s, delta: "", reason: "" })); setLot(null); });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const er: typeof errs = {};
    if (!item) er.item = t("common.required");
    if (!lot) er.lot = t("common.required");
    if (!f.locationId) er.locationId = t("common.required");
    const d = toDigits(f.delta).replace(/^\+/, "");
    if (!isSignedInt(d)) er.delta = t("inv.errNonZeroInt");
    if (f.reason.trim().length < 2) er.reason = t("inv.errReasonMin");
    setErrs(er);
    if (Object.keys(er).length > 0 || !lot) return;
    const body: Record<string, unknown> = { lotId: lot.lot_id, locationId: f.locationId, qtyDeltaSsu: d, reason: f.reason.trim(), movementType: f.mt };
    if (f.date) body["businessDate"] = f.date;
    m.mutate({ path: "/inventory/adjustments", body });
  };
  return (
    <form onSubmit={submit} noValidate className="card grid gap-3 md:grid-cols-2">
      <ItemLot item={item} lot={lot} onItem={(i) => { setItem(i); setLot(null); }} onLot={(b) => { setLot(b); set("locationId")(b?.location_id ?? ""); }} locations={locations} itemErr={errs.item} lotErr={errs.lot} />
      <LocationSelect label={t("inv.location")} value={f.locationId} onChange={set("locationId")} locations={locations} error={errs.locationId} />
      <Field label={t("inv.qtyDelta")} {...fe(errs.delta)}><input className="input num" inputMode="numeric" value={f.delta} onChange={(e) => set("delta")(e.target.value)} /></Field>
      <Field label={t("inv.movementType")}>
        <select className="input" value={f.mt} onChange={(e) => set("mt")(e.target.value)}>{["ADJUSTMENT", "STOCKTAKE"].map((k) => <option key={k} value={k}>{t(`inv.mt.${k}`)}</option>)}</select>
      </Field>
      <DateInput label={t("inv.businessDate")} value={f.date} onChange={set("date")} />
      <ReasonInput value={f.reason} onChange={set("reason")} error={errs.reason} />
      <Actions error={m.error} pending={m.isPending} label={t("inv.submitAdjust")} />
    </form>
  );
}

export function TransferForm({ locations }: { locations: Location[] }) {
  const { t } = useT();
  const [item, setItem] = useState<ItemWithUnits | null>(null);
  const [lot, setLot] = useState<Balance | null>(null);
  const [f, setF] = useState({ fromId: "", toId: "", qty: "", reason: "", date: today() });
  type K = keyof typeof f;
  const [errs, setErrs] = useState<Partial<Record<K | "item" | "lot", string>>>({});
  const set = (k: K) => (v: string) => setF((s) => ({ ...s, [k]: v }));
  const m = usePost<unknown>(() => { toast.ok(t("inv.transferOk")); setF((s) => ({ ...s, qty: "", reason: "" })); setLot(null); });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const er: typeof errs = {};
    if (!item) er.item = t("common.required");
    if (!lot) er.lot = t("common.required");
    if (!f.fromId) er.fromId = t("common.required");
    if (!f.toId) er.toId = t("common.required");
    else if (f.toId === f.fromId) er.toId = t("inv.errSameLocation");
    const qty = toDigits(f.qty);
    if (!isPosInt(qty)) er.qty = t("inv.errPositiveInt");
    else if (lot && /^\d+$/.test(lot.qty_ssu) && BigInt(qty) > BigInt(lot.qty_ssu)) er.qty = t("inv.errExceedsOnHand");
    setErrs(er);
    if (Object.keys(er).length > 0 || !lot) return;
    const body: Record<string, unknown> = { lotId: lot.lot_id, fromLocationId: f.fromId, toLocationId: f.toId, qtySsu: qty };
    if (f.reason.trim()) body["reason"] = f.reason.trim();
    if (f.date) body["businessDate"] = f.date;
    m.mutate({ path: "/inventory/transfers", body });
  };
  return (
    <form onSubmit={submit} noValidate className="card grid gap-3 md:grid-cols-2">
      <ItemLot item={item} lot={lot} onItem={(i) => { setItem(i); setLot(null); }} onLot={(b) => { setLot(b); set("fromId")(b?.location_id ?? ""); }} locations={locations} itemErr={errs.item} lotErr={errs.lot} />
      <LocationSelect label={t("inv.fromLocation")} value={f.fromId} onChange={set("fromId")} locations={locations} error={errs.fromId} />
      <LocationSelect label={t("inv.toLocation")} value={f.toId} onChange={set("toId")} locations={locations} error={errs.toId} />
      <Field label={t("inv.qtySsu")} {...fe(errs.qty)}><input className="input num" inputMode="numeric" value={f.qty} onChange={(e) => set("qty")(e.target.value)} /></Field>
      <DateInput label={t("inv.businessDate")} value={f.date} onChange={set("date")} />
      <ReasonInput value={f.reason} onChange={set("reason")} />
      <Actions error={m.error} pending={m.isPending} label={t("inv.submitTransfer")} />
    </form>
  );
}

export function LotStatusForm({ locations }: { locations: Location[] }) {
  const { t } = useT();
  const [item, setItem] = useState<ItemWithUnits | null>(null);
  const [lot, setLot] = useState<Balance | null>(null);
  const [f, setF] = useState({ status: "QUARANTINED", reason: "", date: today() });
  type K = keyof typeof f;
  const [errs, setErrs] = useState<Partial<Record<K | "item" | "lot", string>>>({});
  const set = (k: K) => (v: string) => setF((s) => ({ ...s, [k]: v }));
  const m = usePost<unknown>(() => { toast.ok(t("inv.statusOk")); setF((s) => ({ ...s, reason: "" })); setLot(null); });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const er: typeof errs = {};
    if (!item) er.item = t("common.required");
    if (!lot) er.lot = t("common.required");
    if (f.reason.trim().length < 2) er.reason = t("inv.errReasonMin");
    setErrs(er);
    if (Object.keys(er).length > 0 || !lot) return;
    const body: Record<string, unknown> = { status: f.status, reason: f.reason.trim() };
    if (f.date) body["businessDate"] = f.date;
    m.mutate({ path: `/inventory/lots/${lot.lot_id}/status`, body });
  };
  return (
    <form onSubmit={submit} noValidate className="card grid gap-3 md:grid-cols-2">
      <ItemLot item={item} lot={lot} onItem={(i) => { setItem(i); setLot(null); }} onLot={setLot} locations={locations} itemErr={errs.item} lotErr={errs.lot} />
      <Field label={t("inv.status")}>
        <select className="input" value={f.status} onChange={(e) => set("status")(e.target.value)}>{STATUSES.map((s) => <option key={s} value={s}>{t(`inv.status.${s}`)}</option>)}</select>
      </Field>
      <DateInput label={t("inv.businessDate")} value={f.date} onChange={set("date")} />
      <ReasonInput value={f.reason} onChange={set("reason")} error={errs.reason} />
      <Actions error={m.error} pending={m.isPending} label={t("inv.submitStatus")} />
    </form>
  );
}
