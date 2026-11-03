import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * URL-bound tab state: `?tab=adjust`. Deep-linkable, survives reload, drives breadcrumbs and the
 * sidebar sub-items. Invalid values fall back to the first allowed tab.
 */
export function useTab<T extends string>(allowed: readonly T[], fallback: T = allowed[0] as T): [T, (t: T) => void] {
  const [sp, setSp] = useSearchParams();
  const raw = sp.get("tab");
  const tab = (allowed as readonly string[]).includes(raw ?? "") ? (raw as T) : fallback;
  const setTab = useCallback((t: T) => { const next = new URLSearchParams(sp); if (t === fallback) next.delete("tab"); else next.set("tab", t); setSp(next, { replace: true }); }, [sp, setSp, fallback]);
  return [tab, setTab];
}
