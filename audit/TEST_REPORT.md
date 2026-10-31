# Test report — UID TopUp audit 2026-10-31

Everything below actually ran on this machine (Windows 11, Node 24.15, Postgres 16
in docker). Logs: `audit/baseline/` (before any change) and `audit/runs/` (after).
"Not run" is stated where it applies — nothing is claimed from compilation alone.

## Environments
| Name | What | Used for |
|---|---|---|
| Test DB | docker `uidtopup-test-db` :5433, `db push` + TRUNCATE per test, real `next dev` over HTTP | Vitest |
| Dev rig | `next start` + TLS :3443 on dev DB :5434 (`scripts/prod-rig.mjs`) | Phase 3 security suites (before a Vitest run corrupted `.next`, see FINDINGS "Process incident") |
| Sim rig | `scripts/sim/sim-rig.mjs`: env files ignored, 65 external keys blanked, random NEXTAUTH/CRON secrets, DB `uidtopup_sim` (12,891 users, 500,698 orders) | Phase 5 E2E/UI/perf/load/chaos, auth matrix |
| Scratch DB | `uidtopup_migcheck_test` on :5433, created and dropped by the script | Migration test |

## 1. Static
| Check | Baseline | Final |
|---|---|---|
| `npx prisma generate` | pass | pass |
| `npm run typecheck` (tsc strict, includes scripts/ and tests/) | pass | pass |
| `npm run lint` | 0 warnings | pass |
| `npm run build` | pass | pass |
| `prisma validate` / drift | — | no drift between 18 migrations and schema.prisma (`migrate diff --exit-code`) |
| Dead code | — | scripts/audit-deadcode.ts: 12 hits → 4 proved dead, 8 false positives (FINDINGS) |
| Circular imports | **not run** (no madge/dpdm installed; adding one is a new dependency) | — |
| `npm audit --omit=dev` | 1 critical (next), 6 high, 4 low | after Blob 2.8.2 (owner-approved): 1 critical (next), 5 high (zod ×2 paths, @vercel/blob→oidc→cli-config chain via zod, source-map-js), 4 low — undici cleared |

### Blob update (2026-10-31, owner-approved)
Blob tests (blob-driver-mock, blob-host, upload-url, upload-key-entropy, local-storage-traversal, test-env-isolation): 39/39.
generate / typecheck / lint / build: exit 0.
Full suite run 1: 629/630 — tests/deep-audit-d2-d4 D3 deadlocksΔ=1 (existing defect O-14, not the update).
D3 alone ×6: deadlocksΔ=0 every time. Full suite run 2: 630/630 (543 s), D3 deadlocksΔ=0.

## 2–9. Vitest (unit + integration over HTTP, real DB)
| Run | Files | Tests | Result |
|---|---|---|---|
| Baseline (before changes) | 72 | 578 | 576 pass, **2 fail** (both e2e-smoke harness, H-02/H-03) |
| After all src fixes (full suite) | 83 | 630 | **630 pass, 0 fail** (547 s) |
| Final chain | pass | | |

New test files (each written to fail first where a defect was suspected):
google-2fa-bypass (4), local-storage-traversal (3), settings-policy-numbers (15),
reseller-read-api (4), telegram-template-preview (3), date-format-timezone (2),
order-replay-notify (1), voucher-codes (9), account-deletion (5),
money-storm-invariant (3 seeds × 90 concurrent ops, 8 invariants), i18n-parity (3).

Category mapping:
- **Unit / schema**: settings-policy-numbers, telegram-template-preview, date-format-timezone, i18n-parity, existing zod-bangla, sanitize-bengali, money-precision, dhaka-date.
- **Integration + authz**: every route through real HTTP; IDOR tests listed in AUTHZ_MATRIX.md.
- **Money invariants**: money-storm-invariant (new) + ledger-invariant (100 random ops) + scripts/verify/load-test integrity block.
- **Concurrency / races**: voucher 6-buyers-2-codes, 5× parallel DELIVER, order-vs-anonymise, storm bursts; existing order/coupon/stock/refund/withdraw/deposit races; race-redteam 12/12.
- **Idempotency**: clientRef replay (order-replay-notify, chaos-cross-action 20× same ref), partial-refund requestId replay inside the storm, admin-adjust requestId (admin-money-idempotency).
- **Property-based**: seeded PRNG storm (fast-check not installed; adding it is a new dependency). Failing seed is printed.
- **Fuzz**: scripts/verify/input-fuzz 10/10, malformed-requests (no 500, no leak).
- **Security**: red-team-auth 22/22, security-probes 22/22 (dev rig), xss-stored 12/12, upload-security 15/15, ip-spoofing pass, ratelimit-failclosed pass, ban-revocation pass (dev rig), headers-seo 130/130, csp-nonce 16/17 (the miss is env: no Blob host configured on the rig).

