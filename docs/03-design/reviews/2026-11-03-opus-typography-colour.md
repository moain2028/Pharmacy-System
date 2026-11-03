## A. Defects found (ordered by severity)

**A1 — Print clips report data (Critical).**
*Evidence:* `ReportTable` wraps the table in `overflow-x-auto`. `.table-wrap table{min-w-[40rem]}` and `thead th{whitespace-nowrap}` force width. `html{font-size:12px}` makes `text-xs` 9px. `tfoot` repeats on every printed page, so totals appear mid-report. There is no header or footer.
*Violates:* WCAG 1.4.10 Reflow, Carbon data-table print guidance, and ISO 9241-112 (discriminability).
*Fix:* Use the print CSS in §E. Also add `<PrintHeader/>` (`hidden print:block`) inside `ReportView`, and change the wrapper to `className="overflow-x-auto print:overflow-visible"`.

**A2 — KPI amount collides with the icon; currency wraps and sits on the wrong side (Critical, visible).**
*Evidence:* `Stat` uses a fixed 44px icon and `gap-3`. Inside a `grid-cols-2` card about 160px wide, `text-2xl font-extrabold` cannot fit. `Money` is `inline-flex` with no `min-w-0` or `flex-wrap`. The label "ر.ي جديد" contains a breakable space. `.stat-value` applies `.num` (`direction:ltr`) to the whole flex row, so the currency lands right of the number in RTL.
*Violates:* WCAG 1.4.4 and 1.4.12, and Unicode UAX #9 (bidi isolation should apply only to the digits).
*Fix:*
```css
.kpi{container-type:inline-size}
.kpi-row{display:flex;gap:.75rem;align-items:flex-start}
@container (max-width:15rem){.kpi-row{flex-direction:column}.kpi-icon{width:2rem;height:2rem}}
.kpi-value{font-size:clamp(1.25rem,9cqi,1.875rem);line-height:1.15;font-weight:700;
  display:flex;flex-wrap:wrap;align-items:baseline;column-gap:.25rem;min-width:0}
.kpi-cur{font-size:.75rem;font-weight:600;white-space:nowrap;color:theme(colors.ink.600)}
```
In `Money`, render the amount as `<bdi className="tnum">` and drop the `num` class from the wrapper. Build the label with `.replace(/ /g,"\u00A0")`. For YER KPIs, use `maximumFractionDigits:0`; show ".00" only on invoices and receipts.

