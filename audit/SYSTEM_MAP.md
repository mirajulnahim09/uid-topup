# UID TopUp — System Map (audit 2026-10-31)

Built by reading the code, not the older reports. Every claim below was taken
from the file named next to it.

## 1. Stack and runtime

| Item | Value | Source |
|---|---|---|
| Framework | Next.js 14.2.35 App Router, React 18 | package.json |
| ORM / DB | Prisma 5.22, PostgreSQL (Neon pooled `DATABASE_URL`, direct `DIRECT_URL` for CLI) | prisma/schema.prisma |
| Auth | NextAuth v4, JWT strategy, 30-day maxAge, DB re-check every 5 min (`SESSION_REVALIDATE_MS`) + per-request `requireUser()` DB check | src/lib/auth.ts, src/lib/guard.ts |
| Storage | `STORAGE_DRIVER` = blob (Vercel Blob) / s3 / local | src/lib/storage/* |
| Email | Resend SDK | src/lib/email.ts |
| Rate limit | Postgres `RateLimitBucket` upsert; Upstash Redis REST if configured | src/lib/rateLimit.ts, src/lib/redis.ts |
| Cron | GitHub Actions `.github/workflows/cron.yml` (no vercel.json) calling `/api/cron/*` with `Bearer CRON_SECRET` | cron.yml, src/lib/cronAuth.ts |
| Tests | Vitest (HTTP harness: real `next dev` + docker Postgres 5433), Playwright-core scripts | vitest.config.ts, tests/globalSetup.ts |

## 2. Data model (38 models / enums)

Models: User, ApiKey, RateLimitBucket, RevokedSession, Category, Product, ProductImage,
Media, Variant, Banner, Campaign, SocialLink, PaymentChannel, Coupon, CouponUse, Deposit,
Order, OrderEvent, Review, TrustMetric, UidLookupCache, LedgerEntry, Notification, Setting,
AdminLog, TelegramMessageLog, TelegramJob, TelegramJobRun, TelegramTemplate,
PaymentGatewayConfig, Otp, Ticket, TicketMessage, Withdrawal, VoucherCode.

Enums: UserStatus, UserTier, Role, MediaType, PayMethod, DiscountType, DepositStatus,
DepositRisk, OrderActorType, OrderStatus, DepositIntent, DepositRejectReason,
OrderFailReason, LedgerType, OtpChannel, OtpPurpose, TicketStatus, TicketKind,
WithdrawalStatus, VoucherCodeStatus.

Money columns are all `Decimal(12,2)`: User.balance, Variant.price/costPrice/oldPrice/resellerPrice,
Coupon.value/minOrder/maxDiscount, CouponUse.discount, Deposit.amount, Order.subtotal/discount/price/costPrice/refundedAmount,
LedgerEntry.amount/balanceAfter, Withdrawal.amount.

Key uniques: Order(userId, clientRef), Order.trackToken, Deposit.trxId, VoucherCode(variantId, code), VoucherCode.orderId.

DB CHECK constraints (migrations 20260918120000, 20261031120000, 20261031130000): non-negative
balance/prices, stock ≥ -1, VoucherCode ASSIGNED ⇔ orderId, `order_refund_valid`
(0 ≤ refundedAmount ≤ price), `withdrawal_amount_positive`, AdminLog append-only trigger.

Migrations (18): 00000000000000_init … 20261031130000_refund_withdrawal_checks_adminlog_append_only.

## 3. Money paths (every place a balance or a paid order changes)

All balance moves go through `creditWallet` / `debitWallet` (src/lib/services/wallet.ts),
which write a LedgerEntry with `balanceAfter` from the UPDATE … RETURNING value.

| # | Path | File | Locks (in order) | Ledger type | Idempotency |
|---|---|---|---|---|---|
| M1 | Wallet order | src/lib/services/order.ts `placeOrder` ← /api/order | Variant FOR UPDATE → Coupon FOR UPDATE → User FOR UPDATE | ORDER (−) | `clientRef` + unique(userId, clientRef) |
| M2 | Reseller bulk order | /api/reseller/orders → `placeOrder` | same as M1 | ORDER (−) | per-item `clientRef` |
| M3 | Direct pay (instant) order | /api/order/direct | advisory deposit-slot → Variant → Coupon | none at create (status AWAITING_PAYMENT) | Deposit.trxId unique |
| M4 | Wallet deposit request | /api/deposit | advisory deposit-slot | none (PENDING) | trxId unique; same-user same-amount replay returns existing |
| M5 | Deposit approve / reject | /api/admin/deposit | Deposit FOR UPDATE → linked Order FOR UPDATE → (User via update) | DEPOSIT (+), then ORDER (−) for direct pay; REFERRAL_BONUS (+) | status must be PENDING under lock |
| M6 | Order fail → full refund | /api/admin/order (action FAIL) | Order FOR UPDATE | REFUND (+) | status must be PENDING/PROCESSING under lock |
| M7 | Partial refund | /api/admin/order/refund | Order FOR UPDATE | REFUND (+) | `requestId` stored in AdminLog detail; ceiling `price − refundedAmount` |
| M8 | Withdrawal request | src/lib/services/withdrawal.ts ← /api/account/withdraw | User FOR UPDATE | WITHDRAWAL (−) | one open request per user |
| M9 | Withdrawal approve / reject | /api/admin/withdrawals | Withdrawal FOR UPDATE | WITHDRAWAL_REVERSAL (+) on reject | status must be PENDING/HELD |
| M10 | Referral bonus | src/lib/referral.ts (inside M5) | User FOR UPDATE | REFERRAL_BONUS (+) | `referralBonusPaid` flag |
| M11 | Admin balance adjust | /api/admin/user (PATCH) | User FOR UPDATE | ADMIN_ADJUST (±) | — |
| M12 | Direct-pay expiry | src/lib/directPayExpiry.ts ← /api/cron/sla-breach | Deposit → Order | none (no money taken yet) | status re-checked under lock |
| M13 | Voucher-code delivery | src/lib/services/voucherCodes.ts | Order FOR UPDATE → VoucherCode FOR UPDATE SKIP LOCKED | none | VoucherCode.orderId unique |
| M14 | Auto-fulfil | src/lib/fulfillment/autoFulfill.ts | Order FOR UPDATE (claim as system) | none | claim + in-flight guard |
| M15 | Account anonymise | src/lib/services/accountDeletion.ts | User FOR UPDATE | none (refuses if balance ≠ 0) | — |

Stock restore on fail: M5 reject, M6, M12. Coupon restore on fail: M5 reject, M6, M12.

## 4. Routes

### API (89 route files) — guard per file
- Public (no session): `/api/auth/*` (NextAuth, forgot, reset, otp/send, login-status, 2fa-check), `/api/register`,
  `/api/search`, `/api/track`, `/api/health`, `/api/webhooks/payment/[provider]` (signature), `/.well-known/assetlinks.json`.
- `requireUser()`: `/api/account/*`, `/api/order`, `/api/order/direct`, `/api/order/confirm`, `/api/deposit`,
  `/api/deposit/check-trx`, `/api/coupon/check`, `/api/me`, `/api/notifications`, `/api/review`, `/api/stream`,
  `/api/tickets`, `/api/tickets/[id]`, `/api/uid/*`, `/api/upload`.
- `requireAdmin()`: every `/api/admin/*` (45 files). `/api/admin/telegram/scheduler/tick` also accepts cron Bearer.
- API key (`requireApiKey`, RESELLER tier only): `/api/reseller/orders`; read guard `requireResellerRead`: `/api/reseller/{balance,products,order-status}`.
- Cron Bearer (`assertCronAuth`): `/api/cron/{ratelimit-cleanup,sla-breach,telegram-scheduler}`.

### Pages (52)
Public: `/`, `/about`, `/contact`, `/delete-account`, `/developers`, `/faq`, `/forgot-password`, `/login`, `/privacy`,
`/product/[id]`, `/product/[id]/[slug]`, `/refund`, `/register`, `/reset-password`, `/search`, `/terms`, `/track`, `/tutorial`.
Account (middleware token + page DB guard): `/account`, `/account/codes`, `/account/notifications`, `/account/orders`,
`/account/orders/[id]`, `/account/orders/[id]/invoice`, `/account/profile`, `/account/smm-orders`, `/account/tickets`,
`/account/tickets/[id]`, `/account/wallet/deposit`, `/account/wallet/withdraw`.
Admin (middleware role=ADMIN + `requireAdmin` in layout/actions): `/admin`, banners, branding, codes, coupons, deposits,
homepage, integrations, logs, media, orders, otp, payments, products, reports, site, telegram, tickets, tools, users,
users/[id], withdrawals.

## 5. External integrations

| Integration | File | Timeout | Breaks main flow on failure? |
|---|---|---|---|
| Telegram Bot API | src/lib/telegram/api.ts | AbortController | No (fire-and-forget `.catch`) |
| Resend email | src/lib/email.ts | SDK default (none set) | No (`.catch(() => {})`) |
| Vercel Blob / S3 / local | src/lib/storage/* | SDK default | Upload route returns error |
| Upstash Redis | src/lib/redis.ts | AbortController | No — falls back to Postgres limiter |
| Game top-up provider (HTTP) | src/lib/fulfillment/httpProvider.ts | `GAME_API_TIMEOUT_MS` | No — order released to manual queue |
| SSLCommerz | src/lib/payments/providers/sslcommerz.ts | 15 s | Webhook only records the event |
| Stripe | src/lib/payments/providers/stripe.ts | n/a (signature only) | Webhook only records the event |
| Error sink | src/lib/errorReporter.ts (`SENTRY_DSN`) | none (fire-and-forget) | No |
| Tawk.to chat | CSP allow-list only | — | — |

## 6. Background jobs

| Job | Endpoint | Schedule (cron.yml) | Does |
|---|---|---|---|
| Telegram scheduler | /api/cron/telegram-scheduler | */10 min | scheduled broadcasts with 30-min lease |
| SLA breach | /api/cron/sla-breach | */15 min | SLA alerts, `sweepStuckAutoFulfill`, `expireDirectPayOrders` |
| Rate-limit cleanup | /api/cron/ratelimit-cleanup | daily 03:17 UTC | purge expired buckets and revoked sessions |

