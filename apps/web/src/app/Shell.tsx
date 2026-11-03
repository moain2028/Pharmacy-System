import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { useT } from "@/i18n";
import { Toaster } from "@/components/ui";
import { Icons } from "@/components/icons";
import { NAV_SECTIONS, NAV_ITEMS, isActivePath, breadcrumbsFor } from "./nav";
import { useShortcuts, ShortcutSheet } from "./shortcuts";

export { NAV_ITEMS as NAV } from "./nav";

function Brand({ compact = false }: { compact?: boolean }) {
  const { t } = useT();
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-700 text-white shadow-sm"><Icons.pill className="h-5 w-5" /></span>
      {!compact && <div className="leading-tight"><div className="text-base font-bold text-ink-900">{t("app.name")}</div><div className="text-[11px] font-medium text-ink-500">{t("app.tagline")}</div></div>}
    </div>
  );
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useT();
  const { can } = useAuth();
  const { pathname, search } = useLocation();
  const currentTab = new URLSearchParams(search).get("tab");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [closed, setClosed] = useState<Record<string, boolean>>(() => { try { return JSON.parse(localStorage.getItem("pharmacore.nav.closed") ?? "{}") as Record<string, boolean>; } catch { return {}; } });
  const toggleSection = (key: string, active: boolean) => setClosed((c) => { const next: Record<string, boolean> = { ...c, [key]: active ? false : !(c[key] ?? false) }; localStorage.setItem("pharmacore.nav.closed", JSON.stringify(next)); return next; });
  return (
    <nav className="flex-1 space-y-2 overflow-y-auto px-3 py-3 scrollbar-thin" aria-label={t("nav.main")}>
      {NAV_SECTIONS.map((g) => {
        const items = g.items.filter((n) => !n.perm || can(n.perm));
        if (items.length === 0) return null;
        const hid = `nav-${g.key.replace(/\W/g, "-")}`;
        const sectionActive = items.some((n) => isActivePath(pathname, n.to));
        const sectionOpen = sectionActive || !(closed[g.key] ?? false);
        return (
          <div key={g.key}>
            {/* Section header = disclosure button: chevron rotates, whole group collapses. Active section cannot be collapsed (you never lose your place). */}
            <h2 className="mb-0.5">
              <button type="button" id={hid} aria-expanded={sectionOpen} aria-controls={`${hid}-list`} onClick={() => toggleSection(g.key, sectionActive)}
                className="flex min-h-[2.25rem] w-full items-center justify-between rounded-md px-3 text-[11px] font-semibold text-ink-500 hover:bg-ink-100 hover:text-ink-700">
                <span>{t(g.key)}</span>
                <Icons.chevron className={`h-3.5 w-3.5 transition-transform ${sectionOpen ? "rotate-90" : "rtl:rotate-180"}`} aria-hidden="true" />
              </button>
            </h2>
            {sectionOpen && <ul id={`${hid}-list`} aria-labelledby={hid} className="space-y-0.5">
              {items.map((n) => {
                const Icon = Icons[n.icon];
                const active = isActivePath(pathname, n.to);
                const kids = n.children ?? [];
                const hasKids = kids.length > 0;
                const expanded = hasKids && (open[n.to] ?? active);
                const firstTab = kids[0]?.tab;
                return (
                  <li key={n.to}>
                    <div className="flex items-stretch">
                      <NavLink to={n.to} end={n.to === "/"} onClick={onNavigate} aria-current={active ? "page" : undefined}
                        className={`group relative flex min-h-[2.75rem] min-w-0 flex-1 items-center gap-3 rounded-lg px-3 text-sm font-medium transition ${active ? "bg-brand-50 text-brand-800 before:absolute before:inset-y-2 before:start-0 before:w-[3px] before:rounded-e before:bg-brand-700" : "text-ink-700 hover:bg-ink-100 hover:text-ink-900"}`}>
                        <Icon className={`h-[18px] w-[18px] shrink-0 ${active ? "text-brand-700" : "text-ink-500 group-hover:text-brand-700"}`} />
                        <span className="truncate">{t(n.key)}</span>
                        {n.chord && <span className="kbd ms-auto hidden [@media(pointer:fine)]:inline-flex">g {n.chord.replace("Key", "").toLowerCase()}</span>}
                      </NavLink>
                      {hasKids && (
                        <button type="button" aria-expanded={expanded} aria-controls={`${hid}-${n.icon}`} aria-label={t(n.key)} onClick={() => setOpen((o) => ({ ...o, [n.to]: !expanded }))}
                          className="grid w-9 shrink-0 place-items-center rounded-lg text-ink-400 hover:bg-ink-100 hover:text-ink-700">
                          <Icons.chevron className={`h-4 w-4 transition-transform rtl:rotate-180 ${expanded ? "rotate-90 rtl:rotate-90" : ""}`} />
                        </button>
                      )}
                    </div>
                    {hasKids && expanded && (
                      <ul id={`${hid}-${n.icon}`} className="ms-[1.9rem] mt-0.5 space-y-0.5 border-s border-ink-200 ps-3">
                        {kids.map((c) => {
                          const subActive = active && (currentTab ?? firstTab) === c.tab;
                          return (
                            <li key={c.tab}>
                              <Link to={`${n.to}?tab=${c.tab}`} onClick={onNavigate} aria-current={subActive ? "page" : undefined}
                                className={`block min-h-[2.25rem] rounded-md px-2 py-1.5 text-[13px] leading-5 ${subActive ? "font-semibold text-brand-800" : "text-ink-600 hover:bg-ink-100 hover:text-ink-900"}`}>{t(c.key)}</Link>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>}
          </div>
        );
      })}
    </nav>
  );
}

function Breadcrumbs() {
  const { t } = useT();
  const { pathname, search } = useLocation();
  const crumbs = breadcrumbsFor(pathname, search);
  if (crumbs.length === 0) return null;
  return (
    <nav aria-label={t("nav.breadcrumb")} className="min-w-0 flex-1">
      <ol className="flex min-w-0 items-center gap-1 text-sm">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          const label = c.key ? t(c.key) : c.label ?? "";
          return (
            <li key={i} className={`flex min-w-0 items-center gap-1 ${i === 0 ? "hidden sm:flex" : ""}`}>
              {i > 0 && <Icons.chevron className="h-3.5 w-3.5 shrink-0 text-ink-300 rtl:rotate-180" aria-hidden="true" />}
              {last || !c.to ? <span className={`truncate ${last ? "font-semibold text-ink-900" : "text-ink-500"}`} aria-current={last ? "page" : undefined}>{label}</span>
                : <Link to={c.to} className="truncate text-ink-500 hover:text-brand-700">{label}</Link>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function UserBox({ onAfter }: { onAfter?: () => void }) {
  const { t } = useT();
  const { me, logout } = useAuth();
  const nav = useNavigate();
  const initials = (me?.displayName ?? "?").trim().slice(0, 1);
  return (
    <div className="border-t border-ink-200/80 p-3">
      <div className="flex items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-100 text-sm font-bold text-brand-800">{initials}</span>
        <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold text-ink-900">{me?.displayName}</div><div className="truncate text-xs text-ink-500">@{me?.username}</div></div>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <NavLink to="/settings" onClick={onAfter} className="btn-ghost btn-sm justify-start"><Icons.settings className="h-4 w-4" />{t("nav.settings")}</NavLink>
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

  const mobileItems = NAV_ITEMS.filter((n) => n.mobile && (!n.perm || can(n.perm))).slice(0, 4);
  const isPos = pathname.startsWith("/pos");
  const [sheet, setSheet] = useState(false);
  useShortcuts({ onHelp: () => setSheet((v) => !v), onMenu: () => setDrawer((v) => !v) });

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
        <div className="min-w-0 flex-1 ps-1"><Breadcrumbs /></div>
        <button type="button" className="btn-ghost btn-icon hidden [@media(pointer:fine)]:inline-flex" aria-label={t("nav.shortcuts")} title={`${t("nav.shortcuts")} (?)`} onClick={() => setSheet(true)}><span className="kbd text-xs">?</span></button>
        {!isPos && can("sales.create") && (
          <NavLink to="/pos" className="btn-primary btn-sm hidden sm:inline-flex"><Icons.pos className="h-4 w-4" />{t("nav.pos")}<span className="kbd ms-1 hidden [@media(pointer:fine)]:inline-flex">F2</span></NavLink>
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
      <ShortcutSheet open={sheet} onClose={() => setSheet(false)} />
      <Toaster />
    </div>
  );
}
