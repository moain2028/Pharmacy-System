import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { ApiError, get, post } from "@/lib/api";
import { fmtMinor } from "@/lib/money";
import { useT } from "@/i18n";
import { ErrorBox, Field, PageHeader, Spinner, toast } from "@/components/ui";
import { rowsOf, type Paged, type SaleDetailDto, type SaleRow } from "@/features/sales/types";
import { useDebounced } from "@/features/sales/useDebounced";
import { ReturnLines } from "./ReturnLines";
import { QuotePanel } from "./QuotePanel";
import { ApproverModal } from "./ApproverModal";
import { REASONS, type Approver, type PrevReturn, type QtyMode, type ReasonCode, type ReturnPayload, type ReturnQuote } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const APPROVAL_CODES = new Set(["return.window_expired", "return.non_returnable"]);
const toLatin = (s: string) => s.replace(/[٠-٩]/g, (c) => String("٠١٢٣٤٥٦٧٨٩".indexOf(c)));

export default function ReturnsPage() {
  const { t, locale } = useT();
  const qc = useQueryClient();
  const [sp] = useSearchParams();
  const initial = sp.get("invoiceId") ?? "";
  const [lookup, setLookup] = useState(initial);
  const [invoiceId, setInvoiceId] = useState(UUID.test(initial) ? initial : "");
  const [qty, setQty] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<QtyMode>("SSU");
  const [reasonCode, setReasonCode] = useState<ReasonCode>("CUSTOMER_CHANGED_MIND");
  const [reasonText, setReasonText] = useState("");
  const [toCredit, setToCredit] = useState(false);
  const [approvalMsg, setApprovalMsg] = useState<string | null>(null);

  const find = useMutation({
    mutationFn: async (text: string) => (UUID.test(text) ? text : rowsOf(await get<Paged<SaleRow>>("/sales", { number: text, limit: 1 }))[0]?.id ?? null),
    onSuccess: (id) => { if (id) { setInvoiceId(id); setQty({}); } else toast.err(t("ret.notFound")); },
    onError: (e) => toast.err(e.message),
  });
  const inv = useQuery({ queryKey: ["sales", invoiceId], queryFn: () => get<SaleDetailDto>(`/sales/${invoiceId}`), enabled: invoiceId !== "" });
  const prev = useQuery({ queryKey: ["returns", "byInvoice", invoiceId], queryFn: () => get<Paged<PrevReturn>>("/returns", { invoiceId }), enabled: invoiceId !== "" });

  const returned = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of rowsOf(prev.data)) for (const l of r.lines ?? []) { const id = l.lineId ?? l.line_id; if (id) m[id] = (m[id] ?? 0) + Number(l.qtySsu ?? l.qty_ssu ?? 0); }
    for (const l of inv.data?.lines ?? []) if (l.returned_qty_ssu !== undefined) m[l.id] = Math.max(m[l.id] ?? 0, Number(l.returned_qty_ssu));
    return m;
  }, [prev.data, inv.data]);

  const { lines, errors } = useMemo(() => {
    const out: ReturnPayload["lines"] = []; const errs: Record<string, string> = {};
    for (const l of inv.data?.lines ?? []) {
      const txt = (qty[l.id] ?? "").trim(); if (!txt) continue;
      const n = Number(toLatin(txt));
      const ssu = mode === "UNIT" ? Math.round(n * (Number(l.factor_to_ssu) || 1)) : n;
      const max = Number(l.qty_ssu) - (returned[l.id] ?? 0);
      if (!Number.isInteger(ssu) || ssu <= 0 || ssu > max) { errs[l.id] = "ret.exceeds"; continue; }
      out.push({ lineId: l.id, qtySsu: String(ssu) });
    }
    return { lines: out, errors: errs };
  }, [inv.data, qty, mode, returned]);

  const payload = useMemo<ReturnPayload>(() => {
    const text = reasonText.trim();
    return { invoiceId, lines, reason: text ? { code: reasonCode, text } : { code: reasonCode }, refundToCustomerCredit: toCredit };
  }, [invoiceId, lines, reasonCode, reasonText, toCredit]);
  const dPayload = useDebounced(payload, 250);
  const quote = useQuery({ queryKey: ["returns", "quote", dPayload], queryFn: () => post<ReturnQuote>("/returns/quote", dPayload), enabled: dPayload.invoiceId !== "" && dPayload.lines.length > 0, retry: false });

  const confirm = useMutation({
    mutationFn: (approver?: Approver) => post<ReturnQuote>("/returns", approver ? { ...payload, approver } : payload),
    onSuccess: (r) => {
      toast.ok(t("ret.posted", { number: r.number ?? "" })); setApprovalMsg(null); setQty({}); setReasonText("");
      void qc.invalidateQueries({ queryKey: ["sales"] }); void qc.invalidateQueries({ queryKey: ["returns"] });
    },
    onError: (e) => { if (e instanceof ApiError && e.status === 422 && APPROVAL_CODES.has(e.code)) setApprovalMsg(e.message); else toast.err(e.message); },
  });

  const hasErr = Object.keys(errors).length > 0;
  const canConfirm = lines.length > 0 && !hasErr && quote.data !== undefined && !quote.isFetching && !confirm.isPending && !(reasonCode === "OTHER" && reasonText.trim() === "");
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "F9" && canConfirm) { e.preventDefault(); confirm.mutate(undefined); } };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  }, [canConfirm, confirm]);

  const d = inv.data;
  return (
    <div>
      <PageHeader title={t("ret.title")} />
      <form className="card flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); if (lookup.trim()) find.mutate(lookup.trim()); }}>
        <div className="grow"><Field label={t("ret.invoiceLookup")}><input className="input num" autoFocus value={lookup} onChange={(e) => setLookup(e.target.value)} /></Field></div>
        <button type="submit" className="btn-primary" disabled={find.isPending || !lookup.trim()}>{t("ret.lookup")}</button>
      </form>
      {inv.isLoading && <Spinner />}
      {inv.error && <div className="mt-4"><ErrorBox error={inv.error} onRetry={() => void inv.refetch()} /></div>}
      {d && (
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <div className="card flex flex-wrap items-center gap-4 text-sm">
              <span>{t("ret.invoice")} <b className="num">{d.invoice.number}</b></span><span className="num">{d.invoice.business_date}</span>
              <span>{d.invoice.customer_name ?? t("pos.walkIn")}</span><span className="num ms-auto font-medium">{fmtMinor(d.invoice.total_minor, d.invoice.currency, locale)}</span>
            </div>
            <div className="card mt-4">
              <div className="mb-2 flex items-center justify-between"><span className="font-medium">{t("sales.lines")}</span>
                <div className="flex gap-1 text-sm">{((["SSU", "UNIT"]) as QtyMode[]).map((m) => <button key={m} type="button" className={m === mode ? "btn-primary" : "btn-secondary"} onClick={() => setMode(m)}>{t(m === "SSU" ? "ret.inSsu" : "ret.inUnit")}</button>)}</div></div>
              <ReturnLines lines={d.lines} returned={returned} qty={qty} errors={errors} mode={mode} onQty={(id, v) => setQty((s) => ({ ...s, [id]: v }))} />
            </div>
            <div className="card mt-4 grid gap-3 md:grid-cols-2">
              <Field label={t("common.reason")}><select className="input" value={reasonCode} onChange={(e) => setReasonCode(e.target.value as ReasonCode)}>{REASONS.map((r) => <option key={r} value={r}>{t(`ret.reason${r}`)}</option>)}</select></Field>
              <Field label={t("ret.reasonText")} error={reasonCode === "OTHER" && reasonText.trim() === "" ? t("common.required") : undefined}><input className="input" maxLength={300} value={reasonText} onChange={(e) => setReasonText(e.target.value)} /></Field>
              <label className="flex items-center gap-2 text-sm md:col-span-2"><input type="checkbox" checked={toCredit} onChange={(e) => setToCredit(e.target.checked)} />{t("ret.toCredit")}</label>
            </div>
          </div>
          <div className="card self-start">
            <QuotePanel quote={lines.length > 0 && !hasErr ? quote.data : undefined} loading={quote.isFetching} error={lines.length > 0 ? quote.error : null} />
            <button type="button" className="btn-primary mt-4 w-full" disabled={!canConfirm} onClick={() => confirm.mutate(undefined)}>{t("ret.confirm")}</button>
          </div>
        </div>)}
      <ApproverModal open={approvalMsg !== null} message={approvalMsg ?? ""} busy={confirm.isPending} onClose={() => setApprovalMsg(null)} onSubmit={(a) => confirm.mutate(a)} />
    </div>
  );
}
