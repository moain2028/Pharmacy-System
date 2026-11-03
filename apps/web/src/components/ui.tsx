import { type ReactNode, useEffect } from "react";
import { ApiError } from "@/lib/api";
import { useT } from "@/i18n";

export function Spinner({ label }: { label?: string }) {
  const { t } = useT();
  return <div role="status" className="flex items-center gap-2 p-4 text-sm text-slate-500"><span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600" />{label ?? t("common.loading")}</div>;
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useT();
  const e = error instanceof ApiError ? error : null;
  return (
    <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
      <div className="font-medium">{e?.message ?? (error instanceof Error ? error.message : t("common.error"))}</div>
      {e && <div className="mt-1 text-xs text-red-600">{e.code}{e.requestId ? ` · ${t("common.requestId")}: ${e.requestId}` : ""}</div>}
      {onRetry && <button className="btn-secondary mt-2" onClick={onRetry}>{t("common.retry")}</button>}
    </div>
  );
}

export function Empty({ children }: { children?: ReactNode }) {
  const { t } = useT();
  return <div className="p-8 text-center text-sm text-slate-500">{children ?? t("common.noData")}</div>;
}

export function Field({ label, children, hint, error }: { label: string; children: ReactNode; hint?: string; error?: string }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
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
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className={`card w-full ${wide ? "max-w-4xl" : "max-w-lg"} max-h-[90vh] overflow-auto`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between"><h2 className="text-lg font-semibold">{title}</h2><button aria-label="close" className="text-slate-400 hover:text-slate-700" onClick={onClose}>✕</button></div>
        {children}
        {footer && <div className="mt-4 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

export function PageHeader({ title, actions }: { title: string; actions?: ReactNode }) {
  return <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><h1 className="text-xl font-semibold">{title}</h1><div className="flex gap-2">{actions}</div></div>;
}

export function Badge({ tone = "slate", children }: { tone?: "slate" | "green" | "red" | "amber" | "blue"; children: ReactNode }) {
  const c = { slate: "bg-slate-100 text-slate-700", green: "bg-green-100 text-green-800", red: "bg-red-100 text-red-800", amber: "bg-amber-100 text-amber-800", blue: "bg-blue-100 text-blue-800" }[tone];
  return <span className={`badge ${c}`}>{children}</span>;
}

/** Toasts: tiny global store without a dependency. */
import { create } from "zustand";
interface Toast { id: number; kind: "ok" | "err" | "info"; text: string }
export const useToasts = create<{ list: Toast[]; push: (kind: Toast["kind"], text: string) => void; drop: (id: number) => void }>((set) => ({
  list: [],
  push: (kind, text) => { const id = Date.now() + Math.random(); set((s) => ({ list: [...s.list, { id, kind, text }] })); setTimeout(() => set((s) => ({ list: s.list.filter((t) => t.id !== id) })), 4000); },
  drop: (id) => set((s) => ({ list: s.list.filter((t) => t.id !== id) })),
}));
export const toast = { ok: (t: string) => useToasts.getState().push("ok", t), err: (t: string) => useToasts.getState().push("err", t), info: (t: string) => useToasts.getState().push("info", t) };
export function Toaster() {
  const { list, drop } = useToasts();
  return (
    <div className="pointer-events-none fixed bottom-4 start-4 z-[60] flex flex-col gap-2">
      {list.map((t) => <div key={t.id} onClick={() => drop(t.id)} className={`pointer-events-auto cursor-pointer rounded-md px-4 py-2 text-sm text-white shadow ${t.kind === "ok" ? "bg-green-600" : t.kind === "err" ? "bg-red-600" : "bg-slate-800"}`}>{t.text}</div>)}
    </div>
  );
}
