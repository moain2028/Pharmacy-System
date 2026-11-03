import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { get } from "@/lib/api";
import { fmtMinor, CURRENCY_LABEL } from "@/lib/money";
import { useAuth } from "@/lib/auth";
import { useT } from "@/i18n";
import { ErrorBox } from "@/components/ui";
import { Icons, type IconName } from "@/components/icons";

/** Exact shape of GET /reports/dashboard. */
interface Dash {
  currency: string; date: string | null;
  todaySales: Array<{ currency: string; count: number; totalMinor: string }>;
  openShifts: number; lowStockItems: number;
  expiringWithin90Days: { lots: number; qtySsu: string };
  cashOnHand: Array<{ currency: string; amountMinor: string }>;
}

/** Amount in large tabular digits with the currency as a small suffix — never truncates. */
function Money({ minor, currency, locale, negativeTone = true }: { minor: string; currency: string; locale: "ar" | "en"; negativeTone?: boolean }) {
  const amount = fmtMinor(minor, currency, locale, false);
  const neg = BigInt(minor) < 0n;
  return <span className={`inline-flex items-baseline gap-1 ${neg && negativeTone ? "text-rose-700" : ""}`}><span className="num">{amount}</span><span className="text-xs font-semibold text-ink-500">{CURRENCY_LABEL[currency]?.[locale] ?? currency}</span></span>;
}

