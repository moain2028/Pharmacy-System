import { useTab } from "@/lib/useTab";
import { useState } from "react";
import { useT } from "@/i18n";
import { PageHeader } from "@/components/ui";
import PoForm from "@/features/purchasing/PoForm";
import PoList from "@/features/purchasing/PoList";
import GrnForm from "@/features/purchasing/GrnForm";
import DocumentList from "@/features/procurement/DocumentList";
export default function Purchasing() {
  const { t, dir } = useT(); const [tab, setTab] = useTab(["orders", "receipts"] as const); const [po, setPo] = useState("");
  return <div dir={dir}><PageHeader title={t("nav.purchasing")} /><div className="mb-4 flex gap-2" role="tablist">{(["orders", "receipts"] as const).map(k => <button key={k} role="tab" aria-selected={tab === k} className="btn-secondary" onClick={() => setTab(k)}>{t(`purchasing.${k}`)}</button>)}</div><div role="tabpanel" className="space-y-4">{tab === "orders" ? <><PoList onReceive={id => { setPo(id); setTab("receipts"); }} /><PoForm /></> : <><DocumentList path="/goods-receipts" /><GrnForm key={po} initialPoId={po} /></>}</div></div>;
}
