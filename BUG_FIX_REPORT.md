# BUG_FIX_REPORT.md

**Date:** 2026-07-18
**Scope:** End-to-end QA audit of UID TopUp (see `QA_REPORT.md` for coverage)
**Total issues:** 11 — **6 fixed & verified**, **5 deferred for owner decision**

Fixes were applied only where the change was **behaviour-preserving and unambiguous**. Anything touching dependency majors, disaster-recovery semantics, or visual design is reported, not changed — per `CLAUDE.md` §18 ("never redesign without approval", "never remove working functionality").

---

## Summary Table

| ID | Issue | Severity | Status |
|---|---|---|---|
| BUG-01 | Product cards invisible until scroll (`whileInView`) | High | ✅ Fixed |
| BUG-02 | `next@14.2.15` critical CVEs incl. middleware auth bypass | **Critical** | ⚠️ Deferred |
| BUG-03 | `/api/admin/backup` exports bcrypt password hashes | High | ⚠️ Deferred |
| BUG-04 | ESLint declared but not installed — lint gate inert | Medium | ✅ Fixed |
| BUG-05 | Missing product returns HTTP 200 (soft-404) | Medium | ⚠️ Deferred |
| BUG-06 | Pinch-zoom blocked (`maximum-scale=5`) — WCAG 1.4.4 | Medium | ✅ Fixed |
| BUG-07 | Account pages crash hard on transient DB failure | Medium | ⚠️ Deferred |
| BUG-08 | Stale neon theme in 404 + 3 other files | Low | ✅ Partially fixed |
| BUG-09 | Untranslated English Zod errors shown to users | Low | ✅ Fixed |
| BUG-10 | Admin GET routes error during build (missing `dynamic`) | Low | ✅ Fixed |
| BUG-11 | Mobile menu button 38px (<40px touch target) | Low | ⚠️ Deferred |

---

## ✅ FIXED

### BUG-01 — Product cards invisible until manual scroll
**Severity:** High (products are the entire storefront; section rendered as blank space)

**Root cause:** `ProductGrid.tsx` used Framer Motion `whileInView` with `viewport={{ once: true }}` on both the category header and the card grid. Elements start at `opacity: 0` and only animate in when an `IntersectionObserver` fires. On initial load — and in any full-page screenshot or crawler render — the observer had not yet fired, so a fully-populated DOM (11 products) displayed as ~1400px of empty space.

**Fix:** Replaced the scroll trigger with a mount trigger. `whileInView` → `animate`, `viewport` prop removed. `initial`, `transition`, easing, and `staggerChildren` are all unchanged, so the animation looks identical — it simply fires on mount instead of on scroll. Child cards still inherit `"show"` via variant propagation.

`src/components/ProductGrid.tsx`
```diff
-<motion.div initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }}
-  viewport={{ once: true, margin: '-40px' }} transition={{ duration: 0.7, ... }}
+<motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
+  transition={{ duration: 0.7, ... }}

-  initial="hidden" whileInView="show" viewport={{ once: true, margin: '-60px' }}
+  initial="hidden" animate="show"
```

**Verified:** Fresh Playwright load, 1.5s wait, **zero scrolling** — all 11 products across both categories visible. Screenshot: `homepage-fixed.png`. Typecheck clean.

---

### BUG-04 — ESLint declared but not installed
**Severity:** Medium (quality gate silently absent)

**Root cause:** `eslint@^8.57.1` and `eslint-config-next` are in `package.json` `devDependencies`, but neither existed in `node_modules`. `npm run lint` failed with *"ESLint must be installed"*.

This matters more than it looks: `CLAUDE.md` §18 mandates running lint after every change, and `.eslintrc.json`'s `jsx-a11y/alt-text: error` rule is described as *the* enforcement mechanism for form/image accessibility. With ESLint absent, **that rule had been enforcing nothing** — every "enforced by eslint" claim in the guide was silently void.

**Fix:** `npm install` (installs already-declared deps; no `package.json` change).

**Verified:** `npm run lint` → `✔ No ESLint warnings or errors`. The existing codebase is genuinely clean once the linter actually runs.

---

### BUG-06 — Pinch-zoom blocked (WCAG 1.4.4)
**Severity:** Medium (accessibility violation, self-acknowledged in code)

**Root cause:** `src/app/layout.tsx` set `viewport.maximumScale: 5`, capping pinch-zoom. Flagged in `CLAUDE.md` §16 and `AUDIT_REPORT.md` M7, with the recommended remedy stated as *"the safest fix is removing `maximumScale` entirely."* Applied exactly that.

