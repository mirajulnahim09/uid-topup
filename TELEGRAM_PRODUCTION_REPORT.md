# TELEGRAM_PRODUCTION_REPORT.md

**Scope:** Redesign the Telegram module into a production system configurable entirely from the admin panel — no `.env` editing after install — with encrypted secrets, a connection wizard, a management dashboard, and multi-bot support.
**Date:** 2026-08-05
**Gates:** `tsc` ✅ · `next lint` ✅ (0 warnings) · clean `next build` ✅ (**87.3 kB shared JS — unchanged**) · `test:money` **18/18** ✅
**Tests:** production **71/71** ✅ · Playwright **42/42** ✅ · `.env`-independence **10/10** ✅

---

## 1. The headline claim, proven

The requirement was that the EXE build must be configurable without touching config files. That is not something to assert — so it was tested by actually removing it:

`scripts/telegram-no-env-test.ts` **refuses to run** unless `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are genuinely absent from `.env`. With both commented out and the dev server restarted:

```
PASS  TELEGRAM_BOT_TOKEN absent from .env — empty
PASS  TELEGRAM_CHAT_ID absent from .env — empty
PASS  config source is DB — db
PASS  bot token present (from encrypted DB)
PASS  connection is live
PASS  bot identity resolved — uidtopup1bot
PASS  TEST MESSAGE SENT WITHOUT .env — টেস্ট মেসেজ সফলভাবে পৌঁছেছে
PASS  delivery timing reported — 379ms
10/10 passed
```

A real Telegram message was delivered with no Telegram configuration in `.env` at all. `.env` was restored afterwards (it is now an unused fallback — those two lines can be deleted whenever you like).

---

## 2. Configuration priority — reversed

```
Priority 1  Encrypted database settings   ← admin panel writes here
Priority 2  Environment variables (.env)  ← first install / dev only
```

If **any** bot exists in the DB, `.env` is ignored **entirely** — not merged. Merging would make "which token is actually live" unanswerable, which is exactly the confusion this system exists to remove.

This inverts what the previous round built (env-first), and the inversion is the point: env-first is right for a server you control, DB-first is right for software you ship to someone else.

`scripts/telegram-check.ts` and the dashboard both display the active source (`🗄️ ডাটাবেস (এনক্রিপ্টেড)` vs `📄 .env ফাইল`), and when the source is still `.env` the dashboard offers a one-click **"🔐 ডাটাবেসে নিয়ে আসুন"** that encrypts the existing value into the DB.

---

## 3. Encryption at rest

`src/lib/secretbox.ts` — **AES-256-GCM**, key derived by **HKDF-SHA256** from `TELEGRAM_ENC_KEY` (or `NEXTAUTH_SECRET`), domain-separated so session signing and secret encryption never share key material. Format `v1.<iv>.<tag>.<ciphertext>`, random IV per operation.

Verified behaviourally, not by inspection:

| Property | Result |
|---|---|
| Ciphertext never contains the plaintext | ✅ |
| Round-trip returns the original | ✅ |
| Same input → different ciphertext (random IV) | ✅ |
| **Tampered ciphertext is rejected** (GCM auth tag) | ✅ |
| Malformed input fails cleanly, no partial output | ✅ |
| **DB row contains `v1.` ciphertext, not the token** | ✅ (queried the real row) |

**Why GCM and not CBC:** GCM is authenticated. A modified ciphertext *fails* rather than silently decrypting to garbage — which for configuration data is the difference between a visible error and a bot quietly sending nowhere.

**Failure is non-fatal by design.** If the key changes, decryption fails and the bot reports "token missing" so the UI asks you to re-enter it. It does not throw into the notification path — a rotated `NEXTAUTH_SECRET` must not be able to take the site down.

### Honest limit (stated plainly)
The key comes from the environment. This defeats **database-only** compromise — backups, dumps, SQL injection, a leaked read-replica — which is the realistic threat for this app. It does **not** defeat an attacker who holds both the environment and the database. Genuinely separating them needs a KMS/HSM, which is not available to a desktop EXE. Encryption here is a real control with a real boundary, not a claim of absolute safety.

---

## 4. Connection Wizard — 6 steps

Auto-opens at `/admin/telegram` when unconfigured (`TelegramGate`); also reachable any time via **🧙 Connection Wizard** on the dashboard. "পরে করব" dismisses it — the admin is never trapped.

| Step | Contents | Gate |
|---|---|---|
| **1 Welcome** | what it does, what's needed, **~২ মিনিট** estimate | — |
| **2 Bot Token** | paste-with-auto-trim, format validation, invalid-character detection, `getMe` verification showing name / username / **bot ID** / profile photo | **cannot advance until verified** |
| **3 Chat ID** | instructions for private / group / supergroup / channel, `getChat` verification showing chat name, type, ID, status | cannot advance until verified |
| **4 Test** | saves config then sends the exact required message; reports delivery time, response time, total time, attempts, API status | cannot advance until delivered |
| **5 Preferences** | all 16 events, grouped | — |
| **6 Finish** | success animation, **Finish** + **Go to Telegram Dashboard** | — |

**Paste handling:** the paste event is intercepted and trimmed of whitespace/newlines. The previous round found a token broken by exactly this (a `\n` inside a quoted `.env` value), and BotFather copy-paste reproduces it constantly. Format errors name the actual problem — "টোকেনে newline/tab আছে", "কোলনের আগের অংশ শুধু সংখ্যা হওয়ার কথা" — rather than bouncing an opaque `Unauthorized` back.

**Step 4 saves before testing.** Testing the typed values would prove nothing about what was stored; testing the *saved* config proves the thing you actually care about.

---

## 5. Dashboard

Every required field is present: connection status, bot name, bot username, bot ID, **masked token**, **masked chat ID**, profile picture, last successful message, last failed message, last API response, last connection check, API latency, total sent, failed, retry count.

Management actions: **Edit token / chat** (via wizard), **Reconnect**, **Disconnect**, **Reset**, **Send Test**, **Enable**, **Disable**, **Export**, **Import**, plus **adopt-env**.

Two distinctions the UI makes deliberately:

- **Disconnect ≠ Reset.** Disconnect stops sending and keeps the config; Reset erases tokens, chat, preferences and stats and asks for confirmation first.
- **"Unreachable" ≠ "invalid token."** A network timeout is reported as `টেলিগ্রামে পৌঁছানো যায়নি` with an explicit note that the token was *not* disproven. Telling an admin their working token is invalid is the worst advice this page could give — a bug caught by test in the previous round, preserved here.

---

## 6. Events — 15 requested, 16 shipped

All 15 requested events exist and are wired to real triggers. **`user_registered` from the previous round was kept** — it was already working, and silently deleting a live feature isn't implied by a list that happens to omit it. Hence 16.

| Event | Trigger |
|---|---|
| New Deposit | `api/deposit` |
| Deposit Approved / Rejected | `api/admin/deposit` |
| **Wallet Credit** | `api/admin/user` (balance adjust) — **new** |
| New Order | `api/order` + `api/order/direct` |
| Order Completed | `api/admin/order` |
| Refund | `api/admin/order` + `api/admin/order/refund` |
| **Coupon** | `api/admin/coupon` — **new** |
| Campaign | `api/admin/campaign` (create-active + draft→active) |
| Maintenance | `api/admin/settings` (only on actual change) |
| Low Stock | `checkStockAlert` |
| **Server Warning** | `guard.ts` catch-all on unexpected 500s — **new** |
| **Security Alert** | `auth.ts` Google account-reclaim — **new** |
| New Registration | `api/register` + Google signup |
| **Daily / Weekly Summary** | ⚠️ **not wired — needs a scheduler** |

**Server Warning is throttled to one message per 10 minutes.** A broken endpoint can 500 hundreds of times a second; without the throttle the operator group would be flooded and Telegram would rate-limit us. The throttle is in-memory deliberately — a DB-backed one would need a write on every 500, and the most likely cause of a 500 is the database being down.

**Daily/Weekly Summary are labelled "শিডিউলার দরকার" in the UI.** The switches and send path exist; nothing calls them, because this app has no cron. Shipping them as if they worked would be a lie told by a checkbox.

---

## 7. Multi-bot / future-ready

Bots carry a **role** — `admin`, `customer`, `marketing`, `support`. Business code calls `getBotForRole(role)` and never names a bot, so switching bots is configuration only. Unset roles fall back to the admin bot, so adding a role can't silently swallow its notifications.

**Storage decision, stated honestly:** bots live in one JSON `Setting` row, not a dedicated table. A table is cleaner engineering, but this project uses `prisma db push` with no versioned migrations, and altering a live production schema was not a risk worth taking for this feature. Every read and write is confined to `store.ts`, so moving to a table later changes one file and no call sites.

---

## 8. Security

### 8.1 Token never reaches the browser — verified three ways
| Surface | Result |
|---|---|
| Rendered page HTML (authenticated admin) | ✅ absent |
| **Client JS bundles** (10 scripts fetched and scanned in-browser) | ✅ absent |
| Every API response (`/telegram`, `/verify`, `/connect`, `/manage`, `/config`) | ✅ absent |
| Public pages, `/admin`, `/admin/site`, `/admin/integrations` | ✅ absent |
| Logs | ✅ redacted at the logger choke point |
| Git | ✅ `.gitignore` covers `.env`; no token in any source file |

The wizard's token input is the one place a token exists client-side — the admin typed it. It is cleared from state as soon as it is saved, and the server never sends one back, so a refresh leaves nothing behind.

**Profile photos are returned as data: URIs.** Telegram's file URLs embed the token (`/file/bot<TOKEN>/…`); linking one directly would have leaked the token into an `<img src>`. The image is fetched server-side and inlined instead — a security decision, not a convenience one.

### 8.2 Masking
Token displays as `8801466881:••••••••••••` (bot ID kept — it is public, and it lets an admin confirm *which* bot without revealing the secret). Chat ID as `••••••3949`.

### 8.3 Input validation
Both preference and import endpoints use an **allowlist**; unknown keys (including `__proto__`) are discarded, never written. Unknown management actions return 400. All seven endpoints verified returning **401** unauthenticated.

### 8.4 Export omits secrets
Export deliberately excludes the token. The stored ciphertext is useless elsewhere (different key), and exporting plaintext would make the config file itself the leak — files get emailed, synced and shared where our encryption has no reach. Verified: the export contains neither the token nor its secret half.

---

## 9. UI / UX

Wizard animations are **transform/opacity only** — verified in-browser: **27 running CSS animations, properties `transform, opacity`**, zero non-composited. Step transitions (directional slide), progress ring pulse, success burst, error shake, orbit loader, button light-sweep, card rise.

`prefers-reduced-motion` needs no special handling — `globals.css` already zeroes every animation globally.

**Responsive:** 0 px horizontal overflow at 390 / 768 / 1440.
**Themes:** verified both palettes resolve and differ (`dark #0a0b11/#eef1f6` vs `light #f4f6fb/#0f1729`), cards paint correctly in both.
**Console:** clean.

