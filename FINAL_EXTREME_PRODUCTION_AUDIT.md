# UID TOPUP — EXTREME RED-TEAM PRODUCTION AUDIT + AUTO-FIX (রাউন্ড ২)
**তারিখ:** ২০২৬-০৯-২১ · **ব্রাঞ্চ:** `master` · **HEAD:** `a4959d7` · **কমিট/পুশ/ট্যাগ করা হয়নি**
**আগের রাউন্ড:** `FINAL_EXTREME_PRODUCTION_AUDIT_2026-09-19.md` (সংরক্ষিত — I-01…I-11 সেখানে)

> আগের কোনো PASS এখানে প্রমাণ হিসেবে ধরা হয়নি — প্রতিটি স্যুট এই রাউন্ডে নতুন বিল্ডে আবার চালানো হয়েছে।
> প্রতিটি নতুন ত্রুটি **পুনরুৎপাদন → মূল কারণ → ফিক্স → লক্ষ্যভিত্তিক টেস্ট (ফিক্স ছাড়া লাল, ফিক্সসহ সবুজ)
> → রিগ্রেশন** ধাপে গেছে। ইস্যু-নম্বর আগের রাউন্ড থেকে চলমান (I-12 থেকে)।
> কোনো সিক্রেটের মান এই ফাইলে নেই — env-এর কেবল **নাম**। যা যাচাই করা যায়নি তা স্পষ্ট করে **NOT VERIFIED**।

---

## ১. Executive Summary

তিনটি আগের অডিট (৩৭১টি টেস্ট, ৪৩টি যাচাই-স্যুট, ১০০ একসাথে লোড) সবুজ থাকা অবস্থাতেই এই রাউন্ডে
**৭টি নতুন প্রোডাক্ট-ত্রুটি** ও **১টি ফাঁপা-সবুজ যাচাই** পাওয়া গেছে — সবগুলো রানটাইমে পুনরুৎপাদিত, সারানো
ও যাচাই করা। তিনটি ছিল আগের প্রতিটি স্যুটের চোখ এড়িয়ে যাওয়া **সমান্তরালতা/টাকার** ত্রুটি।

| # | মাত্রা | সমস্যা | মাপা প্রমাণ (ফিক্সের আগে) | অবস্থা |
|---|---|---|---|---|
| I-12 | **MEDIUM** | অ্যাডমিন অর্ডার-বাতিল (রিফান্ড) ও একই গ্রাহকের নতুন অর্ডার একসাথে → Postgres **deadlock** | ৭২টি অনুরোধে **৫০টি HTTP ৫০০** (`40P01`) | FIXED |
| I-13 | **MEDIUM** (নিরাপত্তা) | Google "reclaim"-এর পরেও আক্রমণকারীর আগের সেশন বৈধ থাকত | reclaim-এর পরে পুরনো সেশনে `/api/me` → **২০০** | FIXED |
| I-14 | **MEDIUM** (টাকা) | অ্যাডমিন ব্যালেন্স-সমন্বয়ে ৩-দশমিকের অঙ্ক → **খতিয়ান ≠ ব্যালেন্স** | −০.১২৫ কাটলে ব্যালেন্স ৳9.88, খতিয়ান-যোগফল ৳9.87 | FIXED |
| I-15 | LOW | ডেলিভারি "পেয়েছি" + "পাইনি" একসাথে → দুটোই গৃহীত | ৬ রাউন্ডে ৩ বার দুটো তারিখই বসেছে | FIXED |
| I-16 | LOW | টিকিট বন্ধ ও অ্যাডমিন-উত্তর একসাথে → বন্ধ টিকিট আবার খোলে | in-process ২০০ বারে **১১৮** বার | FIXED |
| I-17 | LOW | পুরো-ছাড়ের কুপন: প্রিভিউ "৳0.00", অর্ডারে ভেতরের বার্তা | প্রিভিউ ২০০, অর্ডার ৪০০ "অঙ্ক শূন্যের বেশি হতে হবে" | FIXED (+ সিদ্ধান্ত বাকি) |
| I-18 | LOW | টেলিগ্রাম সারাংশ/কুপন-মেয়াদের তারিখ-সময় সার্ভারের UTC ঘড়িতে | ঢাকার ২২/৯ ৩:৩০ AM দেখাত "২১/৯ ৯:৩০ PM" | FIXED |
| H-4 | হারনেস | `semantic-tokens`-এর ৩টি regex-এ `\b`-এর জায়গায় **আসল backspace বাইট** — ২০২৬-০৯-০১ থেকে কখনো কিছু মেলায়নি | বাইট-স্ক্যান | FIXED |

নথিভুক্ত, সারানো হয়নি (কারণসহ, §৪১): I-19 `x-request-id` যাচাইহীন প্রতিফলন (LOW — `middleware.ts`, মালিকের অনুমোদন
লাগে) · I-20 `2fa-check`-এর আলাদা বাকেট = 2FA-অ্যাকাউন্টে দ্বিগুণ পাসওয়ার্ড-অনুমান (LOW — **DECISION REQUIRED**)।

**কোড-স্তরের সব গেট সবুজ** (§৪৪)। **সিদ্ধান্ত: NO-GO** — কোডের কারণে নয়; আগের রাউন্ডের বাইরের ব্লকার
(লাইভ অ্যাডমিন-পাসওয়ার্ড, ইমেইল/OTP, Blob, লাইভ DB-তে ২টি মাইগ্রেশন, Next.js CRITICAL advisory) এই রাউন্ডে
যাচাই করা **সম্ভব হয়নি** — লাইভ সিস্টেমে প্রবেশ মালিকের অনুমতি ছাড়া করা হয়নি (§৪২)।

---

## ২. Baseline

| | |
|---|---|
| Git | `master` · HEAD `a4959d7` · শুরুতে `git status` ১৫৪ সারি (আগের তিন অডিটের অকমিটেড কাজ) |
| রানটাইম | Node **v24.15.0** · npm 11.12.1 (লোকাল) · CI Node 20 · `engines` নির্দিষ্ট নেই |
| মূল নির্ভরতা | next **14.2.35** · react/react-dom 18.3.1 · prisma/@prisma/client 5.22.0 · next-auth 4.24.15 · zod 3.25.76 · bcryptjs 2.4.3 · @vercel/blob 2.6.1 · resend 4.8.0 · framer-motion 11.18.2 · qrcode 1.5.4 |
| আকার | ৩৫৭ TS/TSX · ৪৬ পাতা · **৮০ API রুট** · ০ server action · ৩৩ Prisma মডেল · ১৪ মাইগ্রেশন · ৩৬→**৩৯** Vitest ফাইল · ৪৯→**৫০** যাচাই-স্যুট |
| Env (শুধু নাম) | `.env`: DATABASE_URL · NEXTAUTH_SECRET · NEXTAUTH_URL · GOOGLE_CLIENT_ID · GOOGLE_CLIENT_SECRET · BLOB_READ_WRITE_TOKEN · RESEND_API_KEY · EMAIL_FROM · TELEGRAM_BOT_TOKEN · TELEGRAM_CHAT_ID · ADMIN_EMAIL · ADMIN_PASSWORD · CRON_SECRET · FF_LOOKUP_API_KEY · TELEGRAM_ENC_KEY · STORAGE_DRIVER · `.env.development`: DATABASE_URL · RESEND_API_KEY · TELEGRAM_BOT_TOKEN · TELEGRAM_CHAT_ID · BLOB_READ_WRITE_TOKEN · STORAGE_DRIVER · `.env.example`-এ আরও: SENTRY_DSN · NEXT_PUBLIC_SITE_URL · TRUSTED_PROXY · STREAM_ENABLED |
| পরিকাঠামো | Docker dev DB `localhost:5434` · test DB `localhost:5433` · prod rig = `next build` + `next start :3100` + TLS প্রক্সি `https://localhost:3443` |
| সিক্রেট-স্ক্যান | git-এ ট্র্যাক করা env কেবল `.env.example` · `.gitignore` → `.env*` (example বাদে) · git-ইতিহাসে সিক্রেট-আকৃতির ৫টি মিল — ৪টি টেস্ট-স্ক্রিপ্টের ভুয়া `123456789:AA…` টোকেন; ১টি `.env.example`-এর "মান দেখতে এমন" উদাহরণ-লাইন (**NOT VERIFIED** — এই মেশিনের অনুমতি-নিয়ম `.env*` পড়া নিষেধ করে) · কার্যকর গাছে (env ফাইল বাদে) ০ · `release/*.zip`-এ কেবল `.env.example` · প্রোডাকশন ক্লায়েন্ট-বান্ডলে (`.next/static`, ১১৬ ফাইল) সিক্রেট-আকৃতি ০; ৩টি env-**নাম** কেবল অ্যাডমিন-টেলিগ্রাম পাতার নির্দেশনা-লেখায় |
| আগের প্রমাণ | `FINAL_EXTREME_PRODUCTION_AUDIT_2026-09-19.md` · `FINAL_PRODUCTION_GRADE_AUDIT.md` · `FINAL_PRODUCTION_AUDIT.md` · `FINAL_AUDIT_REPORT_2026-09-17.md` · `audit/*.json` |

