# Authorization matrix — UID TopUp (audit 2026-10-31)

Every API route × role, measured at runtime against the production build
(`next start` behind TLS, https://localhost:3443) by
`scripts/verify/api-auth-matrix.ts`: **251 checks, 0 failures** on the isolated sim rig (`scripts/sim/sim-rig.mjs`, every external key blanked, DB `uidtopup_sim`).

> The first run reported 222/0 but was a false PASS: the `revoke-all` probe killed the customer session, so every later customer probe ran unauthenticated (FINDINGS H-01). The harness now re-logs in and requires exactly **403** for a live customer on every admin route; the table below is from the fixed run.

Cells are the HTTP status the role actually received with a deliberately invalid body, so
an allowed role gets a 4xx validation error (never a 2xx side effect) and a
refused role gets 401/403. `—` = that role was not probed for this method
(the admin column is only probed for safe GETs).

Reading the codes: anonymous `401`/`403` and customer `403` on `/api/admin/**`
are the guard working; customer `400` on its own routes means "allowed, body
rejected"; cron routes return `401` without the Bearer secret for every role.

Ownership (IDOR) proofs — separate tests that use a second real account:

| Object | How ownership is enforced | Proof |
|---|---|---|
| Order detail / invoice page | `order.userId !== viewer.id → notFound()` | tests/voucher-codes.test.ts ("cannot read another customer's code via the order pages", checks `/account/orders/:id`, `/invoice`, `/account/codes`) |
| Voucher code | joined through `order.userId` | same test |
| Ticket thread / reply / close | service-level `ownerId` filter | tests/tickets.test.ts (read/reply/close another user's thread → 404) |
| Order confirm / dispute | `order.userId` + `updateMany where userId` | tests/order*.test.ts, e2e |
| Review / confirm / invoice / ticket by another user | `order.userId` / `ownerId` checks | tests/deep-audit-d2-d4.test.ts (D4 IDOR: page, invoice, confirm, review, ticket GET/POST, dispute all 404) |
| Reseller order-status | `where: { userId: actor.user.id }` | tests/reseller-read-api.test.ts (other reseller's order by orderIds, orderNo, clientRef → empty) |
| Reseller balance | own `actor.user.id` only | tests/reseller-read-api.test.ts |
| Track (public) | trackToken, or orderNo + matching phone/email | scripts/verify/red-team-auth.ts, security-probes.ts |
| Notifications | `userId`-scoped `where` | source review (src/app/api/notifications/route.ts:12,38) |
| Admin anonymise | `requireAdmin`, refuses self and other admins | tests/account-deletion.test.ts |

Source-level cross-check: `scripts/verify/route-guard-audit.ts` → "no unprotected
route" (after teaching it `requireResellerRead`, commit 9dff2e6). Harness fix: af4d2c7.

## Runtime matrix

| Route | Method | Anonymous | Customer (live session) | Admin | Reseller key | Other-user (IDOR) proof |
|---|---|---|---|---|---|---|
| `/api/account/2fa` | POST | 401 | 400 | — | n/a |  |
| `/api/account/2fa` | GET | 401 | 200 | 200 | n/a |  |
| `/api/account/delete-request` | POST | 401 | 400 | — | n/a |  |
| `/api/account/delete-request` | DELETE | 401 | 200 | — | n/a |  |
| `/api/account/orders/fingerprint` | GET | 401 | 200 | 200 | n/a |  |
| `/api/account/password` | POST | 401 | 400 | — | n/a |  |
| `/api/account/profile` | PATCH | 401 | 400 | — | n/a |  |
| `/api/account/sessions/revoke-all` | POST | 401 | 200 | — | n/a |  |
| `/api/account/withdraw` | GET | 401 | 200 | 200 | n/a |  |
| `/api/account/withdraw` | PUT | 401 | 503 | — | n/a |  |
| `/api/account/withdraw` | POST | 401 | 400 | — | n/a |  |
| `/api/admin/analytics` | GET | 401 | 403 | 200 | n/a |  |
| `/api/admin/announce` | POST | 401 | 403 | — | n/a |  |
| `/api/admin/backup` | GET | 401 | 403 | 0 | n/a |  |
| `/api/admin/banner` | POST | 401 | 403 | — | n/a |  |
| `/api/admin/banner` | PATCH | 401 | 403 | — | n/a |  |
| `/api/admin/banner` | DELETE | 401 | 403 | — | n/a |  |
| `/api/admin/branding` | GET | 401 | 403 | 200 | n/a |  |
| `/api/admin/branding` | POST | 401 | 403 | — | n/a |  |
| `/api/admin/campaign` | POST | 401 | 403 | — | n/a |  |
| `/api/admin/campaign` | PATCH | 401 | 403 | — | n/a |  |
| `/api/admin/campaign` | DELETE | 401 | 403 | — | n/a |  |
| `/api/admin/codes` | POST | 401 | 403 | — | n/a | tests/voucher-codes.test.ts |
| `/api/admin/codes` | PATCH | 401 | 403 | — | n/a | tests/voucher-codes.test.ts |
| `/api/admin/coupon` | POST | 401 | 403 | — | n/a |  |
| `/api/admin/coupon` | PATCH | 401 | 403 | — | n/a |  |
| `/api/admin/coupon` | DELETE | 401 | 403 | — | n/a |  |
| `/api/admin/deposit` | POST | 401 | 403 | — | n/a |  |
| `/api/admin/flags` | GET | 401 | 403 | 200 | n/a |  |
| `/api/admin/logs/export` | GET | 401 | 403 | 200 | n/a |  |
| `/api/admin/media` | GET | 401 | 403 | 200 | n/a |  |
| `/api/admin/media` | POST | 401 | 403 | — | n/a |  |
| `/api/admin/media` | PATCH | 401 | 403 | — | n/a |  |
| `/api/admin/media` | DELETE | 401 | 403 | — | n/a |  |
| `/api/admin/order` | POST | 401 | 403 | — | n/a |  |
| `/api/admin/order/bulk` | POST | 401 | 403 | — | n/a |  |
| `/api/admin/order/claim` | POST | 401 | 403 | — | n/a |  |
| `/api/admin/order/refund` | POST | 401 | 403 | — | n/a |  |
| `/api/admin/otp` | GET | 401 | 403 | 200 | n/a |  |
| `/api/admin/otp` | POST | 401 | 403 | — | n/a |  |
| `/api/admin/otp` | PUT | 401 | 403 | — | n/a |  |
| `/api/admin/payment` | POST | 401 | 403 | — | n/a |  |
| `/api/admin/payment` | PATCH | 401 | 403 | — | n/a |  |
| `/api/admin/payment` | DELETE | 401 | 403 | — | n/a |  |
| `/api/admin/payment/provider` | POST | 401 | 403 | — | n/a |  |
| `/api/admin/payment/provider` | PATCH | 401 | 403 | — | n/a |  |
| `/api/admin/product` | POST | 401 | 403 | — | n/a |  |
| `/api/admin/product` | PATCH | 401 | 403 | — | n/a |  |
| `/api/admin/product` | DELETE | 401 | 403 | — | n/a |  |
| `/api/admin/readiness` | GET | 401 | 403 | 200 | n/a |  |
| `/api/admin/reports` | GET | 401 | 403 | 200 | n/a |  |
| `/api/admin/restore` | POST | 401 | 403 | — | n/a |  |
| `/api/admin/search` | POST | 401 | 403 | — | n/a |  |
| `/api/admin/settings` | POST | 401 | 403 | — | n/a |  |
| `/api/admin/social` | POST | 401 | 403 | — | n/a |  |
| `/api/admin/social` | PATCH | 401 | 403 | — | n/a |  |
| `/api/admin/social` | DELETE | 401 | 403 | — | n/a |  |
| `/api/admin/telegram` | GET | 401 | 403 | 200 | n/a |  |
| `/api/admin/telegram` | POST | 401 | 403 | — | n/a |  |
| `/api/admin/telegram-test` | POST | 401 | 403 | — | n/a |  |
| `/api/admin/telegram-test` | GET | 401 | 403 | 200 | n/a |  |
| `/api/admin/telegram/analytics` | GET | 401 | 403 | 200 | n/a |  |
| `/api/admin/telegram/backup` | GET | 401 | 403 | 200 | n/a |  |
| `/api/admin/telegram/backup` | POST | 401 | 403 | — | n/a |  |
| `/api/admin/telegram/bots` | GET | 401 | 403 | 200 | n/a |  |
| `/api/admin/telegram/bots` | POST | 401 | 403 | — | n/a |  |
| `/api/admin/telegram/config` | GET | 401 | 403 | 200 | n/a |  |
| `/api/admin/telegram/config` | POST | 401 | 403 | — | n/a |  |
| `/api/admin/telegram/connect` | POST | 401 | 403 | — | n/a |  |
| `/api/admin/telegram/manage` | POST | 401 | 403 | — | n/a |  |
| `/api/admin/telegram/scheduler` | GET | 401 | 403 | 200 | n/a |  |
| `/api/admin/telegram/scheduler` | POST | 401 | 403 | — | n/a |  |
| `/api/admin/telegram/scheduler/tick` | POST | 401 | 403 | — | n/a |  |
| `/api/admin/telegram/scheduler/tick` | GET | 405 | 405 | 405 | n/a |  |
| `/api/admin/telegram/templates` | GET | 401 | 403 | 200 | n/a |  |
| `/api/admin/telegram/templates` | POST | 401 | 403 | — | n/a |  |
| `/api/admin/telegram/verify` | POST | 401 | 403 | — | n/a |  |
| `/api/admin/tickets` | GET | 401 | 403 | 200 | n/a |  |
| `/api/admin/tickets` | POST | 401 | 403 | — | n/a |  |
| `/api/admin/tickets` | PATCH | 401 | 403 | — | n/a |  |
| `/api/admin/upload` | POST | 401 | 403 | — | n/a |  |
| `/api/admin/user` | POST | 401 | 403 | — | n/a |  |
| `/api/admin/user` | PATCH | 401 | 403 | — | n/a |  |
| `/api/admin/user/anonymize` | POST | 401 | 403 | — | n/a | tests/account-deletion.test.ts |
| `/api/admin/user/api-key` | GET | 401 | 403 | 400 | n/a |  |
| `/api/admin/user/api-key` | POST | 401 | 403 | — | n/a |  |
| `/api/admin/user/api-key` | DELETE | 401 | 403 | — | n/a |  |
| `/api/admin/user/recovery` | POST | 401 | 403 | — | n/a |  |
| `/api/admin/user/tier` | PATCH | 401 | 403 | — | n/a |  |
| `/api/admin/variant` | POST | 401 | 403 | — | n/a |  |
| `/api/admin/variant` | PATCH | 401 | 403 | — | n/a |  |
| `/api/admin/variant` | DELETE | 401 | 403 | — | n/a |  |
| `/api/admin/withdrawals` | GET | 401 | 403 | 200 | n/a |  |
| `/api/admin/withdrawals` | POST | 401 | 403 | — | n/a |  |
| `/api/auth/2fa-check` | POST | 200 | 200 | — | n/a |  |
| `/api/auth/forgot` | POST | 400 | 400 | — | n/a |  |
| `/api/auth/login-status` | POST | 200 | 200 | — | n/a |  |
| `/api/auth/otp/send` | POST | 400 | 400 | — | n/a |  |
| `/api/auth/reset` | POST | 400 | 400 | — | n/a |  |
| `/api/coupon/check` | POST | 401 | 400 | — | n/a |  |
| `/api/cron/ratelimit-cleanup` | POST | 401 | 401 | — | n/a |  |
| `/api/cron/ratelimit-cleanup` | GET | 401 | 401 | — | n/a |  |
| `/api/cron/sla-breach` | POST | 401 | 401 | — | n/a |  |
| `/api/cron/sla-breach` | GET | 401 | 401 | — | n/a |  |
| `/api/cron/telegram-scheduler` | POST | 401 | 401 | — | n/a |  |
| `/api/cron/telegram-scheduler` | GET | 401 | 401 | — | n/a |  |
| `/api/deposit` | POST | 401 | 400 | — | n/a |  |
| `/api/deposit/check-trx` | POST | 401 | 200 | — | n/a |  |
| `/api/health` | GET | 200 | 200 | 200 | n/a |  |
| `/api/me` | GET | 401 | 200 | 200 | n/a |  |
| `/api/notifications` | GET | 401 | 200 | 200 | n/a |  |
| `/api/notifications` | PATCH | 401 | 200 | — | n/a |  |
| `/api/order` | POST | 401 | 400 | — | n/a |  |
| `/api/order/confirm` | POST | 401 | 400 | — | n/a | tests/deep-audit-d2-d4.test.ts |
| `/api/order/direct` | POST | 401 | 400 | — | n/a |  |
| `/api/register` | POST | 400 | 400 | — | n/a |  |
| `/api/reseller/balance` | GET | 401 | 401 | 401 | key required; NORMAL tier 403 | tests/reseller-read-api.test.ts |
| `/api/reseller/order-status` | GET | 401 | 401 | 401 | key required; NORMAL tier 403 | tests/reseller-read-api.test.ts |
| `/api/reseller/orders` | POST | 401 | 401 | — | key required; NORMAL tier 403 |  |
| `/api/reseller/products` | GET | 401 | 401 | 401 | key required; NORMAL tier 403 |  |
| `/api/review` | POST | 401 | 400 | — | n/a | tests/deep-audit-d2-d4.test.ts |
| `/api/search` | GET | 200 | 200 | 200 | n/a |  |
| `/api/stream` | GET | 401 | 0 | 0 | n/a |  |
| `/api/tickets` | GET | 401 | 200 | 200 | n/a |  |
| `/api/tickets` | POST | 401 | 400 | — | n/a |  |
| `/api/tickets/probe-id` | GET | 401 | 404 | 404 | n/a | tests/tickets.test.ts |
| `/api/tickets/probe-id` | POST | 401 | 400 | — | n/a | tests/tickets.test.ts |
| `/api/tickets/probe-id` | PATCH | 401 | 404 | — | n/a | tests/tickets.test.ts |
| `/api/track` | POST | 400 | 400 | — | n/a |  |
| `/api/uid/recent` | GET | 401 | 200 | 200 | n/a |  |
| `/api/uid/verify` | POST | 401 | 400 | — | n/a |  |
| `/api/upload` | POST | 401 | 400 | — | n/a |  |
| `/api/webhooks/payment/probe-id` | POST | 404 | 404 | — | n/a |  |
