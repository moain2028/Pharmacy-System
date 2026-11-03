import { useMemo } from "react";
import { fmtMinor } from "@/lib/money";
import { Badge, Empty, ErrorBox, Spinner } from "@/components/ui";
import { useAT, useTb, type TbRow } from "./util";

const ORDER = ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"];

export function CoaTab() {
  const { t, locale } = useAT();
  const q = useTb();
  const groups = useMemo(() => {
    const m = new Map<string, TbRow[]>();
    for (const r of q.data?.rows ?? []) { const a = m.get(r.type); if (a) a.push(r); else m.set(r.type, [r]); }
    const rank = (k: string) => { const i = ORDER.indexOf(k); return i < 0 ? 99 : i; };
    return [...m.entries()].sort((a, b) => rank(a[0]) - rank(b[0])).map(([k, rows]) => [k, [...rows].sort((x, y) => x.code.localeCompare(y.code))] as const);
  }, [q.data]);
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;
  if (!d || d.rows.length === 0) return <Empty />;
  const cur = d.currency;
  return (
    <div className="card">
      <div className="mb-2 flex justify-end">{d.totals.balanced ? <Badge tone="green">{t("acc.tbBalanced")}</Badge> : <Badge tone="red">{t("acc.tbUnbalanced")}</Badge>}</div>
      <table>
        <thead><tr><th>{t("acc.code")}</th><th>{t("acc.name")}</th><th>{t("acc.debit")}</th><th>{t("acc.credit")}</th><th>{t("acc.balance")}</th></tr></thead>
        {groups.map(([type, rows]) => (
          <tbody key={type}>
            <tr><th colSpan={5} className="bg-slate-50 text-start">{t(`acc.type.${type}`)}</th></tr>
            {rows.map((r) => (
              <tr key={r.code}>
                <td className="num">{r.code}</td><td>{locale === "ar" ? r.name_ar : r.name_en}</td>
                <td className="num">{fmtMinor(r.debit, cur, locale, false)}</td><td className="num">{fmtMinor(r.credit, cur, locale, false)}</td><td className="num">{fmtMinor(r.balance, cur, locale, false)}</td>
              </tr>
            ))}
          </tbody>
        ))}
        <tfoot><tr className="font-semibold"><td colSpan={2}>{t("common.total")}</td><td className="num">{fmtMinor(d.totals.debit, cur, locale)}</td><td className="num">{fmtMinor(d.totals.credit, cur, locale)}</td><td /></tr></tfoot>
      </table>
    </div>
  );
}
