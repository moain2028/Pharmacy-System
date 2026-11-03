import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Locale = "ar" | "en";
export interface Me { userId: string; username: string; displayName: string; locale: Locale; permissions: string[]; tenantId: string }

interface AuthState {
  accessToken: string | null; refreshToken: string | null; me: Me | null; locale: Locale;
  setTokens: (a: string, r: string) => void; setMe: (m: Me | null) => void; setLocale: (l: Locale) => void; logout: () => void;
  can: (perm: string) => boolean;
}

const matches = (granted: string, wanted: string) => granted === "*" || granted === wanted || (granted.endsWith(".*") && wanted.startsWith(granted.slice(0, -1)));

export const useAuth = create<AuthState>()(persist((set, get) => ({
  accessToken: null, refreshToken: null, me: null, locale: "ar",
  setTokens: (accessToken, refreshToken) => set({ accessToken, refreshToken }),
  setMe: (me) => set(me ? { me, locale: me.locale } : { me }),
  setLocale: (locale) => set({ locale }),
  logout: () => set({ accessToken: null, refreshToken: null, me: null }),
  can: (perm) => { const p = get().me?.permissions ?? []; return p.some((g) => matches(g, perm)); },
}), { name: "pharmacore.auth", partialize: (s) => ({ accessToken: s.accessToken, refreshToken: s.refreshToken, me: s.me, locale: s.locale }) }));