---

## ৩. Architecture

টাকা কেবল `services/wallet.ts` দিয়ে (`creditWallet`/`debitWallet` — একই `$transaction`-এ `LedgerEntry`)।
লক-ক্রম variant → coupon → user (`FOR UPDATE`)। **এই রাউন্ডে পাওয়া ব্যতিক্রম:** অ্যাডমিন অর্ডার-বাতিল পথ
User আগে লক করত (I-12)। অথ: NextAuth v4 JWT + `sessionEpoch` (প্রতি API অনুরোধে যাচাই)। নির্ধারিত কাজ:
GitHub Actions → ৩টি `/api/cron/*` (constant-time `assertCronAuth`; `vercel.json` নেই — ইচ্ছাকৃত)।
পেমেন্ট-গেটওয়ে সব স্টাব; চালু পথ ম্যানুয়াল bKash/Nagad (TrxID → অ্যাডমিন অনুমোদন)। টেলিগ্রাম কেবল
বিজ্ঞপ্তি পাঠায় — কোনো টাকা বা অবস্থা বদলায় না (কোড-পাঠে যাচাই)।

---

## ৪. Dependency Audit

`npm audit --omit=dev`: **critical ১ (`next`)**, high/moderate/low ০। `next` 9.5.0–15.5.23-এর ২৩টি advisory,
যার মধ্যে দুটি CRITICAL: GHSA-2xp9-vwfh-vxw4 (AVIF থাকলে Image-Optimizer RCE — **প্রশমিত**: `formats: ['image/webp']`,
`next.config.js`-এ যাচাই) ও GHSA-p293-qw3h-jr36 (উইন্ডোজ-হোস্টে RCE — Vercel Linux-এ অপ্রযোজ্য, লোকাল রিগে প্রযোজ্য)।
বাকিগুলো (CSP-nonce XSS GHSA-ffhc-5mcf-pf4q, SSRF, DoS, cache poisoning) **খোলা**। ফিক্স কেবল major
(`next@16.3.5` / ≥15.5.24) → মালিকের সিদ্ধান্ত (R-1, অপরিবর্তিত)।
পুরো গাছে ৯টি (critical ২ · high ৪ · moderate ৩) — `vitest`/`vite`/`esbuild`/`@vitest/mocker`/`vite-node`
(কেবল টেস্ট), `eslint-config-next`/`@next/eslint-plugin-next`/`glob` (কেবল lint) — প্রোডাকশন রানটাইমে নেই; সব ফিক্স major।
`npm outdated`: ঝুঁকিহীন minor (`@vercel/blob` 2.8, `postcss` 8.5.28) — কোনো advisory নেই বলে বদলানো হয়নি।

---

## ৫. Source Code Audit

পুরো `src`-এ প্যাটার্ন-সুইপ: `dangerouslySetInnerHTML` ৪টি (থিম-স্ক্রিপ্ট স্থির · লিগ্যাল-পাতা আগে escape করে ·
2FA QR সার্ভার-জেনারেটেড SVG · টেলিগ্রাম-টেমপ্লেট প্রিভিউ কেবল অ্যাডমিনের লেখা, nonce-CSP ইনলাইন হ্যান্ডলার আটকায়) ·
`eval`/`new Function`/`innerHTML=`/`document.write` ০ · `console.log` ০ · `$queryRawUnsafe` কেবল স্ক্রিপ্টে
(স্থির SQL, সবগুলো `_guard-live-db`/ডেভ-পিনের পেছনে — `no-live-writes` ১৫/১৫) · সব `$queryRaw` প্যারামিটারাইজড।
টাকার প্রতিটি কল-সাইট (`creditWallet`/`debitWallet` ১০টি) হাতে পড়া; লক-ক্রম বিশ্লেষণে I-12 ধরা পড়ে।
**বাইট-স্ক্যান** (নতুন): `src`/`scripts`/`tests`-এ ট্যাব/CR/LF ছাড়া নিয়ন্ত্রণ-বাইট — ৩টি ফাইল (H-4)।

---

## ৬. Authentication

`prod-auth-e2e` **৫৮/৫৮** · `red-team-auth` **২২/২২** · `auth-ui-edges` **১৫/১৫** · `ban-revocation` **১৪/১৪** ·
`ratelimit-failclosed` **২২/২২** · `ip-spoofing` **৮/৮** · Vitest `session-revocation` ৫/৫ · `auth-boundary` ৬/৬।
কোড-পাঠ: OTP `randomInt` + bcrypt-হ্যাশ + `FOR UPDATE` + ৫ চেষ্টা + একটিই সক্রিয় কোড ✓ · রিসেট-টোকেন HMAC(পাসওয়ার্ড-হ্যাশসহ)
+ compare-and-set + `sessionEpoch++` ✓ · লগইন timing-সমতা (ডামি bcrypt) ✓ · 2FA recovery-কোড row-lock ✓।
**I-13** এখানে ধরা পড়ে (Google reclaim)। **I-20** (নথিভুক্ত): `2fa-check` পাসওয়ার্ড যাচাই করে কিন্তু লগইনের বাকেট নয়।

---

## ৭. Authorization

`api-auth-matrix` **২১০/২১০** (৭৯ রুট × ১২৪ মেথড-সমন্বয়, anon/customer/admin) · `route-guard-audit`: ৮০ রুট, **অরক্ষিত ০** ·
IDOR: অর্ডার-নিশ্চিতকরণ/রিভিউ/টিকিট/বিজ্ঞপ্তি/ট্র্যাক — সব মালিকানা-শর্ত কোয়েরিতেই (`userId`), অন্যের ID → ৪০৪ ·
রিসেলার API: SHA-256 কী-হ্যাশ, revoke/ban/tier যাচাই।

---

## ৮. API Security