## 7. Environment variables (read in code)

Core: `DATABASE_URL`, `DIRECT_URL`, `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `NEXT_PUBLIC_SITE_URL`, `NODE_ENV`, `CRON_SECRET`,
`TRUSTED_PROXY`, `SLOW_QUERY_MS`, `CLIENT_IP_WARN_THROTTLE_MS`, `STREAM_ENABLED`, `OPS_DATABASE_URL`, `BACKUP_SIGNING_KEY`.
Auth: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` (seed only).
Storage: `STORAGE_DRIVER`, `BLOB_READ_WRITE_TOKEN`, `BLOB_PUBLIC_HOST`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PUBLIC_URL`.
Messaging: `RESEND_API_KEY`, `EMAIL_FROM`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_ENC_KEY`.
Providers: `GAME_API_URL`, `GAME_API_KEY`, `GAME_API_TIMEOUT_MS`, `FF_LOOKUP_API_KEY`, `SSLCZ_STORE_ID`, `SSLCZ_STORE_PASSWD`,
`SSLCZ_BASE_URL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `SENTRY_DSN`.
Platform (read-only): `VERCEL`, `VERCEL_REGION`, `VERCEL_GIT_COMMIT_SHA`, `NEXT_RUNTIME`, `NEXT_PHASE`.
