# FINAL AUDIT

**Date:** 2026-07-20
**Baseline:** `AUDIT_REPORT.md` (original findings: 3 Critical, 4 High, 9 Medium, 12 Low)
**Method:** every finding below was **re-checked against the current code today**, not inferred
from what a phase report claimed. Where the two disagree, the code wins.

> ⚠️ This document records what is **actually true now**. Items that were fixed are marked fixed;
> items that were not are marked open regardless of how much work went near them.

---

## 1. Verification gates (run today)

| Gate | Result |
|---|---|
| `npm run typecheck` | ✅ Pass |
| `npm run lint` | ✅ Pass (0 warnings, 0 errors) |
| `npm run build` | ✅ Pass |
| `npx prisma validate` | ✅ Schema valid |
| `npm run test:money` | ✅ 18/18 |
| `npm audit --production` | ⚠️ **6 vulnerabilities (2 high, 4 moderate)** — see C1 |

---

## 2. Critical findings

### C1 — Dependency CVEs · ⚠️ **PARTIALLY RESOLVED**

`next` was upgraded `14.2.15 → 14.2.35`, which closed the middleware authorization bypass
(GHSA-f82v-jwr5-mffw) plus cache-poisoning and SSRF advisories. That was the highest-value part.

**But `npm audit --production` still reports 6 vulnerabilities today:**

| Package | Severity | Note |
|---|---|---|
| `next` | high | advisory range extends past 14.2.35 |
| `undici` | high | header injection, response-queue poisoning, SameSite downgrade |
| `postcss` | moderate | transitive, via `next` |
| `uuid` | moderate | buffer bounds check |

Every remaining fix is `npm audit fix --force`, i.e. a **breaking major upgrade** (`next` 16). That
is a deliberate, separately-scoped migration with a full regression pass — not a patch.

**Classification: future enhancement** (planned major-version migration).
**Residual risk: real.** Do not record this finding as closed.

### C2 — Rate limiting is in-memory · ❌ **OPEN**

`src/lib/rateLimit.ts` still uses a module-level `new Map()`. On Vercel each invocation may run in
a fresh isolate, so counters are neither shared nor persistent. Rate limits on login, registration,
password reset, deposit submission, order placement, coupon checks and uploads are **effectively
unenforced in production**.

**Classification: external dependency** (needs Upstash Redis / Vercel KV).
**See `PRODUCTION_CHECKLIST.md` §1 — BLOCKING.**

### C3 — Account takeover via Google OAuth + unverified email · ❌ **OPEN**

Unchanged.

**Classification: business decision required** (linking policy) **+ external dependency** (OAuth
credentials to verify against).
**See `PRODUCTION_CHECKLIST.md` §3 — BLOCKING.**

---

## 3. High findings

### H1 — Coupon usage-limit race · ⚠️ **PARTIALLY RESOLVED — read carefully**

This one is easy to mis-record, so it is stated precisely.

`src/app/api/order/route.ts` takes `SELECT … FOR UPDATE` row locks on **`Variant`** and **`User`**
inside the order transaction. `src/lib/coupon.ts` reads the coupon with a plain
`tx.coupon.findUnique`, checks `usageCount >= usageLimit`, and later increments it — with **no
`FOR UPDATE` on the `Coupon` row**, and no `isolationLevel` set (so Postgres default READ
COMMITTED).

Consequence:

| Limit | Status | Why |
|---|---|---|
| **`perUserLimit`** | ✅ **Protected** | Two concurrent orders from the same user contend on that user's locked `User` row, so they serialize and the second sees the first's `CouponUse`. |
| **Global `usageLimit`** | ❌ **Still racy** | Two concurrent orders from **different** users lock **different** `User` rows. Both can read the same `usageCount`, both pass the check, both increment — exceeding the limit. |

**Impact:** a capped promotional coupon can be redeemed more times than intended. Bounded by
concurrency, but real money.

**Fix (not applied):** add `SELECT … FOR UPDATE` on the `Coupon` row at the top of
`validateCoupon`, matching the pattern this codebase already uses everywhere else.

**Classification: future enhancement** (well-understood fix; deliberately not applied in this pass
because it touches money-path logic and warrants its own change with concurrency testing).

### H2 — `constraints.sql` not in the setup flow · ✅ **RESOLVED**

`prisma/apply-constraints.ts` exists and `npm run db:setup` runs it
(`prisma db push && tsx prisma/seed.ts && tsx prisma/apply-constraints.ts`).

### H3 — Backup exposes all password hashes · ❌ **OPEN**

