# QA_REPORT.md — End-to-End Audit

**Date:** 2026-07-18
**Build under test:** `main` @ `f9847d0`, Next.js 14.2.15, local dev server (`localhost:3000`)
**Database:** Neon serverless Postgres (remote), seeded — 2 categories, 11 products, 40 variants
**Driver:** Playwright MCP (Chromium), real browser interaction throughout
**Method:** live UI interaction + direct API probing from the page origin (authenticated `fetch`), plus read-only Prisma queries to verify persisted state after each money-moving action.

---

## 1. Executive Summary

The application is **substantially more robust than a typical build at this stage**, particularly in the areas that matter most for this business model: the money flows. Every transactional invariant claimed in `CLAUDE.md` §8 was independently verified end-to-end and **held under concurrent attack**.

- **Core money logic: PASS (no defects found).** Deposit approval, order placement, coupon application, and fail-and-refund all produced exactly correct balances, ledger entries, coupon counters, and audit rows. Row-locking correctly rejected concurrent double-approval and double-refund.
- **Authorization: PASS.** All three defence layers (middleware → layout → `requireAdmin()`) verified independently. Admin APIs return 403 to a normal user even when middleware is bypassed conceptually.
- **Input trust: PASS.** Client-supplied prices are ignored; the server re-derives from the DB.
- **Issues found: 11.** 1 Critical, 2 High, 4 Medium, 4 Low. **6 fixed and verified**; 5 documented as requiring owner decision (they involve dependency upgrades, disaster-recovery semantics, or visual redesign — none safe to change unilaterally).

The single most important finding is **not a logic bug** but a supply-chain one: `next@14.2.15` carries a **critical** advisory set including *Authorization Bypass in Next.js Middleware*, which is directly load-bearing for `/admin`. The app's defence-in-depth substantially mitigates it — but it should be scheduled.

---

## 2. Coverage Matrix

| Area | Status | Notes |
|---|---|---|
| Homepage | ✅ Pass | 11 products / 2 categories render; 0 console errors |
| Navigation | ✅ Pass | Desktop + mobile hamburger; auth-aware nav switches correctly |
| Registration | ✅ Pass | Validation, auto-login, referral code generated |
| Login | ✅ Pass | `callbackUrl` honoured; generic error (no user enumeration) |
| Logout | ✅ Pass | Session cleared; protected routes re-gate |
| Wallet / deposit submit | ✅ Pass | Claim created PENDING; no balance moved (correct) |
| Deposit approval (admin) | ✅ Pass | Balance + `LedgerEntry` + `AdminLog` all written atomically |
| Order flow | ✅ Pass | Snapshot pricing correct; balance debited exactly |
| Coupon | ✅ Pass | Math, `minOrder`, `perUserLimit`, invalid-code all correct |
| Refund (order FAIL) | ✅ Pass | Balance + coupon count + `CouponUse` all restored atomically |
| Product pages | ✅ Pass | 21 variants render; `notFound()` reached for bad IDs |
| Search | ✅ Pass | Filters correctly, empty state + `aria-live` announcement |
| Categories | ✅ Pass | Empty categories correctly hidden |
| User dashboard | ✅ Pass | Balance, referral, empty states all correct |
| Admin panel | ✅ Pass | All 11 pages HTTP 200, no error boundary |
| Mobile (375px) | ✅ Pass | Zero horizontal overflow |
| Tablet (768px) | ✅ Pass | Zero horizontal overflow |
| Desktop (1440px) | ✅ Pass | Zero horizontal overflow |
| Animations | ✅ Pass | Fixed earlier this session (see BUG-01) |
| Forms / validation | ⚠️ Fixed | Untranslated Zod messages — **fixed** |
| Loading states | ✅ Pass | `loading.tsx` shell renders |
| Empty states | ✅ Pass | Deposits, orders, ledger, search all handled |
| Error states | ⚠️ Partial | 404 UI correct; soft-404 status + unguarded DB error (see BUG-05, BUG-07) |
| Accessibility | ⚠️ Fixed | Pinch-zoom block — **fixed**; labels/lang/alt all pass |
| Console errors | ✅ Pass | 0 on final run |
| Network errors | ✅ Pass | All requests 200 |
| Security | ⚠️ See §4 | Logic passes; dependency CVEs outstanding |
| Broken links | ✅ Pass | All internal links resolve |
| UI consistency | ⚠️ Partial | Stale neon theme in 3 files (see BUG-08) |
| Edge cases | ✅ Pass | Concurrency, tampering, duplicates all rejected |

---

## 3. Money-Flow Verification (evidence)

Each step verified against the DB, not just the UI.

**Deposit ৳500 → approve**
```
balance:  0 → 500
Deposit:  PENDING → APPROVED
Ledger:   DEPOSIT +500, balanceAfter 500
AdminLog: DEPOSIT_APPROVE, amount 500, ip ::1
```

