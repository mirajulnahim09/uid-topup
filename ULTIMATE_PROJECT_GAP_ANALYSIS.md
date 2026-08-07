# SS UID TOPUP — Ultimate Project Gap Analysis & Future Roadmap

**Date:** 2026-08-06
**Nature:** analysis only — nothing was implemented or changed for this document
**Basis:** 27 Prisma models · 12 enums · 71 indexes · 56 API routes · 18 admin pages · 20 customer/public pages · 140 i18n keys × 2 locales · 8 Playwright suites (~290 assertions), all executed against the running application in prior passes

---

## 0. Executive summary

**What this project is:** a manually-operated Free Fire diamond / digital-subscription top-up storefront for the Bangladesh market, with a wallet ledger, an admin operations panel, and an unusually well-built brand/theme/Telegram layer.

**What it does well.** The money path is correct and proven — deposit → human verification → wallet credit → order → manual delivery, with `SELECT … FOR UPDATE` row locking, a real ledger with `balanceAfter`, and verified behaviour under concurrency (10 duplicate deposits → 1 row; 8 concurrent orders → never negative). Authorization is airtight: 144 probes across 36 admin APIs as guest and customer produced zero 2xx. The design system, theming, brand management and loading experience are well above what this category of product usually ships.

**What holds it back.** Three things, in order of severity:

1. **Operational immaturity.** No CI, no deployment config, no error tracking, no uptime monitoring, no README, no versioned migrations. The product is more mature than the machinery around it.
2. **The commercial layer is scaffolding.** Payment gateways, fulfilment automation and the integration hub are well-designed *registries of stubs*. Seven payment providers are registered; zero can take a payment.
3. **Single-tier permissions.** `USER` and `ADMIN` only. There is no way to give a staff member scoped access — the only elevation available is full administrator.

**Overall production readiness: 72 / 100.** The application is safe and correct. It is not yet operable at commercial scale by a team.

---

# 1. CURRENT FEATURE INVENTORY

Status legend: **Complete** · **Functional** (works, gaps remain) · **Partial** · **Scaffolding** (structure only) · **Dead** (built, unused)

## 1.1 Core commerce

| Feature | Status | % | Description | Dependencies |
|---|---|---|---|---|
| Wallet + ledger | Complete | 95 | `LedgerEntry` with `balanceAfter`, credit/debit services, rollback-safe, concurrency-verified | Prisma, transactions |
| Manual deposit flow | Complete | 95 | Customer submits amount/method/sender/TrxID/screenshot; duplicate TrxID → 409 | Wallet, storage |
| Admin deposit approval | Complete | 95 | `FOR UPDATE` row lock prevents double-credit from simultaneous admins | Wallet, AdminLog |
| Deposit risk signals | Functional | 80 | `DepositQueue` shows risk level + signals per claim | Deposit |
| Order placement | Complete | 90 | Deducts exact variant price, refuses on insufficient balance, never negative | Wallet, Variant |
| Order lifecycle | Functional | 80 | PENDING → PROCESSING → COMPLETED / FAILED (auto-refund) | Orders |
| Order refund | Functional | 70 | Route exists (`/api/admin/order/refund`); **not exercised in testing** | Wallet |
| Bulk order actions | Functional | 75 | `/api/admin/order/bulk`, `/claim` for multi-admin operation | Orders |
| Coupons | Functional | 80 | Percent/fixed, min-order, max-uses, per-user limit, `CouponUse` tracking; used coupons cannot be deleted (history integrity) | Orders |
| Products / variants | Complete | 90 | Category → Product → Variant with buy/sell/strike price, profit, stock | Media |
| Categories | Complete | 90 | Sort order, active flag, homepage grouping | — |
| UID verification | Functional | 75 | `UidLookupCache` + `/api/uid/verify`; provider-backed per product | Integration hub |
| Order tracking (guest) | Functional | 80 | `/track` with `trackToken` | Orders |
| Reviews | Partial | 50 | Model + 3 files; no moderation UI surfaced | Orders |

