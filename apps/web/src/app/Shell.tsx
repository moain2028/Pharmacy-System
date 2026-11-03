import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { useT } from "@/i18n";
import { Toaster } from "@/components/ui";

export interface NavItem { to: string; key: string; perm?: string }
export const NAV: NavItem[] = [
  { to: "/", key: "nav.dashboard" },
  { to: "/pos", key: "nav.pos", perm: "sales.create" },
  { to: "/sales", key: "nav.sales", perm: "sales.read" },
  { to: "/returns", key: "nav.returns", perm: "returns.create" },
  { to: "/customers", key: "nav.customers", perm: "customers.read" },
  { to: "/items", key: "nav.items", perm: "items.read" },
  { to: "/inventory", key: "nav.inventory", perm: "stock.read" },
  { to: "/expiry", key: "nav.expiry", perm: "expiry.read" },
  { to: "/purchasing", key: "nav.purchasing", perm: "purchase_orders.read" },
  { to: "/suppliers", key: "nav.suppliers", perm: "suppliers.read" },
  { to: "/payables", key: "nav.payables", perm: "supplier_invoices.read" },
  { to: "/cash", key: "nav.cash", perm: "shifts.read" },
  { to: "/expenses", key: "nav.expenses", perm: "cash.expense" },
  { to: "/reports", key: "nav.reports", perm: "reports.sales" },
  { to: "/accounting", key: "nav.accounting", perm: "journal.read" },
  { to: "/users", key: "nav.users", perm: "users.read" },
  { to: "/settings", key: "nav.settings", perm: "settings.read" },
];

export default function Shell() {
  const { t, dir, locale } = useT();
  const { me, can, logout, setLocale } = useAuth();
  const nav = useNavigate();
  return (
    <div dir={dir} className="flex min-h-screen">
      <aside className="hidden w-56 shrink-0 flex-col border-e border-slate-200 bg-white md:flex">
        <div className="px-4 py-4 text-xl font-bold text-brand-700">{t("app.name")}</div>
        <nav className="flex-1 overflow-y-auto px-2" aria-label="main">
          {NAV.filter((n) => !n.perm || can(n.perm)).map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === "/"} className={({ isActive }) => `block rounded-md px-3 py-2 text-sm ${isActive ? "bg-brand-50 font-semibold text-brand-700" : "text-slate-700 hover:bg-slate-50"}`}>{t(n.key)}</NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-200 p-3 text-xs text-slate-600">
          <div className="truncate font-medium text-slate-800">{me?.displayName}</div>
          <div className="mt-2 flex gap-2">
            <button className="underline" onClick={() => setLocale(locale === "ar" ? "en" : "ar")}>{t("nav.language")}</button>
            <button className="underline" onClick={() => { logout(); nav("/login"); }}>{t("nav.logout")}</button>
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-4 md:p-6"><Outlet /></main>
      <Toaster />
    </div>
  );
}
