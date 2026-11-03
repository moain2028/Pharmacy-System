import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { get } from "@/lib/api";
import { useT } from "@/i18n";
import { Empty, ErrorBox, Spinner } from "@/components/ui";
import { moneyText, Pager, record, rowsOf, text } from "@/features/procurement/shared";
import type { Rows } from "@/features/procurement/shared";
export default function DocumentList({ path, onSelect }: { path: string; onSelect?: ((id: string) => void) | undefined }) {
  const { t, locale } = useT(); const [offset, setOffset] = useState(0);
  const q = useQuery({ queryKey: [path, { offset }], queryFn: () => get<Rows<Record<string, unknown>>>(path, { limit: 50, offset }) }); const rows = rowsOf(q.data);
  if (q.isLoading) return <Spinner />; if (q.error) return <ErrorBox error={q.error} onRetry={() => void q.refetch()} />;
  const statuses = ["DRAFT", "APPROVED", "PARTIALLY_RECEIVED", "RECEIVED", "CLOSED", "CANCELLED", "POSTED"];
  return <div className="overflow-auto">{rows.length === 0 ? <Empty /> : <table><thead><tr><th>{t("purchasing.number")}</th><th>{t("common.date")}</th><th>{t("common.status")}</th><th>{t("common.total")}</th>{onSelect && <th>{t("common.actions")}</th>}</tr></thead><tbody>{rows.map(r => { const id = text(r["id"]); const status = text(r["status"]); return <tr key={id}><td className="num">{text(r["number"])}</td><td className="num">{text(r["business_date"] ?? r["invoice_date"] ?? r["created_at"]).slice(0, 10)}</td><td>{t(statuses.includes(status) ? `purchasing.${status}` : "purchasing.statusUnknown")}</td><td className="num">{moneyText(r["total_minor"] ?? record(r["totals"])["total"], text(r["currency"]) || "YER_NEW", locale)}</td>{onSelect && <td><button className="btn-secondary" onClick={() => onSelect(id)}>{t("purchasing.load")}</button></td>}</tr>; })}</tbody></table>}<Pager offset={offset} count={rows.length} total={Array.isArray(q.data) ? undefined : q.data?.total} onChange={setOffset} /></div>;
}
