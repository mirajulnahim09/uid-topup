# Codebase Audit Report — UID TopUp (v2)

**Date:** 2026-07-18
**Scope:** Full-stack audit (Next.js 14 App Router + Prisma/PostgreSQL + NextAuth). Manual bKash/Nagad/Rocket/Upay top-up e-commerce site with a manual deposit-approval and order-fulfillment workflow.
**Method:** Static review of every route/lib/component file, `prisma/schema.prisma`, `prisma/constraints.sql`, env config, plus `tsc --noEmit`, `next build`, `next lint`, `npm audit`, `npm outdated`.
**Status:** Audit only. **No code has been modified.** Fixes require separate approval per issue or batch.

---

## Re-scan Update — 2026-07-18 (later same day)

The working tree changed after the original audit (55 files modified, 5 new files, `package.json`/`package-lock.json` updated) — none of it applied by this assistant. Re-scanned every changed file via `git diff` against the last commit. This was a broad visual redesign ("Maison" luxury theme: new color palette, typography, `SafeImage`/`Diamond`/`AutoRefresh` components) bundled with a handful of targeted hardening changes. Below is what changed relative to the original findings; **everything not listed here is unchanged and the original write-up still applies as-is.**

**Resolved:**
- **M1 (no ESLint config)** — `.eslintrc.json` added (`next/core-web-vitals` + `jsx-a11y/alt-text: error` + `@next/next/no-img-element: warn`), `eslint`/`eslint-config-next` added to `package.json` devDependencies. See caveat below — config exists but isn't runnable yet in this environment.
- **M5 (no fail-fast env validation)** — new `src/lib/env.ts` (`assertEnv()`) validates `DATABASE_URL`/`NEXTAUTH_SECRET` shape and required-ness, throws a clear bilingual error listing every problem; wired into `src/lib/prisma.ts` so it runs before any DB access. Matches the safest-fix recommendation from the original report closely.

**Improved (partial credit, not full closure):**
- **L4 (plain `<img>` instead of `next/image`)** — new `src/components/fx/SafeImage.tsx` wraps `next/image` with a fallback to plain `<img>` for non-whitelisted hosts (avoids the runtime crash `next/image` throws on an unlisted remote host). Adopted in `ProductGrid.tsx` and `BannerSlider.tsx`. **Not** adopted in `src/components/Navbar.tsx:91`, which still renders the site logo via a raw `<img src={logo} alt={siteName} className="h-11 w-auto" />` — leave that line as the one remaining L4 instance.
- **L10 (SiteBackground performance)** — `src/components/fx/SiteBackground.tsx` was rewritten: the old O(n²) particle-connection-line network is gone, replaced by a plain per-star canvas draw (O(n)/frame) plus CSS-animation-driven "dust" particles (zero JS cost per frame) and static blurred gradient orbs. The `prefers-reduced-motion` check is also now a hard early-return before any canvas/listener setup (previously it only adjusted parameters). Net: meaningfully lighter than before, though a per-frame canvas draw + mousemove listener still runs on capable devices. `CustomCursor.tsx` itself only changed colors (still no native-cursor fallback — **M8 unchanged**).
- **Latent XSS surface in `LegalPage.tsx`** (noted in the original UI audit as "not currently exploitable, hardcoded content only, but risky if ever fed dynamic content") — now proactively hardened: a new `boldOnly()` helper HTML-escapes the full string before applying the `**bold**` → `<strong>` regex, so `dangerouslySetInnerHTML` can no longer inject arbitrary tags even if the source text ever becomes dynamic. Good defense-in-depth; wasn't a numbered finding before, so nothing to mark resolved, but worth recording since it directly hardens something this audit flagged as a future risk.

**Unrelated fix noticed in passing:**
- `src/middleware.ts`'s CSP `form-action` directive now allows `https://accounts.google.com` (was `'self'` only). This wasn't a finding in the original audit, but the previous CSP would have blocked the Google OAuth sign-in form's POST redirect — i.e. Google login was likely broken by the CSP before this change. Flagging since it's a real functional fix, not a cosmetic one.

