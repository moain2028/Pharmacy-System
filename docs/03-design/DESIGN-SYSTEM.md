# PharmaCore Design System (web)

**Goal:** a calm, clinical, trustworthy UI that a cashier can run with one hand on a phone and a pharmacist can run with a keyboard on a 24" screen. Arabic-first (RTL), English parity.

## Principles
1. **Workflow, not alphabet.** Navigation is grouped the way a pharmacy works: البيع → المخزون → المشتريات → المال → الإدارة.
2. **Money is sacred.** All amounts are `bigint` minor units, rendered with tabular numerals, LTR isolate, currency as a small suffix — never truncated, never floats.
3. **Touch ≥ 44 px on coarse pointers**, 40 px on desktop. Inputs are 16 px on phones (prevents iOS zoom).
4. **Fixed elements never live inside transformed ancestors** (page transitions use opacity only). Modals become bottom sheets under 640 px.
5. **Zero network dependencies at runtime** — Tajawal is self-hosted (`public/fonts`), icons are inline SVG. The desktop build must work offline.

## Tokens (`tailwind.config.js`)
| Token | Use |
|---|---|
| `brand.*` (teal ramp 50–950) | primary actions, active nav, focus ring |
| `ink.*` (neutral ramp 50–900) | surfaces, borders, text |
| `emerald / amber / rose` | success / warning (expiry) / danger — semantic only |
| `shadow-card / shadow-pop / shadow-glow` | resting card / overlays / focus |
| `rounded-xl` 14 px, `rounded-2xl` 18 px | cards, modals |
| `--sidebar-w 16.5rem`, `--topbar-h 3.5rem`, `--bottomnav-h 3.75rem` | layout constants |

## Layout breakpoints
- `< 640` phone: top bar + bottom nav (4 slots + More) + drawer; modals are sheets; tables scroll horizontally inside `.table-wrap`.
- `640–1023` tablet: same shell, 2-column grids.
- `≥ 1024` desktop: fixed grouped sidebar, slim context top bar, 3–4 column grids, POS gets a pinned summary column.

## Components (`components/ui.tsx`, `components/icons.tsx`)
`PageHeader(title, subtitle, actions)`, `Field`, `Modal(wide)`, `Badge(tone)`, `Empty`, `ErrorBox`, `Spinner`, `toast.*`, `.skeleton`, `.kbd`, `.stat-value`, `Icons.<name>`.

## Print
`@media print` hides chrome; `.receipt-80` renders a 72 mm thermal receipt; reports print on A4 with static headers.

## Verification
`tools/ui-audit/crawl.mjs` logs in, visits every route at phone/tablet/desktop, and fails on: JS/console errors, HTTP ≥ 500, horizontal overflow, placeholder text, empty pages, tap targets < 32 px. Run it after any shell/style change.
