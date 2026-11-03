import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { get } from "@/lib/api";
import { useT } from "@/i18n";
import { Field } from "@/components/ui";
import { ReportView } from "./ReportView";
import type { Column } from "./ReportTable";
import { moneyStr, str } from "./csv";
import { curOf, DateField, fmtDateTime, labelOf, pick, rowsOf, sameCurrencyTotals, todayIso, totalsOf, useRange } from "./util";

const AGING = ["current", "b1", "b2", "b3", "over", "total"];

function AgingReport({ kind }: { kind: "customer" | "supplier" }) {
  const { t } = useT();
  const [asOf, setAsOf] = useState(todayIso);
  const q = useQuery({ queryKey: ["reports", `${kind}-aging`, asOf], queryFn: () => get<unknown>(`/reports/${kind}-aging`, { asOf }), placeholderData: keepPreviousData });
  const cur = curOf(q.data);
  const rows = useMemo(() => rowsOf(q.data).map((r) => ({ ...r, name: str(pick(r, "name", "party_name", "partyName")) })), [q.data]);
  const totals = useMemo(() => totalsOf(q.data, rows, AGING), [q.data, rows]);
  const cols: Column[] = [{ key: "name", title: t("reports.col.party") }, ...AGING.map((k): Column => ({ key: k, title: t(`reports.col.${k}`), money: true, currency: cur }))];
  return <ReportView title={t(kind === "customer" ? "reports.tab.custAging" : "reports.tab.suppAging")} filename={`${kind}-aging`} filters={<DateField label={t("reports.asOf")} value={asOf} onChange={setAsOf} />} loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} columns={cols} rows={rows} totals={totals} />;
}
export function CustomerAgingReport() { return <AgingReport kind="customer" />; }
export function SupplierAgingReport() { return <AgingReport kind="supplier" />; }

export function CashbookReport() {
  const { t, locale } = useT();
  const { from, to, fields } = useRange();
  const [cashboxId, setCashboxId] = useState("");
  const boxes = useQuery({ queryKey: ["cashboxes"], queryFn: () => get<unknown>("/cashboxes"), staleTime: 300_000 });
  const q = useQuery({ queryKey: ["reports", "cashbook", cashboxId, from, to], queryFn: () => get<unknown>("/reports/cashbook", { cashboxId, from, to }), enabled: cashboxId !== "", placeholderData: keepPreviousData });
  const rows = useMemo(() => (cashboxId === "" ? [] : rowsOf(q.data).map((r) => ({
    occurredAt: fmtDateTime(pick(r, "occurredAt", "occurred_at")), kind: str(pick(r, "kind")), documentType: str(pick(r, "documentType", "document_type")),
    reason: str(pick(r, "reason")), currency: str(pick(r, "currency")), amountMinor: moneyStr(pick(r, "amountMinor", "amount_minor")),
    runningBalanceMinor: moneyStr(pick(r, "runningBalanceMinor", "running_balance_minor")),
  }))), [q.data, cashboxId]);
  const totals = useMemo(() => sameCurrencyTotals(rows, ["amountMinor"]), [rows]);
  const cols: Column[] = [
    { key: "occurredAt", title: t("reports.col.occurredAt"), num: true }, { key: "kind", title: t("reports.col.kind") },
    { key: "documentType", title: t("reports.col.docType") }, { key: "reason", title: t("reports.col.reason") },
    { key: "amountMinor", title: t("reports.col.amount"), money: true, currencyKey: "currency" },
    { key: "runningBalanceMinor", title: t("reports.col.runningBalance"), money: true, currencyKey: "currency" },
  ];
  const filters = (
    <>
      <Field label={t("reports.cashbox")}>
        <select className="input" value={cashboxId} onChange={(e) => setCashboxId(e.target.value)} autoFocus>
          <option value="">—</option>
          {rowsOf(boxes.data).map((b) => <option key={str(b["id"])} value={str(b["id"])}>{labelOf(b, locale) || str(b["code"])}</option>)}
        </select>
      </Field>
      {fields}
    </>
  );
  return (
    <ReportView period={`${from} → ${to}`} title={t("reports.tab.cashbook")} filename="cashbook" filters={filters} loading={q.isLoading} error={q.error ?? boxes.error} onRetry={() => { void boxes.refetch(); if (cashboxId) void q.refetch(); }} columns={cols} rows={rows} totals={totals}>
      {cashboxId === "" && <p className="mt-2 text-sm text-ink-500">{t("reports.selectCashbox")}</p>}
    </ReportView>
  );
}

export function AuditReport() {
  const { t } = useT();
  const { from, to, fields } = useRange();
  const q = useQuery({ queryKey: ["reports", "audit", from, to], queryFn: () => get<unknown>("/reports/audit", { from, to, limit: 200 }), placeholderData: keepPreviousData });
  const rows = useMemo(() => rowsOf(q.data).map((r) => ({
    occurredAt: fmtDateTime(pick(r, "occurredAt", "occurred_at", "created_at", "at")), actor: str(pick(r, "username", "actor", "user_name", "userId", "user_id")),
    action: str(pick(r, "action", "event")), entity: `${str(pick(r, "entityType", "entity_type"))} ${str(pick(r, "entityId", "entity_id"))}`.trim(),
    details: str(pick(r, "details", "payload", "diff")).slice(0, 160),
  })), [q.data]);
  const cols: Column[] = ["occurredAt", "actor", "action", "entity", "details"].map((k) => ({ key: k, title: t(`reports.col.${k}`), num: k === "occurredAt" }));
  return <ReportView period={`${from} → ${to}`} title={t("reports.tab.audit")} filename="audit" filters={fields} loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} columns={cols} rows={rows} />;
}
