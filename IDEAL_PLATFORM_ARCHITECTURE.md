# IDEAL_PLATFORM_ARCHITECTURE.md

**Target architecture for an ideal manual top-up platform**

**Date:** 2026-07-18
**Status:** Architectural proposal. **Nothing in this document is implemented.**
**Baseline:** The existing UID TopUp codebase (Next.js 14 App Router + Prisma/PostgreSQL + NextAuth), as verified in `QA_REPORT.md`.

**Framing:** This is not a rewrite proposal. The QA audit established that the transactional core — row-locked money mutations, immutable ledger, atomic refunds, triple-gated authorization, server-side price derivation — is **correct and load-bearing**. That core is an asset most competitors in this category do not appear to have. The gaps are at the edges: customer confidence, first-purchase friction, and admin throughput.

**Guiding principle:** *Keep the money core exactly as it is. Build confidence and throughput around it.*

---

## 1. Architectural Position

### What is already right (preserve without compromise)

| Capability | Status |
|---|---|
| Row-locked `$transaction` on every balance mutation | ✅ Verified under concurrent attack |
| Immutable `LedgerEntry` audit trail with `balanceAfter` | ✅ Verified |
| Atomic three-part refund (balance + stock + coupon) | ✅ Verified |
| Snapshot pricing on orders | ✅ Verified |
| Triple-gated admin authorization | ✅ Verified independently of middleware |
| Server-side price re-derivation | ✅ Price tampering rejected |
| Duplicate-TrxID and double-spend rejection | ✅ Verified |
| `AdminLog` with actor / action / target / amount / IP | ✅ Present |

**These are non-negotiable invariants.** Every proposal below is additive and must not weaken them.

### What is missing (the actual work)

| Gap | Impact | Layer |
|---|---|---|
| No UID validation | Unrecoverable mis-delivery | Product |
| Wallet is the only payment path | First-purchase conversion tax | Product |
| No stated SLA or countdown | Anxiety during wait | Product |
| No customer-visible proof | Trust deficit | Product |
| No mobile bottom navigation | Ergonomics | Product |
| Admin queue not optimised for speed | Throughput → customer latency | Ops |
| No SLA breach alerting | Silent failures | Ops |
| In-memory rate limiting on serverless | Unreliable abuse control | Platform |
| DB constraints not applied by default | App-layer is the only guarantee | Platform |
| Critical dependency CVEs | Security exposure | Platform |
| Connection pool untuned for serverless | Outages under cold start | Platform |

---

## 2. System Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                      CLIENT (mobile-first)                    │
│  Public shell · Account shell · Admin console                 │
│  Bottom tab nav · Live order status · Push/in-app notify      │
└───────────────────────────┬──────────────────────────────────┘
                            │
┌───────────────────────────▼──────────────────────────────────┐
│                      EDGE / MIDDLEWARE                        │
│  Auth gate · Role gate · CSP & security headers               │
│  Distributed rate limiting  ← replaces in-memory              │
└───────────────────────────┬──────────────────────────────────┘
                            │
┌───────────────────────────▼──────────────────────────────────┐
│                     APPLICATION LAYER                         │
│  guard.ts (requireUser / requireAdmin, DB-reverified)         │
│  zod validation · sanitize · apiError                         │
├───────────────────────────────────────────────────────────────┤
│                      DOMAIN SERVICES                          │
│  ┌─────────────┐ ┌─────────────┐ ┌──────────────┐            │
│  │   Wallet    │ │   Orders    │ │  Fulfilment  │            │
│  │ deposit/    │ │ place/      │ │ claim/       │            │
│  │ approve/    │ │ price/      │ │ deliver/     │            │
│  │ refund      │ │ coupon      │ │ fail         │            │
│  └──────┬──────┘ └──────┬──────┘ └───────┬──────┘            │
│         └───────────────┼────────────────┘                    │
│                  ┌──────▼──────┐                              │
│                  │   LEDGER    │  ← single source of truth    │
│                  │ (immutable) │     for every money movement │
│                  └──────┬──────┘                              │
│  ┌────────────┐ ┌───────▼──────┐ ┌───────────┐               │
│  │ UID Verify │ │  Notify      │ │ Audit Log │               │
│  │ (external) │ │ in-app/email │ │           │               │
│  └────────────┘ └──────────────┘ └───────────┘               │
├───────────────────────────────────────────────────────────────┤
│              PERSISTENCE — PostgreSQL + Prisma                │
│   Decimal(12,2) money · CHECK constraints · row locks         │
└───────────────────────────────────────────────────────────────┘
```

**Key structural change:** extract **domain services** (`lib/services/wallet.ts`, `orders.ts`, `fulfilment.ts`) from the route handlers. Today the money logic lives inside API routes. It is correct, but it is only reachable via HTTP — which blocks reuse by admin bulk actions, scheduled jobs, and a future reseller API, and makes it hard to unit-test.

The rule: **routes handle HTTP; services own invariants.** A service function must be impossible to call in a way that violates a money invariant.

---

## 3. Data Model Extensions

Additive only. No existing model is restructured.

### 3.1 Fulfilment SLA & status timeline
```
Order
  + processingAt      DateTime?    // admin claimed it
  + deliveredAt       DateTime?
  + slaDueAt          DateTime     // computed at placement
  + claimedByAdminId  String?      // prevents double-work
  + verifiedPlayerName String?     // from UID validation