## 1.2 Identity & access

| Feature | Status | % | Description | Dependencies |
|---|---|---|---|---|
| Credentials auth | Complete | 92 | bcrypt, dummy-hash timing defence, banned-user check | NextAuth |
| Google OAuth | Functional | 75 | Configured; account-reclaim logic for unverified credentials accounts. **Not exercised end-to-end** | NextAuth |
| Session management | Complete | 95 | JWT, 30d, `httpOnly` + `SameSite=Lax` + `secure` in prod | NextAuth |
| Brute-force guard | Complete | 95 | 5/15min per email, 10/10min per IP, enforced *before* password compare | `RateLimitBucket` |
| Email enumeration defence | Complete | 100 | Identical response whether or not the account exists, on both login and forgot | — |
| Route protection | Complete | 95 | Middleware + `requireAdmin()`; 144 probes, zero leaks | NextAuth |
| Password reset | **Broken by config** | 40 | Stateless HMAC token, 8 email templates — but silently no-ops without `RESEND_API_KEY` | Resend |
| Email verification | Partial | 55 | `emailVerified` field + reclaim logic; not enforced as a gate | Resend |
| Roles | Partial | 40 | `USER` / `ADMIN` only — no staff tier | — |
| 2FA / MFA | **Missing** | 0 | No TOTP, no recovery codes | — |

## 1.3 Admin panel — 18 pages

| Feature | Status | % | Description |
|---|---|---|---|
| Dashboard | Functional | 85 | Overview + live counts in nav tabs |
| Deposits (queue + table) | Complete | 90 | Card queue for pending, table for history/filters |
| Orders | Complete | 90 | Selection, bulk actions, claim, status filters |
| Products & pricing | Complete | 88 | Nested variant price tables, profit calculation |
| Users + detail | Functional | 85 | Ban/suspend, balance, per-user orders/deposits/ledger |
| Coupons | Complete | 88 | Full CRUD + deactivate |
| Media library | Functional | 78 | Upload, browse, picker; storage-driver abstraction |
| Banners / homepage | Functional | 80 | CMS-style control of storefront |
| Reports | Functional | 70 | Aggregates; no scheduled/exportable reporting |
| Activity logs | Complete | 90 | `AdminLog` with actor, target, detail; CSV export |
| Site settings | Complete | 90 | DB-backed settings with encrypted secrets |
| Branding | Complete | 95 | 10 logo slots × 2 themes, meta/OG, live preview |
| Telegram | Complete | 92 | Multi-bot, scheduler, templates, analytics, backup/restore |
| Payments | Scaffolding | 35 | Provider config UI; **no live driver** |
| Integrations | Scaffolding | 30 | Registry across 8 categories; only `manual` + `resend` are real |
| Tools | Functional | 75 | Operational utilities |
| Search | Functional | 70 | `/api/admin/search` |

## 1.4 Platform & experience

| Feature | Status | % | Description |
|---|---|---|---|
| Design system | Complete | 92 | Token-driven (`--v-*`), panel geometry, HUD language |
| Theme system | Complete | 95 | Dark/light/system + accent presets, flash-free via pre-paint script |
| Brand identity management | Complete | 95 | Zero hardcoded logos or strings; admin-controlled |
| Loading architecture | Complete | 95 | One overlay + one pre-hydration boot screen, same component |
| NOVA loading scene | Complete | 92 | Brand-narrative animation, 43 animations, 103 FPS, reduced-motion aware |
| Table/grid system | Complete | 90 | Single alignment vocabulary + `DataTable` engine + 2-layer regression guard |
| i18n | Functional | 80 | 140 keys × bn/en; cookie-driven, server-translated |
| Notifications (in-app) | Functional | 80 | Bell, unread count, `/account/notifications` |
| Media/storage abstraction | Functional | 75 | blob / local / s3 drivers with fallback; MIME allowlist rejects SVG + executables |
| Responsive | Complete | 90 | Verified 320–2560px, 0 overflow across 32 pages |
| Accessibility | Functional | 82 | Labelled inputs, alt text, named buttons, single h1, skip link, `lang`, reduced-motion |
| Logging | Functional | 70 | Structured logger with secret redaction at the choke point |
| Audit trail | Complete | 90 | `AdminLog` on every admin mutation |

