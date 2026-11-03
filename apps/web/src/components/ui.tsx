import { type ReactNode, useEffect, useId, useRef } from "react";
import { ApiError } from "@/lib/api";
import { useT } from "@/i18n";

export function Spinner({ label }: { label?: string }) {
  const { t } = useT();
  return <div role="status" className="flex items-center gap-2 p-4 text-sm text-ink-500"><span className="h-4 w-4 animate-spin rounded-full border-2 border-ink-200 border-t-brand-600" />{label ?? t("common.loading")}</div>;
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useT();
  const e = error instanceof ApiError ? error : null;
  return (
    <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
      <div className="font-semibold">{e?.message ?? (error instanceof Error ? error.message : t("common.error"))}</div>
      {e && <div className="mt-1 font-mono text-[11px] text-rose-600">{e.code}{e.requestId ? ` · ${t("common.requestId")}: ${e.requestId}` : ""}</div>}
      {onRetry && <button className="btn-secondary mt-2" onClick={onRetry}>{t("common.retry")}</button>}
    </div>
  );
}

export function Empty({ children }: { children?: ReactNode }) {
  const { t } = useT();
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center text-sm text-ink-500">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-ink-100 text-ink-400"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 9.5 12 4l9 5.5V20H3z" /><path d="M3 9.5h18" /></svg></span>
      <div>{children ?? t("common.noData")}</div>
    </div>
  );
}

export function Field({ label, children, hint, error }: { label: string; children: ReactNode; hint?: string | undefined; error?: string | undefined }) {
  const id = useId();
  return (
    <label className="block" aria-describedby={hint || error ? `${id}-d` : undefined} aria-invalid={error ? true : undefined}>
      <span className="label">{label}</span>
      {children}
      {hint && !error && <span id={`${id}-d`} className="mt-1 block text-xs text-ink-500">{hint}</span>}
      {error && <span id={`${id}-d`} role="alert" className="mt-1 block text-xs font-medium text-rose-600">{error}</span>}
    </label>
  );
}

export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const prev = document.body.style.overflow; document.body.style.overflow = "hidden";
    // Initial focus: first autofocus/focusable control inside, else the panel itself.
    const t = setTimeout(() => { const el = panel.current?.querySelector<HTMLElement>("[autofocus], input:not([type=hidden]), select, textarea, button:not([aria-label=close])") ?? panel.current; el?.focus(); }, 0);
    // Focus trap (Tab / Shift+Tab cycle inside the dialog).
    const trap = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !panel.current) return;
      const f = [...panel.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter((x) => x.offsetParent !== null);
      if (f.length === 0) return;
      const first = f[0]!, last = f[f.length - 1]!;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", trap);
    return () => { clearTimeout(t); window.removeEventListener("keydown", trap); document.body.style.overflow = prev; opener?.focus?.(); };
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/45 backdrop-blur-[2px] sm:items-center sm:p-4" onMouseDown={onClose}>
      <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title}
        className={`flex max-h-[92dvh] w-full flex-col rounded-t-2xl bg-white shadow-pop animate-fade-up sm:rounded-2xl ${wide ? "sm:max-w-4xl" : "sm:max-w-lg"}`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-full bg-ink-200 sm:hidden" aria-hidden="true" />
        <div className="flex shrink-0 items-center justify-between gap-3 px-4 pb-2 pt-3 sm:px-5 sm:pt-4"><h2 className="text-lg">{title}</h2><button aria-label="close" className="btn-icon btn-ghost -me-2 h-9 w-9" onClick={onClose}>✕</button></div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 scrollbar-thin sm:px-5">{children}</div>
        {footer && <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-ink-100 px-4 py-3 pb-[max(.75rem,env(safe-area-inset-bottom))] sm:px-5">{footer}</div>}
      </div>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0"><h1 className="text-xl sm:text-2xl">{title}</h1>{subtitle && <div className="mt-0.5 text-sm text-ink-500">{subtitle}</div>}</div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Badge({ tone = "slate", children }: { tone?: "slate" | "green" | "red" | "amber" | "blue"; children: ReactNode }) {
  const c = { slate: "bg-ink-100 text-ink-700", green: "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200", red: "bg-rose-50 text-rose-800 ring-1 ring-rose-200", amber: "bg-amber-50 text-amber-800 ring-1 ring-amber-200", blue: "bg-sky-50 text-sky-800 ring-1 ring-sky-200" }[tone];
  return <span className={`badge ${c}`}>{children}</span>;
}

/** Toasts: tiny global store without a dependency. */
import { create } from "zustand";
interface Toast { id: number; kind: "ok" | "err" | "info"; text: string }
export const useToasts = create<{ list: Toast[]; push: (kind: Toast["kind"], text: string) => void; drop: (id: number) => void }>((set) => ({
  list: [],
  push: (kind, text) => { const id = Date.now() + Math.random(); set((s) => ({ list: [...s.list, { id, kind, text }] })); if (kind !== "err") setTimeout(() => set((s) => ({ list: s.list.filter((t) => t.id !== id) })), 4000); },
  drop: (id) => set((s) => ({ list: s.list.filter((t) => t.id !== id) })),
}));
export const toast = { ok: (t: string) => useToasts.getState().push("ok", t), err: (t: string) => useToasts.getState().push("err", t), info: (t: string) => useToasts.getState().push("info", t) };
export function Toaster() {
  const { list, drop } = useToasts();
  return (
    <div className="toaster pointer-events-none fixed inset-x-3 z-[60] flex flex-col items-center gap-2 sm:inset-x-auto sm:start-4 sm:items-start" style={{ bottom: "calc(var(--bottomnav-h) + env(safe-area-inset-bottom) + .75rem)" }} aria-live="polite">
      {list.map((t) => (
        <div key={t.id} role={t.kind === "err" ? "alert" : "status"} className={`pointer-events-auto flex w-full max-w-sm items-center gap-2 rounded-xl ps-4 pe-2 py-2.5 text-sm font-medium text-white shadow-pop animate-fade-up ${t.kind === "ok" ? "bg-emerald-700" : t.kind === "err" ? "bg-rose-700" : "bg-ink-800"}`}>
          <span aria-hidden="true">{t.kind === "ok" ? "✓" : t.kind === "err" ? "!" : "i"}</span><span className="flex-1">{t.text}</span>
          <button type="button" aria-label="close" onClick={() => drop(t.id)} className="grid h-8 w-8 place-items-center rounded-md text-white/80 hover:bg-white/15 hover:text-white">✕</button>
        </div>
      ))}
    </div>
  );
}