OrderEvent  (new — append-only)
  id, orderId, status, note, actorType (SYSTEM|ADMIN|CUSTOMER), actorId, createdAt
```
`OrderEvent` powers the customer-facing status pipeline **and** gives support an exact timeline. Append-only, mirroring the `LedgerEntry` philosophy.

### 3.2 UID validation
```
Product
  + uidValidationProvider  String?   // null = no validation available

UidLookupCache  (new)
  provider, uid, playerName, checkedAt
  @@unique([provider, uid])
```
Cache aggressively — the same UID is looked up repeatedly, and the upstream service is neither fast nor guaranteed available.

### 3.3 Direct pay (non-wallet purchase)
```
Deposit
  + intent        DepositIntent  // WALLET_TOPUP | ORDER_PAYMENT
  + linkedOrderId String?
```
This is the **minimal-risk way** to add direct pay: a direct-pay order creates a `PENDING` order plus a linked deposit claim. On approval, the existing verified transaction credits the wallet and immediately debits it for the order — **atomically, in one transaction, reusing the ledger path that is already proven correct.**

No second money path is introduced. The ledger remains the single source of truth. This is deliberately conservative: inventing a parallel payment flow would fork the most safety-critical code in the system.

### 3.4 Trust & proof
```
Review (new)
  orderId (unique), userId, rating, body, isPublished, createdAt

TrustMetric (new — periodically computed)
  key, value, computedAt     // real order counts, real avg rating
```
Published statistics must be **computed from real data**, never hardcoded. This directly addresses the "unverifiable claims" anti-pattern.

### 3.5 Risk signals
```
CustomerRisk (new — derived, cached)
  userId, successfulDeposits, rejectedDeposits,
  senderNumberMismatches, lastFlagAt, trustTier
