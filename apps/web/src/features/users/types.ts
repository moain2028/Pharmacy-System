import { useFeatureT } from "./featureT";
import { usersAr, usersEn } from "./users.keys";

export interface UserRow { id: string; username: string; display_name: string; locale: "ar" | "en"; is_active: boolean; roles: Array<{ id: string; code: string }> }
export interface RoleRow { id: string; code: string; name_ar: string; name_en: string; permissions: string[]; limits?: Record<string, number> | null | undefined }

export const useUT = () => useFeatureT(usersAr, usersEn);

export function listOf<T>(x: T[] | { rows?: T[] | undefined } | null | undefined): T[] {
  if (Array.isArray(x)) return x;
  return x?.rows ?? [];
}

/** Group a permission catalogue by resource prefix (text before the first dot). */
export function groupPerms(list: readonly string[]): Array<[string, string[]]> {
  const m = new Map<string, string[]>();
  for (const p of list) {
    const g = p.split(".")[0] ?? p;
    const a = m.get(g);
    if (a) a.push(p); else m.set(g, [p]);
  }
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}