## 1.5 Built but unused

| Item | Finding |
|---|---|
| `OrderEvent` model | **Dead** — defined in schema, written by **zero** files. An order audit trail was designed and never wired. |
| `TrustMetric` | 1 file — near-dead |
| `UidLookupCache` | 1 file — minimal use |
| Reviews | Model + partial usage, no moderation surface |

---

# 2. MISSING FEATURES

Only items that would genuinely change the platform's viability. Grouped, with the reason each matters.

## 2.1 Payments & money (highest commercial impact)

| Missing | Why it matters |
|---|---|
| **A working payment gateway driver** | Seven providers are registered; all return `CONFIGURED_PENDING`. Every taka currently requires a human to eyeball a bank app. This is the single biggest constraint on growth. |
| **Automatic deposit verification** | bKash/Nagad merchant APIs can confirm a TrxID programmatically. This removes the primary operational bottleneck. |
| **Withdrawal / payout flow** | Money only flows in. No refund-to-source or balance withdrawal exists. |
| **Financial reconciliation report** | No daily "wallet liability vs. deposits received" statement. Essential once real money scales. |
| **Invoice / receipt generation** | No PDF or durable receipt for a customer's purchase. |
| **Partial refunds** | Refund appears all-or-nothing. |

## 2.2 Fulfilment & operations

| Missing | Why it matters |
|---|---|
| **Automated delivery integration** | `fulfillment/service.ts` always returns `MANUAL`. Every order needs a human in a game client. |
| **Background job queue** | The Telegram scheduler is tick-driven. There is no general queue (retries, dead-letter, backoff) for email, delivery or webhooks. |
| **Stock / inventory alerts** | No low-stock notification. |
| **SLA timers & escalation** | No "order pending > 15 min" alerting. |
| **Staff shift / workload view** | Order claiming exists; no view of who is handling what volume. |

## 2.3 Identity & permissions

| Missing | Why it matters |
|---|---|
| **Granular roles (Owner/Manager/Support/Finance)** | Today, giving anyone admin access grants *everything* — including user balances and Telegram tokens. This is the top organisational risk. |
| **Per-permission grants** | No capability model (e.g. "can approve deposits" without "can edit products"). |
| **2FA for admin accounts** | An admin account compromise is a total compromise of customer funds. |
| **Session management UI** | No "sign out other devices", no active-session list. |
| **Admin action approval for high-risk operations** | No second-person rule on large balance adjustments. |

## 2.4 Customer experience

| Missing | Why it matters |
|---|---|
| **Working transactional email** | Blocked on config today; also no order-status emails. |
| **Support ticketing / order dispute** | Disputes currently happen off-platform (Telegram/WhatsApp). |
| **Order history filters & export** | Customers cannot search their own history. |
| **Saved UIDs / favourites** | Repeat customers re-type their player UID every time. |
| **Referral programme surface** | `referralCode` exists at registration; there is no customer-facing referral dashboard. |
| **PWA push notifications** | PWA exists; push does not. |
| **Live order status** | No websocket/SSE; customers refresh to see progress. |

## 2.5 Analytics & business intelligence

| Missing | Why it matters |
|---|---|
| **Revenue/profit dashboards over time** | Product has buy vs. sell price — margin analytics are one query away and absent. |
| **Cohort / retention analysis** | No repeat-purchase measurement. |
| **Conversion funnel** | No visibility into visit → deposit → order drop-off. |
| **Product performance ranking** | No best/worst seller view. |
| **Customer LTV** | No lifetime-value calculation. |

## 2.6 Engineering & operations

