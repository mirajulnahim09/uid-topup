# CLAUDE.md — Permanent Engineering Guide

This file is the standing reference for working on this codebase. It reflects how the project actually works today, not an aspirational rewrite. When in doubt, match existing patterns in the file you're editing over anything written here — this document should be updated to match the code, not the other way around, whenever the two disagree after a deliberate change.

See also: `AUDIT_REPORT.md` (open findings, do not treat as fixed until explicitly resolved there) and `PROJECT_MAP.md` (full route/component/model inventory).

---

## 1. Project Overview

**UID TopUp** — a manual (non-automated) Free Fire diamond top-up e-commerce site for the Bangladesh market, built as a monolith on Next.js 14 (App Router) + Prisma/PostgreSQL + NextAuth. UI copy is primarily Bengali; code comments are frequently Bengali too — preserve that convention when editing existing files.

**Core business model:** there is no payment gateway integration. Customers manually send money via bKash/Nagad/Rocket/Upay to a fixed account number shown on the site, then submit a deposit claim (transaction ID + screenshot). An admin manually cross-checks the transaction in their own banking app and approves or rejects it. Approved deposits credit the customer's in-app wallet balance. Customers then spend that balance on orders (Free Fire diamonds, or subscription-style products like YouTube/Netflix under the "smm-orders" umbrella), which an admin manually fulfills in-game and marks complete (or fails, which auto-refunds).

**Stack:**
- Next.js 14.2.15, App Router, TypeScript, React 18
- Prisma 5 + PostgreSQL (Decimal columns for all money fields)
- NextAuth v4 (JWT sessions, Credentials + optional Google OAuth)
- Tailwind CSS 3 + custom CSS variables ("Maison" luxury dark theme)
- Framer Motion for animation
- Vercel Blob for image uploads, Resend for transactional email (both optional — site degrades gracefully without them)
- Deploy target: Vercel serverless

**Read `AUDIT_REPORT.md` before touching auth, payments, or rate limiting** — it documents specific known gaps (coupon race condition, in-memory rate limiting, dependency CVEs, etc.) that are not yet fixed. Don't assume the absence of a comment means the absence of a known issue.

---

## 2. Folder Structure

```
prisma/
  schema.prisma          Source of truth for the data model
  constraints.sql         DB-level CHECK constraints (negative balance/price guards) — NOT auto-applied by db:setup, must be run separately (see AUDIT_REPORT.md H2)
  seed.ts                 Initial categories/products/admin user

src/
  app/
    (public)/             Public routes: home, product pages, login/register, legal pages, FAQ, contact — NOT auth-gated
    account/               Customer-only routes, gated by middleware.ts — orders, wallet, profile, notifications
    admin/                 Admin-only routes, triple-gated (middleware → layout → requireAdmin() per API call)
    api/                   All backend endpoints — see PROJECT_MAP.md for the full list
    layout.tsx, error.tsx, loading.tsx, not-found.tsx, globals.css
  components/              Shared UI components (customer + public facing)
    admin/                 Admin-panel-only components
    fx/                    Visual-effects components (SiteBackground, CustomCursor, Diamond, SafeImage)
  lib/                     All business logic, validation, security, and integrations — see §7–9
  types/                   next-auth.d.ts type augmentation
  middleware.ts             Route protection + security headers, runs on every request
```

**⚠️ Known dead code:** `src/(public)/` (outside `src/app/`) is an orphaned, stale duplicate of `src/app/(public)/` legal pages — Next.js never routes to it. Do not edit it thinking it's live; do not copy patterns from it. See `AUDIT_REPORT.md` H4 for the removal plan (not yet actioned).

---

## 3. UI/UX Standards

