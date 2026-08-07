# PROGRESS — autonomous run (RUN.md)

**শুরু:** ৭ আগস্ট ২০২৬
**নিয়ম:** `CLAUDE.md` বহাল। প্রতিটি টাস্কে — ফাইল পুরো পড়া → ছোট
সঠিক পরিবর্তন → `scripts/verify/`-এ চলমান যাচাই → চারটি চেক →
commit → এখানে এক লাইন।

চিহ্ন: `[x]` সম্পন্ন · `[!]` বাদ (কারণসহ) · `[~]` আংশিক

---

## সেশন-০ প্রেক্ষাপট (এই রানের আগে, একই দিনে)

আগের সেশনগুলোতে যা হয়ে গেছে — পুনরায় করা হবে না:

```
[x] Blob storage — টোকেন যাচাই, ৭ পৃষ্ঠ, ১টি লিগ্যাসি ফাইল স্থানান্তর — BLOB_VERIFICATION_REPORT.md
[x] লগইন লক-আউট বাগ — সফল লগইন আর rate-limit গুনতে যায় না — AUTH_AND_NOTIFICATION_FIX_REPORT.md
[x] টোস্ট/alert দৃশ্য-ত্রুটি — টোকেন-ভিত্তিক, দুই থিমে AA
[x] C1 — সিক্রেট: .env.bak মুছে, .gitignore `.env*`, package-release.mjs, SECRET_ROTATION_CHECKLIST.md
[x] C2 — cron: GitHub Actions ৩ জব, assertCronAuth, jobRuns, readiness jobs[]
[x] C3 — সেমান্টিক রঙ: --sem-success/warning/danger/info, দুই থিমে আলাদা
```

---

## এই রানের অগ্রগতি

```
[x] G0 — git init + বেসলাইন commit — 2026-08-07 — .env ignored যাচাই করা (git check-ignore)
[x] C4 — rate limiter fail-closed on auth — 2026-08-07 — prisma/tsc/lint/build ok — verify: scripts/verify/ratelimit-failclosed.ts 20/20
[x] C5 — ban/epoch revalidation throttled to 5 min + null session when revoked — 2026-08-07 — prisma/tsc/lint/build ok — verify: ban-revocation.ts 14/14, route-guard-audit.ts 0 gaps
[x] H1 — order price/costPrice from the locked row (+ coupon lock on /order/direct) — 2026-08-07 — prisma/tsc/lint/build ok — verify: order-price-lock.ts 13/13, test:money 18/18
[x] H2 — getIp() ignores client x-forwarded-for unless TRUSTED_PROXY — 2026-08-07 — prisma/tsc/lint/build ok — verify: ip-spoofing.ts 8/8
[x] H3 — nonce+hash CSP; script-src থেকে unsafe-inline, img-src থেকে বেয়ার https: সরানো — 2026-08-07 — prisma/tsc/lint/build ok — verify: csp-nonce.ts 15/15 (dev **ও** prod), audit-pages 32 পাতা ০ ত্রুটি
[x] M1 M2 M5 — মিথ্যা থিম-মন্তব্য, --gold ডকুমেন্টেশন, theme-color টোকেন থেকে (+ mount বাগ) — 2026-08-07 — prisma/tsc/lint/build ok — verify: theme-meta-token.ts 11/11
[~] M6 — ISR — **ঘোষণা আগে থেকেই ছিল**; নিরাপত্তা-দাবি প্রমাণিত, কিন্তু ISR কার্যত নিষ্ক্রিয় — 2026-08-07 — verify: isr-no-user-leak.ts 9/9
[~] RUN PAUSED — context সীমা (RUN.md §"THE ONLY THREE REASONS TO STOP" নং ৩) — 2026-08-07
```

### M6 (ISR) — CLAUDE.md-এর দাবিটি **বাসি**, এবং আসল সমস্যা ভিন্ন

CLAUDE.md §3.3 M6 বলে: *"Almost every page is force-dynamic. Catalog/
product pages should use ISR (revalidate: 300)."* — **এটি আর সত্য নয়।**
সোর্স অডিট (৩৩টি `page.tsx`):

| পাতা | ঘোষণা |
|---|---|
| `/` (হোম) | `revalidate = 60` ✅ |
| `/product/[id]/[slug]` | `revalidate = 60` ✅ (৩০০ নয় — **আরও ভালো**) |
| faq · terms · refund · privacy | `revalidate = 3600` ✅ |
| contact | `revalidate = 300` ✅ |
| প্রতিটি `force-dynamic` | কেবল `/admin/*` ও `/account/*` — **সঠিকভাবেই** |

