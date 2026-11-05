# UID TOPUP — EXTREME RED-TEAM PRODUCTION AUDIT + AUTO-FIX
**তারিখ:** ২০২৬-০৯-১৮ → ২০২৬-০৯-১৯ · **ব্রাঞ্চ:** `master` · **HEAD:** `a4959d7` · **কমিট/পুশ/ট্যাগ করা হয়নি**

> আগের সব অডিটের PASS এখানে **প্রমাণ**, সত্য নয়। প্রতিটি দাবি এই রাউন্ডে আবার চালানো
> হয়েছে, আর যা নতুন পাওয়া গেছে তা পুনরুৎপাদন → মূল কারণ → ফিক্স → টার্গেটেড টেস্ট →
> রিগ্রেশন ধাপে গেছে। কোনো সিক্রেটের মান এই ফাইলে নেই (env-এর কেবল **নাম**)।
> যা যাচাই করা যায়নি, তা স্পষ্ট করে **NOT VERIFIED**।

---

## ১. Executive Summary

এই রাউন্ডে **১১টি নতুন ত্রুটি** (আগের কোনো অডিটে ধরা পড়েনি) পাওয়া গেছে — **সবগুলো সারানো
ও যাচাই করা হয়েছে**। এর বাইরে যাচাই-হারনেসের **দুটি ফাঁপা/মিথ্যা ফল** ও আগের অডিট-রিপোর্টের
**একটি ভুল দাবি** ধরা ও সংশোধন করা হয়েছে।

| # | মাত্রা | সমস্যা | অবস্থা |
|---|---|---|---|
| I-01 | **HIGH** | "সব ডিভাইস থেকে সাইন-আউট"/রিসেটের পরেও চুরি-যাওয়া সেশন **৩০১s** টাকার API চালাতে পারত | FIXED |
| I-02 | LOW | গ্রাহকের সামনে ইংরেজি Zod বার্তা (`String must contain at most 80 character(s)`) | FIXED |
| I-03 | MEDIUM | ID-তে null-byte (`a\0b`) → **HTTP 500** + ops-অ্যালার্ম | FIXED (৪০০) |
| I-04 | LOW | union-ফিল্ডে ইংরেজি `Invalid input` (৬০ বার) | FIXED |
| I-05 | MEDIUM | তিনটি টিকিট-রুট Prisma-র ভেতরের বার্তা হুবহু ক্লায়েন্টকে পাঠাত | FIXED |
| I-06 | MEDIUM | ৬টি টাকার CHECK constraint **কোনো মাইগ্রেশনে ছিল না** — নতুন DB-তে ০টি | FIXED (মাইগ্রেশন) |
| I-07 | MEDIUM | প্রোডাকশনে `migrate deploy`-এর কোনো ধাপ/নির্দেশনা ছিল না | FIXED (রানবুক) |
| I-08 | MEDIUM | বিজ্ঞপ্তি-কোয়েরি Seq Scan (Navbar প্রতি ১২০s প্রতি গ্রাহক) | FIXED (২টি ইনডেক্স) |
| I-09 | MEDIUM | টেলিগ্রাম-জব মাঝপথে মরলে **চিরতরে `RUNNING`** — আর কখনো চলত না | FIXED |
| I-10 | LOW | SLA-সতর্কতা: আগের রান চলাকালীন পেরোনো ডেডলাইন **কখনো জানানো হতো না** | FIXED |
| I-11 | LOW | CI/cron workflow-এ `permissions` নেই — টোকেনের অধিকার রিপো-সেটিং-নির্ভর | FIXED |

**কোড-স্তরের সব গেট সবুজ** (§৪৪)। **সিদ্ধান্ত: NO-GO** — কোডের কারণে নয়; লাইভ অ্যাডমিন
সিড-পাসওয়ার্ডে, ইমেইল/OTP ও Blob প্রোডাকশনে অযাচাইকৃত, Next.js-এর CRITICAL advisory খোলা (মালিকের
সিদ্ধান্তে আপগ্রেড পরে), এবং লাইভ DB-তে এই অডিটের ২টি মাইগ্রেশন এখনো প্রয়োগ হয়নি (§৪২)।

---

## ২. Baseline

| | |
|---|---|
| Git | `master` · HEAD `a4959d7` · অকমিটেড: ৮৯ modified + ৬৪ untracked (আগের তিন অডিটের কাজসহ) |
| রানটাইম | Node v24.15 (লোকাল) · CI Node 20 · Vercel-এ `engines` নির্দিষ্ট নেই |
| নির্ভরতা | next **14.2.35** · react 18.3.1 · prisma/@prisma/client 5.22.0 · next-auth 4.24.x · zod 3.25 · bcryptjs 2.4.3 |
| পরিকাঠামো | Docker dev DB (`localhost:5434`) · test DB (`localhost:5433`) · prod rig = `next build` + `next start` + TLS প্রক্সি `https://localhost:3443` |
| Env (শুধু নাম) | `DATABASE_URL · NEXTAUTH_SECRET · NEXTAUTH_URL · BLOB_READ_WRITE_TOKEN · RESEND_API_KEY · EMAIL_FROM · GOOGLE_CLIENT_ID · GOOGLE_CLIENT_SECRET · CRON_SECRET · TELEGRAM_BOT_TOKEN · TELEGRAM_CHAT_ID · TELEGRAM_ENC_KEY · S3_* · SSLCZ_* · STRIPE_* · UPSTASH_REDIS_REST_* · SENTRY_DSN · STORAGE_DRIVER · STREAM_ENABLED · TRUSTED_PROXY · FF_LOOKUP_API_KEY · GAME_API_*` |
| আগের প্রমাণ | `FINAL_PRODUCTION_GRADE_AUDIT.md`, `FINAL_PRODUCTION_AUDIT.md`, `FINAL_AUDIT_REPORT_2026-09-17.md` + `audit/*.json` |

---

## ৩. Architecture

৩৫৭টি TS/TSX সোর্স · ৪৬ পাতা · **৮০ API রুট** · ৩৩ Prisma মডেল · ১৪ মাইগ্রেশন · ৩৬ Vitest ফাইল ·
৪৩ verify-স্যুট। টাকা কেবল `services/wallet.ts` দিয়ে (`creditWallet`/`debitWallet`, একই
`$transaction`-এ `LedgerEntry`), লক-ক্রম variant → coupon → user (`FOR UPDATE`, ৩১টি লক-সাইট)।
অথ: NextAuth v4 JWT + `sessionEpoch` (এখন **প্রতি অনুরোধে** যাচাই — I-01)। নির্ধারিত কাজ: GitHub
Actions → ৩টি `/api/cron/*` (constant-time `assertCronAuth`)। পেমেন্ট-গেটওয়ে সব স্টাব — ম্যানুয়াল
bKash/Nagad প্রবাহই চালু।

---

## ৪. Dependency Audit

`npm audit --omit=dev` (২০২৬-০৯-১৯): **critical ১ (`next`)**, high ০, moderate ০। ফিক্স কেবল
major আপগ্রেডে (`next@16.x`)। প্রশমন: AVIF বন্ধ (Image-Optimizer RCE পথ) — মালিকের সিদ্ধান্ত।
পুরো গাছে (dev-সহ) ৯টি: `vitest`/`@vitest/mocker` (critical, কেবল Vitest UI সার্ভারে),
`vite`/`vite-node`/`esbuild` (dev-সার্ভার), `glob` CLI (`eslint-config-next`-এর মাধ্যমে) —
কোনোটিই প্রোডাকশন রানটাইমে নেই; সবগুলোর ফিক্স major আপগ্রেড ⇒ মালিকের অনুমোদন লাগবে (CLAUDE.md §২.২)।

---

## ৫. Source Code Audit

পুরো-সোর্স red-team grep: কোনো bypass/mock/হার্ডকোডেড শর্টকাট/মাস্টার-পাসওয়ার্ড নেই; সব
`$queryRaw` প্যারামিটারাইজড; টাকার প্রতিটি লেখা ট্রানজেকশন + `FOR UPDATE`; increment atomic।
এই রাউন্ডে কোড পড়ে পাওয়া দুটি সূক্ষ্ম ত্রুটি — I-09 (lease) ও I-10 (SLA সময়-জানালা) — দুটিই রানটাইমে
পুনরুৎপাদিত, তারপর সারানো।

