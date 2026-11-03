import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { useT } from "@/i18n";
import { Modal } from "@/components/ui";
import { NAV_ITEMS } from "./nav";

/**
 * Global keyboard shortcuts.
 * - Matched on `e.code` so they work with an Arabic layout active.
 * - Single-key shortcuts are ignored while typing (WCAG 2.1.4) and when a modifier is held.
 * - `g` then <chord> navigates (Gmail/GitHub convention); `?` opens the sheet; `F2` focuses POS; `Alt+M` toggles the menu.
 */
const typing = (el: Element | null) => !!el && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el as HTMLElement).isContentEditable);

export function useShortcuts({ onHelp, onMenu }: { onHelp: () => void; onMenu: () => void }) {
  const nav = useNavigate();
  const { can } = useAuth();
  const pending = useRef<number>(0);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.code === "F2" && !e.ctrlKey && !e.altKey && !e.metaKey) { if (can("sales.create") && !location.pathname.startsWith("/pos")) { e.preventDefault(); nav("/pos"); } return; }
      if (e.altKey && e.code === "KeyM" && !e.ctrlKey) { e.preventDefault(); onMenu(); return; }
      if (typing(document.activeElement) || e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.key === "?" || (e.shiftKey && e.code === "Slash")) { e.preventDefault(); onHelp(); return; }
      const now = Date.now();
      if (e.code === "KeyG" && !e.shiftKey) { pending.current = now; return; }
      if (pending.current && now - pending.current < 1500) {
        const item = NAV_ITEMS.find((n) => n.chord === e.code && (!n.perm || can(n.perm)));
        pending.current = 0;
        if (item) { e.preventDefault(); nav(item.to); }
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [nav, can, onHelp, onMenu]);
}

export function ShortcutSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useT();
  const { can } = useAuth();
  const rows: Array<[string, string]> = [
    ["F2", t("nav.pos")], ["Alt + M", t("nav.menu")], ["?", t("nav.shortcuts")], ["Esc", t("common.close")],
    ...NAV_ITEMS.flatMap((n): Array<[string, string]> => (n.chord && (!n.perm || can(n.perm)) ? [[`g ${n.chord.replace("Key", "").toLowerCase()}`, t(n.key)]] : [])),
  ];
  const pos: Array<[string, string]> = [["F2", t("common.search")], ["F4", t("pos.hold")], ["F9", t("pos.pay")], ["Enter", t("pos.confirmPay")], ["Esc", t("common.close")]];
  return (
    <Modal open={open} onClose={onClose} title={t("nav.shortcuts")}>
      <div className="grid gap-6 sm:grid-cols-2">
        <section><h3 className="mb-2 text-sm font-semibold text-ink-700">{t("nav.main")}</h3><ul className="divide-y divide-ink-100 text-sm">{rows.map(([k, v]) => <li key={k + v} className="flex items-center justify-between py-1.5"><span>{v}</span><span className="kbd">{k}</span></li>)}</ul></section>
        <section><h3 className="mb-2 text-sm font-semibold text-ink-700">{t("nav.pos")}</h3><ul className="divide-y divide-ink-100 text-sm">{pos.map(([k, v]) => <li key={k + v} className="flex items-center justify-between py-1.5"><span>{v}</span><span className="kbd">{k}</span></li>)}</ul></section>
      </div>
    </Modal>
  );
}
