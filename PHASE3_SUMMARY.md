# PHASE 3 — ADMIN EXPERIENCE · Closure Summary

**Status:** ✅ **Closed.** All 15 roadmap tasks implemented and verified.
**Date closed:** 2026-07-19
**Scope:** `IMPLEMENTATION_ROADMAP.md` Phase 3 (tasks 3.1 – 3.15)
**Detail:** per-task records live in `IMPLEMENTATION_REPORT.md`; this document is the synthesis.

> Phase 4 has **not** been started.

---

## 1. Task Completion

| ID | Task | Impact | Status |
|---|---|---|---|
| 3.1 | Verification queue redesign (card, mobile-first) | ★★★★★ | ✅ Complete & verified |
| 3.2 | Unified admin search | ★★★★★ | ✅ Complete & verified |
| 3.3 | Complete audit-log coverage | ★★★★☆ | ✅ Complete & verified |
| 3.4 | Copy-to-clipboard on TrxID / UID | ★★★★☆ | ✅ Complete & verified |
| 3.5 | Risk signals on deposit cards | ★★★★☆ | ✅ Complete & verified |
| 3.6 | Trust-graded review tiers | ★★★☆☆ | ✅ Complete & verified |
| 3.7 | Order claim / lock (multi-admin) | ★★★☆☆ | ✅ Complete & verified |
| 3.8 | Bounded bulk actions | ★★★☆☆ | ✅ Complete & verified |
| 3.9 | SLA breach alerting | ★★★★☆ | ✅ Complete & verified |
| 3.10 | Admin dashboard operational metrics | ★★★☆☆ | ✅ Complete & verified |
| 3.11 | Keyboard shortcuts (J/K/A/R) | ★★★☆☆ | ✅ Complete & verified |
| 3.12 | Group fulfilment queue by product | ★★★☆☆ | ✅ Complete & verified |
| 3.13 | Customer 360 timeline view | ★★★☆☆ | ✅ Complete & verified |
| 3.14 | Partial refunds | ★★☆☆☆ | ✅ Complete & verified |
| 3.15 | Canned support responses | ★★☆☆☆ | ✅ Complete & verified |

**15 / 15 complete. Nothing skipped.** Three items were *deliberately not built* — see §5; none of them are unfinished work.

---

## 2. What Changed

### New modules
| File | Purpose |
|---|---|
| `src/lib/riskSignals.ts` | Deposit fraud signals, derived from existing data |
| `src/lib/orderClaim.ts` | Advisory multi-admin claim state (pure, clock-injectable) |
| `src/lib/fulfilment.ts` | `applyOrderStatus()` — shared by single **and** bulk paths |
| `src/lib/slaBreach.ts` | SLA breach levels, derived from `slaDueAt` |
| `src/lib/opsMetrics.ts` | Operational medians with a minimum-sample guard |
| `src/lib/customerTimeline.ts` | Merged chronological customer event stream |
| `src/lib/cannedResponses.ts` | Support reply templates (no enum, unlike `rejectReasons.ts`) |

### New endpoints
| Route | Notes |
|---|---|
| `POST /api/admin/search` | 7-dimension unified search |
| `POST /api/admin/order/claim` | Claim / release / takeover — row-locked, audited |
| `POST /api/admin/order/bulk` | **Non-money actions only**, capped at 20, per-item transaction |
| `POST /api/admin/order/refund` | Partial refund — row-locked, capped, ledger-writing |

### Schema changes (2 pushes, both additive)
| Field | Model | Notes |
|---|---|---|
| `claimedById` / `claimedByName` / `claimedAt` | `Order` | Nullable; denormalised name follows the `AdminLog` pattern |
| `refundedAmount` | `Order` | `Decimal(12,2)` default 0 — carries the partial-refund invariant |

Both pushes completed with **no data-loss prompt**. Row counts identical before and after.

### Audit coverage
`AdminAction` gained 16 values across the phase. Every admin route that mutates state now logs —
including the four new ones (`ORDER_CLAIM`, `ORDER_RELEASE`, `ORDER_TAKEOVER`,
`ORDER_PARTIAL_REFUND`).

---

## 3. Design Decisions Worth Carrying Forward

