import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { get, post } from "@/lib/api";
import { CURRENCY_LABEL, MINOR_UNITS, fmtMinor, parseToMinor } from "@/lib/money";
import { Field, toast } from "@/components/ui";
import { rowsOf, today, useAT, useTb } from "./util";

interface Line { k: number; accountCode: string; side: "DEBIT" | "CREDIT"; amount: string; currency: string; cashboxId: string }
interface Cashbox { id: string; code: string; name_ar: string; name_en: string }
interface LineDto { accountCode: string; side: "DEBIT" | "CREDIT"; amountMinor: string; currency?: string; cashboxId?: string }

let seq = 1;
const blank = (): Line => ({ k: seq++, accountCode: "", side: "DEBIT", amount: "", currency: "", cashboxId: "" });

export function OpeningTab() {
  const { t, locale } = useAT();
  const qc = useQueryClient();
  const tb = useTb();
  const boxes = useQuery({ queryKey: ["cashboxes"], queryFn: () => get<Cashbox[] | { rows?: Cashbox[] }>("/cashboxes") });
  const base = tb.data?.currency ?? "YER_NEW";
  const [date, setDate] = useState(today());
  const [lines, setLines] = useState<Line[]>(() => [blank(), blank()]);
  const [err, setErr] = useState<string | null>(null);
  const upd = (k: number, p: Partial<Line>) => setLines((ls) => ls.map((l) => (l.k === k ? { ...l, ...p } : l)));

  const calc = useMemo(() => {
    let d = 0n, c = 0n;
    for (const l of lines) {
      if (l.currency && l.currency !== base) continue;
      const v = parseToMinor(l.amount, base);
      if (v === null) continue;
      if (l.side === "DEBIT") d += BigInt(v); else c += BigInt(v);
    }
    return { d, c, diff: d - c };
  }, [lines, base]);

  const m = useMutation({
    mutationFn: (dto: LineDto[]) => post<unknown>("/accounting/opening-balances", { businessDate: date, lines: dto }),
    onSuccess: () => { toast.ok(t("acc.posted")); setLines([blank(), blank()]); void qc.invalidateQueries({ queryKey: ["trial-balance"] }); },
    onError: (e: Error) => toast.err(e.message),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const out: LineDto[] = [];
    for (const [i, l] of lines.entries()) {
      if (!l.accountCode.trim() && !l.amount.trim()) continue;
      const v = parseToMinor(l.amount, l.currency || base);
      if (!l.accountCode.trim() || v === null || BigInt(v) <= 0n) { setErr(t("acc.err.line", { n: i + 1 })); return; }
      out.push({ accountCode: l.accountCode.trim(), side: l.side, amountMinor: v, ...(l.currency ? { currency: l.currency } : {}), ...(l.cashboxId ? { cashboxId: l.cashboxId } : {}) });
    }
    if (out.length === 0 || !date) { setErr(t("acc.err.line", { n: 1 })); return; }
    setErr(null);
    m.mutate(out);
  };

  const abs = calc.diff < 0n ? -calc.diff : calc.diff;
  return (
    <form className="card grid gap-3" onSubmit={submit} noValidate>
      {err && <p role="alert" className="rounded-md bg-red-50 p-2 text-sm text-red-700">{err}</p>}
      <div className="max-w-xs"><Field label={t("acc.businessDate")}><input type="date" className="input num" value={date} onChange={(e) => setDate(e.target.value)} /></Field></div>
      <datalist id="acc-codes">{(tb.data?.rows ?? []).map((r) => <option key={r.code} value={r.code}>{locale === "ar" ? r.name_ar : r.name_en}</option>)}</datalist>
      <table>
        <thead><tr><th>{t("acc.account")}</th><th>{t("acc.side")}</th><th>{t("common.amount")}</th><th>{t("common.currency")}</th><th>{t("acc.cashbox")}</th><th /></tr></thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={l.k}>
              <td><input aria-label={`${t("acc.account")} ${i + 1}`} list="acc-codes" className="input num w-28" autoFocus={i === 0} value={l.accountCode} onChange={(e) => upd(l.k, { accountCode: e.target.value })} /></td>
              <td><select aria-label={`${t("acc.side")} ${i + 1}`} className="input" value={l.side} onChange={(e) => upd(l.k, { side: e.target.value === "CREDIT" ? "CREDIT" : "DEBIT" })}><option value="DEBIT">{t("acc.debit")}</option><option value="CREDIT">{t("acc.credit")}</option></select></td>
              <td><input aria-label={`${t("common.amount")} ${i + 1}`} className="input num w-36" inputMode="decimal" value={l.amount} onChange={(e) => upd(l.k, { amount: e.target.value })} /></td>
              <td><select aria-label={`${t("common.currency")} ${i + 1}`} className="input" value={l.currency} onChange={(e) => upd(l.k, { currency: e.target.value })}>
                <option value="">{CURRENCY_LABEL[base]?.[locale] ?? base}</option>
                {Object.keys(MINOR_UNITS).filter((c) => c !== base).map((c) => <option key={c} value={c}>{CURRENCY_LABEL[c]?.[locale] ?? c}</option>)}
              </select></td>
              <td><select aria-label={`${t("acc.cashbox")} ${i + 1}`} className="input" value={l.cashboxId} onChange={(e) => upd(l.k, { cashboxId: e.target.value })}>
                <option value="">{t("acc.none")}</option>
                {rowsOf(boxes.data).map((b) => <option key={b.id} value={b.id}>{locale === "ar" ? b.name_ar : b.name_en}</option>)}
              </select></td>
              <td><button type="button" aria-label={t("acc.removeLine")} className="text-slate-400 hover:text-red-600" disabled={lines.length <= 1} onClick={() => setLines((ls) => ls.filter((x) => x.k !== l.k))}>✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div><button type="button" className="btn-secondary" onClick={() => setLines((ls) => [...ls, blank()])}>{t("acc.addLine")}</button></div>
      <div className="grid gap-1 rounded-md bg-slate-50 p-3 text-sm" aria-live="polite">
        <div>{t("acc.totalDebit")}: <span className="num">{fmtMinor(calc.d, base, locale)}</span></div>
        <div>{t("acc.totalCredit")}: <span className="num">{fmtMinor(calc.c, base, locale)}</span></div>
        <div className="font-semibold">{calc.diff === 0n ? t("acc.balanced") : <>{t("acc.balancing")}: <span className="num">{fmtMinor(abs, base, locale)}</span> ({calc.diff > 0n ? t("acc.credit") : t("acc.debit")})</>}</div>
      </div>
      <div className="flex justify-end"><button type="submit" className="btn-primary" disabled={m.isPending}>{t("acc.post")}</button></div>
    </form>
  );
}
