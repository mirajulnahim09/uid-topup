# AUTONOMOUS RUN — single prompt, all phases

> Save as `RUN.md` in `v2/`.
> Start with: `Read RUN.md and begin. Continue until everything is done.`
> If it ever stops, reply with a single word: `Continue.`

---

## MODE

Autonomous. Work through the entire task list below, in order, without
asking for approval at any point.

`CLAUDE.md` still governs everything — money integrity, locking order,
secrets, the four verification checks. This file only removes the
approval gates, not the safety rules.

The owner will not be watching. Do not ask questions you can answer by
reading the code. Do not wait for permission. Do not ask "shall I
continue" — continue.

## THE ONLY THREE REASONS TO STOP

1. A verification check fails and you cannot fix it after a genuine attempt.
2. A task requires a third-party API contract you cannot find authoritative
   public documentation for.
3. You are running low on context.

In cases 1 and 2: write down what blocked you, **skip that task**, and move
to the next one. Do not halt the whole run over one blocked item.

In case 3: update `PROGRESS.md`, state which task is next, and stop cleanly.

## PROGRESS TRACKING — do this or the run cannot be resumed

Create `PROGRESS.md` immediately, before starting work. After **every**
completed task, append one line:

```
[x] C4 — rate limiter fail-closed — 2026-08-07 — tsc/lint/build ok — verify: ratelimit-failclosed.ts 6/6
[!] N3 — bKash provider — SKIPPED — no public API docs without merchant account
```

Commit `PROGRESS.md` with each task. If you resume, read it first and
continue from the first unfinished line. Never redo a completed line.

## PER-TASK LOOP

For each task, in this exact order:

1. Read the files you will touch — fully, not from grep snippets.
2. Implement the smallest correct change. Bengali comments explaining *why*.
3. Write a runtime verification script in `scripts/verify/` that actually
   executes and asserts. Compiling is not verification.
4. Run: `npx prisma generate` · `npm run typecheck` · `npm run lint` ·
   `npm run build` — all four must pass.
5. `git commit` — one commit per task, English message, format:
   `fix(C4): rate limiter fail-closed on auth paths`
6. Append the line to `PROGRESS.md`.
7. Move to the next task. Do not summarise. Do not pause. Do not ask.

Schema migrations: write the migration, verify it is non-destructive on
existing data, apply it, and continue. Never `migrate reset`.

---

# TASK LIST — work top to bottom

## GROUP A — finish Phase 1 (auth safety)

**C4 — rate limiter fail-closed on auth**
`src/lib/rateLimit.ts` returns `{ ok: true }` on DB error. Fine for general
traffic, unacceptable for auth.
- Add `failClosed?: boolean`, default `false`
- Pass `true` from every `login:*`, `forgot:*`, `reset:*`, `2fa:*` call site
- User-facing message in Bengali: *"সার্ভারে সাময়িক সমস্যা হচ্ছে, একটু পরে
  আবার চেষ্টা করুন"* — never reveal that the limiter failed
- Log at `error` level either way
- Preserve `peekRateLimit()` / `resetRateLimit()` added in an earlier session
- Verify: DB error simulated — auth paths block, non-auth paths pass

**C5 — banned users can hold a valid session**
`middleware.ts` reads only `token.role`. `isBanned` / `sessionEpoch` are
revalidated in the `jwt` callback only when `trigger === 'update' || !user`,
and `maxAge` is 30 days.
- Add a `lastChecked` claim; revalidate `isBanned` + `sessionEpoch` when it
  is older than 5 minutes
- **No DB call in middleware** — it runs on the edge on every request
- Existing logged-in users must not be force-logged-out by this change
- Audit every API route handler for `requireUser()` / `requireAdmin()`;
  list any that bypass it in `PROGRESS.md`
- Verify: ban a user, assert access is cut within 5 minutes

## GROUP B — Phase 2 correctness

**H1 — order price read outside the lock (highest value in this group)**
`src/app/api/order/route.ts` locks `id, stock` with `FOR UPDATE`, then reads
`price` from a separate unlocked `findUnique`.
- Select `id, stock, price, "costPrice", "isActive"` inside the `FOR UPDATE`
- All money math uses the locked row's values
- Keep `findUnique` only for non-financial fields
- Verify: hold the lock, change the price concurrently, assert the order
  uses the locked price

**H2 — `getIp()` trusts client headers**
Add a `TRUSTED_PROXY` env flag. When unset, prefer the platform-provided
value and ignore user-supplied `x-forwarded-for`. Document the assumption.

**H3 — CSP**
- `img-src`: replace bare `https:` with the Vercel Blob host + `data:` + `blob:`
- `script-src`: nonce-based CSP (generate in middleware, pass via header,
  consume in `layout.tsx`)
- If nonce breaks Next hydration: revert the script-src part, record it in
  `PROGRESS.md` as blocked, keep the `img-src` fix. Do not leave
  `unsafe-inline` while claiming it is fixed.

**H4 — polling load**
Navbar polls 60s, AutoRefresh 30s; Neon has connection limits.
- `/api/stream` SSE pushing notification count + order status
- Fall back to 120s polling when `EventSource` is unavailable
- `visibilitychange` — background tabs stop entirely
- Verify: count DB queries over 2 minutes, before and after

**M-group — small fixes, one commit**
- M1: the comment at `globals.css` L12–18 says LIGHT THEME above a dark
  block. Fix the comment.
- M2: document that `--gold` is olive green. Do not rename — 34 files depend on it.
- M5: `ThemeProvider.tsx` hardcodes theme-color hexes; read from the tokens.
- M6: ISR (`revalidate: 300`) on catalog/product pages — first prove no
  user-specific data leaks into the cache.

