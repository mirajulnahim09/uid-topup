# চূড়ান্ত প্রোডাকশন-প্রস্তুতি অডিট — ২০২৬-০৯-১৭

> ⚠️ এই ফাইলে কোনো সিক্রেটের মান নেই। লাইভ ডাটাবেসে কেবল মালিকের অনুমোদনে
> **read-only** পরীক্ষা চালানো হয়েছে; কিছু লেখা হয়নি।

## ১. Git

| | |
|---|---|
| ব্রাঞ্চ | `master` |
| HEAD (অডিট শুরুর সময়) | `a4959d7` |
| কমিট | **করা হয়নি** — মালিক চাননি; সব পরিবর্তন working tree-তে |
| পরিবর্তন | ৩৭টি বিদ্যমান ফাইল + ৯টি নতুন (৭টি যাচাই-স্ক্রিপ্ট, ২টি টেস্ট) · audit/ প্রমাণ-ফাইল আলাদা |

## ২. পরীক্ষার পরিবেশ

- ডেভ DB: Docker `localhost:5434/uidtopup_dev` · টেস্ট DB: Docker `localhost:5433` (tmpfs)
- প্রোডাকশন রানটাইম: `next build` → `scripts/prod-rig.mjs` (`next start` :3100 + আসল TLS :3443), DB localhost-গার্ড সহ
- ব্রাউজার: সিস্টেম Chrome + playwright-core
- লাইভ Neon: কেবল `verify:migrate-status` (read-only) ও মালিক-অনুমোদিত অ্যাডমিন-পাসওয়ার্ড তুলনা

## ৩. পাওয়া ও সারানো ত্রুটি

প্রতিটি ব্রাউজার/HTTP-তে **আগে FAIL দেখে**, তারপর সারিয়ে **PASS** মেপে নিশ্চিত।

