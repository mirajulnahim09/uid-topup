# Findings — UID TopUp audit 2026-10-31

Branch `audit/2026-10-31` (local only, not pushed). Baseline snapshot commit
`4cf8396` holds the work that was uncommitted on `production-release`; every
fix below is its own commit on top.

"Proof" names the test that FAILED before the fix and PASSES after, unless
marked otherwise.

## Product defects

| ID | Sev | file:line | Problem | Proof | Fix commit | Status |
|---|---|---|---|---|---|---|
| F-01 | P1 | src/lib/auth.ts:382 | Google sign-in skipped TOTP: any 2FA account (admins included) could be entered with only the Google account behind the same email. | tests/google-2fa-bypass.test.ts — 3/4 failed before, 4/4 after | 371c35d | Fixed |
| F-04 | P2 | src/lib/storage/local.ts:26 | Path traversal in local-driver delete: admin image `/uploads/../../x` passes `safeUrl`; replacing it unlinked an arbitrary project file (self-host/dev; Vercel FS is read-only). | tests/local-storage-traversal.test.ts — 2/3 failed before, 3/3 after | 5b8b634 | Fixed |
| F-05 | P3 | src/lib/telegram/templates.ts:106 | Stored HTML in Telegram template preview, rendered with `dangerouslySetInnerHTML` in other admins' panels (CSP nonce mitigated; now inert without CSP). | tests/telegram-template-preview.test.ts — 2/3 failed before, 3/3 after | 1b19cdf | Fixed |
| F-03 | P3 | src/lib/settingsPolicy.ts:121 | Numeric settings accepted `Infinity`/`1e999`; `referral_bonus = Infinity` made every referred customer's first deposit approval throw. | tests/settings-policy-numbers.test.ts — 7 failed before, 15/15 after | a23ea64 | Fixed |
| F-06 | P3 | src/app/api/admin/readiness/route.ts:118,123 + 4 components | Dates formatted without `timeZone`: readiness card showed cron times 6 h behind on Vercel (UTC); SSR'd client components could hydrate-mismatch near midnight. | tests/date-format-timezone.test.ts — source guard listed 7 call sites before, 0 after | 6ebef06 | Fixed |
| F-07 | P2 | scripts/package-release.mjs:56,77 | Delivery zip packer would have shipped `.certs/localhost-key.pem` (local TLS private key), `public/uploads/` (customer deposit screenshots = PII), `.sim/` and dev `*.log` files in the FULL zip; staging guard checked only `.env*`. | Code review + 6 existing zips scanned (none contained keys or uploads); final zips listed in TEST_REPORT | 4eea9c7, eb3c52c | Fixed |
| O-06 | P3 | src/app/api/order/route.ts:58 | A clientRef replay re-sent the admin "নতুন অর্ডার" notification (a retried request looked like a second sale). | tests/order-replay-notify.test.ts — 3 notifications before, 1 after | 8654443 | Fixed |
| F-02 | P3 | src/app/api/reseller/order-status/route.ts:21 | No-selector call returned empty 200 instead of the documented 400 (`Number('') = 0` is an integer). | tests/reseller-read-api.test.ts (contract case) — failed before, pass after | 459b00a | Fixed |

## Test-harness defects (false PASS / false FAIL) — these hid or faked results

| ID | Sev | file:line | Problem | Proof | Fix commit | Status |
|---|---|---|---|---|---|---|
| H-01 | P1 (assurance) | scripts/verify/api-auth-matrix.ts:111 | Probe #7 (`revoke-all`) revoked the real customer session; the next 122 "customer" probes, including all 83 admin routes, actually ran unauthenticated. "Customer cannot reach admin" was never measured — the suite still said 222/0. | Customer column in audit/api-auth-matrix.json: 401 on every route after index 7 | af4d2c7 (re-run 251/0, customer gets 403 on all 83 admin routes) | Fixed |
| H-02 | P2 | tests/e2e-smoke.test.ts:404 | Double-click order test counted after a fixed 6 s; under full-suite load the first `/api/order` compile is slower → "0 orders" (baseline failure). | Passed alone and in-file; failed only in the 578-test run | 8b25200 | Fixed |
| H-03 | P3 | tests/e2e-smoke.test.ts:315 | 390 px homepage test used `.closest('.card')`; redesign moved live orders to `.sf-card` (baseline failure). Claims unchanged and hold on new markup. | 5/5 after | 8b25200 | Fixed |
| H-04 | P3 | scripts/verify/route-guard-audit.ts:72 | Did not recognise `requireResellerRead`, reported 3 guarded routes as unguarded. | Runtime proof in tests/reseller-read-api.test.ts | 9dff2e6 | Fixed |
| H-05 | P3 | scripts/verify/double-submit.ts:87 | Crashed on a stale `ws.txt` before any check. | 16/16 after | d59673c | Fixed |

## Checked and found correct (no defect) — what and how