## GROUP C — light theme

Apply `CLAUDE.md` §5 in full, as one atomic change.
§5.1 accent override (option A) · §5.2 elevation ramp · §5.3 60/30/10 ·
§5.4 shadows, no glow, kill the ambient wash.

Acceptance (§5.5): zero JSX/TSX files modified · every pair ≥ 4.5:1
(≥ 3:1 large text and UI borders), ratios reported · no new `!important` ·
both themes × all five accent presets checked.
Verify: `scripts/verify/theme-contrast.ts` asserts every pair.

## GROUP D — tests

**This group comes before payments. Writing money code without tests is
writing money code blind.**

Vitest + a separate test Postgres. Minimum coverage:
- **Order:** happy path · insufficient balance · out of stock · concurrent
  double-spend · coupon over-limit race
- **Deposit:** approve · reject · duplicate TrxID · double-approve
- **Refund:** partial · full · over-refund rejected
- **Ledger invariant:** after 100 randomised operations,
  `SUM(LedgerEntry.amount) === User.balance` for every user

Add `npm run test`; wire it into `.github/workflows/ci.yml`.
Either use `playwright-core` for one e2e smoke test or remove the dependency.

## GROUP E — payment gateway infrastructure

Build the full capability with **no credentials**. The owner has none and
will not have any for some time. Credentials get entered later through the
admin panel — no redeploy, no code change.

- `PaymentGatewayConfig` model: provider, isEnabled, mode (sandbox|live),
  credentials (encrypted JSON), lastTestedAt, lastError, updatedBy
- Encrypt at rest using the **existing** encryption pattern. No new key,
  no new scheme.
- Admin UI, one card per provider: credential inputs, sandbox/live toggle,
  enable/disable toggle, "Test connection" button that makes a real call and
  stores the result. After save, credentials render masked (last 4 chars);
  full values never reach the client.
- Registry resolves at runtime; `isEnabled=false` means the provider does not
  appear at checkout at all.
- **HARD CONSTRAINT:** with every gateway disabled, the existing manual
  bKash/Nagad deposit flow must behave exactly as it does today. That is
  currently the only working payment path. Do not regress it.

Then implement providers in this order, against public documentation:
SSLCommerz → Stripe → PayPal → Razorpay → bKash → Nagad → Rocket

Every provider needs: signature verification, webhook idempotency, replay
protection, and an amount assertion against the `Deposit` row (mismatch
means reject, never credit).

bKash / Nagad / Rocket publish little without a merchant account. If you
cannot find authoritative docs, implement the config shape and skeleton,
mark the provider `SKIPPED — no public docs` in `PROGRESS.md`, and move on.

Verify with mock servers: success, failure, cancellation, replayed webhook,
amount mismatch.

## GROUP F — reseller tier

Highest-ROI revenue feature for this market.
- `Variant.resellerPrice`, `User.tier` (schema migration — write it, verify
  it is non-destructive, apply it)
- API-key authenticated bulk order endpoint with its own rate limits
- Reseller orders carry a distinct ledger note
- Admin UI for tier management
- Verify: reseller pricing applies for reseller, normal users never receive it

## GROUP G — auto-fulfillment

`fulfillment/policy.ts` already decides; only a real adapter is missing.

**Absolute rule:** if the provider errors or times out, the order must not
be marked delivered **and** the wallet must not be double-charged.
Idempotency on the provider call is mandatory.

- Retry with exponential backoff
- After max attempts, return to the manual queue + Telegram alert
- Verify: simulate timeout, duplicate call, and partial failure — assert the
  ledger is intact in all three

Without a chosen provider's documentation, build the adapter interface and a
mock implementation, mark it blocked, and continue.

## GROUP H — risk, monitoring, cache

- `riskSignals.ts` computes scores that nothing consumes. Above threshold →
  auto-hold the deposit + Telegram alert. **Never auto-ban.**
- Wire `errorReporter.ts` to a real sink (Sentry or equivalent). Scrub PII
  and money amounts from breadcrumbs.
- Move rate-limit buckets and settings/branding cache to Upstash Redis.
  Postgres stays the source of truth; Redis is a cache and a counter, never
  a ledger. If Redis is down the system still runs — but C4's fail-closed
  behaviour on auth paths must survive.

## GROUP I — remaining features, in this order

1. **Public storefront search** — currently admin-only
2. **Invoice / receipt PDF** — customer trust
3. **Phone OTP** — fake-account defence for the BD market
4. **In-app ticket + dispute thread** — reduce Tawk.to dependence
5. **Wallet withdrawal** — money currently only enters; refunds are the only exit
6. **Affiliate dashboard + payouts** — on top of the existing `referral.ts`
7. **Real SMM module** — `account/smm-orders/page.tsx` is currently just a
   filter on the `like-follow-subscribe` category slug, with no service,
   link, quantity, or drip-feed fields. It is not an SMM panel.

## FINAL

When the list is exhausted:
1. Run the four checks one last time
2. Run every script in `scripts/verify/`
3. Run the test suite
4. Produce the two zips (`CLAUDE.md` §2.6)
5. Write `HANDOFF.md`: what shipped, what was skipped and why, what the
   owner must do manually (env vars, secrets to rotate, GitHub secrets,
   accounts to open), and what is still not production-safe

Then report once, in the four-part format, covering the whole run.

---

## REMINDER

`CLAUDE.md` is not suspended. Money integrity, locking order, secret
handling, and the four checks apply to every single task. Autonomy means no
approval gates — it does not mean lower standards.

Skipping a blocked task and continuing is correct.
Guessing at an API contract is not.
Claiming something works when you only compiled it is not.
