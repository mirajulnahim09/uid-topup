# TELEGRAM_INTEGRATION_REPORT.md

**Scope:** Activate the Telegram Bot integration from `.env`, review the whole integration, and verify no secret is exposed anywhere.
**Date:** 2026-08-05
**Gates:** `tsc` ✅ · `next lint` ✅ (0 warnings) · clean `next build` ✅ (**87.3 kB shared JS — unchanged**) · `test:money` **18/18** ✅
**Tests:** integration **26/26** ✅ · authenticated admin-page leak check **11/11** ✅

---

## 1. Bottom line

| | |
|---|---|
| **Token valid?** | ✅ Yes — verified live against `api.telegram.org/getMe` |
| **Bot** | **@uidtopup1bot** — "UID TOP UP" (bot id `8801466881`) |
| **Token loads from `.env`?** | ✅ Yes — **after two fixes**; it did not before (see §2) |
| **Can the app send messages?** | ❌ **No — `chat_id` is missing.** This is the one remaining blocker |
| **Secrets exposed anywhere?** | ✅ No — verified by test, after closing one structural leak |

**The integration is wired, validated, and secure — but it cannot deliver a single message until a `chat_id` is supplied, and that requires a human action in Telegram that no code can perform.** Details and exact steps in §6.

---

## 2. Two blocking faults found before anything could work

### 2.1 The `.env` value was malformed — the token carried a trailing newline

```env
TELEGRAM_BOT_TOKEN="8801466881:AAGKgcl…Bz0dc     ← line 23, quote never closed
"                                                 ← line 24, orphaned quote
```

dotenv treats a quoted value as multi-line, so `process.env.TELEGRAM_BOT_TOKEN` parsed to **47 characters — the 46-character token plus `\n`**. Because the token is interpolated straight into the request path (`/bot<TOKEN>/sendMessage`), that newline would have produced a malformed URL and a hard failure on every call.

**Fixed** — collapsed onto one line. `.env` was backed up to `.env.bak-20260805` first, and rewritten as UTF-8 **without BOM** to preserve the Bengali comments (a BOM would have corrupted the first key). Verified afterwards: all 11 keys intact, raw length now 46, no embedded newline.

### 2.2 Nothing in the codebase ever read `TELEGRAM_BOT_TOKEN`

This is the larger finding. `TELEGRAM_BOT_TOKEN` appeared in exactly one place in the entire repository — `.env` itself. **Zero code references.**

The integration read its token from **database settings** (`Setting` rows `telegram_bot_token` / `telegram_chat_id`), populated through Admin → Settings. Those rows are **empty** in this deployment. So:

- putting the token in `.env` had no effect whatsoever;
- `sendTelegramAdmin()` hit `if (!token || !chatId) return;` and returned silently;
- **no error was ever raised** — by design, the feature fails silent. It looked configured and did nothing.

**Fixed** — `src/lib/telegram.ts` now resolves config with **env taking precedence over DB settings**:

```ts
const token  = envToken  || dbToken;    // TELEGRAM_BOT_TOKEN
const chatId = envChatId || dbChatId;   // TELEGRAM_CHAT_ID
```

Env-first is deliberate: it is the only source that never touches the database and never crosses to the browser. The DB path is kept as a fallback so existing deployments configured through the admin UI keep working. Every value is sanitized on read (trim + strip wrapping quotes), so a repeat of §2.1 can no longer break anything.

---

## 3. Security review

### 3.1 The one real leak — the bot token was shipped to the browser

`src/app/admin/site/page.tsx` (a server component) passed the entire settings object into `SiteManager`, which is `'use client'`:

```tsx
const settings = await getSettings();   // includes telegram_bot_token
<SiteManager settings={settings} … />   // ← crosses to the browser
```

Anything passed to a client component is serialized into the **RSC payload and embedded in the HTML**. The token was then rendered into a plain `<input>` — not even `type="password"` — and POSTed back on every save, plus sent in the body of every "test" click.

**Severity, stated honestly:** the page is admin-only, so this was admin-to-admin exposure, not public. And because the DB setting is empty in *this* deployment, **nothing was actually leaking here in practice** — the field was blank. The flaw was **structural**: any deployment that configured the token through the documented admin UI would have had it sitting in plaintext in the page HTML, in browser cache, in devtools, and in any screen-share or screenshot.

**Fixed, four changes:**

| Where | Change |
|---|---|
| `app/admin/site/page.tsx` | token stripped from the props: `const { telegram_bot_token: _redacted, ...settings } = rawSettings` |
| `components/admin/SiteManager.tsx` | token input replaced by a read-only status panel (source + `8801466881:***` hint). The field is gone, so it cannot be echoed back |
| `api/admin/telegram-test/route.ts` | **no longer accepts a token in the request body** — the server uses its own config. Accepting one required sending it to the browser first, which was the leak |
| `api/admin/settings/route.ts` | a blank `telegram_bot_token` is now **ignored** instead of written. Without this, one ordinary "Save" click with the field removed would have wiped a configured token and silently killed all notifications |

