import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { useT } from "@/i18n";
import { Toaster } from "@/components/ui";
import { Icons, type IconName } from "@/components/icons";

/**
 * Navigation model.
 * Groups mirror how a pharmacy actually works (sell → stock → buy → money → admin), so the sidebar
 * reads as a workflow rather than an alphabetical dump. `perm` hides entries the user may not use.
 * `mobile` marks the five entries that earn a slot in the bottom bar; the rest live in the drawer.
 */
export interface NavItem { to: string; key: string; icon: IconName; perm?: string; mobile?: boolean }
export interface NavGroup { key: string; items: NavItem[] }
export const NAV_GROUPS: NavGroup[] = [
  { key: "nav.group.sell", items: [
    { to: "/", key: "nav.dashboard", icon: "dashboard", mobile: true },
    { to: "/pos", key: "nav.pos", icon: "pos", perm: "sales.create", mobile: true },
    { to: "/sales", key: "nav.sales", icon: "sales", perm: "sales.read" },
    { to: "/returns", key: "nav.returns", icon: "returns", perm: "returns.create" },
    { to: "/customers", key: "nav.customers", icon: "customers", perm: "customers.read" },
  ] },
  { key: "nav.group.stock", items: [
    { to: "/items", key: "nav.items", icon: "items", perm: "items.read", mobile: true },
    { to: "/inventory", key: "nav.inventory", icon: "inventory", perm: "stock.read" },
    { to: "/expiry", key: "nav.expiry", icon: "expiry", perm: "expiry.read" },
  ] },
  { key: "nav.group.buy", items: [
    { to: "/purchasing", key: "nav.purchasing", icon: "purchasing", perm: "purchase_orders.read" },
    { to: "/suppliers", key: "nav.suppliers", icon: "suppliers", perm: "suppliers.read" },
    { to: "/payables", key: "nav.payables", icon: "payables", perm: "supplier_invoices.read" },
  ] },
  { key: "nav.group.money", items: [
    { to: "/cash", key: "nav.cash", icon: "cash", perm: "shifts.read", mobile: true },
    { to: "/expenses", key: "nav.expenses", icon: "expenses", perm: "cash.expense" },
    { to: "/reports", key: "nav.reports", icon: "reports", perm: "reports.sales" },
    { to: "/accounting", key: "nav.accounting", icon: "accounting", perm: "journal.read" },
  ] },
  { key: "nav.group.admin", items: [
    { to: "/users", key: "nav.users", icon: "users", perm: "users.read" },
    { to: "/settings", key: "nav.settings", icon: "settings", perm: "settings.read" },
  ] },
];
/** Flat list kept for existing consumers/tests. */
export const NAV: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

const isActivePath = (pathname: string, to: string) => (to === "/" ? pathname === "/" : pathname === to || pathname.startsWith(to + "/"));

