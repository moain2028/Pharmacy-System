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
      // Latin first so digits/Latin always come from Plex Sans (true tnum); Arabic glyphs fall through to Plex Sans Arabic.
      fontFamily: { sans: ['"IBM Plex Sans"', '"IBM Plex Sans Arabic"', "Segoe UI", "Tahoma", "system-ui", "sans-serif"] },
      colors: {
        // Teal brand (≈172°) paired with neutrals tinted toward the same hue — the previous blue-grey (≈220°) clashed.
        brand: { 50: "#F0F9F8", 100: "#D9F0EE", 200: "#B3E0DC", 300: "#80C9C3", 400: "#4AABA4", 500: "#238F89", 600: "#14807A", 700: "#0F766E", 800: "#115E59", 900: "#123F3C", 950: "#052B28" },
        ink: { 50: "rgb(var(--ink-50) / <alpha-value>)", 100: "rgb(var(--ink-100) / <alpha-value>)", 200: "rgb(var(--ink-200) / <alpha-value>)", 300: "rgb(var(--ink-300) / <alpha-value>)", 400: "rgb(var(--ink-400) / <alpha-value>)", 500: "rgb(var(--ink-500) / <alpha-value>)", 600: "rgb(var(--ink-600) / <alpha-value>)", 700: "rgb(var(--ink-700) / <alpha-value>)", 800: "rgb(var(--ink-800) / <alpha-value>)", 900: "rgb(var(--ink-900) / <alpha-value>)" },
        surface: { DEFAULT: "rgb(var(--surface) / <alpha-value>)", raised: "rgb(var(--surface-raised) / <alpha-value>)" },
        success: { 50: "#ECFDF5", 200: "#A7F3D0", 700: "#047857", 800: "#065F46" },
        warning: { 50: "#FFFBEB", 200: "#FDE68A", 600: "#D97706", 800: "#92400E" },
        danger: { 50: "#FFF1F2", 200: "#FECDD3", 600: "#E11D48", 700: "#BE123C" },
        info: { 50: "#F0F9FF", 200: "#BAE6FD", 800: "#075985" },
      },
      boxShadow: {
        card: "0 1px 2px rgb(16 24 40 / 0.04), 0 1px 3px rgb(16 24 40 / 0.06)",
        pop: "0 12px 32px -8px rgb(16 24 40 / 0.18), 0 2px 6px rgb(16 24 40 / 0.06)",
        glow: "0 0 0 4px rgb(35 143 137 / 0.18)",
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
