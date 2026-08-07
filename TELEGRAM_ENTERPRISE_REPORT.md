# TELEGRAM_ENTERPRISE_REPORT.md

**Scope:** Extend the existing Telegram production system with backup/restore, multi-bot management, a scheduler, message templates and delivery analytics — without redesigning what was already working.
**Date:** 2026-08-05
**Gates:** `tsc` ✅ · `next lint` ✅ (0 warnings) · clean `next build` ✅ (**87.3 kB shared JS — unchanged**) · `test:money` **18/18** ✅
**Tests:** enterprise **94/94** ✅ · Playwright **44/44** ✅ · production regression **71/71** ✅ · `.env`-independence **10/10** ✅

---

## 1. One premise was wrong, and it changes the framing

> *"Integrate Telegram with the existing Scheduler System."*

**There is no existing scheduler in this codebase.** I verified again this pass — no cron, no job runner, no scheduled task anywhere. My previous two reports said the same, which is why Daily/Weekly Summary shipped labelled "শিডিউলার দরকার."

So this is **a scheduler built from scratch**, not an integration. It works, all 16 jobs run, and those two summary events are now genuinely functional. But calling it "integration with the existing system" would misrepresent what was here — and would leave you expecting a scheduler elsewhere in the app that doesn't exist.

Everything else in the brief matched reality: the encryption, Integration Hub, in-app Notification Center, audit logs, theme system and admin permissions all existed and were reused rather than duplicated.

---

## 2. What was preserved

Nothing was redesigned. Concretely:

- **Config priority (DB-encrypted → `.env`)** — unchanged, and re-proven: with both Telegram vars removed from `.env`, a real message still delivered (10/10).
- **`secretbox.ts` encryption** — untouched.
- **Wizard, dashboard, connection status** — untouched; the dashboard gained tabs around it.
- **`sendTelegramAdmin()` signature** — unchanged. **No event call site was edited.** Multi-bot routing was added by having it delegate to a new `dispatch.ts`, so the routing rule lives in one place instead of being copied into every caller.
- **Production suite re-run: 71/71**, so the previous behaviour is intact.

Bot config also stayed in the encrypted `Setting.telegram_bots` JSON row. Only what genuinely needs a table moved to tables.

---

## 3. Schema — 4 new tables, additive only

`prisma migrate diff` before pushing showed **4 CREATE TABLEs and 1 foreign key, zero `ALTER` on existing tables, zero `DROP`**. Verified no drift first (`-- This is an empty migration.`), then pushed.

| Table | Why it can't be a JSON row |
|---|---|
| `TelegramMessageLog` | success rate, daily/weekly/monthly usage and per-bot breakdown all need aggregation |
| `TelegramJob` / `TelegramJobRun` | scheduling needs indexed `nextRunAt` queries and an append-only run history |
| `TelegramTemplate` | keyed lookups per send |

Message logs are pruned past 90 days, probabilistically (~2% of writes) — the same pattern the rate limiter already uses.

**Counters were deliberately not used.** Every number in the analytics tab is computed from the log, so "total" and "daily breakdown" can never disagree, and there is no read-modify-write race.

---

## 4. Multi-bot management

Five roles — Admin Alert · Customer · Marketing · Support · Monitoring. Each bot carries name, description, token (encrypted), chat ID, avatar, status, role, priority and its own event list.

Full CRUD verified live: **add, edit, delete, duplicate, test, activate, deactivate, drag-and-drop reorder.** Each bot row shows online status, messages sent, failures, success rate, average latency, last success and last error.

**Duplicate does not copy the token** — verified by test. Two "bots" sharing one token are the same bot with two destinations, and revoking that token would kill both. Duplication copies structure (role, events, priority); identity must be re-entered.

**Event routing:** an event fans out to *every* eligible bot, ordered by priority. A bot with an empty event list falls back to its role defaults, which is what keeps your existing single-bot config receiving everything. If no bot claims an event, the admin bot gets it — an event can't vanish silently. One bot failing doesn't stop the others.

---

## 5. Scheduler