### Derived over cached — every time
Risk level (3.5), claim staleness (3.7), SLA breach (3.9), and ops metrics (3.10) are all computed
on read. No `CustomerRisk` table, no `isStale` flag, no `slaBreached` column.

The reasoning is strongest for SLA: **breach happens by the passage of time alone.** A cached flag
needs a writer, there is no scheduler on Vercel serverless, and a stale flag reading `false` about an
order that breached an hour ago is worse than no flag at all.

### Asymmetric friction on money
The roadmap framed 3.6 as *"one-tap approve for trusted customers."* Implemented literally, that
removes the confirmation step `CLAUDE.md` §3 requires on every money-affecting action. The goal was
inverted:

> **Add scrutiny where risk is high, rather than remove safety where it is low.**

Elevated-risk deposits now require acknowledging each warning before approve unlocks. Trusted
customers are *labelled*, not *fast-tracked*. Every tier still confirms — including via keyboard
(3.11) and in bulk (3.8).

Reject is never gated in any tier: blocking rejection of a suspicious claim would leave an admin
unable to dismiss the very items most likely to be fraud.

### The line for bulk operations is "moves no money"
Permitted: claim, mark-processing, complete. Excluded: deposit approval and order FAIL/refund.

A consequence worth noting: **the refund path was not touched by 3.8 at all.**

### Shared code paths, never parallel implementations
3.8 required the bulk route to do what the single route does. Rather than write bulk SQL — which
creates two implementations of one transition and the standing trap of fixing a bug in one — the
money route was refactored so both call `applyOrderStatus()`. That refactor was then proven by
**executing both paths against separate orders** and confirming byte-identical resulting state.

### One invariant doing two jobs
Partial refunds (3.14) are guarded by a single rule checked inside the lock:

```
refundedAmount + new amount  ≤  price
```

Because the **full**-refund path also sets `refundedAmount = price`, that same arithmetic blocks
re-refunding an already-refunded order. No separate "already refunded" flag exists to drift out of
sync with reality.

---

## 4. Verification Standard

Money paths were verified by **execution and reconciliation**, not by inspection or typecheck.

### Concurrency — partial refund (3.14)
Two **simultaneous** ৳60 refunds against a ৳100 order:

| | Result |
|---|---|
| Request A | 200 — `totalRefunded: 60` |
| Request B | 400 — *"সর্বোচ্চ ৳40.00 ফেরত দেওয়া যাবে"* |

B read A's **committed** value and quoted the correct remainder. The `FOR UPDATE` lock serialised
them — this is the double-refund scenario the design exists to prevent.

### Accounting reconciliation
Across three refund attempts totalling **৳160 requested**:

| Check | Result |
|---|---|
| Balance moved | **exactly ৳100** |
| Ledger sum | ৳100 — matches balance movement |
| Ledger rows written | **2** — rejected attempts wrote nothing |
| `balanceAfter` of final entry | matches the user's actual balance |

### Guard tests that must leave no trace
A bulk complete blocked by another admin's claim left `orderEvent` **12 → 12** and ledger **7 → 7**.
A client-supplied `takeover: true` on the bulk route was **inert** — bulk has no takeover path by
design.

### Unit tests for logic untestable through a browser
| Module | Cases |
|---|---|
| `orderClaim.claimState()` | 8/8 — including the exact 15-minute TTL boundary and "own claim never expires against me" |
| `slaBreach.breachInfo()` | 11/11 — including closed orders and pre-2.1 orders with null `slaDueAt` |
| `opsMetrics.humanMinutes()` | 6/6 |

---

## 5. Deliberately Not Built

These are **decisions, not gaps.**

### 5.1 Bulk deposit approval — requires a business decision
`MANUAL_WORKFLOW.md` calls blind bulk-approve dangerous; `CLAUDE.md` §11 places the entire security
model on a human cross-checking each real bank transaction before balance moves.

The objection is not that the button *permits* skipping the check — it is that the button *becomes*
how approvals happen, and the check quietly stops. That is a **fraud-posture decision for the
business owner**, not a UI task, so it was surfaced rather than silently taken.

`IDEAL_PLATFORM_ARCHITECTURE.md` §5.3 sketched a middle path (explicit per-item selection plus a
total-value confirmation) if this is ever wanted.

