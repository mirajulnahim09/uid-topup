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
[x] H4 — লুকানো ট্যাবে পোলিং বন্ধ, ৬০s→১২০s, ঐচ্ছিক SSE (/api/stream) — 2026-08-07 — prisma/tsc/lint/build ok — verify: polling-load.ts 8/8
[x] GROUP C — লাইট থিম (CLAUDE.md §5 সম্পূর্ণ, এক atomic পরিবর্তন) — 2026-08-08 — prisma/tsc/lint/build ok — verify: theme-contrast.ts (২ থিম × ৫ প্রিসেট) সব পাস
[x] a11y সিদ্ধান্ত (মালিক) — বর্ডার/ফোকাস-রিং কৌশল + dark প্রিসেট ≥৪.৫:১ — 2026-08-08 — verify: theme-contrast.ts সব পাস
[x] হারনেস বাগ — `spawnSync('npx.cmd')` Node 24-এ EINVAL, নীরবে exit 1; এখন node দিয়ে সরাসরি — 2026-08-08 — prisma/tsc/lint/build ok
[x] GROUP D — HTTP ইন্টিগ্রেশন টেস্ট (order/deposit/refund/ledger/auth) — 2026-08-08 — prisma/tsc/lint/build ok — verify: npm test 40/40
[~] RUN PAUSED — context সীমা (RUN.md §"THE ONLY THREE REASONS TO STOP" নং ৩) — 2026-08-08
```

### GROUP D — টেস্ট (২০২৬-০৮-০৮, Docker চালু হওয়ার পর)

**শৈলী (মালিকের সিদ্ধান্ত):** রুট-হ্যান্ডলার সরাসরি না ডেকে **HTTP**,
টেস্ট DB-তে চলা আসল অ্যাপের বিরুদ্ধে। double-spend ও coupon-race
টেস্টের উদ্দেশ্যই middleware + NextAuth + লক — হ্যান্ডলার সরাসরি
ডাকলে ঠিক সেই স্তরগুলোই বাদ পড়ত।

| ফাইল | টেস্ট | কী প্রমাণ করে |
|---|---|---|
| `tests/auth-boundary.test.ts` | ৬ | লগইন ছাড়া টাকার রুট ৪০১ · ইউজার→অ্যাডমিন রুট ৪০৩ · ব্যান তাৎক্ষণিক |
| `tests/order.test.ts` | ১০ | happy · অপর্যাপ্ত ব্যালেন্স · স্টক শেষ · double-spend · কুপন race · **H1 লক-প্রমাণ** |
| `tests/deposit.test.ts` | ১০ | approve · reject · ডুপ্লিকেট TrxID · double-approve (২ ও ৫ সমান্তরাল) |
| `tests/refund.test.ts` | ৯ | আংশিক · পূর্ণ · over-refund · সমান্তরাল ফেরত দাম ছাড়ায় না |
| `tests/ledger-invariant.test.ts` | ৫ | ১০০ এলোমেলো অপারেশনের পর `SUM == balance` |

**দুটি নিরাপত্তা-গার্ড, কারণ টেস্ট প্রতিটি টেবিল truncate করে:**
1. `tests/helpers/testEnv.ts` — হোস্ট localhost **ও** নাম `_test` (একটিই উৎস)
2. `tests/globalSetup.ts` — canary ইউজার কেবল টেস্ট DB-তে বানিয়ে HTTP লগইন;
   সফল না হলে **একটি টেস্টও চলে না**। "মেপে দেখেছি" নয়, প্রমাণ।

⚠️ **অপসারিত গার্ড:** "টেস্ট URL ≠ `DATABASE_URL`" শর্তটি বাদ — আমাদের
নিজেদের হারনেস ইচ্ছাকৃতভাবে `DATABASE_URL` কে টেস্ট URL বানায়, তাই
শর্তটি সবসময় সত্য হতো। পুরনো কোডে এটি ধরা পড়েনি কারণ `catch` নিজের
throw করা Error-টিই গিলে ফেলত — গার্ডটি লেখা ছিল, কার্যত নিষ্ক্রিয়।

⚠️ `next dev`, `next start` নয় — প্রোডাকশন বিল্ডে কুকি
`__Secure-next-auth.session-token` + `secure:true`, তাই http://127.0.0.1-এ
সেশন কুকি টিকত না ও প্রতিটি অথ-টেস্ট **মিথ্যা** ফেল করত।

### a11y সিদ্ধান্ত (মালিকের নির্দেশ, 8 আগস্ট)

**বর্ডার-কৌশল — ইচ্ছাকৃত, ঘাটতি নয়:**
কার্ডের hairline (`--v-edge2`) §5.4 অনুযায়ী **নরমই** থাকে (~১.৪–১.৬:১)।
WCAG 1.4.11 প্রতিটি সাজসজ্জার রেখায় ৩:১ চায় না — চায় সেখানে যেখানে
**উপাদান চেনা** বা **অবস্থা বোঝা** ওই রেখার উপর নির্ভরশীল। তাই ঠিক
সেই দুটি জায়গা শক্ত করা হয়েছে:

| | dark | light | দাবি |
|---|---|---|---|
| ইনপুট বর্ডার (`--v-edge-field`, নতুন টোকেন) | 3.82 | 3.93 | ≥3:1 ✅ |
| ফোকাস রিং (`--v-focus-ring`, নতুন টোকেন) | 6.98 | 6.74 | ≥3:1 ✅ |
| কার্ড hairline (`--v-edge2`) | 1.62 | 1.40 | নরম — by design |

ফোকাস-রিং আগে ছিল `rgba(139,92,246,.22)` — প্রায় অদৃশ্য, ২:১-ও নয়।
checker এখন রিং ও ইনপুট-বর্ডার **enforce** করে, আর hairline "নরমই
আছে (≤2.2)" assert করে — অর্থাৎ অকারণে গাঢ় হয়ে গেলেও ধরা পড়বে।

**dark প্রিসেট বোতাম — সারানো হয়েছে (§5-এর বাইরে, কিন্তু বাস্তব):**

| প্রিসেট | আগে | এখন |
|---|---|---|
| purple | 4.23 ✗ | **5.70** ✅ |
| blue | 3.68 ✗ | **6.70** ✅ |
| red | 3.67 ✗ | **6.29** ✅ |
| lime / orange | 16.02 / 8.71 | অপরিবর্তিত ✅ |

প্রতিটির `--accent` এক ধাপ গাঢ়, সাথে `--accent-2`/`--accent-strong`/
`--accent-glow` মিলিয়ে সরানো। `--accent-text` অপরিবর্তিত।

### Group D — যা আছে, যা নেই

**অবকাঠামো সম্পূর্ণ ও প্রোডাকশন-নিরাপদ:**
- `docker-compose.test.yml` — `postgres:16`, পোর্ট **5433**, tmpfs
- `vitest.config.ts` — ক্রমিক (singleFork), কারণ টেস্ট একই DB ভাগ করে
- `vitest.setup.ts` — প্রতিটি টেস্টের আগে TRUNCATE + **তিন-স্তরের গার্ড**
- `scripts/test-run.mjs` — গার্ড → কনটেইনার পরীক্ষা → `db push` → vitest
- `.github/workflows/ci.yml` — নিজস্ব postgres সার্ভিস কনটেইনার
- `tests/ledger-invariant.test.ts` — ৫টি টেস্ট, RUN.md-এর ১০০-অপারেশন
  invariant সহ

**⚠️⚠️ চালানো যায়নি — এই মেশিনে Docker নেই** (`docker: unavailable`)।
`npm test` চালিয়ে দেখা গেছে গার্ড ঠিকমতো **থামায়** ও পরিষ্কার
নির্দেশনা দেয়; লাইভ Neon-এ fallback করে না। কিন্তু টেস্টগুলো
**একবারও চলেনি** — তাই "টেস্ট পাস করে" বলা যাবে না। tsc/lint/build
পরিষ্কার, অর্থাৎ কেবল compile-প্রমাণ।

**পরের সেশনে প্রথম কাজ:** Docker Desktop চালু করে
`npm run test:db:up && npm test` — তারপর বাকি কভারেজ লিখুন:
- Order: happy path · অপর্যাপ্ত ব্যালেন্স · স্টক শেষ · সমান্তরাল
  double-spend · কুপন over-limit race
- Deposit: approve · reject · ডুপ্লিকেট TrxID · double-approve
- Refund: আংশিক · সম্পূর্ণ · over-refund প্রত্যাখ্যান

⚠️ এগুলোর যুক্তি API রুটে (`/api/order` ইত্যাদি), আলাদা সার্ভিসে নয় —
তাই হয় রুট-হ্যান্ডলার সরাসরি ডাকতে হবে, নয়তো টেস্ট-DB-র বিপরীতে
অ্যাপ চালিয়ে HTTP দিয়ে। এই সিদ্ধান্তটি আগে নিতে হবে।

### Group C — §5.5 গ্রহণযোগ্যতা: মাপা অনুপাত

`scripts/verify/theme-contrast.ts` প্রতিটি জোড়া **computed টোকেন**
থেকে মাপে (rgba হলে পৃষ্ঠতলের উপর composite করে), ২ থিম × ৫ প্রিসেট।

| জোড়া | dark | light |
|---|---|---|
| প্রাথমিক বোতাম (accent-ink/accent) | 16.02 | **17.87** |
| সেকেন্ডারি বোতাম (v-ink/v-steel) | 14.69 | 15.78 |
| মূল লেখা (v-ink/v-pit) | 16.09 | 17.87 |
| সহায়ক লেখা (v-mut/v-pit) | 7.39 | 6.50 |
| লিংক (v-ice/v-pit) | 10.93 | **5.93** (আগে ৪.১ — ফেল) |
| অ্যাকসেন্ট-লেখা (accent-text/v-void) | 15.04 | 4.66 |
| সফল / সতর্কতা / ত্রুটি / তথ্য | 12.08 / 10.91 / 6.77 / 10.93 | 5.02 / 5.02 / 6.29 / 5.93 |
| প্লেসহোল্ডার (v-dim/v-field) | 5.66 | **4.77** (আগে ২.৮২ — ফেল) |

✅ ০টি JSX/TSX ফাইল বদলেছে · ✅ `!important` ৫৮ → ৫৮ (নতুন নেই)

**যা টোকেন দিয়ে হয়নি:** `.btn-primary` কখনোই `--accent` ব্যবহার
করত না — তার `--panel-fill` ছিল হার্ডকোড বেগুনি গ্রেডিয়েন্ট। তাই
সাইটের প্রধান CTA থিম/প্রিসেট নির্বিশেষে বেগুনিই থাকত। light-এ
এখন সেটি accent টোকেন থেকে রঙ নেয় (গভীর ইঙ্ক); dark অপরিবর্তিত।

### ⚠️ পরবর্তী: দুটি পূর্ব-বিদ্যমান a11y ঘাটতি

Group C **তৈরি করেনি**, মাপতে গিয়ে ধরা পড়েছে। checker সংখ্যাসহ
ছাপে ও "আরও খারাপ হয়নি" assert করে — নীরবে মান নামানো হয়নি।

1. **UI বর্ডার (`--v-edge2`)** — dark ১.৬২:১ · light ১.৪০:১,
   WCAG 1.4.11 চায় **৩:১**। ইনপুটের বর্ডার এতে আঁকা।
   ⚠️ দ্বন্দ্ব: §5.4 নিজেই light-এ edge2 **নরম** করতে বলেছে
   (.20 → .16)। নকশা ও AA বিপরীত দিকে টানছে — সিদ্ধান্ত দরকার:
   (ক) বর্ডার গাঢ় করা, না (খ) ইনপুটের জন্য আলাদা গাঢ়তর
   `--v-edge-field` টোকেন (কার্ডের বর্ডার নরমই থাকবে)।
2. **dark প্রিসেটে প্রাথমিক বোতাম** — purple ৪.২৩ · blue ৩.৬৮ ·
   red ৩.৬৭ (সাদা লেখা মাঝারি পৃষ্ঠতলে; AA ৪.৫ দরকার)।
   lime ও orange ঠিক আছে। §5 কেবল light-এর কাজ, তাই dark প্রিসেট
   ছোঁয়া হয়নি। সমাধান: ওই তিনটির `--accent` গাঢ় করা, অথবা
   `--accent-ink` গাঢ় করা — দুটোই ব্র্যান্ড-চেহারা বদলায়।

### H4 — SSE ডিফল্টে বন্ধ কেন (সৎ সীমাবদ্ধতা)

`/api/stream` লেখা ও কাজ করছে, কিন্তু `STREAM_ENABLED` ছাড়া **বন্ধ**।
SSE-র জন্য দীর্ঘ-জীবী সংযোগ লাগে; serverless-এ ফাংশনের আয়ু-সীমা
থাকায় সংযোগ বারবার কাটত ও `EventSource` লুপে পুনঃসংযোগ করত —
তখন এটি পোলিং-এর **চেয়েও বেশি** লোড দিত। এই প্রকল্প Vercel Hobby-তে,
তাই ডিফল্ট পথ = দৃশ্যমানতা-সচেতন ১২০s পোলিং। VPS/`next start`-এ
`STREAM_ENABLED=1` দিলে প্রকৃত পুশ চালু।

**মাপা ফল:** ৭৫s লুকানো ট্যাবে **০টি** অনুরোধ (আগে মিনিটে ১ জোড়া),
ফিরে এলে সাথে সাথে ২টি।

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

### পরবর্তী টাস্ক: **GROUP D — টেস্ট** (RUN.md: "payments-এর আগে")

Vitest + আলাদা টেস্ট Postgres। ন্যূনতম কভারেজ:
- **Order:** happy path · অপর্যাপ্ত ব্যালেন্স · স্টক শেষ · সমান্তরাল
  double-spend · কুপন over-limit race
- **Deposit:** approve · reject · ডুপ্লিকেট TrxID · double-approve
- **Refund:** আংশিক · সম্পূর্ণ · over-refund প্রত্যাখ্যান
- **খতিয়ান invariant:** ১০০টি এলোমেলো অপারেশনের পর প্রতিটি ইউজারে
  `SUM(LedgerEntry.amount) === User.balance`

`npm run test` যোগ করে `.github/workflows/ci.yml` এ যুক্ত করতে হবে।
`playwright-core` হয় একটি e2e smoke টেস্টে ব্যবহার করুন, নয়তো
নির্ভরতা সরান (M4)।

⚠️ **প্রথম সিদ্ধান্ত: টেস্ট Postgres কোথায়?** লাইভ Neon-এ চালানো
যাবে না (§2.1 — আসল গ্রাহক-তথ্য)। বিকল্প: ডকার `postgres:16`,
অথবা Neon-এ একটি আলাদা `test` ব্রাঞ্চ।

### এরপর, RUN.md-এর ক্রমে

| গ্রুপ | বাকি |
|---|---|
| B | ✅ শেষ (M6-এর অবশিষ্ট: লেআউট ক্যাশযোগ্য করা — বড় কাজ, স্থগিত) |
| C | ✅ শেষ (দুটি পূর্ব-বিদ্যমান a11y ঘাটতি রিপোর্ট করা — উপরে) |
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
scripts/verify/polling-load.ts            8 পাস · ০ ব্যর্থ
scripts/verify/theme-contrast.ts          ২ থিম × ৫ প্রিসেট · সব পাস
scripts/audit-pages.ts                   ৩২ পাতা · ০ সমস্যা
npm run test:money                       18 পাস · ০ ব্যর্থ
prisma generate · typecheck · lint · build — চারটিই পরিষ্কার
```

### ⚠️ মালিকের জন্য — এই রানে যোগ হওয়া হাতে-করার কাজ

- **`TRUSTED_PROXY`** (নতুন, H2) — Vercel-এ **খালি রাখুন**। প্রক্সি ছাড়া
  স্থাপনায় `1` দেবেন না।
- **`STREAM_ENABLED`** (নতুন, H4) — Vercel Hobby-তে **খালি রাখুন**।
  কেবল VPS/দীর্ঘ-চলমান সার্ভারে `1` দিন।
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