---

## ৬. Authentication

`red-team-auth` **২২/২২**: ইমেইল case/whitespace, ডুপ্লিকেট রেজিস্ট্রেশন, কুকি-ফ্ল্যাগ
(HttpOnly · Secure · SameSite · `__Secure-`), OTP resend-স্প্যাম + একটিমাত্র সক্রিয় OTP, লগআউট-পরিসর,
পাসওয়ার্ড বদল, revoke-all, ব্যান। **I-01** এখানে ধরা পড়ে: revoke-all-এর পরে পুরনো সেশন ৩০১s বৈধ
ছিল → এখন **পরের অনুরোধেই ৪০১**। `prod-auth-e2e` ৫৮/৫৮ · `auth-ui-edges` ১৫/১৫ · `ban-revocation` ১৪/১৪।

---

## ৭. Authorization

`api-auth-matrix` **২১০/২১০** — ৮০টি রুটের প্রতিটি মেথড anon/customer/admin হিসেবে: অ্যাডমিন-রুট
অ-অ্যাডমিনে ≥৪০১, cron সিক্রেট ছাড়া ৪০১, পাবলিক রুটে ৫xx ০। `route-guard-audit`: ৮০ রুট, **অরক্ষিত ০**।

---

## ৮. API Security

সব `/api/*` উত্তরে `Cache-Control: no-store` (middleware)। `security-probes` ২২/২২। ত্রুটির উত্তরে
ভেতরের তথ্য (`PrismaClient|node_modules|postgres://|neon.tech`) — **০** (I-05-এর পরে)।

---

## ৯. Input Validation

`input-fuzz`: ১১টি endpoint × ১৮ ধরনের মান = **৭২৪টি বিকৃত অনুরোধ** → ৫xx **০**, তথ্য-ফাঁস **০**,
ইংরেজি বার্তা **০**, স্ট্যাটাস-কোডের অর্থ সঠিক (৪০১/৪০৩/৪০৪/৪০৫/৪০৯) — ৯/৯ দাবি।
`malformed-requests`: ৯৯০ অনুরোধে ৫০০ = ০। (I-02, I-03, I-04 এখানে ধরা ও সারানো।)

---

## ১০. Order Integrity

`order-price-lock` ১৪/১৪ (দাম লকের ভেতর থেকে; `expectedPrice` গার্ড ৪০৯) · `business-flow-e2e` ৩০/৩০ ·
`double-submit` ১৬/১৬ · চেকআউটের মাঝে ভ্যারিয়েন্ট মুছে ফেললে → ৪০০ বাংলা বার্তা (প্রান্ত-প্রোব)।
লোড ১০০ একসাথে: ডুপ্লিকেট অর্ডার **০**, oversell **০** (স্টক ঠিক ৩০)।

---

## ১১. Money Integrity

`money-invariants` **১৮/১৮** (ডেভ DB; আচরণ-পরীক্ষা সব rollback) · লোড-টেস্ট শেষে: "ব্যালেন্স = ১০০০ − খরচ = খতিয়ান-যোগফল = শেষ `balanceAfter`" ✓ ·
`state-machine`-এর প্রতিটি ধাপের পরে খতিয়ান-অভেদ ✓ · DB-স্তরে `user_balance_positive` ও ৫টি সহ-CHECK
(I-06-এর পরে নতুন DB-তেও তৈরি হয়)।

---

## ১২. Database Integrity

**I-06:** খালি DB-তে `migrate deploy` → CHECK constraint **০** (ডেভ DB-তে ৬, লাইভে ৬, ভাঙা সারি ০)।
constraint-গুলো কেবল `npm run db:constraints` স্ক্রিপ্টে ছিল। এখন idempotent মাইগ্রেশন
`20260918120000_money_check_constraints` → নতুন DB-তে ৬টিই তৈরি, drift ০।
**I-08:** `Notification (userId, createdAt)` + partial `(userId) WHERE isRead=false` — ১ লাখ সারিতে তালিকা
১৭.৪ms → **০.০৭ms**, অপঠিত-গণনা ১১.৩ms → ৭.৮ms (Index Only Scan)।
লাইভ Neon (read-only, ২০২৬-০৯-১৯): ১২টি প্রয়োগ, **এই অডিটের ২টি বাকি** — §৪২ দেখুন।

---

## ১৩. Concurrency

`state-machine` ৩০/৩০ — একসাথে দুটি COMPLETE, APPROVE+REJECT, দুই অ্যাডমিনের ব্যালেন্স-সমন্বয়, প্রত্যাহার
অনুমোদন-রেস, OTP-রেস, ডেলিভারি-নিশ্চিতকরণ রেস — প্রতিটিতে ঠিক একটি জেতে। নতুন: টেলিগ্রাম শিডিউলারে
**৩টি টিক একসাথে** → জব ঠিক একবার; **পরিত্যক্ত জবে ৩/৫টি টিক একসাথে** → পুনরুদ্ধারও ঠিক একবার (I-09)।

---

## ১৪. State Machines

অবৈধ রূপান্তর সব প্রত্যাখ্যাত: PENDING-এ রিফান্ড ৪০৯, রিফান্ডের পরে রিফান্ড ৪০৯, reject-এর পরে approve ৪০৯,
বন্ধ টিকিটে উত্তর **৪০৯** (আগে ৪০০ — I-05-এর অংশ হিসেবে অর্থ সংশোধিত, টেস্টে নোটসহ)।

---

## ১৫. File Upload

`upload-security` ১৫/১৫ · শূন্য-বাইট ৪০০ · MIME মিথ্যা (png বলে txt) ৪০০ (magic-byte) · ইউনিকোড/লম্বা/
ডাবল-এক্সটেনশন নাম → সার্ভার-জেনারেটেড key · একই ফাইল দুবার → ভিন্ন key · বাইরের URL screenshot ৪০০ ·
malformed multipart ৪০০ (আগে ৫০০)।

---

## ১৬. Storage

কোড: driver `blob | s3 | local`; প্রোডাকশনে `local` হলে readiness **blocker** দেখায় (আপলোড ৪০৪ হয় —
মাপা)। প্রোডাকশন Blob টোকেন: **NOT VERIFIED** (বাইরের কনফিগ)।

---

## ১৭. Email/OTP

CODE VERIFIED: OTP একটিই সক্রিয়, resend-সীমা, প্রতিস্থাপিত কোড প্রত্যাখ্যাত (red-team-auth)।
EXTERNAL CONFIG: Resend ডোমেইন / `EMAIL_FROM` — **NOT VERIFIED**। OTP-বাধ্যতামূলক রেজিস্ট্রেশনে ইমেইল
অচল হলে readiness এখন সৎভাবে `ready:false`।

---

## ১৮. Payment Workflow

সব গেটওয়ে স্টাব (SSLCommerz/Stripe-এর IPN-ব্যাখ্যা ইউনিট-টেস্টেড, কিন্তু আসল নেটওয়ার্ক-কল নেই)।
চালু পথ = ম্যানুয়াল: TrxID জমা → অ্যাডমিন অনুমোদন → `creditWallet`। ডুপ্লিকেট TrxID ও double-approve
রেস Vitest-এ ঢাকা। webhook-lifecycle টেস্ট: "কোনো ওয়ালেট ক্রেডিট হয় না" লক।

---

## ১৯. Admin Audit

`admin-journey` **৭২/৭২** (প্রোডাক্ট তৈরি, অর্ডার সম্পন্ন/ব্যর্থ, ডিপোজিট, রিকভারি-লিংক, সেটিংস) ·
`support-flow-e2e` ৩৮/৩৮ · অ্যাডমিন রিকভারি: সময়-সীমিত, এককালীন, অডিট-লগড, কোনো সর্বজনীন পাসওয়ার্ড নেই।

---

## ২০. Customer Audit