### 5.2 Push / email / SMS SLA alerting — infrastructure dependency
3.9 ships **visible** alerting: the admin panel surfaces breaches whenever it is looked at. Genuine
push alerting needs a scheduled job this deployment does not have. Building a version that only fires
while an admin happens to have the page open would be worse than not building it, because it would
*look* like coverage. Belongs with the other infrastructure items in `PRODUCTION_CHECKLIST.md`.

### 5.3 Trusted-tier badge — unexercised by current data
`TRUSTED_APPROVED_MIN` is 10 prior approvals; the highest any test account reaches is 2, so the
trusted badge never rendered live.

What this does and does not leave uncertain:
- **Gating is covered.** `needsAcks` is `level === 'elevated'`, so `trusted` takes the identical
  no-gate path as `normal` — verified live on three cards.
- **Only the badge's label/colour variant is unverified.** It is a static lookup, exercised for the
  other two levels.

Manufacturing 10 approved deposits would have meant writing balance and ledger rows purely to colour
a chip, against the instruction to leave Phase 2 data intact. Recorded as a gap rather than reported
as passing.

---

## 6. Outstanding Items (outside Phase 3 scope)

### Deferred to deployment — `PRODUCTION_CHECKLIST.md`
| # | Item | Severity |
|---|---|---|
| 1 | Distributed rate limiting (in-memory store unreliable on serverless) | **BLOCKING** |
| 2 | Backup password-hash policy | **BLOCKING — decision required** |
| 3 | Google OAuth account-linking verification | **BLOCKING** |
| 4 | Player-UID lookup provider (registry built, no provider wired) | Recommended |

No **BLOCKING** item may be left unresolved when the site starts accepting real customer money.

### Pre-existing, carried forward
| Item | Source |
|---|---|
| `prisma/constraints.sql` still not part of `db:setup` — app-layer checks are the only guarantee today | `AUDIT_REPORT.md` H2 |
| Prisma connection-pool limit tuned for serverless | `QA_REPORT.md` BUG-07 |
| Purple/neon product banner — intentional or stale theme? | `QA_REPORT.md` BUG-08 |

### Housekeeping
- **Phase 2 QA data retained** as instructed (6 pending deposits, 5 orders, 1 QA customer). Available
  for Phase 4 verification; a cleanup pass can remove it when no longer needed.
- Two `ORDER_CLAIM` audit rows against order #66 remain from 3.8 verification. They are accurate
  records of actions genuinely taken and were **left rather than scrubbed** — editing an audit trail
  to look tidy is the wrong instinct.

---

## 7. Final State

### Gates
| Gate | Result |
|---|---|
| `npm run typecheck` | ✅ Pass |
| `npm run lint` | ✅ Pass — no warnings |
| `npm run build` | ✅ Pass — production build succeeds |

### Database — identical to Phase 3 start
| Metric | Start | End |
|---|---:|---:|
| Orders | 5 | **5** ✅ |
| Order events | 12 | **12** ✅ |
| Ledger entries | 7 | **7** ✅ |
| Total user balance | ৳1,222 | **৳1,222** ✅ |

### Money invariants
| Invariant | Result |
|---|---|
| `refundedAmount ≤ price` for every order | ✅ |
| No negative balances | ✅ |
| `refundedAmount` reconciles against `LedgerEntry` REFUND sums | ✅ **every order** |
| Test artifacts remaining (`BULKTEST` / `GRPTEST` / `REFUNDTEST`) | **0** ✅ |

Where verification required data that did not exist — a second admin, multiple open orders, a
refundable completed order — **disposable records were created and removed**, with row counts
captured before and after. For the refund test, the ৳100 credited during testing was reversed.

### One integrity issue found and fixed during the phase
Adding `refundedAmount` with `default 0` left the existing REFUNDED order claiming **zero** refunded,
while the ledger showed ৳158 genuinely returned — the new column contradicted the audit trail from
the moment it was created.

Backfilled from `LedgerEntry` REFUND rows rather than assuming *"status REFUNDED ⇒ full price"*. That
assumption would have wrongly credited the `FAILED` order, which never had a refund entry at all.

---

**Phase 3 is closed. Phase 4 has not been started.**
