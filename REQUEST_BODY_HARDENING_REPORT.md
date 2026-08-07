# REQUEST_BODY_HARDENING_REPORT.md

**Scope:** Fix the deferred finding from `GLOBAL_LOADING_SYSTEM_REPORT.md` §7 — malformed request bodies returned **500** instead of **400** on every mutating API route.
**Date:** 2026-08-05
**Gates:** `tsc` ✅ · `next lint` ✅ (0 warnings) · clean `next build` ✅ (**87.3 kB shared JS — unchanged**) · `test:money` **18/18** ✅ · live probes **9/9** ✅

---

## 1. The bug

`await req.json()` throws a `SyntaxError` when the body is unparseable, empty, or sent with a wrong `Content-Type`. That throw is not an `ApiError`, so the catch-all in `apiError()` mapped it to:

```
500  { "error": "সার্ভারে সমস্যা হয়েছে। আবার চেষ্টা করুন।" }
```

The client sent a bad request; the server reported its own failure. Two concrete costs: monitoring fills with phantom 5xx that no server-side fix will ever clear, and the user is told to "try again" for a request that can never succeed unchanged.

This was found on `POST /api/deposit` during the 2026-08-01 pass and deliberately deferred — it sits on a money path, and `MANUAL_PRO.md` §21.5 requires re-running `npm run test:money` after touching those. **51 call sites across 34 files shared the shape.**

## 2. The fix

`readJson<T>(req)` in `src/lib/guard.ts`, next to `ApiError` and `apiError` so the throw and its handler live in one file.

```ts
export async function readJson<T = any>(req: Request): Promise<T> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ApiError('অনুরোধের ডেটা পড়া যায়নি', 400);
  }
  if (body === null || typeof body !== 'object') {
    throw new ApiError('অনুরোধের ডেটা সঠিক নয়', 400);
  }
  return body as T;
}
```

**Two decisions worth stating:**

1. **The `null`/primitive guard is not padding.** `JSON.parse('null')` *succeeds*. Without the second check a body of `null` sails past the try/catch and dies one line later on `const { id } = body` — a `TypeError`, still not an `ApiError`, still a 500. Fixing only the parse would have left half the bug in place. Verified directly: `null` and `123` both return 400 (§4). Arrays still pass, since `typeof [] === 'object'` — no route was relying on that, but nothing forbids it either.

2. **Generic defaulting to `any`, matching `req.json()`'s own signature.** The 47 migrated sites are a mix of `schema.safeParse(await …)` and bare destructuring (`const { id, isActive } = await …`). Returning `unknown` would have been stricter in the abstract and would have forced a cast at every destructuring site — turning a mechanical, reviewable change into 34 hand-edited files. Preserving the existing type behaviour exactly is what makes the diff safe to read.

## 3. Migration — 47 sites, 32 files

(51 raw occurrences found, minus the 4 `.catch`-guarded ones below.)

Scripted (regex + import wiring) rather than hand-edited, so no site was silently missed; the script also printed what it *didn't* touch, which is how the exceptions below were confirmed rather than assumed.

**Four sites were deliberately left on `req.json()`:**

| Route | Pattern | Why |
|---|---|---|
| `admin/media` DELETE | `.catch(() => ({}))` | treats a missing body as "no fields"; already 400s on a missing `id` |
| `admin/payment/provider` POST | `.catch(() => null)` | has an explicit `if (!body \|\| typeof body !== 'object') throw ApiError(…, 400)` |
| `admin/payment/provider` DELETE | `.catch(() => ({}))` | same |
| `admin/telegram-test` POST | `.catch(() => ({}))` | same |

None of these can 500 — they were never part of the bug. Converting them would have turned a legitimately empty body into an error, which is a behaviour change, not a fix.

### One mistake, caught and corrected
The migration script matched `src/**` including `guard.ts` itself, so it rewrote the helper's own `await req.json()` into `await readJson(req)` — **infinite recursion** — and added a self-import. Caught immediately on the post-run file read and reverted before any gate ran. Recording it because the script's blast radius, not its regex, was the flaw: it should have excluded its own target file.