`customer-journey` **৫৯/৫৯** (সার্চ, অপর্যাপ্ত ব্যালেন্স, UID-অমিল, নিশ্চিতকরণ, ইনভয়েস, ৪০৪, দাম-বদল) ·
`interaction-sweep` ১২৫/১২৫ · `slow-network` ৯/৯ · `mobile-nav-logout` ২১২/২১২।

---

## ২১. Mobile

`mobile-ux-audit` প্রোডাকশন রিগে, **দুই থিমে**, অতিথি/গ্রাহক/অ্যাডমিন × ৩২০×৫৬৮ · ৩৬০×৬৪০ · ৩৭৫×৬৬৭ ·
৩৯০×৮৪৪ · ৩৯৩×৮৫২ · ৪১২×৯১৫ · ৪৩০×৯৩২ · ৪৮০×৯৬০ + ল্যান্ডস্কেপ ৮৪৪×৩৯০ ও ৯১৫×৪১২:
ওভারফ্লো · ক্লিপ · ঢাকা-পড়া · ছোট ট্যাপ-টার্গেট · জুম · সংঘর্ষ · কনসোল-ত্রুটি — **সব ০**
(প্রতি থিমে ২৮টি মোবাইল persona×viewport; লগইন-বাউন্স ০)।
`mobile-nav-logout` ২১২/২১২।

## ২২. Desktop

একই অডিট, তিন ভূমিকা × ৮টি ডেস্কটপ/ট্যাবলেট ভিউপোর্ট (৭৬৮×১০২৪ → ১৯২০×১০৮০), দুই থিমে —
প্রতি থিমে ২৪টি persona×viewport, **সব কাউন্টার ০**। মোট: দুই থিমে ১০৪টি persona×viewport, ত্রুটি ০।

## ২৩. Cross Browser

| ইঞ্জিন | গ্রাহক-যাত্রা | অ্যাডমিন-যাত্রা |
|---|---|---|
| Chromium (সিস্টেম Chrome) | **৫৯/৫৯** | **৭২/৭২** (§১৯) |
| WebKit (Safari-র ইঞ্জিন) | **৫৯/৫৯** (পরপর দুবার) | ৭১/৭২ — ব্যাখ্যাত, নিচে |
| Firefox (Playwright) | ৫৮/৫৯ — ব্যাখ্যাত, নিচে | চালানো হয়নি (ইঞ্জিন অস্থির) |

WebKit-এ প্রথমে তিনটি লাল — প্রতিটি পুনরুৎপাদন করে কারণ মাপা হয়েছে, অনুমান নয়:
1. **প্যাকেজ-ক্লিক নীরবে ব্যর্থ** → কারণ: লগইন-বোতামে ক্লিকের পর পয়েন্টার y=৫৪৩.৪-এ থেকে যায়; redirect-এর
   পর প্যাকেজ-কার্ডের নিচের কিনারা ঠিক সেখানে, hover-lift-এ কিনারা পয়েন্টার পেরোয় → unhover → ফেরে →
   hover — **৩s-এ ২০টি ভিন্ন অবস্থা** (কিনারা ৫৪২.৪৮↔৫৪৩.৪৯)। Playwright "element is not stable"।
   পয়েন্টার সরালে ক্লিক সঙ্গে সঙ্গে সফল। ফোন-অনুকরণে পড়ে-থাকা পয়েন্টার হারনেসের শিল্পকর্ম → `customer-journey`
   লগইনের পরে পয়েন্টার সরায়। পণ্যের দিকটি R-15 (ডেস্কটপ Safari-তে মাউস ঠিক কিনারায় থামলে কাঁপুনি)।
2. **"access control checks" / "Load failed" ত্রুটি** → কারণ: পাতা ছাড়ার মুহূর্তে চলমান fetch (RSC prefetch,
   `/api/auth/session`) বাতিল হলে WebKit সেটিকে ত্রুটি হিসেবে লগ করে। মাপা: সাথে সাথে পাতা বদলালে ৩টি,
   prefetch শেষ হতে দিলে **০**; ছেড়ে-যাওয়া পাতায় ঘটে, ব্যবহারকারীর অদৃশ্য। `customer-journey`-র ৪০৪-লুপে
   মানুষের মতো অপেক্ষা যোগ (কনসোল-দাবি অপরিবর্তিত)। অ্যাডমিন-যাত্রার ১টি লাল একই শ্রেণির (`/api/auth/session`) —
   **ব্যাখ্যাত, PASS বলা হচ্ছে না**।
3. প্রথম রানে navigation-সংঘর্ষ ও প্যাকেজ-ক্লিক — ভারী CPU-চাপে (৩টি সমান্তরাল সুইপ) timing; স্বাভাবিক চাপে পুনরাবৃত্তি হয়নি।

Firefox: একমাত্র লাল "reload-এর পরে back"। মাপা: reload ছাড়া back ঠিক (`/track`); data-URL-এ reload→back ঠিক;
কিন্তু অ্যাপ-পাতায় Playwright-Firefox-এর `reload` নিজেই ৩০s টাইমআউট ও **"Target crashed"** — ইঞ্জিনটি এই
প্রশ্নের নির্ভরযোগ্য মাপকাঠি নয়। আগের মাস্টার অডিটেও একই আচরণ নথিভুক্ত (Playwright-Firefox-এর প্রোটোকল-`reload()`
history-তে বাড়তি এন্ট্রি যোগ করে; সাধারণ পাবলিক পাতাতেও)। অ্যাপের দোষের কোনো প্রমাণ নেই, তবু আসল Firefox-এ
F5-এর পরে Back — **NOT VERIFIED** (হাতে যাচাই দরকার, R-16)।

---

## ২৪. Accessibility

`a11y-scan` **৭৭/৭৭** · `semantic-tokens` ১০৭/১০৭ · `storefront-contrast` ১০৮/১০৮ · `theme-contrast` ১৫১/১৫২ (একমাত্র লাল কনট্রাস্ট নয় — §৪৩) ·
`theme-meta-token` ১৪/১৪

---

## ২৫. Performance

TTFB ৩৯–১০৪ms (prod বিল্ড)। ধীর মোবাইল প্রোফাইলে (৪× CPU, ১.৬Mbps) **২৮টি পাতা-প্রোফাইলের ১৩টি**
CWV সীমা ছাড়ায় (LCP সর্বোচ্চ ≈৫.৯s; কারণ ক্লায়েন্ট-JS long task ১.২–২.৯s, সার্ভার নয়) — আগের R-7 নিশ্চিত।

---

## ২৬. Load Testing

একটিমাত্র লোকাল `next start` প্রসেস, বড় dataset বসানো অবস্থায় (TESTED, theoretical নয়):

| একসাথে | অনুরোধ | req/s | p50 | p95 | 5xx | ডুপ্লিকেট/oversell |
|---|---|---|---|---|---|---|
| ১০ | ৩০১ | ১৫.১ | ৬৬৫ms | ১.৭s | ০ | ০ |
| ২৫ | ৩১২ | ১৫.৬ | ১.৯s | ৩.০s | ০ | ০ |
| ৫০ | ৩২১ | ১৬.১ | ৪.১s | ৫.৬s | ০ | ০ |
| ১০০ | ৩৪৭ | ১৭.৪ | ৭.০s | ১১.৮s | ০ | ০ |

লগইন-ঢেউ: প্রতি স্তরে ঠিক ১০টি সফল — fail-closed রেট-লিমিট প্রত্যাশিতভাবে বাকিগুলো আটকায়।
থ্রুপুট ≈১৫–১৭ req/s = একটি লোকাল প্রসেসের সীমা; Vercel-এ অনুভূমিক স্কেলিং **পরিমাপ করা হয়নি**।

---

## ২৭. Data Growth

