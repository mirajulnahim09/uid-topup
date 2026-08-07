# Final Production Release Report

**Date:** 2026-08-06
**Gate:** `scripts/release-gate.ts` — 6 stages executed against the running application
**Method:** every result below is an HTTP status, a rendered DOM state, or a database row count. Nothing was concluded from reading source alone.

# ❌ NOT READY FOR PRODUCTION

**One release blocker, plus scope I could not verify.** Detail in §7 and §8. The application logic itself passed everything it was tested against — the blocker is a deployment-configuration gap that silently harms customers.

---

## Summary

| Stage | Result |
|---|---|
| 1. Authentication | **8 / 8** |
| 2. Authorization (broken access control) | **3 / 3** — 144 probes, 0 leaks |
| 3. Workflows (end-to-end) | **14 / 14** |
| 4. Security | **9 / 9** |
| 5. Database, money safety, concurrency | **4 / 4** |
| 6. Performance | measured; 5,000-user test **not performed** |
| Supporting suites | loading 63/63 · tables 444 checks/0 issues · pages 0 issues/32 · system 54/54 · branding 48/48 · money 18/18 |

---

## 1. Authentication — 8/8

| Test | Result | Evidence |
|---|---|---|
| Registration creates account and signs in | PASS | real form submit, redirected off `/register` |
| Session valid after registration | PASS | `GET /api/me` → 200 |
| Duplicate email rejected | PASS | → 409 |
| Weak password rejected | PASS | → 400 |
| Wrong password rejected | PASS | login denied |
| **Brute-force guard enforced** | PASS | after 6 failures the **correct** password is also refused |
| Correct credentials accepted | PASS | customer logged in |
| Admin login | PASS | `admin@uidtopup.local` |

**On the brute-force test.** My first two attempts at this measured the wrong thing and I want that on record. Posting directly to `/api/auth/callback/credentials` never reaches `authorize()` — NextAuth rejects it on CSRF first — so the limiter never runs and the test reported "no lockout". Driving the real form showed the counter incrementing 1→8 while the UI message never changed, which looks like a counted-but-unenforced limit. It is neither: `auth.ts:175` returns `null` on limit **before** comparing the password, and the unchanging message is deliberate — revealing lockout state would confirm to an attacker which emails are real. The only valid proof is that the *correct* password stops working, which is what is now asserted.

---

## 2. Authorization — no broken access control

**144 probes**: 36 admin API routes × {guest, customer} × {GET, POST}.

```
result: 401×48, 403×44, 405×52 — zero 2xx
```

| Test | Result |
|---|---|
| No admin API reachable by guest or customer | **PASS** — 0 leaks in 144 probes |
| No admin page reachable by direct URL | **PASS** — 20 attempts, all redirected |
| Customer-scoped APIs return nothing to a guest | **PASS** |

**Roles that exist:** `enum Role { USER, ADMIN }`. There is **no Owner, Manager or Staff tier** in the schema. The brief asked for permission testing across six roles; four of them are not implemented. This is not a defect — it is a functional gap you should confirm is intentional before launch. If staff need scoped admin access, it does not exist and cannot be granted safely today (the only elevation available is full ADMIN).

---

## 3. Workflows — 14/14, including the complete money path

| Test | Result | Evidence |
|---|---|---|
| Deposit form renders | PASS | |
| Customer submits deposit | PASS | → 200, rows 12→13 |
| **Duplicate transaction ID rejected** | PASS | → 409, rows unchanged |
| **Admin approval credits wallet** | PASS | ৳0 → **৳500** |
| Approval writes ledger entry | PASS | 0 → 1 |
| **Order deducts exactly the price** | PASS | ৳500 → **৳335** (price ৳165) |
| Wallet never negative | PASS | ৳335 |
| Coupon: invalid rejected | PASS | → 400 |
| Admin creates coupon | PASS | row created |
| Admin deactivates coupon | PASS | `isActive=false` |
| Admin deletes unused coupon | PASS | row gone |
| Admin settings save | PASS | → 200 |
| Reports API | PASS | → 200 |
| Health endpoint | PASS | → 200 |

**Three "failures" in the first run were my tests, not the application** — worth recording so they are not re-investigated later:
- `/api/admin/deposit` takes `depositId`, not `id`. I sent `id`, got 400, and briefly logged it as a blocker ("wallet not credited"). It credits correctly.
- Coupons are deleted with `{id}` in the **body**, not a query string; the route also refuses to delete a *used* coupon by design, to preserve order history.
- The deposit approval path uses `SELECT … FOR UPDATE` row locking specifically so simultaneous admin approvals cannot double-credit. That is a well-built piece of code.

**Coverage caveat:** the "valid coupon" probe returned 400 (the seeded coupon did not satisfy its own constraints), so the coupon *happy path* is **not** proven — only rejection of an invalid code is.

---

