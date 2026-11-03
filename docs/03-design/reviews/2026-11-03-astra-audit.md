## A. Defects found (ordered by severity)

Evidence references symbols/selectors because supplied files have no line numbers.

1. **P0 — Printed reports lose financial data.**  
   **Evidence:** `ReportTable` retains `overflow-x-auto` and nowrap cells; print CSS never resets overflow or constrains columns. `ReportView` calls `window.print()` on the entire application. At print root `12px`, `text-xs` headings become **9px**.  
   **Standard:** IBM Carbon print guidance; Nielsen error prevention.  
   **Fix:** Dedicated print document, explicit column widths, 10.5pt body, landscape fallback—not “shrink to fit.” Implement E. Disable print while loading, errored, or empty; print the selected report only.

2. **P1 — KPI layout cannot accommodate its content.**  
   **Evidence:** `Dashboard` forces four columns at 1024px. With the existing 15px root: sidebar 247.5px, content gutters 60px, gaps 33.75px → **170.7px/card**. After padding, borders, icon, chevron and gaps, approximately **52.4px remains for the value**. `Money` permits currency wrapping; `.stat-value` also applies LTR direction to the entire mixed-language value.  
   **Standard:** WCAG 1.4.10 Reflow, 1.4.4 Resize Text.  
   **Fix:** Header row contains icon, label and chevron; amount occupies a separate full-width row. Remove `num` from `.stat-value`; isolate digits only.

   ```css
   .kpi-grid {
     display:grid;
     grid-template-columns:repeat(auto-fit,minmax(min(100%,18rem),1fr));
     gap:1rem;
   }
   .stat-value { font-size:1.75rem; line-height:1.25; }
   .money { display:flex; flex-wrap:wrap; align-items:baseline; gap:.25rem .5rem; }
   .money-currency { white-space:nowrap; font-size:.875rem; }
   ```
   Use `<bdi dir="ltr" className="num">` for the amount. Currency may move **as one unit** below it. Test negative amounts and `999,999,999,999.99` at 320px and 200% zoom; never ellipsize money. Match skeleton columns.

3. **P1 — Modal semantics claim modality without enforcing it.**  
   **Evidence:** `Modal` and mobile drawer implement Escape but neither initial focus, focus containment, background inertness nor focus restoration.  
   **Standard:** WCAG 2.1.1, 2.4.3; WAI-ARIA APG modal pattern.  
   **Fix:** Use native `<dialog>.showModal()` in supported WebViews, with initial focus, labelled title, localized close label and opener restoration. Otherwise implement the APG pattern explicitly. Only the topmost overlay handles Escape; closing a payment dialog must not discard its draft.

4. **P1 — Secondary text and control boundaries lack contrast.**  
   **Evidence:** `NavList` headings and dashboard captions use `ink-400`: **≈2.6:1 on white**, below 4.5:1. Form `ink-300` borders are approximately 1.6:1. White success-toast text on emerald-600 is approximately 3.8:1.  
   **Standard:** WCAG 1.4.3, 1.4.11.  
   **Fix:** Use `ink-500` for secondary text, `ink-500` for essential input boundaries, emerald-700 for success toasts. Use a solid 2px brand-700 focus outline with 2px offset; translucent glow is supplementary.

5. **P2 — Touch sizes contradict comments and vary by viewport.**  
   **Evidence:** 15px root makes `2.75rem` **41.25px**, not 44px; coarse-pointer `.btn-sm` is **37.5px**. `.btn-icon` fixes width at 37.5px.  
   **Standard:** Apple HIG touch guidance; WCAG 2.5.8 minimum is 24px, not 44px.  
   **Fix:** `html { font-size:100%; }`; coarse-pointer buttons, navigation rows and labelled checkbox targets: minimum **48×48px**. Fine-pointer controls: 40px high; icon targets: 40×40px. Remove conflicting `h-9/w-9` overrides.

6. **P2 — RTL select padding protects the wrong edge.**  
   **Evidence:** `styles.css select` places the arrow left but increases RTL inline-start padding, which is right.  
   **Standard:** W3C internationalization logical-layout guidance.  
   **Fix:**
   ```css
   select { padding-inline:.75rem 2rem; background-position:left .75rem center; }
   [dir="ltr"] select { background-position:right .75rem center; }
   ```
   Update `document.documentElement.lang` and `.dir` when locale changes; shell-only direction misses portals and print documents.

7. **P2 — Preferences occupy primary workflow space; hierarchy stops at groups.**  
   **Evidence:** `UserBox` exposes language directly; `NavItem` has no children. F1 appears visually, but no handler exists in supplied code.  
   **Standard:** Nielsen consistency and recognition-over-recall.  
   **Fix:** Implement D; replace language button with Profile. Personal preferences must remain accessible without `settings.read`.