---

## 10. Verification summary

| Suite | Result |
|---|---|
| `telegram-production-test.ts` | **71/71** — encryption, masking, auth on 7 endpoints, wizard verification, DB-first priority, real DB ciphertext inspection, management actions, export/import, leak checks |
| `telegram-playwright.ts` | **42/42** — live Chrome: dashboard, wizard flow with real API waits, bundle scan, responsive ×3, themes ×2, animation audit, console |
| `telegram-no-env-test.ts` | **10/10** — the `.env`-independence proof |
| `test:money` | **18/18** |
| tsc / lint / build | ✅ / ✅ / ✅ (87.3 kB shared JS, unchanged) |

### Two test bugs found and fixed during the run
1. **Fixed sleeps in Playwright.** `waitForTimeout(1200)` wasn't enough for Next's first-hit route compile in dev, so four wizard assertions failed while the feature worked perfectly. Replaced with `waitForResponse` on the actual verify call.
2. **Two wrong assertions.** I asserted `.card` has a `backgroundColor` — it paints a *gradient*, so transparent is correct; and I counted theme colour **transitions** as continuous animations. Both were my tests being wrong, not the code. The theme check now compares resolved palettes across themes, which is what actually needed testing.

A third confusion cost time: repeated automated logins tripped the login rate limit (5/15 min), so `/admin/*` silently redirected to `/login` and *every* content assertion failed at once, looking like a broken UI. The Playwright script now verifies the session and **fails loudly** with the fix.