| Area | How it was checked | Result |
|---|---|---|
| Wallet / ledger (wallet.ts) | Read in full; storm test I1 (balance == SUM(ledger), ≥ 0, every user) | Correct |
| Wallet order (services/order.ts) | Read in full: lock order Variant→Coupon→User, price/stock/balance from locked rows, clientRef unique | Correct; existing order.test.ts 12 tests |
| Direct pay + approve/reject + expiry | Read in full; storm I4 (exactly one ORDER debit per paid order), voucher test (no code before payment) | Correct (expired-then-approved credits wallet, by design) |
| Admin FAIL refund / partial refund | Read in full; storm I2/I3 (refund ≤ price, REFUND ledger == refundedAmount) | Correct |
| Withdrawals | Read in full; storm + existing withdrawal.test.ts (36) | Correct |
| Referral bonus | Read; storm (referred users) | Correct (F-03 was the only hole) |
| Voucher codes (new) | Read; new tests/voucher-codes.test.ts (9): 6-buyer race for 2 codes, 5 parallel DELIVER, unpaid order, claimed order, void, cross-user page leak | No defect |
| Account deletion (new) | Read; new tests/account-deletion.test.ts (5) incl. order-vs-anonymise race | No defect |
| Reseller read API (new) | New tests: IDOR by orderIds/orderNo/clientRef, balance ownership, tier | No IDOR (F-02 contract only) |
| Every API route guard | Source table (89 files) + runtime matrix (fixed harness) | All guarded |
| SQL injection | grep `$queryRawUnsafe/$executeRawUnsafe/Prisma.raw` in src | Only a constant `SET LOCAL lock_timeout` |
| XSS sinks | grep `dangerouslySetInnerHTML` (4): theme script (constant), LegalPage (escapes then bolds), 2FA QR (library SVG), Telegram preview (F-05) | Fixed the one live sink |
| Open redirect | Read `safeCallbackPath` (URL-parser origin check) + scripts/verify/security-probes.ts | Correct |
| SSRF | grep every server `fetch(`: Telegram, SSLCommerz, game API, Redis, error sink — all env-configured hosts | None |
| Upload | Read upload.ts: magic bytes, 8 MB, no SVG, random keys; scripts/verify/upload-security.ts 15/15 | Correct (EXIF kept on direct API uploads — P3 open) |
| Secrets in repo/history/zips | Pattern scan of `git log -p --all`, working tree, 6 zips; `.env*` never committed | Clean (only test fixtures) |
| Secrets in client bundle | Name + pattern scan of `.next/static` (122 files) after `next build` | Only env-var *names* in admin help text; no values |
| Migrations | scripts/verify/migrations-fresh.ts: 18 migrations on empty DB, status, drift, 15 constraint/trigger checks | 23/23 |
| Missing `await` | grep un-awaited Prisma writes in src | All intentional (tx arrays or `.catch`) |
| Cron overlap | Read cron routes: `runJobExclusive` lease (5–30 min) | Correct |
| i18n | tests/i18n-parity.test.ts | bn/en key sets equal |

## Open (not fixed) — see OPEN_RISKS.md
- O-01 Next.js 14.2.35 critical advisories (major upgrade needed).
- O-02 `@vercel/blob`/`undici`/`zod` advisories (minor bump / zod 4 major).
- O-03 Dev DB migration history behind (schema pushed; history missing 2 migrations).
- O-04 Google sign-in refusal for 2FA accounts shows NextAuth's generic error page (no friendly message).
- O-05 EXIF metadata kept on images uploaded straight to the API (UI path re-encodes and strips it).
- O-07 Coupon preview (`/api/coupon/check`) computes on retail price, the order on reseller price — a reseller sees a different discount in the preview.

## Dead code (proved, not deleted)

Checked with scripts/audit-deadcode.ts, then each candidate by grep for the file path, every exported name, and dynamic-import strings across src/, scripts/, tests/:

| File | Static refs | Dynamic import | String route / flag / admin use | Verdict |
|---|---|---|---|---|
| src/components/ui/DataTable.tsx | 0 | 0 | none | Dead |
| src/lib/fulfillment/service.ts (`fulfillOrder`) | 0 | 0 | none | Dead (superseded by fulfillment/autoFulfill.ts) |
| src/lib/queue/index.ts (`runWithRetry`) | 0 | 0 | none | Dead |
| src/lib/trustMetrics.ts (`getTrustStats`) | 0 (one comment mention in page.tsx) | 0 | none | Dead |

Left in place: PROGRESS.md records fulfillment/service.ts as awaiting the owner's decision. The other 8 scanner hits are false positives (Next.js conventions global-error/instrumentation, directory-index imports `@/lib/storage`, `@/lib/telegram`, `@/lib/sms`, side-effect `import './zodBangla'`, dynamic `import('./lib/instrumentationNode')`, type declaration next-auth.d.ts).

## Process incident during this audit

While the production rig (`next start`) was serving `.next`, two targeted Vitest runs started `next dev`, which rewrote `.next`; the rig then threw MODULE_NOT_FOUND for `.next/server/pages/_error.js` and returned 500s. The first Phase 5 batch (customer-journey showed "login does not return to product page") was therefore invalid and was discarded; the rig was rebuilt and every Phase 5 suite re-run. Phase 3 suites ran before the first Vitest run and are valid.
