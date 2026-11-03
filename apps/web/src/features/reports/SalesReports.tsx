import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { get } from "@/lib/api";
import { useT } from "@/i18n";
import { Field } from "@/components/ui";
import { ReportView } from "./ReportView";
import type { Column } from "./ReportTable";
import { moneyStr, str } from "./csv";
import { curOf, labelOf, pick, rowsOf, sameCurrencyTotals, totalsOf, useRange } from "./util";

const GROUPS = ["day", "month", "cashier", "item", "category"] as const;
type GroupBy = (typeof GROUPS)[number];
const SALES_MONEY = ["gross", "discount", "net", "tax", "total", "cogs", "grossMargin", "returnRefund"];

export function SalesReport() {
  const { t, locale } = useT();
  const { from, to, fields } = useRange();
  const [groupBy, setGroupBy] = useState<GroupBy>("day");
  const q = useQuery({ queryKey: ["reports", "sales", from, to, groupBy], queryFn: () => get<unknown>("/reports/sales", { from, to, groupBy }), placeholderData: keepPreviousData });
  const cur = curOf(q.data);
  const rows = useMemo(() => rowsOf(q.data).map((r) => ({ ...r, label: labelOf(r, locale) || str(r["key"]) })), [q.data, locale]);
  const totals = useMemo(() => totalsOf(q.data, rows, ["count", ...SALES_MONEY]), [q.data, rows]);
  const cols: Column[] = [
    { key: "label", title: t("reports.col.label") }, { key: "count", title: t("reports.col.count"), num: true },
    ...SALES_MONEY.map((k): Column => ({ key: k, title: t(`reports.col.${k}`), money: true, currency: cur })),
  ];
  const filters = (
    <>
      {fields}
      <Field label={t("reports.groupBy")}>
        <select className="input" value={groupBy} onChange={(e) => { const v = GROUPS.find((g) => g === e.target.value); if (v) setGroupBy(v); }}>
          {GROUPS.map((g) => <option key={g} value={g}>{t(`reports.group.${g}`)}</option>)}
        </select>
      </Field>
    </>
  );
  return (
    <>
      <ReportView title={t("reports.tab.sales")} filename="sales" filters={filters} loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} columns={cols} rows={rows} totals={totals} />
      <SalesByMethod from={from} to={to} cur={cur} />
      <TopItems from={from} to={to} cur={cur} />
    </>
  );
}

function SalesByMethod({ from, to, cur }: { from: string; to: string; cur: string }) {
  const { t } = useT();
  const q = useQuery({ queryKey: ["reports", "sales-by-method", from, to], queryFn: () => get<unknown>("/reports/sales-by-method", { from, to }), placeholderData: keepPreviousData });
  const rows = useMemo(() => rowsOf(q.data).map((r) => ({
    method: str(pick(r, "method")), currency: str(pick(r, "currency")) || cur, count: pick(r, "count") ?? "",
    amount: moneyStr(pick(r, "amountMinor", "amount_minor", "totalMinor", "total_minor", "total", "amount")),
  })), [q.data, cur]);
  const totals = useMemo(() => sameCurrencyTotals(rows, ["count", "amount"]), [rows]);
  const cols: Column[] = [
    { key: "method", title: t("reports.col.method"), render: (r) => { const m = str(r["method"]).toLowerCase(); return m ? t(`pos.${m}`) : ""; } },
    { key: "currency", title: t("reports.col.currency") }, { key: "count", title: t("reports.col.count"), num: true },
    { key: "amount", title: t("reports.col.amount"), money: true, currencyKey: "currency", currency: cur },
  ];
  return <ReportView title={t("reports.byMethod")} filename="sales-by-method" loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} columns={cols} rows={rows} totals={totals} />;
}

function TopItems({ from, to, cur }: { from: string; to: string; cur: string }) {
  const { t, locale } = useT();
  const q = useQuery({ queryKey: ["reports", "top-items", from, to], queryFn: () => get<unknown>("/reports/top-items", { limit: 20, from, to }), placeholderData: keepPreviousData });
  const rows = useMemo(() => rowsOf(q.data).map((r) => ({
    name: labelOf(r, locale), qty: str(pick(r, "qtySsu", "qty_ssu", "qty", "quantity")),
    amount: moneyStr(pick(r, "total", "totalMinor", "net", "netMinor", "revenue", "amountMinor", "amount")),
  })), [q.data, locale]);
  const cols: Column[] = [
    { key: "name", title: t("reports.col.item") }, { key: "qty", title: t("reports.col.qty"), num: true },
    { key: "amount", title: t("reports.col.total"), money: true, currency: cur },
  ];
  return <ReportView period={`${from} → ${to}`} title={t("reports.topItems")} filename="top-items" loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} columns={cols} rows={rows} />;
}
