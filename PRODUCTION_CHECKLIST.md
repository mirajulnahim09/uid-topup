# PRODUCTION_CHECKLIST.md

**Purpose:** Tasks that **cannot** be completed during local development because they require external credentials, paid services, or a business decision. These are deployment-time responsibilities.

**Status:** Deferred out of Phase 1 by owner decision on 2026-07-18. **Not to be revisited during local development.**

> ⚠️ Every item marked **BLOCKING** must be resolved before the site accepts real customer money.

---

## 1. Distributed rate limiting — **BLOCKING**

**Origin:** Roadmap 1.6 · `AUDIT_REPORT.md` C2 · Priority P0

### The problem
`src/lib/rateLimit.ts` keeps its counters in a **module-level in-memory Map**. On Vercel each serverless invocation may run in a fresh isolate, so counters neither persist nor are shared. In production the rate limits on login, registration, password reset, deposit submission, order placement, coupon checks, and uploads are **effectively unenforced**.

### Why it could not be done locally
Requires a shared, network-accessible store (Upstash Redis, Vercel KV, or equivalent). No credentials exist in `.env`, and building an adapter against a store that isn't there would produce the *appearance* of a fix with none of the protection.

### What to do at deploy time
1. Provision Upstash Redis (or Vercel KV).
2. Add `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` to the environment, and register both in `src/lib/env.ts` `OPTIONAL`/`REQUIRED`.
3. Replace the in-memory store in `src/lib/rateLimit.ts` with a Redis-backed sliding window, keeping the existing `rateLimit()` / `LIMITS` / `getIp()` call signature so no route changes.
4. Keep the in-memory implementation as an automatic local-dev fallback when the env vars are absent.
5. **Verify:** exceed a limit from two different serverless instances and confirm the counter is shared.

### Risk if skipped
Credential stuffing on `/api/register` and `/api/auth`; deposit-claim spam; coupon brute-forcing.

---

## 2. Backup password-hash policy — **BLOCKING (decision required)**

**Origin:** Roadmap 1.7 · `AUDIT_REPORT.md` H3 · `BUG_FIX_REPORT.md` BUG-03 · Priority P1

### The problem
`GET /api/admin/backup` exports every `User` row **including the bcrypt `password` hash**, as a downloadable JSON file. Verified during QA (`$2a$12$BbrgP…`). One compromised admin account, or one mishandled backup file, yields the complete credential set for offline cracking.

### Why it could not be done locally
This is a **product decision about disaster-recovery semantics**, not a bug fix. Stripping the hashes is one line — but a backup restored without them leaves every customer unable to log in. Choosing that trade-off is the owner's call.

### Options — pick one before launch

| Option | Effect | Trade-off |
|---|---|---|
| **A. Strip hashes + force reset on restore** | Backup carries no credentials | Restore requires a password-reset cycle for all users (needs working email — see §4) |
| **B. Encrypt the backup at rest** | Hashes retained, file useless without a passphrase | Passphrase must be stored separately and never lost |
| **C. Keep as-is + documented handling procedure** | No code change | Relies entirely on operational discipline |

**Recommendation: A**, with B as a fallback if restore-without-reset is a hard requirement.

### Regardless of choice
- Restrict `/api/admin/backup` with an additional confirmation step and log every download to `AdminLog` (already logged — keep it).
- Never store backups in the repo, a public bucket, or a shared drive.

---

## 3. Google OAuth account-linking verification — **BLOCKING**

**Origin:** Roadmap 1.8 · `AUDIT_REPORT.md` · Priority P1

### The problem
`AUDIT_REPORT.md` documents a potential **account-takeover path** in the Google OAuth linking flow: if a Google sign-in links to an existing account purely by matching email address, an attacker controlling a matching Google address could take over a password-based account.

**This is unverified, not cleared.** QA could not test it.

### Why it could not be done locally
`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` are empty, so the provider is disabled and the flow cannot be exercised.

### What to do at deploy time
1. Create an OAuth client in Google Cloud Console; set redirect URI `https://<domain>/api/auth/callback/google`.
2. Populate both env vars.
3. **Verify the linking path explicitly** — read `findOrCreateGoogleUser()` in `src/lib/auth.ts` and confirm:
   - Does a Google sign-in with an email matching an existing **password** account silently link and grant access?
   - Is Google's `email_verified` claim checked before any linking?
4. If linking is by unverified email alone, require either explicit confirmation from the logged-in account or a verified-email claim.
5. **Verify:** attempt sign-in with a Google account whose email matches an existing password account; confirm it does not grant access without proof of ownership.

### Interim mitigation
Leaving `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` **empty disables the provider entirely** — the current local state. If the audit cannot be completed before launch, shipping without Google login is the safe choice.

---

## 4. Player-UID lookup provider — **recommended, not blocking**

**Origin:** Roadmap 2.3 · `COMPETITOR_ANALYSIS.md` idea #1

### Status
The provider architecture is **built and ready** (`src/lib/uidVerify.ts`): registry, 24-hour cache (`UidLookupCache`), rate limiting, and guaranteed graceful degradation. **No provider is connected**, because Free Fire exposes no public UID→nickname API.

**The site is safe without it.** Double-entry confirmation (type the UID twice, paste blocked) is live and blocks mismatched orders — this catches the actual failure mode, a typo.

### To enable live verification
1. Procure a commercial UID-lookup provider.
2. Add an entry to `PROVIDERS` in `src/lib/uidVerify.ts` (a commented template is in place).
3. Add the API key to `.env` and register it in `src/lib/env.ts`.
4. Set `Product.uidValidationProvider` to the registry key for each applicable product.
5. **Verify:** a known-good UID returns the correct in-game name; an unknown UID returns `not_found`; provider downtime returns `unavailable` and the order flow **falls back to double-entry without blocking sales**.

Keep the double-entry layer regardless — it is the fallback when the provider is unavailable.

---

## 5. Other deployment-time configuration

Not blocking on a decision, but required for full functionality.

| Item | Env var | Consequence if unset |
|---|---|---|
| Transactional email | `RESEND_API_KEY`, `EMAIL_FROM` | No welcome/deposit/order emails; **password reset unusable** |
| Image upload | `BLOB_READ_WRITE_TOKEN` | Deposit screenshots and admin image uploads disabled |
| Canonical URL | `NEXTAUTH_URL` | OAuth callbacks and absolute links break |
| **Serverless DB pool** | `DATABASE_URL` + `?connection_limit=1&pool_timeout=20` | Pool exhaustion under concurrency — see `.env.example` |
| **DB constraints** | run `npm run db:constraints` | Money guards absent (now automatic via `db:setup`) |
| **Payment numbers** | Admin → Site Settings | ⚠️ Seeded placeholder `01700000001` — **money goes nowhere** |
| **Admin password** | `ADMIN_PASSWORD` | Seeded default `Admin@2026Secure` is publicly known |

---

## 6. Pre-launch verification

- [ ] §1 distributed rate limiting live and shared across instances
- [ ] §2 backup policy chosen and implemented
- [ ] §3 Google OAuth linking audited, or provider left disabled
- [ ] Real bKash/Nagad numbers set; **placeholder replaced**
- [ ] Admin password changed from the seeded default
- [ ] `npm run db:constraints` run against production
- [ ] `DATABASE_URL` carries serverless pool parameters
- [ ] `NEXTAUTH_SECRET` is a fresh 32-byte random value (not the dev one)
- [ ] `RESEND_API_KEY` set, password-reset flow tested end-to-end
- [ ] Remaining dependency advisories reviewed (`npm audit --omit=dev`)