## 10. Reseller API contract
tests/reseller-read-api.test.ts (auth, tier, IDOR, 400 without selector — F-02) + existing reseller (9) and reseller-bulk tests; checked against `/developers` request/response examples.

## 11. E2E (Playwright, sim rig)
| Suite | Chromium | Firefox | WebKit |
|---|---|---|---|
| customer-journey (register → deposit → approve → order → confirm → logout/login) | 59/59 | money steps pass; timeout at reload/back step (known Playwright-Firefox history quirk, not confirmed as product bug) | 59/59 |
| phone-journey 390×844 | 72/72 | 71/72 (font request NS_BINDING_ABORTED during navigation on local TLS proxy) | 72/72 |
| double-submit (deposit, order, admin complete) | 16/16 | 16/16 | 16/16 |
| support-flow-e2e (tickets) | 38/38 | 38/38 | 38/38 |
| admin-journey | 72/72 | — | — |
| business-flow-e2e | 30/30 | — | — |
| prod-auth-e2e | 58/58 | — | — |
| mobile-nav-logout | pass | — | — |
| interaction-sweep | 125/125 | — | — |
| slow-network | 9/9 | — | — |
| stale-data | 10/10 | — | — |
| timezone-boundary | pass | — | — |
| e2e-smoke (Vitest, Chrome) | 5/5 | — | — |

Real Android Chrome / iOS Safari devices: **not run** (no devices). WebKit engine + 390×844 mobile emulation is the nearest proxy.

## 12. Visual
Screenshots written to `audit/shots/` by the journeys (both themes in phone/customer journeys). A pixel-diff baseline comparison was **not run** (no baseline tooling in repo).

## 13. Accessibility
scripts/verify/a11y-scan.ts (sim rig): **77/77** after fixing a scanner false positive (closed `<details>`). Checks lang, unnamed controls, duplicate ids per public, account and admin page. axe-core itself is not installed (new dependency) — this is the project's own scanner. Dialogs: ConfirmDialog has focus trap + Escape (src/components/Toast.tsx:221-240). Reduced motion: `MotionConfig reducedMotion="user"` + 10 CSS media queries.

## 14. Performance (scripts/verify/perf-browser.ts, sim rig)
| Page | Desktop LCP / CLS | Mobile (4× CPU, 1.6 Mbps) LCP / CLS |
|---|---|---|
| / | 1156 ms / 0.001 | 4700 ms / 0.001 |
| /product/… | 384 / 0.001 | 3424 / 0.001 |
| /login | 252 / 0.001 | 3180 / 0.001 |
| /account/wallet/deposit | 856 / 0.001 | 3224 / 0.005 |
| /admin/deposits | 340 / 0.006 | 1532 / **0.217** |
| /admin/products | 160 / 0.018 | 968 / **0.166** |

10 of 28 measurements exceed CWV "good" (all on throttled mobile) → OPEN_RISKS O-11.
First Load JS: 87.4 kB shared; largest route /product/[id]/[slug] 163 kB, / 156 kB.
Lighthouse itself: **not run** (not installed).

## 15. Load (scripts/verify/load-test.ts, sim rig, single `next start` on a laptop)
| Level | Requests | Throughput | p50 / p95 / p99 | 5xx | DB conns peak |
|---|---|---|---|---|---|
| 100 concurrent mixed | 621 | 31.1 req/s | 3603 / 5534 / 6361 ms | 0 | 17 |
| Order wave 100 + 100 duplicate-ref | 200 | — | p95 2429 ms | 0 | — |
| Limited stock 30, 100 buyers | 100 | — | — | 0 | exactly 30 sold, stock 0 |
Integrity after load: balance = 1000 − spend = SUM(ledger) = last balanceAfter; 0 duplicate clientRef.
Server memory 912 → 915 MB peak. k6 scripts, stress-to-break and the 30-minute soak: **not run** (k6 not installed; O-10).

## 16. Chaos (scripts/sim/06-failure.ts, sim rig) — 11/11
DB paused 8 s mid order wave + retry; server recovers without restart; connections terminated mid-wave; stuttering DB with 80 orders; client abort + same-clientRef retry; partial refund / balance adjust / deposit approval replayed after a lost response; expired session; forged admin cookie; banned customer with live session → 403, no order. Telegram/Resend down: covered by blank keys in sim rig (all notifications fire-and-forget; no flow broke).

## 17. Migrations
- Empty DB: scripts/verify/migrations-fresh.ts 23/23 (18 migrations, status, drift, 15 constraint/trigger rejections).
- DB with data: `prisma migrate deploy` of the 4 pending migrations on `uidtopup_sim` (500,698 orders) after the two documented pre-check queries (both 0) — success, status up to date. The AdminLog trigger then refused the suites' cleanup DELETE (proof it is live) until the purge switch was used.
- Dev DB: history missing 2 migrations (schema was pushed) — O-03.