### 3.2 Secrets in logs — a leak path that was live

The token sits **inside the URL** (`api.telegram.org/bot<TOKEN>/…`). Several undici/fetch errors embed the full request URL in `error.message` and in stack traces. The old code did:

```ts
logger.error('telegram', 'sendTelegramAdmin failed', { err: e });   // ← token → logs
```

and the test endpoint returned `r.error` straight to the admin's browser, so a network-layer error could have carried the token into both the log stream and an HTTP response body.

**Fixed at two levels:**
1. `telegram.ts` — `scrub()` cleans every error string before it is returned or logged.
2. `logger.ts` — a redaction pass at the central choke point, so **any** scope is covered, not just Telegram. Patterns: Telegram tokens, `Bearer …`, and passwords in `postgres://user:pass@host` connection strings. It walks nested objects, arrays, error messages, and stacks.

> **A bug my own test caught.** My first redaction regex was `/\b\d{6,12}:[A-Za-z0-9_-]{20,}\b/`. It failed on precisely the case that matters most — `…/bot8801466881:AA…` — because the character before the digits is `t`, so both sides are word characters and **there is no word boundary there**. The bare-token test passed while the URL test failed, which is what exposed it. Now `(?<!\d)` instead of `\b`. Verified: the full token, and its secret half alone, appear nowhere in log output across four leak shapes.

### 3.3 Exposure checklist — all verified by test, not by inspection

| Surface | Result | How verified |
|---|---|---|
| **Browser / client code** | ✅ clean | Real admin login, fetched `/admin/site` (39,139 bytes) and 3 other admin pages; asserted neither the full token nor its secret half appears |
| **Public pages** | ✅ clean | `/`, `/track`, `/faq`, `/login` fetched and scanned |
| **API responses** | ✅ clean | Both `telegram-test` methods, authenticated and not; status endpoint returns only `username`, `configured`, `tokenSource` |
| **Logs** | ✅ clean | 4 injected leak shapes (error message, meta string, nested object, msg) — all redacted |
| **Git** | ✅ clean | `.gitignore` contains `.env`; the directory is not a git repo, so nothing is staged or committed. `.env.example` ships empty values |
| **Hardcoded** | ✅ none | The token appears in `.env` and `.env.bak-20260805` only — no source file |

### 3.4 Access control

`telegram-test` (both `POST` and new `GET`) calls `requireAdmin()` first — verified returning **401** unauthenticated. The bot itself has `can_read_all_group_messages: false` (privacy mode on), so it only sees messages addressed to it — correct for a notification-only bot.

---

## 4. Reliability review — timeout, retry, error handling

| Aspect | Before | Now |
|---|---|---|
| Timeout | 4 s via `AbortController` ✅ | 4 s, unchanged, now per attempt |
| Retry | **none** | 3 attempts with quadratic backoff (300 ms, 1.2 s) |
| Rate limits (429) | not handled | honours Telegram's `retry_after`, capped at 5 s |
| 5xx | not retried | retried |
| 4xx (bad token/chat) | — | **deliberately not retried** — the same request cannot succeed; retrying only adds latency. Verified: fails in **174 ms** |
| Throwing | never throws ✅ | unchanged — returns `{ ok, error }` |
| Blocking the request path | fire-and-forget ✅ | unchanged — `notifyAdmins` does not await it, so retries cannot delay an order response |
| Failure visibility | silent | now `logger.warn` on a failed send (scrubbed) |

The "never throws / never blocks the money flow" property was already correct and is preserved — retries were only safe to add *because* the call is fire-and-forget.

---

## 5. What was tested

**`scripts/telegram-integration-test.ts` — 26/26.** Env loading and format; `scrub()`; live `getMe` accept **and** reject-a-bogus-token; missing-config handling; live send to an invalid chat (`Bad Request: chat not found` — proves the request really goes out and the error path works); no-retry-on-4xx timing; route auth (401); public-page leak scan; logger redaction.

**`scripts/telegram-admin-leak-test.ts` — 11/11.** Logs in as the real seed admin via NextAuth credentials, then asserts the token is absent from the actual rendered admin HTML. This is the only way to prove §3.1 — reading the code cannot show what ends up in the RSC payload.

**`scripts/telegram-check.ts`** — operator diagnostic: env shape, `getMe`, webhook state, **chat_id discovery**, DB settings, and a final "can we send?" verdict.

All three are committed to `scripts/` and are re-runnable.

---

## 6. ⚠️ What is still needed — `chat_id`

**This is the only thing standing between the current state and working notifications.**

