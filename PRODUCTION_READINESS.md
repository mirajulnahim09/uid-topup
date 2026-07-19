# PRODUCTION READINESS

**Date:** 2026-07-20
**Assessment:** ⚠️ **NOT READY to accept real customer money.**
**Reason:** three BLOCKING items remain, none of which are engineering work that could be completed
locally.

**Relationship to other documents**
- `PRODUCTION_CHECKLIST.md` — the **deploy-time actions**, with options and step-by-step remedies.
  That document is the authority on *how*. This one is the go / no-go assessment of *whether*.
- `FINAL_AUDIT.md` — verified status of every audit finding.
- `PHASE5_SUMMARY.md` — what Phase 5 delivered and what remains.

> This assessment does not restate the checklist. Where they overlap, the checklist is canonical.

---

## 1. Verdict

| Question | Answer |
|---|---|
| Does the application build and pass its own gates? | ✅ Yes |
| Are the money invariants tested and holding? | ✅ Yes — 18/18 |
| Is the customer-facing flow complete end to end? | ✅ Yes |
| Is the admin fulfilment flow complete end to end? | ✅ Yes |
| **Is it safe to accept real customer money today?** | ❌ **No — 3 blocking items** |

**The application is functionally complete. It is not operationally safe.** Those are different
things, and the gap is deliberate: every remaining blocker requires either a credential, a
credential-backed service, or a decision only the owner can make.

---

## 2. Blocking items — must be resolved before launch

Each is documented with concrete options in `PRODUCTION_CHECKLIST.md`.

### B1 — Rate limiting is unenforced in production · *External dependency*

`src/lib/rateLimit.ts` uses an in-memory `Map`. On Vercel, counters are neither shared across
isolates nor persistent, so limits on login, registration, password reset, deposit submission,
order placement, coupon checks and uploads **do not actually apply in production**.

- **Exposure:** credential stuffing, deposit-claim spam, coupon brute-forcing.
- **Needs:** Upstash Redis or Vercel KV credentials.
- **Detail:** `PRODUCTION_CHECKLIST.md` §1.

### B2 — Full-DB backup exports every password hash · *Business decision required*

`GET /api/admin/backup` runs `prisma.user.findMany()` with no `select`, so the downloadable JSON
contains every bcrypt hash. One mishandled file, or one compromised admin account, yields the
complete credential set for offline cracking.

- **Why it is not simply fixed:** stripping the hashes is one line, but a restored backup would
  then leave every customer unable to log in. That trade-off is a disaster-recovery policy
  decision, not a bug fix.
- **Three options** (strip + forced reset / encrypt at rest / keep with documented handling) are
  laid out in `PRODUCTION_CHECKLIST.md` §2.

### B3 — Google OAuth account-linking takeover path · *Business decision + external dependency*

- **Detail:** `PRODUCTION_CHECKLIST.md` §3.

---

## 3. Known non-blocking risks accepted at launch

These do not stop launch, but must be **consciously accepted** rather than forgotten.

| Risk | Nature | Note |
|---|---|---|
| **Global coupon usage-limit race** (`FINAL_AUDIT.md` H1) | Technical | A capped coupon can be redeemed more times than intended under concurrency. Per-user limits are safe; the global cap is not. Mitigate operationally by avoiding tightly-capped public coupons until fixed. |
| **Residual dependency CVEs** | Technical | 6 remaining (2 high, 4 moderate). All fixes require a breaking major upgrade. |
| **`admin/restore` accepts unvalidated JSON** | Technical | Admin-only, single trusted operator. Exposure is limited to operator error. |
| **Referral payout relies on an implicit lock** | Technical | Currently correct, but correct by accident. |
| **Single administrative role** | Accepted by decision | Every admin action sits with one account, including backup/restore and balance adjustment. This is the owner's deliberate design (4.10), **not** an oversight. Its consequence is that admin-account compromise is total. |

---

## 4. Operational prerequisites

Configuration and process, not code.

| Item | Status | Note |
|---|---|---|
| **Payment account numbers changed from seed placeholder** | ⚠️ **Must verify before launch** | The seeded number is a placeholder. If unchanged, customers send real money to an account that is not yours. Set in Admin → Settings → Payment Numbers. |
| DB-level constraints applied (`npm run db:setup`) | ⚠️ Verify per environment | `apply-constraints.ts` is wired into `db:setup`, but confirm it ran against production. |
| Email delivery (Resend) configured | ⚠️ Verify | Site degrades gracefully without it, but password reset depends on it — which B2 option A also depends on. |
| Blob storage (Vercel Blob) configured | ⚠️ Verify | Deposit screenshots are the evidence trail for payment disputes. |
| Admin password changed from seed | ⚠️ **Must verify** | — |
| Backup storage location decided | ⚠️ Pending B2 | Never in the repo, a public bucket, or a shared drive. |

---

## 5. What is genuinely ready

Verified, not asserted:

- **Money invariants** — row-locked transactions, ledger entries with `balanceAfter`, snapshot
  pricing, atomic refunds (balance + stock + coupon together). `npm run test:money` 18/18.
- **Manual deposit → wallet → order → fulfilment flow**, including partial refunds, order claim
  (prevents two admins delivering the same order in-game), and structured failure reasons.
- **Customer trust surface** — SLA countdown, order timeline, tokenised order tracking, delivery
  confirmation and dispute path, receipts, and computed-not-invented trust metrics.
- **Admin operations** — deposit queue, universal search, risk signals, bulk actions (deliberately
  excluding deposit approval and order FAIL), ops metrics, customer 360 timeline.
- **Security baseline** — CSP/HSTS headers, triple-gated admin surfaces, bcrypt cost 12,
  constant-time login comparison, magic-byte upload validation, full admin audit logging.
- **Accessibility** — pinch-zoom restored, `prefers-reduced-motion` respected including JS-driven
  effects, form controls labelled, focus states preserved.

---

## 6. Recommended sequence to launch

1. **Resolve B2** — pick a backup policy. Blocks nothing else; decide it first because option A
   depends on working email.
2. **Resolve B1** — provision Redis/KV and swap the rate-limit store, keeping the in-memory path as
   a local-dev fallback.
3. **Resolve B3** — OAuth linking policy.
4. **Verify §4 operational prerequisites** — *especially the payment account number.*
5. **Run `PRODUCTION_CHECKLIST.md` §6 pre-launch verification.**
6. Optionally fix H1's coupon race before running any capped public promotion.

---

## 7. Statement of accuracy

Everything in this document was verified against the code on 2026-07-20. No item is recorded as
complete on the strength of a phase report alone; where a report and the code disagreed, the code
was taken as truth and the discrepancy noted (see `FINAL_AUDIT.md` M2).

**Blocked items are recorded as blocked.** None were marked complete, worked around with placeholder
logic, or resolved by inventing a value.