16 jobs, **every one with a real handler** (verified: `all wired`). Handlers read real data — pending order counts, revenue sums, low-stock variants, expiring coupons, audit-log digests, DB health.

Two entry points into the same `tick()`:
- **in-process** `setInterval` every 30 s — enough for an EXE / VPS / `next start`
- **`POST /api/admin/telegram/scheduler/tick`** for serverless, guarded by `CRON_SECRET` bearer *or* an admin session (never open by default)

**Double-run is prevented by a conditional UPDATE claim**, not by hoping two ticks don't overlap: `WHERE status <> 'RUNNING' AND nextRunAt <= now`. The tick that wins the update owns the job.

Supported: date, time, timezone, recurring (once/hourly/daily/weekly/monthly), manual trigger, pause, resume, stop, retry-failed. Dashboard shows upcoming, running, completed, failed, execution history, last/next run and average duration.

Three decisions worth stating:
1. **All jobs default to disabled.** Installing should not silently start 16 automatic message streams.
2. **Timezone handling uses `Intl`, no date library.** DST-correct offsets without a new dependency. Verified: `DAILY 09:00 Asia/Dhaka` → `03:00Z`, and changing the timezone changes the result.
3. **MONTHLY caps at day 28.** Day 31 would mean the job never runs in February.

Handlers that find nothing to report **send nothing** and record "কিছু নেই — পাঠানো হয়নি". A reminder that fires with zero pending items trains you to ignore it. And `backup_status` reports honestly that no automatic backup is configured rather than claiming success.

---

## 6. Templates

7 customisable templates with `{{variable}}` support, live preview, click-to-insert variable chips, and reset-to-default.

**Variable values are escaped; template markup is not.** You may deliberately write `<b>`, but a customer name containing `<` must not break the message or inject markup — verified: `<script>x</script>` in a variable renders as text.

**Unknown `{{vars}}` are left visibly intact** rather than blanked, so a typo is obvious instead of producing a silently empty message.

Preview renders **server-side through the same `render()`** used for real sends, so what you see is what Telegram gets — not a second implementation that can drift.

---

## 7. Backup & restore

Export includes bot config, chat config, notification preferences, event rules, enabled status, scheduler config and multi-bot config. JSON.

**The secrets problem, solved properly.** Previously tokens were simply omitted: the DB ciphertext is useless elsewhere (different key) and plaintext export would make the file itself the leak. Now there's a third option — tokens sealed with an **admin-supplied passphrase** (scrypt N=2^15 + AES-256-GCM), independent of the installation key. Backups become genuinely portable while remaining unreadable without the passphrase. No passphrase ⇒ no tokens in the file.

Verified: correct passphrase round-trips; **wrong passphrase rejected**; **tampered payload rejected** (GCM); same input yields different ciphertext; and the sealed backup contains no plaintext token.

Import is **validate → preview → explicit confirm**:

| Check | Result |
|---|---|
| Schema validation | ✅ corrupted structure detected |
| **Version compatibility** | ✅ version 99 rejected with supported list |
| Foreign file | ✅ rejected |
| Bot token validation (deep mode) | ✅ live `getMe` per bot |
| Chat ID validation (deep mode) | ✅ live `getChat` per bot |
| Preview before importing | ✅ bots, roles, masked chat IDs, event/template/job counts |
| **Never overwrites without confirmation** | ✅ restore refused without `confirm:true` (HTTP 400) |

Without `replace: true`, existing bots are kept and new ones added. Replacing is a separate, explicitly-checked box that turns the button red.

---

## 8. Security

| Surface | Result |
|---|---|
| Page HTML (all 6 tabs visited, authenticated) | ✅ no token |
| **Client JS bundles** (scanned in-browser) | ✅ no token |
| All 10 new API endpoints | ✅ no token; **401 unauthenticated** |
| Analytics / logs | ✅ no token, errors scrubbed at write time |
| Backup file (with and without passphrase) | ✅ no plaintext token |
| Audit log | ✅ token values recorded as `<redacted>`; passphrases never logged |
| Passphrase inputs | ✅ `type="password"` |

Encryption is unchanged. Tokens are never returned by any endpoint — the bot edit form leaves the token field **blank**, and blank means "keep existing" rather than "delete", so an ordinary save can't destroy a working connection.

