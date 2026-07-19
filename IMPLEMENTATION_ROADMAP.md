# IMPLEMENTATION_ROADMAP.md

**Date:** 2026-07-18
**Source documents:** `COMPETITOR_ANALYSIS.md`, `MANUAL_WORKFLOW.md`, `IDEAL_PLATFORM_ARCHITECTURE.md`
**Supporting evidence:** `QA_REPORT.md`, `BUG_FIX_REPORT.md`, `AUDIT_REPORT.md`

Every recommendation from the three source documents is grouped below into five phases. Each item carries priority, complexity, business impact, dependencies, risk, and explicit flags for **schema change** and **workflow change**.

**Legend**
- **Priority:** P0 (blocker) · P1 (high) · P2 (medium) · P3 (low)
- **Complexity:** S (<½ day) · M (1–2 days) · L (3–5 days) · XL (>1 week)
- **Impact:** ★☆☆☆☆ → ★★★★★
- **Risk:** how likely this is to break something that currently works

---

## PHASE 1 — CRITICAL FOUNDATION

Security, data integrity, and correctness. No feature work should precede these.

| ID | Task | Pri | Cplx | Impact | Depends | Risk | Schema? | Workflow? |
|---|---|---|---|---|---|---|---|---|
| **1.1** | **Upgrade Next.js 14.2.15 → 14.2.35** | P0 | S | ★★★★★ | — | **Low** (same minor) | No | No |
| **1.2** | **Apply DB CHECK constraints (no psql dependency)** | P0 | S | ★★★★★ | — | **Medium** (fails if data violates) | No (constraints only) | No |
| **1.3** | **Connection-pool tuning + cold-start resilience** | P0 | S | ★★★★☆ | — | Low | No | No |
| **1.4** | **Timezone correctness (`Asia/Dhaka`)** | P1 | S | ★★★★☆ | — | Low | No | No |
| **1.5** | **DB-failure states on money pages** | P1 | M | ★★★★☆ | 1.3 | Low | No | No |
| **1.6** | Distributed rate limiting (Redis/Upstash) | P0 | M | ★★★★★ | **Redis credentials** | Medium | No | No |
| **1.7** | Resolve backup password-hash policy | P1 | S | ★★★★☆ | **Owner decision** | High (breaks restore) | No | **Yes** |
| **1.8** | Verify Google OAuth account-linking path | P1 | M | ★★★★☆ | **OAuth credentials** | Medium | No | Possibly |

### Phase 1 execution notes

**1.1 — Next.js upgrade.** `next@14.2.35` is the same minor version, 20 patches ahead. Fixes include **GHSA-f82v-jwr5-mffw (Authorization Bypass in Middleware)**, patched in 14.2.25, plus cache-poisoning and SSRF advisories. Chosen deliberately over `next@16` (which `npm audit fix --force` proposes) because 16 is a two-major migration requiring a full regression pass. This captures most of the security benefit at a fraction of the risk.

**1.2 — DB constraints.** `prisma/constraints.sql` exists but is applied via `psql`, which **is not installed in this environment**, and is excluded from `db:setup` (`AUDIT_REPORT.md` H2). Must be re-implemented as a Node/Prisma script so it works everywhere. Carries genuine risk: if any existing row violates a constraint, the `ALTER TABLE` fails — so the script must pre-check and report violations rather than crash.

**1.3 — Connection pool.** QA observed live pool exhaustion (`connection limit: 9`) and `P1017` disconnects against Neon, crashing an account page. Needs an explicit `connection_limit` / `pool_timeout` on `DATABASE_URL` and a documented cold-start posture.

**1.4 — Timezone.** `src/lib/date.ts` has no `timeZone`, so it renders in *server* local time. Correct by luck on this Windows machine (Asia/Dhaka), **wrong on Vercel (UTC)** — a 6-hour error on deposit/order/audit timestamps. Directly affects money dispute evidence.

**1.5 — DB-failure states.** Account/wallet pages currently throw to the error boundary on transient DB failure. A naive `try/catch` is *wrong* (would render ৳0.00 balance during an outage). Needs a purpose-built "could not load" state.

### Blocked items (cannot be completed in this environment)

**1.6, 1.7, 1.8 cannot be honestly completed here:**
- **1.6** requires Redis/Upstash credentials that do not exist in `.env`. A pluggable adapter can be built, but without a backing store it changes nothing operationally — deferring avoids the illusion of a fix.
- **1.7** is a product decision about disaster-recovery semantics (strip hashes and force reset, encrypt the backup, or document handling). Not mine to make.
- **1.8** requires Google OAuth credentials to exercise the linking flow.

These are **flagged, not silently skipped.** They remain P0/P1 and should be scheduled as soon as the blocking input is available.

---

## PHASE 2 — CUSTOMER EXPERIENCE

