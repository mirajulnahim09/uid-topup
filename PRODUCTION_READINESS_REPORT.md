# PRODUCTION READINESS REPORT

**Run date:** 2026-07-20
**Branch:** `main` @ `9093cca` (Phase 5 merged, fast-forward, linear history)
**Purpose:** point-in-time record of the final verification run.

> **Relationship to `PRODUCTION_READINESS.md`:** that document is the standing go / no-go
> assessment. This one records the *evidence* from a single verification run on a specific commit.
> The assessment is unchanged by this run.

---

## 1. Verification results — all technical checks PASS

| # | Check | Result | Detail |
|---|---|---|---|
| 1 | `npm run typecheck` | ✅ **Pass** | `tsc --noEmit`, no errors |
| 2 | `npm run lint` | ✅ **Pass** | 0 warnings, 0 errors |
| 3 | `npm run build` | ✅ **Pass** | Compiled successfully; 71 routes emitted |
| 4 | `npx prisma validate` | ✅ **Pass** | Schema valid |
| 5 | `npm run test:money` | ✅ **Pass** | 18/18 money invariants |
| 6 | Playwright smoke | ✅ **Pass** | See §2 |

### HTTP route smoke (12 routes)

| Route | Expected | Actual |
|---|---|---|
| `/`, `/login`, `/register`, `/faq`, `/contact`, `/privacy`, `/terms`, `/refund`, `/track`, `/product/1/free-fire-bd-server` | 200 | ✅ 200 |
| `/admin` | redirect to login | ✅ 307 |
| `/account` | redirect to login | ✅ 307 |

Auth gating behaves correctly for unauthenticated requests.

---

## 2. Playwright browser smoke

| Check | Result |
|---|---|
| Homepage renders, correct `<title>` | ✅ |
| Homepage console errors | ✅ **0** |
| Product page renders, correct `<title>` | ✅ |
| Product page console errors | ✅ **0** |
| Phase 5 review section (5.1) renders post-merge | ✅ average, stars, count |

> The `favicon.ico` 404 observed earlier in the session is **no longer present** in this run.

---

## 3. ⚠️ Verdict: technical checks pass — the project is **NOT ready for deployment**

**All six verification checks pass. That is not the same as being ready to deploy, and this report
does not confirm deployment readiness.**

The checks above prove the code **compiles, lints, builds, holds its money invariants, and serves
correctly**. They cannot prove the system is *operationally safe*, because every remaining blocker
is a credential, a credential-backed service, or a decision — none of which a build gate can
detect.

### Blocking items (unchanged by this run)

| # | Item | Nature | Reference |
|---|---|---|---|
| **B1** | **Rate limiting unenforced in production.** `src/lib/rateLimit.ts` uses an in-memory `Map`; on Vercel, counters are neither shared nor persistent. Limits on login, registration, password reset, deposit submission, order placement, coupon checks and uploads **do not apply**. Exposure: credential stuffing, deposit spam, coupon brute-forcing. | External dependency (Redis / KV) | `PRODUCTION_CHECKLIST.md` §1 · `FINAL_AUDIT.md` C2 |
| **B2** | **Full-DB backup exports every bcrypt password hash.** `admin/backup` calls `prisma.user.findMany()` with no `select`. One mishandled file yields the complete credential set for offline cracking. | Business decision required | `PRODUCTION_CHECKLIST.md` §2 · `FINAL_AUDIT.md` H3 |
| **B3** | **Google OAuth account-linking takeover path.** | Business decision + external dependency | `PRODUCTION_CHECKLIST.md` §3 · `FINAL_AUDIT.md` C3 |

### Operational prerequisite — verify before taking money

**The payment account number may still be the seeded placeholder.** This is not detectable by any
automated check in this report. If it is unchanged at launch, **customers send real money to an
account that is not yours.** Verify in Admin → Settings → Payment Numbers.

Also verify: admin password changed from seed, `apply-constraints.ts` has run against production,
email (Resend) configured, blob storage configured.

### Known non-blocking risks carried into launch

| Risk | Note |
|---|---|
| **Global coupon `usageLimit` race** (`FINAL_AUDIT.md` H1) | Per-user limits are safe; the global cap is not — different users lock different rows, no `FOR UPDATE` on `Coupon`, READ COMMITTED. A capped coupon can over-redeem. **Avoid tightly-capped public coupons until fixed.** |
| **6 residual dependency CVEs** (2 high, 4 moderate) | All remaining fixes require a breaking major upgrade (`next` 16). |
| **`admin/restore` accepts unvalidated JSON** | Admin-only; exposure limited to operator error. |
| **Referral payout relies on an implicit row lock** | Correct today, but correct by accident. |
| **Single administrative role** | Deliberate design decision (4.10), not an oversight. Consequence: admin-account compromise is total. |
| **Phase 5 task 5.4 unverified in browser** | Requires authenticating as a specific customer. Code passes all static gates. |

---

## 4. What this report does and does not establish

**Establishes:**
- The merged `main` at `9093cca` builds and runs correctly.
- No regression was introduced by merging Phase 5 — all gates green, zero console errors.
- Money invariants hold (18/18).

**Does not establish:**
- That rate limiting works in production (it does not — B1).
- That customer credentials are safe in a backup (they are not — B2).
- That the payment account number is correct (unverifiable from code).
- That the coupon global cap holds under concurrency (it does not — H1).

---

## 5. Conclusion

**Verification run: PASS (6/6).**
**Deployment readiness: NOT READY — 3 blocking items outstanding.**

The engineering work is complete and verified. What remains is **not engineering work** — it is two
business decisions, one service credential, and one configuration check. Once B1, B2 and B3 are
resolved and §3's operational prerequisites are confirmed, re-run this verification and the project
can ship.

No blocked item has been marked complete anywhere in this repository.
