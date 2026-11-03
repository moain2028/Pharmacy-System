import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Route, Routes, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { get, patch, post } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtMinor, MINOR_UNITS, parseToMinor } from "@/lib/money";
import { useT } from "@/i18n";
import { Badge, Empty, ErrorBox, Field, Modal, PageHeader, Spinner, toast } from "@/components/ui";
import CustomerDetail from "./CustomerDetail";

export interface CustomerRow { id: string; code: string; name: string; phone: string | null; credit_limit_minor: string | null; credit_currency: string | null; is_walk_in: boolean; is_active: boolean; version: number }
interface PriceList { id: string; code: string; name_ar: string; name_en: string }
type ListResp = { rows: CustomerRow[]; total: number } | CustomerRow[];

const LIMIT = 25;
const CURRENCIES = Object.keys(MINOR_UNITS);
export function rowsOf<T>(x: T[] | { rows?: T[] } | null | undefined): T[] { return Array.isArray(x) ? x : (x?.rows ?? []); }
export function useDebounced<T>(v: T, ms = 250): T {
  const [d, setD] = useState(v);
  useEffect(() => { const h = setTimeout(() => setD(v), ms); return () => clearTimeout(h); }, [v, ms]);
  return d;
}

export function CustomerForm({ open, onClose, initial }: { open: boolean; onClose: () => void; initial?: CustomerRow | undefined }) {
  const { t, locale } = useT();
  const can = useAuth((s) => s.can);
  const canCredit = can("customers.credit_limit");
  const qc = useQueryClient();
  const [name, setName] = useState(""); const [phone, setPhone] = useState(""); const [address, setAddress] = useState(""); const [notes, setNotes] = useState("");
  const [limit, setLimit] = useState(""); const [cur, setCur] = useState("YER_NEW"); const [priceListId, setPriceListId] = useState(""); const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    const c = initial?.credit_currency ?? "YER_NEW";
    setName(initial?.name ?? ""); setPhone(initial?.phone ?? ""); setAddress(""); setNotes(""); setPriceListId(""); setErr(null); setCur(c);
    setLimit(initial?.credit_limit_minor ? fmtMinor(initial.credit_limit_minor, c, "en", false) : "");
  }, [open, initial]);
  const pl = useQuery({ queryKey: ["price-lists"], queryFn: () => get<PriceList[]>("/price-lists"), enabled: open });
  const m = useMutation({
    mutationFn: (body: Record<string, unknown>) => initial ? patch<{ id: string }>(`/customers/${initial.id}`, { version: initial.version, ...body }) : post<{ id: string }>("/customers", body),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["customers"] }); void qc.invalidateQueries({ queryKey: ["customer"] }); toast.ok(t("cust.saved")); onClose(); },
    onError: (e: Error) => setErr(e.message),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    if (!name.trim()) { setErr(t("cust.nameRequired")); return; }
    const body: Record<string, unknown> = { name: name.trim() };
    if (phone.trim()) body["phone"] = phone.trim();
    if (address.trim()) body["address"] = address.trim();
    if (notes.trim()) body["notes"] = notes.trim();
    if (priceListId) body["priceListId"] = priceListId;
    if (canCredit && limit.trim()) {
      const mv = parseToMinor(limit, cur);
      if (mv === null || mv.startsWith("-")) { setErr(t("cust.invalidAmount")); return; }
      body["creditLimitMinor"] = mv; body["creditCurrency"] = cur;
    }
    m.mutate(body);
  };
  return (
    <Modal open={open} onClose={onClose} title={initial ? t("cust.edit") : t("cust.new")}>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <Field label={t("cust.name")}><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
        <Field label={t("cust.phone")}><input className="input num" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" /></Field>
        <Field label={t("cust.address")}><input className="input" value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
        <Field label={t("cust.priceList")}>
          <select className="input" value={priceListId} onChange={(e) => setPriceListId(e.target.value)}>
            <option value="">{t("cust.noPriceList")}</option>
            {(pl.data ?? []).map((p) => <option key={p.id} value={p.id}>{locale === "ar" ? p.name_ar : p.name_en}</option>)}
          </select>
        </Field>
        <Field label={t("cust.creditLimit")} hint={canCredit ? undefined : t("cust.creditDenied")}>
          <input className="input num" value={limit} onChange={(e) => setLimit(e.target.value)} disabled={!canCredit} inputMode="decimal" />
        </Field>
        <Field label={t("cust.creditCurrency")}>
          <select className="input" value={cur} onChange={(e) => setCur(e.target.value)} disabled={!canCredit}>{CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}</select>
        </Field>
        <div className="sm:col-span-2"><Field label={t("common.notes")}><textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field></div>
        {err && <div role="alert" className="rounded-md bg-red-50 p-2 text-sm text-red-700 sm:col-span-2">{err}</div>}
        <div className="flex justify-end gap-2 sm:col-span-2">
          <button type="button" className="btn-secondary" onClick={onClose}>{t("common.cancel")}</button>
          <button type="submit" className="btn-primary" disabled={m.isPending}>{t("common.save")}</button>
        </div>
      </form>
    </Modal>
  );
}

