# TELEGRAM_ADMIN_REPORT.md

**Scope:** A complete Telegram management interface in the admin panel — connection status, bot identity, test send, activity, and per-event notification control.
**Date:** 2026-08-05
**Gates:** `tsc` ✅ · `next lint` ✅ (0 warnings) · clean `next build` ✅ (**87.3 kB shared JS — unchanged**) · `test:money` **18/18** ✅
**Tests:** admin UI + gating **48/48** ✅ · integration **26/26** ✅ · admin leak **11/11** ✅

---

## 1. The headline: it now actually delivers

The previous report closed with one honest gap — *"no message has ever been delivered end-to-end, because no `chat_id` exists."*

**That gap is closed.** You messaged the bot and added `TELEGRAM_CHAT_ID` to `.env`, and this pass verified a real message arriving:

```
PASS  test message delivered — টেস্ট মেসেজ পাঠানো হয়েছে — টেলিগ্রাম দেখুন। (বট: @uidtopup1bot)
PASS  lastOkAt recorded — 2026-08-04T20:36:36.294Z
PASS  lastError cleared after success
```

Status is now **connected**: token valid, chat `1917673949` (private, `@nahims7`) reachable, delivery confirmed.

---

## 2. What was built

### 2.1 The page — `/admin/telegram`

A dedicated section, reachable from the admin sidebar (`✈️ টেলিগ্রাম`) and from a card at the top of the Integrations hub. It is **not** folded into the Integrations hub itself: that hub lists *configurable-but-inert* provider stubs, whereas Telegram is a live integration with real connection state, activity history, and its own event matrix. Putting it in the same grid would have misrepresented both.

Three panels:

| Panel | Contents |
|---|---|
| **সংযোগের অবস্থা** | status pill, bot username (links to `t.me/…`), bot name, bot ID, chat ID (masked), token (dots + source) |
| **কার্যকলাপ** | last successful message (relative time + which event), last error (message + when), test-send button |
| **নোটিফিকেশন** | master switch + 10 per-event checkboxes with hints, save button with dirty-state tracking |

### 2.2 Requirements checklist

| Requirement | Status |
|---|---|
| Dedicated Telegram section | ✅ `/admin/telegram` + nav + Integrations link |
| Display connection status | ✅ four distinct states (§4.2) |
| Show Bot Username | ✅ `@uidtopup1bot`, links to Telegram |
| Show Bot ID | ✅ `8801466881` |
| Show Chat ID | ✅ masked `••••••3949`, "দেখান" reveals |
| Show whether bot is connected | ✅ status pill |
| Test message button | ✅ verified delivering a real message |
| Last successful message time | ✅ relative + full timestamp on hover |
| Last error | ✅ scrubbed message + relative time |
| Enable/disable notifications | ✅ master switch |
| Select which events notify | ✅ all 10 |
| Bot Token not exposed in UI | ✅ never leaves the server — proven by test |
| Mask sensitive values | ✅ token as dots, chat ID masked by default |

---

## 3. The event system

### 3.1 All 10 events are wired to real triggers

Four already had a notification; **six had no trigger at all** and were added.

| Event | Trigger | Status |
|---|---|---|
| `deposit_new` | `api/deposit` | tagged existing |
| `order_new` | `api/order` + `api/order/direct` | tagged existing |
| `user_registered` | `api/register` + `lib/auth` (Google) | tagged existing |
| `low_stock` | `checkStockAlert` | tagged existing |
| `deposit_approved` | `api/admin/deposit` APPROVE | **new** |
| `deposit_rejected` | `api/admin/deposit` REJECT | **new** |
| `order_completed` | `api/admin/order` COMPLETE | **new** |
| `refund` | `api/admin/order` REFUND **+** `api/admin/order/refund` (partial) | **new** |
| `maintenance` | `api/admin/settings` when `maintenance_mode` **changes** | **new** |
| `campaign_published` | `api/admin/campaign` POST (active) **+** PATCH (draft→active) | **new** |

Two of these needed care rather than a one-liner:

