import { useState, type FormEvent, type RefObject } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { get, post, type MoneyJson } from "@/lib/api";
import { CURRENCY_LABEL, fmtMinor, parseToMinor } from "@/lib/money";
import { Badge, ErrorBox, Field, Modal, Spinner, toast } from "@/components/ui";
import { usePosT } from "./pos.keys";
import { CURRENCIES, moneyText, rowsOf } from "./useCart";

export interface ShiftView { id: string; cashboxId: string; status: string; openedAt: string; openingFloat: MoneyJson[]; expectedCash: MoneyJson[]; version: number }
interface Cashbox { id: string; code: string; name_ar: string; name_en: string; kind: string }
interface XReport { salesCount?: number; byMethod?: Array<{ method?: string; currency?: string; amountMinor?: string }>; expectedCash?: MoneyJson[] }
interface CloseResult { currencies: Array<{ currency: string; expected: unknown; counted: unknown; variance: unknown }>; zReport?: { salesCount?: number } | null }
interface CloseBody { counts: MoneyJson[]; reasons?: Record<string, string>; approver?: { username: string; secret: string } }

const useXReport = (id: string) => useQuery({ queryKey: ["shift-x", id], queryFn: () => get<XReport>(`/shifts/${id}/x-report`) });

export default function ShiftBar({ selectRef }: { selectRef: RefObject<HTMLSelectElement> }) {
  const { t, locale } = usePosT();
  const q = useQuery({ queryKey: ["shift", "current"], queryFn: () => get<ShiftView | null>("/shifts/current") });
  const boxes = useQuery({ queryKey: ["cashboxes"], queryFn: async () => rowsOf(await get<Cashbox[] | { rows?: Cashbox[] }>("/cashboxes")) });
  const [modal, setModal] = useState<"x" | "close" | null>(null);
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} onRetry={() => void q.refetch()} />;
  const s = q.data;
  if (!s) return <OpenShiftForm boxes={(boxes.data ?? []).filter((b) => b.kind === "REGISTER")} selectRef={selectRef} />;
  const box = boxes.data?.find((b) => b.id === s.cashboxId);
  return (
    <div className="card flex flex-wrap items-center gap-3 text-sm">
      <Badge tone="green">{t("pos.shiftOpen")}</Badge>
      <span>{t("pos.cashbox")}: <b>{box?.code ?? "—"}</b></span>
      <span>{t("pos.openedAt")}: <span className="num">{new Date(s.openedAt).toLocaleString(locale)}</span></span>
      <div className="ms-auto flex gap-2">
        <button className="btn-secondary" onClick={() => setModal("x")}>{t("shift.xReport")}</button>
        <button className="btn-secondary" onClick={() => setModal("close")}>{t("shift.close")}</button>
      </div>
      {modal === "x" && <XModal id={s.id} onClose={() => setModal(null)} />}
      {modal === "close" && <CloseModal shift={s} onClose={() => setModal(null)} />}
    </div>
  );
}