**Order (240 Diamond ৳158, coupon WELCOME10 −10%)**
```
subtotal 158.00 | discount 15.80 | price 142.20   ← snapshot correct
balance:  500 → 357.80
Ledger:   ORDER −142.20, balanceAfter 357.80
Coupon:   usageCount 0 → 1, CouponUse row created
```

**Order FAIL → refund**
```
balance:  357.80 → 500        ← exact restoration
Order:    PENDING → REFUNDED
Ledger:   REFUND +142.20, balanceAfter 500
Coupon:   usageCount 1 → 0, CouponUse row deleted
```
All three restored together — no partial refund. Matches `CLAUDE.md` §12 requirement.

**Concurrency (3 simultaneous requests each):**
| Attack | Result |
|---|---|
| Double-approve an approved deposit | 3× `409` — no double credit |
| Double-refund a refunded order | 3× `409` — no double refund |

---

## 4. Security Findings

### Verified secure
| Test | Result |
|---|---|
| `/admin` as USER | Redirected to `/` (middleware) |
| `/api/admin/*` as USER (4 endpoints) | `403` on all — **independent of middleware** |
| Client-supplied `price` / `subtotal` / `discount` in order body | **Ignored**; server re-derives from `Variant` |
| Negative deposit amount | Rejected |
| Deposit above admin-configured max | Rejected with correct Bengali message |
| Duplicate `trxId` | `409` |
| Coupon reuse beyond `perUserLimit` | Rejected |
| Wrong password | Generic message — no user enumeration |

The price-tampering test is worth calling out: submitting `price: 0.01` on a ৳20 item still produced the correct ৳20 balance requirement. `CLAUDE.md` §9's "never trust client prices" rule is genuinely implemented.

### Outstanding (require owner decision)
See BUG-02 (dependency CVEs) and BUG-03 (backup exposes password hashes) in `BUG_FIX_REPORT.md`.

---

## 5. Performance Observations

- Homepage first load: ~10.5s cold compile (dev only), ~1.3–2.3s warm. Not representative of production.
- Production build: **succeeds**, 61 static pages generated, shared JS **87.2 kB** — healthy.
- `/api/me` and `/api/notifications` are each fetched **twice** on navigation. Not an error, but redundant; worth a look if request volume matters.
- **Neon cold-start is a real risk.** Mid-session the pool timed out (`connection limit: 9`) and the DB briefly became unreachable, crashing an account page. See BUG-07 — the failure was environmental, but the *unguarded* handling is a code issue.

---

## 6. Accessibility

| Check | Result |
|---|---|
| `<html lang>` | ✅ `bn` |
| Single `<h1>` per page | ✅ |
| Images missing `alt` | ✅ none |
| Form controls labelled | ✅ all via `<label for>` |
| `aria-live` on search results | ✅ present |
| Skip link | ✅ present |
| Focus-visible styling | ✅ global `:focus-visible` |
| Pinch-zoom | ✅ **fixed** (was `maximum-scale=5`) |
| Touch targets | ⚠️ menu button 38px (<40px target) — minor |

---

## 7. Honest Coverage Gaps

These were **not** exercised, and should not be considered validated:

- **Password reset** and **transactional email** — `RESEND_API_KEY` not configured.
- **Google OAuth login** — credentials not configured. Note the account-takeover path flagged in `AUDIT_REPORT.md` remains **unverified**, not cleared.
- **Image upload** — `BLOB_READ_WRITE_TOKEN` not configured; upload path untested.
- **Admin CRUD writes** — products, variants, coupons, banners, settings, social links: pages load and render, but create/edit/delete were **not** executed.
- **Backup restore round-trip**, **announcements**, **ban/suspend**, **notification mark-as-read**.
- **Referral bonus payout** — logic present, but no second referred user was registered to trigger it.
- **Rate limiting** — not load-tested. Per `AUDIT_REPORT.md` C2 it is in-memory and unreliable on serverless regardless.
- **`prefers-reduced-motion`** — CSS rule present and reviewed, not tested with the media query forced.

---

## 8. Test Data Left In Place

I did **not** delete these — they are audit-trail rows and deleting them is your call:

| Record | Value |
|---|---|
| User | `qa.tester@example.com` / `QaTest1234`, balance **৳500** |
| Deposit #1 | ৳500 APPROVED |
| Order #1 | ৳142.20 REFUNDED |
| Ledger | 3 entries (DEPOSIT, ORDER, REFUND) |
| AdminLog | 2 entries |

Say the word and I'll remove them.

---

## 9. Recommended Next Actions

1. **Schedule the Next.js upgrade** (BUG-02) — critical CVEs, breaking change, needs a planned window.
2. **Decide on backup password-hash policy** (BUG-03).
3. Apply `prisma/constraints.sql` — per `AUDIT_REPORT.md` H2 it is still not part of `db:setup`; app-layer checks are currently the only guarantee.
4. Consider a Prisma connection-pool limit tuned for serverless, plus retry-on-cold-start (BUG-07).
5. Decide whether the purple/neon product banner is intentional (BUG-08).