৩,০০,০৩৯ অর্ডার · ১,০১,৫৬০ লগ · ২০,০৪৬ ডিপোজিট · ২১,৬০০ বিজ্ঞপ্তি:
গ্রাহক-পাতা ৯–১০৩ms ✓ · অ্যাডমিন তালিকা ১৮২–৬৯৩ms ✓ · analytics (৯০ দিন) ৪.৭s ·
**`/api/admin/reports?type=orders` (১ বছর) ২৮.৭s / ৪২MB** · **`/api/admin/backup` ৩০s / ৩১৯MB** —
Vercel-এর ফাংশন-সময় ও ৪.৫MB উত্তর-সীমা ছাড়াবে (R-5, মালিক: পরে)।
আগের অডিটের দাবি "backup কেবল কনফিগ ও ক্যাটালগ ফেরায়" **ভুল** ছিল — backup ইউজার/অর্ডার/খতিয়ান/
ডিপোজিট/বিজ্ঞপ্তি/লগ সবই ডাম্প করে (restore-ই কেবল সীমিত)। সংশোধিত। টেস্ট-সারি পরে মুছে ফেলা হয়েছে।

---

## ২৮. Cache/Revalidation

`isr-no-user-leak` — **সত্যিকারের দুই লগইন-সেশনে** (পূর্বশর্ত দাবি: `/api/me → 200`) ক্যাশড পাতায় অন্য
ব্যবহারকারীর তথ্য ০। (এই স্যুটের আগের রিগ-রান ফাঁপা পাস ছিল — H-1 দেখুন।) `stale-data` ১০/১০।

---

## ২৯. Timezone

`timezone-boundary` PASS (ঢাকা ০৩:০০ = আগের UTC দিন) · `dhaka-date` ইউনিট-টেস্ট সবুজ।

---

## ৩০. Cron

নতুন স্যুট **`scripts/verify/cron-jobs.ts`** — আলাদা `next start`, **স্থানীয় এলোমেলো** `CRON_SECRET`
(প্রোডাকশনের মান নয়) ও ভুয়া টেলিগ্রাম টোকেন (কারও চ্যাটে বার্তা যায়নি — সার্ভার-লগে `Not Found`):
- অথ: হেডার ছাড়া/ভুল/এক-অক্ষর বেশি/কম/স্কিম ছাড়া/GET → সব ৪০১, বার্তা কারণ ফাঁস করে না ✓
- `ratelimit-cleanup`: মেয়াদোত্তীর্ণ মোছে, চালু রাখে, দ্বিতীয় রানেও নিরাপদ ✓
- `sla-breach`: প্রতিটি অ্যাডমিন ঠিক একটি বিজ্ঞপ্তি; দ্বিতীয় রানে পুনরাবৃত্তি ০ ✓ · **I-10**: আগের রান চলাকালীন
  পেরোনো ডেডলাইন — পুরনো বিল্ডে `notified=0` (FAIL), নতুনে `notified=1` ✓
- `telegram-scheduler`: বকেয়া জব একবার; ৩টি টিক একসাথে → একবার; সদ্য-চলমান জব ছিনিয়ে নেয় না ✓ · **I-09**: পরিত্যক্ত
  RUNNING — পুরনো বিল্ডে চিরকাল আটকে (FAIL ৩), নতুনে পুনরুদ্ধার, অরফান রান-সারি ০, পরিত্যক্ত জবে ৩টি টিক → ঠিক
  একটি রান; সার্ভার-লগে পুনরুদ্ধার-`warn` প্রতিটি জবে একবারই ✓
- readiness-এর শেষ-রান রেকর্ড তিনটিতেই হালনাগাদ ✓ · **ফল: ২৪/২৪ পাস** (নতুন বিল্ড)

প্রোডাকশন GitHub Actions → Vercel পথ: **NOT VERIFIED** (GitHub secrets `APP_BASE_URL`/`CRON_SECRET` বাইরের কনফিগ)।

---

## ৩১. CI/CD

`ci.yml`: typecheck · lint · build · money-path টেস্ট (নিজস্ব Postgres সার্ভিস) · migrate-guard (লাইভ DB-তে
pending থাকলে লাল — সঠিক) · npm audit (**কেবল রিপোর্ট, কখনো fail নয়** — critical থাকলেও CI সবুজ)।
**I-11:** দুই workflow-এ `permissions: contents: read` যোগ (YAML পার্স ✓; GitHub-এ রান **NOT VERIFIED**)।
Actions ট্যাগে পিন (`@v4`), SHA-তে নয় — LOW, নথিভুক্ত।

---

## ৩২. Deployment

`build` = `prisma generate && next build` — মাইগ্রেশন প্রয়োগ করে না (I-07: `PRODUCTION_CONFIG.md` §৮-এ
সঠিক ক্রম)। বিল্ড-সময়ে Google Fonts ডাউনলোড লাগে (নেটওয়ার্ক egress)। বিল্ডে Neon suspend থাকলে SSG
পাতা try/catch + revalidate দিয়ে নিজেই সেরে যায় (বিল্ড ভাঙে না)।

---

## ৩৩. Security Headers

`headers-seo` **১৩০/১৩০** — nonce CSP (`strict-dynamic`, `unsafe-inline` নেই, `object-src 'none'`,
`frame-ancestors`), nosniff, Referrer-Policy, Permissions-Policy, HSTS, `X-Powered-By` নেই, HTML/JSON-এ
সিক্রেট-আকৃতি নেই। `csp-nonce` prod বিল্ডে: প্রকৃত hydration + ক্লিক-হ্যান্ডলার সাড়া দেয় ✓।

---

## ৩৪. XSS/Injection

`xss-stored` **১২/১২** — ক্ষতিহীন পেলোড প্রোডাক্ট-নাম/বিবরণ/ভ্যারিয়েন্ট/গ্রাহক-নাম/রিভিউ/অ্যাডমিন-নোট/
`playerName`-এ সংরক্ষণ করে ৯টি পাতা + টেলিগ্রাম-টেমপ্লেট প্রিভিউতে রেন্ডার: `window.__xss` সর্বত্র ০।
SQL: সব raw কোয়েরি প্যারামিটারাইজড।

---

## ৩৫. Error Resilience

`resilience` ১৪/১৪ (গেটওয়ে ৫০২, অফলাইন, DB-down) — বাংলা বার্তা, কাঁচা `Failed to fetch` নয় ·
`ratelimit-failclosed` ২২/২২ (অথ-পথ DB-ব্যর্থতায় আটকায়, সাধারণ পথ চলে)।

---

## ৩৬. Observability

JSON লগ (`logger.ts`) · error-স্তরে `errorReporter` (SENTRY_DSN থাকলে, PII/টাকা scrub) · readiness-এ
প্রতিটি cron-এর শেষ-রান ও `stale` · I-09-এর পুনরুদ্ধারে এখন `warn` লগ। ফাঁক: `x-request-id` সার্ভার-লগে
যায় না (R-9); cron ব্যর্থতার উত্তরে কাঁচা ত্রুটি-বার্তা GitHub Actions লগে ছাপা হয় (§৪১)।

---

## ৩৭. SEO

robots.txt ব্যক্তিগত পথ বাদ দেয় · sitemap-এ ব্যক্তিগত পথ নেই · `/admin`, `/account` `noindex` · ৪০৪ পাতা ·
মেটাডেটা — সব `headers-seo`-র অংশ হিসেবে PASS।

---

## ৩৮. Disaster/Recovery

লেনদেনের আসল DR = Neon PITR — **NOT VERIFIED** (বাইরের)। অ্যাপ-backup পুরো ডেটা ডাম্প করে কিন্তু
৩ লাখ অর্ডারে ৩১৯MB/৩০s (R-5); restore কেবল কনফিগ/ক্যাটালগ, checksum-যাচাই, `confirm=RESTORE`, লগড।
টেলিগ্রাম-জব এখন প্রসেস-মৃত্যু থেকে নিজেই সেরে ওঠে (I-09)।

---

## ৩৯. Bugs Found

নিচে প্রতিটি নতুন ত্রুটির পূর্ণ প্রমাণ।

