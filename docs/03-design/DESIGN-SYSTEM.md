# PharmaCore Design System (web)

**Goal:** a calm, clinical, trustworthy UI that a cashier can run with one hand on a phone and a pharmacist can run with a keyboard on a 24" screen. Arabic-first (RTL), English parity.

## Principles
1. **Workflow, not alphabet.** Navigation is grouped the way a pharmacy works: البيع → المخزون → المشتريات → المال → الإدارة.
2. **Money is sacred.** All amounts are `bigint` minor units, rendered with tabular numerals, LTR isolate, currency as a small suffix — never truncated, never floats.
3. **Touch ≥ 44 px on coarse pointers**, 40 px on desktop. Inputs are 16 px on phones (prevents iOS zoom).
4. **Fixed elements never live inside transformed ancestors** (page transitions use opacity only). Modals become bottom sheets under 640 px.
5. **Zero network dependencies at runtime** — Tajawal is self-hosted (`public/fonts`), icons are inline SVG. The desktop build must work offline.

## Studies (session #12) — three independent reviews, applied
`reviews/2026-11-03-astra-audit.md` (defects + spacing math + print), `reviews/2026-11-03-opus-typography-colour.md` (font pairing, palette with WCAG ratios), `reviews/2026-11-03-opus-mobile-ergonomics.md` (phone/tablet, thumb zones, first-5-seconds hierarchy).

**Why the first version "felt off" (root causes, not symptoms):** cool blue-grey neutrals (≈220°) against a teal brand (≈172°); Tajawal has no true `tnum` so money jittered and its Latin is weak; weight 800 + letter-spacing + uppercase on Arabic; 15 px root broke the 4 px grid and made every "44 px" claim actually 41 px.

**Applied:** IBM Plex Sans (Latin/digits, real tabular numerals) + IBM Plex Sans Arabic, self-hosted; hue-matched `ink` neutrals; `brand-700` primary (white text 5.47:1 AA); secondary text `ink-500` 5.48:1; 16 px root; 48 px coarse-pointer targets; `viewport-fit=cover` so safe areas activate; U+2212 minus; `<html lang dir>` synced to locale; focus trap + restore in Modal; persistent error toasts with dismiss button; `aria-describedby` on fields; RTL select padding on the chevron edge; numeric header/value alignment; `.table-stack` for phone lists; language moved out of primary nav (Settings owns it).

## Tokens (`tailwind.config.js`)
| Token | Use |
|---|---|
| `brand.*` (teal 50–950; 700 = primary) | primary actions, active nav indicator, focus |
| `ink.*` (teal-tinted neutrals 50–900) | surfaces, borders, text (500 = minimum text, AA) |
| `success / warning / danger / info` | semantic only, each with 50/200/700-800 |
| `shadow-card / shadow-pop / shadow-glow` | resting card / overlays / focus |
| `rounded-xl` 14 px, `rounded-2xl` 18 px | cards, modals |
| `--sidebar-w 16.5rem`, `--topbar-h 3.5rem`, `--bottomnav-h 3.75rem` | layout constants |

## Layout breakpoints
- `< 640` phone: top bar + bottom nav (4 slots + More) + drawer; modals are sheets; tables scroll horizontally inside `.table-wrap`.
- `640–1023` tablet: same shell, 2-column grids.
- `≥ 1024` desktop: fixed grouped sidebar, slim context top bar, 3–4 column grids, POS gets a pinned summary column.

## Components (`components/ui.tsx`, `components/icons.tsx`)
`PageHeader(title, subtitle, actions)`, `Field`, `Modal(wide)`, `Badge(tone)`, `Empty`, `ErrorBox`, `Spinner`, `toast.*`, `.skeleton`, `.kbd`, `.stat-value`, `Icons.<name>`.

## Print (`components/PrintFrame.tsx` + `@media print` in `styles.css`)
Every report is wrapped in `PrintFrame`: pharmacy name, document title, period, printed-at/by header; repeating `<thead>`; rows never split; footer with page number; A4 portrait, landscape auto when > 7 columns; 10.5 pt body / 9 pt table; app chrome hidden structurally (no visibility hacks). `.receipt-80` = 72 mm thermal. Verified by rendering to PDF in the audit (`tools/ui-audit/print.mjs`).

## Verification
`tools/ui-audit/crawl.mjs` logs in, visits every route at phone/tablet/desktop, and fails on: JS/console errors, HTTP ≥ 500, horizontal overflow, placeholder text, empty pages, tap targets < 32 px. Run it after any shell/style change.

## Navigation & preferences (session #13)
- IA lives in `app/nav.ts` (2 levels max). Section headers collapse with chevrons; items with sub-items expose them under the item; sub-items are `?tab=` links. Breadcrumbs derive from the same model.
- Shortcuts: `g` + chord per item, `F2` POS, `Alt+M` menu, `?` sheet; matched on `e.code`.
- Dark theme = CSS-variable swap under `[data-theme="dark"]`; never add per-component dark classes — add a remap line in the dark block instead. Preferences are per device (`lib/prefs.ts`).