`src/app/api/admin/backup/route.ts` calls `prisma.user.findMany()` with **no `select`**, so every
`User` field — including the bcrypt hash — is exported to a downloadable JSON file.

**Classification: business decision required.** Stripping hashes is one line; the consequence is
that a restored backup leaves every customer unable to log in. That trade-off is the owner's call.
**See `PRODUCTION_CHECKLIST.md` §2 — three options documented — BLOCKING.**

### H4 — Dead `src/(public)/` duplicate · ✅ **RESOLVED**

Directory removed (Phase 4, task 4.7) after verifying no import referenced it. All four legal
routes still return 200.

> One item from that removal remains outstanding and is **not** a code issue: the orphaned
> `terms/page.tsx` contained a prohibited-conduct clause (*"অন্য ইউজারকে হয়রানি করা"*) that the live
> terms page does not have. Live legal copy was deliberately not edited. Recoverable from git
> history. **Classification: business decision required.**

---

## 4. Medium findings

| ID | Finding | Status |
|---|---|---|
| **M1** | No ESLint configuration | ✅ **Resolved** — `.eslintrc.json` present; lint passes clean |
| **M2** | Inconsistent admin audit-log coverage | ✅ **Resolved** — all 12 admin routes now call `adminLog` (product 4, variant 5, payment 4, coupon 4, banner 4, social 4, settings 2, deposit 2, order 2, user 3, announce 2, restore 2). *Note: `CLAUDE.md` §8 still describes this as a gap — that line is now stale.* |
| **M3** | `admin/restore` accepts unvalidated backup JSON | ❌ **Open** — only checks `typeof data === 'object'` and the presence of `_meta`. No schema validation. **Classification: future enhancement.** |
| **M4** | Timezone — timestamps 6 hours off | ✅ **Resolved** — `src/lib/date.ts` now pins `Asia/Dhaka` |
| **M5** | No fail-fast env validation | ✅ **Resolved** — `src/lib/env.ts` present, called from `prisma.ts` |
| **M6** | Inconsistent input validation across routes | ⚠️ **Partially resolved** — `validation.ts` schemas cover the routes added in Phases 2–3 (`reviewSchema`, `uidVerifySchema`, `adminOrderBulkSchema`, …). A full route-by-route re-audit was **not** performed in this pass; do not record as closed. |
| **M7** | Pinch-zoom disabled (WCAG 1.4.4) | ✅ **Resolved** — `maximumScale` removed from `src/app/layout.tsx` |
| **M8** | `CustomCursor` replaces native cursor | ❌ **Open** — unchanged. **Classification: future enhancement** (UX preference). |
| **M9** | Design-token fragmentation | ✅ **Resolved** — CSS variables mapped into `tailwind.config.ts` as `var(--x)` references (never copied hex) |

---

## 5. Low findings

**L8** (binary role model) is **closed as won't-fix** — a tiered `STAFF` role was built under
roadmap 4.10 and then **fully removed** at the owner's direction. The platform is
single-administrative-role **by design**. Retained as a record of an accepted risk, not an open
finding.

**L6** deserves a specific note: referral double-payout prevention still relies on an **implicit**
row lock (a prior `UPDATE` on the same user row happens to serialize the transaction) rather than
an explicit `SELECT … FOR UPDATE` — confirmed today, `src/lib/referral.ts` contains no `FOR UPDATE`.
It is currently correct, but correct *by accident*, and an innocent reordering of that function
would silently break it. **Classification: future enhancement** (make the basis explicit).

The remaining Low items (L1–L5, L7, L9–L12) were **not re-verified individually in this pass** and
should be assumed **open** as recorded in `AUDIT_REPORT.md`. They are cosmetic, defensive, or
performance items with no known exploit path.

---

## 6. Net position

| Severity | Original | Resolved | Partial | Open |
|---|---|---|---|---|
| Critical | 3 | 0 | 1 (C1) | 2 (C2, C3) |
| High | 4 | 2 (H2, H4) | 1 (H1) | 1 (H3) |
| Medium | 9 | 6 | 1 (M6) | 2 (M3, M8) |
| Low | 12 | 0 | — | 11 open + 1 closed won't-fix (L8) |

### The three that matter most before taking real money

1. **C2** — rate limiting is genuinely unenforced in production. *External dependency.*
2. **H3** — one mishandled backup file hands over every customer credential hash. *Business
   decision.*
3. **C3** — OAuth account-linking takeover path. *Business decision + external dependency.*

All three are documented with concrete options in `PRODUCTION_CHECKLIST.md` and are marked
**BLOCKING** there.

**H1's global-coupon race** is the most significant purely-technical item remaining: a known,
well-understood money-path defect with a known fix that has not been applied.
