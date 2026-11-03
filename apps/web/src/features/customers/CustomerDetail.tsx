import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { get, post, type MoneyJson } from "@/lib/api";
import { fmtMinor, fmtMoney, MINOR_UNITS, parseToMinor } from "@/lib/money";
import { useT } from "@/i18n";
import { Badge, Empty, ErrorBox, Field, Modal, PageHeader, Spinner, toast } from "@/components/ui";

type MoneyLike = string | MoneyJson | null | undefined;
interface Customer { id: string; code: string; name: string; phone: string | null; address?: string | null; credit_limit_minor: string | null; credit_currency: string | null; is_walk_in: boolean; is_active: boolean; version: number; balance: MoneyJson | null }
interface StatementRow { date: string; type: string; number: string | null; debit: MoneyLike; credit: MoneyLike; balance: MoneyLike }
interface Statement { opening: MoneyLike; rows: StatementRow[]; closing: MoneyLike }
interface Cashbox { id: string; code: string; name_ar: string; name_en: string; kind: string }
interface OpenInvoice { id: string; number: string; business_date: string; total_minor: string; paid_minor: string; credit_minor: string | null; currency: string; status: string }
type Method = "CASH" | "CARD" | "WALLET";
interface ReceiptBody { customerId: string; cashboxId: string; method: Method; currency: string; amountMinor: string; allocations: Array<{ invoiceId: string; amountMinor: string }>; reference?: string }

const rowsOf = <T,>(x: T[] | { rows?: T[] } | null | undefined): T[] => (Array.isArray(x) ? x : (x?.rows ?? []));
const fmtAny = (v: MoneyLike, cur: string, locale: "ar" | "en") => (v == null ? "—" : typeof v === "string" ? fmtMinor(v, cur, locale) : fmtMoney(v, locale));
const TYPE_KEY: Record<string, string> = { INVOICE: "pos.invoice", SALE: "pos.invoice", RECEIPT: "cust.receipt", RETURN: "cust.return", OPENING: "cust.opening" };
const METHODS: Array<{ v: Method; k: string }> = [{ v: "CASH", k: "cust.methodCash" }, { v: "CARD", k: "cust.methodCard" }, { v: "WALLET", k: "cust.methodWallet" }];

