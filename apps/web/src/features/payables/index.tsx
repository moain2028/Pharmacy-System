import { useState } from "react";
import { useT } from "@/i18n";
import { PageHeader } from "@/components/ui";
import DocumentList from "@/features/procurement/DocumentList";
import SupplierInvoiceForm from "@/features/payables/SupplierInvoiceForm";
import PurchaseReturnForm from "@/features/payables/PurchaseReturnForm";
export default function Payables() { const { t, dir } = useT(); const [tab, setTab] = useState("invoices"); return <div dir={dir}><PageHeader title={t("nav.payables")} /><div className="mb-4 flex gap-2" role="tablist">{["invoices", "returns"].map(k => <button key={k} className="btn-secondary" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{t(`payables.${k}`)}</button>)}</div><div role="tabpanel" className="space-y-4">{tab === "invoices" ? <><DocumentList path="/supplier-invoices" /><SupplierInvoiceForm /></> : <PurchaseReturnForm />}</div></div>; }
