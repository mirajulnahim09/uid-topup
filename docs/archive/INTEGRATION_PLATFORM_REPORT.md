# INTEGRATION_PLATFORM_REPORT.md

**Project:** UID TopUp (v2)
**Date:** 2026-07-31
**Goal:** extend the payment-provider pattern to **every external integration** via a centralized, SOLID **Integration Hub** — architecture only, no live integrations, and no disturbance to the proven money engine.

> Guardrail honored: reviewed the existing modules (email, payments, storage, settings) first and **reused** them as "builtin" providers instead of rebuilding. The money/order routes were touched only with a guarded, post-transaction, no-op seam, re-verified by the 18/18 money invariants.

---

## 1. Architecture

### 1.1 Common interfaces (`src/lib/integrations/types.ts`)
A `BaseProvider` (`id`, `label`, `category`, `kind`, `isConfigured()`) plus one interface per category — business logic depends only on these (DIP):
- **FulfillmentProvider** `deliver(job) → Delivery`
- **EmailProvider / SmsProvider / PushProvider** `send(msg) → SendResult`
- **WebhookProvider** `dispatch(event, payload)`
- **AiProvider** `complete(prompt)`
- **AnalyticsProvider** `track(event, props)`
- **Payment** and **Storage** keep their existing dedicated interfaces (`lib/payments`, `lib/storage`) and are surfaced in the catalog.

### 1.2 The Hub (`src/lib/integrations/hub.ts`) — composition root
- **Builtins reuse existing code:** `email → Resend` (via a new additive `sendEmail` in `lib/email.ts`), `payment → payments registry`, `storage → lib/storage`. `fulfillment → manual` (returns `MANUAL`; a human delivers — today's flow).
- **Stubs for every future provider** (structurally ready, `isConfigured()` from env, methods throw a clear "ready but inactive" error until an SDK is added):
  - Fulfillment: game-api, third-party, internal-automation, hybrid
  - Email: SMTP, SendGrid, Mailgun, Amazon SES
  - SMS: Twilio, bKash SMS, Custom Gateway
  - Push: Firebase Cloud Messaging, OneSignal
  - Webhook: Outgoing, Incoming
  - AI: Anthropic, OpenAI
  - Analytics: Plausible, Google Analytics, PostHog
  - Payment: bKash, Nagad, Rocket, SSLCommerz, Stripe, PayPal, Razorpay (from the payment layer)
  - Storage: Local, Vercel Blob, Amazon S3, Cloudflare R2 (from the storage layer)
- **Enable / active resolution** from settings: `integration_<category>_<id>_enabled` and `integration_<category>_active`. Builtins default-enabled; stubs default-off.
- **Typed accessors** business logic uses (never a concrete service): `hub.email()`, `hub.sms()`, `hub.push()`, `hub.fulfillment()`, `hub.webhookOut()`, `hub.ai()`, `hub.analytics()` — each returns the **active** provider (enabled + configured), else the builtin fallback, else `null`. `allProviderInfos()` powers the admin catalog.

### 1.3 Fulfillment service (`src/lib/fulfillment/service.ts`)
`fulfillOrder(job)` is **the only thing the Order Service talks to** (DIP). It combines the fulfillment *policy* (manual/automatic) with the active fulfillment *provider*. Today both are manual → it always returns `MANUAL`, so the order flow is unchanged. A configured fulfillment gateway + `order_approval=automatic` would flip it — **without touching the order route**.

### 1.4 Admin configuration
- **`/admin/integrations`** page + **`IntegrationsManager`** + **"ইন্টিগ্রেশন" nav tab**: every category grouped, with per-provider **enable toggle**, **active** selection, and `configured`/`kind`/`ACTIVE` badges. Payment (read-only, links to `/admin/payments`) and Storage (env-driven) are shown for a complete picture. A banner makes the "no live integration; safe fallback" rule explicit.
- Persists through the existing audited `/api/admin/settings` route (added a bounded `integration_*` key pattern; values still `cleanText`-sanitised).

---

## 2. Why this is SOLID
- **S** — types define contracts; the hub composes; the service decides; the UI configures; each provider does one job.
- **O** — add a provider = one line in the hub list (+ later fill its method); core untouched.
- **L** — every provider is substitutable behind its category interface.
- **I** — narrow, category-specific interfaces (an SMS provider isn't forced to implement `complete()`).
- **D** — business logic depends on `hub.<category>()` accessors and `fulfillOrder()`, never on Twilio/SendGrid/FCM/etc.

---

## 3. Verification
| Gate | Result |
|---|---|
| `tsc --noEmit` | ✅ clean |
| `next lint` | ✅ no warnings/errors |
| `next build` | ✅ 76 pages (`/admin/integrations` compiled) |
| **`npm run test:money`** | ✅ **18 / 18** — the order-route fulfillment seam did **not** regress the money model |
| Playwright — `/admin/integrations` | ✅ renders all categories: payment (read-only), fulfillment (manual active), builtins vs "not configured" stubs, enable/active controls |

---

## 4. How to add a real integration later
1. Replace the stub's method(s) with the SDK call (e.g., `sms.twilio.send`), or add a `providers/<id>.ts` and register it in the hub list.
2. Set its env keys → `isConfigured()` becomes true.
3. In `/admin/integrations`: enable it and mark it **Active** for that category.
4. Business logic already calls `hub.<category>()` / `fulfillOrder()` — **no changes needed**.

## 5. Limitations (honest)
- **No live integration is implemented** — by design. Non-builtin providers throw until their SDK + keys are added.
- Business flows are **not yet rewired** to route through `hub.email()`/`hub.sms()` etc. (that would change working code with no live provider to test against); the accessors + seams are ready and the one demonstrated seam (`fulfillOrder` in the order route) is a proven no-op.
- Env-var names in the hub are conventions; align them with whichever SDK you integrate.
- Storage/payment retain their own management surfaces (`STORAGE_DRIVER`, `/admin/payments`) and are shown read-only in the hub for a single pane of glass.

## 6. Result
A production-quality, unified Integration Hub is in place across payment, fulfillment, SMS, email, push, webhook, storage, AI, and analytics — provider-based, SOLID, admin-configurable, and **verified not to disturb the money engine (18/18)**. Dev server and headed preview remain live.
