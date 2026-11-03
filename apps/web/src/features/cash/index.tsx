import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { get } from "@/lib/api";
import { fmtMinor } from "@/lib/money";
import { useT } from "@/i18n";
import { Empty, ErrorBox, Modal, PageHeader, Spinner } from "@/components/ui";
import CashAction from "@/features/cash/CashAction";
import type { Action } from "@/features/cash/CashAction";
interface Balance { id: string; code: string; name_ar: string; name_en: string; currency: string; balance_minor: string }
interface Shift { id: string; cashboxId: string; openedAt: string; expectedCash: { currency: string; amountMinor: string }[] }
function XReport({ id }: { id: string }) { const { t, locale } = useT(); const q = useQuery({ queryKey: ["/shifts", id, "x-report"], queryFn: () => get<{ salesCount: number; expectedCash: { currency: string; amountMinor: string }[] }>(`/shifts/${id}/x-report`) }); return <>{q.isLoading && <Spinner />}{q.error && <ErrorBox error={q.error} />}{q.data && <div><p>{t("report.sales")}: <span className="num">{q.data.salesCount}</span></p>{q.data.expectedCash.map(c => <p key={c.currency} className="num">{fmtMinor(c.amountMinor, c.currency, locale)}</p>)}</div>}</>; }
export default function Cash() {
  const { t, locale, dir } = useT(); const [action, setAction] = useState<Action | null>(null); const [report, setReport] = useState(false);
  const balances = useQuery({ queryKey: ["/cash/balances"], queryFn: () => get<Balance[]>("/cash/balances") }); const shift = useQuery({ queryKey: ["/shifts/current"], queryFn: () => get<Shift | null>("/shifts/current") });
  return <div dir={dir} className="space-y-4"><PageHeader title={t("nav.cash")} /><div className="flex flex-wrap gap-2">{(["transfer", "fx", "owner", "movement"] as const).map(a => <button key={a} className="btn-secondary" onClick={() => setAction(a)}>{t(`cash.${a}`)}</button>)}</div>{balances.isLoading && <Spinner />}{balances.error && <ErrorBox error={balances.error} onRetry={() => void balances.refetch()} />}{balances.data?.length === 0 && <Empty />}<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{balances.data?.map(b => <section className="card" key={`${b.id}-${b.currency}`}><h2>{locale === "ar" ? b.name_ar : b.name_en}</h2><p className="num text-xl">{fmtMinor(b.balance_minor, b.currency, locale)}</p></section>)}</div><section className="card">{shift.isLoading && <Spinner />}{shift.error && <ErrorBox error={shift.error} />}{shift.data === null && <Empty>{t("shift.none")}</Empty>}{shift.data && <table><thead><tr><th>{t("suppliers.cashbox")}</th><th>{t("common.date")}</th><th>{t("common.actions")}</th></tr></thead><tbody><tr><td className="num">{shift.data.cashboxId}</td><td className="num">{shift.data.openedAt}</td><td><Link className="text-blue-700 underline" to={`?xReport=${encodeURIComponent(shift.data.id)}`} onClick={() => setReport(true)}>{t("shift.xReport")}</Link></td></tr></tbody></table>}</section><Modal open={action !== null} title={t(`cash.${action ?? "transfer"}`)} onClose={() => setAction(null)}>{action && <CashAction key={action} action={action} onDone={() => setAction(null)} />}</Modal><Modal open={report} title={t("shift.xReport")} onClose={() => setReport(false)}>{report && shift.data && <XReport id={shift.data.id} />}</Modal></div>;
}