| # | মাত্রা | ত্রুটি | প্রমাণ (আগে → পরে) | ফাইল |
|---|---|---|---|---|
| 1 | HIGH | বাংলা নামের প্রোডাক্টের পাতা **HTTP 500** (Next 14 params percent-encoded → কাঁচা বাংলা `Location` → `ERR_INVALID_CHAR`) | 500 → 200 (দুই পথেই) | `product/[id]/[slug]/page.tsx`, `product/[id]/page.tsx`, `sitemap.ts` |
| 2 | HIGH | Google Fonts `@import` render-blocking — Google ধীর হলে পুরো সাইট সাদা; যাচাই-রানে নতুন ব্রাউজারের প্রথম নেভিগেশন মাঝে মাঝে ৩০s আটকাত | Google ৮s ধীর: প্রথম paint **৮৮২০ → ৬৩২ms**; ১৬ রানে হ্যাং **১/৮ → ০/১৬** | `layout.tsx` (next/font), `globals.css`, ৩টি কম্পোনেন্ট |
| 3 | HIGH | মোবাইলে মেনু থেকে সার্চ: মেনু খোলা থাকে, দেরিতে আসা সাজেশন ফলাফল ঢেকে দেয়, লেখা একটার উপর আরেকটা | স্ক্রিনশট `final-search-menu-open.png` → journey PASS | `SearchBox.tsx`, `Navbar.tsx` |
| 4 | HIGH | `prisma/seed.ts` লোকাল নয় এমন DB-তেও রিপোতে লেখা ডিফল্ট অ্যাডমিন পাসওয়ার্ড বসাত ও কনসোলে ছাপত | এখন `ADMIN_PASSWORD` ছাড়া থামে | `prisma/seed.ts` |
| 5 | MED-HIGH | লগইনের পর open redirect — `callbackUrl=/\evil` বা `/<TAB>/evil` | ব্রাউজার `http://evil.example/x` → নিজের সাইট | `login/page.tsx` |
| 6 | MEDIUM | রিভিউর `photoUrl`/ডিপোজিট `screenshot` যেকোনো URL নিত (`javascript:` সহ), রিভিউ পাবলিক পাতায় `<a href>`; উল্টো নিজের `/uploads/…` → ইংরেজি "Invalid url" | ৪টি খারাপ URL 200 → 400; নিজের আপলোড 400 → 200 | `validation.ts`, `ProductReviews.tsx` |
| 7 | MEDIUM | অ্যাডমিন লগ CSV-তে formula injection (গ্রাহকের `User-Agent` কাঁচা) | `"=HYPERLINK` → `"'=HYPERLINK` | `admin/logs/export/route.ts` |
| 8 | MEDIUM | পাসওয়ার্ড রিসেটে অন্য ডিভাইসের সেশন বাতিল হতো না | `sessionEpoch` 0→0 → 0→1 | `auth/reset/route.ts` |
| 9 | MEDIUM | ৩৭টি বিকৃত ইনপুট ৪০০-এর বদলে ৫০০ + টেলিগ্রামে ভুয়া সতর্কতা (গ্রাহক-নাগালের রুটেও) | ৯৯০ অনুরোধে ৫০০: **৩৭ → ০** | `guard.ts`, ২টি রুট |
| 10 | MEDIUM | ডেস্কটপে প্রতিটি পাতায় CLS ≈ ০.২৪৫ (spotlight `left/top`) | CLS **০.২৪৫ → ≤০.০৪** | `SiteBackground.tsx` |
| 11 | MEDIUM | বাসি দাম: নিশ্চিতকরণে ৳৫০ দেখিয়ে ৳৬০ কাটা (মালিকের অনুমোদনে) | ৳৬০ কাটা → ৪০৯, কিছু কাটে না, পাতা নতুন দাম দেখায় | `services/order.ts`, `api/order`, `validation.ts`, `OrderForm.tsx` |
| 12 | LOW-MED | পাবলিক `/api/health` অভ্যন্তরীণ `detail` দিত (DB ডাউন হলে হোস্টনাম) | detail ৩ → ০ | `api/health/route.ts` |
| 13 | LOW-MED | ১৫টি ফর্ম-কন্ট্রোলের accessible name নেই (2FA ৪টি সহ) | স্ট্যাটিক স্ক্যান ১৫ → ০ | ৫টি কম্পোনেন্ট |
| 14 | LOW | প্রত্যাহারে OTP খরচের পর অঙ্ক/নাম্বার যাচাই (মালিকের অনুমোদনে) | একই কোডে সঠিক অনুরোধ এখন চলে | `services/withdrawal.ts`, `account/withdraw` |
| 15 | LOW | Google নাম sanitize ছাড়া DB-তে (মালিকের অনুমোদনে) | `cleanName` | `auth.ts` |
| 16 | MEDIUM (হারনেস) | `npm run test:money` লাইভ-DB গার্ড এড়িয়ে লাইভে rollback-লেখা চালাত | গার্ড-করা ক্লায়েন্ট; লাইভে খ-অংশ বাদ | `scripts/money-invariants.ts` |
| 17 | LOW (হারনেস) | `verify:migrate-status` ত্রুটিতে লাইভ DB-হোস্টনাম ছাপত | `<db-host>` | `scripts/verify/migrate-status.ts` |

## ৪. 🚨 লঞ্চ-ব্লকার ও বাহ্যিক নির্ভরতা

| মাত্রা | কী | লঞ্চের আগে আবশ্যক |
|---|---|---|
| **BLOCKER** | লাইভ Neon-এর একমাত্র ADMIN (`ad***@uidtopup.local`) এখনো রিপোতে লেখা সিড-পাসওয়ার্ডে, 2FA বন্ধ (read-only তুলনায় নিশ্চিত) | **হ্যাঁ** — `/account/profile` এ পাসওয়ার্ড বদল → 2FA চালু → "সব ডিভাইস থেকে সাইন-আউট" |
| EXTERNAL — স্থানীয়ভাবে যাচাই-অযোগ্য | `EMAIL_FROM` (Resend ডোমেইন verify, SPF/DKIM) — রেজিস্ট্রেশন OTP, রিসেট, প্রত্যাহার এর উপর নির্ভর | **হ্যাঁ** — deploy-এর পর `GET /api/admin/readiness` ও একটি আসল রেজিস্ট্রেশন |
| EXTERNAL | Vercel env: `NEXTAUTH_URL` (https), `NEXTAUTH_SECRET`, `CRON_SECRET`, `BLOB_READ_WRITE_TOKEN`, `SENTRY_DSN` | হ্যাঁ (`PRODUCTION_CONFIG.md`) |
| EXTERNAL | GitHub secret `PRODUCTION_DATABASE_URL` (CI migrate-guard) | না, তবে বাঞ্ছনীয় |