### I-01 · HIGH · Authentication
- **LOCATION:** `src/lib/guard.ts` (`requireUser`), `src/lib/auth.ts` (session callback)
- **REPRODUCTION:** লগইন → দ্বিতীয় ব্রাউজারে একই অ্যাকাউন্টে "সব ডিভাইস থেকে সাইন-আউট" → প্রথম সেশনে `/api/me` ও টাকার API: ৩০১s পর্যন্ত ২০০
- **ROOT CAUSE:** `requireUser()` প্রতি অনুরোধে `isBanned` দেখত কিন্তু `sessionEpoch` নয়; epoch কেবল jwt callback-এ, ৫ মিনিটের থ্রটলে
- **IMPACT:** বেহাত সেশন revoke/রিসেটের পরেও ৫ মিনিট অর্ডার/প্রত্যাহার চালাতে পারত
- **FIX:** session-এ `epoch` (মালিক-অনুমোদিত `auth.ts` পরিবর্তন), `requireUser()` DB-র `sessionEpoch`-এর সাথে মেলায় → অমিলে ৪০১
- **TEST:** `tests/session-revocation.test.ts` (৫) · `red-team-auth` ২২/২২
- **REGRESSION:** Vitest পূর্ণ · api-auth-matrix · state-machine · headers · সব journey — সবুজ · **STATUS: FIXED**

### I-02 · LOW · Input Validation (UX)
- **LOCATION:** সব zod স্কিমা (বার্তাহীন নিয়ম) · **REPRODUCTION:** ৫০০ অক্ষরের নাম → `"String must contain at most 80 character(s)"`
- **ROOT CAUSE:** zod-এর ডিফল্ট ইংরেজি error map · **FIX:** `src/lib/zodBangla.ts` — গ্লোবাল বাংলা error map, কাস্টম বার্তা অক্ষত
- **TEST:** `tests/zod-bangla.test.ts` (৭) · input-fuzz: ইংরেজি বার্তা ০ · **STATUS: FIXED**

### I-03 · MEDIUM · Error handling
- **LOCATION:** `src/lib/guard.ts` (`clientCausedDbError`) · **REPRODUCTION:** string-ID-তে `a\0b` → ৫০০ + error-লগ + ops-অ্যালার্ম
- **ROOT CAUSE:** Postgres `22021` আসে `PrismaClientKnownRequestError` (P2010/P2023) হয়ে; ম্যাপ ছিল কেবল `UnknownRequestError`-এর জন্য
- **FIX:** দুই ধরনেই `22021/22P02/22003` → ৪০০ "অনুরোধের ডেটা সঠিক নয়" · **TEST:** input-fuzz ৫xx ০ · **STATUS: FIXED**

### I-04 · LOW · Input Validation (UX)
- **REPRODUCTION:** `.or(z.literal(''))` ফিল্ডে ভুল টাইপ → `Invalid input` (৬০ বার) · **FIX:** error map-এ `invalid_union`/`invalid_literal` · **STATUS: FIXED**

### I-05 · MEDIUM · Information disclosure
- **LOCATION:** `src/app/api/tickets/route.ts`, `tickets/[id]/route.ts`, `admin/tickets/route.ts`
- **REPRODUCTION:** বিকৃত টিকিট-অনুরোধ → উত্তরে `Invalid prisma.order.findFirst() invocation…`
- **ROOT CAUSE:** রুটগুলো যেকোনো `e.message` হুবহু `ApiError(…, 400)`-এ মুড়ত · **FIX:** সার্ভিস বাংলা `ApiError` ছোঁড়ে, রুট `throw e` → `apiError()` নিরাপদে ম্যাপ করে; বন্ধ টিকিট ৪০৯
- **TEST:** input-fuzz ফাঁস ০ · `tests/tickets.test.ts` (৪০৯ প্রত্যাশা নোটসহ) · **STATUS: FIXED**

### I-06 · MEDIUM · Database integrity
- **REPRODUCTION:** খালি DB-তে `prisma migrate deploy` → `pg_constraint` CHECK = ০ · **ROOT CAUSE:** constraint কেবল আলাদা স্ক্রিপ্টে, কোনো মাইগ্রেশনে বা ডকে নয়
- **FIX:** idempotent মাইগ্রেশন (DROP IF EXISTS + ADD) — মালিক-অনুমোদিত · **TEST:** নতুন DB-তে ৬/৬, drift ০ · লাইভে আগে থেকেই ৬, ভাঙা সারি ০ · **STATUS: FIXED (লাইভে প্রয়োগ বাকি)**

### I-07 · MEDIUM · Deployment
- **REPRODUCTION:** `build` স্ক্রিপ্ট ও CI — কোথাও `migrate deploy` নেই; ডকে ধাপ নেই · **FIX:** `PRODUCTION_CONFIG.md` §৮ রানবুক · CI migrate-guard pending-এ লাল হয় (যাচাই) · **STATUS: FIXED (ডক)**

### I-08 · MEDIUM · Performance
- **REPRODUCTION:** ১ লাখ বিজ্ঞপ্তিতে `EXPLAIN ANALYZE` → Seq Scan ১৭.৪ms / ১১.৩ms · **FIX:** দুটি ইনডেক্স (মালিক-অনুমোদিত) · **TEST:** Index Scan ০.০৭ms / Index Only Scan ৭.৮ms · **STATUS: FIXED (লাইভে প্রয়োগ বাকি)**

### I-09 · MEDIUM · Reliability (Cron/Telegram)
- **LOCATION:** `src/lib/telegram/scheduler.ts` (`tick`, `runJob`)
- **REPRODUCTION:** `TelegramJob` enabled, `nextRunAt` অতীত, `status=RUNNING`, `updatedAt` ৪৫ মিনিট আগে → `/api/cron/telegram-scheduler` → `status=RUNNING runCount=0` (চিরকাল); অরফান রান-সারিও চিরকাল "চলছে" (`cron-jobs.ts`, পুরনো বিল্ডে FAIL ৩টি)
- **ROOT CAUSE:** দাবি = `status ≠ RUNNING`, কিন্তু দাবির কোনো মেয়াদ নেই। প্রসেস মাঝপথে মরলে (Vercel টাইমআউট/ডিপ্লয়), অথবা DB বিচ্ছিন্ন হয়ে `runJob`-এর catch-এর update-ও ব্যর্থ হলে (`.catch(() => {})`) দাবি কেউ ছাড়ে না; tick ও "এখনই চালান" দুটোই চিরকাল এড়িয়ে যায়, প্যানেলে "চলছে"
- **IMPACT:** নির্ধারিত রিপোর্ট/রিমাইন্ডার নীরবে চিরতরে বন্ধ (টাকার উপর প্রভাব নেই)
- **FIX:** ৩০ মিনিটের lease — পুরনো RUNNING আবার দাবিযোগ্য; দাবিতে `updatedAt` স্পষ্টভাবে নতুন (পরমাণুতা অক্ষত); অরফান রান-সারি FAILED; পুনরুদ্ধারে `warn` লগ
- **TEST:** `tests/telegram-scheduler-lease.test.ts` **৫/৫** (পরিত্যক্ত → চলে · ২ মিনিটের RUNNING অক্ষত · ৫টি টিক একসাথে → ১ রান · অরফান সারি FAILED, সাম্প্রতিকটি অক্ষত · MANUAL-ও পুনরুদ্ধার করে) · `cron-jobs.ts` নতুন বিল্ডে সব পাস
- **REGRESSION:** Vitest ৩৭১/৩৭১ · typecheck ০ · lint ০ · build ✓ · রিগ-ব্যাচ (§৪৩) · **STATUS: FIXED**

### I-10 · LOW · Reliability (SLA alert)
- **LOCATION:** `src/app/api/cron/sla-breach/route.ts`
- **REPRODUCTION:** শেষ সফল রান `at=T, ms=5000` (অর্থাৎ শুরু T−5s); একটি PENDING অর্ডারের `slaDueAt = T−2s` → রান → `notified=0`, বিজ্ঞপ্তি ১→১ (পুরনো বিল্ডে FAIL)
- **ROOT CAUSE:** "নতুন ভঙ্গ" = `slaDueAt > prev.at`, কিন্তু `prev.at` রান **শেষের** সময়; সেই রান ভঙ্গ মেপেছিল **শুরুর** ঘড়িতে। মাঝের জানালায় পেরোনো ডেডলাইন কোনো রানেই পড়ে না
- **IMPACT:** আগের রানের সময়কালের মধ্যে পেরোনো অর্ডারের SLA-সতর্কতা হারায় (লোকালে রান ১৩ms — জানালা ছোট; লাইভে প্রতি DB round-trip ≈৭৫০ms আগে মাপা, তাই জানালা কয়েক সেকেন্ড); অর্ডার নিজে অ্যাডমিন-তালিকায় দেরি হিসেবে দেখায়
- **FIX:** `since = prev.at − prev.ms` (= আগের রানের শুরু) · **TEST:** `cron-jobs.ts` — নতুন বিল্ডে `notified=1`, বিজ্ঞপ্তি ১→২; পুনরাবৃত্তি-নিরোধ দাবিও অক্ষত · **REGRESSION:** উপরের মতো · **STATUS: FIXED**