```
Drives the trust-graded admin queue (§5.2).

---

## 4. Customer-Facing Architecture

### 4.1 Mobile shell
- **Persistent bottom tab bar**: Home · Add Money · My Orders · Support · Profile
- **Order status badge** on the Orders tab when anything is pending — the single most-checked state
- Existing dark "Maison" theme retained; the competitor light theme is not inherently better and the visual identity is an asset

### 4.2 UID validation service
```
POST /api/uid/verify  { productId, uid } → { playerName } | { unavailable: true }
```
- Rate-limited per user (it proxies a third-party service)
- Cached via `UidLookupCache`
- **Degrades gracefully**: on provider failure, return `unavailable` and let the UI fall back to double-entry confirmation. **Never block a sale on a third-party outage.**
- Verified name persisted to `Order.verifiedPlayerName` and shown to the admin at fulfilment

### 4.3 Order status pipeline
Driven by `OrderEvent`, surfaced with timestamps, an SLA countdown, and auto-refresh (the existing `AutoRefresh` component already provides the polling primitive).

### 4.4 Secure order tracking
Adopt BD Game Ghor's guest-tracking idea, **without** its enumeration flaw:
- Lookup requires **order number + registered phone/email**, or a signed opaque token emailed at purchase
- Rate-limited and audit-logged
- Never expose Player UID or full sender number to an unauthenticated lookup

---

## 5. Admin Architecture

### 5.1 Verification queue
Single-column, oldest-first, one card per screen. All comparison data on the card. One-tap copy on TrxID. One-tap approve; reject requires a structured reason.

### 5.2 Trust-graded review
`CustomerRisk.trustTier` determines the friction:

| Tier | Signals | Flow |
|---|---|---|
| **Trusted** | 10+ clean deposits, matching sender | One-tap approve |
| **Normal** | Some history, no flags | Standard review |
| **Elevated** | New account, sender mismatch, velocity | Forced deliberate review + warnings |

This is the highest-leverage admin change: it concentrates human attention where fraud actually occurs instead of spreading it uniformly.

### 5.3 Bulk actions — bounded
- **Permitted:** bulk claim, bulk mark-processing, bulk complete, bulk notify
- **Restricted:** bulk approve requires explicit selection + a confirmation showing **total value**
- **Forbidden:** any unbounded "approve all"

### 5.4 Unified search
One input resolving order no, deposit no, TrxID, phone, email, Player UID, name — because the real query is a pasted support message.

### 5.5 Complete audit coverage
Extend `adminLog(...)` to the product, variant, coupon, banner, payment, social, and settings routes (currently unlogged), and add a per-customer audit view.

### 5.6 SLA alerting
A scheduled job flags orders approaching and breaching `slaDueAt`, pushes the admin, and — critically — **auto-notifies the customer with an apology before they complain.**

---

## 6. Platform Hardening

Ordered by severity. These are prerequisites, not enhancements.

| # | Item | Why | Reference |
|---|---|---|---|
| 1 | **Upgrade Next.js** | Critical CVEs incl. middleware auth bypass | `BUG_FIX_REPORT.md` BUG-02 |
| 2 | **Distributed rate limiting** (Redis/Upstash) | In-memory store is unreliable on serverless | `AUDIT_REPORT.md` C2 |
| 3 | **Apply `constraints.sql` in deploy** | DB-level money guarantees currently optional | `AUDIT_REPORT.md` H2 |
| 4 | **Tune connection pool + cold-start retry** | Observed pool exhaustion crashing pages | `BUG_FIX_REPORT.md` BUG-07 |
| 5 | **Resolve backup password-hash policy** | Full credential set in a downloadable file | `BUG_FIX_REPORT.md` BUG-03 |
| 6 | **Purpose-built DB-failure states** on money pages | Must never render ৳0.00 during an outage | `BUG_FIX_REPORT.md` BUG-07 |
| 7 | **Verify the Google OAuth linking path** | Account-takeover risk, still unverified | `AUDIT_REPORT.md` |
| 8 | **Timezone-correct dates** (`Asia/Dhaka`) | Times currently server-local | `AUDIT_REPORT.md` M4 |

**Note on ordering:** items 1–4 should precede any feature work. Building customer-trust features on a stack with a known auth-bypass CVE and unreliable rate limiting inverts the priority.

---

## 7. Non-Functional Requirements

| Dimension | Target |
|---|---|
| **Money correctness** | Every mutation row-locked, transactional, ledger-backed. Zero tolerance. |
| **Deposit verification** | < 10s admin interaction, mobile, one-handed |
| **Customer SLA** | Typical < 30 min; hard ceiling 2 h; breach auto-notified |
| **Availability** | Graceful degradation on DB/provider failure; never a blank money figure |
| **Mobile performance** | Interactive < 3s on 3G; existing 87 kB shared JS is healthy |
| **Accessibility** | WCAG 2.1 AA; zoom unrestricted; all controls labelled |
| **Auditability** | Every admin money action attributable to a person, time, and IP |
| **Localisation** | Bengali-first throughout, including all error paths |

---

## 8. Roadmap

Sequenced by dependency and risk, not by visibility.

### Phase 0 — Platform hardening *(prerequisite)*
Items 1–4 of §6. No user-visible change. Everything else depends on this being sound.

### Phase 1 — Trust foundation *(highest ROI)*
- Published SLA + countdown + `OrderEvent` status pipeline
- Structured rejection reasons with specific customer messaging
- Real computed trust metrics replacing hardcoded claims
- Post-delivery "did it arrive?" confirmation → review capture

*Mostly copy, policy, and small schema work. Largest confidence gain per unit of effort.*

### Phase 2 — Conversion
- **UID validation** (the single highest-value feature)
- **Direct pay** via linked deposit intent
- Mobile bottom tab bar
- Saved UIDs, one-tap reorder

### Phase 3 — Admin throughput
- Verification queue redesign + keyboard shortcuts
- Trust-graded review
- Unified search
- Bounded bulk actions
- Complete audit-log coverage
- SLA breach alerting

### Phase 4 — Growth
- On-page reviews and Q&A
- Catalogue depth and bundles
- Owned-channel re-engagement (Telegram/Messenger)
- Referral surfacing at peak satisfaction
- Bengali SEO content

### Phase 5 — Expansion
- Reseller API with scoped keys and its own rate limits
- Affiliate programme
- Multi-admin roles with granular permissions (`AUDIT_REPORT.md` L8)

---

## 9. Explicit Non-Goals

Stating these prevents scope drift:

1. **Do not automate delivery.** Manual verification is the fraud control and the stated business model. Speed comes from admin ergonomics, not from removing the human.
2. **Do not add a payment gateway** unless the business decides to change model. The entire security design assumes human verification.
3. **Do not rewrite the money core.** It is verified correct. Extract it into services; do not redesign it.
4. **Do not replace the visual identity.** The Maison theme is an asset; fix inconsistencies, don't restart.
5. **Do not adopt a cart.** Single-item purchase is the dominant path.
6. **Do not claim "instant"** while fulfilment is manual. Honest SLAs outperform broken promises.

---

## 10. The Strategic Thesis

Competitors win on **breadth** (Jubaly), **social proof** (BD Game Ghor), or **claimed speed** (uidtopup).

This platform's defensible position is different and, in this market, stronger:

> **The manual top-up service that is provably trustworthy — where every taka is auditable, every order's status is visible in real time, every UID is verified before money moves, and every failure is disclosed and refunded before the customer has to ask.**

The engineering foundation for that claim already exists and has been independently verified. What remains is making it **legible to the customer** — because in a market defined by fear of being scammed, verifiable trust is the product, and the diamonds are just the delivery mechanism.