**New proactive hardening (not a prior finding, but relevant context for H3):**
- `src/app/admin/users/page.tsx` and `src/app/admin/users/[id]/page.tsx` changed their Prisma queries from `include: {...}` (which pulls every scalar column, including the `password` hash) to an explicit `select: {...}` that omits `password`. On review, this wasn't an active leak in the original code — `password` was never interpolated into JSX or passed to a Client Component, so it never reached the rendered HTML or the RSC payload — but it's a good least-privilege tightening or the query layer. **Note the asymmetry: `src/app/api/admin/backup/route.ts` (the actual password-hash exposure risk, H3) was not touched and remains open.**

**New finding surfaced by this re-scan:**
- **[Medium] `node_modules` is out of sync with the updated `package.json`/`package-lock.json`.** Running `npm run lint` now fails with `⨯ ESLint must be installed: npm install --save-dev eslint` — `node_modules/eslint` does not exist even though `package-lock.json` already lists it (grep confirms 14 references). The lockfile was regenerated somewhere else (or by hand) without `npm install` being run in this working copy. **Affected files:** `package.json`, `package-lock.json`, `node_modules/` (missing packages). **Safest fix:** run `npm install` (no version changes needed, `package.json`/`package-lock.json` already declare the right versions — this is purely a "sync the installed tree to what's already declared" operation, not a design decision). Left undone pending your go-ahead per "do not apply fixes yet."

**Confirmed still open, unchanged:** C1 (dependency CVEs — `next` still pinned at `14.2.15`), C2 (in-memory rate limiting), C3 (Google OAuth account-takeover path), H1 (coupon race), H2 (`constraints.sql` not wired into `db:setup`), H3 (backup endpoint exposes password hashes), H4 (dead `src/(public)/` folder), M2 (inconsistent `AdminLog` coverage), M3 (`admin/restore` unvalidated JSON), M4 (timezone bug in `src/lib/date.ts`), M6 (inconsistent validation coverage), M7 (`maximumScale: 5` still set in `src/app/layout.tsx:40`, comment still acknowledges the WCAG violation), M9 (design-token fragmentation — if anything, the new redesign added more inline `style={{ background: ... }}` color values, so this is slightly worse in volume though not in kind), L1–L3, L5–L9, L11–L12. None of the API routes, `src/lib/coupon.ts`, `src/lib/rateLimit.ts`, or `src/lib/validation.ts` were touched by this change.

---

## Build/Lint/Typecheck Results

| Check | Result |
|---|---|
| `tsc --noEmit` | ✅ Pass, zero errors |
| `next build` | ✅ Pass (63/63 pages, no fatal errors — two benign `DYNAMIC_SERVER_USAGE` log lines for `/api/admin/reports` and `/api/admin/backup`, expected since they read `headers()`) |
| `next lint` | ⚠️ **Not runnable** — no ESLint config exists in the repo (no `.eslintrc*`, no `eslint.config.*`). `next lint` drops into an interactive "How would you like to configure ESLint?" wizard. Lint has effectively never been enforced on this codebase. |
| `npm audit --production` | ❌ 6 vulnerabilities: 1 critical, 1 high, 4 moderate (details below) |
| `npm outdated` | Major version lag: `next` 14→16, `react`/`react-dom` 18→19, `@prisma/client`/`prisma` 5→7, `tailwindcss` 3→4, `zod` 3→4, `@vercel/blob` 0→2, `next-auth` pinned to v4 (Auth.js v5 not adopted) |

**Overall code quality note:** the money-handling core (deposit approval, order placement, refunds, admin balance adjustments) is unusually well engineered — every balance-affecting mutation is wrapped in `prisma.$transaction` with explicit `SELECT ... FOR UPDATE` row locks, re-checks status on the *locked* row (not a stale pre-transaction read), and authorization uses a triple layer (middleware → layout → `requireAdmin()` DB re-verification) rather than trusting the JWT alone. The issues below are real, but they sit on top of a solid foundation, not a shaky one.

---

## Critical

