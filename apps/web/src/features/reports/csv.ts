import { MINOR_UNITS } from "@/lib/money";

export type Row = Record<string, unknown>;
export interface CsvColumn { key: string; title: string; money?: boolean | undefined; currency?: string | undefined; currencyKey?: string | undefined }

export const BOM = "\uFEFF";
export const INT_RE = /^-?\d+$/;

export const isObj = (v: unknown): v is Row => typeof v === "object" && v !== null && !Array.isArray(v);
export const str = (v: unknown): string => (v === undefined || v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));

/** Normalises "123" | 123 | { amountMinor: "123" } into a minor-unit string ("0" when not money). */
export function moneyStr(v: unknown): string {
  if ((typeof v === "string" || typeof v === "number" || typeof v === "bigint") && INT_RE.test(String(v))) return String(v);
  if (isObj(v)) { const a = v["amountMinor"]; if (typeof a === "string" && INT_RE.test(a)) return a; }
  return "0";
}

export function rowCurrency(row: Row, col: CsvColumn): string {
  const c = col.currencyKey ? row[col.currencyKey] : undefined;
  return typeof c === "string" && c !== "" ? c : col.currency ?? "YER_NEW";
}

export function cellMoney(row: Row, col: CsvColumn): { minor: string; currency: string } | null {
  const v = row[col.key];
  if (v === undefined || v === null || v === "") return null;
  const c = isObj(v) ? v["currency"] : undefined;
  return { minor: moneyStr(v), currency: typeof c === "string" ? c : rowCurrency(row, col) };
}

/** Plain decimal without grouping (spreadsheet-friendly): "150000" -> "1500.00". */
export function minorToDecimal(minor: string, currency: string): string {
  const d = MINOR_UNITS[currency] ?? 2;
  if (d === 0) return minor;
  const neg = minor.startsWith("-");
  const s = (neg ? minor.slice(1) : minor).padStart(d + 1, "0");
  return `${neg ? "-" : ""}${s.slice(0, s.length - d)}.${s.slice(s.length - d)}`;
}

export function csvCell(row: Row, col: CsvColumn): string {
  if (col.money) { const m = cellMoney(row, col); return m ? minorToDecimal(m.minor, m.currency) : ""; }
  return str(row[col.key]);
}

/** RFC 4180 quoting + neutralise spreadsheet formula injection. */
export function escapeCsv(raw: string): string {
  const s = /^[=+@]/.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Row[], columns: CsvColumn[], totals?: Row | undefined): string {
  const line = (cells: string[]) => cells.map(escapeCsv).join(",");
  const out = [line(columns.map((c) => c.title)), ...rows.map((r) => line(columns.map((c) => csvCell(r, c))))];
  if (totals) out.push(line(columns.map((c) => csvCell(totals, c))));
  return BOM + out.join("\r\n");
}

export function downloadCsv(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
