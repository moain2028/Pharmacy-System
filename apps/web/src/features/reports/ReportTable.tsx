import type { ReactNode } from "react";
import { fmtMinor } from "@/lib/money";
import type { Locale } from "@/lib/auth";
import { useT } from "@/i18n";
import { Empty } from "@/components/ui";
import { cellMoney, str, type CsvColumn, type Row } from "./csv";

export interface Column extends CsvColumn { num?: boolean | undefined; render?: ((row: Row) => ReactNode) | undefined }

function plain(row: Row, col: Column, locale: Locale): string {
  if (col.money) { const m = cellMoney(row, col); return m ? fmtMinor(m.minor, m.currency, locale) : ""; }
  return str(row[col.key]);
}
const cls = (c: Column) => (c.money || c.num ? "num text-end whitespace-nowrap" : undefined);

export function ReportTable({ columns, rows, totals }: { columns: Column[]; rows: Row[]; totals?: Row | undefined }) {
  const { t, locale } = useT();
  if (rows.length === 0) return <Empty />;
  return (
    <div className="table-wrap">
      <table className="w-full">
        <thead><tr>{columns.map((c) => <th key={c.key} scope="col" className={cls(c)}>{c.title}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={r["_strong"] === true ? "font-semibold" : undefined}>
              {columns.map((c) => <td key={c.key} className={cls(c)}>{c.render ? c.render(r) : plain(r, c, locale)}</td>)}
            </tr>
          ))}
        </tbody>
        {totals && (
          <tfoot>
            <tr className="font-semibold" data-testid="totals-row">
              {columns.map((c, i) => { const v = plain(totals, c, locale); return <td key={c.key} className={cls(c)}>{v || (i === 0 ? t("common.total") : "")}</td>; })}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
