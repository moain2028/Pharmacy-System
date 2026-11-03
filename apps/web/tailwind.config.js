/** @type {import('tailwindcss').Config} */
/**
 * PharmaCore design tokens.
 * - brand: deep teal (trust / pharmacy), with a full ramp for surfaces, borders, text and emphasis.
 * - accent: amber for warnings/expiry, rose for danger, emerald for success — never used decoratively.
 * - Typography: Tajawal (self-hosted, /public/fonts) for Arabic + Latin; tabular numerals for money.
 * - Spacing is 4px-based; radii are deliberately soft (lg=12px) for a calm clinical feel.
 */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: { sans: ["Tajawal", "IBM Plex Sans Arabic", "Segoe UI", "system-ui", "sans-serif"] },
      colors: {
        brand: { 50: "#effaf7", 100: "#d6f2ea", 200: "#b0e4d6", 300: "#7ccfbc", 400: "#47b39e", 500: "#1f9683", 600: "#15786b", 700: "#136057", 800: "#124d47", 900: "#11403c", 950: "#062522" },
        ink: { 50: "#f7f8fa", 100: "#eef0f4", 200: "#dfe3ea", 300: "#c5ccd8", 400: "#98a2b3", 500: "#667085", 600: "#475467", 700: "#344054", 800: "#1d2939", 900: "#101828" },
      },
      boxShadow: {
        card: "0 1px 2px rgb(16 24 40 / 0.04), 0 1px 3px rgb(16 24 40 / 0.06)",
        pop: "0 12px 32px -8px rgb(16 24 40 / 0.18), 0 2px 6px rgb(16 24 40 / 0.06)",
        glow: "0 0 0 4px rgb(31 150 131 / 0.15)",
      },
      borderRadius: { xl: "0.875rem", "2xl": "1.125rem" },
      spacing: { "safe-b": "env(safe-area-inset-bottom)", "safe-t": "env(safe-area-inset-top)" },
      screens: { xs: "420px" },
      keyframes: {
        "fade-up": { from: { opacity: "0", transform: "translateY(6px)" }, to: { opacity: "1", transform: "translateY(0)" } },
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "slide-in-start": { from: { transform: "translateX(var(--slide-from))" }, to: { transform: "translateX(0)" } },
        shimmer: { from: { backgroundPosition: "200% 0" }, to: { backgroundPosition: "-200% 0" } },
      },
      animation: { "fade-up": "fade-up .22s ease-out", "fade-in": "fade-in .18s ease-out", "slide-in-start": "slide-in-start .22s ease-out both", shimmer: "shimmer 1.6s linear infinite" },
    },
  },
  plugins: [],
};