## 4. Security — 9/9

| Test | Result | Evidence |
|---|---|---|
| Stored XSS does not execute | PASS | `<img onerror>` in profile name → PATCH 400, no execution |
| SQL injection cannot bypass login | PASS | `' OR '1'='1` denied |
| Injection does not damage the database | PASS | User rows intact after `'; DROP TABLE "User"; --` |
| **No secret in HTML or API responses** | PASS | 6 pages + 3 APIs scanned for bot token, postgres URL, NEXTAUTH_SECRET, encryption key |
| **Session cookie `httpOnly` + `SameSite=Lax`** | PASS | `httpOnly=true sameSite=Lax` |
| Malformed JSON → 4xx not 500 | PASS | → 400 |
| Oversized payload → 4xx not 500 | PASS | → 400 (200 KB field) |
| Security headers present | PASS | `x-content-type-options`, `x-frame-options`, `referrer-policy` |
| **Upload rejects SVG and executables** | PASS | SVG → 400, `.exe` → 400; PNG → 200 |

**On CSRF.** My first probe sent `Origin: https://evil.example.com` to `/api/deposit` and got 200, which I initially recorded as a vulnerability. It is not. Playwright's `request` context is not a browser: it ignores `SameSite` and sends cookies from its own jar regardless of origin. In a real browser the session cookie is `SameSite=Lax` and **is not sent on a cross-site POST at all**. The correct assertion is the cookie's attributes, which is what now runs. SVG upload being rejected matters here too — SVG is a stored-XSS vector and it is blocked.

---

## 5. Database, money safety, concurrency — 4/4

| Test | Result | Evidence |
|---|---|---|
| **10 concurrent identical deposits → exactly 1 row** | PASS | 1/10 accepted, rows +1 |
| **8 concurrent orders never drive wallet negative** | PASS | final balance ৳0 |
| Hot tables indexed | PASS | 71 indexes across 27 tables |
| Order list batched, not N+1 | PASS | 4 queries for 20 orders across 3 relation levels |

Both of my initial failures here were bad assertions: I checked for a table named `WalletLedger` (the model is `LedgerEntry`) and set an arbitrary N+1 threshold of ≤3 when 4 is the *correct* count for three `include` levels — real N+1 would be 20+.

Money invariants separately verified at 18/18 with full rollback (`scripts/money-invariants.ts`).

---

## 6. Performance — measured, but the headline number is unobtainable here

**Measured (production build, this machine):**

| Metric | Value |
|---|---|
| `SELECT 1` database round-trip | **p50 305 ms** (min 301, max 314) |
| `/api/health` | p50 333 ms · p95 695 ms |
| `/` (homepage) | p50 3345 ms · p95 4520 ms |
| 50 concurrent requests | all succeed, no 5xx, 13 req/s |

**Diagnosis: this is geography, not code.** A trivial `SELECT 1` costs 305 ms because the database is Neon in `us-east-1` and the test machine is not. Every page that makes a handful of sequential queries therefore pays multiples of 305 ms before rendering anything. Deployed co-located with the database, those same queries cost single-digit milliseconds. **I cannot produce a production-representative latency figure from this environment, and I am not going to present these numbers as if I could.**

### The 5,000-concurrent-user test was NOT performed

I am not able to run this validly, and running it badly would be worse than not running it:

1. **It would point at your live database.** `DATABASE_URL` is the real Neon instance holding real users, orders and wallet balances. Driving 5,000 concurrent sessions at it risks connection exhaustion, throttling, cost, and contention with anything else using it.
2. **A single laptop cannot generate 5,000 valid concurrent users.** The client becomes the bottleneck long before the server does, and the resulting numbers describe the test rig, not the application.
3. **There is no staging environment or load dataset.** A meaningful test needs a production-shaped deployment, a seeded dataset, and a load tool (k6, Artillery, Gatling) driving realistic journeys — not raw request floods.

**What to do instead, before launch:** deploy to the target host, point k6 at a staging copy of the database, and ramp to target concurrency while watching p95 latency, DB connection count and error rate. Two things to fix first, both visible from here:
- `DATABASE_URL` uses the **pgbouncer pooler host** (correct) but sets **no `connection_limit`**. Under concurrency Prisma's default sizing can exhaust the pooler. Set it explicitly for the host's concurrency model.
- The homepage is `ƒ Dynamic` (server-rendered per request) and issues several queries. With a co-located database this is fine; it is also the first thing to cache if load testing shows pressure.

---

## 7. RELEASE BLOCKER

### 🔴 Password reset is silently non-functional — customers can be permanently locked out

**Evidence, measured:**
```
env:      RESEND_API_KEY   MISSING
request:  POST /api/auth/forgot  →  200
response: "যদি এই ইমেইলে অ্যাকাউন্ট থাকে, রিসেট লিংক পাঠানো হয়েছে।"
code:     email.ts   → sendMail(): `if (!resend) return;`      ← silently skips
          forgot/route.ts → emailPasswordReset(...).catch(() => {})  ← error swallowed
```