function OpenShiftForm({ boxes, selectRef }: { boxes: Cashbox[]; selectRef: RefObject<HTMLSelectElement> }) {
  const { t, locale } = usePosT();
  const qc = useQueryClient();
  const [cashboxId, setCashboxId] = useState("");
  const [floats, setFloats] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: () => {
      const openingFloat: MoneyJson[] = [];
      for (const c of CURRENCIES) {
        const txt = (floats[c] ?? "").trim();
        if (!txt) continue;
        const minor = parseToMinor(txt, c);
        if (minor === null || minor.startsWith("-")) throw new Error(t("pos.invalidAmount"));
        if (minor !== "0") openingFloat.push({ currency: c, amountMinor: minor });
      }
      return post<{ id: string }>("/shifts/open", { cashboxId, openingFloat });
    },
    onSuccess: () => { toast.ok(t("pos.shiftOpened")); void qc.invalidateQueries({ queryKey: ["shift"] }); },
    onError: (e) => toast.err(e instanceof Error ? e.message : t("common.error")),
  });
  const submit = (e: FormEvent) => { e.preventDefault(); if (!cashboxId) { toast.err(t("pos.selectCashbox")); return; } m.mutate(); };
  return (
    <form onSubmit={submit} className="card space-y-3" aria-label={t("shift.open")}>
      <div className="flex items-center gap-2"><Badge tone="amber">{t("shift.none")}</Badge><span className="text-sm text-slate-600">{t("pos.noShift")}</span></div>
      <div className="grid gap-3 md:grid-cols-5">
        <Field label={t("pos.cashbox")}>
          <select ref={selectRef} className="input" value={cashboxId} onChange={(e) => setCashboxId(e.target.value)} required>
            <option value="">{t("pos.selectCashbox")}</option>
            {boxes.map((b) => <option key={b.id} value={b.id}>{b.code} — {locale === "ar" ? b.name_ar : b.name_en}</option>)}
          </select>
        </Field>
        {CURRENCIES.map((c) => (
          <Field key={c} label={`${t("shift.openingFloat")} ${CURRENCY_LABEL[c]?.[locale] ?? c}`}>
            <input className="input num" inputMode="decimal" placeholder="0" value={floats[c] ?? ""} onChange={(e) => setFloats((f) => ({ ...f, [c]: e.target.value }))} />
          </Field>
        ))}
      </div>
      <div className="flex justify-end"><button type="submit" className="btn-primary" disabled={m.isPending}>{t("shift.open")}</button></div>
    </form>
  );
}

function XModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { t, locale } = usePosT();
  const q = useXReport(id);
  return (
    <Modal open onClose={onClose} title={t("shift.xReport")}>
      {q.isLoading && <Spinner />}
      {q.error && <ErrorBox error={q.error} onRetry={() => void q.refetch()} />}
      {q.data && (
        <div className="space-y-3 text-sm">
          <div className="flex justify-between"><span>{t("pos.salesCount")}</span><b className="num">{q.data.salesCount ?? 0}</b></div>
          <table className="w-full">
            <thead><tr><th>{t("pos.method")}</th><th>{t("common.currency")}</th><th>{t("common.amount")}</th></tr></thead>
            <tbody>
              {(q.data.byMethod ?? []).map((r, i) => (
                <tr key={i}><td>{r.method ?? "—"}</td><td>{r.currency ?? "—"}</td><td className="num">{r.currency && r.amountMinor ? fmtMinor(r.amountMinor, r.currency, locale) : "—"}</td></tr>
              ))}
            </tbody>
          </table>
          <div className="flex justify-between"><span>{t("shift.expected")}</span><b className="num">{moneyText(q.data.expectedCash, locale)}</b></div>
        </div>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={() => window.print()}>{t("common.print")}</button>
        <button type="button" className="btn-primary" onClick={onClose}>{t("common.close")}</button>
      </div>
    </Modal>
  );
}

function CloseModal({ shift, onClose }: { shift: ShiftView; onClose: () => void }) {
  const { t, locale } = usePosT();
  const qc = useQueryClient();
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [approver, setApprover] = useState({ username: "", secret: "" });
  const [done, setDone] = useState<CloseResult | null>(null);
  const expectedOf = (c: string): bigint => BigInt(shift.expectedCash.find((m) => m.currency === c)?.amountMinor ?? "0");
  const parsedOf = (c: string): bigint | null => { const txt = (counts[c] ?? "").trim(); if (!txt) return 0n; const m = parseToMinor(txt, c); return m === null || m.startsWith("-") ? null : BigInt(m); };
  const relevant = CURRENCIES.filter((c) => expectedOf(c) !== 0n || (counts[c] ?? "").trim() !== "");
  const varianceOf = (c: string): bigint | null => { const p = parsedOf(c); return p === null ? null : p - expectedOf(c); };
  const invalid = relevant.some((c) => parsedOf(c) === null);
  const missingReason = relevant.some((c) => { const v = varianceOf(c); return v !== null && v !== 0n && !(reasons[c] ?? "").trim(); });
  const m = useMutation({
    mutationFn: () => {
      const body: CloseBody = { counts: relevant.map((c) => ({ currency: c, amountMinor: (parsedOf(c) ?? 0n).toString() })) };
      const rs = Object.fromEntries(Object.entries(reasons).filter(([, v]) => v.trim()));
      if (Object.keys(rs).length) body.reasons = rs;
      if (approver.username.trim() && approver.secret) body.approver = { username: approver.username.trim(), secret: approver.secret };
      return post<CloseResult>(`/shifts/${shift.id}/close`, body);
    },
    onSuccess: (r) => { setDone(r); toast.ok(t("pos.shiftClosed")); void qc.invalidateQueries({ queryKey: ["shift"] }); },
    onError: (e) => toast.err(e instanceof Error ? e.message : t("common.error")),
  });
  const submit = (e: FormEvent) => { e.preventDefault(); if (invalid || m.isPending) return; if (missingReason) { toast.err(t("pos.reasonRequired")); return; } m.mutate(); };
  if (done) {
    return (
      <Modal open onClose={onClose} title={t("pos.zReport")}>
        <table className="w-full text-sm">
          <thead><tr><th>{t("common.currency")}</th><th>{t("shift.expected")}</th><th>{t("shift.counted")}</th><th>{t("shift.variance")}</th></tr></thead>
          <tbody>{done.currencies.map((r) => (
            <tr key={r.currency}><td>{r.currency}</td><td className="num">{moneyText(r.expected, locale, r.currency)}</td><td className="num">{moneyText(r.counted, locale, r.currency)}</td><td className="num">{moneyText(r.variance, locale, r.currency)}</td></tr>
          ))}</tbody>
        </table>
        {done.zReport?.salesCount !== undefined && <div className="mt-2 text-sm">{t("pos.salesCount")}: <b className="num">{done.zReport.salesCount}</b></div>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={() => window.print()}>{t("common.print")}</button>
          <button type="button" className="btn-primary" autoFocus onClick={onClose}>{t("common.close")}</button>
        </div>
      </Modal>
    );
  }
  return (
    <Modal open onClose={onClose} title={t("shift.close")} wide>
      <form onSubmit={submit} className="space-y-3">
        <table className="w-full text-sm">
          <thead><tr><th>{t("common.currency")}</th><th>{t("shift.expected")}</th><th>{t("shift.counted")}</th><th>{t("shift.variance")}</th><th>{t("pos.varianceReason")}</th></tr></thead>
          <tbody>
            {CURRENCIES.map((c) => {
              const v = varianceOf(c);
              return (
                <tr key={c}>
                  <td>{CURRENCY_LABEL[c]?.[locale] ?? c}</td>
                  <td className="num">{fmtMinor(expectedOf(c), c, locale)}</td>
                  <td><input aria-label={`${t("shift.counted")} ${c}`} className="input num w-32" inputMode="decimal" placeholder="0" value={counts[c] ?? ""} onChange={(e) => setCounts((x) => ({ ...x, [c]: e.target.value }))} /></td>
                  <td className={`num ${v && v !== 0n ? (v < 0n ? "text-red-700" : "text-amber-700") : ""}`}>{v === null ? t("pos.invalidAmount") : fmtMinor(v, c, locale)}</td>
                  <td>{v !== null && v !== 0n && <input aria-label={`${t("pos.varianceReason")} ${c}`} className="input w-full" value={reasons[c] ?? ""} onChange={(e) => setReasons((x) => ({ ...x, [c]: e.target.value }))} />}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <details className="text-sm">
          <summary className="cursor-pointer text-slate-600">{t("pos.approverOpt")}</summary>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            <input className="input" autoComplete="off" placeholder="username" value={approver.username} onChange={(e) => setApprover((a) => ({ ...a, username: e.target.value }))} />
            <input className="input" type="password" autoComplete="new-password" placeholder="••••" value={approver.secret} onChange={(e) => setApprover((a) => ({ ...a, secret: e.target.value }))} />
          </div>
        </details>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>{t("common.cancel")}</button>
          <button type="submit" className="btn-primary" disabled={invalid || m.isPending}>{t("shift.close")}</button>
        </div>
      </form>
    </Modal>
  );
}
