import type { ReactNode } from "react";
import { useT } from "@/i18n";
import { ErrorBox, Spinner } from "@/components/ui";
import { ReportTable, type Column } from "./ReportTable";
import { downloadCsv, toCsv, type Row } from "./csv";
import { todayIso } from "./util";

interface Props {
  title: string; filename: string; filters?: ReactNode | undefined; loading: boolean; error: unknown; onRetry: () => void;
  columns: Column[]; rows: Row[]; totals?: Row | undefined; children?: ReactNode | undefined;
}

export function ReportView({ title, filename, filters, loading, error, onRetry, columns, rows, totals, children }: Props) {
  const { t } = useT();
  const exportCsv = () => {
    const first = columns[0];
    const label = first && totals && (totals[first.key] === undefined || totals[first.key] === null) ? { ...totals, [first.key]: t("common.total") } : totals;
    downloadCsv(`${filename}-${todayIso()}.csv`, toCsv(rows, columns, label));
  };
  return (
    <section className="card mb-4" aria-label={title}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{title}</h2>
        <div className="no-print flex gap-2">
          <button type="button" className="btn-secondary" onClick={() => window.print()}>{t("common.print")}</button>
          <button type="button" className="btn-secondary" onClick={exportCsv} disabled={rows.length === 0}>{t("reports.exportCsv")}</button>
        </div>
      </div>
      {filters && <div className="no-print mb-3 flex flex-wrap items-end gap-3">{filters}</div>}
      {loading ? <Spinner /> : error ? <ErrorBox error={error} onRetry={onRetry} /> : <ReportTable columns={columns} rows={rows} totals={totals} />}
      {children}
    </section>
  );
}