8. **P2 — Error assistance and notifications are incomplete.**  
   **Evidence:** `Field` lacks error/hint IDs and control associations; toast dismissal is pointer-only and errors disappear after four seconds.  
   **Standard:** WCAG 1.3.1, 2.1.1, 3.3.1.  
   **Fix:** Connect hints/errors using `aria-describedby`, set `aria-invalid`, add a labelled dismissal button, and retain actionable errors until dismissed.

## B. Typography & colour study

Self-host **IBM Plex Sans Arabic + IBM Plex Sans**, both OFL; ship 400/500/600/700 WOFF2. Select Arabic by `[lang="ar"]`; use Latin Plex for English and numeric spans. Remove Arabic `tracking-tight`, `tracking-wide` and uppercase styling.

Sizes below are **font-size/line-height, rem** at a default 16px root:

| Role | Phone | Desktop |
|---|---:|---:|
| Page heading | 1.5/2.125 | 1.75/2.5 |
| Section heading | 1.125/1.75 | 1.25/1.875 |
| Body/control | 1/1.5 | 1/1.5 |
| Table/secondary | .875/1.375 | .875/1.375 |
| Caption/badge | .8125/1.25 | .8125/1.25 |
| KPI | 1.75/2.1875 | 2/2.5 |

**Money:** tabular lining numerals; fixed currency-specific precision; separate currency labels from numeric columns. Preserve integer minor-unit arithmetic. Offer Western/Arabic-Indic digits as a preference; never mix numbering systems within a report.

Recommended pairings; contrast ratios approximate:

| Use | Foreground / background | Ratio |
|---|---|---:|
| Primary text | `#101828 / #FFFFFF` | 17.8:1 |
| Secondary text | `#667085 / #FFFFFF` | 5.0:1 |
| Primary button | `#FFFFFF / #15786B` | 5.3:1 |
| Success badge | `#065F46 / #ECFDF5` | 7.3:1 |
| Warning badge | `#92400E / #FFFBEB` | 6.8:1 |
| Danger badge | `#9F1239 / #FFF1F2` | 7.3:1 |
| Dark text | `#EEF0F4 / #101828` | 15.6:1 |

Keep white cards over `#F7F8FA`; avoid decorative amber. Dark tokens: canvas `#101828`, surface `#1D2939`, primary text `#EEF0F4`, secondary `#C5CCD8`. Map CSS variables through Tailwind; validate every dark interactive state separately.

## C. Spacing & layout system

- **Grid:** 4px micro-spacing; 8px structural spacing. Token sequence: 4, 8, 12, 16, 24, 32, 48px.
- **Cards:** 16px phone / 24px desktop padding; 12px radius; 1px border. Internal label→value 8px; sections 24px apart.
- **Shell:** sidebar 264px at ≥1024px; topbar 56px plus top safe area; bottom navigation 64px plus bottom safe area. Drawer width `min(320px, calc(100vw - 48px))`.
- **Content:** gutters 16px phone, 24px tablet, 32px desktop. Inner wrapper max-width 1440px, centered **inside** the sidebar-offset region. Forms max-width 640px.
- **KPI math:** at 1024px, available width = `1024−264−64=696px`: two cards `(696−16)/2=340px`. At 1600px: `1272px`, four cards `(1272−48)/4=306px`. At 320px: one 288px card.
- **Safe areas:** reserve `64px + env(safe-area-inset-bottom) + 16px` beneath phone content. POS payment dock uses the same reserve.
- **Tables:** desktop rows minimum 48px, optional 40px compact mode on fine pointers; phone rows minimum 56px. Cells: 12px inline padding; 8px block padding. Allow multiline rows to grow. Phone operational lists show 3–4 priority fields plus a details action; analytical tables may scroll with a labelled keyboard-focusable region.
- **Acceptance:** no page-level horizontal overflow at 320/360/768/1024px; test both languages and 200% text resizing.

## D. Navigation IA

Use existing `Icons`; nested destinations get no redundant icons.

- **Overview:** Dashboard `[dashboard]`
- **Sales:** POS `[pos]`; Sales `[sales]` → invoices, returns; Customers `[customers]`
- **Stock:** Items `[items]`; Inventory `[inventory]` → balances, movements, adjustments; Expiry `[expiry]`
- **Purchasing:** Purchasing `[purchasing]` → orders, goods receipts; Suppliers `[suppliers]`; Payables `[payables]`
- **Finance:** Cash `[cash]` → shifts, reconciliation; Expenses `[expenses]`; Accounting `[accounting]`
- **Analysis:** Reports `[reports]` → sales, stock, purchasing, cash
- **Administration:** Users `[users]` → accounts, roles; Settings `[settings]` → pharmacy, devices/printing
- **Profile:** language, numbering system, theme **System/Light/Dark**, password, sign out.

