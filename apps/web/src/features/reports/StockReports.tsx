import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { get } from "@/lib/api";
import { useT } from "@/i18n";
import { ReportView } from "./ReportView";
import type { Column } from "./ReportTable";
import { moneyStr, str } from "./csv";
import { clampDays, curOf, DateField, DaysField, fmtDateTime, labelOf, pick, rowsOf, todayIso, totalsOf } from "./util";

export function ValuationReport() {
  const { t, locale } = useT();
  const [asOf, setAsOf] = useState(todayIso);
  const [byLoc, setByLoc] = useState(false);
  const q = useQuery({ queryKey: ["reports", "valuation", asOf, byLoc], queryFn: () => get<unknown>("/reports/inventory-valuation", { asOf, byLocation: byLoc ? "true" : "false" }), placeholderData: keepPreviousData });
  const cur = curOf(q.data);
  const rows = useMemo(() => rowsOf(q.data).map((r) => ({
    ...r, name: labelOf(r, locale), qtySsu: str(pick(r, "qtySsu", "qty_ssu")), valueMinor: moneyStr(pick(r, "valueMinor", "value_minor")),
    location: str(pick(r, "locationCode", "location_code", "locationName", "location_name_ar", "locationId", "location_id")),
  })), [q.data, locale]);
  const totals = useMemo(() => totalsOf(q.data, rows, ["valueMinor"]), [q.data, rows]);
  const cols: Column[] = [
    { key: "name", title: t("reports.col.item") },
    ...(byLoc ? [{ key: "location", title: t("reports.col.location") }] : []),
    { key: "qtySsu", title: t("reports.col.qty"), num: true }, { key: "valueMinor", title: t("reports.col.value"), money: true, currency: cur },
  ];
  const filters = (
    <>
      <DateField label={t("reports.asOf")} value={asOf} onChange={setAsOf} />
      <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={byLoc} onChange={(e) => setByLoc(e.target.checked)} />{t("reports.byLocation")}</label>
    </>
  );
  return <ReportView title={t("reports.tab.inventory")} filename="inventory-valuation" filters={filters} loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} columns={cols} rows={rows} totals={totals} />;
}

function LotReport({ kind }: { kind: "expiry" | "slow" }) {
  const { t, locale } = useT();
  const [days, setDays] = useState("90");
  const d = clampDays(days);
  const path = kind === "expiry" ? "/reports/expiry" : "/reports/slow-moving";
  const q = useQuery({ queryKey: ["reports", kind, d], queryFn: () => get<unknown>(path, { days: d }), placeholderData: keepPreviousData });
  const cur = curOf(q.data);
  const rows = useMemo(() => rowsOf(q.data).map((r) => ({
    ...r, name: labelOf(r, locale), lotNumber: str(pick(r, "lotNumber", "lot_number")), expiryDate: str(pick(r, "expiryDate", "expiry_date")),
    qtySsu: str(pick(r, "qtySsu", "qty_ssu")), valueMinor: moneyStr(pick(r, "valueMinor", "value_minor")), bucket: str(pick(r, "bucket")),
    lastSale: fmtDateTime(pick(r, "lastSaleDate", "last_sale_date", "lastSoldAt", "last_sold_at")),
  })), [q.data, locale]);
  const totals = useMemo(() => totalsOf(q.data, rows, ["valueMinor"]), [q.data, rows]);
  const cols: Column[] = kind === "expiry"
    ? [{ key: "name", title: t("reports.col.item") }, { key: "lotNumber", title: t("reports.col.lot") }, { key: "expiryDate", title: t("reports.col.expiry"), num: true },
      { key: "bucket", title: t("reports.col.bucket") }, { key: "qtySsu", title: t("reports.col.qty"), num: true }, { key: "valueMinor", title: t("reports.col.value"), money: true, currency: cur }]
    : [{ key: "name", title: t("reports.col.item") }, { key: "lastSale", title: t("reports.col.lastSale"), num: true },
      { key: "qtySsu", title: t("reports.col.qty"), num: true }, { key: "valueMinor", title: t("reports.col.value"), money: true, currency: cur }];
  return <ReportView title={t(kind === "expiry" ? "reports.tab.expiry" : "reports.tab.slow")} filename={kind === "expiry" ? "expiry" : "slow-moving"} filters={<DaysField value={days} onChange={setDays} />} loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} columns={cols} rows={rows} totals={totals} />;
}

export function ExpiryReport() { return <LotReport kind="expiry" />; }
export function SlowMovingReport() { return <LotReport kind="slow" />; }
