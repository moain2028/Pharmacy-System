import { useQuery } from "@tanstack/react-query";
import { get } from "@/lib/api";
import { useFeatureT } from "@/features/users/featureT";
import { accountingAr, accountingEn } from "./accounting.keys";

export const useAT = () => useFeatureT(accountingAr, accountingEn);
export const today = () => new Date().toISOString().slice(0, 10);

export function rowsOf<T>(x: T[] | { rows?: T[] | undefined } | null | undefined): T[] {
  if (Array.isArray(x)) return x;
  return x?.rows ?? [];
}

export interface TbRow { code: string; name_ar: string; name_en: string; type: string; debit: string; credit: string; balance: string }
export interface Tb { currency: string; rows: TbRow[]; totals: { debit: string; credit: string; balanced: boolean } }
export const useTb = () => useQuery({ queryKey: ["trial-balance", "coa"], queryFn: () => get<Tb>("/reports/trial-balance") });

const SCALE = 1000000n;
const normDigits = (s: string) => s.replace(/[٠-٩]/g, (c) => String("٠١٢٣٤٥٦٧٨٩".indexOf(c)));

/** "140250000" → "140.25" (RATE_SCALE 1e6), bigint-only. */
export function scaledToHuman(s: string): string {
  let n: bigint;
  try { n = BigInt(s); } catch { return s; }
  const neg = n < 0n; if (neg) n = -n;
  const f = (n % SCALE).toString().padStart(6, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${(n / SCALE).toString()}${f ? `.${f}` : ""}`;
}

/** "140" | "140.25" → scaled string; null when invalid, zero or > 6 decimals. */
export function humanToScaled(text: string): string | null {
  const t = normDigits(text.trim().replace(/,/g, ""));
  if (!/^\d+(\.\d{1,6})?$/.test(t)) return null;
  const [i = "0", f = ""] = t.split(".");
  const v = BigInt(i) * SCALE + BigInt((f + "000000").slice(0, 6));
  return v > 0n ? v.toString() : null;
}
