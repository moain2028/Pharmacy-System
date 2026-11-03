import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Per-device user preferences (not account data): theme, digit system, table density.
 * Applied to <html data-theme data-density> so every token flips without touching components.
 */
export type Theme = "system" | "light" | "dark";
export type Digits = "latn" | "arab";
export type Density = "comfortable" | "compact";

interface Prefs { theme: Theme; digits: Digits; density: Density; setTheme: (t: Theme) => void; setDigits: (d: Digits) => void; setDensity: (d: Density) => void }

export const usePrefs = create<Prefs>()(persist((set) => ({
  theme: "system", digits: "latn", density: "comfortable",
  setTheme: (theme) => set({ theme }), setDigits: (digits) => set({ digits }), setDensity: (density) => set({ density }),
}), { name: "pharmacore.prefs" }));

// jsdom (tests) has no matchMedia; guard so importing this module never throws.
const mq = typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
export const resolvedTheme = (t: Theme): "light" | "dark" => (t === "system" ? (mq?.matches ? "dark" : "light") : t);

export function applyPrefs(p: Pick<Prefs, "theme" | "density">): void {
  const root = document.documentElement;
  const theme = resolvedTheme(p.theme);
  root.dataset["theme"] = theme;
  root.style.colorScheme = theme;
  root.dataset["density"] = p.density;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = theme === "dark" ? "#0E1517" : "#0F766E";
}

/** Call once at boot: applies now, re-applies on changes and on OS theme changes while in "system". */
export function bindPrefs(): void {
  applyPrefs(usePrefs.getState());
  usePrefs.subscribe((s) => applyPrefs(s));
  mq?.addEventListener("change", () => { if (usePrefs.getState().theme === "system") applyPrefs(usePrefs.getState()); });
}

/** Convert ASCII digits to Eastern Arabic when the user prefers them. Money stays LTR/tabular either way. */
export const localizeDigits = (s: string, digits: Digits = usePrefs.getState().digits): string =>
  digits === "arab" ? s.replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)] ?? d) : s;