### C1. Known critical/high CVEs in pinned dependency versions
**Affected files:** `package.json` (`next@14.2.15`, `@vercel/blob@^0.27.0`, `next-auth@^4.24.10`)

`npm audit` reports a **critical** severity advisory bundle against `next@14.2.15`, including **"Authorization Bypass in Next.js Middleware" (GHSA-f82v-jwr5-mffw)** — directly relevant here because `src/middleware.ts` is this app's primary gate for `/admin` and `/account`. Also present: SSRF via middleware redirect handling, cache poisoning, and multiple DoS advisories. Separately, `undici` (pulled in via `@vercel/blob@0.27.3`) has a **high**-severity unbounded-decompression DoS advisory, and `postcss`/`uuid` (via `next-auth`) have moderate advisories.

**Concrete risk:** the middleware-authorization-bypass advisory, if applicable to the exact code paths this app uses, could let a request skip the `/admin` role check performed in `middleware.ts:88-101` entirely — the single biggest blast-radius bug class this audit could find, because it undermines the layer everything else assumes is solid.

**Safest fix:** Upgrade `next` to a patched 14.2.x point release first (check `next` changelog for a 14.2.x backport before jumping to 16 — a major bump is a bigger, riskier change than this audit should decide unilaterally). If no 14.2.x patch exists, plan a scoped `next@15` or `next@16` upgrade with a full regression pass (this touches routing, middleware, and Server Actions — all core to the app). Do **not** run `npm audit fix --force` blindly; it will jump `next` to 16.2.10 and `next-auth` to a `3.x` pre-release (a downgrade in practice, per the audit output), which is almost certainly wrong. Handle `next`, `@vercel/blob`, and `next-auth` as three independent, tested upgrades.

---

### C2. Rate limiting is in-memory — non-functional on the app's own target deployment platform
**Affected files:** `src/lib/rateLimit.ts`, consumers: `src/lib/auth.ts:105-115` (login brute-force guard), `src/app/api/register/route.ts`, `src/app/api/auth/forgot/route.ts`, `src/app/api/auth/reset/route.ts`, `src/app/api/deposit/route.ts`, `src/app/api/order/route.ts`, `src/app/api/coupon/check/route.ts`, `src/app/api/account/password/route.ts`, `src/app/api/upload/route.ts`

`rateLimit()` stores counters in a plain in-memory `Map`. The README (and `Vercel এ লাইভ করা` deploy instructions in the same README) target **Vercel serverless deployment**. Serverless function instances are ephemeral and horizontally scaled — each cold start or instance gets its own empty `Map`. Every rate limit in the app (login brute-force IP/email throttling, registration spam, password-reset spam, deposit-spam cap, order-spam cap, coupon-check abuse, upload abuse) can be bypassed simply by an attacker's requests landing on different instances, which happens naturally under any real load or a deliberate retry burst.

**Concrete risk:** this directly contradicts the README's headline security claim ("লগইন ব্রুট-ফোর্স গার্ড: একই IP: ১০ মিনিটে ১০ বার..."). A credential-stuffing or password-brute-force attack against `/api/auth/callback/credentials` is not reliably throttled in production.

**Safest fix:** Move rate-limit state to a shared store that survives across instances — either the existing Postgres database (a simple `RateLimitBucket` table with an upsert + count, cheap given login-frequency traffic) or a managed store like Upstash Redis (Vercel-native, low setup cost). Keep the current `rateLimit()` call signature so all ~9 call sites don't need to change, only the implementation.

---

### C3. Account-takeover via Google OAuth + unverified email on credentials registration
**Affected files:** `src/lib/auth.ts:74-82` (`allowDangerousEmailAccountLinking: true`), `src/app/api/register/route.ts` (no email verification step)

`src/app/api/register/route.ts` lets anyone register any email address with a password, with no email-ownership verification (no confirmation link/OTP). Separately, `GoogleProvider` is configured with `allowDangerousEmailAccountLinking: true`, and `findOrCreateGoogleUser()` (`auth.ts:17-38`) links a Google sign-in to an **existing** user row purely by matching email.