### I-11 · LOW · CI/CD
- **LOCATION:** `.github/workflows/ci.yml`, `cron.yml` · **ROOT CAUSE:** `permissions` ব্লক নেই → `GITHUB_TOKEN`-এর অধিকার রিপো-সেটিং-নির্ভর (পুরনো রিপোতে read-write)
- **FIX:** `permissions: contents: read` (জবগুলো কেবল checkout/curl করে) · **TEST:** js-yaml পার্স ✓ · GitHub-এ রান **NOT VERIFIED** · **STATUS: FIXED**

### যাচাই-হারনেস ও ডকের ত্রুটি (পণ্যের বাগ নয়, কিন্তু মিথ্যা ফল দিত)
- **H-1 · ফাঁপা পাস:** রিগে (`NODE_ENV=production`) সার্ভার `__Secure-next-auth.session-token` পড়ে, কিন্তু স্ক্রিপ্ট-প্রসেস সাধারণ নামে কুকি লিখত → `isr-no-user-leak`-এর "দুই ভিন্ন ব্যবহারকারী" আসলে দুজনেই অতিথি ছিল (মার্কআপ-হ্যাশ হুবহু এক) — শূন্যগর্ভ PASS; `ban-revocation`/`order-price-lock` মিথ্যা লাল। **FIX:** `scripts/verify/_db.ts` রিগ-ঠিকানায় `NODE_ENV=production` স্থির করে; `isr-no-user-leak`-এ পূর্বশর্ত দাবি (`/api/me → 200`) — ফাঁপা সবুজ আর সম্ভব নয়।
- **H-2:** `xss-stored`-এর `playerName` পেলোড ৮০-অক্ষর সীমা ছাড়াত (৪০০ সঠিক ছিল) → পেলোড ছোট; এখন সত্যিই সংরক্ষিত হয়ে ৯ পাতায় রেন্ডার।
- **H-3 · typecheck লাল ছিল:** H-1-এর ফিক্স (`process.env.NODE_ENV = 'production'`) আগের সেশনের
  Phase 38 typecheck-এর **পরে** যোগ হয়েছিল — ফলে `scripts/verify/_db.ts(79)` TS2540 দিত, অথচ শেষ
  রিপোর্টেড typecheck ছিল "০"। এই সেশনে ধরা পড়ে; `@ts-ignore`/`as any` ছাড়া `Object.assign` দিয়ে সারানো,
  typecheck আবার **০**।
- **D-1:** `FINAL_PRODUCTION_GRADE_AUDIT.md` §২০-এর ভুল দাবি (backup কেবল কনফিগ/ক্যাটালগ) সংশোধিত।

---

## ৪০. Bugs Fixed

| ফাইল | পরিবর্তন | ইস্যু |
|---|---|---|
| `src/lib/guard.ts` | প্রতি অনুরোধে `sessionEpoch` যাচাই · null-byte/22xxx → ৪০০ · `zodBangla` import · `readForm()` | I-01, I-03, I-02 |
| `src/lib/auth.ts` · `src/types/next-auth.d.ts` | session-এ `epoch` (মালিক-অনুমোদিত) | I-01 |
| `src/lib/zodBangla.ts` (নতুন) · `src/lib/validation.ts` | গ্লোবাল বাংলা zod error map | I-02, I-04 |
| `src/lib/services/tickets.ts` · ৩টি টিকিট-রুট | `ApiError` + `throw e` | I-05 |
| `prisma/migrations/20260918120000_money_check_constraints/` (নতুন) | ৬টি CHECK | I-06 |
| `PRODUCTION_CONFIG.md` §৮ | migrate deploy রানবুক | I-07 |
| `prisma/schema.prisma` · `prisma/migrations/20260918130000_notification_indexes/` (নতুন) | ২টি ইনডেক্স | I-08 |
| `src/lib/telegram/scheduler.ts` | ৩০ মিনিটের RUNNING-lease, অরফান রান FAILED, পুনরুদ্ধার-লগ | I-09 |
| `src/app/api/cron/sla-breach/route.ts` | `since = at − ms` | I-10 |
| `.github/workflows/ci.yml` · `cron.yml` | `permissions: contents: read` | I-11 |
| `scripts/verify/_db.ts` · `isr-no-user-leak.ts` · `xss-stored.ts` | হারনেস-সংশোধন | H-1, H-2, H-3 |
| `scripts/verify/customer-journey.ts` | লগইনের পরে পয়েন্টার সরানো · ৪০৪-লুপে নেটওয়ার্ক-থামা পর্যন্ত অপেক্ষা (দাবি অপরিবর্তিত) | §২৩ |

**নতুন টেস্ট/স্যুট:** `tests/zod-bangla.test.ts` · `tests/session-revocation.test.ts` ·
`tests/telegram-scheduler-lease.test.ts` · `scripts/verify/{red-team-auth,xss-stored,input-fuzz,cron-jobs}.ts`।
কোনো টেস্ট মোছা/নিষ্ক্রিয় করা হয়নি; একটি প্রত্যাশা (বন্ধ টিকিট ৪০০→৪০৯) নোটসহ বদলানো — অর্থ-সংশোধন, পাস করানোর জন্য নয়।

---

## ৪১. Remaining Issues