`src/app/layout.tsx`
```diff
 export const viewport: Viewport = {
   width: 'device-width',
   initialScale: 1,
-  maximumScale: 5,   // ♿ zoom বন্ধ করা accessibility violation
+  // ♿ maximumScale সেট করা হয় না — pinch-zoom সীমিত করলে WCAG 1.4.4 ভাঙে
   themeColor: '#070512',
 };
```

**Verified:** Rendered meta is now `width=device-width, initial-scale=1` — no scale ceiling.

---

### BUG-09 — Untranslated English validation errors
**Severity:** Low (UI consistency — English text in an all-Bengali UI)

**Root cause:** Several `zod` constraints in `src/lib/validation.ts` had no custom message, so zod's English default surfaced directly to users. Reproduced live: a large deposit returned `"Number must be less than or equal to 1000000"`.

**Fix:** Added Bengali messages to the user-reachable validators only (deposit amount cap, trxId max, register name/email max, coupon code min/max). Admin-only and internal validators left unchanged. **No constraint values were altered** — messages only.

**Verified:** Live API now returns `{"error":"পরিমাণ অনেক বড়"}` and `{"error":"কুপন কোড দিন"}`.

*Note:* the admin-configured `min_deposit`/`max_deposit` (৳20/৳25000) were separately confirmed to be enforced server-side with correct Bengali messages — the zod cap is only a far-outer backstop.

---

### BUG-10 — Admin GET routes error during production build
**Severity:** Low (noisy build; `apiError()` invoked at build time)

**Root cause:** `/api/admin/backup` and `/api/admin/reports` are GET handlers that read auth headers, but neither declared `export const dynamic = 'force-dynamic'`. Next.js attempted static rendering at build time, throwing *Dynamic server usage* and logging `[api] unexpected` twice per build. Sibling routes (`/api/me`, `/api/notifications`) already declare it — this was an inconsistency, not a design choice.

**Fix:** Added `export const dynamic = 'force-dynamic'` to both, matching the existing pattern.

**Verified:** `npm run build` now completes with **zero** dynamic-server errors; 61 static pages generated.

---

### BUG-08 (partial) — Stale neon theme on 404 page
**Severity:** Low (UI consistency)

**Root cause:** `src/app/not-found.tsx` rendered "404" with `bg-gradient-to-r from-rose-600 to-purple-600` — the retired "neon gaming" palette that `CLAUDE.md` §3 explicitly flags as stale. The globals.css "theme bridge" rescues `text-*` utilities but **not** gradient utilities, so raw magenta rendered on the gold/dark Maison theme. Also used `min-h-screen` (`100vh`), the exact anti-pattern called out in §17.

**Fix:** Gold gradient via the documented `--gold` CSS variable; `min-h-screen` → `min-h-[100dvh]`.

**Verified:** Screenshot `qa-404-fixed.png` — now gold, consistent with the theme.

**Not fixed (deliberate) — see deferred section:** three other files carry the same palette.

---

## ⚠️ DEFERRED — require your decision

### BUG-02 — `next@14.2.15` critical CVEs
**Severity:** CRITICAL

`npm audit --omit=dev` reports **6 vulnerabilities (1 critical, 1 high, 4 moderate)**. The Next.js advisory set includes:

- **GHSA-f82v-jwr5-mffw — Authorization Bypass in Next.js Middleware** ← directly load-bearing here
- GHSA-4342-x723-ch2f — Middleware redirect SSRF
- GHSA-qpjv-v59x-3qc4 — Race condition → cache poisoning
- multiple DoS and cache-poisoning advisories

Also: `undici` (high, via `@vercel/blob`), `uuid` (via `next-auth`), `postcss`.

**Mitigating factor — and this is genuinely important:** the middleware auth-bypass CVE does **not** by itself grant admin access in this app, because `/admin` is independently re-checked in `admin/layout.tsx` and every admin route calls `requireAdmin()`. I verified this empirically: all four admin APIs returned `403` to a normal user. The defence-in-depth in `CLAUDE.md` §10 is doing exactly the job it was designed for.

**Why not fixed:** `npm audit fix --force` would install `next@16.2.10` — a two-major-version jump with App Router breaking changes, plus `next-auth@3` (a *downgrade*) and `@vercel/blob@2`. That is a planned migration with a full regression pass, not an audit-time edit.

**Recommendation:** upgrade to the latest `next@14.2.x` patch first (low risk, clears several advisories), then plan the 15/16 migration separately.

---

### BUG-03 — Backup endpoint exports password hashes
**Severity:** High

`GET /api/admin/backup` returns every `User` row including the bcrypt `password` field (verified: `$2a$12$BbrgP...`), delivered as a downloadable JSON. Any admin account compromise, or a mishandled backup file, yields the full credential set for offline cracking. This is `AUDIT_REPORT.md` H3.

