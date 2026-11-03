import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { get } from "@/lib/api";
import { useT } from "@/i18n";
import { Badge, Empty, ErrorBox, Modal, PageHeader, Spinner } from "@/components/ui";
import { Input, Pager, rowsOf, useDebounce } from "@/features/procurement/shared";
import type { Rows } from "@/features/procurement/shared";
import SupplierForm from "@/features/suppliers/SupplierForm";
import type { Supplier } from "@/features/suppliers/SupplierForm";
import SupplierDetail from "@/features/suppliers/SupplierDetail";
export default function Suppliers() {
  const { t, dir } = useT(); const [search, setSearch] = useState(""); const q = useDebounce(search); const [offset, setOffset] = useState(0); const [create, setCreate] = useState(false); const [id, setId] = useState("");
  const result = useQuery({ queryKey: ["/suppliers", { q, offset }], queryFn: () => get<Rows<Supplier>>("/suppliers", { q, limit: 50, offset }) }); const rows = rowsOf(result.data);
  return <div dir={dir}><PageHeader title={t("nav.suppliers")} actions={<button className="btn-primary" onClick={() => setCreate(true)}>{t("common.new")}</button>} /><Input label="common.search" autoFocus value={search} maxLength={100} onChange={v => { setSearch(v); setOffset(0); }} />{result.isLoading && <Spinner />}{result.error && <ErrorBox error={result.error} onRetry={() => void result.refetch()} />}{result.data && <div className="overflow-auto">{rows.length === 0 ? <Empty /> : <table><thead><tr><th>{t("suppliers.name")}</th><th>{t("suppliers.phone")}</th><th>{t("common.status")}</th><th>{t("common.actions")}</th></tr></thead><tbody>{rows.map(s => <tr key={s.id}><td>{s.name}</td><td className="num">{s.phone}</td><td><Badge tone={s.is_active ? "green" : "slate"}>{t(s.is_active ? "common.active" : "common.inactive")}</Badge></td><td><button className="btn-secondary" onClick={() => setId(s.id)}>{t("suppliers.ledger")}</button></td></tr>)}</tbody></table>}<Pager offset={offset} count={rows.length} total={Array.isArray(result.data) ? undefined : result.data.total} onChange={setOffset} /></div>}<Modal open={create} onClose={() => setCreate(false)} title={t("common.new")}>{create && <SupplierForm onDone={() => setCreate(false)} />}</Modal><Modal open={Boolean(id)} onClose={() => setId("")} title={t("suppliers.ledger")} wide>{id && <SupplierDetail key={id} id={id} />}</Modal></div>;
}
