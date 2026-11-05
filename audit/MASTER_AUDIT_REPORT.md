# UID TopUp — Master full-system audit report

Date: 2026-11-05 · Branch: `upgrade/next-15` (base HEAD `2466267`) · Auditor: Claude (Claude Code)
Issue tracker: `audit/MASTER_AUDIT_CHECKLIST.md` · Raw evidence: `audit/master/` (logs, suite summaries; kept local, not committed — regenerable run output)

## 1. Executive summary

The system was already heavily hardened by earlier audits. The baseline on 2026-11-05 was 654/654 tests, a clean build and lint, and green journey and security suites. Typecheck failed only because of an untracked work-in-progress script. No P0 issue (money corruption, auth bypass, data loss) was found. All money-path, ledger, concurrency and authorization suites pass before and after the changes.

The real remaining defects were in **loading and failure states**, the exact class of "unexpected / infinite loading" the owner reported. Each one was reproduced from code or in a browser, fixed at the root cause, and covered by a regression test or browser check:

* **MA-09**: if `/api/me` failed once, the product page's order button became a permanent skeleton, so ordering was impossible until a full reload.
* **MA-02**: a successful login with `callbackUrl` pointing to an auth page left the button stuck on "অপেক্ষা করুন...".
* **MA-04**: after a Back-navigation (bfcache) or a failed sign-out request, the Google and Logout buttons stayed disabled with a spinner.
* **MA-10**: four admin panels showed "লোড হচ্ছে…" forever or vanished when a fetch failed.
* **MA-03, MA-05, MA-11**: login-path gaps. Registration silently left users signed out when auto-sign-in failed. A malformed `NEXTAUTH_URL` broke sign-in while readiness stayed green. A refused Google sign-in landed on an unstyled English page.
* **MA-12**: one high-severity transitive dependency advisory (`source-map-js`) was closed with a lockfile-only patch bump.
* **MA-01, MA-06, MA-07, MA-08**: tooling/test-environment fixes and the unfinished auth-page layout.

**One P1 is still open, and only the owner can do it (O-15):** the Vercel Preview build fails on purpose until Preview-scoped credentials for the separate `uidtopup_preview` database are entered. Production was never touched.

## 2. Modules inspected

| Area | Size | Inspected |
|---|---|---|
| Stack | Next.js 15.5.28, React 19.2, TypeScript strict, Prisma 5.22 / PostgreSQL (Neon), NextAuth 4 (JWT), Vercel Blob, Resend, Telegram | `package.json`, `next.config.js`, `tsconfig.json`, `vitest.config.ts`, `.github/workflows/*` |
| Data | 35 Prisma models, 18 migrations, indexes | `prisma/schema.prisma` (indexes and relations), `src/lib/services/wallet.ts`, row-lock order, `referral.ts`, `prisma.ts` (retry/lock timeout) |
| API | 87 route handlers, every one under a guard (`route-guard-audit`: 0 unguarded) | auth, order, deposit, admin money routes, reseller API, webhooks, cron, stream, upload |
| UI | 52 pages, ~120 components | auth pages, `OrderForm`, `LoadingProvider` (global overlay), `Navbar`/`MobileTabBar` session use, admin panels, PWA/service worker |
| Auth | `auth.ts`, `middleware.ts`, `authCookies.ts`, `pageGuard.ts`, `guard.ts`, `sessionRevocation.ts`, rate limiter | full lifecycle: login form → 2FA pre-check → `authorize` → jwt/session callbacks → cookie names → middleware → page/API guards → logout revocation |
| Env/deploy | `env.ts`, `deploymentEnv.ts`, `assert-local-db.mjs`, `assert-preview-db.mjs`, `.env*` key names only | values never printed |
| Tests | 85 Vitest files (88 after this audit), 60 Playwright verify scripts | run, plus three new test files and one new browser verify script |

## 3–6. Problems, root causes, files changed, fixes

