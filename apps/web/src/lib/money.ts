import type { MoneyJson } from "./api";

export const MINOR_UNITS: Record<string, number> = { YER_OLD: 2, YER_NEW: 2, SAR: 2, USD: 2 };
export const CURRENCY_LABEL: Record<string, { ar: string; en: string }> = {
  YER_NEW: { ar: "ر.ي جديد", en: "YER (new)" }, YER_OLD: { ar: "ر.ي قديم", en: "YER (old)" }, SAR: { ar: "ر.س", en: "SAR" }, USD: { ar: "$", en: "USD" },
};

/** Format minor units as a decimal string with thousands separators; never floats. */
export function fmtMinor(amountMinor: string | bigint | number, currency: string, locale: "ar" | "en" = "ar", withSymbol = true): string {
  const d = MINOR_UNITS[currency] ?? 2;
  let n = BigInt(amountMinor);
  const neg = n < 0n; if (neg) n = -n;
  const s = n.toString().padStart(d + 1, "0");
  const int = s.slice(0, s.length - d), frac = s.slice(s.length - d);
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const body = d > 0 ? `${grouped}.${frac}` : grouped;
  const sym = withSymbol ? ` ${CURRENCY_LABEL[currency]?.[locale] ?? currency}` : "";
  return `${neg ? "-" : ""}${body}${sym}`;
}
export const fmtMoney = (m: MoneyJson | null | undefined, locale: "ar" | "en" = "ar") => (m ? fmtMinor(m.amountMinor, m.currency, locale) : "—");

/** Parse a user-typed decimal ("1,250.5") into minor units string; rejects more decimals than the currency allows. */
export function parseToMinor(text: string, currency: string): string | null {
  const d = MINOR_UNITS[currency] ?? 2;
  const t = text.replace(/[,\s]/g, "").replace(/[٠-٩]/g, (c) => String("٠١٢٣٤٥٦٧٨٩".indexOf(c)));
  if (!/^-?\d*(\.\d*)?$/.test(t) || t === "" || t === "-" || t === ".") return null;
  const [i = "0", f = ""] = t.replace(/^-/, "").split(".");
  if (f.length > d) return null;
  const minor = BigInt(i || "0") * 10n ** BigInt(d) + BigInt((f + "0".repeat(d)).slice(0, d) || "0");
  return (t.startsWith("-") ? -minor : minor).toString();
}