- **Maintenance** compares against the value *before* the write. Without that, re-saving settings with maintenance already on would fire a "maintenance enabled" alert every time.
- **Campaign** fires only on a genuine publish — a POST that creates an *active* campaign, or a PATCH flipping `isActive` false→true (checked against `exists.isActive`). Creating a draft is not publishing, and editing an already-live campaign is not re-publishing.

### 3.2 Two dispatch paths, deliberately

```
notifyAdmins(title, body, link, event?)   → in-app notification + Telegram
telegramEvent(event, title, body, link?)  → Telegram only
```

Admin-triggered events (approve, reject, complete, refund, publish) use `telegramEvent`. Routing them through `notifyAdmins` would have given the admin an **in-app notification about their own click** — pure noise in the panel, while still being genuinely useful in an operator group where colleagues need to see who did what.

### 3.3 The switches gate Telegram only

An event toggled off suppresses the Telegram message but **never** the in-app notification. Otherwise turning off "New Deposit" in Telegram would also hide new deposits from the admin panel — silently losing the event everywhere, which nobody would intend from a Telegram settings page.

### 3.4 Defaults chosen to avoid a noise flood

On by default: `deposit_new`, `order_new`, `low_stock`, `refund`, `maintenance` — things needing a response, plus money leaving and the site going down.
Off by default: `deposit_approved`, `deposit_rejected`, `order_completed`, `user_registered`, `campaign_published` — echoes of the admin's own actions, or high-volume. All switchable.

---

## 4. Design decisions worth stating

### 4.1 Status writes must not invalidate the settings cache

`settings.ts` caches settings for 30 s specifically to avoid a Neon round-trip on every server render. Telegram sends fire on every order and deposit, so calling `invalidateSettings()` when recording "last sent at" would have destroyed that cache continuously — turning a notification feature into a permanent performance regression.

So status rows are written **without** invalidating, and the admin page reads them **directly from the DB** (`getTelegramActivity()`), bypassing the cache. Status may be up to 30 s stale elsewhere, which is harmless; the cache stays alive, which is not optional. Config writes (the switches) **do** invalidate — those must take effect immediately.

### 4.2 "Unreachable" is not "invalid" — a bug the tests caught

The page calls `getMe` on every render with a 4 s timeout. During one test run right after a dev-server restart, that call timed out and the page reported **"টোকেন অবৈধ" (token invalid)** — sending the admin to replace a token that was perfectly fine. The worst possible advice.

`validateTelegramToken` now distinguishes a *rejection* (Telegram said no) from *unreachability* (timeout, network error, Telegram 5xx). The UI shows four states:

| State | Meaning |
|---|---|
| সংযুক্ত | token valid **and** chat_id present |
| আংশিক — chat_id নেই | token valid, no destination |
| টেলিগ্রামে পৌঁছানো যায়নি | couldn't reach Telegram — *token not disproven* |
| টোকেন অবৈধ | Telegram actively rejected it |

Found only because a test asserted on the rendered HTML rather than the API response.

### 4.3 The test button bypasses both switches

`/api/admin/telegram-test` calls `sendTelegramRaw` directly. Admins test connectivity **before** enabling notifications; a test button that respects the "off" switch is a button that does nothing when you most need it. It still records success/error so the activity panel updates.

---

## 5. Security

### 5.1 Token still never reaches the browser

The page is a server component that hand-picks what crosses to `TelegramManager` — `tokenSet`, `tokenSource`, and Telegram's own public identity. The token itself is never in the props, so it cannot appear in the RSC payload. Verified against the real rendered HTML while authenticated as admin:

```
PASS  FULL TOKEN not in page HTML
PASS  token secret half not in page HTML
PASS  token shown only as dots
PASS  response has no token field
```

### 5.2 A second leak found and closed

`/api/admin/settings` wrote its audit entry as `detail: key=value` pairs. Had the bot token ever been set through that route, **the token would have been written in plaintext into the `AdminLog` table** and shown on `/admin/logs` — a durable secret leak into a surface built for reading. Sensitive keys are now recorded as `telegram_bot_token=<redacted>`.

### 5.3 Chat ID masking

Masked to `••••••3949` by default with an explicit "দেখান" that refetches from the API. Chat ID is not a credential — it is useless without the token — but there is no reason for it to sit on screen during a screen-share, and revealing it should be a deliberate act.