---

## 9. Quality & compatibility

**Accessibility audit (live DOM):** 0 unlabeled inputs, 0 unnamed buttons, 0 images without `alt`, tabs expose `role="tab"` + `aria-selected` inside a `role="tablist"`, 33 keyboard-focusable controls.

**Responsive audit:** 0 px horizontal overflow across bots / scheduler / backup tabs at 390, 768 and 1440.

**Themes:** dark and light both resolve (`#0a0b11` / `#f4f6fb`) and differ.

**Animations:** 21 running CSS animations, properties `transform, opacity` only — zero non-composited.

**Console:** clean.

**Compatibility preserved:** Integration Hub (Telegram still linked from it), in-app Notification Center (event switches gate Telegram only — in-app notifications always fire), audit logs (every mutation logged), theme system, `requireAdmin()` on every endpoint, and the existing design tokens throughout. No new runtime dependency was added — the daily-usage chart is CSS, and timezone maths uses `Intl`.

---

## 10. Verification summary

| Suite | Result |
|---|---|
| `telegram-enterprise-test.ts` | **94/94** — passphrase sealing, schedule maths, template rendering, auth on 10 endpoints, multi-bot CRUD, scheduler, templates, analytics, backup/restore |
| `telegram-enterprise-playwright.ts` | **44/44** — 6 tabs, panel contents, live preview typing, bundle scan, a11y, responsive ×3, themes, animations, console |
| `telegram-production-test.ts` | **71/71** — regression, previous system intact |
| `telegram-no-env-test.ts` | **10/10** — re-proven after the store rewrite |
| `test:money` | **18/18** |

### Test bugs found and fixed (mine, not the product's)
1. **Tab assertion checked for the absence of "লোড হচ্ছে…"** — but that string lives permanently in the global loading overlay's markup, so all 5 tabs "failed" while working correctly. Now asserts each tab's own content.
2. Login rate limiting (5/15 min) tripped repeatedly during automated runs; the Playwright script already fails loudly with the fix, which is how it was diagnosed in seconds this time.

---

## 11. Honest limitations

1. **The scheduler is new, not an integration** (§1). If you expected an existing scheduler to plug into, there isn't one.
2. **In-process ticking dies on serverless.** On Vercel the `setInterval` won't survive; you must call the tick endpoint from Vercel Cron with `CRON_SECRET` set. On an EXE/VPS it just works.
3. **Drag-and-drop is mouse/touch only.** There is no keyboard alternative for reordering priority yet — a real accessibility gap. Priority is still editable via the API, and the rest of the UI is keyboard-navigable.
4. **`fraud_report` uses one simple heuristic** (a user with 3+ pending deposits). It is a starting signal, not fraud detection.
5. **Analytics has no date-range picker** — fixed buckets (today / 7 / 30 / all) plus a 14-day chart.
6. **Message logs grow until pruned at 90 days.** At very high volume you may want a shorter retention or a rollup table.
7. **My restore test left duplicate bots** (it ran with `replace:false`, which is additive by design). I detected this and removed the three test-created bots; your original bot config is intact and was verified afterwards — 1 bot, token and chat present.
8. **More real Telegram messages were sent to your chat** during this pass (per-bot tests, scheduler runs, the no-env proof).
9. **Rate-limit buckets were truncated repeatedly** on the dev database to keep automated logins working. Dev state only.

---

## 12. Files

**New libs:** `telegram/{log,templates,scheduler,handlers,dispatch,backup}.ts`
**New routes:** `telegram/{bots,scheduler,scheduler/tick,templates,backup,analytics}`
**New UI:** `telegram/{BotsPanel,SchedulerPanel,TemplatesPanel,AnalyticsPanel,BackupPanel}.tsx`
**New tests:** `telegram-enterprise-test.ts`, `telegram-enterprise-playwright.ts`
**Changed:** `telegram/{index,store,events}.ts` (additive), `TelegramDashboard.tsx` (tabs added around the existing overview), `schema.prisma` (+4 models), `MANUAL_PRO.md` §27.