function Stat({ icon, label, value, sub, tone = "brand", to }: { icon: IconName; label: string; value: ReactNode; sub?: ReactNode; tone?: "brand" | "amber" | "rose" | "ink"; to?: string }) {
  const Icon = Icons[icon];
  const ring = { brand: "bg-brand-50 text-brand-700", amber: "bg-amber-50 text-amber-700", rose: "bg-rose-50 text-rose-700", ink: "bg-ink-100 text-ink-700" }[tone];
  const body = (
    <div className="card flex h-full items-start gap-3 transition hover:shadow-pop">
      <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${ring}`}><Icon className="h-5 w-5" /></span>
      <div className="min-w-0 flex-1">
        <div className="line-clamp-2 text-xs font-semibold leading-snug text-ink-500">{label}</div>
        <div className="stat-value mt-1">{value}</div>
        {sub && <div className="mt-1 line-clamp-2 text-xs leading-snug text-ink-500">{sub}</div>}
      </div>
      {to && <Icons.chevron className="mt-1 h-4 w-4 shrink-0 text-ink-300 rtl:rotate-180" />}
    </div>
  );
  return to ? <Link to={to} className="block rounded-xl">{body}</Link> : body;
}

function Skeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <div className="skeleton h-8 w-48" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-24" />)}</div>
      <div className="grid gap-3 lg:grid-cols-3"><div className="skeleton h-56 lg:col-span-2" /><div className="skeleton h-56" /></div>
    </div>
  );
}

export default function Dashboard() {
  const { t, locale } = useT();
  const { me, can } = useAuth();
  const q = useQuery({ queryKey: ["dashboard"], queryFn: () => get<Dash>("/reports/dashboard"), refetchInterval: 60_000 });
  if (q.isLoading) return <Skeleton />;
  if (q.error) return <ErrorBox error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;
  if (!d) return null;

  const base = d.currency;
  const baseSales = d.todaySales.find((s) => s.currency === base);
  const otherSales = d.todaySales.filter((s) => s.currency !== base);
  const invoiceCount = d.todaySales.reduce((a, s) => a + s.count, 0);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? t("dash.morning") : hour < 17 ? t("dash.afternoon") : t("dash.evening");
  const dateLabel = new Date().toLocaleDateString(locale === "ar" ? "ar-YE" : "en-GB", { weekday: "long", day: "numeric", month: "long" });

  const quick: Array<{ to: string; key: string; icon: IconName; perm: string }> = [
    { to: "/pos", key: "nav.pos", icon: "pos", perm: "sales.create" },
    { to: "/purchasing", key: "dash.receiveGoods", icon: "purchasing", perm: "goods_receipts.create" },
    { to: "/items", key: "dash.newItem", icon: "items", perm: "items.create" },
    { to: "/expenses", key: "dash.recordExpense", icon: "expenses", perm: "cash.expense" },
    { to: "/reports", key: "nav.reports", icon: "reports", perm: "reports.sales" },
    { to: "/expiry", key: "nav.expiry", icon: "expiry", perm: "expiry.read" },
  ];

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-sm text-ink-500">{dateLabel}</div>
          <h1 className="text-2xl sm:text-3xl">{greeting}{me?.displayName ? `، ${me.displayName.split(" ")[0]}` : ""}</h1>
        </div>
        <button className="btn-secondary btn-sm" onClick={() => void q.refetch()} disabled={q.isFetching}><Icons.refresh className={`h-4 w-4 ${q.isFetching ? "animate-spin" : ""}`} />{t("common.retry")}</button>
      </header>

      {/* Alerts first: the thing a pharmacist must not miss. */}
      {(d.openShifts === 0 && can("shifts.open")) && (
        <Link to="/pos" className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 hover:bg-amber-100">
          <Icons.alert className="h-5 w-5 shrink-0 text-amber-600" /><span className="flex-1">{t("dash.noShiftHint")}</span><Icons.chevron className="h-4 w-4 rtl:rotate-180" />
        </Link>
      )}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label={t("dash.kpis")}>
        <Stat icon="sales" label={t("dash.salesToday")} value={<Money minor={baseSales?.totalMinor ?? "0"} currency={base} locale={locale} />}
          sub={otherSales.length ? otherSales.map((s) => fmtMinor(s.totalMinor, s.currency, locale)).join(" · ") : `${invoiceCount} ${t("dash.invoices")}`} to="/sales" />
        <Stat icon="cash" label={t("dash.cashOnHand")} tone="ink"
          value={<Money minor={d.cashOnHand.find((c) => c.currency === base)?.amountMinor ?? "0"} currency={base} locale={locale} />}
          sub={d.openShifts > 0 ? `${d.openShifts} ${t("dash.openShifts")}` : t("shift.none")} to="/cash" />
        <Stat icon="expiry" label={t("dash.expiring90")} tone={d.expiringWithin90Days.lots > 0 ? "amber" : "brand"}
          value={d.expiringWithin90Days.lots} sub={`${d.expiringWithin90Days.qtySsu} ${t("dash.units")}`} to="/expiry" />
        <Stat icon="inventory" label={t("dash.lowStock")} tone={d.lowStockItems > 0 ? "rose" : "brand"} value={d.lowStockItems} sub={t("dash.belowReorder")} to="/inventory" />
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="card lg:col-span-2" aria-label={t("dash.quickActions")}>
          <h2 className="mb-3 text-base">{t("dash.quickActions")}</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {quick.filter((a) => can(a.perm)).map((a) => { const Icon = Icons[a.icon]; return (
              <Link key={a.to + a.key} to={a.to} className="group flex items-center gap-3 rounded-lg border border-ink-200/80 px-3 py-3 text-sm font-semibold text-ink-800 transition hover:border-brand-300 hover:bg-brand-50">
                <span className="grid h-9 w-9 place-items-center rounded-lg bg-ink-100 text-ink-600 transition group-hover:bg-brand-600 group-hover:text-white"><Icon className="h-4 w-4" /></span>
                <span className="truncate">{t(a.key)}</span>
              </Link>
            ); })}
          </div>
        </section>

        <section className="card" aria-label={t("dash.cashByCurrency")}>
          <h2 className="mb-3 text-base">{t("dash.cashByCurrency")}</h2>
          {d.cashOnHand.length === 0 ? <div className="py-6 text-center text-sm text-ink-500">{t("common.noData")}</div> : (
            <ul className="divide-y divide-ink-100">
              {d.cashOnHand.map((c) => (
                <li key={c.currency} className="flex items-center justify-between py-2.5 text-sm">
                  <span className="font-medium text-ink-700">{CURRENCY_LABEL[c.currency]?.[locale] ?? c.currency}</span>
                  <span className={`num font-bold ${BigInt(c.amountMinor) < 0n ? "text-rose-700" : "text-ink-900"}`}>{fmtMinor(c.amountMinor, c.currency, locale)}</span>
                </li>
              ))}
            </ul>
          )}
          {d.todaySales.length > 0 && (
            <>
              <h3 className="mb-2 mt-5 text-xs font-bold uppercase tracking-wide text-ink-400">{t("dash.salesByCurrency")}</h3>
              <ul className="divide-y divide-ink-100">
                {d.todaySales.map((s) => (
                  <li key={s.currency} className="flex items-center justify-between py-2 text-sm">
                    <span className="text-ink-700">{CURRENCY_LABEL[s.currency]?.[locale] ?? s.currency} <span className="num text-xs text-ink-400">×{s.count}</span></span>
                    <span className="num font-semibold">{fmtMinor(s.totalMinor, s.currency, locale)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
