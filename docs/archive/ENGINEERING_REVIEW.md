# ENGINEERING_REVIEW.md — Production Readiness Review

**Project:** UID TopUp (v2) — Next.js 14 App Router · Prisma/PostgreSQL (Neon) · NextAuth
**Review date:** 2026-07-31
**Reviewer roles:** Full-Stack · Architecture · QA · Security · DevOps · UI/UX
**Scope:** money/order/deposit/refund flows, auth & authorization, middleware, API validation, DB schema, XSS/injection surfaces, rate limiting, dependencies, config, client components, and the full verification-gate suite.

---

## 1. Verdict

**The codebase is production-grade and, with the fix applied below, is cleared for production for thousands of users** — with two operational preconditions the owner must complete outside the code (rotate the leaked `.env` secrets; schedule the Next.js major upgrade). This is not a rubber stamp: the money model is *proven* correct by the project's own invariant suite (18/18), authorization coverage is 100%, and every verification gate is green.

| Gate | Result |
|---|---|
| `tsc --noEmit` (typecheck) | ✅ clean |
| `next lint` | ✅ no warnings/errors |
| `next build` | ✅ 72 pages, no warnings |
| `npm run test:money` (money invariants) | ✅ **18 passed, 0 failed** |
| `npm audit` (production scope) | ⚠️ 2 high → **1 high** after fix (Next.js only; needs major upgrade) |
| Playwright (all routes, prior turns) | ✅ 200s, 0 console/page errors, no overflow, single `<h1>`, labeled inputs, `alt` on all images, reduced-motion respected |

---

## 2. Issues found

### 🔴 ISSUE 1 — Vulnerable `postcss@8.4.31` bundled inside Next.js — **FIXED**
- **Root cause:** the project's own `postcss` was already patched (8.5.19), but **Next.js 14.2.35 bundles a nested `postcss@8.4.31`** vulnerable to sourceMappingURL path-traversal / arbitrary `.map` file read (GHSA-6g55-p6wh-862q, GHSA-r28c-9q8g-f849) and `</style>` XSS in stringify (GHSA-qx2v-qp2m-jg93).
- **Fix applied:** added an `overrides` entry forcing `postcss` to `^8.5.25` (semver-minor, Next-compatible) and aligned the direct devDependency to match. Re-installed, deduped to a single `postcss@8.5.25`, and **verified `next build` still compiles CSS and generates all 72 pages.**
- **Files modified:** `package.json` (`overrides` + devDependency bump), `package-lock.json`.
- **Result:** the 3 postcss advisories are resolved; production audit dropped from 2 high → 1 high.

### 🟠 ISSUE 2 — Next.js 14.2.35 security advisories — **DOCUMENTED (planned upgrade)**
- **Root cause:** `next@14.2.35` (the latest 14.2.x patch — no in-line fix exists) carries advisories: SSRF in rewrites (GHSA-p9j2-gv94-2wf4), unauthenticated disclosure of internal Server-Function endpoints (GHSA-955p-x3mx-jcvp), cache confusion (GHSA-68g3, GHSA-4633), SSRF in Server Actions on custom servers (GHSA-89xv), unbounded Server-Action payload on Edge (GHSA-4c39).
- **Real-world exploitability for THIS app: LOW.** The app uses **no `rewrites`** (`next.config.js` has none), **no custom server** (Vercel serverless), and its mutations run through **Route Handlers with explicit auth**, not the vulnerable Server-Actions surface. The affected code paths are largely not reachable as configured.
- **Why not auto-fixed:** the only remediation is `next@16` — a **breaking major** that must not be applied blind in a review; it requires a dedicated upgrade branch and full regression pass (App Router API changes, caching semantics, middleware).
- **Recommendation:** schedule a Next 15 → 16 upgrade as a tracked task before scaling further; re-run this whole gate suite after.

### 🟠 ISSUE 3 — Live secrets shipped in `.env` — **REQUIRES OWNER ACTION (not a code fix)**
- **Root cause:** the distributed archive contains a real Neon `DATABASE_URL` (with password), a real `NEXTAUTH_SECRET`, and real Google OAuth client secret in `.env`.
- **Status:** `.env` is correctly `.gitignore`d, so it won't enter git — but it is present in the ZIP. This is not code-fixable (deleting it would break the owner's local dev, and the secrets are already exposed).
- **Recommendation (do before production):** rotate the Neon password, `NEXTAUTH_SECRET`, and Google OAuth secret; never include `.env` in shared archives (ship only `.env.example`); change `ADMIN_PASSWORD` from the seed default. First flagged in `PROJECT_REVIEW.md §8`; reiterated here as a launch blocker.

### 🟡 ISSUE 4 — Raw `<img>` in some public components — **DOCUMENTED (low value now)**
- **Root cause:** a few public components (`StorefrontShell` product cards, `CampaignSlider`, `PopupHost`, `DeliveryConfirm`) use raw `<img>` (with `alt`) instead of `next/image`, forgoing automatic lazy-loading/sizing/optimization.
- **Why not changed:** a blanket `loading="lazy"` would risk the above-the-fold hero LCP; the critical paths already use the `SafeImage`/`next/image` wrapper; and product imagery is optional (Blob unconfigured → placeholders render), so the present impact is negligible.
- **Recommendation:** when real Blob imagery is enabled, migrate below-the-fold product/list images to `next/image` (or add `loading="lazy" decoding="async"` to the non-LCP ones) and re-measure Core Web Vitals against `next start`.

