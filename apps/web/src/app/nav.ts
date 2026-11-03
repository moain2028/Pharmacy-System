import type { IconName } from "@/components/icons";

/**
 * Navigation information architecture — the single source of truth for sidebar, drawer, bottom bar,
 * breadcrumbs and `g`-chord shortcuts.
 *
 * Two levels max (NN/g, Carbon UI Shell): section → item → sub-item. Sub-items are URL-addressable
 * (`/inventory?tab=adjust`), so deep links, back/forward and breadcrumbs all work without extra state.
 * `perm` hides what the user may not use (server still enforces). `mobile` marks bottom-bar slots.
 * `chord` is the key pressed after `g` (matched on `e.code`, so it works with an Arabic layout).
 */
export interface NavSub { tab: string; key: string }
export interface NavItem { to: string; key: string; icon: IconName; perm?: string; mobile?: boolean; chord?: string; children?: NavSub[] }
export interface NavSection { key: string; items: NavItem[] }

export const NAV_SECTIONS: NavSection[] = [
  { key: "nav.group.overview", items: [
    { to: "/", key: "nav.dashboard", icon: "dashboard", mobile: true, chord: "KeyD" },
  ] },
  { key: "nav.group.sell", items: [
    { to: "/pos", key: "nav.pos", icon: "pos", perm: "sales.create", mobile: true },
    { to: "/sales", key: "nav.sales", icon: "sales", perm: "sales.read", chord: "KeyS" },
    { to: "/returns", key: "nav.returns", icon: "returns", perm: "returns.create", chord: "KeyR" },
    { to: "/customers", key: "nav.customers", icon: "customers", perm: "customers.read", chord: "KeyC" },
  ] },
  { key: "nav.group.stock", items: [
    { to: "/items", key: "nav.items", icon: "items", perm: "items.read", mobile: true, chord: "KeyI" },
    { to: "/inventory", key: "nav.inventory", icon: "inventory", perm: "stock.read", chord: "KeyK", children: [
      { tab: "receive", key: "inv.tab.receive" }, { tab: "adjust", key: "inv.tab.adjust" }, { tab: "transfer", key: "inv.tab.transfer" }, { tab: "status", key: "inv.tab.status" },
    ] },
    { to: "/expiry", key: "nav.expiry", icon: "expiry", perm: "expiry.read", chord: "KeyE" },
  ] },
  { key: "nav.group.buy", items: [
    { to: "/purchasing", key: "nav.purchasing", icon: "purchasing", perm: "purchase_orders.read", chord: "KeyO", children: [
      { tab: "orders", key: "purchasing.orders" }, { tab: "receipts", key: "purchasing.receipts" },
    ] },
    { to: "/suppliers", key: "nav.suppliers", icon: "suppliers", perm: "suppliers.read", chord: "KeyU" },
    { to: "/payables", key: "nav.payables", icon: "payables", perm: "supplier_invoices.read" },
  ] },
  { key: "nav.group.money", items: [
    { to: "/cash", key: "nav.cash", icon: "cash", perm: "shifts.read", mobile: true, chord: "KeyH" },
    { to: "/expenses", key: "nav.expenses", icon: "expenses", perm: "cash.expense" },
    { to: "/accounting", key: "nav.accounting", icon: "accounting", perm: "journal.read", children: [
      { tab: "coa", key: "acc.tab.coa" }, { tab: "opening", key: "acc.tab.opening" }, { tab: "rates", key: "acc.tab.rates" },
    ] },
  ] },
  { key: "nav.group.reports", items: [
    { to: "/reports", key: "nav.reports", icon: "reports", perm: "reports.sales", chord: "KeyP" },
  ] },
  { key: "nav.group.admin", items: [
    { to: "/users", key: "nav.users", icon: "users", perm: "users.read", children: [
      { tab: "users", key: "users.tab.users" }, { tab: "roles", key: "users.tab.roles" },
    ] },
    { to: "/settings", key: "nav.settings", icon: "settings", perm: "settings.read", chord: "Comma" },
  ] },
];

export const NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((s) => s.items);

export const isActivePath = (pathname: string, to: string) => (to === "/" ? pathname === "/" : pathname === to || pathname.startsWith(to + "/"));

/** Resolve the current location into breadcrumb segments: section → item → (sub-item | detail). */
export function breadcrumbsFor(pathname: string, search: string): Array<{ key?: string; label?: string; to?: string }> {
  for (const s of NAV_SECTIONS) {
    for (const it of s.items) {
      if (!isActivePath(pathname, it.to)) continue;
      const crumbs: Array<{ key?: string; label?: string; to?: string }> = [{ key: s.key }, { key: it.key, to: it.to }];
      const tab = new URLSearchParams(search).get("tab");
      const sub = it.children?.find((c) => c.tab === tab);
      if (sub) crumbs.push({ key: sub.key });
      else if (pathname !== it.to && pathname.startsWith(it.to + "/")) crumbs.push({ label: decodeURIComponent(pathname.slice(it.to.length + 1)).split("/")[0] ?? "" });
      return crumbs;
    }
  }
  return [];
}