**A3 — Contrast failures.**
*Evidence:*
- `text-ink-400` (#98a2b3) on white is **2.58:1**. It is used for nav group labels, "salesByCurrency" headings, and `×count`.
- Success toast `bg-emerald-600` with white text is **3.77:1**.
- `brand-500` used as text would be 3.65:1.

*Violates:* WCAG 1.4.3 (4.5:1 required).
*Fix:* The minimum for text is `ink-500` (new value, 5.48:1). Toasts use `emerald-700` (5.48:1). `ink-400` is allowed only for disabled controls and decorative icons.

**A4 — Letter-spacing and uppercase applied to Arabic.**
*Evidence:* `thead th{uppercase tracking-wide}`, group labels `tracking-wider`, `h1-h3 tracking-tight`. Tracking breaks the joining of Arabic letters.
*Violates:* W3C *Arabic & Persian Layout Requirements* (ALReq) §letter-spacing.
*Fix:*
```css
:lang(ar) *{letter-spacing:0!important;text-transform:none!important}
```
Separately, keep Latin headers at `tracking-[.02em]`, not "wide".

**A5 — Root size 15px plus 9–11px text.**
*Evidence:* `html{font-size:15px}`, `text-[10px]` on `.kbd`, `text-[11px]` on nav labels and the bottom nav.
*Violates:* WCAG 1.4.4, which requires respecting the user's font setting. Arabic below 12px is illegible (ALReq; Apple HIG minimum 11pt Latin).
*Fix:* Use `html{font-size:100%}`. Set the minimum to **12px Latin / 13px Arabic**, using the scale in §B.

**A6 — `lang`/`dir` set on a `<div>`; language toggle placed in primary navigation.**
*Evidence:* `<div dir={dir}>` in `Shell`, and the toggle inside `UserBox`.
*Violates:* WCAG 3.1.1 (screen readers keep the wrong voice; the scrollbar stays on the wrong side) and Nielsen #8 (minimalist design).
*Fix:*
```ts
useEffect(()=>{const h=document.documentElement;h.lang=locale;h.dir=dir;},[locale,dir]);
```
Remove the globe button. Move the control to Settings › Preferences and the avatar menu (§D).

**A7 — Numeric header and cell alignment differ in RTL.**
*Evidence:* `th.text-end` resolves to the left in RTL. `td.num` has `direction:ltr` plus `text-align:end`, which resolves to the right.
*Violates:* Carbon data table rule that numeric columns align with their header.
*Fix:*
```css
.num{text-align:end;white-space:nowrap}          /* logical, inherits table dir */
.num>*,.tnum{direction:ltr;unicode-bidi:isolate;font-variant-numeric:tabular-nums lining-nums}
```
Render each cell as `<td className="num"><bdi>{v}</bdi></td>`.

**A8 — Dialog and drawer accessibility.**
*Evidence:*
- `Modal` has no initial focus, no focus trap, and does not restore focus.
- The close button is a literal `✕` with `aria-label="close"`, which is not translated.
- `aside`, `nav`, and the bottom nav all share `aria-label={t("nav.main")}`.

*Violates:* WCAG 2.4.3, 2.4.11 (Focus Not Obscured), and the ARIA APG Dialog pattern (landmarks need unique labels).
*Fix:*
- Use native `<dialog>` with `showModal()`, which gives a free trap and Esc handling. Refocus the opener on close.
- Use `aria-label={t("common.close")}` with the `Icons.close` icon.
- Relabel the bottom nav as `nav.quick`. Drop the label from `aside`, since the inner `nav` already carries it.

**A9 — Minor issues.**
- The Toaster `bottom` offset includes the bottom nav on desktop. Add `lg:!bottom-6`.
- The dashboard refresh button is labelled `common.retry`. Change it to `common.refresh`.
- The checkbox rule sets both `w-4` and `w-auto`. Delete `w-auto`.
- Drawer Esc handling is registered even when the drawer is closed. Guard it with `if(!drawer) return`.

---

## B. Typography & colour study

**Why it "feels off":** Three causes combine.
1. The cool blue-grey neutrals (Untitled-UI "ink", hue about 220°) clash with the green teal (about 172°).
2. Tajawal has a small Arabic x-height and a weak Latin companion.
3. Tajawal has no true `tnum`, so amounts jitter as digits change.

**Font pairing (both OFL, self-hosted woff2):**
- **IBM Plex Sans Arabic**: weights 400, 500, 600, 700, with `unicode-range: U+0600-06FF, U+0750-077F, U+FB50-FDFF, U+FE70-FEFF`.
- **IBM Plex Sans**: weights 400, 600, Latin subset, with real `tnum` and `lnum`.

The two families share the same metrics and design DNA (Carbon). Declare Latin first in the stack so digits and Latin always come from Plex Sans:
```js
fontFamily:{sans:['"IBM Plex Sans"','"IBM Plex Sans Arabic"','"Segoe UI"','Tahoma','sans-serif']}
```

**Type scale (rem; 1rem = 16px):**

| Token | Phone | Desktop ≥1024 | Use |
|---|---|---|---|
| caption | .8125/1.25 | .75/1.125 (Latin only) | hints, kbd |
| body-sm | .875/1.4 | .8125/1.35 | table cells (desktop) |
| body | 1/1.6 | .9375/1.55 | forms, text |
| label | .875/1.3 w600 | .8125/1.3 w600 | field labels, th |
| h3 | 1.0625/1.4 w600 | 1.125/1.4 | card titles |
| h2 | 1.25/1.35 w700 | 1.375/1.3 | section |
| h1 | 1.5/1.3 w700 | 1.75/1.25 | page |
| kpi | clamp(1.25,9cqi,1.875)/1.15 w700 | same | money |

Arabic body text needs line-height of at least 1.55 because of descenders and diacritics. Avoid weight 800.

**Money and numerals:**
- Format with `ar-YE-u-nu-latn`. Western digits keep receipts, barcodes, and the POS consistent, which is standard in Yemeni retail. Offer Eastern Arabic digits as a preference.
- Always use `tabular-nums lining-nums`.
- Display the currency as a suffix at 0.75em, weight 600, in `ink-600`.
- Show negatives with the minus sign `−` (U+2212) and `danger-700`. Colour alone must not carry meaning (WCAG 1.4.1).

**Palette (contrast measured against white unless noted):**

| Pair | Ratio | WCAG |
|---|---|---|
| ink-900 #121A1D on white / on ink-50 | 17.6 / 16.9 | AAA |
| ink-700 #343E43 on white | 10.9 | AAA |
| ink-600 #4A555A on white | 7.7 | AAA |
| ink-500 #5F6B70 on white (minimum text) | 5.48 | AA |
| White on brand-700 #0F766E (primary button) | 5.47 | AA |
| White on brand-800 #115E59 (hover/pressed) | 7.58 | AAA |
| brand-500 #238F89 focus ring vs white | 3.9 | AA non-text (1.4.11) |
| brand-800 on brand-50 (badge) | 8.9 | AAA |
| success-700 #047857 on white / white on it | 5.48 | AA |
| warning-800 #92400E on warning-50 #FFFBEB | 6.8 | AA |
| danger-700 #BE123C on white | 6.3 | AA |
| info-800 #075985 on info-50 #F0F9FF | 7.2 | AAA |
| Dark: #E6ECED on #0E1517 / muted #9FB0B4 | 15.5 / 8.2 | AAA |

**Tailwind `extend.colors`:**
```json
{
 "brand":{"50":"#F0F9F8","100":"#D9F0EE","200":"#B3E0DC","300":"#80C9C3","400":"#4AABA4","500":"#238F89","600":"#14807A","700":"#0F766E","800":"#115E59","900":"#123F3C","950":"#052B28"},
 "ink":{"50":"#F8FAFA","100":"#F1F4F4","200":"#E3E8E8","300":"#CBD3D4","400":"#9AA6A8","500":"#5F6B70","600":"#4A555A","700":"#343E43","800":"#1F272B","900":"#121A1D"},
 "success":{"50":"#ECFDF5","200":"#A7F3D0","700":"#047857"},
 "warning":{"50":"#FFFBEB","200":"#FDE68A","600":"#D97706","800":"#92400E"},
 "danger":{"50":"#FFF1F2","200":"#FECDD3","600":"#E11D48","700":"#BE123C"},
 "info":{"50":"#F0F9FF","200":"#BAE6FD","800":"#075985"},
 "dark":{"bg":"#0E1517","surface":"#162023","raised":"#1D292C","border":"#2A383C","text":"#E6ECED","muted":"#9FB0B4"}
}
```
In code, change `btn-primary` to `bg-brand-700 hover:bg-brand-800`. The active nav item becomes `bg-brand-50 text-brand-800` with a 3px start bar (`before:` pseudo-element in `brand-700`), replacing the solid fill, which is calmer (Material 3 nav-rail indicator). Expose the dark tokens through CSS variables keyed on `[data-theme=dark]`.

---

## C. Spacing & layout system

**Grid rules:**
- 4px base. Component internals use 4, 8, or 12px. Layout spacing uses only 16, 24, 32, 48px.
- No `.5` utilities except `py-2.5` on 40px controls.

**Cards:**
- Padding: 16px on phone, 20px at md, 24px at xl or larger.
- Gaps: 12px between cards on phone, 16px at md, 24px at xl.
- Card title to body: 12px.
- Radius: 12px on cards, 8px on controls (Carbon/M3 medium).

**Content width:**
- Forms: max 720px.
- Reading text: max 72ch.
- Data pages: fluid up to 1440px, centred.

**Shell dimensions:**

| Element | Size |
|---|---|
| Sidebar | 256px at ≥1280; 72px icon rail (tooltips) at 1024–1279 |
| Sidebar item | 40px tall, 12px inline padding, 20px icon, 12px gap |
| Sidebar group | 24px between groups; label 13px, `ink-600`, 8px below it |
| Topbar | 56px on desktop, 56px plus `env(safe-area-inset-top)` on phone |
| Bottom nav | 64px plus safe-bottom; each hit area ≥48×48; label 12px; indicator 56×32 pill (M3) |
| Drawer | `min(20rem, 85vw)` |
| Touch targets | ≥44×44 on coarse pointers (WCAG 2.5.8 minimum is 24; HIG 44) |
| Spacing between targets | ≥8px |

**Table density:**

| Context | Row height | Cell padding | Font |
|---|---|---|---|
| Desktop default | 40px | 12px inline | body-sm |
| Desktop compact (user toggle) | 32px | 8px inline | body-sm |
| Phone | 48px | 12px | 14px |

On phone, use a two-line card list below 640px instead of a 640px-min scrolling table: primary text, secondary meta line, and the amount at the end. Keep horizontal scroll only for reports, and pin the first column with `sticky start-0`.

---

## D. Navigation IA

Sections are non-interactive headings (`<h2 id>` plus `<ul aria-labelledby>`). Sub-items expand as a disclosure (`aria-expanded`), with at most two levels (NN/g; Carbon UI Shell). Navigation shortcuts use `g` followed by a key.

| Section | Item | Icon | Sub-items | Shortcut |
|---|---|---|---|---|
| **Overview** | Dashboard | `layout-dashboard` | — | `g` `d` |
| **Sales** | POS | `scan-barcode` | — | `F2` (global) |
| | Invoices | `receipt` | All · Held · Today | `g` `s` |
| | Returns | `undo-2` | — | `g` `r` |
| | Customers | `users` | List · Credit balances | `g` `c` |
| **Inventory** | Items | `pill` | Catalogue · Categories · Units & barcodes | `g` `i` |
| | Stock | `boxes` | On hand · Adjustments · Transfers · Stock count | `g` `k` |
| | Expiry | `calendar-clock` | 30 / 60 / 90 days · Expired | `g` `e` |
| **Purchasing** | Purchase orders | `clipboard-list` | — | `g` `o` |
| | Goods receipts | `package-check` | — | — |
| | Suppliers | `truck` | — | `g` `u` |
| | Payables | `file-text` | — | — |
| **Finance** | Cash & shifts | `wallet` | — | `g` `h` |
| | Expenses | `banknote` | — | — |
| | Accounting | `book-open` | Journal · Chart of accounts · Trial balance | — |
| **Reports** | Sales, Profit, Stock valuation, Expiry, Purchases, Cash, Audit log | `bar-chart-3` | — | `g` `p` |
| **Administration** | Users & roles | `shield` | — | — |
| | Settings | `settings` | Pharmacy profile (name, logo, tax no.; feeds print headers) · Printers & receipt · Currencies · Backup | `g` `,` |

Reports is promoted to its own section because it is cross-domain.

**Where language and theme belong:**
- **Settings › Preferences (per user):** language, theme (light / dark / system), digits, density, receipt preview.
- **Avatar menu** at the end of the topbar, opened with `Alt+U`: profile, Preferences, Keyboard shortcuts (`?`), Lock (`Ctrl+L`), Sign out.
- **Login screen:** a small language switcher is required here because the user is not yet signed in.
- **Not** in primary navigation.

**Global shortcuts:**

| Keys | Action |
|---|---|
| `Ctrl+K` | Command palette (search pages, items, customers) |
| `/` | Focus page search |
| `?` | Shortcut sheet |
| `Alt+N` | New record on the current page |
| `Ctrl+P` | Print current view |
| `Ctrl+L` | Lock |
| `Esc` | Close the top layer |
| `F1` | Help (Windows CUA convention). Move POS off F1. |

**POS shortcuts:**

| Keys | Action |
|---|---|
| `F2` | Barcode/search field |
| `F3` | Quantity of the last line |
| `F4` | Customer |
| `F6` | Discount |
| `F7` | Hold sale |
| `F8` | Recall sale |
| `F9` | Payment method |
| `F12` | Pay / complete |
| `+` / `−` | Change quantity |
| `Del` | Remove line |
| `Ctrl+R` | Reprint last receipt |
| `Ctrl+Shift+X` | Void (with confirmation) |

**Implementation rules:**
- Match on `e.code` (`KeyD`), not `e.key`, so shortcuts work with an Arabic keyboard layout active.
- Ignore single-key shortcuts while an input has focus, as WCAG 2.1.4 requires.
- Display `kbd` hints only when `(pointer:fine)`.
- Mirror arrow-key semantics in RTL.

**Breadcrumbs:**
- Desktop topbar: `Section › Page › Record` as `<nav aria-label="breadcrumb"><ol>`, with `aria-current="page"` on the last item.
- Separator: a chevron with `rtl:rotate-180`.
- Phone: a back arrow plus the page title instead of the trail.

---

## E. Print architecture

```css
@media print{
  @page{size:A4;margin:14mm 10mm 16mm;
    @top-center{content:element(runHead)}
    @bottom-left{content:"صفحة " counter(page) " / " counter(pages);font:8pt "IBM Plex Sans Arabic"}
    @bottom-right{content:string(printedAt);font:8pt "IBM Plex Sans"}}
  @page wide{size:A4 landscape}
  @page receipt{margin:0}
  html{font-size:10pt}
  .report{page:auto}.report[data-cols-wide]{page:wide}           /* >8 cols ⇒ landscape */
  .print-head{display:block;border-bottom:1.5pt solid #000;padding-bottom:4mm;margin-bottom:4mm;string-set:printedAt attr(data-printed)}
  .overflow-x-auto,.table-wrap{overflow:visible!important;margin:0!important}
  table{min-width:0!important;width:100%;table-layout:fixed;border-collapse:collapse;font-size:9pt}
  thead{display:table-header-group}  tfoot{display:table-row-group}   /* header repeats, totals once */
  th{white-space:normal!important;text-transform:none;font:600 8.5pt/1.25 inherit;border-bottom:1pt solid #000;padding:1.5mm 1.5mm}
  td{padding:1.2mm 1.5mm;border-top:.4pt solid #bbb;overflow-wrap:anywhere;vertical-align:top}
  td.num,th.num{white-space:nowrap;overflow-wrap:normal}
  tr{break-inside:avoid} tfoot td{border-top:1.2pt solid #000;font-weight:700}
  [data-print-hide]{display:none!important}
  *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
}
```

**Header (`PrintHeader`):**
- Pharmacy logo, name, licence no. and phone, pulled from Settings › Pharmacy profile.
- Report title at 14pt.
- Filters line, e.g. "من 2025‑01‑01 إلى 2025‑01‑31 · الفرع: … · العملة: ر.ي".
- "Printed by @user · date/time".

WebView2 (Chromium 131+) supports page-margin boxes. As a fallback, a `position:fixed` footer repeats on every page in Chromium.

**Column fitting (no horizontal scroll):**
- Each `Column` gets `printWeight` (rendered as `<colgroup><col style="width:%">`) and `printPriority` (1 to 3).
- Up to 8 columns: portrait. 9 to 12: landscape.
- More than 12 columns: hide priority-3 columns and print a note: "أُخفيت N أعمدة — استخدم CSV".
- Never shrink below 8.5pt.
- Money columns are `nowrap`, tabular, and end-aligned. Text columns wrap.

**80mm receipt:**
```css
@media print{.receipt-80{page:receipt;width:72mm;margin:0 4mm;font:600 9.5pt/1.35 "IBM Plex Sans Arabic","IBM Plex Sans";color:#000}
 .receipt-80 .tot{font-size:12pt;font-weight:700}.receipt-80 .num{font-variant-numeric:tabular-nums}
 .receipt-80 .rule{border-top:1px dashed #000;margin:2mm 0}.receipt-80 img{max-width:40mm;filter:grayscale(1)}}
```
- Leave the paper length to the driver ("80 × Receipt"); the CSS sets only the width.
- Use weight 600 throughout, because thin strokes vanish on thermal paper.
- Do not print greys lighter than #000.
- Add a QR/barcode for the invoice number at the bottom.

---

## F. Top 10 standards / research applied

1. **WCAG 2.2 SC 1.4.3 / 1.4.11:** 4.5:1 text and 3:1 UI contrast drove the palette table.
2. **WCAG 2.2 SC 1.4.4 / 1.4.12 / 1.4.10:** root 100%, no fixed-width clipping, reflow without scrolling.
3. **WCAG 2.2 SC 2.5.8 + Apple HIG:** ≥24px minimum targets, 44pt on touch.
4. **WCAG 2.2 SC 2.1.4 / 2.4.3 / 3.1.1:** remappable shortcuts, dialog focus order, page language.
5. **W3C ALReq (Arabic Layout Requirements):** no tracking or uppercase on Arabic, line-height ≥1.55.
6. **Unicode UAX #9 (Bidi):** `<bdi>` and isolate only the numerals.
7. **Material 3 navigation (rail, drawer, bar):** indicator pill, 64dp bar, 3 to 5 destinations.
8. **IBM Carbon data table and UI Shell:** numeric end alignment, density modes, two-level side nav.
9. **ISO 9241-110/112 and Nielsen heuristics #4 and #8:** consistency, minimalism (language out of primary nav).
10. **CSS Paged Media L3 / CSS Fragmentation L3:** `@page` margin boxes, named pages, repeating `thead`, `break-inside`.