## ৫. অমীমাংসিত (সারানো হয়নি)

| মাত্রা | কী | কেন রাখা | লঞ্চের আগে আবশ্যক |
|---|---|---|---|
| MEDIUM | ধীর-মোবাইল প্রোফাইলে (৪× CPU, ১.৬Mbps) LCP ৩–৯s | কারণ মাপা: JS চালানো (long task ১–১.৯s) + boot overlay hydration পর্যন্ত কনটেন্ট ঢাকে — নকশাগত সিদ্ধান্ত, বড় কাজ | না |
| LOW | `/account/**` এ `notFound()` HTTP 200 দেয় (loading.tsx streaming) | তথ্য ফাঁস নেই (কাঁচা HTML-এ মাপা), noindex | না |
| LOW | রিসেলার ওয়েবে খুচরা দাম দেখেন, কাটে কম রিসেলার দাম | গ্রাহকের ক্ষতি নেই; পণ্য-সিদ্ধান্ত | না |
| LOW | পাসওয়ার্ড বদলালে (রিসেট নয়) অন্য সেশন বাতিল হয় না | "সব ডিভাইস থেকে সাইন-আউট" বোতাম আছে; বদলালে বর্তমান ডিভাইসও বেরিয়ে যেত | না |
| LOW | `/api/admin/telegram` non-boolean `enabled` গ্রহণ করে; ভ্যারিয়েন্ট PATCH দাম ০ দিতে দেয় | কেবল অ্যাডমিন | না |
| LOW | email টেমপ্লেটে HTML escape নেই — ইনপুটে sanitize নির্ভর | সব উৎস এখন sanitized | না |
| INFO | লোকাল বিল্ডে sitemap/static params ঘুমন্ত Neon ছুঁতে পারেনি — ধরা আছে, ISR পরে পূরণ করে | Vercel-এ স্বাভাবিক | না |

## ৬. চূড়ান্ত যাচাই — সব সংখ্যা **শেষ বিল্ডে**, সব ফিক্সের পরে

### বাধ্যতামূলক চেক
`prisma validate` ✅ · `prisma generate` ✅ · `typecheck` **০ ত্রুটি** · `lint` **০** · `build` ✅ (৯৩ পাতা, shared JS ৮৭.৪ kB)

### স্বয়ংক্রিয় টেস্ট
| | ফল |
|---|---|
| Vitest | **৩০৯/৩০৯** (২৮ ফাইল; নতুন: `upload-url` ১৬, `order-price-guard` ৭, withdrawal +১) |
| `test:money` (ডেভ DB) | **১৮/১৮** |
| লাইভ Neon `verify:migrate-status` | ১২/১২ প্রয়োগ · **drift ০** |

### প্রোডাকশন রানটাইম (next start + TLS) — Playwright
| স্যুট | ফল |
|---|---|
| customer-journey (নতুন) | **৫৯/৫৯** — সার্চ, UID-যাচাই, UI-অর্ডার, খতিয়ান, রিফ্রেশ/back/forward, লগআউট→লগইন, IDOR ৮টি, ৪০৪, বাসি দাম |
| admin-journey (নতুন) | **৬৪/৬৪** — প্রোডাক্ট/প্যাকেজ (বাংলা slug), কুপন, বাতিল→পুরো ফেরত, আংশিক ফেরত, ডিপোজিট বাতিল, ব্যালেন্স সমন্বয়, বন্ধ/সক্রিয়, লগ, লগআউট |
| auth-ui-edges (নতুন) | **১৫/১৫** — ভুল পাসওয়ার্ড = অস্তিত্বহীন অ্যাকাউন্ট, রিসেট-পথ, লকআউট-বার্তা |
| security-probes (নতুন) | **২২/২২** |
| malformed-requests (নতুন) | ৯৯০ অনুরোধ · ৪৭৭ অনুমতি-দাবি · **৫০০ = ০** |
| a11y-scan (নতুন) | **৭৭/৭৭** (নিয়ন্ত্রণ-পরীক্ষাসহ) |
| prod-auth-e2e | ৫৮/৫৮ |
| business-flow-e2e | ৩০/৩০ |
| interaction-sweep | ১২৫/১২৫ |
| double-submit | ১৬/১৬ |
| slow-network | ৯/৯ |
| semantic-tokens · storefront-contrast | ১০৭/১০৭ · ১০৮/১০৮ |