| Missing | Why it matters |
|---|---|
| **CI/CD pipeline** | None. Nothing runs typecheck/lint/tests before a deploy. |
| **Error tracking (Sentry or equivalent)** | Zero. Production exceptions are invisible. |
| **Uptime & synthetic monitoring** | `/api/health` exists but nothing watches it. |
| **Versioned migrations** | `prisma db push` only — no migration history, no reviewable schema diffs, no safe rollback. |
| **Automated database backups** | No scheduled backup or restore drill. |
| **Unit/integration test framework** | 8 excellent Playwright suites exist, but no Jest/Vitest, no coverage, and nothing runs them automatically. |
| **README / onboarding** | No README. A new developer starts from 12 report files. |
| **Runbook** | No documented incident procedures. |
| **Rate limiting beyond auth** | Only login/forgot/reset are limited. Order and deposit endpoints are not. |
| **CSP header** | Not present; would materially harden against XSS. |
| **Dependency vulnerability scanning** | No Dependabot/audit gate. |

---

# 3. IMPROVEMENT OPPORTUNITIES (existing features)

## 3.1 Weak implementations

| Area | Issue | Suggested direction |
|---|---|---|
| `sendMail()` | `if (!resend) return` — silent no-op. A misconfigured deploy is invisible. | Log at `error` when skipping; expose email health in `/api/health`. |
| `OrderEvent` | Dead model. Order history has no event trail. | Either wire it into every status transition (valuable) or drop it (honest). |
| Payment providers | Config UI implies capability that does not exist. | Label clearly as "not yet available" in the admin UI, or gate the page until one driver ships. |
| Reports | Aggregates only, no time series or export. | Date-range + CSV/XLSX export. |
| Reviews | Model exists, no moderation. | Complete or remove — half-features cost maintenance and confuse. |
| Homepage | `ƒ Dynamic`, several queries per request | ISR or a short cache; it is the highest-traffic page. |

## 3.2 Architecture

- **No caching layer anywhere.** Settings, branding, categories and products are read on nearly every request. A small in-process TTL cache (or `unstable_cache`) would remove most database round-trips — and with a **measured 305 ms** database RTT, this is the single highest-leverage performance change available.
- **`connection_limit` unset** on a pgbouncer-pooled `DATABASE_URL`. Set explicitly for the target host's concurrency model.
- **No queue abstraction.** Telegram's scheduler proves the need; generalise it before adding email/delivery retries.
- **Settings encryption falls back to `NEXTAUTH_SECRET`** when `TELEGRAM_ENC_KEY` is absent. Functional, but rotating the auth secret would render all encrypted settings permanently unreadable. Separate the keys.

## 3.3 Security

- **2FA for admins** — highest-value single addition given admins can move customer balances.
- **CSP header** — the app already rejects SVG uploads and escapes output; CSP is the remaining layer.
- **Rate-limit order/deposit endpoints** — currently only auth routes are protected.
- **Secret rotation procedure** — no documented path to rotate the Telegram token or encryption key.
- **Admin audit review UI** — `AdminLog` is captured well but there is no anomaly view ("who approved 40 deposits at 3am?").

## 3.4 Performance

- Animations are already compositor-only and queries are batched — those are done well.
- The wins remaining are **caching**, **ISR on the storefront**, and **co-locating the app with the database**. Latency today is dominated by geography, not code.

## 3.5 Maintainability & DX

- **README + `.env.example`** — the highest return-per-hour item in the entire document.
- **Migrate the bespoke Playwright scripts into a runner** (Playwright Test) so they produce standard reports and run in CI.
- **`MANUAL_PRO.md` is genuinely exceptional** — it records *why* decisions were made, including failures. Keep this practice; it is rarer than good code.
- The Bengali comment convention is consistent and valuable — keep it, but a short English README lowers the barrier for outside contributors.

## 3.6 Accessibility

- Verified: labels, alt text, button names, single `h1`, skip link, `lang`, reduced-motion.
- Not verified: **keyboard-only traversal**, **focus trapping in modals**, **focus restoration after dialog close**, and a real **screen-reader pass**. Modals exist at z-90/95/120 across several components — focus management there is the likeliest gap.

---