## 18. Backup / restore drill
Covered by existing tests (backup-restore-security, backup-stream: signed backup, tamper rejection, streaming). A manual restore onto the dev DB was **not run** in this session.

## 19. Cross-browser / devices — see §11.

## 20. i18n — tests/i18n-parity.test.ts 3/3 (bn = en key set, no empty values, every `t('…')` key exists).

## Coverage
`@vitest/coverage-v8@2.1.9` (owner-approved, pinned to the installed Vitest). `npm run test:coverage` writes text + HTML (`coverage/index.html`) + `coverage-summary.json`; `npm test` is unchanged (coverage off by default).

Run 2026-10-31: 83 files, **630/630 passed** (577 s).

| Metric | Covered |
|---|---|
| Statements | 7.42% (3730/50205) |
| Branches | 50.55% (683/1351) |
| Functions | 28.85% (215/745) |
| Lines | 7.42% (3730/50205) |

**How to read this.** V8 coverage sees only code executed inside the Vitest process. Route handlers, pages and the services they call run in the separate `next dev` process that tests reach over HTTP, so they count as 0% even when many tests drive them (e.g. `src/lib/services/order.ts` 0%, yet 25 test files call `/api/order`). Branch % is computed only over files that were loaded, so it overstates the whole. The numbers are a floor, not a measure of how well the money paths are tested.

In-process coverage of critical modules (line %):
- 100: services/wallet.ts, authCookies.ts, totpReplay.ts
- 80–99: directPayExpiry.ts 96, payments/providers/stripe.ts 94, services/withdrawal.ts 88, payments/providers/sslcommerz.ts 82
- 50–79: guard.ts 64, payments/config.ts 61, totp.ts 59, referral.ts 50 (branches 14%)
- below 50: auth.ts 34 (branches 35%), otp/core.ts 40, payments/registry.ts 41, payments/webhookSignature.ts 38, money.ts 36, otp/channels.ts 33, sessionRevocation.ts 3
- 0 in-process (exercised only over HTTP): services/order.ts, services/voucherCodes.ts, coupon.ts, depositCap.ts, pageGuard.ts, cronAuth.ts, reseller/readGuard.ts, every `src/app/api/**` route, all deposit/withdraw/2FA UI components

HTTP reach of critical routes (test files that call the route): /api/order 25, nextauth 16, /api/deposit 9, /api/admin/deposit 9, /api/admin/order 8, /api/order/direct 5, /api/admin/order/refund 5, /api/register 4, /api/auth/reset 4, /api/reseller/orders 4, webhooks/payment 3, /api/account/2fa 3, /api/order/confirm 3, /api/cron/sla-breach 3, /api/auth/otp/send 3, /api/account/withdraw 2, /api/admin/withdrawals 2, /api/account/password 2, admin/order/bulk 1, admin/order/claim 1, /api/upload 1, /api/auth/2fa-check 1, /api/auth/forgot 1, /api/deposit/check-trx 1. **Not called by any Vitest file:** /api/admin/upload (covered by scripts/verify/upload-security on the rig), /api/auth/login-status, /api/cron/telegram-scheduler (scheduler lease logic tested in-process).

Gaps worth a test (not written in this change): referral.ts branches (14%: bonus paid / too small / banned referrer / no referrer), auth.ts authorize/signIn branches beyond the 2FA and ban cases, sessionRevocation.ts, the three routes above. Real server-side coverage would need `NODE_V8_COVERAGE` on the `next dev` process plus source-map remapping of webpack output — not done.

## Suites not usable on the sim rig (and why)
- order-price-lock, ban-revocation, isr-no-user-leak, security-probes (reset step): mint sessions/tokens with `.env`'s NEXTAUTH_SECRET; the sim rig uses its own random secret → 401. All four passed on the dev rig earlier in this session.
- cron-jobs: needs the rig's random CRON_SECRET, which the rig never prints by design. Cron auth/lease covered by Vitest (telegram-tick-auth, sla-breach-job, telegram-scheduler-lease).
- polling-load, theme-contrast: hard-code `localhost:3000` and (polling-load) read the live ADMIN_EMAIL/ADMIN_PASSWORD from `.env` — deliberately not run.
- storefront-contrast: written for the pre-redesign storefront (finds the hero by an old purple gradient); 44 pass / 24 fail are stale-selector misses, so the new hero's contrast is **not verified** by it.
- semantic-tokens: 102/107; misses = decorative hard-coded greens (O-12) and an SLA "soon" row absent from the data.
- integrations 18/19: the miss reads `withdrawal_hold_hours = 0` from the sim DB's settings.

## Final verification (audit/runs/final-summary.txt)

```
npx prisma generate   exit 0
npm run typecheck     exit 0
npm run lint          exit 0  (No ESLint warnings or errors)
npm run build         exit 0
npm test              exit 0  (Test Files 83 passed, Tests 630 passed, 609 s)
```