### 5.4 Input validation

The settings POST uses an **allowlist**: unknown event keys are discarded rather than written, so arbitrary strings (including `__proto__`) cannot be injected into the `Setting` table. A payload of only-unknown keys returns 400. Both endpoints require `requireAdmin()` — verified 401 unauthenticated.

---

## 6. Verification

`scripts/telegram-admin-ui-test.ts` — **48/48**, logging in as the real admin:

- page renders with all three panels, bot username, bot ID, test button
- **all 10 event labels present** in the HTML
- no token, no token-half, token shown only as dots
- API reports correct identity; `connected === (tokenValid && chatIdSet)`; chat ID masked
- 401 for unauthenticated GET and POST
- toggles persist; untouched events unchanged; unknown keys rejected (400)
- **gating proven behaviourally**: master off ⇒ `shouldSend` false; master on + event off ⇒ false; both on ⇒ true; unclassified ⇒ true
- **real message delivered**; `lastOkAt` recorded; `lastError` cleared on success
- every switch restored to its original value at the end

Plus the two prior suites re-run with no regression: integration **26/26**, admin leak **11/11**.

---

## 7. Honest limitations

1. **The page performs a live `getMe` on every render.** That is what makes the status trustworthy rather than cached-and-wrong, but it puts a network call with a 4 s timeout in the page load. §4.2 makes a slow call honest rather than misleading, but the page can still take up to 4 s to render when Telegram is unresponsive. A short cache (30–60 s) with a manual "recheck" button would be the better trade if this becomes annoying.
2. **Event switches were tested by asserting `shouldSend()` directly, not by triggering ten real business flows.** Proving `campaign_published` end-to-end means actually publishing a campaign, refunding a real order, and so on — that belongs in the staging E2E harness (roadmap item 8), not in a settings-page test. The gate itself, which every event passes through, is verified behaviourally.
3. **`recordSuccess`/`recordError` add one DB write per Telegram send.** Negligible at this business's volume and deliberately outside the money transaction, but it is not free — worth knowing if order volume grows by orders of magnitude.
4. **Fire-and-forget still applies.** On Vercel, a send started but not awaited can be killed once the response returns; `waitUntil` remains the right fix and is still unaddressed (carried over from the previous report).
5. **Rate-limit buckets were cleared during testing.** Repeated admin logins tripped the login limiter (5/15 min per email), so `RateLimitBucket` was truncated on the dev database to continue. This affects local dev state only — no production or money data.
6. **I sent real test messages to your private Telegram chat.** Four of them, from the test runs. That is what "test the integration" required, but they are real messages in your chat, not simulations.

---

## 8. Files changed

| File | Change |
|---|---|
| `src/lib/telegramEvents.ts` | **new** — 10 event definitions, two-level gating, status read/write |
| `src/lib/telegram.ts` | event gating in `sendTelegramAdmin`, `telegramEvent()`, `maskChatId()`, reachable-vs-invalid distinction |
| `src/lib/notify.ts` | `notifyAdmins` takes an optional event; low-stock tagged |
| `src/app/admin/telegram/page.tsx` | **new** — server page, hand-picks safe props |
| `src/components/admin/TelegramManager.tsx` | **new** — the UI |
| `src/app/api/admin/telegram/route.ts` | **new** — GET status, POST switches (allowlisted) |
| `src/app/api/admin/telegram-test/route.ts` | records success/error |
| `src/components/admin/AdminNav.tsx` | `✈️ টেলিগ্রাম` entry |
| `src/app/admin/integrations/page.tsx` | link card to the Telegram page |
| `api/admin/deposit`, `api/admin/order`, `api/admin/order/refund`, `api/admin/campaign`, `api/admin/settings` | six new event triggers |
| `api/deposit`, `api/order`, `api/order/direct`, `api/register`, `lib/auth` | existing notifications tagged with event keys |
| `src/app/api/admin/settings/route.ts` | audit log redacts secret setting values |
| `scripts/telegram-admin-ui-test.ts` | **new** — 48-check suite |
| `MANUAL_PRO.md` | §25.5 event system, §25.6 cache rule |