# 4. PRODUCTION READINESS SCORES

| Area | Score | Reasoning |
|---|---:|---|
| Core business logic | **88** | Manual flow complete and verified end-to-end; refund path untested; `OrderEvent` unused |
| Authentication | **90** | bcrypt, timing defence, enumeration defence, enforced brute-force guard; no 2FA; reset broken by config |
| Authorization | **82** | 144 probes, zero leaks — but only two roles exist |
| Wallet | **92** | Ledger, `balanceAfter`, rollback, concurrency-proven; no withdrawal/reconciliation |
| Orders | **80** | Placement/deduction proven; delivery manual; refund untested; no event trail |
| Payment architecture | **35** | Excellent scaffolding, zero live drivers |
| Admin panel | **85** | 18 pages, genuinely comprehensive; reporting and bulk tooling thin |
| Customer experience | **75** | Solid core; no working email, no support channel, no saved UIDs |
| UI/UX | **90** | Design system, theming, branding and loading are well above category norm |
| Accessibility | **80** | Verified basics; keyboard/focus/screen-reader unverified |
| Performance | **70** | Compositor-only animation, indexes, batched queries; no caching, dynamic homepage, untested at load |
| Security | **85** | XSS/SQLi/secrets/cookies/uploads all verified clean; no 2FA, no CSP, partial rate limiting |
| Scalability | **55** | No caching, no queue, no `connection_limit`, ephemeral storage fallback |
| Database | **86** | 27 models, 71 indexes, `FOR UPDATE` locking, transactions; **no versioned migrations**, no backups |
| API design | **80** | Consistent guard/validation/error shape; no versioning, no OpenAPI, inconsistent pagination |
| Documentation | **72** | `MANUAL_PRO.md` outstanding; **no README**, no API docs, no runbook |
| Deployment | **30** | No CI, no IaC, no `.env.example`, no rollback plan |
| Monitoring | **15** | Nothing. `/api/health` exists but nothing observes it |
| Logging | **68** | Good structured logger with redaction; no shipping, no retention, no alerting |
| Testing | **62** | ~290 assertions across 8 real suites — strong coverage of critical paths; no framework, no coverage metric, nothing runs in CI |

### Overall Production Readiness: **72 / 100**

Weighted toward business-critical areas. The interpretation: **the software is correct and safe; the operation around it is not yet built.** A single-operator launch is realistic today. A team-operated commercial service is not.

---

# 5. FEATURE PRIORITY MATRIX

## 🔴 Critical — must be resolved before taking real customers

| Item | Why critical |
|---|---|
| **Configure `RESEND_API_KEY`** | Password reset silently no-ops. Customers holding wallet balance get permanently locked out with no error and no server-side signal. |
| **Resolve asset storage** (`BLOB_READ_WRITE_TOKEN` or persistent-disk host) | On serverless, deposit **payment screenshots** — the evidence behind every manual approval — would be destroyed. |
| **Error tracking (Sentry)** | Without it, production failures are discovered by customers, not by you. |
| **Automated database backups + one restore drill** | Real money is in this database. An untested backup is not a backup. |
| **Versioned migrations** (`prisma migrate` instead of `db push`) | No safe way to evolve or roll back a schema holding financial records. |
| **CI running typecheck + lint + the existing suites** | The suites already exist and already catch real defects; nothing runs them. |

## 🟠 High priority — strongly recommended before scaling

| Item | Why |
|---|---|
| **Granular roles / staff tier** | Every helper you hire currently receives full control of customer funds. |
| **2FA for admin accounts** | One phished admin password compromises all balances. |
| **Rate limits on order/deposit endpoints** | Only auth is protected today. |
| **Caching layer for settings/branding/catalog** | The highest-leverage performance change, given 305 ms DB RTT. |
| **`connection_limit` + a real load test** | Scale behaviour is currently unknown. |
| **README + `.env.example` + runbook** | Bus-factor and onboarding. |
| **Wire `OrderEvent`** | Financial operations need an immutable per-order trail. |
| **Transactional order emails** | Customers currently have no notification channel that works. |

