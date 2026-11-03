import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { get, post } from "@/lib/api";
import { CURRENCY_LABEL, MINOR_UNITS } from "@/lib/money";
import { Empty, ErrorBox, Field, Spinner, toast } from "@/components/ui";
import { humanToScaled, rowsOf, scaledToHuman, useAT } from "./util";

interface Rate { from_currency: string; to_currency: string; buy_rate_scaled: string; sell_rate_scaled: string; effective_from: string }
const CURS = Object.keys(MINOR_UNITS);

export function RatesTab() {
  const { t, locale } = useAT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["exchange-rates"], queryFn: () => get<Rate[] | { rows?: Rate[] }>("/exchange-rates") });
  const [from, setFrom] = useState("SAR");
  const [to, setTo] = useState("YER_NEW");
  const [buy, setBuy] = useState("");
  const [sell, setSell] = useState("");
  const [eff, setEff] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const label = (c: string) => CURRENCY_LABEL[c]?.[locale] ?? c;

  const m = useMutation({
    mutationFn: (body: Record<string, string>) => post<unknown>("/exchange-rates", body),
    onSuccess: () => { toast.ok(t("acc.rate.saved")); setBuy(""); setSell(""); void qc.invalidateQueries({ queryKey: ["exchange-rates"] }); },
    onError: (e: Error) => toast.err(e.message),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (from === to) { setErr(t("acc.rate.sameCur")); return; }
    const b = humanToScaled(buy), s = humanToScaled(sell);
    if (b === null || s === null) { setErr(t("acc.rate.err")); return; }
    setErr(null);
    m.mutate({ from, to, buyRateScaled: b, sellRateScaled: s, ...(eff ? { effectiveFrom: eff } : {}) });
  };

  const rows = rowsOf(q.data);
  return (
    <div className="grid gap-4">
      <form className="card grid gap-3" onSubmit={submit} noValidate>
        {err && <p role="alert" className="rounded-md bg-red-50 p-2 text-sm text-red-700">{err}</p>}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Field label={t("acc.rate.from")}><select className="input" value={from} onChange={(e) => setFrom(e.target.value)}>{CURS.map((c) => <option key={c} value={c}>{label(c)}</option>)}</select></Field>
          <Field label={t("acc.rate.to")}><select className="input" value={to} onChange={(e) => setTo(e.target.value)}>{CURS.map((c) => <option key={c} value={c}>{label(c)}</option>)}</select></Field>
          <Field label={t("acc.rate.buy")}><input className="input num" inputMode="decimal" autoFocus placeholder="140.25" value={buy} onChange={(e) => setBuy(e.target.value)} /></Field>
          <Field label={t("acc.rate.sell")}><input className="input num" inputMode="decimal" placeholder="141" value={sell} onChange={(e) => setSell(e.target.value)} /></Field>
          <Field label={t("acc.rate.effective")}><input type="date" className="input num" value={eff} onChange={(e) => setEff(e.target.value)} /></Field>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-500">{t("acc.rate.hint", { from: label(from), to: label(to) })}</span>
          <button type="submit" className="btn-primary" disabled={m.isPending}>{t("acc.rate.add")}</button>
        </div>
      </form>
      <div className="card">
        {q.isLoading ? <Spinner /> : q.error ? <ErrorBox error={q.error} onRetry={() => void q.refetch()} /> : rows.length === 0 ? <Empty /> : (
          <table>
            <thead><tr><th>{t("acc.rate.from")}</th><th>{t("acc.rate.to")}</th><th>{t("acc.rate.buy")}</th><th>{t("acc.rate.sell")}</th><th>{t("acc.rate.effective")}</th></tr></thead>
            <tbody>{rows.map((r, i) => (
              <tr key={`${r.from_currency}-${r.to_currency}-${r.effective_from}-${i}`}>
                <td>{label(r.from_currency)}</td><td>{label(r.to_currency)}</td>
                <td className="num">{scaledToHuman(String(r.buy_rate_scaled))}</td><td className="num">{scaledToHuman(String(r.sell_rate_scaled))}</td>
                <td className="num">{String(r.effective_from).slice(0, 16).replace("T", " ")}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </div>
  );
}
