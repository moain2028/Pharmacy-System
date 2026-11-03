import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { get, post } from "@/lib/api";
import { useT } from "@/i18n";
import { ErrorBox, Modal, Spinner } from "@/components/ui";
import DocumentList from "@/features/procurement/DocumentList";
import { array, record, text, Totals } from "@/features/procurement/shared";
export default function PoList({ onReceive }: { onReceive: (id: string) => void }) {
  const { t } = useT(); const qc = useQueryClient(); const [id, setId] = useState(""); const q = useQuery({ queryKey: ["/purchase-orders", id], queryFn: () => get<{ order: Record<string, unknown>; lines: unknown[] }>(`/purchase-orders/${id}`), enabled: Boolean(id) });
  const approve = useMutation({ mutationFn: () => post(`/purchase-orders/${id}/approve`), onSuccess: () => { void qc.invalidateQueries({ queryKey: ["/purchase-orders"] }); } }); const order = q.data?.order;
  return <><DocumentList path="/purchase-orders" onSelect={v => { approve.reset(); setId(v); }} /><Modal open={Boolean(id)} onClose={() => setId("")} title={t("purchasing.po")} wide>{q.isLoading && <Spinner />}{q.error && <ErrorBox error={q.error} />}{order && <div className="space-y-3"><h3 className="num">{text(order["number"])}</h3><Totals value={order["totals"]} currency={text(order["currency"])} /><table><thead><tr><th>{t("nav.items")}</th><th>{t("common.quantity")}</th></tr></thead><tbody>{array(q.data?.lines).map((v, i) => { const r = record(v); return <tr key={text(r["id"]) || i}><td>{text(r["trade_name_ar"] ?? r["itemId"] ?? r["item_id"])}</td><td className="num">{text(r["qtyInUnit"] ?? r["qty_in_unit"])}</td></tr>; })}</tbody></table>{approve.error && <ErrorBox error={approve.error} />}<button className="btn-primary" disabled={approve.isPending || approve.isSuccess || order["status"] !== "DRAFT"} onClick={() => approve.mutate()}>{t("purchasing.approve")}</button><button className="btn-secondary" onClick={() => { onReceive(id); setId(""); }}>{t("stock.receipt")}</button></div>}</Modal></>;
}