| ID | SEVERITY | DESCRIPTION | EVIDENCE | IMPACT | FIX AVAILABLE | FIXED | BLOCKS LAUNCH |
|---|---|---|---|---|---|---|---|
| R-1 | **CRITICAL** | Next.js 14.2.35 advisories (CSP-nonce XSS, SSRF, DoS, RCE) | `npm audit --omit=dev` critical ১ | AVIF-পথ বন্ধ; বাকিগুলো খোলা | YES (major আপগ্রেড) | NO — মালিক: পরে | মালিক: না (প্রশমনসহ) |
| R-2 | **BLOCKER** | লাইভ অ্যাডমিন সিড-পাসওয়ার্ডে, 2FA বন্ধ | read-only যাচাই ২০২৬-০৯-১৮ | পূর্ণ অ্যাডমিন দখল | YES (মালিক) | NO | **YES** |
| R-3 | **BLOCKER** | Resend ডোমেইন/`EMAIL_FROM` অযাচাই | readiness `ready:false` | OTP না গেলে রেজিস্ট্রেশন অসম্ভব | YES (মালিক) | NO | **YES** |
| R-4 | HIGH | প্রোডাকশন Blob টোকেন অযাচাই | readiness blocker | আপলোড/পেমেন্ট-প্রমাণ অচল | YES (মালিক) | NO | ছবি/প্রমাণ দরকার হলে YES |
| R-5 | MEDIUM | **DECISION REQUIRED** — `notifyAdmins`-এর টেলিগ্রাম-পাঠানো await হয় না; Vercel-এ রেসপন্সের পর প্রসেস থামলে সতর্কতা হারাতে পারে | কোড (`notify.ts:37`); আগের ৩টি রিপোর্টে "অমীমাংসিত" | নতুন ডিপোজিট/অর্ডারের অ্যাডমিন-সতর্কতা নীরবে হারানো | YES — বিকল্প নিচে | NO | না |
| R-6 | MEDIUM | বড় export/backup: ২৮.৭s/৪২MB, ৩০s/৩১৯MB (৩ লাখ অর্ডার) | data-growth | Vercel সীমা ছাড়াবে | YES (স্ট্রিমিং/পেজিং) | NO — মালিক: পরে | না |
| R-7 | MEDIUM | সবাইকে ঘোষণা ১ লাখে ৬.৭s (queue নেই) | আগের অডিট | টাইমআউট | YES | NO | না |
| R-8 | MEDIUM | ধীর মোবাইলে ১৩/২৮ প্রোফাইল CWV ছাড়ায় | perf-browser | ধীর প্রথম-দর্শন | আংশিক | NO | না |
| R-9 | LOW | dev-নির্ভরতায় ৯টি advisory (vitest/vite/esbuild/glob) | `npm audit` | কেবল dev/CI মেশিন | YES (major) | NO | না |
| R-10 | LOW | CI `npm audit` কখনো fail করে না | `ci.yml` | critical থাকলেও CI সবুজ | YES | NO — নীতিগত সিদ্ধান্ত | না |
| R-11 | LOW | cron ব্যর্থ হলে কাঁচা ত্রুটি-বার্তা (যেমন DB-হোস্টনাম) উত্তরে → Actions লগে | `cron/*/route.ts` | পাবলিক রিপো হলে হোস্টনাম দৃশ্যমান (সিক্রেট নয়) | YES | NO — ডিবাগ-সুবিধার সাথে ট্রেড-অফ | না |
| R-12 | LOW | পেজিনেশন নেই (অ্যাডমিন ১০০/৩০০, গ্রাহক ৫০) · `x-request-id` লগে নেই · `clientRef`-রেসে Prisma stderr-এ ভুয়া "error" | আগের অডিট | অপারেশনাল | YES | NO | না |
| R-13 | LOW | CI Node 20 · লোকাল 24 · Vercel-এ `engines` নেই | `package.json` | রানটাইম-অমিল সম্ভব | YES | NO — deploy-প্রভাবিত, মালিকের সিদ্ধান্ত | না |
| R-14 | INFO | Neon PITR/ব্যাকআপ; পেমেন্ট-গেটওয়ে স্টাব | — | — | — | — | না |
| R-15 | LOW | প্যাকেজ-কার্ডের hover-lift নিজের hit-box সরায়; মাউস ঠিক কিনারায় থামলে কার্ড অবিরাম কাঁপে (WebKit-এ মাপা; স্পর্শ-ফোনে প্রযোজ্য নয়)। সাথে `transform` দুই মালিকের (framer-motion inline + CSS `transition: transform`) | WebKit প্রোব: ৩s-এ ২০ অবস্থা | ডেস্কটপ Safari-তে দৃশ্যমান কাঁপুনি; ক্লিক কাজ করে | YES — lift ভেতরের wrapper-এ সরানো (`OrderForm.tsx`, চেকআউট-UI) | NO — ডিজাইন/চেকআউট-UI, মালিকের সিদ্ধান্ত | না |
| R-16 | LOW | আসল Firefox-এ F5-এর পরে Back — Playwright-Firefox নির্ভরযোগ্যভাবে মাপতে পারে না (reload টাইমআউট, Target crashed) | §২৩ | অজানা | — | — | না — **NOT VERIFIED** (হাতে যাচাই) |

**R-5 — DECISION REQUIRED:**
- *বর্তমান:* `sendTelegramAdmin(...).catch(() => {})` — await নয়, যাতে টাকার রেসপন্স আটকে না যায়।
- *সমস্যা:* serverless-এ রেসপন্সের পরের কাজ নিশ্চিত নয়; স্থানীয় `next start`-এ এটি পরীক্ষাযোগ্য নয় (**NOT VERIFIED** on Vercel)।
- *নিরাপদ বিকল্প:* (ক) `@vercel/functions`-এর `waitUntil(...)` — নতুন নির্ভরতা, রেসপন্সে দেরি নেই (প্রস্তাবিত);
  (খ) সীমিত-সময় await (যেমন ≤১.৫s) — নির্ভরতা নেই, কিন্তু অর্ডার/ডিপোজিট রেসপন্সে দেরি যোগ হয়;
  (গ) যেমন আছে — ইন-অ্যাপ বিজ্ঞপ্তি (await করা) সবসময় থাকে, টেলিগ্রাম best-effort।
- *নিরাপত্তা/ডেটা প্রভাব:* টাকা বা খতিয়ানে কোনো প্রভাব নেই — কেবল অ্যাডমিন-সতর্কতার নির্ভরযোগ্যতা।

---

## ৪২. External Blockers

| স্তর | অবস্থা |
|---|---|
| **CODE READY** | ✅ — §৪৪-এর সব কোড-গেট সবুজ |
| **PRODUCTION CONFIGURATION READY** | ❌ — লাইভ DB-তে ২টি মাইগ্রেশন বাকি (`20260918120000_money_check_constraints`, `20260918130000_notification_indexes`); অ্যাডমিন-পাসওয়ার্ড; `EMAIL_FROM`; Blob টোকেন; GitHub secrets |
| **EXTERNAL SERVICE VERIFIED** | ❌ — Resend ডোমেইন · Vercel env · Blob · GitHub Actions cron · Neon PITR · OAuth · কাস্টম ডোমেইন — সবই **NOT VERIFIED** |

মাইগ্রেশন দুটি কোডের জন্য বাধ্যতামূলক নয় (কোড constraint বা ইনডেক্সের উপর নির্ভর করে না), তাই deploy-ক্রম
যাই হোক কিছু ভাঙবে না; কিন্তু CI `migrate-guard` প্রয়োগের আগে পর্যন্ত লাল থাকবে।

---

## ৪৩. Test Matrix

সব ফিক্সের **পরে**, নতুন বিল্ডে (২০২৬-০৯-১৯), এই ক্রমে: generate → typecheck → lint → Vitest → build → রিগ → dev-server।

| স্তর | স্যুট | ফল |
|---|---|---|
| স্ট্যাটিক | `prisma generate` · `typecheck` · `lint` | ✅ · **০ ত্রুটি** · **০ সতর্কতা** |
| ইউনিট/ইন্টিগ্রেশন | Vitest (টেস্ট-DB, নিজস্ব Postgres) | **৩৭১/৩৭১** (৩৬ ফাইল) |
| বিল্ড | `next build` | ✅ ৯৩/৯৩ পাতা |
| রিগ (`next start` + TLS) | api-auth-matrix · state-machine · headers-seo | ২১০/২১০ · ৩০/৩০ · ১৩০/১৩০ |
| | red-team-auth · input-fuzz · security-probes · malformed-requests | ২২/২২ · ৯/৯ · ২২/২২ · ৫০০ = ০ |
| | xss-stored · upload-security | ১২/১২ · ১৫/১৫ |
| | customer-journey · admin-journey · business-flow-e2e · prod-auth-e2e | ৫৯/৫৯ · ৭২/৭২ · ৩০/৩০ · ৫৮/৫৮ |
| | double-submit · resilience · stale-data · timezone-boundary | ১৬/১৬ · ১৪/১৪ · ১০/১০ · ২/২ |
| | order-price-lock · ban-revocation · ip-spoofing · ratelimit-failclosed | ১৪/১৪ · ১৪/১৪ · ৮/৮ · ২২/২২ |
| | isr-no-user-leak (সত্যিকারের দুই সেশন) · csp-nonce (hydration) | ৯/৯ · ১৫/১৫ |
| | **cron-jobs** (নতুন; আলাদা `next start`, স্থানীয় সিক্রেট) | **২৪/২৪** |
| | responsive — ২ থিম × ৫২ persona×viewport | সব কাউন্টার **০** |
| | cross-browser — WebKit গ্রাহক / অ্যাডমিন · Firefox গ্রাহক | ৫৯/৫৯ · ৭১/৭২ (ব্যাখ্যাত) · ৫৮/৫৯ (ব্যাখ্যাত) |
| dev-server | route-guard-audit · no-live-writes · integrations · theme-meta-token | অরক্ষিত ০/৮০ · ১৫/১৫ · ১৯/১৯ · ১৪/১৪ |
| | theme-contrast | ১৫১/১৫২ — একমাত্র লাল পুরনো থিম-টাস্কের "HEAD-এর তুলনায় ০টি TSX বদল" দাবি (অকমিটেড গাছে আগের অডিটের TSX আছে); সব কনট্রাস্ট-দাবি সবুজ |
| ডেটা | money-invariants (ডেভ DB, লক্ষ্য `localhost:5434` যাচাই করে) | **১৮/১৮** |
| লাইভ (read-only) | `verify:migrate-status` | ১২টি প্রয়োগ · **২টি বাকি** (এই অডিটের) |