| ID | Sev | Problem → root cause → fix | Files |
|---|---|---|---|
| MA-01 | P3 | Typecheck red. The untracked `responsive-matrix.ts` indexed a spread whose type dropped the measurement keys. Fixed with an explicit `Measured` return type. | `scripts/verify/responsive-matrix.ts` |
| MA-02 | P2 | Login stuck on "অপেক্ষা করুন..." after a successful sign-in with `callbackUrl=/login` (or any auth page). The success path never resets `loading` (it expects to unmount), and pushing `/login` keeps the same form mounted. Fix: the destination check moved to `safeCallbackPath()`, which rejects auth pages and falls back to the role default. | `src/lib/safeCallback.ts` (new), `src/app/(public)/login/page.tsx` |
| MA-03 | P2 | Registration: if the automatic sign-in failed (rate limit, network), the user landed on `/` signed out with no explanation, because the `signIn()` result was ignored. Fix: the result is now checked; on error a toast appears and the user goes to `/login`. | `src/app/(public)/register/page.tsx` |
| MA-04 | P2 | Google and Logout buttons stayed frozen after Back (bfcache) or a failed request. `busy` was set before a full-page redirect and never cleared, and the promise rejection was unhandled. Fix: a `pageshow.persisted` reset hook and `.catch(reset)`. | `src/lib/useBfcacheReset.ts` (new), `src/components/GoogleButton.tsx`, `src/components/LogoutButton.tsx` |
| MA-05 | P2 | A malformed `NEXTAUTH_URL` (quotes, no scheme, http on a public host, page path) broke every sign-in and `/api/auth/session` while readiness said ready, because `env.ts` checked presence only. Fix: `nextAuthUrlProblem()` reports a readiness blocker and logs at boot. It deliberately does not throw, to avoid a whole-site outage, and never echoes the value. | `src/lib/env.ts` |
| MA-06 | P3 | A single-file `npx vitest run` refused to start because `DIRECT_URL` was not isolated. Fix: pin it to the test DB. | `tests/helpers/testEnv.ts`, `tests/globalSetup.ts` |
| MA-07 | P3 | `csp-nonce` reported a false FAIL when no Blob token was configured. Fix: it now expects the exact host from `ownBlobHost()` and skips when there is no token. | `scripts/verify/csp-nonce.ts` |
| MA-08 | P3 | Auth card glued to the top: below the fold at 1280×720 and 1024×600, 300 px of empty space at 1920×1080, and a 320→645 px jump on load. The `AuthStage` component existed (untracked) but was never wired and had no CSS. Fix: `.auth-stage` CSS (first-screen height minus header and tab bar, `svh`) and the component wired into all four auth pages, with matching skeletons. | `src/app/globals.css`, `src/components/AuthStage.tsx`, 4 auth pages |
| MA-08b | P3 | Keyboard focus and scroll-into-view could park a field under the sticky header or tab bar (seen at 640×320). Fix: `html { scroll-padding-top: 77px; scroll-padding-bottom: var(--tabbar-space) }` (WCAG 2.4.11). | `src/app/globals.css` |
| MA-09 | P2 | Product page: one failed `/api/me` call meant a permanent skeleton in place of the order button. The skeleton rendered while `balance === null`, the catch was silent, and nothing retried; direct pay was gated on the balance too. Fix: a `balanceFailed` alert with "আবার চেষ্টা" (it invalidates the shared cache), and direct pay is no longer gated on the balance. Display only: the server still re-checks the balance inside the locked transaction. | `src/components/OrderForm.tsx` |
| MA-10 | P3 | Admin panels: Telegram Analytics, Scheduler and Templates showed loading forever after a failure (Templates also when empty), and Readiness rendered nothing. Fix: a shared `LoadFailedCard` with retry, and Templates tracks `loading/ok/failed`. | `src/components/admin/LoadFailedCard.tsx` (new), `AnalyticsPanel.tsx`, `SchedulerPanel.tsx`, `TemplatesPanel.tsx`, `ReadinessPanel.tsx` |
| MA-11 | P3 | (O-04) A refused Google sign-in landed on NextAuth's English error page, and OAuth errors returned to `/login?error=` with no message. Fix: `pages.error: '/login'` plus a Bangla message per NextAuth code. The raw code is never rendered. | `src/lib/auth.ts` (one config line), `src/lib/authErrors.ts` (new), login page |
| MA-13 | P3 | Verify-harness gaps that produced false results: `login-viewport`/`responsive-matrix` rejected the rig's self-signed TLS and read positions mid smooth-scroll in Firefox/WebKit; `csp-nonce` loaded different env files from the server under test. All fixed in the scripts. Fixed the measuring, not the assertions. | `scripts/verify/login-viewport.ts`, `responsive-matrix.ts`, `csp-nonce.ts`, `customer-journey.ts` (prints open requests when a reload stalls) |
| MA-12 | P2 | `source-map-js` 1.2.1 had a high-severity advisory (GHSA-68fv-2mgg-jv7q). Fix: lockfile-only bump to 1.2.2 inside the existing range. | `package-lock.json` |