## 🟡 Medium priority

| Item | Why |
|---|---|
| One working payment gateway driver | Removes the manual bottleneck — high value, high effort |
| Automated fulfilment for at least one product line | Same |
| Reports: date ranges, CSV export, profit over time | Business visibility |
| Support ticket / dispute flow | Moves disputes on-platform |
| CSP header | Defence in depth |
| Keyboard/focus/screen-reader accessibility pass | Compliance and real usability |
| Saved UIDs, order filters | Repeat-customer friction |
| Withdrawal / payout flow | Needed once balances are large |

## 🟢 Nice to have

Referral dashboard · PWA push · live order status (SSE) · cohort & LTV analytics · invoice PDFs · multi-currency · public API for resellers · dark-mode screenshot tests · Storybook.

---

# 6. COMMERCIAL SOFTWARE REVIEW

Reviewed as if being packaged for sale.

**Missing enterprise features:** RBAC with custom roles · SSO/SAML · audit-log export & retention policy · data-residency controls · SLA/uptime commitments · white-label multi-tenancy · API keys for programmatic access · GDPR tooling (export/delete my data).

**Missing admin capabilities:** saved filters & views · scheduled reports by email · bulk import/export (products, users) · impersonate-user for support · configurable notification rules · maintenance mode · feature flags.

**Missing customer conveniences:** working email notifications · order status timeline · saved payment details/UIDs · self-service dispute · downloadable invoices · wishlist/price alerts · referral tracking UI.

**Missing automation:** payment verification · order fulfilment · retry queues with backoff · low-stock and SLA alerts · scheduled reconciliation · automated abuse detection beyond deposit risk signals.

**Missing operational tools:** monitoring dashboard · alerting/on-call · log aggregation and search · queue inspector · admin anomaly review · backup/restore automation · staging environment.

**Missing analytics:** revenue/profit time series · funnel · cohorts · LTV · product ranking · traffic attribution.

**Missing security features:** 2FA · CSP · dependency scanning · secret rotation procedure · session revocation · IP allowlist for admin · penetration test.

**Missing maintenance tools:** migration history · seed/reset for staging · data anonymisation for non-production · dead-code and dependency hygiene automation.

---

# 7. LONG-TERM ROADMAP

### v1.0 — *Launchable* (all 🔴 items)
Configure Resend and blob storage · Sentry · automated backups + a restore drill · switch to `prisma migrate` · CI running typecheck/lint/existing suites · README + `.env.example` + runbook.
**Outcome:** safe for real customers under a single operator.

### v1.1 — *Operable by a team*
Granular roles (Owner/Manager/Support/Finance) · 2FA for admins · rate limits on money endpoints · `OrderEvent` wired · transactional order emails · caching layer · `connection_limit` + a real k6 load test · uptime monitoring.
**Outcome:** you can hire staff without granting them the treasury.

### v1.5 — *Reduce manual labour*
One live payment gateway (bKash or SSLCommerz) · automated deposit verification · background job queue with retry/DLQ · support ticketing · reports with date ranges and export · low-stock and SLA alerts · accessibility pass.
**Outcome:** revenue grows without headcount growing linearly.

### v2.0 — *Commercial product*
Automated fulfilment for at least one product line · full analytics suite (revenue, funnel, cohort, LTV) · withdrawal/payout · invoices · customer self-service (saved UIDs, disputes, referral dashboard) · public reseller API with API keys · CSP and a penetration test.
**Outcome:** competitive with established regional top-up platforms.

### v3.0 — *Platform*
Multi-tenant white-label · multi-currency & multi-region · SSO/SAML · marketplace of fulfilment providers · ML-based fraud scoring on deposits · mobile app (React Native reusing the API) · GDPR tooling · 99.9% SLA with on-call.
**Outcome:** a product other operators pay to run.

---

# 8. FINAL VERDICT

