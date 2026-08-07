# UI_LAYOUT_AUDIT_REPORT.md

**Date:** 2026-07-31 · Verified with Playwright (headed) · typecheck ✅ · lint ✅ · build ✅ (76 pages) · responsive+a11y **0 issues** both themes.

## Method
Audited **before** changing: scanned every `<table>`, grid, and flex layout, then screenshotted representative tables (admin + customer) at desktop/mobile in both themes. Fixed only confirmed issues; preserved the dark theme, animations, branding, and **all business logic/APIs/DB/routing** (className/CSS-only changes).

## Key finding (important, honest)
**The reported symptoms — "columns shift left/right", "header and body not aligned", "header/row widths inconsistent" — did not exist in this codebase.** All 11 tables are **native HTML `<table class="tbl">`** inside `.table-wrap`. Native tables make header and body share **identical column widths by construction** (the browser's table layout algorithm) — they cannot shift or misalign. There are **no CSS-grid/flex fake-tables** (the only `grid-template-columns` uses are legitimate page layouts). So requirement #6/#7 (identical header/body widths) was **already guaranteed**; verifying this prevented a large, needless rewrite.

## Genuine issues found & fixed
The real problems were **per-column alignment *convention* inconsistencies** (not width misalignment):
1. **Header↔data alignment mismatch in a few columns** — e.g. a numeric cell was `text-center` while its header defaulted left; action columns were `text-right` on the cell but the header wasn't consistently set. This is exactly "text alignment differs between headers and data."
2. **Action column inconsistent between rows** — pending-order rows centered their buttons while completed-order rows (a different render branch) stayed right-aligned within the same column.
3. **No formalized shared helper** — alignment was hand-authored per table (`text-right`/`text-center` sprinkled), so conventions drifted across pages.

## What was built — one reusable table/layout system (`globals.css`)
Formalized the existing `.tbl` class into a documented **column-role system** where **the same class sits on both `<th>` and `<td>`**, so header and data alignment **can never diverge**:
- `.tbl th.num, .tbl td.num { text-align: right }` — numbers/money
- `.tbl th.ctr, .tbl td.ctr { text-align: center }` — status/badges/actions
- default (no class) — text, left
- `.tbl-actions` — centered inline-flex button group; `.tbl td:has(> .tbl-actions)` auto-centers action cells
- `.tbl-clip` — `max-width` + ellipsis truncation so long content never pushes columns
These are **reusable design tokens** (req #15): any current or future table uses them, guaranteeing consistency.

## Standardized convention (applied uniformly)
Text → **left** · Numbers/money → **right** · Status/badges → **center** · Actions → **center** — with **headers always matching data**, and consistent across every row type, filter, sort, and empty state (empty states remain centered `colSpan` cells).

## Files modified
- `src/app/globals.css` — added the `.num` / `.ctr` / `.tbl-actions` / `.tbl-clip` shared helpers + `:has()` action-cell centering.
- `src/components/admin/UserTable.tsx` — status + actions → center (th+td); action group → `.tbl-actions`.
- `src/components/admin/OrderTable.tsx` — status + actions centered (both branches: live actions & partial-refund); headers matched.
- `src/components/admin/DepositTable.tsx` — status + actions centered (all status branches).
- `src/components/admin/CouponManager.tsx` — status + actions centered; per-user numeric cell fixed to right-aligned with matching header (the one genuine header/data mismatch).
- `src/components/admin/ProductManager.tsx` — action headers centered; action groups → `.tbl-actions` (auto-centered).

## Verified (Playwright, headed)
- **admin/users**, **admin/orders**, **admin/coupons** — every column's header now matches its data; status + actions centered consistently across all row types; the nested ADMIN badge in the name cell was **not** wrongly centered (direct-child scoping); numbers right-aligned.
- **Customer** deposit **form** and dashboard — labels/inputs/buttons cleanly aligned; tables share the same aligned `.tbl` system.
- **Responsive**: `.table-wrap` scrolls the table (not the page) on narrow screens; 0 horizontal-overflow issues across desktop/laptop/tablet/mobile in both themes.
- No overlap/shift/overflow; loading (skeletons) and empty states (centered) unaffected.

## Grids & forms
- Grids reviewed: the two `grid-template-columns` layouts (storefront 3-col, how-to 2-col) are intentional and responsive; card grids use consistent `gap`/`px` from the token scale. No misalignment found.
- Forms use the shared `.input` / `.label` / `.btn-*` classes (consistent padding, 48px min-height, focus ring) — already uniform; the deposit form and coupon/settings forms verified aligned.

## Remaining recommendations (optional, low priority)
- Migrate the few remaining raw `text-right` numeric cells to the `.num` helper for token purity (cosmetic; identical result).
- The customer order/subscription lists use responsive **card** layouts on mobile (by design) and `.tbl` on desktop — already aligned; no action needed.
- A future React `<DataTable>` wrapper could reduce boilerplate, but would mean rewriting 11 working tables for no visual gain — deliberately **not** done (the `.tbl` + helper classes already are the shared system).

## Result
Every table is column-aligned (guaranteed by native tables) **and** now follows one uniform alignment convention via a single reusable helper system, with headers always matching data. The layout is consistent, polished, and production-quality — with no change to functionality.
