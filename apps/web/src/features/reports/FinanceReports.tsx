import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { get } from "@/lib/api";
import { fmtMinor } from "@/lib/money";
import { useT } from "@/i18n";
import { Badge } from "@/components/ui";
import { ReportView } from "./ReportView";
import type { Column } from "./ReportTable";
import { moneyStr, str, type Row } from "./csv";
import { curOf, DateField, field, labelOf, rowsOf, sumMinor, todayIso, totalsOf, useRange } from "./util";

function useAmountCols(cur: string): Column[] {
  const { t } = useT();
  return [{ key: "section", title: t("reports.col.section") }, { key: "code", title: t("reports.col.code") }, { key: "name", title: t("reports.col.name") }, { key: "amount", title: t("reports.col.amount"), money: true, currency: cur }];
}

export function TrialBalanceReport() {
  const { t, locale } = useT();
  const [to, setTo] = useState(todayIso);
  const q = useQuery({ queryKey: ["reports", "tb", to], queryFn: () => get<unknown>("/reports/trial-balance", { to }), placeholderData: keepPreviousData });
  const cur = curOf(q.data);
  const rows = useMemo(() => rowsOf(q.data).map((r) => ({ ...r, name: labelOf(r, locale) })), [q.data, locale]);
  const totals = useMemo(() => totalsOf(q.data, rows, ["debit", "credit"]), [q.data, rows]);
  const balanced = field(field(q.data, "totals"), "balanced") === true;
  const m = (key: string): Column => ({ key, title: t(`reports.col.${key}`), money: true, currency: cur });
  const cols: Column[] = [
    { key: "code", title: t("reports.col.code") }, { key: "name", title: t("reports.col.name") },
    { key: "type", title: t("reports.col.type"), render: (r) => { const v = str(r["type"]); const k = `reports.type.${v}`; const s = t(k); return s === k ? v : s; } },
    m("debit"), m("credit"), m("balance"),
  ];
  return (
    <ReportView title={t("reports.tab.trial")} filename="trial-balance" filters={<DateField label={t("common.to")} value={to} onChange={setTo} />} loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} columns={cols} rows={rows} totals={totals}>
      {q.data !== undefined && <div className="mt-2"><Badge tone={balanced ? "green" : "red"}>{t(balanced ? "reports.balanced" : "reports.unbalanced")}</Badge></div>}
    </ReportView>
  );
}

const GP_KEYS = ["sales", "returns", "discounts", "cogs", "amount"];

export function PnlReport() {
  const { t, locale } = useT();
  const { from, to, fields } = useRange();
  const q = useQuery({ queryKey: ["reports", "pnl", from, to], queryFn: () => get<unknown>("/reports/pnl", { from, to }), placeholderData: keepPreviousData });
  const cur = curOf(q.data);
  const cols = useAmountCols(cur);
  const rows = useMemo((): Row[] => {
    if (q.data === undefined) return [];
    const lines = (arr: unknown, section: string): Row[] => {
      const rs = rowsOf(arr).map((r) => ({ section, code: str(r["code"]), name: labelOf(r, locale), amount: moneyStr(r["amount"]) }));
      return [...rs, { section, name: t("common.total"), amount: sumMinor(rs, "amount"), _strong: true }];
    };
    const gp = field(q.data, "grossProfit");
    const gpS = t("reports.grossProfit");
    return [
      ...lines(field(q.data, "revenue"), t("reports.revenue")), ...lines(field(q.data, "expenses"), t("reports.expenses")),
      ...GP_KEYS.map((k) => ({ section: gpS, name: t(`reports.gp.${k}`), amount: moneyStr(field(gp, k)), _strong: k === "amount" })),
    ];
  }, [q.data, locale, t]);
  const totals: Row | undefined = q.data === undefined ? undefined : { section: t("reports.netProfit"), amount: moneyStr(field(q.data, "netProfit")) };
  return <ReportView title={t("reports.tab.pnl")} filename="profit-loss" filters={fields} loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} columns={cols} rows={rows} totals={totals} />;
}

export function BalanceSheetReport() {
  const { t, locale } = useT();
  const [to, setTo] = useState(todayIso);
  const q = useQuery({ queryKey: ["reports", "bs", to], queryFn: () => get<unknown>("/reports/balance-sheet", { to }), placeholderData: keepPreviousData });
  const cur = curOf(q.data);
  const cols = useAmountCols(cur);
  const { rows, assets, liabEq } = useMemo(() => {
    const sums: Record<string, bigint> = {};
    const out: Row[] = [];
    for (const s of ["assets", "liabilities", "equity"]) {
      const section = t(`reports.${s}`);
      const rs = rowsOf(field(q.data, s)).map((r) => ({ section, code: str(r["code"]), name: labelOf(r, locale), amount: moneyStr(r["amount"]) }));
      const sum = sumMinor(rs, "amount");
      sums[s] = BigInt(sum);
      out.push(...rs, { section, name: t("common.total"), amount: sum, _strong: true });
    }
    return { rows: q.data === undefined ? [] : out, assets: sums["assets"] ?? 0n, liabEq: (sums["liabilities"] ?? 0n) + (sums["equity"] ?? 0n) };
  }, [q.data, locale, t]);
  const balanced = field(q.data, "balanced") === true;
  return (
    <ReportView title={t("reports.tab.bs")} filename="balance-sheet" filters={<DateField label={t("common.to")} value={to} onChange={setTo} />} loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} columns={cols} rows={rows}>
      {q.data !== undefined && (
        <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
          <span>{t("reports.assets")}: <span className="num font-semibold">{fmtMinor(assets, cur, locale)}</span></span>
          <span>{t("reports.liabEquity")}: <span className="num font-semibold">{fmtMinor(liabEq, cur, locale)}</span></span>
          <Badge tone={balanced ? "green" : "red"}>{t(balanced ? "reports.balanced" : "reports.unbalanced")}</Badge>
        </div>
      )}
    </ReportView>
  );
}
