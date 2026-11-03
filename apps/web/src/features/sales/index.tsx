import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Route, Routes, useNavigate } from "react-router-dom";
import { get } from "@/lib/api";
import { fmtMinor } from "@/lib/money";
import { useT } from "@/i18n";
import { Badge, Empty, ErrorBox, Field, PageHeader, Spinner } from "@/components/ui";
import SaleDetail from "./SaleDetail";
import { useDebounced } from "./useDebounced";
import { rowsOf, statusKey, statusTone, type Paged, type SaleRow } from "./types";

const LIMIT = 50;
interface CustomerPick { id: string; name: string; code?: string }

function SalesList() {
  const { t, locale } = useT();
  const nav = useNavigate();
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(`${today.slice(0, 8)}01`);
  const [to, setTo] = useState(today);
  const [customerQ, setCustomerQ] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [offset, setOffset] = useState(0);
  const dq = useDebounced(customerQ.trim(), 250);
  const customers = useQuery({ queryKey: ["customers", "pick", dq], queryFn: () => get<Paged<CustomerPick>>("/customers", { q: dq, limit: 20 }), enabled: dq.length >= 2 });
  const q = useQuery({
    queryKey: ["sales", { from, to, customerId, offset }],
    queryFn: () => get<Paged<SaleRow>>("/sales", { from, to, customerId: customerId || undefined, limit: LIMIT, offset }),
  });
  const rows = useMemo(() => rowsOf(q.data), [q.data]);
  const total = Array.isArray(q.data) ? offset + rows.length : q.data?.total ?? offset + rows.length;
  const sums = useMemo(() => {
    let tot = 0n, cr = 0n;
    for (const r of rows) { tot += BigInt(r.total_minor); cr += BigInt(r.credit_minor); }
    return { tot: tot.toString(), cr: cr.toString() };
  }, [rows]);
  const cur = rows[0]?.currency ?? "YER_NEW";
  const reset = () => setOffset(0);
  const picks = rowsOf(customers.data);
  return (
    <div>
      <PageHeader title={t("sales.title")} />
      <div className="card grid grid-cols-2 gap-3 md:grid-cols-4">
        <Field label={t("common.from")}><input type="date" className="input num" value={from} onChange={(e) => { setFrom(e.target.value); reset(); }} /></Field>
        <Field label={t("common.to")}><input type="date" className="input num" value={to} onChange={(e) => { setTo(e.target.value); reset(); }} /></Field>
        <Field label={t("sales.searchCustomer")}><input className="input" autoFocus value={customerQ} placeholder={t("common.search")} onChange={(e) => setCustomerQ(e.target.value)} /></Field>
        <Field label={t("pos.customer")}>
          <select className="input" value={customerId} onChange={(e) => { setCustomerId(e.target.value); reset(); }}>
            <option value="">{t("common.all")}</option>
            {picks.map((c) => <option key={c.id} value={c.id}>{c.name}{c.code ? ` (${c.code})` : ""}</option>)}
          </select>
        </Field>
      </div>
      <div className="card mt-4">
        {q.isLoading ? <Spinner /> : q.error ? <ErrorBox error={q.error} onRetry={() => void q.refetch()} /> : rows.length === 0 ? <Empty /> : (
          <table>
            <thead><tr><th>{t("sales.number")}</th><th>{t("common.date")}</th><th>{t("pos.customer")}</th><th>{t("common.total")}</th><th>{t("sales.paid")}</th><th>{t("sales.credit")}</th><th>{t("common.status")}</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id} className="cursor-pointer hover:bg-ink-50" onClick={() => nav(`/sales/${r.id}`)}>
                <td className="num">{r.number}</td><td className="num">{r.business_date}</td><td>{r.customer_name ?? t("pos.walkIn")}</td>
                <td className="num">{fmtMinor(r.total_minor, r.currency, locale)}</td><td className="num">{fmtMinor(r.paid_minor, r.currency, locale)}</td>
                <td className="num">{fmtMinor(r.credit_minor, r.currency, locale)}</td><td><Badge tone={statusTone(r.status)}>{t(statusKey(r.status))}</Badge></td>
              </tr>))}</tbody>
            <tfoot><tr><td colSpan={3} className="font-medium">{t("common.total")} ({rows.length})</td><td className="num font-medium">{fmtMinor(sums.tot, cur, locale)}</td><td /><td className="num font-medium">{fmtMinor(sums.cr, cur, locale)}</td><td /></tr></tfoot>
          </table>)}
        <div className="mt-3 flex items-center justify-between text-sm">
          <button className="btn-secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - LIMIT))}>{t("sales.prev")}</button>
          <span className="num text-ink-500">{offset + 1}–{offset + rows.length} / {total}</span>
          <button className="btn-secondary" disabled={offset + rows.length >= total} onClick={() => setOffset(offset + LIMIT)}>{t("common.next")}</button>
        </div>
      </div>
    </div>
  );
}

export default function SalesPage() {
  return <Routes><Route index element={<SalesList />} /><Route path=":id" element={<SaleDetail />} /></Routes>;
}