`security-probes` **২২/২২** · সব `/api/*` উত্তরে `Cache-Control: no-store` · রেট-লিমিটহীন লেখা-রুট কেবল ৫টি, প্রতিটি
স্বভাবতই সীমিত (অর্ডার-প্রতি একবার: confirm/review · কেবল পড়ে: login-status · নিজের বিজ্ঞপ্তি · গেটওয়ে webhook) ·
**I-19:** `x-request-id` ক্লায়েন্টের মান হুবহু ফেরত (৬০০০ অক্ষর পর্যন্ত মাপা) — XSS নয় (হেডার), লগ-দূষণ/Ref-জাল।

---

## ৯. Input Validation

`input-fuzz` **৭২৪টি বিকৃত অনুরোধ**, ৯/৯ দাবি (৫xx ০ · তথ্য-ফাঁস ০ · ইংরেজি বার্তা ০) · `malformed-requests` **৯৯০** অনুরোধে ৫০০ = ০ ·
**I-14** — অ্যাডমিন-সমন্বয়ের `amount`-এ দশমিকের সীমা ছিল না (এখন সর্বোচ্চ ২, বাংলা বার্তায় ৪০০)।

---

## ১০. Order Integrity

`order-price-lock` **১৪/১৪** (দাম লক করা রো থেকে) · `business-flow-e2e` **৩০/৩০** · `double-submit` **১৬/১৬** ·
`race-redteam` (নতুন) **১২/১২** রিগে, **১২/১২** ডেভে (২০ রাউন্ড: ১২০ রিফান্ড + ১২০ নতুন অর্ডার একসাথে → ৫xx ০,
স্টক = শুরু − চালু) · `resilience`-এ উত্তর হারানোর পর একই `clientRef`-এ আবার চাপা → দ্বিতীয় অর্ডার/কাটা ০ ·
**I-17** পুরো-ছাড়ের কুপন।

---

## ১১. Money Integrity

`money-invariants` **১৮/১৮** (ডেভ DB — `DATABASE_URL` স্পষ্টভাবে লোকাল দিয়ে; স্ক্রিপ্টটি নিজে থেকে `.env`-এর **লাইভ** DB ধরে,
তাই সেভাবে চালানো হয়নি) · Vitest `ledger-invariant` ৫/৫ · নতুন `money-precision` ২/২ ·
**I-14**: Postgres `numeric(12,2)` বাড়তি দশমিক "half away from zero" গোল করে **দুই জায়গায় আলাদাভাবে** — ব্যালেন্সে যোগফলের
উপর, খতিয়ানে অঙ্কের উপর। বিশ্লেষণ: অমিল কেবল **কর্তনে** ও কেবল **ঠিক আধা-পয়সার** মানে (যেমন .১২৫, .০০৫); যোগে দুই দিক একই
দিকে গোল হয়। অর্ডার/প্রত্যাহার/ডাইরেক্ট-পে কর্তন আগেই ২-দশমিক (`round2`/Decimal) — একমাত্র খোলা পথ ছিল অ্যাডমিন-সমন্বয়।

---

## ১২. Database Integrity

খালি স্ক্র্যাচ DB-তে `prisma migrate deploy` → **১৪/১৪ প্রয়োগ**, `migrate diff` → **drift নেই**, CHECK constraint **৮টি** ·
dev DB migrate-status: পরিষ্কার · লাইভ Neon: **NOT VERIFIED** (read-only পাঠও মালিকের অনুমতি ছাড়া করা হয়নি; আগের রাউন্ডে ২টি বাকি ছিল)।
এই রাউন্ডের কোনো ফিক্সে **নতুন মাইগ্রেশন নেই**।

---

## ১৩. Concurrency

নতুন তিনটি রেস (সবগুলো আগের লোড-টেস্ট/স্টেট-মেশিন স্যুটের বাইরে ছিল):
- **I-12** রিফান্ড ↔ নতুন অর্ডার: `40P01 deadlock detected` + আটকে-থাকা লকে সংযোগ-পুল ভরে "Unable to start a transaction" → ৫০/৭২ ৫০০ → এখন ০/২৪০।
- **I-15** নিশ্চিতকরণ: ৩/৬ → ০/২০ (রিগে ০/১০)।
- **I-16** টিকিট: HTTP-তে ২০ রাউন্ডে ধরা পড়েনি; সার্ভিস সরাসরি ডেকে ১১৮/২০০ → ০/২০০।
`state-machine` **৩০/৩০** (দুই অ্যাডমিন, APPROVE+REJECT, প্রত্যাহার-অনুমোদন, OTP-রেস)।

---

## ১৪. State Machines

অবৈধ রূপান্তর সব প্রত্যাখ্যাত (`state-machine` ৩০/৩০): PENDING-এ আংশিক ফেরত ৪০৯ · ফেরতের পরে COMPLETE/FAIL ৪০৯ ·
REJECT-এর পরে APPROVE ৪০৯ · বন্ধ টিকিটে উত্তর ৪০৯ · নিশ্চিতকরণ দুবার ৪০৯। নতুন: **COMPLETED অর্ডারে "পেয়েছি" ও "পাইনি" দুটোই**
(I-15) এবং **CLOSED → ANSWERED** (I-16) — দুটোই এখন লক করা/শর্তযুক্ত লেখায় অসম্ভব।

---

## ১৫. File Upload

`upload-security` রিগে **১৫/১৫**, ডেভে **১৭/১৭** — অনুমতি (৪০১/৪০৩) · magic-byte (SVG/HTML-as-PNG/খালি ৪০০) · ৯MB/৪০MB → ৪০০ (৫০০ নয়) ·
`../` নাম উপেক্ষিত (সার্ভার-key) · polyglot পরিবেশিত নয় · রেট-লিমিট ১০টির পর ৪২৯।

---

## ১৬. Storage

কোড: driver `blob | s3 | local`। প্রোডাকশন রিগে `STORAGE_DRIVER=local` → আপলোড **৪০৪** (রিগ-লগ ও upload-security দুটোই মেপেছে) —
Vercel-এ Blob বাধ্যতামূলক। প্রোডাকশন Blob টোকেন: **NOT VERIFIED** (R-4)।

---

## ১৭. Email/OTP

**CODE VERIFIED** — §৬। **EXTERNAL NOT VERIFIED** — Resend ডোমেইন/`EMAIL_FROM` (R-3); এই মেশিনে `RESEND_API_KEY` নেই,
তাই কোনো আসল ইমেইল পাঠানো হয়নি।

---

## ১৮. Payment Workflow

সব গেটওয়ে স্টাব; webhook টাকা নড়ায় না (idempotency-কী `Setting`-এ, ৭ দিন পরে মোছে — আসল গেটওয়ে যোগের সময় replay-জানালা
বিবেচ্য)। ম্যানুয়াল পথ: TrxID ইউনিক · ডিপোজিট-রো `FOR UPDATE` · ডাইরেক্ট-পে অনুমোদনে Deposit → Order → User লক ·
বাতিলে স্টক/কুপন ফেরত। `business-flow-e2e` ৩০/৩০, `support-flow-e2e` ৩৮/৩৮ (প্রত্যাহার-প্রবাহসহ)।

---

## ১৯. Admin Audit

`admin-journey` **৭২/৭২** (Chromium) · `support-flow-e2e` **৩৮/৩৮** · অ্যাডমিন রিকভারি-লিংক সময়-সীমিত, এককালীন, লগড।
Restore কেবল কনফিগ/ক্যাটালগ/কুপন (কোনো ইউজার/খতিয়ান নয়) — কোড-পাঠে যাচাই।

---

## ২০. Customer Audit

`customer-journey` **৫৯/৫৯** (Chromium) · `interaction-sweep` **১২৫/১২৫** · `slow-network` **৯/৯** · `mobile-nav-logout` **২১৩/২১৩**।