আগের রানের (একই অডিট, ফিক্স-পূর্ব বিল্ড) যা এবার পুনরায় চালানো হয়নি এবং কেন: perf-browser, load-test, data-growth
(ফিক্স দুটি কেবল cron-পথে; এদের মাপা পথ অপরিবর্তিত — ফল §২৫–২৭), semantic-tokens/storefront-contrast/a11y-scan/
interaction-sweep/slow-network/support-flow-e2e/mobile-nav-logout (UI অপরিবর্তিত — ফল §২০, §২৪)।

---

## ৪৪. Final Quality Gates

| গেট | ফল |
|---|---|
| CRITICAL BUGS = 0 (কোডে) | ✅ — খোলা CRITICAL কেবল নির্ভরতা (R-1, Next.js; মালিকের সিদ্ধান্তে আপগ্রেড পরে) |
| HIGH SECURITY ISSUES = 0 | ✅ (I-01 সারানো) |
| BROKEN CUSTOMER / ADMIN CRITICAL FLOWS = 0 | ✅ ৫৯/৫৯ · ৭২/৭২ · business ৩০/৩০ |
| UNAUTHORIZED ACCESS = 0 | ✅ ২১০/২১০ · অরক্ষিত রুট ০ · IDOR-দাবি সব সবুজ |
| DUPLICATE ORDERS / TRANSACTIONS = 0 | ✅ লোড ১০০ ও double-submit |
| MONEY CALCULATION BUGS = 0 | ✅ money-invariants ১৮/১৮ · খতিয়ান-অভেদ |
| CRITICAL DATA CORRUPTION = 0 | ✅ CHECK constraint এখন মাইগ্রেশনে |
| CRITICAL STATE MACHINE VIOLATIONS = 0 | ✅ ৩০/৩০ |
| PRODUCTION BUILD · TYPECHECK · LINT | ✅ · ✅ (০) · ✅ (০) |
| CRITICAL TESTS · CRITICAL PLAYWRIGHT | ✅ ৩৭১/৩৭১ · ✅ |
| MOBILE · DESKTOP CRITICAL FLOWS | ✅ ১০৪ persona×viewport, ০ ত্রুটি |
| PRODUCTION RUNTIME | ✅ (`next start` + TLS, লোকাল) — Vercel-এ **NOT VERIFIED** |
| UNHANDLED CRITICAL ERRORS = 0 | ✅ fuzz/malformed-এ ৫xx ০ |

---

## ৪৫. Final Release Decision

## **NO-GO**

**CODE READY: হ্যাঁ।** এই রাউন্ডের ১১টি ত্রুটি সারানো ও রানটাইমে যাচাই; কোড-স্তরের প্রতিটি গেট সবুজ।

**কিন্তু GO-এর শর্ত "লঞ্চ-আটকানো বাইরের কনফিগ যাচাই" পূরণ হয়নি** — নরম করে GO বলা অসৎ হতো:

1. **R-2 BLOCKER** — লাইভ অ্যাডমিন সিড-পাসওয়ার্ডে, 2FA বন্ধ
2. **R-3 BLOCKER** — Resend ডোমেইন/`EMAIL_FROM` অযাচাই (OTP ছাড়া রেজিস্ট্রেশন অসম্ভব)
3. **লাইভ DB-তে ২টি মাইগ্রেশন বাকি** — `migrate-guard` লাল থাকবে
4. R-1 CRITICAL (Next.js) — মালিকের সিদ্ধান্তে প্রশমনসহ স্থগিত; লঞ্চ-আটকানো নয় বলে গৃহীত, কিন্তু খোলা
5. R-4 Blob টোকেন — পেমেন্ট-প্রমাণ/ছবি আপলোড লাগলে আটকায়

### MANUAL ACTION REQUIRED (আপনার করণীয়)

**১. লাইভ অ্যাডমিন নিরাপদ করুন** — লাইভ সাইট → `/account/profile` → পাসওয়ার্ড বদলান → 2FA চালু → "সব ডিভাইস থেকে সাইন-আউট"।
যাচাই: রিপোতে লেখা পুরনো পাসওয়ার্ডে লগইন **ব্যর্থ**; `/admin/logs`-এ `LOGIN` ও `TWO_FACTOR_ENABLE`।
(I-01-এর পরে "সব ডিভাইস থেকে সাইন-আউট" এখন সাথে সাথে কার্যকর।)

**২. লাইভ DB-তে মাইগ্রেশন** — `PRODUCTION_CONFIG.md` §৮ অনুযায়ী: `npm run db:migrate:deploy` → `npm run verify:migrate-status`
(দুটিই সবুজ হওয়া চাই)। constraint-মাইগ্রেশন idempotent (DROP IF EXISTS + ADD) — লাইভে ৬টি আগে থেকেই আছে, ভাঙা সারি ০;
ADD CONSTRAINT সব সারি যাচাই করে, তাই কম ট্রাফিকে চালান। কোড এগুলোর উপর নির্ভর করে না — deploy আগে-পরে যেকোনো ক্রমে নিরাপদ।

**৩. ইমেইল/OTP** — Resend-এ ডোমেইন verify (SPF/DKIM) → Vercel env: `RESEND_API_KEY`, `EMAIL_FROM` (verify-করা ডোমেইন),
`NEXTAUTH_URL` (https)। যাচাই: `GET /api/admin/readiness` → `ready: true`, তারপর একটি আসল রেজিস্ট্রেশনে OTP পাওয়া।

**৪. Blob (দরকার হলে)** — Vercel → Storage → Blob → `BLOB_READ_WRITE_TOKEN`; প্রোডাকশনে `STORAGE_DRIVER=local` দেবেন না।

**৫. Cron** — GitHub → Settings → Secrets → Actions: `APP_BASE_URL`, `CRON_SECRET` (Vercel-এর হুবহু মান)।
যাচাই: Actions → "Cron Jobs" → Run workflow → `all` → সবুজ; readiness-এ "কখনো চলেনি" চলে যাবে।

**৬. সিদ্ধান্ত দরকার (লঞ্চ আটকায় না)** — R-5 টেলিগ্রাম-সতর্কতার `waitUntil` (নতুন নির্ভরতা `@vercel/functions`) ·
R-15 প্যাকেজ-কার্ডের hover-কাঁপুনি সারাতে চেকআউট-UI বদলানো · R-10 CI-তে critical advisory থাকলে fail করানো ·
R-13 `engines.node` নির্দিষ্ট করা · Next.js major আপগ্রেডের সময়সূচি (R-1)।

**৭. আসল Firefox-এ হাতে একবার** — যেকোনো পাতা → অন্য পাতা → F5 → Back: আগের পাতায় ফেরে কিনা (R-16)।

এগুলো সম্পন্ন হলে জানালে readiness, আসল রেজিস্ট্রেশন-ফানেল, আপলোড ও `migrate-status` আবার চালিয়ে GO/NO-GO হালনাগাদ করব।

---

### এই অডিটে যা **করা হয়নি** (সততার জন্য)
- কিছু কমিট/পুশ/ট্যাগ করা হয়নি; লাইভ DB-তে কিছু লেখা হয়নি (কেবল read-only migrate-status)।
- কোনো প্রোডাকশন সিক্রেট পড়া/ছাপা/ব্যবহার হয়নি — cron-পরীক্ষায় স্থানীয় এলোমেলো মান, টেলিগ্রামে ভুয়া টোকেন।
- ডেভ DB-তে বসানো ৩ লাখ `grw_` টেস্ট-সারি ও সব প্রোব-সারি মুছে ফেলা হয়েছে।