function CustomerList() {
  const { t, locale } = useT();
  const nav = useNavigate();
  const [q, setQ] = useState(""); const dq = useDebounced(q); const [offset, setOffset] = useState(0);
  const [editing, setEditing] = useState<CustomerRow | null | undefined>(undefined);
  useEffect(() => { setOffset(0); }, [dq]);
  const list = useQuery({ queryKey: ["customers", dq, offset], queryFn: () => get<ListResp>("/customers", { q: dq, limit: LIMIT, offset }), placeholderData: (p) => p });
  const rows = useMemo(() => rowsOf(list.data), [list.data]);
  const total = Array.isArray(list.data) ? rows.length : (list.data?.total ?? rows.length);
  const page = Math.floor(offset / LIMIT) + 1, pages = Math.max(1, Math.ceil(total / LIMIT));
  return (
    <div>
      <PageHeader title={t("cust.title")} actions={<button className="btn-primary" onClick={() => setEditing(null)}>{t("cust.new")}</button>} />
      <div className="mb-3"><Field label={t("common.search")}><input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("cust.searchPlaceholder")} autoFocus /></Field></div>
      {list.isLoading && <Spinner />}
      {list.error && <ErrorBox error={list.error} onRetry={() => void list.refetch()} />}
      {list.data && rows.length === 0 && <Empty />}
      {rows.length > 0 && (
        <div className="card overflow-auto">
          <table>
            <thead><tr><th>{t("cust.code")}</th><th>{t("cust.name")}</th><th>{t("cust.phone")}</th><th>{t("cust.creditLimit")}</th><th>{t("common.status")}</th><th>{t("common.actions")}</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="cursor-pointer hover:bg-slate-50" onClick={() => nav(`/customers/${r.id}`)}>
                  <td className="num">{r.code}</td>
                  <td>{r.name} {r.is_walk_in && <Badge>{t("cust.walkIn")}</Badge>}</td>
                  <td className="num">{r.phone ?? "—"}</td>
                  <td className="num">{r.credit_limit_minor ? fmtMinor(r.credit_limit_minor, r.credit_currency ?? "YER_NEW", locale) : "—"}</td>
                  <td>{r.is_active ? <Badge tone="green">{t("common.active")}</Badge> : <Badge tone="red">{t("common.inactive")}</Badge>}</td>
                  <td><button className="btn-secondary" aria-label={t("common.edit")} onClick={(e) => { e.stopPropagation(); setEditing(r); }}>✎</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2 flex items-center justify-between text-sm">
            <button className="btn-secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - LIMIT))}>{t("cust.prev")}</button>
            <span className="num">{t("cust.page", { p: page, n: pages })}</span>
            <button className="btn-secondary" disabled={page >= pages} onClick={() => setOffset(offset + LIMIT)}>{t("common.next")}</button>
          </div>
        </div>
      )}
      <CustomerForm open={editing !== undefined} onClose={() => setEditing(undefined)} initial={editing ?? undefined} />
    </div>
  );
}

export default function CustomersPage() {
  return <Routes><Route index element={<CustomerList />} /><Route path=":id" element={<CustomerDetail />} /></Routes>;
}