Trust, conversion, and first-purchase friction.

| ID | Task | Pri | Cplx | Impact | Depends | Risk | Schema? | Workflow? |
|---|---|---|---|---|---|---|---|---|
| 2.1 | **Published SLA + live countdown** | P1 | M | ★★★★★ | 1.4 | Low | **Yes** (`slaDueAt`) | **Yes** |
| 2.2 | **Order status pipeline (`OrderEvent`)** | P1 | M | ★★★★★ | 2.1 | Low | **Yes** (new model) | **Yes** |
| 2.3 | **Live UID validation** | P1 | L | ★★★★★ | External API | **High** (3rd-party dep) | **Yes** | **Yes** |
| 2.4 | **Direct-pay path (non-wallet)** | P1 | L | ★★★★★ | 1.2 | **High** (money path) | **Yes** (`intent`) | **Yes** |
| 2.5 | Structured rejection reasons | P1 | M | ★★★★☆ | — | Low | **Yes** (enum/field) | **Yes** |
| 2.6 | Cancellation reason surfaced to customer | P1 | S | ★★★★☆ | 2.5 | Low | No | Minor |
| 2.7 | Real computed trust metrics (replace fake stats) | P1 | M | ★★★★☆ | — | Low | **Yes** (`TrustMetric`) | No |
| 2.8 | Mobile bottom tab bar | P2 | M | ★★★★☆ | — | Medium (layout) | No | **Yes** (nav) |
| 2.9 | Post-delivery "did it arrive?" confirmation | P2 | M | ★★★★☆ | 2.2 | Low | **Yes** (`Review`) | **Yes** |
| 2.10 | Secure order tracking (token/2-factor) | P2 | M | ★★★★☆ | — | Medium (auth surface) | **Yes** (token) | **Yes** |
| 2.11 | Persistent order receipt page | P2 | S | ★★★☆☆ | 2.2 | Low | No | Minor |
| 2.12 | Saved/recent UIDs | P3 | S | ★★★☆☆ | 2.3 | Low | **Yes** | Minor |
| 2.13 | One-tap reorder | P3 | S | ★★★☆☆ | — | Low | No | Minor |
| 2.14 | Per-package honest delivery badges | P3 | S | ★★★☆☆ | 2.1 | Low | **Yes** (optional) | No |
| 2.15 | Duplicate-TrxID check on blur | P3 | S | ★★☆☆☆ | — | Low | No | No |
| 2.16 | "Most popular" tier + per-diamond value hint | P3 | S | ★★☆☆☆ | — | Low | No | No |
| 2.17 | Operational-status banner (queue honesty) | P3 | S | ★★★☆☆ | — | Low | **Yes** (setting) | No |

---

## PHASE 3 — ADMIN EXPERIENCE

Admin throughput is customer-perceived latency.

| ID | Task | Pri | Cplx | Impact | Depends | Risk | Schema? | Workflow? |
|---|---|---|---|---|---|---|---|---|
| 3.1 | **Verification queue redesign (card, mobile-first)** | P1 | L | ★★★★★ | — | Medium | No | **Yes** |
| 3.2 | **Unified admin search** | P1 | M | ★★★★★ | — | Low | No | No |
| 3.3 | **Complete audit-log coverage** | P1 | M | ★★★★☆ | — | Low | No | No |
| 3.4 | Copy-to-clipboard on TrxID / UID | P1 | S | ★★★★☆ | — | Low | No | Minor |
| 3.5 | Risk signals on deposit cards | P2 | M | ★★★★☆ | — | Low | **Yes** (`CustomerRisk`) | **Yes** |
| 3.6 | Trust-graded review tiers | P2 | L | ★★★★☆ | 3.5 | **High** (fraud posture) | **Yes** | **Yes** |
| 3.7 | Order claim/lock (multi-admin) | P2 | M | ★★★☆☆ | — | Medium | **Yes** | **Yes** |
| 3.8 | Bounded bulk actions | P2 | L | ★★★☆☆ | 3.1 | **High** (money) | No | **Yes** |
| 3.9 | SLA breach alerting | P2 | M | ★★★★☆ | 2.1 | Low | No | **Yes** |
| 3.10 | Admin dashboard operational metrics | P2 | M | ★★★☆☆ | — | Low | No | No |
| 3.11 | Keyboard shortcuts (J/K/A/R) | P3 | S | ★★★☆☆ | 3.1 | Low | No | Minor |
| 3.12 | Group fulfilment queue by product | P3 | S | ★★★☆☆ | — | Low | No | Minor |
| 3.13 | Customer 360 timeline view | P3 | M | ★★★☆☆ | 3.2 | Low | No | No |
| 3.14 | Partial refunds | P3 | L | ★★☆☆☆ | — | **High** (money) | **Yes** | **Yes** |
| 3.15 | Canned support responses | P3 | S | ★★☆☆☆ | — | Low | **Yes** | No |

