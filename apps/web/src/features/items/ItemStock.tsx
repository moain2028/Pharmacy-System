import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { get } from "@/lib/api";
import { fmtMinor } from "@/lib/money";
import { useT } from "@/i18n";
import { Badge, Empty, ErrorBox, Field, Spinner } from "@/components/ui";
import { nameOf, rowsOf, type BalanceRow, type LocationRow } from "./types";

const STATUSES = ["NONE", "QUARANTINED", "BLOCKED", "RETURNED_TO_SUPPLIER", "DESTROYED"];
const tone = (s: string): "green" | "amber" | "red" => (!s || s === "NONE" ? "green" : s === "QUARANTINED" ? "amber" : "red");
const useBalances = (itemId: string) => useQuery({ queryKey: ["item-balances", itemId], queryFn: () => get<BalanceRow[] | { rows: BalanceRow[] }>(`/inventory/items/${itemId}/balances`) });

export function StockPanel({ itemId }: { itemId: string }) {
  const { t, locale } = useT();
  const b = useBalances(itemId);
  const l = useQuery({ queryKey: ["locations"], queryFn: () => get<LocationRow[] | { rows: LocationRow[] }>("/inventory/locations") });
  const rows = useMemo(() => rowsOf(b.data), [b.data]);
  const locs = useMemo(() => rowsOf(l.data), [l.data]);
  const total = useMemo(() => rows.reduce((s, r) => s + BigInt(r.qty_ssu || "0"), 0n), [rows]);
  if (b.isLoading) return <Spinner />;
  if (b.error) return <ErrorBox error={b.error} onRetry={() => void b.refetch()} />;
  if (rows.length === 0) return <Empty />;
  return (
    <div className="card overflow-x-auto"><table>
      <thead><tr><th>{t("items.lot")}</th><th>{t("items.expiry")}</th><th>{t("items.location")}</th><th>{t("items.qtySsu")}</th><th>{t("items.lotStatus")}</th><th>{t("items.unitCost")}</th></tr></thead>
      <tbody>{rows.map((r) => { const s = r.manual_status || "NONE"; return (
        <tr key={`${r.lot_id}-${r.location_id}`}>
          <td className="num">{r.lot_number}</td><td className="num">{r.expiry_date ?? "—"}</td><td>{nameOf(locs.find((x) => x.id === r.location_id), locale, r.location_id)}</td>
          <td className="num">{r.qty_ssu}</td><td><Badge tone={tone(s)}>{STATUSES.includes(s) ? t(`items.status.${s}`) : s}</Badge></td><td className="num">{fmtMinor(r.unit_cost_minor || "0", "YER_NEW", locale, false)}</td>
        </tr>); })}</tbody>
      <tfoot><tr><td colSpan={3} className="font-medium">{t("common.total")}</td><td className="num font-medium">{total.toString()}</td><td colSpan={2} /></tr></tfoot>
    </table></div>
  );
}

type KRow = Record<string, unknown>;
const pick = (r: KRow, ...keys: string[]): string => { for (const k of keys) { const v = r[k]; if (v !== undefined && v !== null && v !== "") return String(v).slice(0, k.includes("date") || k.endsWith("_at") ? 10 : undefined); } return "—"; };

export function KardexPanel({ itemId }: { itemId: string }) {
  const { t } = useT();
  const [lotId, setLotId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const b = useBalances(itemId);
  const lots = useMemo(() => rowsOf(b.data), [b.data]);
  const k = useQuery({ queryKey: ["kardex", itemId, lotId, from, to], queryFn: () => get<KRow[] | { rows: KRow[] }>(`/inventory/items/${itemId}/kardex`, { lotId: lotId || undefined, from: from || undefined, to: to || undefined, limit: 200 }) });
  const rows = useMemo(() => rowsOf(k.data), [k.data]);
  return (
    <div>
      <div className="card mb-3 grid grid-cols-1 gap-3 md:grid-cols-3">
        <Field label={t("items.lot")}><select className="input" value={lotId} onChange={(e) => setLotId(e.target.value)}><option value="">{t("items.allLots")}</option>{lots.map((l) => <option key={l.lot_id} value={l.lot_id}>{l.lot_number}</option>)}</select></Field>
        <Field label={t("common.from")}><input type="date" className="input num" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label={t("common.to")}><input type="date" className="input num" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      {k.isLoading ? <Spinner /> : k.error ? <ErrorBox error={k.error} onRetry={() => void k.refetch()} /> : rows.length === 0 ? <Empty /> : (
        <div className="card overflow-x-auto"><table>
          <thead><tr><th>{t("common.date")}</th><th>{t("items.movType")}</th><th>{t("items.lot")}</th><th>{t("items.qtyDelta")}</th><th>{t("items.balanceAfter")}</th><th>{t("items.document")}</th><th>{t("common.reason")}</th></tr></thead>
          <tbody>{rows.map((r, i) => (
            <tr key={pick(r, "id", "movement_id") + i}>
              <td className="num">{pick(r, "business_date", "occurred_at", "created_at")}</td><td>{pick(r, "movement_type", "type", "kind")}</td><td className="num">{pick(r, "lot_number", "lot_id")}</td>
              <td className="num">{pick(r, "qty_delta_ssu", "qty_ssu", "qty")}</td><td className="num">{pick(r, "balance_after_ssu", "balance_ssu", "running_balance_ssu")}</td>
              <td>{pick(r, "document_number", "document_type", "reference")}</td><td>{pick(r, "reason", "notes")}</td>
            </tr>))}</tbody>
        </table></div>)}
    </div>
  );
}