---

## 11. Honest limitations

1. **Daily/Weekly Summary are not functional** — no scheduler exists in this app. Switches and send path are ready; nothing invokes them. Marked "শিডিউলার দরকার" in the UI rather than shipped as working.
2. **Encryption key lives in env** (§3). Defeats DB compromise, not full-host compromise.
3. **Multi-bot is architecturally complete but single-bot in the UI.** Roles, storage, fallback and `getBotForRole()` all work and are exercised; the wizard only creates the `admin` bot. Adding a second bot today means an API call. A role picker is a UI addition, not an architecture change — which was the actual requirement.
4. **Bots are a JSON Setting row, not a table** (§7) — deliberate, contained to one file.
5. **`waitUntil` for fire-and-forget sends is still unaddressed.** On Vercel, work started but not awaited can be killed once the response returns. Carried over from the previous report; unchanged here.
6. **Rate-limit buckets were truncated repeatedly** on the dev database to keep automated logins working. Dev state only — no production or money data touched.
7. **More real test messages were sent to your Telegram** during this pass. They are genuine messages in your chat.
8. **`.env` still contains the Telegram values.** I restored them after the independence test rather than deleting your configuration. They are now an ignored fallback and can be removed whenever you want.

---

## 12. Files

**New:** `src/lib/secretbox.ts` · `src/lib/telegram/{index,store,api,events,stats}.ts` · `src/app/api/admin/telegram/{verify,connect,manage,config}/route.ts` · `src/components/admin/telegram/{ConnectionWizard,TelegramDashboard,TelegramGate}.tsx` · `scripts/telegram-{production-test,playwright,no-env-test}.ts`

**Replaced:** `src/lib/telegram.ts` + `src/lib/telegramEvents.ts` → the `telegram/` package (all `@/lib/telegram` imports still resolve).

**Changed:** `guard.ts` (server-warning hook) · `logger.ts` · `notify.ts` · `admin/site` + `SiteManager` (Telegram config moved out — one source of truth) · `globals.css` (wizard animations) · event triggers in `admin/{user,coupon,deposit,order,order/refund,campaign,settings}` · `auth.ts` · `MANUAL_PRO.md` §26.