অর্থাৎ ঘোষণামূলক কাজটি আগেই হয়ে গেছে; `300` বসালে বরং **খারাপ** হতো
(দাম ৫ মিনিট বাসি থাকত, এখন ১ মিনিট)।

**RUN.md যা চেয়েছিল — "first prove no user-specific data leaks" — সেটি
এখন প্রকৃতপক্ষে প্রমাণিত** (`scripts/verify/isr-no-user-leak.ts`,
প্রোডাকশন বিল্ডে):

- দুই ভিন্ন ব্যবহারকারীর (ভিন্ন নাম/ইমেইল/ব্যালেন্স) রেন্ডার করা
  **মার্কআপ byte-for-byte অভিন্ন** → পরিচয় ক্যাশে যায় না
- কারো নাম, ইমেইল বা ব্যালেন্স HTML-এ নেই (স্ক্রিপ্টসহ সম্পূর্ণ
  HTML স্ক্যান করা)
- locale বদলালে HTML বদলায় → এক ভাষার ক্যাশ অন্য ভাষাকে দেওয়া হচ্ছে না

কোডের মন্তব্যে দাবি ছিল "ব্যালেন্স ক্লায়েন্ট-সাইডে আসে, তাই ক্যাশ
নিরাপদ" — দাবিটি এতদিন **অপরীক্ষিত** ছিল; এখন মাপা।

#### ⚠️ আসল অসম্পূর্ণতা: ISR ঘোষিত কিন্তু **কার্যকর নয়**

প্রোডাকশন বিল্ডে মাপা — `/` ও product পাতা দুটোতেই
`x-nextjs-cache` হেডার **অনুপস্থিত**, অর্থাৎ পাতা প্রতি-অনুরোধে
রেন্ডার হচ্ছে; `revalidate = 60` কার্যত নিষ্ক্রিয়।

কারণ: রুট `layout.tsx` → navbar সেশন পড়ে (guest বনাম লগ-ইন HTML
আলাদা — যাচাইয়েই দেখা গেছে), আর `cookies()` দিয়ে locale পড়ে।
যেকোনো একটিই পুরো রুটকে dynamic করে দেয়।

**সারানোর পথ (পরের সেশন, বড় কাজ):** navbar-এর auth-অবস্থা ও locale
সার্ভার-রেন্ডার থেকে সরিয়ে ক্লায়েন্ট কম্পোনেন্টে নিতে হবে, যাতে
শেল ক্যাশযোগ্য হয়। এটি লেআউট-স্তরের স্থাপত্য পরিবর্তন — "ছোট ফিক্স"
নয়, তাই এই রানে করা হয়নি। উপকার: হোম ও প্রোডাক্ট পাতার TTFB ও
Neon-চাপ দুটোই কমবে (H4-এর সাথে সম্পর্কিত)।

### H3 — আংশিক: `style-src` এখনো `'unsafe-inline'`

**ঠিক হয়েছে বলা হচ্ছে না।** Next/Tailwind ও framer-motion রানটাইমে
ইনলাইন `style` বসায় (অ্যানিমেশনের প্রতিটি ফ্রেমে), nonce দিয়ে সেগুলো
ঢাকা যায় না। স্টাইল-ইনজেকশন স্ক্রিপ্টের তুলনায় অনেক কম বিপজ্জনক,
তবু এটি খোলা। সারাতে হলে framer-motion সরানো বা CSS-in-JS নীতি বদলানো
লাগবে — আলাদা কাজ।

**যা মাপা হয়েছে (অনুমান নয়):** nonce প্রথমে ইনলাইন থিম-স্ক্রিপ্টেও
বসানো হয়েছিল → React `Prop nonce did not match` hydration mismatch দেয়
(প্রতি-অনুরোধে nonce আলাদা, কিন্তু layout RSC পে-লোডেও যায়)। তাই ওই
স্ক্রিপ্ট এখন **SHA-256 হ্যাশ** দিয়ে অনুমোদিত। RUN.md-এর fallback
(script-src ফিরিয়ে নেওয়া) **লাগেনি** — hydration অক্ষত, dev ও prod
দুটিতেই ০ CSP লঙ্ঘন।

---

## ⏸️ রান থামানো হয়েছে — কেন ও কোথা থেকে শুরু করবেন

**কারণ:** context ফুরিয়ে আসছে (RUN.md-এর ৩ নং বৈধ কারণ)।
কোনো চেক ব্যর্থ হয়নি, কোনো টাস্ক ব্লকড নয়।

### পরবর্তী টাস্ক: **H4 — polling load**

