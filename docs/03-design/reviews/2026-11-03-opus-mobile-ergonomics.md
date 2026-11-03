## A. Defects found (ordered by severity)

**A1. KPI value collides with the icon and the currency wraps** (`dashboard/index.tsx` `Stat`/`Money`, `.stat-value`)
*Evidence:* At 360px, `grid-cols-2` gives a card of about 162px. After padding (32), icon (44), gaps (24) and chevron (16), roughly 46px remains for a `text-2xl` amount of about 125px. `inline-flex` lets the label "ر.ي جديد" break.
*Violates:* WCAG 1.4.10 Reflow and 1.4.12 Text Spacing; Material 3 card anatomy (one focal element).
*Fix:* Put the icon in the header row and give the value the full width. Use one column below 420px, keep the currency unbreakable, and scale the value with the container. Drop `.00` for YER, which has no circulating minor unit.

```jsx
<div className="card @container flex h-full flex-col gap-2">
  <div className="flex items-center gap-2">
    <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${ring}`}><Icon className="h-4 w-4"/></span>
    <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink-600">{label}</span>
    {to && <Icons.chevron className="h-4 w-4 text-ink-400 rtl:rotate-180"/>}
  </div>
  <div className="kpi">{value}</div>{sub && <div className="text-xs text-ink-500">{sub}</div>}