- The current visual language is "Maison" — a dark, glassy, gold/ice-accented luxury theme (see §5 Color System). Any new UI must match this, not the earlier "neon gaming" theme it replaced — if you see magenta/cyan/violet neon colors in a file, that file is stale and out of sync with the rest of the app.
- Use the shared component classes defined in `globals.css` (`@layer components`): `.card`, `.btn`/`.btn-primary`/`.btn-ghost`/`.btn-dark`/`.btn-danger`/`.btn-success`, `.input`, `.label`, `.badge`, `.table-wrap`/`table.tbl`, `.alert-error`/`.alert-success`/`.alert-warn`, `.skeleton`, `.pkg-card`, `.prod-card`. Don't hand-roll new button/input/card styles inline — extend these classes if a new variant is needed.
- Use the shared layout utilities for new pages: `.page-x`/`.page-y` (consistent gutters/vertical rhythm), `.prose-measure` (caps line length at 68ch for readability), `.eyebrow` + `.rule-gold` (section-heading pattern: small caps label + hairline rule).
- The `.text-slate-900`-style "theme bridge" overrides in `globals.css` exist to keep legacy light-themed Tailwind classes readable on the dark theme — it's a compatibility shim, not a pattern to build on. New components should use the CSS variables (`var(--ink)`, `var(--mut)`, etc.) or the component classes directly rather than adding more bridge rules.
- Every destructive or money-affecting admin action (ban, refund, balance adjust, reject) must have a confirmation step — follow the existing `ConfirmDialog` pattern in `Toast.tsx` / admin action components rather than firing the request on first click.

## 4. Animation Standards

- Framer Motion is the standard animation library — don't introduce a second one.
- **Always respect `prefers-reduced-motion`.** The global CSS rule in `globals.css` already zeroes out animation/transition durations under `@media (prefers-reduced-motion: reduce)`; JS-driven effects (canvas loops, custom cursor) must independently check `window.matchMedia('(prefers-reduced-motion: reduce)').matches` and skip entirely (early return before setting up listeners/rAF), matching the pattern in `SiteBackground.tsx`.
- Keep per-frame JS animation work O(n), not O(n²) — the old particle-connection-line network in `SiteBackground.tsx` was removed for exactly this reason. If you're tempted to add a similar effect, profile it on a low-end device first.
- Prefer CSS `@keyframes`/transitions over JS-driven animation wherever the effect doesn't need to react to real-time input (see the "golden dust" particles in `SiteBackground.tsx` — pure CSS, zero per-frame JS cost).
- Page-level transitions live in `src/app/(public)/template.tsx` / `src/app/account/template.tsx` and `src/components/motion.tsx` — reuse those wrappers rather than adding ad-hoc `motion.div` transition props to every new page.

## 5. Color System

All theme colors are CSS custom properties defined once in `:root` in `globals.css` — **use these, don't hardcode hex values in components** (the codebase currently has drift here — see `AUDIT_REPORT.md` M9 — don't add to it):

| Variable | Role |
|---|---|
| `--bg`, `--bg2` | Base background layers |
| `--glass`, `--hair` | Glassmorphism fill / hairline borders |
| `--violet`, `--ice`, `--gold`, `--rose` | Accent colors (gold is the primary brand accent) |
| `--ink` | Primary text color |
| `--mut` | Muted/secondary text |
| `--line` | Default border color |
| `--red` | Error/danger accent (currently mapped to rose, not a true red — intentional, matches the luxury palette) |

Status colors (success/warning/error) are expressed through the `.alert-*`/`.badge` classes, not ad-hoc Tailwind color utilities — reuse them for consistency, especially for order/deposit status indicators.

**Action item for new code:** these variables are not yet mapped into `tailwind.config.ts theme.extend.colors`. Until that's done (see `AUDIT_REPORT.md` M9), use `style={{ color: 'var(--mut)' }}`-style inline references for CSS-variable colors rather than inventing a new hardcoded hex that happens to look similar — a near-miss hex breaks theme consistency in a way that's hard to spot in review.

## 6. Typography