---

## PHASE 4 — PERFORMANCE & QUALITY

| ID | Task | Pri | Cplx | Impact | Depends | Risk | Schema? | Workflow? |
|---|---|---|---|---|---|---|---|---|
| 4.1 | Extract domain services (`lib/services/*`) | P1 | L | ★★★★☆ | Phase 1 | **High** (touches money core) | No | No |
| 4.2 | Automated test suite for money invariants | P1 | L | ★★★★★ | 4.1 | Low | No | No |
| 4.3 | Fix soft-404 on missing products | P2 | M | ★★★☆☆ | — | Medium (SSG/streaming) | No | No |
| 4.4 | Resolve stale neon theme (3 files) | P2 | S | ★★☆☆☆ | **Owner approval** | Low | No | No |
| 4.5 | De-duplicate `/api/me` + `/api/notifications` calls | P2 | S | ★★☆☆☆ | — | Low | No | No |
| 4.6 | Settings caching | P3 | S | ★★☆☆☆ | — | Low | No | No |
| 4.7 | Remove dead `src/(public)/` duplicate | P3 | S | ★☆☆☆☆ | Verify unused | Low | No | No |
| 4.8 | Map CSS vars into Tailwind theme | P3 | S | ★★☆☆☆ | — | Low | No | No |
| 4.9 | Mobile menu touch target ≥40px | P3 | S | ★☆☆☆☆ | — | Low | No | No |
| ~~4.10~~ | ~~Granular admin permission tiers~~ — ❌ **DECLINED** (owner decision: single administrative role; partial `STAFF` build fully removed) | — | — | — | — | — | No | No |

---

## PHASE 5 — NICE-TO-HAVE ENHANCEMENTS

| ID | Task | Pri | Cplx | Impact | Depends | Risk | Schema? | Workflow? |
|---|---|---|---|---|---|---|---|---|
| 5.1 | On-page reviews + Q&A | P2 | L | ★★★★☆ | 2.9 | Low | **Yes** | **Yes** |
| 5.2 | Catalogue depth + bundles | P2 | M | ★★★☆☆ | — | Low | No (data) | No |
| 5.3 | Telegram/Messenger owned channel | P3 | M | ★★★☆☆ | — | Low | **Yes** | No |
| 5.4 | Referral prompt at peak satisfaction | P3 | S | ★★★☆☆ | 2.9 | Low | No | Minor |
| 5.5 | Wallet top-up bonus | P3 | M | ★★★☆☆ | 1.2 | **High** (money) | **Yes** | **Yes** |
| 5.6 | Loyalty (every 10th order) | P3 | M | ★★☆☆☆ | 5.5 | High (money) | **Yes** | **Yes** |
| 5.7 | Per-product tutorial videos | P3 | S | ★★★☆☆ | — | Low | **Yes** | No |
| 5.8 | Bengali SEO blog | P3 | XL | ★★☆☆☆ | — | Low | **Yes** | No |
| 5.9 | Reseller API + scoped keys | P3 | XL | ★★☆☆☆ | 4.1, 1.6 | High | **Yes** | **Yes** |
| 5.10 | Affiliate programme | P3 | XL | ★★☆☆☆ | 5.9 | Medium | **Yes** | **Yes** |
| 5.11 | Status badges (Sold Out / discount) | P3 | S | ★★☆☆☆ | — | Low | No | No |
| 5.12 | Related items cross-sell | P3 | S | ★★☆☆☆ | — | Low | No | No |
| 5.13 | Dual-currency display | P3 | S | ★☆☆☆☆ | — | Low | No | No |
| 5.14 | Native app wrapper | P3 | XL | ★★☆☆☆ | 2.8 | Medium | No | No |

---

## Selected Phase 1 Work (executing now)

Chosen by business impact, weighted for what is actionable without external inputs:

| Order | ID | Task | Rationale |
|---|---|---|---|
| 1 | **1.1** | Next.js 14.2.35 | Critical CVEs incl. middleware auth bypass. Highest impact, lowest risk. |
| 2 | **1.2** | DB constraints | Last-resort money guard; currently absent in every environment. |
| 3 | **1.3** | Connection pool | Observed live outage crashing a money page. |
| 4 | **1.4** | Timezone | Silent 6-hour error on all dispute-evidence timestamps in production. |
| 5 | **1.5** | DB-failure states | Prevents misleading ৳0.00 balance during an outage. |

**1.6, 1.7, 1.8 are blocked on external inputs** (Redis credentials, an owner decision, OAuth credentials) and are explicitly **not** marked complete. Phase 2 will not begin until they are either resolved or formally deferred by the owner.

Each task: implement → `npm run typecheck` → `npm run lint` → Playwright verification → update `IMPLEMENTATION_REPORT.md` → continue.