---

## ২১. Mobile

`mobile-ux-audit` প্রোডাকশন রিগে, **দুই থিমে**, অতিথি/গ্রাহক/অ্যাডমিন × ৩২০×৫৬৮ · ৩৬০×৬৪০ · ৩৭৫×৬৬৭ · ৩৯০×৮৪৪ · ৩৯৩×৮৫২ · ৪১২×৯১৫ · ৪৩০×৯৩২ · ৪৮০×৯৬০ + ল্যান্ডস্কেপ ৮৪৪×৩৯০ ও ৯১৫×৪১২ — প্রতি থিমে **৭৯০টি পাতা-মাপ**, রুট-কভারেজ ৪৭/৫০ (বাকি ৩টির নিজস্ব UI নেই: redirect-পাতা ও দুটি error-boundary)। ওভারফ্লো · ক্লিপ · ঢাকা-পড়া কন্ট্রোল · ভাসমান সংঘর্ষ · ছোট ট্যাপ-টার্গেট · iOS জুম-ইনপুট · বটম-বার reserve · কনসোল-ত্রুটি · ব্যর্থ অনুরোধ · লগইন-বাউন্স — **সব ০**। `mobile-nav-logout` **২১৩/২১৩**। ৩২০px-এ অনুভূমিক স্ক্রল নেই (Vitest e2e-smoke)।

## ২২. Desktop

একই অডিটে ৭৬৮×১০২৪ · ৮২০×১১৮০ · ১০২৪×৭৬৮ · ১২৮০×৭২০ · ১৩৬৬×৭৬৮ · ১৪৪০×৯০০ · ১৫৩৬×৮৬৪ · ১৯২০×১০৮০ — অতিথি/গ্রাহক/অ্যাডমিন, দুই থিমে। মোট দুই থিমে **৯৬টি persona×viewport সারি, একটিতেও শূন্য-ছাড়া কাউন্টার নেই**। অ্যাডমিন-লগআউট বোতাম Chromium ও WebKit-এ ১৪৪০×৯০০ / ১৩৬৬×৭৬৮ / ১২৮০×৭২০-এ ভিউপোর্টে (sticky header, top=১৪px) — আলাদা প্রোবে মাপা।

## ২৩. Cross Browser

