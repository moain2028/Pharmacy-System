import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { get } from "@/lib/api";
import { useT } from "@/i18n";
import { ErrorBox, Modal, Spinner } from "@/components/ui";
import { moneyText, record, text } from "@/features/procurement/shared";
import SupplierForm from "@/features/suppliers/SupplierForm";
import type { Supplier } from "@/features/suppliers/SupplierForm";
import PaymentForm from "@/features/suppliers/PaymentForm";
import type { Ledger } from "@/features/suppliers/PaymentForm";
export default function SupplierDetail({ id }: { id: string }) {
  const { t, locale } = useT(); const [edit, setEdit] = useState(false); const [pay, setPay] = useState(false);
  const detail = useQuery({ queryKey: ["/suppliers", id], queryFn: () => get<Supplier>(`/suppliers/${id}`) }); const ledger = useQuery({ queryKey: ["/suppliers", id, "ledger"], queryFn: () => get<Ledger>(`/suppliers/${id}/ledger`) });
  const s = detail.data; if (detail.isLoading) return <Spinner />; if (detail.error) return <ErrorBox error={detail.error} />; if (!s) return null;
  return <section className="space-y-3"><h2>{s.name}</h2><p>{t("suppliers.balance")}: <span className="num">{moneyText(s.apBalance ?? ledger.data?.balance, s.default_currency, locale)}</span></p><div className="flex gap-2"><button className="btn-secondary" onClick={() => setEdit(true)}>{t("common.edit")}</button><button className="btn-primary" disabled={!ledger.data || ledger.isFetching || Boolean(ledger.error)} onClick={() => setPay(true)}>{t("suppliers.pay")}</button></div>{ledger.isLoading && <Spinner />}{ledger.error && <ErrorBox error={ledger.error} />}{ledger.data && <><h3>{t("suppliers.ledger")}</h3><div className="overflow-auto"><table><thead><tr><th>{t("purchasing.number")}</th><th>{t("common.date")}</th><th>{t("suppliers.due")}</th><th>{t("common.amount")}</th><th>{t("suppliers.remaining")}</th></tr></thead><tbody>{ledger.data.openItems.map(i => <tr key={i.id}><td className="num">{i.id}</td><td className="num">{i.date}</td><td className="num">{i.dueDate}</td><td className="num">{moneyText(i.amount, s.default_currency, locale)}</td><td className="num">{moneyText(i.remaining, s.default_currency, locale)}</td></tr>)}</tbody></table><table><caption>{t("report.aging")}</caption><thead><tr><th>{t("suppliers.aging")}</th><th>{t("common.amount")}</th></tr></thead><tbody>{ledger.data.aging.map((v, i) => { const r = record(v); const bucket = text(r["bucket"]); return <tr key={i}><td>{t(["current", "b1", "b2", "b3", "over"].includes(bucket) ? `suppliers.${bucket}` : "suppliers.aging")}</td><td className="num">{moneyText(r["amount"] ?? r["amountMinor"] ?? r["total"], text(r["currency"]) || s.default_currency, locale)}</td></tr>; })}</tbody></table></div></>}
    <Modal open={edit} onClose={() => setEdit(false)} title={t("common.edit")}>{edit && <SupplierForm supplier={s} onDone={() => setEdit(false)} />}</Modal><Modal open={pay} onClose={() => setPay(false)} title={t("suppliers.pay")} wide>{pay && ledger.data && <PaymentForm supplierId={id} defaultCurrency={s.default_currency} items={ledger.data.openItems} onDone={() => setPay(false)} />}</Modal></section>;
}