**Concrete attack:** attacker registers `victim@gmail.com` with a password they control (no verification required). Victim later clicks "Continue with Google" using their real `victim@gmail.com` — NextAuth finds the attacker's pre-existing row by email and logs the victim into the attacker's account. The attacker's password continues to work on that same account going forward. The victim's balance, order history, and deposits are now attacker-accessible indefinitely, and the victim likely never notices since Google login "worked."

**Safest fix:** Two independent, non-breaking mitigations, either is sufficient:
1. Add email verification (magic link or OTP) to credentials registration before the account is usable / before it can be linked to an OAuth identity — the standard fix for this exact class of bug.
2. Set `allowDangerousEmailAccountLinking: false` (the safe default) and instead show the user an explicit "an account with this email already exists — sign in with your password, then link Google from your profile" flow. This is the lower-effort fix if email delivery (Resend) isn't reliably configured yet.

---

## High

### H1. Coupon usage-limit race condition — can exceed `usageLimit` / `perUserLimit` under concurrency
**Affected files:** `src/lib/coupon.ts:25-47` (`validateCoupon`), called from `src/app/api/order/route.ts:82`

Unlike the `Variant` and `User` rows (locked via `SELECT ... FOR UPDATE` inside the order transaction, `order/route.ts:41-43` and `96-98`), the `Coupon` row and the per-user `CouponUse` count are read with plain, unlocked queries under Postgres's default READ COMMITTED isolation. Two concurrent orders (different users, or the same user placing two orders for different variants so the variant/user locks don't serialize them) that both read the coupon at `usageCount === usageLimit - 1` can both pass validation before either transaction commits the increment in `consumeCoupon`.

**Concrete failure:** a coupon with `usageLimit: 1` (e.g., a "first 1 customer" promo) can be redeemed by 2+ customers simultaneously; a coupon with `perUserLimit: 1` can be used twice by the same user via two parallel requests. This directly contradicts the README's claimed test coverage ("শেষ কুপন ৩ জন একসাথে → ঠিক ১ জন পায়").