| ইঞ্জিন | গ্রাহক-যাত্রা | অ্যাডমিন-যাত্রা |
|---|---|---|
| Chromium (সিস্টেম Chrome) | **৫৯/৫৯** | **৭২/৭২** |
| WebKit (Safari-র ইঞ্জিন) | **৫৯/৫৯** | ১ম রান: শেষ ধাপে লগআউট-ক্লিক timeout ("element is outside of the viewport") · ২য় রান: **৭১/৭২** — লগআউট সফল; একমাত্র লাল WebKit-এর পাতা-ছাড়ার মুহূর্তে বাতিল RSC-prefetch-কে `access control checks` pageerror হিসেবে লগ করা (আগের রাউন্ডেও একই, হারনেস-ফাঁদ #১০) |
| Firefox (Playwright) | ১ম রান: প্রোডাক্ট-কার্ড ক্লিক "performing click action"-এ ৩০s ঝুলে থাকে · ২য় রান: **৫৮/৫৯** — একমাত্র লাল "reload-এর পরে back" (Playwright-Firefox-এর প্রোটোকল-reload history-এন্ট্রি যোগ করে; হারনেস-ফাঁদ #৬) | চালানো হয়নি |

লগআউট-timeout পুনরুৎপাদনের চেষ্টা: আলাদা প্রোবে দুই ইঞ্জিন × তিন উচ্চতায় বোতাম সবসময় ভিউপোর্টে ও trial-click সফল; পুনরায় চালানো যাত্রাতেও সফল — **পুনরুৎপাদনযোগ্য নয়**, তবু প্রথম রানের লালটি এখানে লুকানো হলো না। WebKit/Firefox-এর দুটি লালকে **PASS বলা হচ্ছে না** — ব্যাখ্যাত; আসল Safari/Firefox-এ হাতে যাচাই **NOT VERIFIED** (R-16)।

---

## ২৪. Accessibility

`a11y-scan` **৭৭/৭৭** · `storefront-contrast` **১০৮/১০৮** · `semantic-tokens` **১০৭/১০৭** (H-4-এর পরে প্রথমবার **সত্যিকারের** যাচাই) ·
`theme-contrast` **১৫১/১৫২** (একমাত্র লাল কনট্রাস্ট নয় — পুরনো থিম-টাস্কের "HEAD-এর তুলনায় ০টি TSX বদল" দাবি; অকমিটেড গাছে আগের
অডিটের TSX আছে) · `theme-meta-token` **১৪/১৪** · `tbl-stack` **৩৩/৩৩**।

---

## ২৫. Performance

বিল্ড: shared JS ৮৭.৪kB · সবচেয়ে ভারী First Load — `/product/[id]/[slug]` ১৬২kB, `/` ১৫৪kB, `/register`/`/login` ১৫২kB।
`perf-browser` [[B2-PERF]]।

---

## ২৬. Load Testing

[[LOAD]]

---

## ২৭. Data Growth

[[GROWTH]]

---

## ২৮. Cache/Revalidation

`isr-no-user-leak` **১০/১০** (সত্যিকারের দুই সেশন, locale-ভিন্নতা) · `stale-data` **১০/১০** · API `no-store` · `polling-load` **৮/৮**
(SSE বন্ধ থাকলে ৫০৩ → পোলিং; অননুমোদিত ৪০১)।

---

## ২৯. Timezone

`timezone-boundary` **২/২** (ঢাকা ০২:০০/০৩:০০ দিন-সীমা) · Vitest `dhaka-date` সবুজ · সার্ভার-পাশের সব তারিখ-বিন্যাস `APP_TIME_ZONE`
ব্যবহার করে — ব্যতিক্রম ছিল টেলিগ্রাম হ্যান্ডলারের ৩টি কল (**I-18**)। ক্লায়েন্ট-কম্পোনেন্ট ব্রাউজারের স্থানীয় সময় দেখায় (বাংলাদেশি
অ্যাডমিনের জন্য সঠিক)। এক্সপোর্ট-ফাইলের নামে UTC তারিখ (ঢাকার ০০:০০–০৬:০০ এ আগের দিন) — প্রসাধনী, LOW।

---

## ৩০. Cron

[[CRON]]

---

## ৩১. CI/CD

`ci.yml`: typecheck · lint · build · money-path টেস্ট (নিজস্ব Postgres) · migrate-guard (লাইভ DB-তে pending থাকলে লাল) ·
`permissions: contents: read`। GitHub-এ আসলে চলা/সবুজ — **NOT VERIFIED** (এই সেশনে GitHub-এ প্রবেশ নেই)।
CI Node 20 বনাম লোকাল 24, `engines` নেই (R-13)।

---

## ৩২. Deployment

`build` = `prisma generate && next build` (মাইগ্রেশন প্রয়োগ করে না — `PRODUCTION_CONFIG.md` §৮ রানবুক) · প্রোডাকশন বিল্ড এই
রাউন্ডে ✅ ৯৩/৯৩ পাতা · Vercel-এ রানটাইম **NOT VERIFIED**।

---

## ৩৩. Security Headers

`headers-seo` **১৩০/১৩০** — nonce-CSP (`strict-dynamic`, স্ক্রিপ্টে `unsafe-inline` নেই, `object-src 'none'`, `frame-ancestors 'none'`),
nosniff, Referrer-Policy, Permissions-Policy, HSTS, `X-Powered-By` নেই · `csp-nonce` **১৫/১৫** (প্রকৃত hydration + ক্লিক)।
জানা সীমা: `style-src 'unsafe-inline'` (নথিভুক্ত)।

---

## ৩৪. XSS/Injection

`xss-stored` **১২/১২** (৯ পাতা + টেলিগ্রাম প্রিভিউ; `window.__xss` ০) · অ্যাডমিন-URL `safeUrl` (`javascript:`/`//`/HTML-চিহ্ন প্রত্যাখ্যাত) ·
লগইন `callbackUrl` origin-তুলনা (`/\evil.com` → `https://evil.com` → প্রত্যাখ্যাত — কোড-পাঠ)।

---

## ৩৫. Error Resilience

`resilience` **১৪/১৪** — গেটওয়ে ৫০২ · অফলাইন · উত্তর হারানো (একই `clientRef`-এ দ্বিতীয় কাটা নেই) · DB বন্ধ (health ৫০৩, লগইন
fail-closed ৪০১, ফাঁস ০) · DB ফেরার ৮৩s পরে রিস্টার্ট ছাড়াই ২০০ · JS pageerror ০।

---

## ৩৬. Observability

JSON লগ · error-স্তরে `errorReporter` (SENTRY_DSN থাকলে) · I-12-এর deadlock লগে `40P01` হিসেবে স্পষ্ট দেখা গেছে (নির্ণয়যোগ্য) ·
readiness-এ cron শেষ-রান · ফাঁক: `x-request-id` যাচাইহীন (I-19) · টেলিগ্রামে ডেভ-পাঠানো সব ৪০৪ (ভুয়া টোকেন — যাচাই চলাকালে কারও চ্যাটে বার্তা যায়নি, ডেভ DB-র
`TelegramMessageLog`-এ কেবল ব্যর্থ সারি)।

---

## ৩৭. SEO

robots.txt `/admin` `/account` `/api/` `/reset-password` `/forgot-password` বাদ · sitemap-এ কেবল সক্রিয় প্রোডাক্ট ও পাবলিক পাতা ·
ব্যক্তিগত পাতায় `noindex` — `headers-seo`-র অংশ হিসেবে PASS।

---

## ৩৮. Disaster/Recovery

`resilience`-এর DB-বন্ধ পর্ব (উপরে) · টেলিগ্রাম-জব প্রসেস-মৃত্যু থেকে সেরে ওঠে (আগের রাউন্ড I-09, lease-টেস্ট ৫/৫ আবার সবুজ) ·
Neon PITR — **NOT VERIFIED** · অ্যাপ-backup বড় ডেটায় ধীর (R-6, অপরিবর্তিত)।

---

## ৩৯. Bugs Found

### I-12 · MEDIUM · Concurrency / Reliability
- **LOCATION:** `src/app/api/admin/order/route.ts` (FAIL → রিফান্ড)
- **REPRODUCTION:** একই গ্রাহকের ১২টি PENDING অর্ডার (সীমিত-স্টকের প্যাকেজ) → একসাথে ১২টি অ্যাডমিন FAIL + একই প্যাকেজে ১২টি নতুন অর্ডার (`scripts/verify/race-redteam.ts` §গ, ৩ রাউন্ড)
- **ACTUAL (আগে):** ৭২টির ৫০টি HTTP ৫০০ (`{"fail:500":19,"new:500":31}`); সার্ভার-লগে `40P01 deadlock detected` ১২৩ বার ও "Unable to start a transaction in the given time" ১৮ বার
- **ROOT CAUSE:** রিফান্ড-পথ `creditWallet` (User রো লক) → তারপর স্টক ফেরত (Variant রো লক); অর্ডার-পথ Variant → Coupon → User। উল্টো ক্রম = চক্র
- **IMPACT:** টাকা নিরাপদ ছিল (rollback — খতিয়ান ও স্টক মেলে), কিন্তু ব্যস্ত সময়ে অ্যাডমিনের রিফান্ড ও গ্রাহকের অর্ডার দুটোই "সার্ভারে সমস্যা" পেত; পুল ভরে অন্য অনুরোধও আটকাত
- **FIX:** স্টক ও কুপন-ফেরত **আগে**, ওয়ালেট-ক্রেডিট **পরে** — ক্রম এখন সর্বত্র variant → coupon → user (যুক্তি অপরিবর্তিত, কেবল লাইনের ক্রম)
- **TEST:** `race-redteam` ১২/১২ (ডেভ ২০ রাউন্ড: ২৪০টিতে ৫xx ০; রিগ ১২/১২) · Vitest `race-regressions` "লক-ক্রম" — **ফিক্স stash করে চালালে লাল** (১১টি ৫০০), ফিক্সসহ সবুজ
- **REGRESSION:** Vitest ৩৭৮/৩৭৮ · refund ৯/৯ · state-machine ৩০/৩০ · money-invariants ১৮/১৮ · **STATUS: FIXED**

### I-13 · MEDIUM · Authentication (সেশন-স্থায়িত্ব)
- **LOCATION:** `src/lib/auth.ts` → `findOrCreateGoogleUser()` (reclaim শাখা)
- **REPRODUCTION:** যাচাই-হীন credentials-অ্যাকাউন্টে লগইন (আক্রমণকারী) → একই ইমেইলে আসল `authOptions.callbacks.signIn` Google-পথ → আক্রমণকারীর সেশনে `/api/me` (`tests/google-reclaim-session.test.ts`)
- **ACTUAL (আগে):** `expected 200 to be 401` — reclaim-এর পরেও সেশন বৈধ; `sessionEpoch` ০ → ০
- **ROOT CAUSE:** reclaim পাসওয়ার্ড বাতিল করত কিন্তু `sessionEpoch` বাড়াত না; সেশন ৩০ দিনের JWT
- **পূর্বশর্ত:** অ্যাকাউন্টটি যাচাই-হীন হতে হবে — অর্থাৎ অ্যাডমিন সাইনআপ-OTP বন্ধ রেখেছেন (ডিফল্ট চালু), অথবা ২০২৬-০৮-১২-এর OTP-মাইগ্রেশনের আগের অ্যাকাউন্ট
- **IMPACT:** আসল মালিক অ্যাকাউন্ট ফেরত পাওয়ার পরও আক্রমণকারী তাঁর জমা-টাকা দিয়ে নিজের UID-তে অর্ডার করতে পারত (প্রত্যাহার OTP-বাধায় আটকাত)
- **FIX:** reclaim-লেখায় `sessionEpoch: { increment: 1 }` — পাসওয়ার্ড-রিসেটের হুবহু একই প্রক্রিয়া; নতুন Google-সেশন jwt callback-এ নতুন epoch-ই পায়
- **⚠️ `auth.ts` CLAUDE.md-এর "জিজ্ঞেস করুন" তালিকায়** — এক লাইন, কোডের নিজের ঘোষিত উদ্দেশ্য ("আগের পাসওয়ার্ড আর কাজ করে না") পূরণ করে, নতুন নীতি নয়; তবু আপনার পর্যালোচনার জন্য আলাদা করে চিহ্নিত
- **TEST:** `google-reclaim-session` ২/২ (দ্বিতীয় টেস্ট: যাচাইকৃত অ্যাকাউন্টে Google সাইন-ইন কাউকে বের করে না) · **REGRESSION:** session-revocation ৫/৫ · auth-boundary ৬/৬ · prod-auth-e2e ৫৮/৫৮ · **STATUS: FIXED**

### I-14 · MEDIUM · Money Integrity
- **LOCATION:** `src/lib/validation.ts` → `adminAdjustSchema`
- **REPRODUCTION:** অ্যাডমিন: +১০ তারপর −০.১২৫ (`tests/money-precision.test.ts`)
- **ACTUAL (আগে):** `expected 9.88 to be 9.87` — ব্যালেন্স ৳9.88, খতিয়ান-যোগফল ৳9.87; +০.০০৪ → ৳০.০০-এর খতিয়ান-সারি
- **ROOT CAUSE:** §১১-এর দ্বৈত গোলকরণ; স্কিমায় দশমিকের সীমা ছিল না
- **IMPACT:** প্রকল্পের মূল invariant (যোগফল = ব্যালেন্স) এক টাইপোতেই ভাঙে; `money-invariants`-এর শৃঙ্খল-পরীক্ষা পরে লাল হতো
- **FIX:** সর্বোচ্চ ২ দশমিক (ভাসমান-বিন্দু সহনশীলতাসহ); বেশি হলে বাংলা বার্তায় ৪০০ — নীরবে গোল নয়। `wallet.ts` **অস্পৃষ্ট**
- **TEST:** `money-precision` ২/২ (ফিক্সের আগে ২টিই লাল) · **REGRESSION:** ledger-invariant ৫/৫ · refund ৯/৯ · money-invariants ১৮/১৮ · **STATUS: FIXED**

### I-15 · LOW · State Machine
- **LOCATION:** `src/app/api/order/confirm/route.ts` · **REPRODUCTION:** COMPLETED অর্ডারে `arrived:true` ও `arrived:false` একসাথে
- **ACTUAL (আগে):** ৬ রাউন্ডে ৩ বার দুটোই ২০০, অর্ডারে দুটো তারিখ, দুটি গ্রাহক-ইভেন্ট (রিভিউ দেওয়া **ও** "পাইনি" সতর্কতা দুটোই সম্ভব)
- **ROOT CAUSE:** যাচাই লক-বহির্ভূত, লেখা শর্তহীন · **FIX:** compare-and-set `updateMany` (`deliveryConfirmedAt/DisputedAt = null` শর্তে) → দ্বিতীয়টি ৪০৯ ও rollback
- **TEST:** race-redteam ০/২০ · Vitest `race-regressions` (৫ রাউন্ড, ফিক্স ছাড়া লাল) · **STATUS: FIXED**

### I-16 · LOW · State Machine
- **LOCATION:** `src/lib/services/tickets.ts` (`replyToTicket`, `closeTicket`)
- **REPRODUCTION:** একই টিকিটে `closeTicket` ও অ্যাডমিন `replyToTicket` একসাথে, ২০০ বার (in-process; HTTP-তে ২০ রাউন্ডে ধরা পড়েনি)
- **ACTUAL (আগে):** ১১৮/২০০ বন্ধ টিকিট আবার `ANSWERED` (`closedAt` বসানো অবস্থায়); ৯৩/২০০ বন্ধ-বার্তার পরে উত্তর জমা
- **ROOT CAUSE:** অবস্থা লক-বহির্ভূত পাঠ থেকে; READ COMMITTED-এ উত্তরের `UPDATE` বন্ধের কমিটের পরে CLOSED চাপা দেয়
- **FIX:** দুই পথেই টিকিট-রো `FOR UPDATE` করে লক করা অবস্থা দেখে সিদ্ধান্ত · **TEST:** ০/২০০ · Vitest `race-regressions` (৪০ রাউন্ড) · tickets ২০/২০ · **STATUS: FIXED**

### I-17 · LOW · Order UX / Money-path message
- **LOCATION:** `src/lib/coupon.ts` (`validateCoupon`) · **REPRODUCTION:** ৳১০-এর প্যাকেজে ৳৫০-ছাড়ের FIXED কুপন (PERCENT ১০০-এ একই)
- **ACTUAL (আগে):** `/api/coupon/check` ২০০ `finalPrice "0.00"` → `/api/order` ৪০০ `"অঙ্ক শূন্যের বেশি হতে হবে"` (ওয়ালেট-সার্ভিসের ভেতরের বার্তা); টাকা কাটেনি
- **ROOT CAUSE:** কুপন ছাড়কে দাম পর্যন্ত নামতে দেয়, কিন্তু খতিয়ান ৳০-এর কর্তন নেয় না
- **FIX (নিরপেক্ষ):** ছাড় ≥ দাম হলে প্রিভিউ ও অর্ডার দুটোই একই বোধগম্য ৪০০ — ফলাফল আগের মতোই (অর্ডার হয় না), টাকার মডেল অপরিবর্তিত
- **DECISION REQUIRED:** ফ্রি/পুরো-ছাড়ের অর্ডার (গিভঅ্যাওয়ে) চালু করা হবে কি না — §৪১ R-18 · **TEST:** race-redteam §ঘ · Vitest ২টি · **STATUS: FIXED**

### I-18 · LOW · Timezone
- **LOCATION:** `src/lib/telegram/handlers.ts` · **REPRODUCTION:** `TZ=UTC` এ `2026-09-21T21:30Z` → বর্তমান কোড "২১/৯/২০২৬ ৯:৩০:০০ PM", সঠিক "২২/৯/২০২৬ ৩:৩০:০০ AM"
- **ROOT CAUSE:** `toLocaleDateString('bn-BD')` timeZone ছাড়া — Vercel UTC · **FIX:** `APP_TIME_ZONE` (প্রকল্পের একক উৎস) · **STATUS: FIXED**

### H-4 · হারনেস / হাইজিন (পণ্যের বাগ নয়, কিন্তু মিথ্যা সবুজ দিত)
- `scripts/verify/semantic-tokens.ts` — `#1a1408`/`#65a30d`/`#0284c7`-এর regex-এ `\b`-এর জায়গায় বাইট `0x08` (কমিট `a4959d7`, ২০২৬-০৯-০১) → ৩টি দাবি কখনো কিছু মেলায়নি। সারানোর পরে একমাত্র আঘাত `StorefrontShell` ক্যাটাগরি-থাম্বনেইলের গ্রেডিয়েন্ট-স্টপ `#0284c7` — একই প্যালেটের `#38bdf8`-এর মতোই সাজসজ্জা, তাই একই কারণে ছাড় (কারণসহ মন্তব্য)।
- `src/lib/guard.ts` (মন্তব্যে) ও `tests/sanitize-bengali.test.ts` (স্ট্রিং-লিটারালে) আসল NUL বাইট → `grep` নিরাপত্তা-গুরুত্বপূর্ণ `guard.ts`-কে "binary" ধরে এড়িয়ে যেত। এখন `\0` / `\u0000` escape — আচরণ হুবহু একই (sanitize টেস্ট সবুজ)।

---

## ৪০. Bugs Fixed

| ফাইল | পরিবর্তন | ইস্যু |
|---|---|---|
| `src/app/api/admin/order/route.ts` | রিফান্ডে স্টক/কুপন আগে, ওয়ালেট পরে | I-12 |
| `src/lib/auth.ts` | reclaim-এ `sessionEpoch++` (১ লাইন) | I-13 |
| `src/lib/validation.ts` | `adminAdjustSchema` — সর্বোচ্চ ২ দশমিক | I-14 |
| `src/app/api/order/confirm/route.ts` | compare-and-set লেখা | I-15 |
| `src/lib/services/tickets.ts` | উত্তর/বন্ধে টিকিট-রো `FOR UPDATE` | I-16 |
| `src/lib/coupon.ts` | ছাড় ≥ দাম → বোধগম্য ৪০০ | I-17 |
| `src/lib/telegram/handlers.ts` | `APP_TIME_ZONE` | I-18 |
| `src/lib/guard.ts` · `tests/sanitize-bengali.test.ts` · `scripts/verify/semantic-tokens.ts` | নিয়ন্ত্রণ-বাইট → escape; ছাড়-তালিকা | H-4 |

**নতুন টেস্ট/স্যুট:** `tests/race-regressions.test.ts` (৫) · `tests/google-reclaim-session.test.ts` (২) · `tests/money-precision.test.ts` (২) ·
`scripts/verify/race-redteam.ts` (১২ দাবি)। প্রতিটি নতুন টেস্ট **ফিক্স ছাড়া লাল** প্রমাণিত (stash/আগের অবস্থায় চালিয়ে)।
কোনো টেস্ট মোছা/নিষ্ক্রিয়/দুর্বল করা হয়নি। কোনো নতুন নির্ভরতা বা মাইগ্রেশন নেই। `wallet.ts`, `middleware.ts`, `schema.prisma` অস্পৃষ্ট।

---

## ৪১. Remaining Issues

| ID | SEVERITY | DESCRIPTION | EVIDENCE | IMPACT | FIX AVAILABLE | FIXED | BLOCKS LAUNCH |
|---|---|---|---|---|---|---|---|
| R-1 | **CRITICAL** | Next.js 14.2.35 — ২৩টি advisory (CSP-nonce XSS, SSRF, DoS, RCE) | `npm audit` critical ১ | AVIF-পথ বন্ধ; বাকিগুলো খোলা | YES (major) | NO — মালিকের সিদ্ধান্ত | মালিক: না (প্রশমনসহ) |
| R-2 | **BLOCKER** | লাইভ অ্যাডমিন সিড-পাসওয়ার্ডে, 2FA বন্ধ (২০২৬-০৯-১৮-এর read-only যাচাই) | এই রাউন্ডে **NOT VERIFIED** — লাইভ DB অনুমতি ছাড়া ছোঁয়া হয়নি | পূর্ণ অ্যাডমিন দখল | YES (মালিক) | অজানা | **YES** যতক্ষণ না নিশ্চিত |
| R-3 | **BLOCKER** | Resend ডোমেইন/`EMAIL_FROM` অযাচাই | readiness `ready:false` (আগের রাউন্ড) | OTP ছাড়া রেজিস্ট্রেশন অসম্ভব | YES (মালিক) | NO | **YES** |
| R-4 | HIGH | প্রোডাকশন Blob টোকেন অযাচাই; `local` ড্রাইভারে আপলোড ৪০৪ (এই রাউন্ডেও মাপা) | upload-security, রিগ-লগ | পেমেন্ট-প্রমাণ/ছবি অচল | YES (মালিক) | NO | ছবি/প্রমাণ দরকার হলে YES |
| R-4b | HIGH | লাইভ DB-তে ২টি মাইগ্রেশন বাকি (আগের রাউন্ড) | এই রাউন্ডে NOT VERIFIED | CI migrate-guard লাল | YES (মালিক) | অজানা | না (কোড নির্ভর করে না) |
| R-5 | MEDIUM | **DECISION REQUIRED** — `notifyAdmins`-এর টেলিগ্রাম await হয় না (serverless-এ হারাতে পারে) | আগের রাউন্ড | অ্যাডমিন-সতর্কতা হারানো | YES (`waitUntil` — নতুন নির্ভরতা) | NO | না |
| R-6 | MEDIUM | বড় export/backup ধীর/বিশাল | [[GROWTH-R6]] | Vercel সীমা | YES | NO | না |
| R-8 | MEDIUM | ধীর মোবাইলে CWV সীমা ছাড়ায় | [[PERF-R8]] | ধীর প্রথম-দর্শন | আংশিক | NO | না |
| R-18 | LOW | **DECISION REQUIRED (I-17)** — ফ্রি/পুরো-ছাড়ের অর্ডার চালু হবে কি না; PERCENT >১০০ UI ও API দুটোই আগে থেকেই আটকায়; কিন্তু ঠিক ১০০% বা দামের সমান/বেশি FIXED কুপন তৈরি করা যায়, যা এখন কোনো প্যাকেজে প্রযোজ্য হয় না (তৈরির সময় সতর্কতা নেই) | কোড | গিভঅ্যাওয়ে-কুপন কাজ করে না | YES | NO | না |
| I-19 | LOW | `x-request-id` যাচাইহীন প্রতিফলন (৬০০০ অক্ষর মাপা) | রিগ-প্রোব | লগ-দূষণ, সাপোর্ট-Ref জাল | YES — `^[A-Za-z0-9._:-]{8,64}$` না মিললে নতুন UUID | NO — `middleware.ts`, অনুমোদন দরকার | না |
| I-20 | LOW | **DECISION REQUIRED** — `2fa-check` পাসওয়ার্ড যাচাই করে আলাদা বাকেটে (৫/১৫মি) → 2FA-অ্যাকাউন্টে লগইন-সীমার উপর আরও ৫টি অনুমান + "পাসওয়ার্ড সঠিক" সংকেত | কোড | 2FA থাকায় লগইন হয় না; পুনর্ব্যবহৃত পাসওয়ার্ড ঝুঁকি | YES — বিকল্প নিচে | NO | না |
| R-19 | LOW | প্রত্যাহারে OTP আগে খরচ হয়, তারপর লক-নির্ভর যাচাই (ব্যালেন্স/ঝুলন্ত) — ব্যর্থ হলে নতুন কোড লাগে | কোড | UX (নিরাপদ দিকে ব্যর্থ) | YES | NO | না |
| R-20 | LOW | `/account` পাতা `include` দিয়ে পুরো User সারি (পাসওয়ার্ড-হ্যাশ/2FA-সিক্রেটসহ) পড়ে — কেবল স্কেলার ফিল্ড রেন্ডার হয় | রিগ-প্রোব: `/account`, `/account/profile`, `/account/orders`, `/account/wallet/deposit` — HTML ও RSC দুটোতেই পাসওয়ার্ড-হ্যাশ/2FA-সিক্রেট/recovery-হ্যাশ/bcrypt-আকৃতি **০** (৮/৮) | এখন ফাঁস নেই; ভবিষ্যতে কেউ পুরো অবজেক্ট ক্লায়েন্টে দিলে ফাঁস | YES (`select`) | NO | না |
| R-21 | LOW | কুপন-প্রিভিউ (`/api/coupon/check`) সবসময় খুচরা দামে হিসাব করে; রিসেলারের অর্ডার রিসেলার-দামে — ওয়েবে রিসেলারের জন্য প্রিভিউ ও অর্ডারের ছাড়/যোগ্যতা ভিন্ন হতে পারে (I-17-এর আগেও একই বিন্দুতে অর্ডার ব্যর্থ হতো — রিগ্রেশন নয়) | কোড-পাঠ | কেবল রিসেলার-ওয়েব-চেকআউট; টাকা সবসময় লক করা রো থেকে সঠিক | YES (প্রিভিউতে tier-দাম) | NO | না |
| R-9…R-16 | LOW/INFO | আগের রাউন্ডের তালিকা অপরিবর্তিত (dev-advisory, CI audit নীতি, cron-ত্রুটির কাঁচা বার্তা, পেজিনেশন, `engines`, PITR, hover-কাঁপুনি, Firefox F5→Back) | আগের রিপোর্ট §৪১ | — | — | NO | না |

**I-20 — DECISION REQUIRED:** (ক) `2fa-check`-এর ব্যর্থ পাসওয়ার্ড লগইন-বাকেটে গোনা — অনুমান-সীমা এক হয়, কিন্তু সৎ ব্যবহারকারীর ভুল পাসওয়ার্ড
দুবার গোনা হয় (২-৩ ভুলেই আটকা) · (খ) পাসওয়ার্ড না দেখে কেবল ইমেইলে 2FA আছে কি না বলা — কোন ইমেইলে 2FA আছে তা ফাঁস হয় · (গ) যেমন আছে
(প্রস্তাবিত যদি অ্যাডমিন 2FA চালু রাখেন — পাসওয়ার্ড একা দিয়ে লগইন হয় না)। টাকায় কোনো প্রভাব নেই।

---

## ৪২. External Blockers

| স্তর | অবস্থা |
|---|---|
| **CODE READY** | ✅ — §৪৪-এর সব কোড-গেট সবুজ |
| **PRODUCTION CONFIGURATION READY** | ❌ / **NOT VERIFIED** — লাইভ অ্যাডমিন-পাসওয়ার্ড, লাইভ DB-মাইগ্রেশন, `EMAIL_FROM`/Resend, Blob টোকেন, GitHub secrets (`APP_BASE_URL`, `CRON_SECRET`), Vercel env ও Node সংস্করণ — এই রাউন্ডে কোনোটিতে প্রবেশ করা হয়নি |
| **EXTERNAL SERVICE VERIFIED** | ❌ — Resend · Vercel · Blob · GitHub Actions cron · Neon PITR · Google OAuth · কাস্টম ডোমেইন — সবই **NOT VERIFIED** |

এই রাউন্ডের ফিক্সে **কোনো মাইগ্রেশন নেই**, তাই deploy-ক্রম অপরিবর্তিত।

---

## ৪৩. Test Matrix

সব ফিক্সের **পরে**, এই ক্রমে: generate → typecheck → lint → Vitest → build → রিগ → (ডেভ-স্যুট ফিক্সের আগেও একবার)।

| স্তর | স্যুট | ফল |
|---|---|---|
| স্ট্যাটিক | `prisma generate` · `typecheck` · `lint` | [[FINAL-STATIC]] |
| ইউনিট/ইন্টিগ্রেশন | Vitest (টেস্ট-DB) | শুরুতে **৩৭১/৩৭১** (৩৬) → ফিক্সের পরে **৩৭৮/৩৭৮** (৩৮) + money-precision ২/২ · শেষে [[FINAL-VITEST]] |
| বিল্ড | `next build` | ✅ ৯৩/৯৩ পাতা · [[FINAL-BUILD]] |
| মাইগ্রেশন | খালি DB-তে `migrate deploy` + `migrate diff` | ১৪/১৪ · drift ০ · CHECK ৮ |
| রিগ ব্যাচ-১ | prod-auth-e2e · red-team-auth · auth-ui-edges · api-auth-matrix | ৫৮/৫৮ · ২২/২২ · ১৫/১৫ · ২১০/২১০ |
| | security-probes · input-fuzz · xss-stored · upload-security | ২২/২২ · ৭২৪ অনুরোধ ৯/৯ · ১২/১২ · ১৫/১৫ |
| | state-machine · **race-redteam** · stale-data · business-flow-e2e | ৩০/৩০ · ১২/১২ · ১০/১০ · ৩০/৩০ |
| | double-submit · headers-seo · timezone-boundary · resilience | ১৬/১৬ · ১৩০/১৩০ · ২/২ · ১৪/১৪ |
| রিগ ব্যাচ-২ | customer-journey ৫৯/৫৯ · admin-journey ৭২/৭২ · interaction-sweep ১২৫/১২৫ · slow-network ৯/৯ · a11y-scan ৭৭/৭৭ · tbl-stack ৩৩/৩৩ · storefront-contrast ১০৮/১০৮ · **semantic-tokens ১০৭/১০৭** (H-4-এর পরে প্রথম সত্যিকারের রান) · perf-browser (মাপ, §২৫) · account-secrets প্রোব ৮/৮ | |
| ক্রস-ব্রাউজার | WebKit: গ্রাহক ৫৯/৫৯ · অ্যাডমিন ৭১/৭২ (ব্যাখ্যাত) · Firefox: গ্রাহক ৫৮/৫৯ (ব্যাখ্যাত) — §২৩ | |
| রেসপন্সিভ | ২ থিম × ৪৮ persona×viewport (১৮টি ভিউপোর্ট) = ১,৫৮০ পাতা-মাপ · সব কাউন্টার **০** | |
| লোড/ডেটা | [[LOAD-TABLE]] | |
| cron (আলাদা `next start :3101`) | cron-jobs | [[CRON-TABLE]] |
| ডেভ-সার্ভার | route-guard-audit · no-live-writes · ratelimit-failclosed · integrations | অরক্ষিত ০/৮০ · ১৫/১৫ · ২২/২২ · ১৯/১৯ |
| | order-price-lock · ban-revocation · ip-spoofing · polling-load | ১৪/১৪ · ১৪/১৪ · ৮/৮ · ৮/৮ |
| | isr-no-user-leak · csp-nonce · theme-meta-token · theme-contrast | ১০/১০ · ১৫/১৫ · ১৪/১৪ · ১৫১/১৫২ (উপরে ব্যাখ্যাত) |
| | malformed-requests · upload-security · race-redteam (২০ রাউন্ড) · support-flow-e2e · mobile-nav-logout | ৯৯০ অনুরোধে ৫০০ ০ · ১৭/১৭ · ১২/১২ · ৩৮/৩৮ · ২১৩/২১৩ |
| ডেটা | money-invariants (ডেভ DB) | **১৮/১৮** |

---

## ৪৪. Final Quality Gates

| গেট | ফল |
|---|---|
| CRITICAL BUGS = 0 (কোডে) | ✅ — খোলা CRITICAL কেবল নির্ভরতা (R-1) |
| HIGH SECURITY ISSUES = 0 | ✅ (কোডে; R-4 কনফিগ) |
| BROKEN CUSTOMER / ADMIN CRITICAL FLOWS = 0 | [[GATE-FLOWS]] |
| UNAUTHORIZED ACCESS = 0 | ✅ ২১০/২১০ · অরক্ষিত রুট ০ · I-13 সারানো |
| DUPLICATE ORDERS / TRANSACTIONS = 0 | ✅ double-submit ১৬/১৬ · resilience (উত্তর-হারানো) · [[GATE-LOAD]] |
| MONEY CALCULATION BUGS = 0 | ✅ I-14 সারানো · money-invariants ১৮/১৮ · ledger-invariant ৫/৫ |
| CRITICAL DATA CORRUPTION = 0 | ✅ |
| CRITICAL STATE MACHINE VIOLATIONS = 0 | ✅ ৩০/৩০ · I-15/I-16 সারানো |
| PRODUCTION BUILD · TYPECHECK · LINT | [[GATE-STATIC]] |
| CRITICAL TESTS · CRITICAL PLAYWRIGHT | [[GATE-TESTS]] |
| MOBILE · DESKTOP CRITICAL FLOWS | [[GATE-RESP]] |
| PRODUCTION RUNTIME | ✅ লোকাল `next start` + TLS — Vercel-এ **NOT VERIFIED** |
| UNHANDLED CRITICAL ERRORS = 0 | ✅ fuzz/malformed-এ ৫xx ০ · deadlock-৫০০ সারানো |

---

## ৪৫. Final Release Decision

## **NO-GO**

[[DECISION-BODY]]