A token identifies the *bot*; `sendMessage` also needs a *destination*. Nothing in `.env`, the database, or Telegram's API currently supplies one, and `getUpdates` returns zero updates — the bot has never received a message.

**This cannot be automated.** A Telegram bot cannot start a conversation: the human must message it first, or add it to a group. That is a platform rule, not a limitation of this code. So the last step is yours:

1. Open Telegram and search for **@uidtopup1bot**.
2. Either **send it `/start` directly** (notifications go to your personal chat), **or** create a group, add **@uidtopup1bot** to it, and post any message (recommended — several staff can then see orders).
3. Run:
   ```
   npx tsx scripts/telegram-check.ts
   ```
   Section 4 will print the ready-to-paste line, e.g. `TELEGRAM_CHAT_ID="-1001234567890"`.
4. Put it in `.env`, restart the dev server, and click **টেলিগ্রাম টেস্ট করুন** in Admin → Settings (or re-run the check script).

**Not needed:** a webhook or polling. The app only ever *sends*; it never receives commands. `getWebhookInfo` confirms no webhook is set, which is correct — adding one would require a public HTTPS endpoint for no benefit. If you later want the bot to *respond* to commands, that is a new feature, not a configuration gap.

**Optional:** `site_url` is unset, so links inside Telegram messages will be relative rather than clickable. Set it in Admin → Settings to get clickable order links.

---

## 7. Files changed

| File | Change |
|---|---|
| `.env` | malformed multi-line token value collapsed to one line (backup: `.env.bak-20260805`) |
| `.env.example` | `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` documented with setup steps and the one-line warning |
| `src/lib/telegram.ts` | env-first config resolver, `scrub()`, retry/backoff, 429 handling, `validateTelegramToken()`, `getTelegramStatus()` |
| `src/lib/logger.ts` | central secret redaction (tokens, Bearer, DB passwords), deep-walks meta/errors/stacks |
| `src/app/api/admin/telegram-test/route.ts` | no longer accepts a token in the body; validates identity before sending; new `GET` status endpoint |
| `src/app/api/admin/settings/route.ts` | blank `telegram_bot_token` no longer overwrites a configured one |
| `src/app/admin/site/page.tsx` | token stripped from client props; passes a safe status object |
| `src/components/admin/SiteManager.tsx` | token input → read-only status panel; test button sends no token |
| `scripts/telegram-check.ts` | **new** — operator diagnostic incl. chat_id discovery |
| `scripts/telegram-integration-test.ts` | **new** — 26-check integration suite |
| `scripts/telegram-admin-leak-test.ts` | **new** — authenticated browser-leak proof |

---

## 8. Recommended improvements (not done)

1. **Rotate this token.** It sat in a file in plaintext and was read during this session. Rotation via @BotFather (`/revoke`) is free and takes a minute. Not done because it would immediately invalidate the token you just installed, and that is your call to time.
2. **Move `chat_id` to `.env` too**, not the admin UI — it is not secret, but keeping both halves in one place makes the config auditable.
3. **`waitUntil` for fire-and-forget sends.** On Vercel, work started but not awaited can be killed when the response is returned, so a Telegram send may be dropped under serverless. `notifyAdmins` has this shape today. Correct fix is `waitUntil(sendTelegramAdmin(...))` from `@vercel/functions`.
4. **Extend the secret scanner to `ADMIN_PASSWORD` / `NEXTAUTH_SECRET`.** The logger redacts token-shaped and URL-embedded credentials; arbitrary env secrets are not pattern-matchable and would need value-based matching.
5. **A queue for failed notifications.** Three retries over ~1.5 s covers a blip, not a multi-minute Telegram outage; those messages are lost. A `PENDING` row retried by cron would make delivery durable.
6. **`.env.bak-20260805` should be deleted** once you have confirmed the new value works — it contains the token and is not in `.gitignore` (only `.env` and `.env*.local` are, so a `.bak` file **would** be committed if this becomes a git repo).

---

## 9. Honest limitations

1. **No message has ever been delivered end-to-end**, because no `chat_id` exists. What is proven: the token authenticates (`getMe`), and a real `sendMessage` call reaches Telegram and is correctly rejected with `chat not found`. The transport, auth, error handling, and scrubbing are all exercised against the live API — only the final delivery hop is unverified, and it will stay that way until §6 is done.
2. **The 429 and 5xx retry branches are not covered by a live test.** Triggering them means getting Telegram to rate-limit or fail on demand. They are exercised by inspection only; the 4xx no-retry path *is* tested (174 ms).
3. **`.env.bak-20260805` contains the token in plaintext.** Deliberate — I do not delete a backup of a file I rewrote. See §8.6.
4. **The token appeared in this session's terminal output** during the initial `grep` that located it, before I knew where it lived. It is in the session transcript. This does not affect the codebase, but it is a further argument for §8.1.