Use disclosure buttons with `aria-expanded` and nested lists—not ARIA menu widgets. Add optional `children` to `NavItem`; recursively filter permissions. Hide empty sections; authorization remains server-enforced.

Breadcrumbs: `Reports → Sales → Daily sales`; last item is current, not linked. Phone: back destination plus current title.

| Scope | Default shortcuts |
|---|---|
| Global | Ctrl+K command/search; Ctrl+Alt+P POS; Ctrl+Alt+R reports; Escape closes top overlay |
| POS only | F2 item search; F4 customer; F8 payment review; Ctrl+Enter confirms **reviewed** payment |

Remove F1. Publish shortcuts in Profile/help and `aria-keyshortcuts`; permit remapping. Ignore global actions in editable fields except explicitly supported combinations; suppress held-key repeats. Test Windows/browser conflicts.

## E. Print architecture

Render a dedicated same-origin print document without Shell. Pass an immutable report snapshot, locale and applied filters; await `document.fonts.ready` before printing.

**A4:** 12mm margins → **186mm portrait / 273mm landscape** usable width. Header: pharmacy name/logo, report title, generation timestamp/timezone, period, branch, filters and currency. Repeat column headings; totals appear once.

Extend columns with `printWidthMm`, `printPriority`, `printLabel`. Allocate widths through `<colgroup>`; reserve measured numeric widths, wrap descriptions. If widths exceed 186mm, use landscape; above 273mm, split into labelled continuation tables repeating invoice ID/date. Never silently omit columns.

```css
@page report {
  size:A4 portrait; margin:12mm;
  @bottom-center { content:counter(page) " / " counter(pages); }
}
@media print {
  .report-print { page:report; font-size:10.5pt; line-height:1.4; }
  .report-scroll { overflow:visible!important; max-height:none!important; }
  .report-print table { width:100%; min-width:0!important; table-layout:fixed; border-collapse:collapse; }
  .report-print thead { display:table-header-group; }
  .report-print th { position:static!important; white-space:normal; }
  .report-print th,.report-print td { font-size:10.5pt; padding:2mm; }
}
```

Reset printable text cells to normal wrapping; isolate and right-align numbers. Apply `break-inside:avoid` to ordinary rows; permit exceptionally tall descriptions to split. Set `tfoot { display:table-row-group; }` to prevent repeated grand totals.

Margin-box page counters require runtime verification in the deployed WebView2. If unsupported, paginate measured rows into explicit page sections after fonts load, repeat headers, and render “page n/N” in each reserved footer. Do not depend on browser-added URLs/headers.

**80mm:** separate receipt stylesheet/document; configure driver paper width 80mm, zero driver margins, 100% scale. CSS cannot reliably select roll length.

```css
@page { margin:0; }
@media print {
  html,body { margin:0; padding:0; background:white; color:black; }
  .receipt-80 { width:72mm; margin:0 auto; font-size:10pt; line-height:1.4; }
  .receipt-80 table { width:100%; min-width:0; table-layout:fixed; }
  .receipt-80 th,.receipt-80 td { padding:1mm 0; font-size:10pt; }
  .receipt-80 tr { break-inside:avoid; }
}
```

Stack item name above quantity × unit price and total; include pharmacy, receipt ID, date, cashier, tender/change and currency. Test physical thermal output and 100-row A4 reports—not preview alone.

## F. Top 10 international standards/research applied

1. **WCAG 2.2:** contrast, reflow, keyboard access, focus and target-size acceptance criteria.
2. **WAI-ARIA APG:** modal focus lifecycle, disclosure navigation and breadcrumbs.
3. **W3C Internationalization / Unicode UAX #9:** logical layout and bidirectional isolation.
4. **CSS Paged Media Level 3:** page dimensions, margins and running page counters.
5. **CSS Fragmentation Level 3:** predictable row and page breaking.
6. **IBM Carbon Design System:** readable table density, alignment and print adaptation.
7. **Material Design 3:** 48dp-equivalent touch targets and role-based colour tokens.
8. **Apple Human Interface Guidelines:** touch ergonomics, safe areas and text adaptability.
9. **Nielsen’s usability heuristics:** workflow hierarchy, consistency and error prevention.
10. **ISO 9241-110:2020:** task suitability, controllability and use-error robustness.