**Money/auth impact of the changes:** no change to `wallet.ts`, the order, deposit or refund routes, locking, `middleware.ts`, the jwt/session callbacks or cookie settings. The only `auth.ts` change is the `pages.error` redirect target. MA-09 changes display logic only; the price and balance are still re-read and locked server-side.

## 7. Tests added

| Test | What it proves |
|---|---|
| `tests/safe-callback.test.ts` (4) | own-origin only (`//`, `/\`, TAB tricks rejected); auth pages rejected (MA-02 regression, which returned `/login` before the fix); no over-matching |
| `tests/nextauth-url-env.test.ts` (4) | valid forms accepted; quotes, no scheme, http in prod, page path and query rejected; value never echoed; `validateEnv()` marks it not-ok |
| `tests/auth-error-message.test.ts` (3) | every NextAuth code maps to a message; raw code never echoed |
| `scripts/verify/loading-failure-states.ts` (browser) | MA-09 with `/api/me` forced to 500, then retry; MA-02 with a real login on `/login?callbackUrl=/login`; MA-10 with readiness forced to 503, then retry |

## 8. Commands executed and results

| Step | Command | Result |
|---|---|---|
| Baseline tests | `npm test` (before changes) | **654/654 pass**, 85 files (`audit/master/baseline-test.log`) |
| Baseline typecheck | `npm run typecheck` | **FAIL** → MA-01 (`audit/master/baseline-typecheck.log`) |
| Baseline lint / build | `npm run lint`, `npm run build` | pass / pass, no warnings (`build-1.log`) |
| Final generate | `npx prisma generate` | **PASS** (an EPERM seen earlier came from the running rig holding the engine DLL; it passes once the rig is stopped) |
| Final typecheck | `npm run typecheck` | **PASS** (`final-typecheck.log`) |
| Final lint | `npm run lint` | **PASS**, 0 warnings (`final-lint.log`) |
| Final unit/integration/money-path | `npm test` | **665/665 pass**, 88 files (654 existing + 11 new) (`final-test.log`) |
| Final production build | `npm run build` | **PASS**, 0 warnings (`final-build.log`) |
| Money invariants (dev DB, after all journeys) | `scripts/verify/_master-money-dev.ts` → `scripts/money-invariants.ts` | **18/18 pass**: ledger chain intact, latest ledger = balance, no negative balance, refunds = ledger REFUND sum, coupon counts consistent, writes rolled back. One informational note: a historical direct DB edit on the local test customer from an earlier phase, not code (`money-invariants-dev.log`) |
| Dependency audit | `npm audit --omit=dev` | before: 9 (4 low, 5 high, incl. source-map-js); after MA-12: source-map-js gone; the remaining highs are all zod 3 (O-02, major) |
| Vercel/GitHub status of `2466267` | `gh api …/status`, `…/check-runs` | CI: Typecheck · Lint · Build ✓, Money-path tests ✓, Dependency Audit ✓; Vercel ✗ (O-15 guard by design) |

## 9. Playwright browser test results

Run against the local **production** build (`next start` behind TLS at https://localhost:3443, `scripts/prod-rig.mjs`), with the database on the local Docker dev instance (`localhost:5434/uidtopup_dev`, verified with `SELECT current_database()`). The browser is system Chrome via playwright-core; synthetic accounts only.

All runs use the **final** build unless marked. Logs: `audit/master/suites/*.log`, `audit/master/*.log`.

| Suite | What it drives | Result |
|---|---|---|
| customer-journey (Chrome) | home → search → product → login → insufficient balance → UID validation → order → ledger check → refresh/back/forward → logout/login → IDOR → closed/missing product | **59/59** |
| customer-journey (WebKit) | same | **59/59** |
| customer-journey (Firefox) | same | 58/59 or a reload timeout. **Playwright-Firefox limitation, not an app bug**: in Playwright-Firefox, `page.reload()` itself adds a history entry (`history.length` 2→3) even on no-JS pages (`/robots.txt` → `/sitemap.xml`), so "Back" lands on the same URL. WebKit and Chrome go back correctly; the money, ledger and IDOR steps pass in Firefox (`probe-back*.log`, `probe-firefox-reload*.log`). |
| admin-journey | login, dashboard, products/variants, orders (claim/fail/refund), deposits, users, recovery link, logout | **72/72** |
| business-flow-e2e | deposit → admin approve → order → deliver → customer confirm, end to end | **30/30** |
| support-flow-e2e | tickets, withdrawals (customer + admin) | **38/38** |
| prod-auth-e2e | valid/invalid login, session after refresh, logout, protected routes, admin/customer, mobile + desktop, console/network clean | **58/58** |
| phone-journey (390×844) | full customer flow on a phone viewport | **72/72** |
| mobile-nav-logout | 320–1024 px: login, role, refresh, deep links, logout, tab-bar overlap | all pass |
| auth-ui-edges | form edge cases | **15/15** |
| double-submit | rapid double clicks on money actions | **16/16** |
| interaction-sweep | every internal link/button on customer + admin pages | **125/125** |
| a11y-scan | labels, roles, contrast, focus | **77/77** |
| slow-network / stale-data | throttled loads, stale tabs | **9/9** / **10/10** |
| loading-failure-states (new) | MA-09, MA-02, MA-10 in a real browser | **5/5** |
| login-viewport (auth layout, MA-08) | 23 viewport sizes + zoom 80–150% + live resize/rotation: centring, header/tab-bar overlap, reachable controls, scroll, CLS | Chrome **all pass**, WebKit **all pass**, Firefox 3 notes: the card top settles 14 px instead of ≤12 px at 390–430 px wide, because Firefox's font swap grows the card 637→645 px; CLS stays under 0.05 (see MA-R4) |
| api-auth-matrix | guest/customer/admin × every API | **251/251** |
| route-guard-audit | static: every handler guarded | 0 unguarded / 87 (run 1) |
| security-probes / red-team-auth | open redirect, header injection, session theft, brute force | **22/22** / **22/22** |
| xss-stored / input-fuzz / upload-security / malformed-requests / state-machine / headers-seo | input and protocol abuse | 12/12 · 10/10 · 15/15 · pass · 30/30 · 130/130 (run 1, server code unchanged since) |
| ban-revocation / order-price-lock | ban takes effect; price locked inside the transaction | all pass (run 1) |
| isr-no-user-leak | user A/B/guest HTML never contains another user's data; sessions proven live | all pass |
| csp-nonce | nonce on all scripts, no CSP violation, hydration works | all pass (Blob-host check SKIP: the rig runs with the Blob token blanked, so correctly no host) |
| theme-meta-token | theme-color follows tokens | all pass |
| responsive-matrix | all 52 routes (guest + customer + admin) × 1440×900, 768×1024, 390×844, 320×640, 844×390, 1024×600: no horizontal overflow, clipped or overlapping controls, nothing under the tab bar, dialogs fit | **312 page checks, 0 findings** |

## 10. Remaining known issues

| ID | Sev | Status / owner action |
|---|---|---|
| O-15 | P1 (process) | **Owner.** Vercel Preview fails on purpose at `assert-preview-db` because Preview has no `DATABASE_URL`/`DIRECT_URL` for `uidtopup_preview`. Also needed: Preview `NEXTAUTH_SECRET` and `ADMIN_PASSWORD`, the GitHub `production-db` secrets, a production read-only role and a production password rotation (see `audit/O15_ROLLOUT.md`). Credential entry is not something this audit may do. |
| O-02 | P2 | `zod@3` (GHSA-mrhx) and `@vercel/blob → @vercel/oidc → @vercel/cli-config → zod` need zod 4 (major). `resend` low advisories need resend 6 (major). Both are owner decisions; exposure is low (array schemas only behind admin/API-key auth). |
| O-11 | P2 | Mobile LCP 2.9–4.7 s under 4× CPU and 1.6 Mbps (four Google font families, framer-motion); admin deposits/products CLS 0.17–0.22. This is design and performance work, not a defect. |
| MA-R1 | P3 | After "sign out all devices" or a password change, the other device's header can show the user as signed in for up to 5 min (JWT re-check throttle), while every page and API correctly rejects the session. No access is granted; the UI is just inconsistent. A fix needs a DB read per session fetch (cost on Neon), so it is left as a design decision. |
| MA-R2 | P3 | Local `next start` over plain **http** on a non-localhost host (for example a phone on the LAN) cannot keep the `__Secure-` session cookie, so login appears to fail. By design: production is HTTPS. Use `scripts/prod-rig.mjs` (TLS) for local production testing. |
| MA-R3 | P3 | Proof images uploaded at runtime with `STORAGE_DRIVER=local` are not served by `next start` (Next serves only build-time `public/`). Readiness already blocks local storage in production; production uses Blob. |
| MA-R4 | P3 | Firefox: at 390–430 px the auth card grows ~8 px when the web font swaps in, so its top settles 14 px (the target is ≤12 px). CLS stays under 0.05. It belongs to the font work in O-11. |
| MA-R5 | P3 | Playwright-Firefox adds a history entry on `page.reload()` (proven on no-JS pages). The customer-journey "back after reload" assertion therefore cannot pass in Firefox. This is a tooling limitation. |
| O-05/07/08/09/10/12/13 | P3 | Unchanged; see `audit/OPEN_RISKS.md`. |

## 11. Security findings

* Authorization: `route-guard-audit` found 0 unguarded handlers out of 87. `api-auth-matrix` passed 251/251 (customer/admin/guest × every route), and IDOR checks on order, invoice and ticket detail pages enforce ownership (`order.userId !== viewer.id → notFound`).
* Authentication: brute-force limits fail closed on DB error, timing-safe dummy bcrypt, TOTP replay protection, race-safe recovery codes, session revocation on logout (`sid`), epoch check on every API call, and ban effective immediately on API calls. Google cannot bypass 2FA (`google-2fa-bypass` test). The open-redirect regression is covered by `safe-callback.test.ts`.
* Headers/CSP: nonce plus `strict-dynamic`, no `unsafe-inline` for scripts, HSTS in production, `frame-ancestors 'none'`, `img-src` narrowed to the own Blob store (`csp-nonce`, `headers-seo` 130/130).
* Input: XSS (stored) 12/12, input fuzz 10/10, upload security 15/15, malformed requests and the order state machine pass.
* Dependencies: `npm audit --omit=dev` lists 0 critical. MA-12 is fixed. The remaining highs all trace to zod 3 (O-02, major upgrade needed).
* Secrets: no secret was printed, logged or committed. `.env` values were never read into output; only key names and DB host/name were shown.

## 12. Performance

* No N+1 found on the hot pages (admin dashboard, orders and reports use `Promise.all`). The Navbar, MobileTabBar and OrderForm share one de-duplicated `/api/me` + `/api/notifications` request (5 s TTL), and polling stops in hidden tabs.
* MA-09/MA-10 make failure paths finite. Retries are user-driven (no extra polling load on Neon).
* The Prisma middleware retries only "query never ran" errors (P1001/P2024, Neon cold start). Transactions use `lock_timeout 8s`.
* Not changed (O-11): font payload and LCP on throttled mobile.

## 13. Environment and database isolation evidence

* `.env`: `DATABASE_URL`/`DIRECT_URL` point at `localhost:5433/uidtopup_test` (host and DB printed, credentials redacted). No `neon.tech` string remains in any local `.env*`.
* `.env.development` (used by the rig and the verify scripts) resolves to `localhost:5434`, DB `uidtopup_dev` (`SELECT current_database()`).
* The test harness refuses non-localhost and non-`_test` databases (`scripts/test-run.mjs`, `assertSafeTestUrl`). `assertNoLiveEnv` now also pins `DIRECT_URL` (MA-06).
* The build runs `assert-local-db` (rejects any non-local DB URL locally) and `assert-preview-db` (on a Vercel preview build, refuses any DB except `uidtopup_preview`, before connecting).
* GitHub status for `2466267`: all CI checks green (Typecheck · Lint · Build, Money-path tests, Dependency audit). Vercel shows "failure", which is the guard working as designed (see O-15).
* Production: no production URL, migration, seed or query was used. No env var was changed. Nothing was deployed or pushed.

## 14. Production risks

* The changes are UI/state handling, env validation, one NextAuth `pages.error` value, test tooling and a patch-level lockfile bump. Blast radius: the login, register, forgot and reset pages (layout and messages), the product page order button area, four admin panels, and readiness output.
* `pages.error: '/login'`: NextAuth error redirects now land on `/login?error=<code>` instead of `/api/auth/error`. Nothing in the repo links to `/api/auth/error` (checked).
* A malformed `NEXTAUTH_URL` now shows as a readiness **blocker**. If production has one, `/api/admin/readiness` will report not-ready after deploy. That is intended and points at a real login breakage.

## 15. Recommended next steps

1. Owner: finish O-15 (Preview credentials), then push. The Vercel preview build should pass the guard.
2. Review this diff and merge it into PR #1 (do not merge PR #1 into `main` without the pre-deploy checklist in `audit/OPEN_RISKS.md` §3).
3. Plan zod 4 (O-02) and the mobile performance work (O-11: fewer font families, lazy motion).
4. Optional: decide on MA-R1 (whether the session callback should check revocation on every fetch).
