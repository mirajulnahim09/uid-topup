# Master audit checklist — 2026-11-05 (branch `upgrade/next-15`)

Legend: **Fix** = done / open (owner) / accepted; **Verified** = how it was proven.
IDs `MA-*` are new in this audit. `O-*` are the open risks carried over from `audit/OPEN_RISKS.md`.

| ID | Sev | Description | Root cause | Fix | Verified |
|---|---|---|---|---|---|
| MA-01 | P3 | `npm run typecheck` failed (TS7053) | Untracked WIP `scripts/verify/responsive-matrix.ts` indexed a spread result whose type lost the measurement keys | Done — explicit `Measured` return type | `tsc --noEmit` exit 0 |
| MA-02 | P2 | Login button stuck on "অপেক্ষা করুন..." forever after a **successful** login when `callbackUrl` is an auth page (e.g. `/login?callbackUrl=/login`) | Success path keeps `loading=true` (expects unmount); pushing `/login` re-renders the same mounted form | Done — `src/lib/safeCallback.ts` rejects auth pages → role default (`/admin` or `/`) | `tests/safe-callback.test.ts` 4/4 (auth-page case returned `/login` before the fix) |
| MA-03 | P2 | After registration, a failed automatic sign-in (rate limit/network) silently landed the customer on `/` signed out | `signIn()` result was ignored | Done — on error: toast "অ্যাকাউন্ট তৈরি হয়েছে — এখন লগইন করুন" → `/login` | business-flow / customer-journey pass; code path reviewed (no browser fault injection for the rate-limit case) |
| MA-04 | P2 | Google button / Logout button frozen ("অপেক্ষা করুন…" / "বেরোচ্ছে…", disabled) after Back from Google or a failed sign-out request | `busy` set before a full-page redirect, never cleared on bfcache restore; `signOut()`/`signIn()` rejection unhandled | Done — `src/lib/useBfcacheReset.ts` (`pageshow.persisted`) + `.catch(() => reset)` | mobile-nav-logout, prod-auth-e2e 58/58 (logout paths); bfcache restore not fault-injected |
| MA-05 | P2 | A malformed `NEXTAUTH_URL` (quotes, no scheme, `http://` on a public host, page path) breaks every sign-in and `/api/auth/session` while `/api/admin/readiness` reports ready | `env.ts` checked presence only | Done — `nextAuthUrlProblem()`; readiness blocker + boot log (not a throw, to avoid a full-site outage); value never echoed | `tests/nextauth-url-env.test.ts` 4/4 |
| MA-06 | P3 | `npx vitest run <file>` (single file) refused to start: "অননুমোদিত কী: DIRECT_URL" | `DIRECT_URL` (Prisma `directUrl`) not in `TEST_ISOLATED_ENV`; only `npm test` overrode it | Done — `DIRECT_URL` pinned to the test DB in `tests/helpers/testEnv.ts` | single-file runs work; full suite |
| MA-07 | P3 | `scripts/verify/csp-nonce.ts` false FAIL "img-src has Blob host" on local/test runs | Check assumed a Blob token is always configured | Done — expects the exact host from `ownBlobHost(env)`; SKIP when no token | csp-nonce all pass on the rig (Blob check SKIP: token blank on the rig, CSP confirmed to list no Blob host) |
| MA-08 | P3 | Auth pages: card glued to the top (below the fold at 1280×720 / 1024×600; 300px empty at 1920×1080), skeleton 320px vs card 645px (load jump) | `AuthStage` component was written (untracked) but never wired; CSS missing | Done — `.auth-stage` CSS + wired into login/register/forgot/reset; skeleton heights match | `login-viewport` (23 sizes + zoom + resize): Chrome all pass, WebKit all pass, Firefox 3 notes (MA-R4) |
| MA-08b | P3 | Focus/scroll-into-view could hide a field under the sticky header or tab bar (640×320) | No `scroll-padding` for the sticky chrome | Done — `html { scroll-padding-top: 77px; scroll-padding-bottom: var(--tabbar-space) }` | login-viewport 640×320 now passes (Chrome/WebKit) |
| MA-09 | P2 | Product page: if `/api/me` failed once, the wallet order button was replaced by a skeleton **forever** (order impossible until a full reload), though the code comment promised the button would still work | `balance === null` rendered a skeleton; the `catch` was silent and nothing retried; direct-pay was blocked too although it needs no balance | Done — `balanceFailed` state → alert + "আবার চেষ্টা" (invalidates the 5 s cache); direct-pay not gated on balance | `loading-failure-states.ts` 5/5 on the final build |
| MA-10 | P3 | Admin: Telegram Analytics / Scheduler / Templates panels showed "লোড হচ্ছে…" forever after a failed fetch (Templates also when no templates exist); Readiness panel rendered **nothing** on failure | `data === null` doubled as "loading"; failure only toasted | Done — shared `src/components/admin/LoadFailedCard.tsx` with retry; Templates tracks `loading/ok/failed` | `loading-failure-states.ts` §3 PASS (readiness forced to 503, then retry) |
| MA-11 | P3 (O-04) | A refused Google sign-in (2FA account, banned) landed on NextAuth's unstyled English error page; OAuth errors returned to `/login?error=…` with no message | `pages.error` unset; login page ignored `?error=` | Done — `pages.error: '/login'` + `src/lib/authErrors.ts` (Bangla message per code, raw code never echoed) | `tests/auth-error-message.test.ts` 3/3 |
| MA-12 | P2 (dep) | `source-map-js@1.2.1` — GHSA-68fv-2mgg-jv7q (high, DoS via crafted source map) in the prod dependency tree (postcss) | Transitive pin in the lockfile | Done — lockfile-only patch bump to 1.2.2 (within `^1.2.1`; package.json unchanged) | `npm ls source-map-js`; `npm audit` no longer lists it |
| MA-13 | P3 | Verify-harness false results: TLS rejection (`login-viewport`, `responsive-matrix`), reads during smooth scroll (Firefox/WebKit), `csp-nonce` env mismatch with the server, `isr-no-user-leak` run without `VERIFY_BASE` (cookie name) | Harness, not app | Done — measuring fixed, assertions unchanged | reruns pass |
| MA-R4 | P3 | Firefox: the auth card top settles 14 px (target ≤12) at 390–430 px because of font swap (card 637→645 px); CLS < 0.05 | Web-font metrics (O-11) | Accepted / O-11 | login-viewport Firefox |
| MA-R5 | P3 | customer-journey "Back after reload" fails only in Playwright-Firefox | Playwright-Firefox adds a history entry on `reload()`, proven on no-JS pages | Tooling limitation | `audit/master/probe-back3.log` |
| MA-R1 | P3 | Up to 5 min after "sign out all devices", the other device's header may still look signed in (pages/API reject it) | JWT re-check throttle (Neon cost) | Design decision — owner | code review |
| O-15 | P1 (process) | Vercel Preview build fails (status "Deployment has failed") | By design: `assert-preview-db` stops preview builds until Preview-scoped `DATABASE_URL`/`DIRECT_URL` for `uidtopup_preview` exist | **Open — owner** (credential entry) | GitHub status of `2466267`: Vercel = failure; all GitHub CI checks success |
| O-02 | P2 | `zod@3` GHSA-mrhx-c7xc-m3w5 | Needs zod 4 (major) | Open — owner decision | `npm audit` |
| O-11 | P2 | Mobile LCP 2.9–4.7 s under 4× CPU / 1.6 Mbps; admin deposits/products CLS 0.17–0.22 | Design/perf work (fonts, hero, motion bundle) | Open — recommendation | perf-browser (earlier audit) |
| O-05/07/08/09/10/12/13 | P3 | See `audit/OPEN_RISKS.md` (O-04 closed by MA-11) | — | Open / accepted | — |

## Final verification (2026-11-05, final build)

| Check | Result |
|---|---|
| TypeScript | PASS |
| ESLint | PASS (0 warnings) |
| Unit + integration + money-path (`npm test`) | PASS, 665/665 (88 files) |
| Money invariants on the dev DB after all journeys | PASS, 18/18 |
| E2E (Playwright, Chrome) | PASS: customer 59/59, admin 72/72, business 30/30, support 38/38, auth 58/58, phone 72/72, interaction 125/125, a11y 77/77, loading-failure 5/5 |
| Cross-browser | WebKit customer journey 59/59 and auth layout all pass; Firefox: see MA-R4/MA-R5 (font settle, tooling) |
| Security suites | api-auth-matrix 251/251, security-probes 22/22, red-team 22/22, xss 12/12, fuzz 10/10, upload 15/15, headers 130/130, 0 unguarded routes |
| Responsive | 312 page checks across 6 viewports, 0 findings |
| Production build | PASS |
| Preview DB isolation | Code guard VERIFIED (`assert-preview-db`, tests `o15-preview-isolation`); live Preview deploy blocked until the owner adds credentials (O-15) |