**Safest fix:** Add a `SELECT id, usageCount, usageLimit FROM "Coupon" WHERE id = $1 FOR UPDATE` (mirroring the existing `Variant`/`User` lock pattern) inside the same order transaction, before calling `validateCoupon`, and re-check `usageCount < usageLimit` against the locked value. For the per-user limit, either lock the specific `CouponUse` row set (harder, since it's a count over multiple rows) or add a DB-level `UNIQUE` constraint on `(couponId, userId)` when `perUserLimit = 1` is the common case, falling back to the row-lock approach for `perUserLimit > 1`.

---

### H2. `prisma/constraints.sql` DB-level safety net is not part of the setup flow
**Affected files:** `package.json:15` (`db:setup` script), `prisma/constraints.sql`

`"db:setup": "prisma db push && tsx prisma/seed.ts"` does **not** invoke `db:constraints` (a separate script at `package.json:14` that runs `psql "$DATABASE_URL" -f prisma/constraints.sql`). The README documents the constraints file as a manual, easy-to-skip extra step, and its own framing ("ডাটাবেস নিজেই আটকাবে" — "the database itself will stop it") overstates what actually happens on a default `npm run db:setup` deploy: zero DB-level guards against negative balance, negative price, `discount > subtotal`, or invalid stock exist unless the operator remembers the separate `psql` step (which also silently requires `psql` to be installed, or a manual copy-paste into the Neon SQL editor).

**Concrete risk:** on a fresh deploy that only ran `npm run db:setup` (the documented one-liner), the *only* protection against a negative-balance bug is application code — no defense in depth, contrary to what the README promises as the "last resort."

**Safest fix:** Fold `prisma/constraints.sql` into `db:setup` (e.g., `"db:setup": "prisma db push && tsx prisma/seed.ts && npm run db:constraints"`), or better, migrate the constraints into a proper Prisma migration (`prisma migrate`) so they run automatically with every `db push`/`migrate deploy` and can't be forgotten. Requires testing that `psql`-style `ALTER TABLE ... ADD CONSTRAINT` statements translate cleanly into a Prisma migration file (they should, verbatim).

---

### H3. Full-DB backup endpoint exposes all password hashes to any single admin, no extra confirmation
**Affected files:** `src/app/api/admin/backup/route.ts`

The backup endpoint (already flagged by an inline comment in the file itself: `⚠️ ফাইলে পাসওয়ার্ড হ্যাশও থাকে`) returns the full `users` table, including bcrypt password hashes, to any authenticated admin, gated only by the standard `requireAdmin()` check — no re-authentication, no rate limit, no download confirmation step. Combined with the binary `USER`/`ADMIN` role model (no granular permissions — every admin has equal, unrestricted power), a single lower-trust or compromised admin account is one click away from exfiltrating every user's password hash for offline cracking.

**Safest fix:** Exclude `password` from the backup payload by default (it's not needed to restore catalog/settings data — a restore flow can preserve existing hashes for users that still exist and only need password hashes for entirely new user rows, which a backup/restore of an existing DB doesn't need). If full user restore ever requires it, gate that specific field behind a separate, more heavily audited "include credentials" opt-in with its own `AdminLog` entry and rate limit.

---

### H4. `src/(public)/` is dead, stale, diverged code sitting next to the real routes
**Affected files:** `src/(public)/contact/page.tsx`, `src/(public)/privacy/page.tsx`, `src/(public)/refund/page.tsx`, `src/(public)/terms/page.tsx` (dead) vs. `src/app/(public)/contact/page.tsx`, `.../privacy/page.tsx`, `.../refund/page.tsx`, `.../terms/page.tsx` (live)

`src/(public)/*` sits directly under `src/`, outside `src/app/`, so Next.js App Router **never routes to it** — confirmed dead code. Worse, it has already diverged from the live version: `src/(public)/terms/page.tsx` contains an extra bullet point ("অন্য ইউজারকে হয়রানি করা") under the account-suspension clause that the live `src/app/(public)/terms/page.tsx` no longer has — meaning a real legal-content edit was made to the live file and the dead copy was never updated (or someone once edited the wrong file). This is a live landmine for the next person who edits "the terms page" and picks the wrong one.

**Safest fix:** Delete `src/(public)/` entirely after confirming (via `git log`/`git blame`) which version is the currently-intended legal text, and diff the two `terms/page.tsx` files line-by-line first in case the dead copy actually contains a policy clause that should be *re-added* to the live page rather than discarded.

---

## Medium

### M1. No ESLint configuration exists — lint has never run on this codebase
**Affected files:** repo root (missing `.eslintrc.json`/`eslint.config.mjs`)

`npm run lint` (`next lint`) has no config to run against and instead launches an interactive setup wizard, meaning no linting has ever been enforced in CI or locally. This doesn't cause a specific bug, but it means a whole class of issues (unused vars, hook dependency bugs, accessibility lint rules) has never been mechanically checked.

**Safest fix:** Run `next lint` interactively once to generate a `next/core-web-vitals` config (the Next.js default, includes `eslint-plugin-jsx-a11y` checks), commit the resulting config, then fix what it flags in a separate pass (don't bundle lint-driven changes into this audit's fix batch — could be large and unrelated).

### M2. Inconsistent admin audit-log coverage
**Affected files:** `src/app/api/admin/product/route.ts`, `variant/route.ts`, `payment/route.ts`, `coupon/route.ts`, `banner/route.ts`, `social/route.ts`, `settings/route.ts` (no `adminLog()` calls) vs. `deposit/route.ts`, `order/route.ts`, `user/route.ts`, `announce/route.ts`, `restore/route.ts` (which do)

Price changes, payment-account-number edits (the actual bKash/Nagad number money gets sent to), coupon creation, and site-settings changes leave no `AdminLog` trail. The README frames `AdminLog` as the answer to "কে কী করেছে" (who did what) disputes — but that only holds for money-movement actions, not catalog/config changes, which are exactly the kind of change that causes "why did the price change" or "why is the payment number wrong" disputes.

**Safest fix:** Add `adminLog(...)` calls to the remaining seven route handlers, following the exact pattern already used in `admin/deposit/route.ts:102-110` (fire-and-forget `.catch(() => {})`, non-blocking).

### M3. `admin/restore` accepts unvalidated backup JSON
**Affected files:** `src/app/api/admin/restore/route.ts`

Restore payload fields (`data.products`, `data.variants`, `data.coupons`, etc.) are cast with `as any[]` and passed directly into Prisma upserts, validated only by a presence check on `_meta`, not by a zod schema. Since this is admin-gated already, it's not a privilege-escalation bug, but a malformed or hand-edited backup file (wrong type in `price`/`value`, oversized arrays) will surface as an opaque Prisma error via the generic `apiError` handler rather than a clear validation message, and could partially apply before failing (no all-or-nothing guarantee is documented beyond the `$transaction` timeout).

**Safest fix:** Add a zod schema for the backup shape (mirroring `prisma/schema.prisma` field types) and `safeParse` it before the restore transaction begins, returning a specific error listing which record/field failed.

### M4. Timezone bug — timestamps shown to Bangladeshi users are off by 6 hours
**Affected files:** `src/lib/date.ts:3`

`toLocaleString('en-GB', ...)` is called with no `timeZone` option, so it renders in the server process's local timezone — UTC on Vercel — not `Asia/Dhaka` (UTC+6). Every displayed order time, deposit time, and admin-log timestamp is 6 hours off from what a Bangladeshi user/admin expects.

**Safest fix:** Add `timeZone: 'Asia/Dhaka'` to the `toLocaleString` options object.

### M5. No fail-fast validation of required environment variables
**Affected files:** no dedicated env-schema file exists; implicitly consumed via `process.env.*` across `src/lib/auth.ts`, `src/lib/prisma.ts`, etc.

A missing `NEXTAUTH_SECRET` is silently passed as `undefined` into NextAuth (cryptic auth failures, not a clear startup error); a missing `DATABASE_URL` fails inside Prisma's own generic connection error. Neither produces an actionable message at boot.

**Safest fix:** Add a small `src/lib/env.ts` with a zod schema validating required vars at module load (`DATABASE_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`), throwing a clear, named error immediately on missing/malformed values — cheap, low-risk, high debugging value.

### M6. Inconsistent input-validation coverage across API routes
**Affected files:** `src/lib/validation.ts` (only imported by 11 of 26 route files); ad-hoc inline validation used instead in `admin/banner`, `admin/product`, `admin/announce`, `admin/settings`, `admin/social`, `admin/variant`, `admin/payment`, `admin/upload`, `admin/user` (PATCH handler specifically)

These routes aren't unvalidated — they apply manual `cleanText`/`safeUrl`/type coercion inline — but the logic is duplicated per-route rather than centralized in `validation.ts`, making it easy for a newly added field to slip through without validation and harder to audit as a whole. `src/app/api/account/profile/route.ts:9-12` additionally defines its own local phone-regex zod schema instead of importing the one already in `validation.ts` — a drift risk if the canonical rule ever changes.

**Safest fix:** Incrementally move each route's inline validation into a named zod schema in `validation.ts`, starting with the admin routes that touch money-adjacent fields (`payment` account numbers, `coupon` values). Not urgent enough to block anything — a cleanup task, not a bug fix.

### M7. Accessibility: pinch-zoom disabled sitewide (acknowledged, shipped anyway)
**Affected files:** `src/app/layout.tsx` (viewport `maximumScale: 5`)

The code comment itself flags this as a WCAG 1.4.4 violation (`// ♿ zoom বন্ধ করা accessibility violation`) but ships it anyway. Low-vision users cannot pinch-zoom past 5x on any page.

**Safest fix:** Remove `maximumScale` (or set it to a much higher value like 10, or omit it — the WCAG-compliant default is to not restrict zoom at all). If the original motivation was preventing double-tap-zoom UI glitches on a specific component, fix that component instead of restricting zoom globally.

### M8. `CustomCursor` fully replaces the native cursor
**Affected files:** `src/components/fx/CustomCursor.tsx`

Sets `document.body.style.cursor = 'none'` globally on non-touch devices, replacing it with a JS/rAF-driven dot+ring. Correctly guarded by `prefers-reduced-motion` and `(hover:none)`, but if the rAF loop throws or stalls (a JS error elsewhere on the page, a slow device), the user is left with **no visible cursor at all** — a real, if narrow, usability risk with no fallback.

**Safest fix:** Wrap the rAF callback in a try/catch that restores `cursor: auto` on failure, or add an `onerror`/visibility-change safety reset.

### M9. Design-token fragmentation + fragile "theme bridge" CSS override hack
**Affected files:** `tailwind.config.ts` (doesn't map the CSS custom properties used everywhere), `src/app/globals.css:117-125` (`.text-slate-900{color:#e9e6ff!important}`-style overrides), scattered inline `style={{ color: 'var(--mut)' }}` in `Navbar.tsx`, `Footer.tsx`, `ProductGrid.tsx`, `HomeHero.tsx`

Colors are defined as CSS custom properties (`--cyan`, `--magenta`, `--mut`, `--line`) but never registered in `tailwind.config.ts`'s theme, so components mix Tailwind utility classes, raw inline `style` objects, and a set of blanket `!important` overrides in `globals.css` that force old light-theme Tailwind classes to render correctly on the dark theme. This is fragile: any Tailwind color/opacity variant not explicitly listed in that override block (e.g. `text-slate-900/70`) silently renders wrong.

**Safest fix:** Map the existing CSS variables into `tailwind.config.ts theme.extend.colors` (a mechanical, low-risk change since the variables already exist) so new code can use `text-cyan`/`text-mut` Tailwind classes directly instead of inline `style`, and gradually retire the `globals.css` override block as call sites migrate — not a one-shot fix, a direction to move in.

---

## Low

| # | Finding | File(s) | Safest fix |
|---|---|---|---|
| L1 | `Toast.tsx`'s `setTimeout` in `toast()` isn't cleared if the provider unmounts first (minor leak / possible post-unmount state update) | `src/components/Toast.tsx` | Track timeout IDs in a ref and clear them in a `useEffect` cleanup. |
| L2 | `stripTags` in `sanitize.ts` deletes `< > " ' \`` characters entirely rather than escaping, silently corrupting legitimate text containing quotes (e.g. a product description with `"quoted"` text) | `src/lib/sanitize.ts` | Switch to HTML-entity escaping (`&quot;`, `&#39;`, etc.) instead of deletion for quote characters specifically; keep stripping `<`/`>` for tag injection. |
| L3 | `deleteImage()` upload-cleanup errors are silently swallowed — orphaned Vercel Blob files are never logged or retried | `src/lib/upload.ts:92-96` | Add a `console.error` (matching the pattern already used in `email.ts`/`notify.ts`) so orphaned blobs are at least visible in logs. |
| L4 | Plain `<img>` tags instead of `next/image` in a few components — no automatic optimization/lazy-loading/responsive `srcset` | `src/components/Navbar.tsx`, `ProductGrid.tsx`, `BannerSlider.tsx` | Migrate to `next/image` where dimensions are known; low priority since most are already inside `aspect-ratio`-constrained containers (CLS is already mitigated). |
| L5 | A few admin routes call `update`/`delete` on an id without a prior existence check, relying on Prisma's generic `P2025` error caught by `apiError` | `src/app/api/admin/payment/route.ts` (PATCH/DELETE), `src/app/api/admin/social/route.ts` (PATCH/DELETE) | Add a `findUnique` existence check before mutating, matching the pattern already used in `admin/banner` DELETE and `admin/product` PATCH — consistency only, not exploitable (admin-only, no cross-tenant data). |
| L6 | Referral double-payout prevention relies on an *implicit* row lock (a prior `UPDATE` on the same user row happens to serialize the transaction) rather than an explicit `FOR UPDATE`, unlike every other money-path in the codebase | `src/lib/referral.ts:32-79`, called from `src/app/api/admin/deposit/route.ts:86` | Add an explicit `SELECT ... FOR UPDATE` on the referrer's `User` row at the top of `payReferralBonus`, matching the codebase's own established pattern — makes the correctness basis explicit instead of accidental. |
| L7 | Refund's stock-restore check (`if (variant && variant.stock >= 0)`) is a no-op guard — stock is never negative absent a pre-existing bug, so this doesn't actually validate anything | `src/app/api/admin/order/route.ts` (refund path, ~line 75) | Harmless as-is; either remove the dead condition or replace it with a real guard (e.g. skip restore if `variant.stock === -1`/unlimited, which is the actual case worth special-casing). |
| L8 | Binary `USER`/`ADMIN` role model — no least-privilege separation, any single admin account has full power including full-DB backup/restore and balance adjustment | `prisma/schema.prisma` (`enum Role`) | Not a bug, a design limitation. If the team grows beyond a single trusted admin, consider a `SUPER_ADMIN`/`ADMIN`/`SUPPORT` tier before adding more admin accounts — no action needed at current scale. |
| L9 | `account/smm-orders` naming is confusingly borrowed from "social-media-marketing panel" terminology for what is actually a subscription-order filter (YouTube/Netflix/Prime) — not dead code, just an odd name | `src/app/account/smm-orders/page.tsx` | Cosmetic rename only if it causes confusion internally; not urgent. |
| L10 | Client-side particle-sim background (`SiteBackground.tsx`, O(n²) line-connection checks over up to 64 particles) + `CustomCursor`'s own rAF loop + heavy `framer-motion` page-transition usage add real, cumulative CPU/paint cost, most noticeable on low-end/mobile devices — `prefers-reduced-motion` is correctly respected, so this is a performance concern, not an accessibility bug | `src/components/fx/SiteBackground.tsx`, `src/components/fx/CustomCursor.tsx`, `src/components/motion.tsx`, `src/app/(public)/template.tsx` | Consider reducing desktop particle count further or switching the O(n²) connection check to a spatial grid if profiling shows it's a real bottleneck; not urgent without measured user impact. |
| L11 | `src/lib/settings.ts` hits Postgres on every call with no caching (e.g. maintenance-mode check runs a DB query on every request) | `src/lib/settings.ts` | Add a short in-process TTL cache (10-30s) if DB load becomes a measured concern; not urgent at current scale, and avoids reintroducing a stale-cache class of bug for no proven benefit yet. |
| L12 | No malware/EXIF scanning on uploaded deposit-screenshot images (magic-byte MIME validation exists and is solid; this is about content, not format) | `src/lib/upload.ts` | Optional hardening only if screenshots are ever displayed to other users (they're admin-only viewing); low priority. |

---

## Summary counts

| Severity | Count |
|---|---|
| Critical | 3 |
| High | 4 |
| Medium | 9 |
| Low | 12 |

## Suggested fix order (safest → riskiest, independent of severity labels)

1. **M4** (timezone, one-line) — zero risk, immediate correctness win.
2. **H2** (wire `constraints.sql` into `db:setup`) — additive, no behavior change for a correctly-functioning app.
3. **H4** (delete dead `src/(public)/` folder) — pure deletion, verify with `git blame` first.
4. **M2** (add missing `AdminLog` calls) — additive, non-blocking `.catch()` pattern already established.
5. **H3** (strip `password` from backup payload) — subtractive, verify restore path doesn't depend on it first.
6. **H1** (coupon row lock) — same pattern as existing `Variant`/`User` locks, well-precedented in this codebase.
7. **C3** (email verification or disable dangerous account linking) — pick the lower-effort option first (`allowDangerousEmailAccountLinking: false`) as a stopgap, full email verification as the real fix.
8. **C2** (rate limiting → shared store) — moderate effort, isolated to `rateLimit.ts`'s implementation.
9. **M1, M3, M5, M6, M7, M8, M9, L1-L12** — batch as a cleanup pass, low individual risk.
10. **C1** (dependency upgrades) — highest effort/risk, needs its own dedicated regression pass; do last or in a separate branch specifically for this.

---

*No fixes have been applied. Awaiting approval to proceed, in whole or by selected item numbers above.*
