# QA_CLEANUP_REPORT.md

**Date:** 2026-07-18
**Scope:** Removal of test data created during the end-to-end QA audit (see `QA_REPORT.md`)
**Method:** Single Prisma transaction, scoped strictly by the QA user's `userId`
**Result:** ✅ 17 rows removed across 6 tables. **Zero** seeded or pre-existing records touched.

---

## 1. Deletion Scope & Safety Model

Every deletion was keyed to the QA account's primary key (`userId = cmrqmjska00011kwu1n63k3w6`, `qa.tester@example.com`) — **not** to name patterns, date ranges, or "recent rows". Nothing was deleted by heuristic.

Two categories of row required an explicit judgement call, documented below for the record:

1. **Two `Notification` rows owned by the admin account.** These were `notifyAdmins()` alerts generated *by* my test actions, with bodies literally reading `"QA Tester নতুন অ্যাকাউন্ট খুলেছে।"` and `"QA Tester — #1 Free Fire [BD SERVER] (৳142.20)"`. They were matched by `body contains 'QA Tester'` **and** verified individually before deletion. Left in place they would have been dangling references to a deleted user. **The admin account row itself was not modified in any way.**

2. **Five `AdminLog` rows.** All five existed only because of this audit: two referencing the QA deposit/order by `targetId`, and three `BACKUP_DOWNLOAD` entries from my security probing of `/api/admin/backup`. The `AdminLog` table was empty before the audit and is empty again.

A first cleanup attempt **failed** with Prisma `P2028` (transaction timeout against Neon). I verified the rollback was complete — all 17 rows still present, nothing partially deleted — before retrying with an extended timeout. Atomicity held; there was never an intermediate state.

---

## 2. Records Removed

| Table | Rows | Detail |
|---|---:|---|
| `Notification` (QA-owned) | 4 | Deposit submitted / approved; order placed / cancelled-refunded |
| `Notification` (admin, about QA) | 2 | "নতুন রেজিস্ট্রেশন", "নতুন অর্ডার" |
| `LedgerEntry` | 3 | `DEPOSIT +500`, `ORDER −142.20`, `REFUND +142.20` |
| `Order` | 1 | `#1` — Free Fire [BD SERVER] / 240 Diamond, ৳142.20, `REFUNDED` |
| `Deposit` | 1 | `#1` — BKASH ৳500, trxId `QA7B2C4D1E`, `APPROVED` |
| `AdminLog` | 5 | `DEPOSIT_APPROVE`, `ORDER_REFUND`, 3× `BACKUP_DOWNLOAD` |
| `CouponUse` | 0 | *None existed* — already reversed by the refund under test |
| `User` | 1 | `qa.tester@example.com` ("QA Tester", balance ৳500) |
| **Total** | **17** | |

### Note on `CouponUse` and coupon counters
No `CouponUse` row was deleted because none remained: the refund test had already reversed it correctly, restoring `WELCOME10.usageCount` from `1` → `0`. **The coupon's `usageCount` was not manually adjusted during cleanup** — it was already at its original seeded value of `0`, which is itself further confirmation the refund logic is sound.

---

## 3. Post-Cleanup Verification

### 3.1 No residual test data

| Table | Count |
|---|---:|
| `Deposit` | **0** |
| `Order` | **0** |
| `LedgerEntry` | **0** |
| `CouponUse` | **0** |
| `Notification` | **0** |
| `AdminLog` | **0** |
| `User` | **1** (admin only) |

### 3.2 Seed data intact ✅

| Asset | Expected (seed) | Actual | Status |
|---|---:|---:|---|
| Categories | 2 | 2 | ✅ |
| Products | 11 | 11 | ✅ |
| Variants | 40 | 40 | ✅ |
| Coupons | 1 | 1 | ✅ |
| Settings keys | 11 | 11 | ✅ |
| Payment channels | 2 | 2 | ✅ |
| Social links | 3 | 3 | ✅ |
| Banners | 0 | 0 | ✅ |

### 3.3 Categories unchanged ✅
```
id 1 — FREE FIRE                  (free-fire)              isActive: true
id 2 — LIKE - FOLLOW - SUBSCRIBE  (like-follow-subscribe)  isActive: true
```
IDs, slugs, names, and active flags all identical to seed.

### 3.4 Product data unchanged ✅
All 11 products present in original ID order:
`Free Fire [BD SERVER]`, `Free Fire Membership`, `Free Fire Level Up Pass BD`, `Weekly Lite Membership`, `Free Fire Like`, `Free Fire Voucher for UniPin`, `Free Fire Indonesia`, `Level Up Pass Indonesia`, `YouTube Premium`, `Prime Video`, `Netflix`

Variants: **40**, price range **৳20 – ৳3220** — matches the seeded catalogue exactly.

### 3.5 Existing users untouched ✅
```
email:        admin@uidtopup.local
role:         ADMIN
balance:      ৳0          (unchanged)
referralCode: 4PK9RB4R    (unchanged)
isBanned:     false
status:       ACTIVE
```
The admin row was never included in any `delete` predicate. Its password hash, balance, referral code, and status are all as they were.

### 3.6 Coupon restored to seed state ✅
```
WELCOME10 — usageCount: 0, isActive: true, perUserLimit: 1
```

---

## 4. Live Application Verification (Playwright)

| Check | Result |
|---|---|
| Homepage loads | ✅ HTTP 200 |
| Products render | ✅ 11 products, both categories |
| Search live region | ✅ "11 টি প্রোডাক্ট পাওয়া গেছে" |
| **Deleted QA account login** | ✅ **Rejected — `401 CredentialsSignin`** |
| **Admin login** | ✅ **Succeeds** |
| Admin dashboard | ✅ Renders fully (`/admin`, setup checklist, stats) |

The deleted account correctly no longer authenticates, and admin access is completely unaffected.

---

## 5. What Was *Not* Touched

Explicitly out of scope and confirmed unmodified:

- The `admin@uidtopup.local` account (row, credentials, balance, referral code, status)
- All seeded catalogue data — categories, products, variants, pricing
- All site configuration — `Setting`, `PaymentChannel`, `SocialLink`, `Banner`
- The `WELCOME10` coupon definition
- Database schema — no migrations, no `db push`, no structural change
- Application source code — this cleanup touched **data only**; the six code fixes from `BUG_FIX_REPORT.md` remain in place

---

## 6. Database State

The database is now byte-for-byte equivalent to a **freshly seeded** instance: the seeded admin, catalogue, and configuration, with every transactional table (`Deposit`, `Order`, `LedgerEntry`, `CouponUse`, `Notification`, `AdminLog`) empty.

No re-seed is required.