### 1. What is still missing?
Operationally: CI, monitoring, backups, versioned migrations, a README. Commercially: any working payment gateway, any automated fulfilment, granular roles, and analytics. Functionally: working transactional email, 2FA, withdrawals, and a customer support channel.

### 2. What should absolutely be improved?
**Deployment and observability** — they are the weakest scores (30 and 15) and they gate everything else. You cannot safely improve what you cannot see failing. Immediately after: **the permission model**, because it is the difference between a solo operation and a business with employees.

### 3. What should NOT be changed?
These are load-bearing and correct — resist the temptation to "improve" them:

- **The manual money flow.** A human verifying a real bank transaction before any balance moves *is* the security model. Do not add auto-approval based on client-supplied data.
- **`SELECT … FOR UPDATE` in deposit approval.** This is what prevents simultaneous admins double-crediting. It is easy to lose in a refactor.
- **`GET`/`HEAD` never showing the loading overlay.** Polling endpoints were measured at 5.2 s on a cold connection; blocking on reads would freeze every page load.
- **The single loading architecture.** It replaced three competing systems and two coordination hacks. Do not add a second loader.
- **The `.num`/`.ctr` table vocabulary and its audit guard.** A Tailwind alignment utility on a `<th>` silently loses to `.tbl thead th` on specificity — this bug survived multiple fix attempts precisely because the source looks correct.
- **Secret redaction in `logger.ts`**, including the `(?<!\d)` token pattern. The obvious `\b` anchor fails on tokens embedded in URLs.
- **Enumeration-resistant responses** on login and forgot-password. The identical-message behaviour is deliberate, not a bug.
- **`MANUAL_PRO.md`'s practice of recording failures.** It is why several traps in this codebase have not been re-introduced.

### 4. If I were lead architect, what would I do before releasing?
In order, and I would not skip any:

1. Set `RESEND_API_KEY` and verify one real password reset end-to-end. *(Nothing else matters if customers can be locked out of accounts holding money.)*
2. Decide the host, then set blob storage accordingly. Confirm a deposit screenshot survives a redeploy.
3. Add Sentry and one uptime check on `/api/health`.
4. Turn on automated backups and **perform one restore into a scratch database**.
5. Convert `db push` to `prisma migrate` before the schema changes again.
6. Add a CI workflow running typecheck, lint, and the existing suites on every push — the suites already exist and already find real bugs.
7. Write a 200-line README and an `.env.example`.
8. Only then launch — to a limited cohort, with the Telegram alerting already in place.

Roles and 2FA come immediately after launch, before the first hire.

### 5. Is this good enough to compete with leading top-up platforms?
**On product experience — yes, and in places it exceeds them.** The theming, brand management, loading experience, table system and admin panel are more polished than most regional competitors, which typically ship generic Bootstrap dashboards.

**On operational capability — not yet.** Competitors' real advantage is automation: instant payment confirmation and instant delivery. This platform requires a human for both. That is a deliberate, honest trust model and it works at low volume — but it caps throughput at whatever one person can verify per hour, and customers increasingly expect instant.

**Verdict: competitive on trust and craft, not yet on speed.**

### 6. What would make this project truly exceptional?
Three things, in order:

1. **Make the manual model a feature rather than a limitation.** Competitors are opaque; this platform already refuses to fabricate marketing claims. Lean into it — show the customer a live verification timeline ("payment received 14:02 · verified by admin 14:04 · delivered 14:06"). Turn the human step into visible proof of care instead of invisible delay.
2. **Automate the verification, keep the human veto.** Auto-verify the TrxID through the bKash merchant API, but keep human approval for anything anomalous. That preserves the trust model while removing the throughput cap — the single highest-value engineering project available.
3. **Ship the operational layer.** The gap between this project and an exceptional one is not features — it is CI, monitoring, backups, roles and tests. The application is already better than its scaffolding, which is an unusual and very fixable position to be in.

> The most encouraging signal in this codebase is not any feature. It is that `MANUAL_PRO.md` documents *why* decisions were made and records the mistakes that produced them. Teams that write that down tend to compound; teams that don't tend to re-fix the same bug forever.