function Brand({ compact = false }: { compact?: boolean }) {
  const { t } = useT();
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-600 text-white shadow-sm"><Icons.pill className="h-5 w-5" /></span>
      {!compact && <div className="leading-tight"><div className="text-base font-extrabold text-ink-900">{t("app.name")}</div><div className="text-[11px] font-medium text-ink-500">{t("app.tagline")}</div></div>}
    </div>
  );
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useT();
  const { can } = useAuth();
  const { pathname } = useLocation();
  return (
    <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-3 scrollbar-thin" aria-label={t("nav.main")}>
      {NAV_GROUPS.map((g) => {
        const items = g.items.filter((n) => !n.perm || can(n.perm));
        if (items.length === 0) return null;
        return (
          <div key={g.key}>
            <div className="mb-1.5 px-3 text-[11px] font-bold uppercase tracking-wider text-ink-400">{t(g.key)}</div>
            <ul className="space-y-0.5">
              {items.map((n) => {
                const Icon = Icons[n.icon];
                const active = isActivePath(pathname, n.to);
                return (
                  <li key={n.to}>
                    <NavLink to={n.to} end={n.to === "/"} onClick={onNavigate} aria-current={active ? "page" : undefined}
                      className={`group flex min-h-[2.5rem] items-center gap-3 rounded-lg px-3 text-sm font-medium transition ${active ? "bg-brand-600 text-white shadow-sm" : "text-ink-700 hover:bg-ink-100 hover:text-ink-900"}`}>
                      <Icon className={`h-[18px] w-[18px] shrink-0 ${active ? "text-white" : "text-ink-400 group-hover:text-brand-600"}`} />
                      <span className="truncate">{t(n.key)}</span>
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

function UserBox({ onAfter }: { onAfter?: () => void }) {
  const { t, locale } = useT();
  const { me, logout, setLocale } = useAuth();
  const nav = useNavigate();
  const initials = (me?.displayName ?? "?").trim().slice(0, 1);
  return (
    <div className="border-t border-ink-200/80 p-3">
      <div className="flex items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-100 text-sm font-bold text-brand-800">{initials}</span>
        <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold text-ink-900">{me?.displayName}</div><div className="truncate text-xs text-ink-500">@{me?.username}</div></div>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button className="btn-ghost btn-sm justify-start" onClick={() => { setLocale(locale === "ar" ? "en" : "ar"); onAfter?.(); }}><Icons.globe className="h-4 w-4" />{t("nav.language")}</button>
        <button className="btn-ghost btn-sm justify-start text-rose-700 hover:bg-rose-50" onClick={() => { logout(); nav("/login"); }}><Icons.logout className="h-4 w-4" />{t("nav.logout")}</button>
      </div>
    </div>
  );
}

export default function Shell() {
  const { t, dir } = useT();
  const { can } = useAuth();
  const { pathname } = useLocation();
  const [drawer, setDrawer] = useState(false);

  // Close the drawer on navigation and lock body scroll while it is open.
  useEffect(() => { setDrawer(false); }, [pathname]);
  useEffect(() => {
    document.body.style.overflow = drawer ? "hidden" : "";
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") setDrawer(false); };
    window.addEventListener("keydown", h);
    return () => { document.body.style.overflow = ""; window.removeEventListener("keydown", h); };
  }, [drawer]);

  const current = NAV.find((n) => isActivePath(pathname, n.to));
  const mobileItems = NAV.filter((n) => n.mobile && (!n.perm || can(n.perm))).slice(0, 4);
  const isPos = pathname.startsWith("/pos");

  return (
    <div dir={dir} className="min-h-screen bg-ink-50" style={{ ["--slide-from" as string]: dir === "rtl" ? "100%" : "-100%" }}>
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 start-0 z-30 hidden w-[var(--sidebar-w)] flex-col border-e border-ink-200/80 bg-white lg:flex" aria-label={t("nav.main")}>
        <div className="flex h-[var(--topbar-h)] items-center px-4"><Brand /></div>
        <NavList />
        <UserBox />
      </aside>

      {/* Mobile / tablet drawer */}
      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label={t("nav.main")}>
          <div className="absolute inset-0 bg-ink-900/40 backdrop-blur-[2px]" onClick={() => setDrawer(false)} />
          <div className="absolute inset-y-0 start-0 flex w-[min(20rem,85vw)] animate-slide-in-start flex-col bg-white shadow-pop">
            <div className="flex h-[var(--topbar-h)] items-center justify-between px-4"><Brand /><button className="btn-icon btn-ghost" aria-label={t("common.close")} onClick={() => setDrawer(false)}><Icons.close className="h-5 w-5" /></button></div>
            <NavList onNavigate={() => setDrawer(false)} />
            <UserBox onAfter={() => setDrawer(false)} />
          </div>
        </div>
      )}

      {/* Top bar (all sizes; on desktop it becomes a slim context bar) */}
      <header data-topbar className="sticky top-0 z-20 flex h-[var(--topbar-h)] items-center gap-2 border-b border-ink-200/80 bg-white/90 px-3 backdrop-blur lg:ms-[var(--sidebar-w)] lg:px-6">
        <button className="btn-icon btn-ghost lg:hidden" aria-label={t("nav.menu")} aria-expanded={drawer} onClick={() => setDrawer(true)}><Icons.menu className="h-5 w-5" /></button>
        <div className="lg:hidden"><Brand compact /></div>
        <div className="min-w-0 flex-1 truncate ps-1 text-sm font-semibold text-ink-700 lg:text-base">{current ? t(current.key) : t("app.name")}</div>
        {!isPos && can("sales.create") && (
          <NavLink to="/pos" className="btn-primary btn-sm hidden sm:inline-flex"><Icons.pos className="h-4 w-4" />{t("nav.pos")}<span className="kbd ms-1 hidden md:inline-flex">F1</span></NavLink>
        )}
      </header>

      {/* Content */}
      <main className={`mx-auto w-full max-w-[1600px] px-3 py-4 sm:px-5 lg:ms-[var(--sidebar-w)] lg:w-auto lg:max-w-none lg:px-8 lg:py-6 ${isPos ? "pb-4" : "pb-nav lg:pb-6"}`}>
        <div className="animate-fade-in" key={pathname}><Outlet /></div>
      </main>

      {/* Bottom navigation (phones & small tablets). Hidden on POS to keep the pay button reachable. */}
      {!isPos && (
        <nav data-bottomnav className="fixed inset-x-0 bottom-0 z-20 grid border-t border-ink-200/80 bg-white/95 pb-safe-b backdrop-blur lg:hidden" style={{ gridTemplateColumns: `repeat(${mobileItems.length + 1}, minmax(0, 1fr))`, height: "calc(var(--bottomnav-h) + env(safe-area-inset-bottom))" }} aria-label={t("nav.main")}>
          {mobileItems.map((n) => {
            const Icon = Icons[n.icon];
            const active = isActivePath(pathname, n.to);
            return (
              <NavLink key={n.to} to={n.to} end={n.to === "/"} aria-current={active ? "page" : undefined} className={`flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold ${active ? "text-brand-700" : "text-ink-500"}`}>
                <span className={`grid h-7 w-12 place-items-center rounded-full transition ${active ? "bg-brand-100" : ""}`}><Icon className="h-5 w-5" /></span>
                <span className="truncate">{t(n.key)}</span>
              </NavLink>
            );
          })}
          <button onClick={() => setDrawer(true)} className="flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold text-ink-500" aria-label={t("nav.menu")}>
            <span className="grid h-7 w-12 place-items-center rounded-full"><Icons.more className="h-5 w-5" /></span>
            <span>{t("nav.more")}</span>
          </button>
        </nav>
      )}
      <Toaster />
    </div>
  );
}