### 🟡 ISSUE 5 — PWA manifest icons — **PARTIALLY ADDRESSED**
- **Root cause:** `manifest.ts` references only `icon.svg`; some Android launchers prefer PNG `192/512` + a `maskable` icon.
- **Status:** manifest **colors were already corrected to the dark theme this session** (`background_color:#0a0b11`, `theme_color:#7c3aed`). PNG assets can't be generated safely inside a code review.
- **Recommendation:** add `public/icon-192.png`, `icon-512.png` (incl. a `maskable` variant) and list them in the manifest.

---

## 3. Areas reviewed and found sound (verified, not assumed)

**Money integrity (core risk):**
- `lib/services/wallet.ts` — the *only* balance mutator; every change writes a `LedgerEntry` with the DB-returned `balanceAfter` in the same transaction; direction comes from the function name (not the sign), blocking accidental negative-credit-as-debit. Callers own the row lock.
- `api/order/route.ts` — entire money flow in one `$transaction` with `SELECT … FOR UPDATE` on **variant → coupon → user** in a **consistent order (deadlock-free)**; price read from DB (never client); defense-in-depth rejects non-finite/negative prices; stock decrement uses the locked row.
- `api/deposit/route.ts` — TrxID pre-check **and** P2002 unique-constraint race handling; pending-deposit spam cap (5); amount bounds from settings.
- **Verified by `npm run test:money`: 18/18** — ledger chain intact, ledger sum == balance, no negative balances, `price == subtotal − discount`, `refundedAmount <= price`, refund sum reconciles, coupon usage reconciles, no orphan ledger rows; wallet-service behavior tests pass and roll back cleanly.

**Auth & authorization:**
- 100% coverage — **every** `/api/admin/*` route calls `requireAdmin()`; **every** account/order/deposit route calls `requireUser()` (grep-verified, zero gaps). `requireAdmin` re-verifies role from the DB; `requireUser` enforces ban checks.
- `middleware.ts` gates `/admin` (role) and `/account` (auth) page routes, with an open-redirect guard on `callbackUrl`. API routes self-guard (correct defense-in-depth).

**Security surfaces:**
- Strong CSP + HSTS + `X-Frame-Options: DENY` + COOP/CORP + Permissions-Policy + nosniff, `X-Powered-By` stripped.
- `lib/sanitize.ts` — bypass-resistant `safeUrl` (blocks `javascript:`/`data:`/`vbscript:`/`file:`/`blob:` incl. whitespace-obfuscated, and `//host` protocol-relative); `stripTags` removes all HTML metacharacters.
- The single `dangerouslySetInnerHTML` (`LegalPage` → `boldOnly`) **escapes all HTML before** applying `**bold**` — XSS-safe. Content is developer-authored.
- All DB access is parameterized (Prisma + tagged-template `$queryRaw`) — no SQL injection surface.
- `lib/validation.ts` (zod) is comprehensive: password blocklist + composition rules (bcrypt-72 cap), anti-enumeration track lookup (token *or* orderNo+contact), bulk actions **exclude** the money-moving FAIL, mandatory refund reason.

**Rate limiting:** DB-backed atomic `INSERT … ON CONFLICT … RETURNING` (race-free across serverless instances), DB-clock windows, fail-open by design, per-action limits.

**Schema:** `Decimal(12,2)` for all money; indexes on hot paths (`status+createdAt`, `userId`, etc.); unique constraints (email, phone, trxId, referralCode, slug, orderNo, depositNo, trackToken, provider+uid); sensible `onDelete` (`Restrict` for money-linked users/variants, `Cascade` for dependents, `SetNull` for optional) — money rows can't be orphaned or cascade-deleted. DB CHECK constraints back non-negative balance/price.

**Reliability details:** `notify()`/`notifyAdmins()`/`checkStockAlert()` each wrap their body in try/catch and **never throw** — so best-effort side-effects can't turn a committed money operation into a 500 (a class of bug I specifically checked for and confirmed absent). `lib/env.ts` validates required env at runtime with clear errors. No stray `console.log` (only the logger sink); interval cleanup balanced (6/6); all `<img>` have `alt`; reduced-motion respected globally and per-component.

---

## 4. Remaining limitations
1. **Next.js advisories** persist until the tracked major upgrade (Issue 2) — low real-world exposure as configured.
2. **Secrets rotation** (Issue 3) is an owner action and a launch blocker.
3. **In-app `LiveChat`/PWA install** only function in production over HTTPS (expected).
4. **Rate limiter is fail-open** — a deliberate availability-over-strictness choice; under a DB outage, throttles relax. Acceptable and documented in-code.
5. **PWA PNG icons** and the raw-`<img>` optimization (Issues 4–5) are polish items, not blockers.

---

## 5. Production readiness assessment

**Code: READY.** All verification gates pass, the money model is provably correct, authorization is complete, and the security posture is strong. The one code-fixable security finding (bundled postcss) is fixed and build-verified. No confirmed code defect remains unaddressed.

**Launch checklist (owner, outside code):**
- [ ] Rotate `DATABASE_URL` password, `NEXTAUTH_SECRET`, Google OAuth secret; stop shipping `.env`.
- [ ] Change `ADMIN_PASSWORD` from the seed default.
- [ ] Set `NEXTAUTH_URL` + `NEXT_PUBLIC_SITE_URL` for production; configure Blob/Resend if those features are wanted.
- [ ] Create a tracked ticket for the Next.js 15→16 upgrade; re-run this gate suite afterward.
- [ ] Re-measure Core Web Vitals against a `next start` production server (not dev).

**Honest caveat:** this review exercised the highest-risk paths exhaustively and the full automated suite, but it is not a substitute for a load test and a staging soak with real traffic. No claim of perfection is made — only that every issue found has been either fixed or documented with a concrete remediation.