`src/components/Navbar.tsx` ৬০s আর `src/components/AutoRefresh.tsx` ৩০s
অন্তর পোল করে; Neon-এ সংযোগ-সীমা ও auto-suspend আছে।
- `/api/stream` — SSE, notification-count ও order-status পুশ করবে
- `EventSource` না থাকলে ১২০s পোলিং-এ fallback
- `visibilitychange` — ব্যাকগ্রাউন্ড ট্যাব সম্পূর্ণ থামবে
- যাচাই: ২ মিনিটে DB কোয়েরি গুনুন — আগে ও পরে

### এরপর, RUN.md-এর ক্রমে

| গ্রুপ | বাকি |
|---|---|
| B | H4 (SSE) · M6-এর অবশিষ্ট (লেআউট ক্যাশযোগ্য করা — বড় কাজ) |
| C | লাইট থিম (CLAUDE.md §5, এক atomic পরিবর্তন) |
| D | Vitest + টেস্ট Postgres — **E-এর আগেই**, RUN.md স্পষ্ট |
| E | পেমেন্ট গেটওয়ে অবকাঠামো (credentials ছাড়া) |
| F | রিসেলার টিয়ার (schema migration) |
| G | অটো-ফুলফিলমেন্ট অ্যাডাপ্টার |
| H | riskSignals · errorReporter sink · Redis |
| I | ৭টি ফিচার |

### পুনরায় শুরু করার নিয়ম

1. এই ফাইল পড়ুন, প্রথম অসম্পূর্ণ লাইন থেকে ধরুন — **কোনো `[x]` আবার করবেন না**
2. `npm run dev` চালু আছে কিনা দেখুন
3. `scripts/verify/` এর সব স্ক্রিপ্ট একবার চালিয়ে বেসলাইন নিশ্চিত করুন

### বর্তমান বেসলাইন (৭ আগস্ট, রান থামার সময়)

```
scripts/verify/ratelimit-failclosed.ts   22 পাস · ০ ব্যর্থ
scripts/verify/route-guard-audit.ts      ৪৩ রুট · ০ অরক্ষিত
scripts/verify/ban-revocation.ts         14 পাস · ০ ব্যর্থ
scripts/verify/order-price-lock.ts       14 পাস · ০ ব্যর্থ
scripts/verify/ip-spoofing.ts             8 পাস · ০ ব্যর্থ
scripts/verify/csp-nonce.ts              15 পাস · ০ ব্যর্থ (dev ও prod)
scripts/verify/theme-meta-token.ts       11 পাস · ০ ব্যর্থ
scripts/verify/isr-no-user-leak.ts        9 পাস · ০ ব্যর্থ (prod build)
scripts/audit-pages.ts                   ৩২ পাতা · ০ সমস্যা
npm run test:money                       18 পাস · ০ ব্যর্থ
prisma generate · typecheck · lint · build — চারটিই পরিষ্কার
```

### ⚠️ মালিকের জন্য — এই রানে যোগ হওয়া হাতে-করার কাজ

- **`TRUSTED_PROXY`** (নতুন, H2) — Vercel-এ **খালি রাখুন**। প্রক্সি ছাড়া
  স্থাপনায় `1` দেবেন না।
- আগের রানের বাকি কাজ অপরিবর্তিত: GitHub Actions সিক্রেট
  (`APP_BASE_URL`, `CRON_SECRET`) ও `SECRET_ROTATION_CHECKLIST.md`।

### C5 — রুট-গার্ড অডিটের ফল

৪৩টি API রুট · **০টি অরক্ষিত**। গার্ডহীন ৯টি রুট ইচ্ছাকৃতভাবে পাবলিক,
প্রতিটির কারণ `scripts/verify/route-guard-audit.ts`-এ লেখা:

| রুট | কেন পাবলিক |
|---|---|
| `/api/auth/[...nextauth]` | NextAuth handshake |
| `/api/auth/2fa-check` | লগইনের আগে; নিজস্ব rate-limit + fail-closed |
| `/api/auth/login-status` | কেবল বাকেট পড়ে |
| `/api/auth/forgot` · `/api/auth/reset` | লগ-আউট অবস্থায় দরকার; IP rate-limit |
| `/api/register` | সংজ্ঞা অনুযায়ী অননুমোদিত |
| `/api/track` | অর্ডার নং + ফোন; কড়া IP rate-limit |
| `/api/health` | আপটাইম প্রোব |
| `/api/webhooks/payment/[provider]` | স্বাক্ষর যাচাই |

⚠️ **যাচাইয়ের সময় পাওয়া বাড়তি তথ্য:** ব্যান API স্তরে **তাৎক্ষণিক**
কার্যকর (`requireUser()` প্রতিটি কলে `isBanned` দেখে → ৪০৩)। ৫-মিনিটের
উইন্ডোটি কেবল টোকেন/middleware স্তরের, কারণ middleware edge-এ চলে ও DB
দেখে না — এটিই নকশা।
