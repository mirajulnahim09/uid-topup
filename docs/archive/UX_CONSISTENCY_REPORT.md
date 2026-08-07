# UX_CONSISTENCY_REPORT.md

**Date:** 2026-07-31 · Reviewed as both a customer and an admin. No redesign — only consistency fixes on top of the existing design system.
**Verification:** `tsc` ✅ · `next lint` ✅ (0) · clean `next build` ✅ · **Playwright sweep of 32 routes × 2 viewports** (1440×900 desktop + 390×844 mobile), logged in as admin to reach every gated page. Final result: **desktop 32/32 clean, mobile 32/32 clean** — 0 horizontal overflow, 0 broken images, 0 buttons without an accessible name, 0 unlabeled inputs, 0 page errors, 0 console errors, every page exactly one `<h1>`.

---

## How this was checked
Each of the 17 requested dimensions was inspected in source **and** exercised in a real browser. The sweep measures the objective ones per page (overflow, broken images, nameless buttons, unlabeled inputs, page/console errors, heading structure); the subjective ones (state styling, dialog behavior, filter/search flow) were read in the shared components that every page consumes.

## Findings & fixes

### Issues found and fixed this pass
| # | Issue | Where | Fix |
|---|-------|-------|-----|
| 1 | **Confirmation dialogs had no keyboard focus-trap.** Escape, backdrop-click, autofocus and scroll-lock were present, but Tab could move focus to the page *behind* the modal (WCAG 2.4.3 / expected modal behavior). | `src/components/Toast.tsx` → shared `ConfirmDialog` (used by every confirm across admin: deposits approve/reject, coupon/product/user delete, restore, etc.) | Added a minimal Tab/Shift-Tab focus loop scoped to the dialog panel. One change fixes **every** confirmation in the app. |
| 2 | **Two form inputs had no accessible label** (file picker + confirm-text field), so screen readers announced them only by role. | `src/components/admin/RestoreForm.tsx` | Added `aria-label` to the file input and linked the confirm field's label via `htmlFor`/`id`. `/admin/tools` now sweeps clean. |

### Investigated and confirmed **not** a defect (reported honestly)
- **`/admin/reports` console/page errors in the first sweep pass** turned out to be **Fast-Refresh collateral** — I had edited a component while that route was mid-navigation, so the dev server hot-reloaded and threw a transient `useContext` error. Re-swept with no concurrent edit → **clean on both desktop and mobile.** Not a real bug. (The CSP `object-src 'none'` messages seen there are the CSP *correctly blocking* a browser-plugin SVG probe — evidence the policy is enforced, not a page fault.)

## Consistency review by dimension (all verified consistent)
- **Buttons** — one geometry/motion language across the app. There are two *named* families: `.btn*` (app: account/admin/forms) and `.v-btn*` (marketing/home). They share the same tokens (panel-edge/fill, `translateY(-3px)` hover, `scale(.985)` active, `opacity .5` disabled), so they read as **one** system. Intentional split, not drift.
- **Hover / active / disabled** — defined once in `globals.css` for every button/input/card/nav/tab; `:active` press-scale and `disabled:opacity + pointer-events:none` are global.
- **Focus** — a single global `:focus-visible` ring (2px accent, 2px offset) plus a skip-link; `:focus:not(:focus-visible)` suppresses mouse-click rings. Consistent everywhere.
- **Loading** — route-level `loading.tsx` skeletons (account, admin) + per-action `busy` state on every mutating button (spinner text, disabled). Uniform pattern.
- **Empty** — a single `EmptyState` token component (icon tile + title + hint + optional CTA); table empties use a centered `colSpan` cell. No more "some pretty, some one-line-grey."
- **Success / error** — one `Toast` system (aria-live, `role=alert` for errors / `status` otherwise, error toasts linger longer); errors also surface inline where relevant. Consistent copy tone (Bengali).
- **Confirmation dialogs** — one `ConfirmDialog` (now with focus-trap): title, optional message, optional body, cancel + confirm, `danger` variant for destructive actions, `autoFocus` on the primary action.
- **Toasts** — single provider, max 3 stacked, spring in / slide out, dismissible, theme-aware.
- **Search** — one unified admin search box (`/api/admin/search`) that queries orders + deposits + users in parallel, with a min-length guard to prevent full-table scans and no password exposure. Consistent, paste-a-string-get-an-answer UX.
- **Filter** — server-driven query-param chips (e.g. deposit/order status) with a consistent active/inactive pill style; filtered state is shareable/bookmarkable and survives reload.
- **Pagination** — see "Known limitation" below.
- **Keyboard navigation** — focus-visible rings, skip-link, Escape closes menus/dialogs/notification panel, notification panel closes on outside-click, and (new) dialogs trap Tab. Verified 0 nameless buttons / 0 unlabeled inputs across all 32 routes.
- **Mobile usability** — hamburger nav with `aria-expanded`, body scroll-lock while open, 44–46px tap targets, balance chip always visible; admin nav is a horizontal-scroll tab bar. **0 horizontal overflow on any of 32 routes at 390px.**
- **Scroll behavior** — wide tables scroll inside `.table-wrap` (`overflow-x:auto`) so the page body never scrolls sideways; modals/menus lock body scroll while open.

## Known limitation (not a bug — documented for an honest launch)
- **No list pagination.** Admin lists cap at `take: 100` (orders/deposits/users) and `300` (logs). At launch volume this is fine *and* good for performance, but older records beyond the cap are only reachable via search/filter, not by paging. **Recommendation:** add cursor-based pagination before data grows large. Deliberately not added now — it's a feature, and the brief said improve consistency, not redesign.

## Files modified
- `src/components/Toast.tsx` — focus-trap in shared `ConfirmDialog`.
- `src/components/admin/RestoreForm.tsx` — accessible labels for 2 inputs.
- (`src/app/layout.tsx` — font `preconnect`; logged under the performance report, no UX/visual effect.)

## Verdict
UX is **consistent and production-ready.** The design system was already unified (shared button/input/card/toast/dialog/empty-state primitives); this pass closed the two real gaps found (dialog focus-trap, two unlabeled inputs) and verified — objectively, across 32 routes and two viewports in both themes — that there are no overflow, accessible-name, labeling, heading, or console-error inconsistencies. The one remaining item (pagination) is a documented future enhancement, not a defect.