function ReceiveModal({ customer, open, onClose }: { customer: Customer; open: boolean; onClose: () => void }) {
  const { t, locale } = useT();
  const qc = useQueryClient();
  const defCur = customer.balance?.currency ?? customer.credit_currency ?? "YER_NEW";
  const [cashboxId, setCashboxId] = useState(""); const [method, setMethod] = useState<Method>("CASH"); const [currency, setCurrency] = useState(defCur);
  const [amount, setAmount] = useState(""); const [reference, setReference] = useState(""); const [alloc, setAlloc] = useState<Record<string, string>>({}); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (open) { setCashboxId(""); setMethod("CASH"); setCurrency(defCur); setAmount(""); setReference(""); setAlloc({}); setErr(null); } }, [open, defCur]);
  const boxes = useQuery({ queryKey: ["cashboxes"], queryFn: () => get<Cashbox[] | { rows?: Cashbox[] }>("/cashboxes"), enabled: open });
  const inv = useQuery({ queryKey: ["customer-open-invoices", customer.id], queryFn: () => get<OpenInvoice[] | { rows?: OpenInvoice[] }>("/sales", { customerId: customer.id, status: "POSTED", limit: 200 }), enabled: open });
  const openInv = useMemo(() => rowsOf(inv.data).filter((r) => r.currency === currency && BigInt(r.credit_minor ?? "0") > 0n), [inv.data, currency]);
  const amountMinor = useMemo(() => parseToMinor(amount, currency), [amount, currency]);
  const allocTotal = useMemo(() => {
    let s = 0n;
    for (const r of openInv) { const v = alloc[r.id]?.trim(); if (!v) continue; const mv = parseToMinor(v, currency); if (mv === null) return null; s += BigInt(mv); }
    return s;
  }, [alloc, openInv, currency]);
  const m = useMutation({
    mutationFn: (body: ReceiptBody) => post<{ id: string }>("/customer-receipts", body),
    onSuccess: () => {
      for (const k of ["customer", "customers", "customer-statement", "customer-open-invoices"]) void qc.invalidateQueries({ queryKey: [k] });
      toast.ok(t("cust.receiptSaved")); onClose();
    },
    onError: (e: Error) => setErr(e.message),
  });
  const autoAllocate = () => {
    if (amountMinor === null) return;
    let left = BigInt(amountMinor); const next: Record<string, string> = {};
    for (const r of openInv) { if (left <= 0n) break; const rem = BigInt(r.credit_minor ?? "0"); const take = rem < left ? rem : left; next[r.id] = fmtMinor(take.toString(), currency, "en", false); left -= take; }
    setAlloc(next);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    if (!cashboxId) { setErr(t("cust.cashboxRequired")); return; }
    if (amountMinor === null || BigInt(amountMinor) <= 0n) { setErr(t("cust.invalidAmount")); return; }
    const allocations: ReceiptBody["allocations"] = [];
    for (const r of openInv) {
      const v = alloc[r.id]?.trim(); if (!v) continue;
      const am = parseToMinor(v, currency);
      if (am === null || BigInt(am) <= 0n) { setErr(t("cust.invalidAmount")); return; }
      if (BigInt(am) > BigInt(r.credit_minor ?? "0")) { setErr(t("cust.allocOverInvoice", { n: r.number })); return; }
      allocations.push({ invoiceId: r.id, amountMinor: am });
    }
    if (allocations.reduce((s, a) => s + BigInt(a.amountMinor), 0n) > BigInt(amountMinor)) { setErr(t("cust.allocExceeds")); return; }
    const body: ReceiptBody = { customerId: customer.id, cashboxId, method, currency, amountMinor, allocations };
    if (reference.trim()) body.reference = reference.trim();
    m.mutate(body);
  };
  return (
    <Modal open={open} onClose={onClose} title={t("cust.receiveTitle")} wide>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-3">
        <Field label={t("cust.cashbox")}>
          <select className="input" value={cashboxId} onChange={(e) => setCashboxId(e.target.value)}>
            <option value="">—</option>
            {rowsOf(boxes.data).map((b) => <option key={b.id} value={b.id}>{locale === "ar" ? b.name_ar : b.name_en}</option>)}
          </select>
        </Field>
        <Field label={t("cust.method")}><select className="input" value={method} onChange={(e) => setMethod(e.target.value as Method)}>{METHODS.map((o) => <option key={o.v} value={o.v}>{t(o.k)}</option>)}</select></Field>
        <Field label={t("common.currency")}><select className="input" value={currency} onChange={(e) => { setCurrency(e.target.value); setAlloc({}); }}>{Object.keys(MINOR_UNITS).map((c) => <option key={c} value={c}>{c}</option>)}</select></Field>
        <Field label={t("common.amount")} error={amount && amountMinor === null ? t("cust.invalidAmount") : undefined}><input className="input num" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" autoFocus /></Field>
        <div className="sm:col-span-2"><Field label={t("cust.reference")}><input className="input" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={80} /></Field></div>
        <div className="sm:col-span-3">
          <div className="mb-1 flex items-center justify-between"><span className="label">{t("cust.allocations")}</span><button type="button" className="btn-secondary" onClick={autoAllocate} disabled={amountMinor === null || openInv.length === 0}>{t("cust.autoAllocate")}</button></div>
          {inv.isLoading && <Spinner />}
          {inv.error && <ErrorBox error={inv.error} />}
          {inv.data && openInv.length === 0 && <Empty>{t("cust.noOpenInvoices")}</Empty>}
          {openInv.length > 0 && (
            <table>
              <thead><tr><th>{t("pos.invoice")}</th><th>{t("common.date")}</th><th>{t("common.total")}</th><th>{t("cust.remaining")}</th><th>{t("cust.allocated")}</th></tr></thead>
              <tbody>{openInv.map((r) => (
                <tr key={r.id}><td className="num">{r.number}</td><td className="num">{r.business_date}</td><td className="num">{fmtMinor(r.total_minor, r.currency, locale)}</td><td className="num">{fmtMinor(r.credit_minor ?? "0", r.currency, locale)}</td>
                  <td><input className="input num w-32" aria-label={`${t("cust.allocated")} ${r.number}`} value={alloc[r.id] ?? ""} onChange={(e) => setAlloc({ ...alloc, [r.id]: e.target.value })} inputMode="decimal" /></td></tr>
              ))}</tbody>
            </table>
          )}
          <div className="mt-2 text-sm text-ink-600">{t("cust.allocated")}: <span className="num">{allocTotal === null ? "?" : fmtMinor(allocTotal.toString(), currency, locale)}</span></div>
        </div>
        {err && <div role="alert" className="rounded-md bg-danger-50 p-2 text-sm text-danger-700 sm:col-span-3">{err}</div>}
        <div className="flex justify-end gap-2 sm:col-span-3">
          <button type="button" className="btn-secondary" onClick={onClose}>{t("common.cancel")}</button>
          <button type="submit" className="btn-primary" disabled={m.isPending}>{t("common.confirm")}</button>
        </div>
      </form>
    </Modal>
  );
}