### ডেভ সার্ভার-নির্ভর স্যুট
route-guard **০ অরক্ষিত রুট** · no-live-writes ১৫/১৫ · integrations ১৯/১৯ · order-price-lock ১৪/১৪ ·
ban-revocation ১৪/১৪ · ip-spoofing ৮/৮ · ratelimit-failclosed ২২/২২ · polling-load ৮/৮ ·
isr-no-user-leak ৮/৮ · csp-nonce ১৫/১৫ · theme-meta-token ১৪/১৪ · mobile-nav-logout ২১২/২১২ ·
tbl-stack সব · support-flow-e2e ৩৮/৩৮ · theme-contrast **১৫১/১৫২** — সব রঙ-জোড়া পাস; একমাত্র
ব্যর্থতা "কোনো TSX বদলায়নি" git-diff শর্ত, যা থিম-কাজের জন্য লেখা এবং এই অডিটের uncommitted
নিরাপত্তা/পারফরম্যান্স পরিবর্তনে লাল হয় (পণ্য-ত্রুটি নয়; কমিটের পর সবুজ)।

### Responsive (প্রোডাকশন বিল্ড, দুই থিম)
১৬টি চাওয়া ভিউপোর্ট (৩২০×৫৬৮ … ১৯২০×১০৮০) × অতিথি/গ্রাহক/অ্যাডমিন + ২টি ল্যান্ডস্কেপ = ৫২ সমন্বয়।

| থিম | পাতা-মাপ | ওভারফ্লো | ক্লিপ | ঢাকা কন্ট্রোল | ছোট ট্যাপ | iOS জুম | কনসোল ত্রুটি | ব্যর্থ অনুরোধ |
|---|---|---|---|---|---|---|---|---|
| লাইট | ৭৯০ | ০ | ০ | ০ | ০ | ০ | ০ | ০ |
| ডার্ক | ৭৯০ | ০ | ০ | ০ | ০ | ০ | ০ | ০ |

রুট-কভারেজ ৪৭/৫০ (৩টি ছাড় নথিভুক্ত: redirect-পাতা, error.tsx, global-error.tsx)।

### পারফরম্যান্স (প্রোডাকশন, লোকাল DB)
- TTFB ৩২–৬৮ms সব মাপা পাতায়
- ডেস্কটপ: LCP ৩৩৬–১১৫৬ms · **CLS ≤ ০.০৪** (আগে প্রতিটি পাতায় ০.২৪৫)
- Google Fonts ৮s ধীর হলে প্রথম paint: **৮৮২০ → ৬৩২ms**
- ধীর-মোবাইল প্রোফাইল: LCP ২.৮–৮.৮s — কারণ JS-চালনা ও boot overlay (§৫), ফন্ট নয়
  (ফন্ট সম্পূর্ণ আটকে নিয়ন্ত্রিত A/B: DCL/LCP ভালো হয় না)

## ৭. সিদ্ধান্ত

**NO-GO** — কোডের কারণে নয়, একটি নিশ্চিত লাইভ-ব্লকারের কারণে:

1. লাইভ অ্যাডমিন অ্যাকাউন্ট রিপোতে লেখা পাসওয়ার্ডে, 2FA বন্ধ (BLOCKER)
2. `EMAIL_FROM`/Resend ডোমেইন ও Vercel env — স্থানীয়ভাবে যাচাই-অযোগ্য; রেজিস্ট্রেশন এর উপর নির্ভরশীল

এই দুটি মালিক সম্পন্ন করে `/api/admin/readiness` সবুজ ও একটি আসল রেজিস্ট্রেশন সফল দেখলে —
কোডের দিক থেকে কোনো জানা BLOCKER/HIGH বাকি নেই → **GO**।
