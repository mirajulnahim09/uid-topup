# Production Stabilization Report

**Date:** 2026-08-06
**Scope:** table/grid alignment root-cause elimination · layout regression audit · loading-experience redesign · regression sweep
**Verified against:** `next dev` for auth-dependent suites, `next build → next start` for performance
**Method:** rendered-output measurement in Playwright. No finding in this report is based on reading source alone.

| Suite | Result |
|---|---|
| `scripts/table-audit.ts` (new) | **444 column-checks × 6 viewports — 0 alignment issues** |
| `scripts/loading-test.ts` | **63/63** |
| `scripts/audit-pages.ts` | **0 issues / 32 pages** (0 overflow, 0 console errors, 0 failed requests) |
| `scripts/audit-system.ts` | **54/54** |
| `scripts/branding-test.ts` | **48/48** |
| `scripts/money-invariants.ts` | **18/18** |
| typecheck · lint · build | ✅ · ✅ · ✅ |

---

# 1. STRICT TABLE, GRID & COLUMN ALIGNMENT AUDIT

## 1.1 Root cause — a CSS specificity conflict, not per-page carelessness

The complaint was that table headers and row data do not share a vertical axis, across many pages, and that previous attempts had not fixed it. That is consistent with a single systemic cause, and there was one.

**First, what could *not* be the cause.** Every data table in this codebase is a real `<table>`. In a real table the browser's table layout algorithm guarantees that a column's *box* is identical for `<th>` and `<td>` — column boxes physically cannot drift. So the misalignment had to be **content alignment inside the box**, i.e. `text-align`.

**The actual cause.** The design system defines a column-role vocabulary that applies to header and cell with the same class, so they cannot diverge:

```css
table.tbl th.num, table.tbl td.num { text-align: right; }
table.tbl th.ctr, table.tbl td.ctr { text-align: center; }
```

But most tables had been written with raw Tailwind utilities instead — `<th className="text-right">` next to `<td className="text-right">`. That looks correct and reviews as correct. It is not:

```
.tbl thead th   → specificity (0,1,2)   ← carries @apply text-left
.text-right     → specificity (0,1,0)
```

Tailwind's utility layer is emitted *after* the component layer, but **specificity is evaluated before source order**. So `.tbl thead th`'s `text-left` beat every `text-right` written on a header — while the matching `<td className="text-right">` had nothing competing with it and applied normally.

**Result: the header stayed left, the data went right, in every money and count column in the application.** The `.num`/`.ctr` classes worked only because `table.tbl th.num` is (0,2,1), which outranks (0,1,2).

This is precisely why the bug survived earlier fixes: the source said `text-right` on both sides, so it read as already fixed. It is only visible in *computed* style.

### Measured proof (before the fix)

```
/admin/orders  [ultrawide] "মূল্য"           header=left data=right (th class="text-right")
/admin/coupons [ultrawide] "সর্বনিম্ন অর্ডার"  header=left data=right (th class="text-right")
/admin/users   [ultrawide] "ব্যালেন্স"        header=left data=right (th class="text-right")
/admin/users   [ultrawide] "অর্ডার"          header=left data=right (th class="text-right")
/admin/users   [ultrawide] "ডিপোজিট"         header=left data=right (th class="text-right")
/admin/logs    [ultrawide] "টাকা"            header=left data=right (th class="text-right")
…
89 issues total — 42 align-mismatch + 47 pixel-level ink drift, across 6 viewports
```

### Secondary causes ruled out by measurement, not assumption

| Suspected cause | Verdict |
|---|---|
| Different header/body widths | Impossible — single `<table>`, browser-guaranteed columns |
| Different `grid-template-columns` | Not applicable — only 2 files use grid, neither is a data table |
| `justify-between` / `justify-around` | Not present on any cell |
| Unequal padding | Uniform: `table.tbl thead th` and `tbody td` both `px-4 py-3.5` |
| `translateX/Y` on cells | None |
| Scrollbar compensation / overflow maths | `.table-wrap` scrolls the table, not the page — verified 0 page overflow |
| Cell-count mismatch (missing `<td>`) | Checked with colSpan arithmetic on every row — 0 mismatches |
| Responsive breakpoint conflicts | Re-measured at 6 viewports incl. 320px and 2560px — 0 |
| Duplicated table components | 5 table components + 6 page-level tables, all sharing `.tbl` |

## 1.2 Global solution

**1. One alignment vocabulary, enforced.** All 76 alignment utilities on `<th>`/`<td>` across 14 files were converted to `.num` / `.ctr`. `text-left` was removed outright — it was always a no-op on `.tbl` headers, and keeping it preserved a second vocabulary.

**2. A reusable layout engine so the divergence becomes structurally impossible.** New `src/components/ui/DataTable.tsx` takes one column definition and generates *both* the header and the cell from it:

```ts
export type Column<T> = {
  key: string;
  header: ReactNode;
  cell: (row: T, index: number) => ReactNode;
  align?: 'left' | 'right' | 'center';  // applied to th AND td from one field
  width?: string;                        // emitted once into <colgroup>
  className?: string;                    // applied to th AND td
};
```

Width is declared once and emitted into `<colgroup>` — there is no second width definition to fall out of sync. `colSpan` on the empty state is derived from `columns.length` rather than hand-counted, so adding a column cannot silently break it.

**3. A permanent guard, in two layers.** `scripts/table-audit.ts` fails if either:
- *source*: any `<th>`/`<td>` carries a Tailwind alignment utility (comment-aware, so documentation explaining the ban does not trip it); or
- *rendered*: any column's computed `text-align` differs between header and cells, at any of 6 viewports.

The rendered check is what catches regressions the source check cannot imagine; the source check is what catches regressions in columns that happen to have no data on the day the audit runs. Both are needed.

**4. What was deliberately *not* done.** A "last resort" CSS rule (`table.tbl th.text-right { text-align: right }`) was written and then removed: it broke the build with `You cannot @apply the text-left utility here because it creates a circular dependency` — defining a class that shadows a utility you `@apply` elsewhere is illegal in Tailwind. It was also the wrong idea, because it would have legitimised the second vocabulary this work exists to remove. Enforcement belongs in the audit, not in a CSS escape hatch.

## 1.3 Files modified

```
src/app/globals.css                          alignment authority + documented ban
src/components/ui/DataTable.tsx              NEW — single layout engine
scripts/table-audit.ts                       NEW — 6-viewport measurement + source guard
src/components/admin/OrderTable.tsx          text-right/center → num/ctr
src/components/admin/DepositTable.tsx        ″
src/components/admin/UserTable.tsx           ″
src/components/admin/CouponManager.tsx       ″
src/components/admin/ProductManager.tsx      ″
src/components/admin/telegram/AnalyticsPanel.tsx   ″
src/components/admin/telegram/BackupPanel.tsx      ″
src/components/admin/telegram/SchedulerPanel.tsx   ″
src/app/admin/logs/page.tsx                  ″
src/app/admin/users/[id]/page.tsx            ″  (3 tables)
src/app/account/page.tsx                     ″
src/app/account/orders/page.tsx              ″
src/app/account/smm-orders/page.tsx          ″
src/app/account/wallet/deposit/page.tsx      ″
```

## 1.4 Visual verification performed

`scripts/table-audit.ts` logs in as admin and, for every page:

- expands collapsed accordions and `<details>` before measuring — **without this the audit was lying**: `/admin/products`' price tables live inside collapsed rows and reported "0 tables", so the most complex tables in the app were never being checked;
- visits query-string variants — `/admin/deposits` renders a card *queue* by default and only shows `DepositTable` at other status filters, so the default URL never reached it;
- measures at **2560 / 1440 / 1280 / 820 / 390 / 320 px**;
- for each column compares computed `text-align` of the header against every cell, and separately measures where the *ink* sits inside each box using `Range.getBoundingClientRect()`;
- checks every row's cell count against the header span, colSpan-aware;
- checks page-level horizontal overflow.

**Final: 54 table-renders, 444 column-checks, 0 issues.**

> One assertion in this audit was itself wrong and was corrected rather than silenced. The ink-position check originally broke ties with `left <= right`, so a cell whose content fills the box (gaps `16px / 16px`) was classified as "left" while an identically-filled header was classified "right" — producing 24 false "drift" reports on columns that were in fact perfectly aligned. It now requires a *clear* side on both, with a 4px tolerance.

## 1.5 Why this will not return

1. The wrong thing is now **loud**: the audit fails the moment an alignment utility appears on a cell, naming file and line.
2. The right thing is now **easier than the wrong thing**: `DataTable` needs one `align` field instead of remembering to edit two places.
3. The trap is **documented where it bites** — `globals.css` carries the specificity arithmetic and the measured evidence, so the next person who reaches for `text-right` on a `th` reads why it silently fails.
4. The check is **rendered-output based**, so it stays true even if the CSS architecture changes underneath it.

---

# 2. LAYOUT REGRESSION

## 2.1 Navbar overflowed at exactly its own breakpoint — FIXED

`Navbar.tsx` chose the desktop layout with `authed ? 'min-[1440px]:flex' : 'xl:flex'`. The container is `max-w-[1440px]` with `xl:px-4`, so at a 1440px viewport only **1408px** is usable — but the full logged-in bar needs **1471px**. The breakpoint switched the layout on at precisely the width where it does not fit.

```
measured, /admin @1440:  scrollWidth 1471 − clientWidth 1440 = 31px overflow
offender:                <button>লগআউট</button>  right = 1471
after fix (min-[1520px]): scrollWidth 1440 − clientWidth 1440 = 0
```

A breakpoint must sit *above* the width at which its layout fits, never at it.