**Why not fixed:** stripping `password` is a one-line change, but it **silently breaks disaster recovery** — restoring from a stripped backup leaves every user unable to log in. That is a product decision about backup semantics, not a bug fix, and per `CLAUDE.md` §18 I won't remove working functionality unilaterally.

**Options:** (a) strip hashes + force password reset on restore; (b) encrypt the backup at rest with a separate passphrase; (c) keep as-is with documented handling procedure. Happy to implement whichever you choose.

---

### BUG-05 — Missing product returns HTTP 200 (soft-404)
**Severity:** Medium (SEO)

`/product/999/does-not-exist` renders the correct 404 UI but responds **HTTP 200**. `/this-page-does-not-exist` correctly returns 404, so the app-level 404 works — the product route specifically does not.

**Root cause:** the route is SSG (`generateStaticParams` + `revalidate = 60`) and a `loading.tsx` shell exists. Next.js flushes the streaming shell — with 200 headers — before the server component reaches `notFound()`. Once headers are sent the status cannot be revised.

**Impact:** search engines may index nonexistent product URLs as live pages.

**Why not fixed:** remedies (removing `loading.tsx` for this segment, or making the route fully dynamic) trade away either the loading UX or the SSG performance benefit. Both are architectural calls, and dev-server streaming behaviour should be re-confirmed against a production server before choosing.

---

### BUG-07 — Account pages crash hard on transient DB failure
**Severity:** Medium (resilience)

During testing, Neon dropped connections mid-session (`P1017 Server has closed the connection`, then pool timeout at `connection limit: 9`). `/account/wallet/deposit` threw an unhandled `prisma.user.findUnique()` error straight into the React error boundary — 27 console errors, page unusable.

Notably `src/app/(public)/page.tsx` **does** guard this (`try/catch` with the comment *"DB না পেলেও পেজ ভাঙবে না"*). The account pages do not.

**The deposit itself was written correctly** — I confirmed the row persisted (PENDING, ৳500). Only the post-submit page render failed.

**Why not fixed:** the obvious `try/catch` is *wrong here*. Falling back to a default would render **৳0.00 as the user's balance** on a wallet page during a DB outage — actively misleading on a money screen, and worse than an honest error. The correct fix is a purpose-built error state ("ব্যালেন্স লোড করা যায়নি") plus connection-pool tuning (`?connection_limit=` in `DATABASE_URL`) and cold-start retry. That's a design task worth doing deliberately.

---

### BUG-08 (remainder) — Stale neon theme in 3 further files
**Severity:** Low

| File | Pattern |
|---|---|
| `src/app/(public)/product/[id]/[slug]/page.tsx:67` | `from-indigo-600 via-purple-600 to-purple-800` — the large purple product banner |
| `src/app/account/page.tsx:59` | `from-purple-50 to-purple-100` |
| `src/components/NavProgress.tsx:61` | `to-rose-600` + rose glow |

The product banner is prominent and visibly clashes with the gold/dark theme (see `qa-mobile-menu.png`).

**Why not fixed:** unlike the 404 page — an unstyled outlier — these are deliberate-looking, prominent design elements on live pages. `CLAUDE.md` §18 forbids redesigning existing pages without approval. Tell me they should match Maison and I'll convert them to the `--gold`/`--ice` variables.

---

### BUG-11 — Mobile menu button below touch-target minimum
**Severity:** Low

Hamburger menu button measures **38px** high at 375px viewport; `CLAUDE.md` §17 sets a 40–44px floor. Other sub-40px elements are inline text links (footer nav, skip link), which is conventional and not a violation.

**Why not fixed:** trivially fixable, but it nudges header layout — cosmetic change, worth confirming you want it.

---

## Verification Summary

All fixes verified together on a clean restart:

| Gate | Result |
|---|---|
| `npm run typecheck` | ✅ Pass |
| `npm run lint` | ✅ Pass (now that it runs at all) |
| `npm run build` | ✅ Pass — 61 pages, no dynamic-server errors |
| Playwright smoke, fresh load | ✅ **0 console errors**, 11 products, `lang=bn`, no zoom cap |
| Money-flow regression | ✅ Deposit/order/coupon/refund all re-verified against DB |

## Files Changed

```
src/components/ProductGrid.tsx          BUG-01  whileInView → animate
src/app/layout.tsx                      BUG-06  removed maximumScale
src/app/not-found.tsx                   BUG-08  gold gradient, 100dvh
src/lib/validation.ts                   BUG-09  Bengali messages (messages only)
src/app/api/admin/backup/route.ts       BUG-10  + force-dynamic
src/app/api/admin/reports/route.ts      BUG-10  + force-dynamic
package-lock.json                       BUG-04  npm install (declared deps)
```

No business logic, no money-flow code, and no DB schema were modified.