export default function CustomerDetail() {
  const { id = "" } = useParams();
  const { t, locale } = useT();
  const nav = useNavigate();
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(today.slice(0, 8) + "01"); const [to, setTo] = useState(today); const [pay, setPay] = useState(false);
  const cq = useQuery({ queryKey: ["customer", id], queryFn: () => get<Customer>(`/customers/${id}`), enabled: id !== "" });
  const sq = useQuery({ queryKey: ["customer-statement", id, from, to], queryFn: () => get<Statement>(`/customers/${id}/statement`, { from, to }), enabled: id !== "" && from !== "" && to !== "" });
  if (cq.isLoading) return <Spinner />;
  if (cq.error) return <ErrorBox error={cq.error} onRetry={() => void cq.refetch()} />;
  const c = cq.data;
  if (!c) return <Empty>{t("cust.notFound")}</Empty>;
  const cur = c.balance?.currency ?? c.credit_currency ?? "YER_NEW";
  return (
    <div>
      <PageHeader title={`${c.name} (${c.code})`} actions={<>
        <button className="btn-secondary" onClick={() => nav("/customers")}>{t("common.back")}</button>
        <button className="btn-primary" onClick={() => setPay(true)}>{t("cust.receive")}</button>
      </>} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="card"><div className="text-xs text-ink-500">{t("cust.balance")}</div><div className="num mt-1 text-2xl font-semibold">{fmtMoney(c.balance, locale)}</div></div>
        <div className="card"><div className="text-xs text-ink-500">{t("cust.creditLimit")}</div><div className="num mt-1 text-2xl font-semibold">{c.credit_limit_minor ? fmtMinor(c.credit_limit_minor, c.credit_currency ?? cur, locale) : "—"}</div></div>
        <div className="card"><div className="text-xs text-ink-500">{t("cust.phone")}</div><div className="num mt-1 text-lg">{c.phone ?? "—"}</div></div>
        <div className="card"><div className="text-xs text-ink-500">{t("common.status")}</div><div className="mt-1">{c.is_active ? <Badge tone="green">{t("common.active")}</Badge> : <Badge tone="red">{t("common.inactive")}</Badge>} {c.is_walk_in && <Badge>{t("cust.walkIn")}</Badge>}</div></div>
      </div>
      <div className="card mt-4">
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <h2 className="me-auto text-base font-semibold">{t("cust.statement")}</h2>
          <Field label={t("common.from")}><input type="date" className="input num" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label={t("common.to")}><input type="date" className="input num" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
        {sq.isLoading && <Spinner />}
        {sq.error && <ErrorBox error={sq.error} onRetry={() => void sq.refetch()} />}
        {sq.data && (
          <table>
            <thead><tr><th>{t("common.date")}</th><th>{t("cust.type")}</th><th>{t("cust.number")}</th><th>{t("cust.debit")}</th><th>{t("cust.credit")}</th><th>{t("cust.runningBalance")}</th></tr></thead>
            <tbody>
              <tr className="font-medium"><td colSpan={5}>{t("cust.opening")}</td><td className="num">{fmtAny(sq.data.opening, cur, locale)}</td></tr>
              {(sq.data.rows ?? []).map((r, i) => (
                <tr key={`${r.number ?? ""}-${i}`}><td className="num">{r.date}</td><td>{t(TYPE_KEY[r.type] ?? r.type)}</td><td className="num">{r.number ?? "—"}</td>
                  <td className="num">{fmtAny(r.debit, cur, locale)}</td><td className="num">{fmtAny(r.credit, cur, locale)}</td><td className="num">{fmtAny(r.balance, cur, locale)}</td></tr>
              ))}
              <tr className="font-semibold"><td colSpan={5}>{t("cust.closing")}</td><td className="num">{fmtAny(sq.data.closing, cur, locale)}</td></tr>
            </tbody>
          </table>
        )}
      </div>
      <ReceiveModal customer={c} open={pay} onClose={() => setPay(false)} />
    </div>
  );
}
