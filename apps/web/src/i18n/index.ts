/**
 * Minimal, dependency-free i18n. Keys are dot paths; both locales must define every key (tested).
 * `t("pos.total")`, `t("common.qtyUnits", { n: 3 })`. Direction follows the locale (ar = rtl).
 */
import { useAuth, type Locale } from "@/lib/auth";
import { ar } from "./ar";
import { en } from "./en";

export type Dict = Record<string, string>;
export const DICTS: Record<Locale, Dict> = { ar, en };
export const dirOf = (l: Locale) => (l === "ar" ? "rtl" : "ltr");

export function translate(locale: Locale, key: string, vars?: Record<string, string | number>): string {
  const s = DICTS[locale][key] ?? DICTS.en[key] ?? key;
  return vars ? s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`)) : s;
}

export function useT() {
  const locale = useAuth((s) => s.locale);
  const t = (key: string, vars?: Record<string, string | number>) => translate(locale, key, vars);
  return { t, locale, dir: dirOf(locale) };
}