- Display/heading font: `'Space Grotesk'` (`.dsp` utility class, also auto-applied to `h1`–`h4` in `globals.css`).
- Body font (including Bengali): `'Hind Siliguri'` — set as the `body` font-family, with automatic fallback for Bengali text since Space Grotesk doesn't cover Bengali glyphs.
- Both are loaded via a single Google Fonts `@import` at the top of `globals.css` — add new weights to that one import line rather than adding a second `@import`.
- Headings use `text-wrap: balance`; body paragraphs/list items use `text-wrap: pretty` — keep this for new long-form content (legal pages, product descriptions).
- Long-form text blocks should sit inside `.prose-measure` to cap line length at 68ch.

## 7. Component Conventions

- **Server Components by default.** Data-fetching pages (`account/*`, `admin/*`, product pages) are `async function` Server Components that call `prisma` directly and pass primitive/serializable props down to Client Components — don't convert a page to a Client Component just to add interactivity; extract the interactive part into its own `'use client'` child instead (see `ProductGrid.tsx`, `DepositForm.tsx` as examples of this split).
- **Images:** use `src/components/fx/SafeImage.tsx` instead of raw `<img>` or bare `next/image` for any image whose source may not be in `next.config.js`'s `remotePatterns` (product images, banners, deposit screenshots) — it falls back to `<img>` for non-whitelisted hosts instead of crash-looping the page. Known gap: `Navbar.tsx`'s logo still uses a raw `<img>` — don't copy that, use `SafeImage` for any new image you add.
- **Forms:** every `<input>`/`<select>` needs an explicit `aria-label` (or a `<label htmlFor>` association) — this is enforced by `.eslintrc.json`'s `jsx-a11y/alt-text: error` rule and has been retrofitted across the admin forms; keep it up for new fields.
- **Money display:** always format through `src/lib/money.ts` (`round2`, `bdt`-style formatters) — never `toFixed(2)` inline on a raw number pulled from Prisma without going through the shared helper, to keep rounding behavior consistent.
- **Dates:** format through `src/lib/date.ts` — note it currently has no `timeZone: 'Asia/Dhaka'` set (see `AUDIT_REPORT.md` M4); until that's fixed, be aware displayed times are off by 6 hours from local Bangladesh time, don't "fix" it ad-hoc in one component.
- **Decorative SVG/icons:** the brand diamond icon is `src/components/fx/Diamond.tsx` (a crafted SVG, not an emoji) — reuse it anywhere a diamond/gem motif is needed instead of an emoji or a new SVG.
- **Toasts/confirmation dialogs:** use the existing `Toast.tsx` provider (`useToast()`) rather than `window.confirm`/`alert`.

## 8. Database Rules

