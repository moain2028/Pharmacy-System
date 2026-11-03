import { useMemo, useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { ApiError, post, type MoneyJson } from "@/lib/api";
import { CURRENCY_LABEL, fmtMinor, fmtMoney, parseToMinor } from "@/lib/money";
import { Field, Modal, toast } from "@/components/ui";
import { usePosT } from "./pos.keys";
import { CURRENCIES, moneyText, newKey, type CartCustomer, type CartLine, type Overrides, type SaleBody, type SaleResult, type TenderMethod } from "./useCart";

type Flag = "belowMin" | "belowCost" | "aboveOfficial" | "credit";
type Flags = Partial<Record<Flag, boolean>>;
const FLAGS: Flag[] = ["belowMin", "belowCost", "aboveOfficial", "credit"];
const FLAG_KEY: Record<Flag, string> = { belowMin: "pos.ovBelowMin", belowCost: "pos.ovBelowCost", aboveOfficial: "pos.ovAboveOfficial", credit: "pos.ovCredit" };
const OV_CODES: Record<string, Flag | null> = {
  "sales.below_min_price": "belowMin", "sales.below_cost": "belowCost", "sales.above_official_price": "aboveOfficial",
  "sales.credit_limit_exceeded": "credit", "discount.limit_exceeded": null,
};
const METHODS: TenderMethod[] = ["CASH", "CARD", "WALLET", "CREDIT"];
const METHOD_KEY: Record<TenderMethod, string> = { CASH: "pos.cash", CARD: "pos.card", WALLET: "pos.wallet", CREDIT: "pos.credit" };

interface Row { id: string; method: TenderMethod; currency: string; text: string; ref: string }
interface Props {
  body: SaleBody; total: MoneyJson | undefined; idempotencyKey: string; customer: CartCustomer | null; lines: CartLine[];
  onClose: () => void; onDone: () => void; onNoShift: () => void;
}

function OverrideModal({ flags, onCancel, onSubmit }: { flags: Flags; onCancel: () => void; onSubmit: (o: Overrides) => void }) {
  const { t } = usePosT();
  const [u, setU] = useState("");
  const [s, setS] = useState("");
  const [reason, setReason] = useState("");
  const [f, setF] = useState<Flags>(flags);
  const ok = u.trim() !== "" && s !== "" && reason.trim() !== "";
  return (
    <Modal open onClose={onCancel} title={t("pos.override")}>
      <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (ok) onSubmit({ approverUsername: u.trim(), approverSecret: s, reason: reason.trim(), ...f }); }}>
        <p role="alert" className="text-sm text-amber-700">{t("pos.overrideHint")}</p>
        <Field label={t("auth.username")}><input className="input" autoFocus autoComplete="off" value={u} onChange={(e) => setU(e.target.value)} /></Field>
        <Field label={t("auth.approverSecret")}><input type="password" className="input" autoComplete="off" value={s} onChange={(e) => setS(e.target.value)} /></Field>
        <Field label={t("common.reason")}><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <div className="flex flex-wrap gap-3">
          {FLAGS.map((k) => (
            <label key={k} className="flex items-center gap-1 text-sm">
              <input type="checkbox" checked={f[k] === true} onChange={(e) => setF((p) => ({ ...p, [k]: e.target.checked }))} />{t(FLAG_KEY[k])}
            </label>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onCancel}>{t("common.cancel")}</button>
          <button type="submit" className="btn-primary" disabled={!ok}>{t("pos.approve")}</button>
        </div>
      </form>
    </Modal>
  );
}

function Stat({ label, value, tone = "" }: { label: string; value: string; tone?: string }) {
  return <div className="rounded-md bg-slate-50 p-2"><div className="text-xs text-slate-500">{label}</div><div className={`num text-xl font-bold ${tone}`}>{value}</div></div>;
}

function Receipt({ r, lines }: { r: SaleResult; lines: CartLine[] }) {
  const { t, locale } = usePosT();
  return (
    <div className="hidden text-xs print:block" aria-hidden="true">
      <div className="font-bold">{t("app.name")} — {t("pos.invoice")} <span className="num">{r.number}</span></div>
      <div className="num">{new Date().toLocaleString(locale)}</div>
      <table><tbody>{lines.map((l) => <tr key={l.key}><td>{locale === "ar" ? l.nameAr : l.nameEn}</td><td className="num">{l.qtyInUnit} × {l.unitName}</td></tr>)}</tbody></table>
      <div className="flex justify-between font-bold"><span>{t("pos.total")}</span><span className="num">{fmtMoney(r.totals.total, locale)}</span></div>
      <div className="flex justify-between"><span>{t("pos.change")}</span><span className="num">{moneyText(r.settlement.change, locale)}</span></div>
    </div>
  );
}

export default function PayModal({ body, total, idempotencyKey, customer, lines, onClose, onDone, onNoShift }: Props) {
  const { t, locale } = usePosT();
  const cur = total?.currency ?? "YER_NEW";
  const totalMinor = BigInt(total?.amountMinor ?? "0");
  const plain = (v: bigint) => fmtMinor(v, cur, "en", false);
  const [rows, setRows] = useState<Row[]>(() => [{ id: newKey(), method: "CASH", currency: cur, text: total ? plain(totalMinor) : "", ref: "" }]);
  const [ov, setOv] = useState<Overrides | null>(null);
  const [ovFlags, setOvFlags] = useState<Flags | null>(null);
  const [result, setResult] = useState<SaleResult | null>(null);
  const parsed = useMemo(() => rows.map((r) => parseToMinor(r.text, r.currency)), [rows]);
  const invalid = parsed.some((p) => p === null || p.startsWith("-"));
  const creditBad = rows.some((r) => r.method === "CREDIT") && !customer;
  const sumSame = (skip?: string): bigint => rows.reduce((s, r, i) => { const p = parsed[i]; return r.id !== skip && r.currency === cur && p ? s + BigInt(p) : s; }, 0n);
  const tendered = useMemo(() => sumSame(), [rows, parsed, cur]);
  const change = tendered - totalMinor;
  const step = cur.startsWith("YER") ? 10000n : 100n;
  const remaining = (id: string) => { const r = totalMinor - sumSame(id); return r > 0n ? r : 0n; };
  const upd = (id: string, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)));

  const m = useMutation({
    mutationFn: (o: Overrides | null) => post<SaleResult>("/sales", {
      ...body,
      tenders: rows.map((r, i) => ({ method: r.method, currency: r.currency, amountMinor: parsed[i] ?? "0", ...(r.ref.trim() ? { paymentRef: r.ref.trim() } : {}) })),
      idempotencyKey,
      ...(o ? { overrides: o } : {}),
    }),
    onSuccess: (r) => { setResult(r); setOvFlags(null); toast.ok(`${t("pos.posted")}: ${r.number}`); },
    onError: (e, o) => {
      if (e instanceof ApiError) {
        if (e.code === "shifts.none_open") { onNoShift(); return; }
        if (e.code in OV_CODES) {
          const base: Flags = {};
          for (const k of FLAGS) if (o?.[k]) base[k] = true;
          const f = OV_CODES[e.code];
          if (f) base[f] = true;
          setOvFlags(base);
          toast.err(e.message);
          return;
        }
      }
      toast.err(e.message);
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (invalid || creditBad || m.isPending || body.lines.length === 0) return;
    m.mutate(ov);
  };

  if (result) {
    return (
      <Modal open onClose={onDone} title={t("pos.posted")}>
        <div className="text-center">
          <div className="text-sm text-slate-500">{t("pos.invoice")}</div>
          <div className="num text-3xl font-bold">{result.number}</div>
          <div className="mt-4 text-sm text-slate-500">{t("pos.changeDue")}</div>
          <div className="num text-4xl font-bold text-green-700">{moneyText(result.settlement.change, locale)}</div>
        </div>
        <div className="mt-4 flex justify-center gap-2">
          <button type="button" className="btn-secondary" onClick={() => window.print()}>{t("common.print")}</button>
          <button type="button" className="btn-primary" autoFocus onClick={onDone}>{t("pos.newSale")}</button>
        </div>
        <Receipt r={result} lines={lines} />
      </Modal>
    );
  }

  return (
    <>
      <Modal open onClose={onClose} title={t("pos.pay")} wide>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat label={t("pos.total")} value={total ? fmtMoney(total, locale) : "—"} />
            <Stat label={t("pos.tendered")} value={fmtMinor(tendered, cur, locale)} />
            <Stat label={t("pos.change")} value={fmtMinor(change > 0n ? change : 0n, cur, locale)} tone="text-green-700" />
          </div>
          {rows.map((r, i) => (
            <div key={r.id} className="flex flex-wrap items-end gap-2">
              <Field label={t("pos.method")}>
                <select className="input" value={r.method} onChange={(e) => upd(r.id, { method: e.target.value as TenderMethod })}>
                  {METHODS.map((x) => <option key={x} value={x}>{t(METHOD_KEY[x])}</option>)}
                </select>
              </Field>
              <Field label={t("common.currency")}>
                <select className="input" value={r.currency} onChange={(e) => upd(r.id, { currency: e.target.value })}>
                  {CURRENCIES.map((c) => <option key={c} value={c}>{CURRENCY_LABEL[c]?.[locale] ?? c}</option>)}
                </select>
              </Field>
              <Field label={t("common.amount")} {...(parsed[i] === null ? { error: t("pos.invalidAmount") } : {})}>
                <input className="input num w-40" autoFocus={i === 0} inputMode="decimal" value={r.text} onChange={(e) => upd(r.id, { text: e.target.value })} />
              </Field>
              <button type="button" className="btn-secondary" disabled={r.currency !== cur} onClick={() => upd(r.id, { text: plain(remaining(r.id)) })}>{t("pos.exact")}</button>
              <button type="button" className="btn-secondary" disabled={r.currency !== cur} onClick={() => upd(r.id, { text: plain(((remaining(r.id) + step - 1n) / step) * step) })}>{t("pos.roundUp")}</button>
              {(r.method === "CARD" || r.method === "WALLET") && (
                <Field label={t("pos.paymentRef")}><input className="input w-32" value={r.ref} onChange={(e) => upd(r.id, { ref: e.target.value })} /></Field>
              )}
              {rows.length > 1 && <button type="button" aria-label={t("pos.removeTender")} className="text-red-500" onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))}>✕</button>}
            </div>
          ))}
          <button type="button" className="btn-secondary" onClick={() => setRows((rs) => [...rs, { id: newKey(), method: "CASH", currency: cur, text: "", ref: "" }])}>{t("pos.addTender")}</button>
          {creditBad && <p role="alert" className="text-sm text-red-600">{t("pos.creditNeedsCustomer")}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={onClose}>{t("common.cancel")}</button>
            <button type="submit" className="btn-primary" disabled={invalid || creditBad || m.isPending}>{t("pos.confirmPay")}</button>
          </div>
        </form>
      </Modal>
      {ovFlags && <OverrideModal flags={ovFlags} onCancel={() => setOvFlags(null)} onSubmit={(o) => { setOv(o); setOvFlags(null); m.mutate(o); }} />}
    </>
  );
}
