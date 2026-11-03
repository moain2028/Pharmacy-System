import { useQuery } from "@tanstack/react-query";
import { get } from "@/lib/api";
import { fmtMinor } from "@/lib/money";
import { useT } from "@/i18n";
import { ErrorBox, PageHeader, Spinner } from "@/components/ui";

interface Dash { today: { count: number; totalMinor: string; currency: string }; openShifts: number; expiringSoon: number; lowStock: number; cashOnHand: Array<{ currency: string; amountMinor: string }> }

export default function Dashboard() {
  const { t, locale } = useT();
  const q = useQuery({ queryKey: ["dashboard"], queryFn: () => get<Dash>("/reports/dashboard") });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;
  if (!d) return null;
  const Card = ({ title, value }: { title: string; value: string | number }) => <div className="card"><div className="text-xs text-slate-500">{title}</div><div className="num mt-1 text-2xl font-semibold">{value}</div></div>;
  return (
    <div>
      <PageHeader title={t("nav.dashboard")} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card title={t("report.sales")} value={fmtMinor(d.today?.totalMinor ?? "0", d.today?.currency ?? "YER_NEW", locale)} />
        <Card title={t("pos.invoice")} value={d.today?.count ?? 0} />
        <Card title={t("report.expiry")} value={d.expiringSoon ?? 0} />
        <Card title={t("shift.open")} value={d.openShifts ?? 0} />
      </div>
      <div className="card mt-4"><div className="mb-2 text-sm font-medium">{t("nav.cash")}</div>
        <table><tbody>{(d.cashOnHand ?? []).map((c) => <tr key={c.currency}><td>{c.currency}</td><td className="num">{fmtMinor(c.amountMinor, c.currency, locale)}</td></tr>)}</tbody></table></div>
    </div>
  );
}
