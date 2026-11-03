import { useT } from "@/i18n";

/**
 * Feature-local translator: looks up the feature dictionaries first, then falls back to the global
 * i18n dictionaries. This keeps a feature working even before its keys are merged into ar.ts/en.ts.
 */
export function useFeatureT(ar: Record<string, string>, en: Record<string, string>) {
  const base = useT();
  const dict = base.locale === "ar" ? ar : en;
  const t = (key: string, vars?: Record<string, string | number>): string => {
    const s = dict[key] ?? en[key];
    if (s === undefined) return base.t(key, vars);
    return vars ? s.replace(/\{(\w+)\}/g, (_m, k: string) => String(vars[k] ?? `{${k}}`)) : s;
  };
  return { ...base, t };
}