- **All money fields are `Decimal(12,2)` in Postgres.** Never introduce a `Float`/`Int`-cents representation — stay consistent with the existing `Decimal` columns.
- **Every mutation that changes `User.balance`, `Variant.stock`, `Deposit.status`, or `Coupon.usageCount` must run inside `prisma.$transaction(...)`, and the row(s) being checked-then-updated must be locked with `SELECT ... FOR UPDATE` (raw query) before the check** — this is the established pattern in `src/app/api/order/route.ts` and `src/app/api/admin/deposit/route.ts`. Reading a value, deciding based on it, and writing outside a locked transaction is how double-spend/race bugs happen (see `AUDIT_REPORT.md` H1 for the one place this wasn't done consistently — don't repeat that gap).
- **Price/discount snapshots:** `Order` stores `productName`, `variantName`, `subtotal`, `discount`, `price` as a snapshot at order time, independent of the live `Variant`/`Product`/`Coupon` rows — never join back to live pricing to "correct" historical orders; the snapshot is the source of truth for what was actually charged.
- **`LedgerEntry`** is the audit trail for every balance change (`DEPOSIT`, `ORDER`, `REFUND`, `ADMIN_ADJUST`, `REFERRAL_BONUS`) — every balance mutation must write one, including `balanceAfter`, inside the same transaction as the balance update.
- **`AdminLog`** records admin actions for accountability — currently only wired into `deposit`, `order`, `user`, `announce`, `restore` routes (see `AUDIT_REPORT.md` M2 — `product`/`variant`/`payment`/`coupon`/`banner`/`social`/`settings` routes don't log yet; if you touch those routes, add `adminLog(...)` calls rather than leaving the gap as-is).
- **Never fetch `User.password`** into a Server Component's data unless it's strictly required (auth flows only) — use Prisma `select` (not `include`) to explicitly enumerate fields on any `User` query outside `src/lib/auth.ts`/`src/lib/guard.ts`, per the pattern already applied in `admin/users/page.tsx` and `admin/users/[id]/page.tsx`.
- DB-level safety constraints live in `prisma/constraints.sql` (non-negative balance/price, discount ≤ subtotal, etc.) — these are **not** part of `npm run db:setup` (see `AUDIT_REPORT.md` H2). Don't rely on them being present in any given environment; app-layer checks are the actual guarantee today.
- Schema changes go through `prisma/schema.prisma` + `npx prisma db push` (or a proper migration if the project moves to `prisma migrate`) — never hand-edit the DB schema out of band.

## 9. API Rules

- Every API route handler starts with `requireUser()` or `requireAdmin()` from `src/lib/guard.ts` — these re-verify role/ban status against the DB on every call, not just the JWT. Never trust `session.user.role` directly from `getServerSession()` for an authorization decision inside a route handler; always go through `guard.ts`.
- Wrap the handler body in `try { ... } catch (e) { return apiError(e); }` — `apiError()` gives consistent error shaping and hides internal errors from the client. Throw `ApiError(message, status)` for expected/user-facing failures.
- Validate the request body with a `zod` schema from `src/lib/validation.ts` (`schema.safeParse(await req.json())`) wherever one exists for that route. If you're adding a new route, add its schema to `validation.ts` rather than inlining ad-hoc checks — the codebase has drifted here (`AUDIT_REPORT.md` M6) and inline validation is a maintenance trap, not the target pattern.
- Sanitize any user-supplied text that will later be rendered (`src/lib/sanitize.ts` — `cleanText`, `safeUrl`, `cleanName`) before persisting it, for any field an admin or customer can set that later shows up in another user's UI (banner titles, product descriptions, notification bodies, coupon codes).
- Rate-limit any endpoint that's abusable (login, register, password reset, deposit submission, order placement, coupon check, uploads) via `src/lib/rateLimit.ts`. Be aware this store is in-memory and unreliable on Vercel's serverless deployment (`AUDIT_REPORT.md` C2) — don't treat it as a hard guarantee when reasoning about abuse scenarios until that's fixed.
- Never trust client-supplied prices/amounts — always re-derive price from the DB (`Variant.price`, `Coupon` row) inside the transaction, as `order/route.ts` does; a client-sent `price` field must never be written directly to `Order.price`/`balance`.
- Log admin actions with `src/lib/adminLog.ts` (`adminLog({...}).catch(() => {})`, fire-and-forget, outside the money transaction) for anything an admin does that a customer could later dispute.

## 10. Security Rules

- `src/middleware.ts` sets CSP, HSTS, X-Frame-Options, and other security headers on every response — if you need to allow a new external resource (a script, an iframe, a form target), add it explicitly to the relevant CSP directive in `middleware.ts` rather than loosening a directive broadly (e.g. the Google OAuth `form-action` allowance was added narrowly, scoped to `accounts.google.com` only).
- `/admin/**` and `/account/**` are gated in `middleware.ts` by JWT presence + role check, **and independently re-checked** in `admin/layout.tsx` and every admin API route via `requireAdmin()` — keep all three layers when adding new admin surfaces; don't rely on middleware alone.
- Cookies are `httpOnly`, `sameSite: 'lax'`, `secure` in production — don't weaken these for convenience.
- Passwords are hashed with `bcryptjs` (cost factor 12) — never store or log a plaintext password. Login uses a constant-time dummy-hash comparison to prevent timing-based user enumeration (`src/lib/auth.ts`) — preserve this pattern if you touch the login flow.
- File uploads (`src/lib/upload.ts`) validate by magic bytes, not client-supplied MIME type or extension, and cap size at 8MB — keep both checks if you add a new upload path.
- Known open security gaps to be aware of (don't assume fixed — check `AUDIT_REPORT.md` for current status before relying on any of these being solved): dependency CVEs in `next@14.2.15`, in-memory rate limiting, a Google-OAuth-linking account-takeover path, and a coupon usage-limit race condition.
- Environment variables are validated at startup via `src/lib/env.ts` (`assertEnv()`, called from `src/lib/prisma.ts`) — add any new required env var to that file's `REQUIRED`/`OPTIONAL` list, don't just read `process.env.X` unchecked in a new module.

## 11. Payment Workflow (Manual)

1. Admin sets the live payment account numbers (bKash/Nagad/Rocket/Upay) in Admin → Settings → Payment Numbers (`PaymentChannel` model). **The default seeded number is a placeholder — every fresh deploy must change this before going live**, per the README's setup checklist.
2. Customer sends money to the displayed number via their own banking app.
3. Customer submits a `Deposit` (amount, method, sender number, transaction ID, optional screenshot) via `POST /api/deposit` — this does **not** move money yet, it's a claim pending manual review.
4. Admin reviews pending deposits (Admin → Deposits), cross-checks the `trxId` against their actual bKash/Nagad transaction history, and approves or rejects with a note (`POST /api/admin/deposit`).
5. Approval credits `User.balance`, writes a `LedgerEntry` (type `DEPOSIT`), and — if this is the user's first qualifying deposit and they were referred — pays a one-time referral bonus (`src/lib/referral.ts`).
6. All of step 5 happens inside one row-locked transaction (see §8) so concurrent approvals of the same deposit can't double-credit.

**When touching this flow:** never skip the manual-review step or auto-approve based on client-supplied data — the entire security model rests on a human checking the real bank transaction before balance moves.

## 12. Manual Top-Up (Order Fulfillment) Workflow

1. Customer places an order for a product/variant, optionally with a coupon, paying from their wallet balance (`POST /api/order`) — balance, stock, and coupon eligibility are all checked against a row-locked, live DB read at order time, not client-supplied values.
2. Order starts `PENDING`. Admin sees it in Admin → Orders, copies the Player UID, manually delivers the diamonds/subscription in-game or on the target platform.
3. Admin marks the order `COMPLETED` (delivered) or `FAILED` (couldn't deliver) via `POST /api/admin/order`.
4. `FAILED` triggers an automatic refund: balance restored, stock restored, coupon usage reversed — all inside one transaction, and the locked-status re-check prevents double-refunding the same order.

**When touching this flow:** the refund path must always restore all three (balance, stock, coupon usage) together, atomically — partial refunds are a correctness bug, not an acceptable simplification.

## 13. Admin Workflow / Features

- Single `ADMIN` role (binary with `USER`). **This is a deliberate business decision, not a gap to be closed** — granular permission tiers (a `STAFF`/`SUPPORT` role) were evaluated as roadmap task 4.10 and explicitly declined; the whole panel is operated by the owner alone. A partial `STAFF` implementation was built and then fully removed (see `IMPLEMENTATION_REPORT.md` Batch D). Do not reintroduce a second privileged role without the owner's explicit sign-off. Every admin can: approve/reject deposits, complete/fail/refund orders, adjust any user's balance directly, ban/suspend/unban users, manage products/variants/pricing/stock, manage coupons, manage banners/site settings/payment numbers/social links, send announcements, view the full admin action log, and export/import a full DB backup (including password hashes — see H3).
- Admin pages live under `src/app/admin/**`, gated per §10. The admin nav is `src/components/admin/AdminNav.tsx`.
- `AdminLog` (Admin → Logs) is the accountability mechanism for "who did what, when, from which IP" — treat it as the audit trail of record for any money-related dispute.

## 14. Customer Workflow / Features

- Browse products by category (public, no login) → view product detail/variants → login/register (email+password or Google) → order (requires balance) → track order status (`account/orders`, with `AutoRefresh` polling for live status updates) → manage wallet (`account/wallet/deposit`) → view notifications → edit profile → view referral code/bonus (`ReferralCard.tsx`).
- Referral: every user has a unique `referralCode`; a referred user's first qualifying deposit pays the referrer a one-time bonus (`referralBonusPaid` flag prevents repeat payouts).
- Customer routes live under `src/app/account/**` and `src/app/(public)/**`, gated per §10.

## 15. Performance Requirements

- Keep any new client-side animation/effect O(n) or better per frame; profile before adding anything with real-time mouse/scroll tracking (see §4).
- Use `SafeImage`/`next/image` for any image that can be optimized (known remote host) rather than a bare `<img>`, to get automatic lazy-loading, responsive `srcset`, and modern format negotiation.
- Server Components should fetch only the fields they need via Prisma `select` (not `include`) — avoid over-fetching, especially on list pages (`admin/users`, `admin/orders`) that can grow large.
- Don't add new DB queries inside a hot path (e.g. per-request settings lookups) without considering caching — though don't add caching speculatively either; `src/lib/settings.ts` intentionally has none right now and that's an accepted tradeoff, not an oversight to "fix" unprompted.

## 16. Accessibility Requirements

- Every interactive form control needs an `aria-label` or associated `<label>` — enforced by `.eslintrc.json`.
- Respect `prefers-reduced-motion` for all animation, including JS-driven effects (§4).
- Maintain visible focus states (`:focus-visible` is styled globally in `globals.css` — don't add `outline: none` without a replacement focus indicator).
- **Known open gap:** `src/app/layout.tsx` sets `viewport.maximumScale: 5`, which restricts pinch-zoom — this is a self-acknowledged WCAG 1.4.4 violation (see the code comment at that line and `AUDIT_REPORT.md` M7). Don't extend this pattern to new pages; if you're asked to fix it, the safest fix is removing `maximumScale` entirely.
- Use semantic HTML and real `<button>`/`<a>` elements for interactive elements, not `<div onClick>`.

## 17. Responsive Requirements

- Tailwind's default breakpoints plus a custom `xs` screen (see `tailwind.config.ts`) — mobile-first, test at `xs`/`sm`/`md`/`lg` at minimum for any new page.
- Tables (`table.tbl`) must stay inside `.table-wrap` for horizontal scroll on narrow viewports — never let an admin table overflow the page.
- Respect safe-area insets on mobile (`min-height: 100dvh` is already used in `globals.css` for this reason) — don't reintroduce fixed `100vh` where dynamic viewport height matters (sticky headers/footers, full-screen modals).
- Touch targets (buttons, form controls) should stay at the `.btn`/`.input` classes' existing `min-height` (40–44px) — don't shrink below that for mobile.

## 18. Non-Negotiable Rules

These apply to every change, regardless of how small:

- **Never remove working functionality.** If a change requires removing something, confirm it's genuinely dead (verify via `git blame`/`git log`, not just "looks unused") before deleting, and call it out explicitly rather than deleting silently as a side effect of an unrelated change.
- **Never redesign existing pages without approval.** Matching the existing visual language when adding new UI is expected; restyling something that wasn't asked for is not — even if it "looks better," it's out of scope unless requested.
- **Always preserve business logic.** The money-flow invariants in §8 (transactions, row locks, ledger entries, snapshot pricing) are load-bearing — never simplify them away for readability, even when refactoring unrelated code in the same file.
- **Always run `npm run typecheck`, `npm run lint`, and `npm run build` after any logical batch of changes**, before considering the batch done. Fix what they flag before moving to the next batch — don't let failures accumulate across multiple changes.