> **I previously told you this 31px was a false positive.** It was not. I first saw it while auditing a production build served over plain http, where NextAuth's `Secure` cookies are dropped and every page half-renders as logged-out — so I attributed it to that and moved on. It reproduced cleanly on `next dev`. Retracted and fixed.

## 2.2 Whole-application layout sweep

`audit-pages.ts` across 32 pages × 3 viewports: **0 HTTP failures, 0 console errors, 0 failed requests, 0 horizontal overflow.**

`table-audit.ts` additionally checks page overflow after expanding every collapsible panel. Two pages report overflow **only in that expanded-mid-transition state** (`/admin/tools` 80px, `/admin/homepage` 8px); probed directly after settling, both measure 0. Recorded as open (§5) rather than claimed fixed.

---

# 3. LOADING EXPERIENCE — REDESIGNED AROUND THE BRAND

Detail in `LOGIN_LOADING_REDESIGN_REPORT.md`. Summary of this pass:

The previous mascot was competent but **brand-agnostic** — a cat batting a generic glowing orb, which any site could have shipped. It was replaced with a scene that tells this platform's own story:

> A **diamond** (the product) is struck by the cat into the **SS UID TOPUP hexagon mark** (`VoltMark`'s exact geometry, not a lookalike). The mark ignites — its negative-space lightning bolt lights up, a shockwave and impact rays fire — and the cat reacts with a happy squint. Then it dims and repeats.

Every loop is the customer's own top-up, acted out. Brand hooks: the cat wears a **lime collar with a hexagon tag**, the stage is a hex energy platform, HUD corner brackets frame the scene like a launcher.

The animation now has a **dramatic structure** rather than just motion — anticipation (18–26%), strike (26–30%), flight (30–44%), **payoff at 44%**, joy (44–70%), reset. The old loop had no payoff beat, which is why it read as pleasant but forgettable.

**Measured:** 43 concurrent animations, 32 distinct, all 24 required behaviours present, every one `transform`/`opacity` only, **103 FPS** on a production build (headless CPU raster — the worst case).

---

# 4. REGRESSION SWEEP

| Area | Verification | Result |
|---|---|---|
| Authentication | login (valid + invalid), logout via real nav drawer, redirect, session survives navigation, rate-limit bucket | ✅ in `loading-test` §3/6/7 and every audit's login step |
| Money invariants | 18 assertions incl. wallet credit/debit, ledger `balanceAfter`, zero/negative rejection, full rollback | 18/18 |
| Branding management | 48 assertions incl. live rename, logo slots, restore | 48/48 |
| A11y | labelled inputs, alt text, named buttons, single h1, skip link, `lang` | in `audit-system` 54/54 |
| Reduced motion | global collapse verified; loading scene keeps only breathing/blink/messages | ✅ |
| Animation performance | every CSS animation compositor-only, app-wide | 27 animations: `transform`, `opacity` |
| Media fallback | deliberately-missing file renders placeholder, bounded console noise | ✅ |
| Dead code | 277 files scanned | 5 never-imported, all framework-convention (`global-error`, `next-auth.d`, barrels) |

### A methodology note worth keeping

Two audit failures in this pass (`reduced-motion collapses animations`, `missing image renders a placeholder`) were **flakes caused by running an audit while `next dev` was recompiling `globals.css`** — the page loads with stale or partial CSS and everything downstream misreports. Both passed on a settled server. Warm the affected route (or wait for the recompile) before trusting a dev-server audit result.

---

# 5. REMAINING / OPEN

Stated plainly rather than closed off:

1. **Expanded-panel overflow** — `/admin/tools` (80px) and `/admin/homepage` (8px) measure overflow immediately after programmatically expanding all panels, and 0 when probed directly after settling. Likely mid-transition measurement; not conclusively proven either way. Reproduce with `npx tsx scripts/overflow-find.ts "/admin/tools" --expand`.

2. **`DataTable` is shipped but not yet adopted by existing tables.** The alignment defect is eliminated everywhere by the vocabulary conversion and the two-layer guard, and `DataTable` makes the defect structurally impossible for new tables. Migrating the five existing complex tables (selection checkboxes, expandable rows, nested per-product price tables) is a mechanical but non-trivial refactor with real regression surface, and this was a *stabilization* pass — rewriting the admin panel's data layer would have worked against that goal. Recommended as a separate, individually-verified change.

3. **Scope I did not complete.** The brief also asked for a full functional pass ("click every button, submit every form"), a security re-review, and a database/N+1 review. I did not do those in this pass, and I am not going to imply otherwise. What *is* covered: every page loads clean at 3 viewports, auth flows work end-to-end, money invariants hold under rollback, and branding CRUD round-trips. The uncovered areas are: exhaustive form submission across admin CRUD, an authorization matrix per role per endpoint, and query-plan/index review.

4. **Tables with no data** are verified by the source guard rather than by pixel measurement, since they render an empty state instead of a table. `/account/*` tables were empty for the admin account used by the audit.