The reset token is stateless (an HMAC over user id + current password hash), so no database row is created and nothing is queued for retry. The customer is told to check their inbox. **No email is ever sent.**

**Why this blocks release rather than being a nice-to-have:** these accounts hold real wallet balances. A customer who forgets their password has no self-service recovery, no error message indicating anything went wrong, and no operational signal is raised on the server either — the failure path is deliberately silent to protect against email enumeration, which is correct for security and unfortunate for diagnosis.

**Fix:** set `RESEND_API_KEY` in the production environment and verify one real reset end-to-end. Separately, consider having `sendMail` log at `error` level when it skips due to missing configuration, so a misconfigured deploy is visible in logs rather than silent.

---

## 8. Must be resolved before launch (not code defects — deployment decisions)

| # | Item | Impact | Evidence |
|---|---|---|---|
| 1 | `BLOB_READ_WRITE_TOKEN` missing → uploads fall back to the **local filesystem** | Fine on a VPS. On serverless (Vercel/Netlify) the filesystem is ephemeral: **product images, banners and deposit payment screenshots would disappear**. Deposit screenshots are payment evidence. | upload → 200, wrote `/uploads/products/1785968734624-bpe5m6zo.png` via `localDriver` |
| 2 | No dedicated `TELEGRAM_ENC_KEY` → encryption falls back to `NEXTAUTH_SECRET` | Works today. Rotating the auth secret would make **all encrypted settings permanently unreadable**. | `secretbox.ts:50` |
| 3 | No `connection_limit` on the pooled `DATABASE_URL` | Connection exhaustion risk under concurrency | §6 |
| 4 | Only `USER` / `ADMIN` roles exist | No Owner/Manager/Staff tier; staff access can only be granted as full admin | schema `enum Role` |

---

## 9. NOT VERIFIED — cannot be signed off

Listing these plainly rather than implying coverage I do not have:

1. **5,000-user stress test** — not performed (§6).
2. **Google OAuth end-to-end** — credentials are configured, but completing a real Google consent flow was not exercised.
3. **Password reset happy path** — cannot be verified while §7 stands.
4. **Coupon happy path** — only invalid-code rejection is proven (§3).
5. **Refund workflow** — not exercised.
6. **Telegram send path** — configuration was verified in earlier passes; no message send was exercised in this gate.
7. **Media library, banner and homepage CRUD** — raw upload verified; the library/CRUD UI was not driven.
8. **Production-representative latency** — unobtainable from this environment (§6).
9. **Deadlock testing** — concurrency was tested for correctness (no double-credit, no negative balance), not for deadlock behaviour under sustained contention.

---

## 10. Risk assessment

| Area | Risk | Basis |
|---|---|---|
| Broken access control | **Low** | 144 probes, zero leaks; every admin page redirects |
| Money correctness | **Low** | 10-way duplicate → 1 row; 8-way concurrent orders → no negative balance; `FOR UPDATE` locking; 18/18 invariants with rollback |
| Injection / XSS | **Low** | payloads neutralised; SVG and executables rejected at upload |
| Secret exposure | **Low** | 4 patterns × 6 pages × 3 APIs, clean |
| Session security | **Low** | `httpOnly` + `SameSite=Lax`, `secure` under production |
| Account recovery | **HIGH** | §7 — silent failure, no recovery path |
| Asset durability | **Medium–High** | depends entirely on host; §8.1 |
| Scale behaviour | **Unknown** | untested at target load; §6 |
| Staff operations | **Medium** | no role between customer and full admin |

---

## 11. Decision

# ❌ NOT READY FOR PRODUCTION

**The application code passed every test it was subjected to** — 38 gate assertions plus 227 from the supporting suites, with no defect found in authentication, authorization, money handling, concurrency, or injection resistance. The money path was driven end-to-end with real rows and real balances.

It is not approved because:

1. **A customer-facing recovery path silently fails** (§7). For a product holding customer funds, "forgot password does nothing and says it worked" is not shippable.
2. **Asset storage is unresolved for the target host** (§8.1) — on serverless, payment evidence would be lost.
3. **Load behaviour at the stated target is unmeasured** (§6), and I will not certify a number I did not obtain.

**Path to approval — all four are small:**
1. Set `RESEND_API_KEY`; verify one real password reset end-to-end.
2. Set `BLOB_READ_WRITE_TOKEN` (or confirm a persistent-disk host).
3. Set a dedicated `TELEGRAM_ENC_KEY` and an explicit `connection_limit`.
4. Run a k6 ramp against staging to the concurrency you actually expect.

Re-run `npx tsx scripts/release-gate.ts --headless` after (1)–(3); it is repeatable and takes about 8 minutes.
