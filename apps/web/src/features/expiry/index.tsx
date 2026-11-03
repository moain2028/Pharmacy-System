import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { get, post } from "@/lib/api";
import { useT } from "@/i18n";
import { Badge, Empty, ErrorBox, Field, Modal, PageHeader, Spinner, toast } from "@/components/ui";
import { rowsOf, today, useDebounced } from "@/features/inventory/ItemPicker";

interface ExpiryRow { lot_id: string; item_id: string; trade_name_ar: string; trade_name_en?: string | null; lot_number: string; expiry_date: string | null; qty_ssu: string; days_left: number; bucket?: string }
type Bucket = "expired" | "d30" | "d90" | "d180" | "later";
const BUCKETS: Bucket[] = ["expired", "d30", "d90", "d180", "later"];
const TONE: Record<Bucket, "red" | "amber" | "blue" | "slate" | "green"> = { expired: "red", d30: "amber", d90: "blue", d180: "slate", later: "green" };
const bucketOf = (r: ExpiryRow): Bucket =>
  r.expiry_date === null ? "later" : r.days_left < 0 ? "expired" : r.days_left <= 30 ? "d30" : r.days_left <= 90 ? "d90" : r.days_left <= 180 ? "d180" : "later";
const PAGE = 50;

export default function ExpiryPage() {
  const { t, locale } = useT();
  const qc = useQueryClient();
  const [asOf, setAsOf] = useState(today());
  const [bucket, setBucket] = useState<Bucket | "all">("all");
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim().toLowerCase());
  const [limit, setLimit] = useState(PAGE);
  const [target, setTarget] = useState<ExpiryRow | null>(null);
  const [reason, setReason] = useState("");
  const [reasonErr, setReasonErr] = useState("");
  const close = useCallback(() => { setTarget(null); setReason(""); setReasonErr(""); }, []);

  const list = useQuery({ queryKey: ["inv", "expiry", asOf], queryFn: async () => rowsOf<ExpiryRow>(await get<unknown>("/inventory/expiry", { businessDate: asOf })) });
  const rows = useMemo(() => (list.data ?? []).map((r) => ({ ...r, b: bucketOf(r) })), [list.data]);
  const counts = useMemo(() => { const c: Record<Bucket, number> = { expired: 0, d30: 0, d90: 0, d180: 0, later: 0 }; for (const r of rows) c[r.b] += 1; return c; }, [rows]);
  const visible = useMemo(() => rows.filter((r) => (bucket === "all" || r.b === bucket) &&
    (!dq || r.trade_name_ar.toLowerCase().includes(dq) || (r.trade_name_en ?? "").toLowerCase().includes(dq) || r.lot_number.toLowerCase().includes(dq))), [rows, bucket, dq]);

  const quarantine = useMutation({
    mutationFn: (v: { lotId: string; reason: string }) => post<unknown>(`/inventory/lots/${v.lotId}/status`, { status: "QUARANTINED", reason: v.reason, businessDate: asOf }),
    onSuccess: () => { toast.ok(t("exp.quarantineOk")); close(); void qc.invalidateQueries({ queryKey: ["inv"] }); },
  });
  const confirm = () => {
    if (!target) return;
    if (reason.trim().length < 2) { setReasonErr(t("exp.errReasonMin")); return; }
    setReasonErr("");
    quarantine.mutate({ lotId: target.lot_id, reason: reason.trim() });
  };
  const nameOf = (r: ExpiryRow) => (locale === "ar" ? r.trade_name_ar : r.trade_name_en || r.trade_name_ar);

  return (
    <div>
      <PageHeader title={t("exp.title")} />
      <div className="card mb-4 grid gap-3 md:grid-cols-3">
        <Field label={t("exp.asOf")}><input type="date" className="input num" value={asOf} onChange={(e) => { setAsOf(e.target.value); setLimit(PAGE); }} /></Field>
        <div className="md:col-span-2"><Field label={t("common.search")}><input className="input" autoFocus value={q} placeholder={t("exp.search")} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }} /></Field></div>
        <div className="flex flex-wrap gap-2 md:col-span-3">
          <button type="button" className={bucket === "all" ? "btn-primary" : "btn-secondary"} onClick={() => { setBucket("all"); setLimit(PAGE); }}>{t("common.all")} <span className="num">({rows.length})</span></button>
          {BUCKETS.map((b) => (
            <button key={b} type="button" aria-pressed={bucket === b} className={bucket === b ? "btn-primary" : "btn-secondary"} onClick={() => { setBucket(b); setLimit(PAGE); }}>
              <Badge tone={TONE[b]}>{t(`exp.bucket.${b}`)}</Badge> <span className="num">({counts[b]})</span>
            </button>
          ))}
        </div>
      </div>

      {list.isLoading ? <Spinner /> : list.error ? <ErrorBox error={list.error} onRetry={() => void list.refetch()} /> : visible.length === 0 ? <Empty /> : (
        <div className="card overflow-auto">
          <div className="mb-2 text-xs text-slate-500">{t("exp.count", { n: visible.length })}</div>
          <table>
            <thead><tr><th>{t("exp.item")}</th><th>{t("stock.lot")}</th><th>{t("stock.expiry")}</th><th>{t("exp.daysLeft")}</th><th>{t("stock.onHand")}</th><th>{t("common.status")}</th><th>{t("common.actions")}</th></tr></thead>
            <tbody>
              {visible.slice(0, limit).map((r) => (
                <tr key={`${r.lot_id}|${r.item_id}`}>
                  <td>{nameOf(r)}</td>
                  <td className="num">{r.lot_number}</td>
                  <td className="num">{r.expiry_date ?? "—"}</td>
                  <td className="num">{r.expiry_date === null ? "—" : r.days_left}</td>
                  <td className="num">{r.qty_ssu}</td>
                  <td><Badge tone={TONE[r.b]}>{t(`exp.bucket.${r.b}`)}</Badge></td>
                  <td><button type="button" className="btn-secondary" onClick={() => setTarget(r)}>{t("exp.quarantine")}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {visible.length > limit && <div className="mt-3 flex justify-center"><button type="button" className="btn-secondary" onClick={() => setLimit((l) => l + PAGE)}>{t("exp.showMore")}</button></div>}
        </div>
      )}

      <Modal open={target !== null} onClose={close} title={t("exp.quarantineTitle", { lot: target?.lot_number ?? "" })}
        footer={<>
          <button type="button" className="btn-secondary" onClick={close}>{t("common.cancel")}</button>
          <button type="button" className="btn-primary" disabled={quarantine.isPending} onClick={confirm}>{t("common.confirm")}</button>
        </>}>
        {target && <div className="mb-3 text-sm text-slate-600">{nameOf(target)} · <span className="num">{target.lot_number}</span> · <span className="num">{target.expiry_date ?? "—"}</span></div>}
        <Field label={t("common.reason")} {...(reasonErr ? { error: reasonErr } : {})}>
          <input className="input" autoFocus value={reason} placeholder={t("exp.reasonPlaceholder")} onChange={(e) => setReason(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") confirm(); }} />
        </Field>
        {quarantine.error ? <div className="mt-3"><ErrorBox error={quarantine.error} /></div> : null}
      </Modal>
    </div>
  );
}