## 4. Verification — live, against the dev server

Real HTTP against `localhost:3000`. No stubs, no database writes (every probe fails validation or auth before reaching a write).

```
--- /api/track (public, reaches readJson) ---
PASS  broken JSON              -> 400 (want 400)  অনুরোধের ডেটা পড়া যায়নি
PASS  empty body               -> 400 (want 400)  অনুরোধের ডেটা পড়া যায়নি
PASS  top-level null           -> 400 (want 400)  অনুরোধের ডেটা সঠিক নয়
PASS  top-level number         -> 400 (want 400)  অনুরোধের ডেটা সঠিক নয়
PASS  valid JSON, bad fields   -> 400 (want 400)  Expected number, received nan

--- /api/auth/forgot (public) ---
PASS  broken JSON              -> 400 (want 400)  অনুরোধের ডেটা পড়া যায়নি
PASS  valid JSON, bad email    -> 400 (want 400)  সঠিক ইমেইল দিন

--- protected: auth gate still runs first ---
PASS  deposit, broken JSON     -> 401 (want 401)  লগইন করুন
PASS  admin/product, broken    -> 401 (want 401)  লগইন করুন

9/9 passed
```

The last two rows are the check that the fix didn't reorder anything: `requireUser()` still runs **before** the body is read, so a malformed body from a logged-out client is still an auth failure, not a body failure. An unauthenticated attacker cannot use body parsing to probe protected routes.

Row 5 and row 7 are the regression guard: a *well-formed* body with bad values still gets its normal zod message, not the new one.

## 5. Money-path gate

`npm run test:money` → **18 passed, 0 failed**, as required by §21.5 (`/api/deposit`, `/api/order`, `/api/order/direct`, `/api/admin/order/refund` all migrated).

The two pre-existing informational notes are unchanged from prior runs and are Phase-2 QA artifacts, not code faults:
```
ⓘ Phase2 QA: DEPOSIT এর আগে ব্যালেন্স 4770 → 0 (খতিয়ানের বাইরে বদল)
ⓘ Phase2 QA: ORDER এর আগে ব্যালেন্স 158 → 1000 (খতিয়ানের বাইরে বদল)
```
Ledger chain intact, latest ledger == current balance, no negative balances.

## 6. Honest limitations

1. **`/api/deposit` — the originally-reported route — was verified structurally, not with a live authenticated 400.** It is auth-gated, so an unauthenticated malformed body correctly returns 401 and never reaches `readJson`. Proving the 400 there needs a real session; I did not create or guess credentials to manufacture one. What *is* proven: the helper returns 400 end-to-end on two public routes, and `deposit/route.ts:20` now calls it on the identical code path (`readJson` → `safeParse` → `ApiError`). A logged-in click-through remains the honest last mile, and it belongs in the staging E2E harness that is already item 8 on the roadmap.

2. **Body-size and content-type limits are untouched.** `readJson()` fixes the *status code* for bad bodies; it does not bound how large a body a route will attempt to parse. That is a separate concern (a middleware-level limit), out of scope here.

3. **`admin/settings/route.ts:66` now carries a redundant `typeof body !== 'object'` check** that `readJson()` already guarantees. Left in place — it is harmless, and removing correct defensive code to chase tidiness is how regressions get introduced.

## 7. Infrastructure note

The dev server (PID 12328) had died on its own before this session's first live probe — `ECONNREFUSED`, not something this pass caused. That happened to be convenient: `next build` needs it stopped anyway on Windows (Prisma DLL lock), so the order ran build → money test → restart. **The dev server is running on port 3000 at the end of this session.**

---

## Files changed

| File | Change |
|---|---|
| `src/lib/guard.ts` | `readJson()` added |
| 32 route files under `src/app/api/**` | 47 call sites → `readJson(req)`, import wired |
| `MANUAL_PRO.md` | new §24; §21.5 rule added |