</div>
```

```css
.card.\@container{container-type:inline-size}
.kpi{font-size:clamp(1.25rem,11cqi,2rem);line-height:1.15;font-weight:700;white-space:nowrap}
.kpi .cur{font-size:.5em;margin-inline-start:.25em;white-space:nowrap;color:#475467}
```

Change the grid to `grid-cols-1 xs:grid-cols-2 lg:grid-cols-4`, and give the "Sales today" card `col-span-full xs:col-span-2 lg:col-span-1`.

**A2. Print clips wide tables, uses 9px text, and has no branding** (`ReportTable` `overflow-x-auto`, `.table-wrap min-w-[40rem]`, print `html{font-size:12px}` × `text-xs`)
*Evidence:* The scroll container survives into print. 12px × 0.75 = 9px, which is about 6.75pt.
*Violates:* IBM Carbon print guidance, ISO 9241-303 legibility minimum (≥9pt), WCAG 1.4.4.
*Fix:* See section E, which covers overflow, fixed layout, landscape, ≥9pt and the header/footer.

**A3. Thermal receipt overflows 80mm paper**
*Evidence:* `@page{margin:6mm}` plus `.receipt-80{width:72mm}` gives 84mm, which exceeds the 80mm roll and clips the edge.
*Fix:* Use a named page `receipt` with `margin:0` (section E).

**A4. Numeric headers and values are misaligned in RTL** (`.num{direction:ltr;text-align:end}`)
*Evidence:* Inside an LTR cell, `end` resolves to *right*, while the `th.text-end` header in RTL resolves to *left*.
*Violates:* Carbon data-table rule that numbers align to the same edge as their header.
*Fix:* Keep the cell RTL and isolate only the digits.

```css
td.num,th.num{text-align:end;font-variant-numeric:tabular-nums lining-nums}
.num bdi,.ltr-num{direction:ltr;unicode-bidi:isolate}
```

**A5. Tajawal has no `tnum` feature, so columns jitter.** Its Latin is weak and it has a low x-height, which explains the "feels off" reaction. `tabular-nums` silently does nothing.
*Fix:* Change the font pairing (section B).

**A6. Contrast failures** (WCAG 1.4.3)
- Nav group labels use `text-ink-400` #98A2B3 on white at 2.6:1 and 11px. Change to `text-ink-500` (4.8:1) at 12px.
- Success toast uses `bg-emerald-600` with white text at 3.8:1. Change to `bg-emerald-700` #047857 (5.5:1).

**A7. Uppercase plus letter-spacing breaks Arabic joining** (`thead th`, group labels, `h3`)
*Fix:* `[dir=rtl] *{letter-spacing:0!important}` and apply `uppercase` only under `ltr:`.

**A8. Checkbox width bug and undersized target** (`@apply h-4 w-4 min-h-0 w-auto`)
*Evidence:* `w-auto` overrides `w-4`, and the 16px box is below the 24px minimum target (WCAG 2.5.8).
*Fix:* `h-5 w-5` (20px) inside a label with `min-h-[44px]` padding on coarse pointers.

**A9. Select arrow overlaps text in RTL**
*Evidence:* The arrow sits on the left (inline-end), but the padding is applied on inline-start (right).
*Fix:* `select{padding-inline-end:2rem;padding-inline-start:.75rem;background-position:left .75rem center}` and `[dir=ltr] select{background-position:right .75rem center}`.

**A10. Drawer and Modal have no focus trap or focus return** (WCAG 2.4.3, 2.4.11)
*Evidence:* The Modal close button shows a hard-coded `✕` with `aria-label="close"`, which is not localized.
*Fix:* On open, focus the first focusable element. Trap Tab/Shift+Tab inside, restore `document.activeElement` on close, use `t("common.close")`, and replace `✕` with `<Icons.close>`. Add `inert` to `main` while either is open.

**A11. 15px root breaks the 4px grid** (`html{font-size:15px}`)
*Evidence:* 0.25rem = 3.75px, so borders and icons render on sub-pixels.
*Fix:* Set `html{font-size:100%}` (16px) for all sizes. Density comes from component tokens, not from the root.

**A12. Safe areas never activate.** `env()` returns 0 without `viewport-fit=cover`.
*Fix:* `<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">`. Add `padding-inline:max(.75rem,env(safe-area-inset-left))` to the topbar and bottom nav for landscape.

**A13. Tables scroll horizontally on phones** (`.table-wrap min-w-[40rem]`)
*Fix:* Below `sm`, render rows as cards using `<ul role="list">`:
- Primary text: 16px, semibold.
- Two key numbers aligned to the end.
- Secondary metadata: 12px muted.
- Overflow menu button: 44×44.

Keep `<table>` from `sm` upward.

**A14. Desktop layout leftovers**
- The toaster sits 72px above the bottom on desktop and overlaps the sidebar. Use `lg:bottom-6 lg:start-[calc(var(--sidebar-w)+1.5rem)]`.
- `hover:shadow-pop` sticks on touch. Wrap hover styles in `@media (hover:hover)` (Tailwind: `[@media(hover:hover)]:hover:…`).
- `main` with `lg:max-w-none` gives 1700px line lengths on 1920 screens. Inner wrapper: `max-w-[90rem] mx-auto`.

**A15. Dashboard refresh button is labelled `common.retry`.** Use "تحديث" plus a "آخر تحديث 10:42" timestamp (Nielsen #1, visibility of system status).

**A16. Language toggle lives in primary nav** (UserBox). Move it to Settings ▸ Preferences and the avatar menu (section D).

**Dashboard first-5-seconds order:**
1. Shift status banner.
2. Sales today (hero, full-width on phone).
3. Cash on hand.
4. Risk tiles: expiring lots and low stock, with counts in amber/rose only when greater than 0.
5. Quick actions, limited to 4 on phone.
6. Currency breakdown, collapsed on phone.

## B. Typography & colour study

**Fonts (both OFL, self-host as woff2 with `unicode-range` subsets):**
- **IBM Plex Sans Arabic** (400/500/600/700) for Arabic script.
- **IBM Plex Sans** (Latin, has `tnum`) for Latin and digits. It is the designed companion, so stroke contrast and x-height match.

```css
@font-face{font-family:"PC";src:url(/fonts/plex-sans-400.woff2)format("woff2");font-weight:400;unicode-range:U+0000-00FF,U+2000-206F,U+20AC;}
@font-face{font-family:"PC";src:url(/fonts/plex-arabic-400.woff2)format("woff2");font-weight:400;unicode-range:U+0600-06FF,U+0750-077F,U+FB50-FDFF,U+FE70-FEFF;}
/* repeat for 500/600/700; tailwind: sans:["PC","Segoe UI","Tahoma","sans-serif"] */
```

**Scale** (rem at a 16px root; Arabic needs line-height of 1.5–1.7):

| Token | Phone | Desktop |
|---|---|---|
| caption | .75/1.125 (12/18) | .75/1.125 |
| body-sm (table) | .875/1.375 (14/22) | .8125/1.25 (13/20) |
| body | 1/1.5 (16/24) | .875/1.375 |
| title | 1.125/1.75 | 1.125/1.75 |
| h2 | 1.25/1.875 | 1.25/1.875 |
| h1 | 1.5/2 | 1.75/2.25 |
| kpi | clamp 1.25–1.75 | 2/2.5 |

Rules: weights are 400 body, 600 emphasis, 700 KPI. Remove 800, because it clots Arabic counters. Minimum text is 12px; 11px only for `kbd`.

**Money:**
- Western digits by default (`ar-YE-u-nu-latn`), with Arabic-Indic digits as a user preference.
- `tnum lining` features.
- Currency after the number at 0.5em, no-wrap, wrapped in `<bdi>`.
- Negatives shown as `−1,250` (U+2212) in rose-700. Never use colour alone; keep the sign.

**Palette (light) — contrast on #FFFFFF unless stated:**

| Role | Hex | Ratio |
|---|---|---|
| text | #101828 | 17.7 |
| text-secondary | #475467 | 7.6 |
| text-muted (min) | #667085 | 4.8 |
| border | #D0D5DD | 1.5 (decorative) |
| input border | #98A2B3 | 2.6 → use #8A94A6 for 3.0 (1.4.11) |
| canvas | #F5F7F9 | — |
| primary btn | #15786B on white text | 5.3 |
| primary hover | #136057 | 7.4 |
| link | #136057 | 7.4 |
| badge success | #065F46 on #ECFDF5 | 7.4 |
| badge warn | #92400E on #FFFBEB | 6.8 |
| badge danger | #9F1239 on #FFF1F2 | 7.3 |
| badge info | #075985 on #F0F9FF | 7.2 |
| danger btn | #BE123C, white | 6.2 |
| focus ring | #1F9683, 2px + 2px offset | 3.4 vs white |

**Dark-ready semantic variables:** reference CSS variables in Tailwind (`colors:{surface:"rgb(var(--surface)/<alpha-value>)"}`).

| Variable | Light | Dark | Dark contrast |
|---|---|---|---|
| canvas | #F5F7F9 | #0B1220 | — |
| surface | #FFFFFF | #111A2B | — |
| text | #101828 | #E6EAF0 | 14.8 on surface |
| muted | #667085 | #9AA4B5 | 7.0 |
| border | #D0D5DD | #26324A | — |
| primary | brand-600 | brand-400 #47B39E | 6.1, with text #062522 |

## C. Spacing & layout system

- **Grid:** 4px base. Allowed steps: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64. No odd values such as `py-2.5` (10px) in new code; use 8 or 12.
- **Cards:** padding 16 on phone, 20 on tablet, 24 on desktop. Grid gap 12 / 16 / 24. Section spacing 24 on phone, 32 on desktop. Radius 12 for cards, 8 for controls.
- **Max widths:** content 90rem (1440). Forms 40rem. Prose 72ch. Modals 32rem, wide 56rem.
- **Sidebar by breakpoint:**
  - 1280px and up: 264px, expanded.
  - 1024–1279px: 72px icon rail with tooltip and `aria-label`, expandable as an overlay.
  - Below 1024px: drawer of `min(20rem,85vw)`.
- **Topbar:** 56px on phone, 64px on desktop.
- **Bottom nav:** 64px plus `env(safe-area-inset-bottom)`, with 4 destinations and More. Each item is at least 48×48, the label is 12px, and the active indicator pill is 56×28.
- **Safe areas:** use the `viewport-fit` meta (A12). Apply insets to the topbar top, bottom nav and sheet bottom, and inline insets in landscape.
- **Thumb zone:**
  - The primary action on phone lives in a sticky bottom bar (`bottom: calc(64px + safe)`), never in the top-end corner.
  - On POS the bottom nav is hidden. The full-width Pay button is 56px tall, with the total in 20px bold above it.
  - The search/scan field sits under the topbar with autofocus.
  - Quantity steppers are 48×48.
  - The cart is a bottom sheet with snap points at 30% and 90%.
- **Tablet POS (768–1024px landscape):** two panes, item grid 60% and cart 40% fixed on the inline-end, with Pay at the bottom of the cart.
- **Inputs:** 16px font on phone (prevents iOS zoom), 48px tall on coarse pointers, 40px on fine pointers.
- **Table density:**
  - Phone: cards (A13).
  - Tablet: rows 48px, cell padding 12/16.
  - Desktop: rows 40px.
  - Reports: rows 32px, sticky header, numeric columns `nowrap`.

## D. Navigation IA

| Section (icon) | Items → sub-items | Shortcut |
|---|---|---|
| **الرئيسية** (layout-dashboard) | Dashboard | Alt+1 |
| **المبيعات** (shopping-cart) | POS · Sales invoices · Returns · Customers → (accounts, credit) | F2 (POS), Alt+2 |
| **المخزون** (package) | Items → (categories, units, prices) · Stock levels → (adjustments, transfers, stock-take) · Expiry | Alt+3 |
| **المشتريات** (truck) | Purchase orders · Goods receipts · Suppliers · Payables | Alt+4 |
| **المالية** (wallet) | Cash & shifts · Expenses · Accounting → (journal, chart of accounts) | Alt+5 |
| **التقارير** (bar-chart-3) | Sales · Inventory valuation · Expiry · Profit · Cash | Alt+6 |
| **الإدارة** (settings) | Users & roles · Settings → (pharmacy profile, printing, taxes/currencies, backup) | Alt+9 |

**Sub-items:** in the expanded sidebar they appear as an accordion (`aria-expanded`, indent 36px). On the tablet rail they open as a flyout. On phones they appear in the drawer.

**Global shortcuts.** Bind via `KeyboardEvent.code`, not `key`, because the Arabic layout changes `e.key`.

| Shortcut | Action |
|---|---|
| Ctrl+K | Command palette / search |
| Alt+1…9 | Jump to section |
| `?` | Shortcut sheet |
| Ctrl+P | Print the current report |
| Esc | Close overlay |
| `/` | Focus search |

Avoid Ctrl+N/T/W (browser/WebView).

**POS shortcuts:**

| Shortcut | Action |
|---|---|
| F2 | Focus scan |
| F3 | Item search |
| F4 | Customer |
| F6 | Quantity |
| F7 | Discount |
| F8 | Hold |
| F9 | Recall |
| F12 / Ctrl+Enter | Pay |
| Del | Remove line |
| +/− | Change quantity |
| Ctrl+Z | Undo last line |

Show `kbd` hints only when `(pointer:fine)`.

**Language and theme:**
- Settings ▸ Preferences (per user) holds language, theme (light/dark/system), digit style, density and default printer.
- The topbar avatar menu (end corner) holds Profile, Language, Theme and Logout.
- The login screen keeps a language switch.
- The sidebar shows the user only as a link to Profile.

**Breadcrumbs:**
- Desktop topbar: `<nav aria-label="مسار التنقل">`, for example "المخزون › الأصناف › باراسيتامول 500". The separator chevron is mirrored with `rtl:rotate-180`, and the last crumb gets `aria-current="page"`.
- Phone: back arrow plus title, no breadcrumbs.

## E. Print architecture

Tauri on Windows uses WebView2 (Chromium 131+), which supports `@page` margin boxes and named pages.

**Report rules:**
- **Header:** add a print-only `<header class="print-head">` with logo, pharmacy name, licence number and address. Below it, the report title, the period, the active filters rendered as text (the filter inputs themselves are hidden), and "طُبع بواسطة … في yyyy-mm-dd hh:mm".
- **Column fitting:** columns declare `printPriority` 1–3.
  - Above 7 columns, switch to the landscape `wide` page.
  - If it still does not fit, drop priority-3 columns and note "أعمدة مخفية: …" in the header.
  - Use `table-layout:fixed`. Give `<col>` widths in mm for numbers (24–30mm) and let text columns wrap.
- **Totals:** the `tfoot` totals row prints once at the end.

```css
@media print{
  @page{size:A4 portrait;margin:14mm 10mm 16mm;
    @bottom-center{content:"صفحة " counter(page) " من " counter(pages);font:9pt "PC"}
    @bottom-left{content:"PharmaCore";font:8pt "PC";color:#475467}}
  @page wide{size:A4 landscape;margin:12mm 10mm 14mm}
  .print-wide{page:wide}
  html{font-size:10pt}
  .print-head{display:block!important;border-bottom:1.5pt solid #000;margin-bottom:4mm;padding-bottom:2mm}
  .overflow-x-auto,.table-wrap{overflow:visible!important;margin:0!important}
  table{min-width:0!important;width:100%;table-layout:fixed;border-collapse:collapse;font-size:9pt}
  thead{display:table-header-group} tfoot{display:table-row-group}
  th,td{padding:1.2mm 1.5mm!important;border-bottom:.5pt solid #98A2B3;overflow-wrap:anywhere}
  thead th{border-bottom:1pt solid #000;font-weight:700;letter-spacing:0;text-transform:none}
  tr{break-inside:avoid} tbody tr:nth-child(even) td{background:#F2F4F7;print-color-adjust:exact}
  td.num,th.num{white-space:nowrap;text-align:end;font-variant-numeric:tabular-nums}
  tfoot td{border-top:1.5pt double #000;font-weight:700}
  [data-print-priority="3"].hide-on-fit{display:none}
}
```

**80mm receipt:**
- Printable width is 72mm (576 dots at 203dpi).
- Pure black only, no grey (thermal printers dither it).
- Body 12px at weight 600, total 16px bold.
- Item name on its own line, then `qty × price ……… amount` aligned to the end.
- Content: header with pharmacy name, phone, invoice number, cashier and date; footer with a return policy line and a QR code.
- Print it from a hidden iframe so the page name applies cleanly.

```css
@media print{
  @page receipt{size:80mm auto;margin:0}
  .receipt-80{page:receipt;width:72mm;margin:0 4mm;font:600 12px/1.4 "PC";color:#000}
  .receipt-80 .total{font-size:16px;font-weight:700}
  .receipt-80 .row{display:flex;justify-content:space-between;gap:2mm}
  .receipt-80 .rule{border-top:1px dashed #000;margin:2mm 0}
}
```

## F. Top 10 standards applied

1. **WCAG 2.2 SC 1.4.3 / 1.4.11** — text contrast ≥ 4.5:1 and UI component contrast ≥ 3:1 (A6, palette).
2. **WCAG 2.2 SC 2.5.8 Target Size** (24px minimum) together with **Apple HIG 44pt / Material 48dp** targets.
3. **WCAG 2.2 SC 2.4.3 / 2.4.11** — focus order and focus not obscured (drawer, modal, sticky bars).
4. **WCAG 2.2 SC 1.4.10 Reflow** — no 2-D scrolling at 320 CSS px (KPI cards, card-list tables).
5. **Material 3 Navigation** — navigation bar for 3–5 destinations, rail at medium widths, drawer at expanded widths.
6. **IBM Carbon Data Table** — numbers align to the header edge, tabular figures, density tiers.
7. **Nielsen heuristics #1, #4, #7** — system status, consistency, accelerators (timestamp, shortcuts).
8. **W3C CSS Paged Media L3 / CSS Fragmentation** — `@page` margin boxes, named pages, repeating `thead`.
9. **Unicode UAX #9 Bidi** — `<bdi>`/isolate for numbers and currency inside RTL text.
10. **ISO 4217 and CLDR number formatting** — YER shown without decimals, locale digit systems via `-u-nu-latn`.