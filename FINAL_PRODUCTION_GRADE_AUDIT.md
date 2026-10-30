# UID TOPUP — MASTER PRODUCTION-GRADE AUDIT
**তারিখ:** ২০২৬-০৯-১৮ · **ব্রাঞ্চ:** `master` · **HEAD:** `a4959d7` · **কমিট করা হয়নি**

> এই অডিট আগের রিপোর্টের PASS-গুলোকে **প্রমাণ** ধরেছে, **সত্য** নয় — প্রতিটি দাবি
> নিজে থেকে আবার মাপা হয়েছে, আর নতুন যা পাওয়া গেছে তা নিচে।
> কোনো সিক্রেটের মান এখানে নেই। যা যাচাই করা যায়নি, তা স্পষ্ট করে `UNVERIFIED`।

---

## ১. Executive Summary

স্বাধীনভাবে পুরো সিস্টেম আবার অডিট করে **৮টি নতুন সমস্যা** পাওয়া গেছে (আগের অডিটে
ধরা পড়েনি), যার ৭টি সারানো হয়েছে ও যাচাই করা হয়েছে; ১টি (Next.js আপগ্রেড) মালিকের
সিদ্ধান্তে পরের কাজে।

| # | মাত্রা | সমস্যা | অবস্থা |
|---|---|---|---|
| 1 | **CRITICAL** | Next.js 14.2.35-এ ২টি critical advisory (AVIF Image-Optimizer RCE · Windows-host RCE) + CSP-nonce XSS সহ ১৩টি high/moderate; প্যাচ কেবল ≥15.5.24, 14.x-এ নেই | **আংশিক প্রশমিত** — AVIF বন্ধ (মালিকের সিদ্ধান্ত); আপগ্রেড আলাদা কাজ |
| 2 | HIGH | `readiness` endpoint ইমেইল অচল/লোকাল-স্টোরেজেও **`ready: true`** বলত | সারানো ও যাচাই |
| 3 | MEDIUM | তিনটি আপলোড-রুটে ভুল ফরম্যাটে **৫০০ + ভুয়া ops-অ্যালার্ম** | সারানো (৪০০) |
| 4 | MEDIUM | API উত্তরে `Cache-Control` ছিল না — প্রক্সি ব্যক্তিগত JSON ক্যাশ করতে পারত | সারানো (`no-store`) |
| 5 | MEDIUM | টাকা তোলার ফিচার অ্যাডমিন প্যানেল থেকে চালু করার পথ ছিল না | সারানো (settings API + পাতার নির্দেশ) |
| 6 | LOW | `/admin`, `/account` মেটাডেটায় `index: true` (robots.txt বাদে কিছু ছিল না) | সারানো (`noindex`) |
| 7 | LOW | প্রোডাকশন-নির্ভরতায় `nanoid` HIGH | সারানো (`npm audit fix` → 3.3.19) |
| 8 | LOW | `/api/stream` (SSE) endpoint আছে, **কোনো ক্লায়েন্ট নেই**; ডকুমেন্ট বিভ্রান্তিকর | ডক সত্য করা হলো |

**স্বাধীন যাচাইয়ে আগের দাবিগুলো টিকেছে:** ৩৫৪/৩৫৪ ইউনিট-টেস্ট, ২১০/২১০ রানটাইম
অথ-ম্যাট্রিক্স, ৩০/৩০ অবস্থা-যন্ত্র ও রেস, ১৩০/১৩০ হেডার/হাইজিন, ১৮/১৮ money-invariant।

**সিদ্ধান্ত: NO-GO** — কোডের কারণে নয়; §৩২-এর দুটি লাইভ-পরিবেশের কাজ বাকি।

---

## ২. Architecture Reviewed

| স্তর | যা দেখা হয়েছে |
|---|---|
| অ্যাপ | Next.js 14.2.35 App Router · React 18 · TS strict · ৩৫৬ সোর্স ফাইল · ৪৬ পাতা · **৮০ API রুট** · server action **নেই** |
| ডেটা | Prisma 5.22 + PostgreSQL · ৩৮ মডেল · ১৩ মাইগ্রেশন · ৯৬ PK · ৪৮ unique · ২১ FK · ৯০ index · **৮ CHECK** |
| অথ | NextAuth v4 (JWT, sessionEpoch revocation) · 2FA (TOTP এনক্রিপ্টেড + হ্যাশড recovery) · bcrypt cost 12 |
| টাকা | `services/wallet.ts` (একমাত্র ব্যালেন্স-পথ) · `services/order.ts` · `services/withdrawal.ts` · Decimal(12,2), `round2` |
| স্টোরেজ | driver: blob / s3 / local (প্রোডাকশনে blob বাধ্যতামূলক — §১০) |
| বাইরের সেবা | Resend (ইমেইল/OTP) · Telegram (অ্যাডমিন সতর্কতা) · Vercel Blob · পেমেন্ট গেটওয়ে সব **স্টাব** |
| নির্ধারিত কাজ | GitHub Actions cron → ৩টি endpoint (`ratelimit-cleanup`, `sla-breach`, `telegram-scheduler`) |
| বিশ্বাস-সীমানা | middleware (সব পাথ, static বাদে) · `requireUser`/`requireAdmin` · `assertCronAuth` (constant-time) · API-কী (reseller) · webhook স্বাক্ষর |

---

## ৩. Security Audit

| যা পরীক্ষা করা হলো | ফল |
|---|---|
| রানটাইম অথ-ম্যাট্রিক্স (৭৯ রুট × ১২৪ মেথড, ৩ ভূমিকা) | **২১০/২১০** — কোনো অ্যাডমিন-রুটে অতিথি/গ্রাহক ঢোকে না; cron সিক্রেট ছাড়া ৪০১ |
| নিরাপত্তা-প্রোব (ইনজেকশন, ট্রাভার্সাল, XSS, redirect) | **২২/২২** |
| বিকৃত অনুরোধ (৯৯০টি) | **৫০০ = ০**, ভেতরের তথ্য ফাঁস নেই |
| হেডার ও হাইজিন | **১৩০/১৩০** (§৯ দেখুন) |
| সিক্রেট-স্ক্যান (ট্র্যাকড ফাইল + git ইতিহাস) | **কোনো আসল সিক্রেট নেই**; `.gitignore` `.env*` ধরে; দুটি "সন্দেহজনক" ম্যাচ আসলে কৃত্রিম টেস্ট-মান |
| নির্ভরতা | §১৮ |

**ফিক্স:** তিনটি আপলোড-রুটে malformed multipart → ৫০০ ছিল (গ্রাহক চাইলে টেলিগ্রামে
ভুয়া "সার্ভার ত্রুটি" অ্যালার্ম বাজাতে পারত)। এখন `readForm()` গার্ড → **৪০০**, মাপা।

---

## ৪. Authentication & Authorization

- পাসওয়ার্ড bcrypt(12); রিসেট-টোকেন HMAC + র‍্যান্ডম nonce + ৩০ মিনিট + **CAS single-use**
- সেশন: JWT + `sessionEpoch` — রিসেট/ব্যান/revoke-all সব সেশন বাতিল করে (টেস্টে যাচাই)
- ব্রুট-ফোর্স: IP ১০/১০ মিনিট (**কেবল ব্যর্থ চেষ্টা**), ইমেইল ৫/১৫ মিনিট, দুটোই fail-closed
- অ্যাকাউন্ট-এনিউমারেশন: ভুল পাসওয়ার্ড ও অস্তিত্বহীন অ্যাকাউন্টে **হুবহু একই বার্তা** (মাপা)
- 2FA: TOTP সিক্রেট এনক্রিপ্টেড, recovery কোড হ্যাশড, ব্যবহার লগ হয়, স্ট্যাটাস-API কেবল সংখ্যা ফেরায়
- অথরাইজেশন **সার্ভারেই** (middleware + `requireAdmin`); UI লুকানো কোথাও অথরাইজেশন হিসেবে ব্যবহৃত নয় — ৮টি IDOR পথ সরাসরি API-তে যাচাই (৪০৪)

---

## ৫. Database & Data Integrity

- **CHECK constraints (DB-স্তরে):** `User.balance >= 0` · `Order.discount <= subtotal` ও দাম ≥ ০ ·
  `Deposit.amount > 0` · `Variant.price/costPrice >= 0` · `stock >= -1` · কুপনের মান/সীমা
- **FK নীতি:** টাকার টেবিল (`Order`, `Deposit`, `LedgerEntry`, `Withdrawal`) → `User` **RESTRICT** —
  আর্থিক ইতিহাসসহ গ্রাহক নীরবে মুছে ফেলা যায় না; অ-আর্থিক (Review/ApiKey/CouponUse) cascade
- **Unique:** `Deposit.trxId` · `Order(userId, clientRef)` · `Review.orderId` · `User.email/phone/referralCode`
- মাইগ্রেশন: লাইভ Neon-এ **১২/১২ প্রয়োগ, drift ০** (read-only যাচাই)
- `money-invariants` (ডেভ DB): **১৮/১৮** — খতিয়ান-শৃঙ্খল অটুট · শেষ `balanceAfter` = ব্যালেন্স ·
  ঋণাত্মক ব্যালেন্স ০ · `price = subtotal − discount` · `refundedAmount ≤ price` ও REFUND-যোগফলের সমান ·
  প্রতিটি অনুমোদিত ডিপোজিটের খতিয়ান আছে · অনাথ এন্ট্রি ০ · ওয়ালেট-সার্ভিসের ৮টি আচরণ (সব rollback)

---

## ৬. Financial Correctness

- schema-তে কোথাও `Float` নেই — সব `Decimal(12,2)`; JS-এ কেবল `round2()`
- অর্ডারে দাম **লক-করা সারি** থেকে; ক্লায়েন্টের দাম উপেক্ষিত (টেস্টে প্রমাণিত)
- আংশিক/পূর্ণ রিফান্ড, অতিরিক্ত-রিফান্ড প্রত্যাখ্যান, refundedAmount = খতিয়ানের REFUND যোগফল
- ড্যাশবোর্ড ও Analytics এখন **একই সংজ্ঞা**: বিক্রি − অর্ডার-সময়ের খরচ − ফেরত
- প্রান্ত-মান: শূন্য/ঋণাত্মক/১ কোটি — সবই ৪০০ (মাপা, §৮)

---

## ৭. Business Logic & State Transitions

`scripts/verify/state-machine.ts` — **৩০/৩০**:

| পরিস্থিতি | ফল |
|---|---|
| PENDING অর্ডারে আংশিক ফেরত | ৪০৯, `refundedAmount` অপরিবর্তিত |
| পূর্ণ ফেরতের পরে আবার ফেরত | ৪০৯ |
| ফেরত-দেওয়া অর্ডার আবার COMPLETE / FAIL | ৪০৯ |
| বাতিল ডিপোজিট পরে অনুমোদন | ৪০৯, টাকা ঢোকে না |
| অনুমোদিত প্রত্যাহার পরে প্রত্যাখ্যান | ৪০৯ |
| একই অর্ডারে দ্বিতীয় রিভিউ | ৪০৯ (DB unique) |

---

## ৮. Concurrency & Race Conditions

আসল সমান্তরাল HTTP অনুরোধে (ইউনিট-টেস্টের বাইরে, নতুন):

| রেস | ফল |
|---|---|
| দুই অ্যাডমিন একসাথে অর্ডার COMPLETE | ঠিক ১টি সফল · `COMPLETED` ইভেন্ট ১টি |
| ডিপোজিটে একসাথে APPROVE + REJECT | ১টি কার্যকর · টাকা সর্বোচ্চ একবার |
| **প্রত্যাহারে সমান্তরাল দুটি approve** | ঠিক ১টি সফল · ব্যালেন্স অপরিবর্তিত |
| একই OTP-তে সমান্তরাল দুটি রেজিস্ট্রেশন | ঠিক ১টি অ্যাকাউন্ট |
| দুই অ্যাডমিনের একসাথে ব্যালেন্স-সমন্বয় | দুটোই গোনা, কিছু হারায় না, খতিয়ান অটুট |
| ডেলিভারি-নিশ্চিতকরণ ও রিভিউ সমান্তরাল | ভাঙে না · রিভিউ ১টি |
| (ইউনিট) অর্ডার/স্টক/কুপন/রিফান্ড/ডিপোজিট রেস | আগের ৩৫৪ টেস্টে সবুজ |

প্রতিটি ধাপের পরে `SUM(খতিয়ান) == ব্যালেন্স` মিলিয়ে দেখা হয়েছে।

---

## ৯. API Security

- প্রতিটি রুটে zod/স্কিমা-ভ্যালিডেশন বা স্পষ্ট গার্ড; `readJson`/`readForm` ভুল বডিতে ৪০০
- রেট-লিমিট: login/reset/forgot/2fa/pw **fail-closed**; order/deposit/upload/search per-user বা per-IP
- idempotency: `clientRef` (অর্ডার), `trxId` (ডিপোজিট), webhook event-id (Setting unique)
- ব্যক্তিগত উত্তরে এখন `Cache-Control: no-store` (middleware, নতুন)
- ৫xx: বিকৃত/বিশাল/অপ্রত্যাশিত ইনপুটে **শূন্য** (৯৯০ অনুরোধে মাপা)

---

## ১০. Upload & Storage Security

`upload-security` **১৫/১৫** — অতিথি ৪০১ · গ্রাহক→অ্যাডমিন ৪০৩ · SVG/HTML-as-png/খালি ৪০০ ·
৯MB ৪০০ · ৪০MB-এ সার্ভার টিকে থাকে · `../` ফাইলনাম উপেক্ষিত · **magic-byte** যাচাই ·
GIF-HTML polyglot `.gif` হিসেবেই সংরক্ষিত · রেট-লিমিট ১০ → ৪২৯ ·
`/uploads` উত্তরে `nosniff` + `sandbox` CSP।

⚠️ **প্রোডাকশনে `STORAGE_DRIVER=local` চলবে না** — Next বিল্ডের পরে `public/`-এ লেখা ফাইল
পরিবেশন করে না (মাপা: আপলোডের পরপরই ৪০৪, নিয়ন্ত্রণ `/sw.js` ২০০)। এখন **readiness
এটিকে blocker** হিসেবে দেখায় (নতুন)।

---

## ১১. Timezone & Date Handling

`timezone-boundary` **২/২** — ঢাকা-দিনের রিপোর্টে দিনের প্রথম ৬ ঘণ্টা থাকে, পরের দিনেরটা নয়।
দিন-সীমা সব জায়গায় `lib/date.ts` (`dhakaDayStart`/`dhakaDateBounds`/`parseDhakaDateTime`);
`tests/dhaka-date.test.ts` তিনটি সার্ভার-টাইমজোনে একই ফল প্রমাণ করে। প্রত্যাহারের দৈনিক সীমা
ঢাকার মধ্যরাতে রিসেট (টেস্টে যাচাই)।

---

## ১২. Resilience & Failure Handling

`resilience` **১৪/১৪** — গেটওয়ে ৫০২ (HTML), অফলাইন, **হারানো উত্তরের পরে retry**
(দ্বিতীয় অর্ডার/কাটা হয় না), ডাটাবেস বন্ধ → বাংলা ত্রুটি-পাতা ও `/api/health` ৫০৩ (ফাঁস নেই),
DB ফেরার পরে **সার্ভার রিস্টার্ট ছাড়াই** ২০০; সব ক্ষেত্রে গ্রাহক বাংলা বার্তা দেখেন।

---

## ১৩. Performance & Scalability

| পরিমাপ | ফল |
|---|---|
| ৩ লাখ অর্ডারে অ্যাডমিন তালিকা-পাতা | ৭২–১৩৩ms (take-সীমা কাজ করছে) |
| **১ লাখ গ্রাহকে** `/admin`, `/admin/users`, সার্চ | ৮৩ / ১৩৩ / ১৬০ms |
| ড্যাশবোর্ড (আগের অডিটে সারানো) | ২.৮ লাখ সম্পন্ন অর্ডারে ৫১৯০ms → **১৮১ms** |
| **সবাইকে ঘোষণা** (নতুন মাপা) | ২০k গ্রাহকে ১.৫s · **১ লাখে ৬.৭s** (সব সারি লেখা হয়) |
| ১ বছরের orders CSV (৩ লাখ) | ২২.৬s · ৪২MB — §৩১ |
| লোড ১০/২৫/৫০/১০০ (স্থানীয় রিগ, জেনারেটরও একই মেশিনে) | **৫xx = ০** সব স্তরে · p50 ৩০১→২৬৬৭ms · থ্রুপুট ৩৫–৩৯ req/s · ১০০ জনের একযোগে অর্ডারে ডুপ্লিকেট ০ · সীমিত স্টক ৩০-এ ঠিক ৩০ · খতিয়ান অটুট |

N+1: কোনো পাতায় লুপের ভেতরে query পাওয়া যায়নি; `findMany` যেগুলোতে `take` নেই সেগুলোর
তালিকা মিলিয়ে দেখা হয়েছে — কনফিগ/ক্যাটালগ টেবিল ছাড়া বাকিগুলো সময়-সীমাবদ্ধ (§৩১-এ ব্যতিক্রম)।

---

## ১৪. Frontend Reliability

প্রোডাকশন বিল্ডে, **দুই থিমে**, ১৬টি ভিউপোর্ট (৩২০×৫৬৮ … ১৯২০×১০৮০) × অতিথি/গ্রাহক/অ্যাডমিন:

| থিম | অনুভূমিক ওভারফ্লো | ক্লিপ | ঢাকা কন্ট্রোল | ছোট ট্যাপ | iOS জুম | ভাসমান সংঘর্ষ | কনসোল ত্রুটি | ব্যর্থ অনুরোধ |
|---|---|---|---|---|---|---|---|---|
| লাইট | ০ | ০ | ০ | ০ | ০ | ০ | ০ | ০ |
| ডার্ক | ০ | ০ | ০ | ০ | ০ | ০ | ০ | ০ |

রুট-কভারেজ ৪৭/৫০ (৩টি ছাড় নথিভুক্ত)। ⚠️ এই রানেই **আমার নিজের একটি পরিবর্তন**
(§২৮ I-9) ৩২০px-এ ওভারফ্লো এনেছিল — ধরা পড়ে, সারানো, আবার মেপে শূন্য।

ব্রাউজার-যাত্রা: customer **৫৯/৫৯** · admin **৭২/৭২** · auth-edges **১৫/১৫** ·
interaction-sweep **১২৫/১২৫** · double-submit **১৬/১৬** · slow-network **৯/৯** ·
stale-data **১০/১০** (অ্যাডমিনের বদল গ্রাহকের খোলা পাতায় ২৯s-এ)।

---

## ১৫. Accessibility

`a11y-scan` **৭৭/৭৭** — প্রতিটি ফর্ম-কন্ট্রোলের accessible name, ডায়ালগ role/label,
রেটিং radiogroup, টোস্টের `aria-live`; কনট্রাস্ট: semantic-tokens **১০৭/১০৭**,
storefront-contrast **১০৮/১০৮**, theme-contrast ১৫১ রঙ-জোড়া।

---

## ১৬. Observability & Audit Logging

- লগইন/লগআউট/রেজিস্ট্রেশন/পাসওয়ার্ড বদল/রিসেট/রিকভারি-লিংক + সব অ্যাডমিন-কর্ম `AdminLog`-এ
- অডিট-লগের IP **জাল করা যায় না** (`pickIp`, `TRUSTED_PROXY` ছাড়া ক্লায়েন্ট-হেডার উপেক্ষিত)
- লগার টোকেন/DB-URL/Bearer স্বয়ংক্রিয়ভাবে ঢাকে; লোড-টেস্টের পুরো লগে টেস্ট-পাসওয়ার্ডের একটিও নেই
- cron দুবার চললেও ডুপ্লিকেট সতর্কতা যায় না (শেষ সফল রানের সময় ধরে)
- ⚠️ `x-request-id` ক্লায়েন্টকে দেওয়া হয়, কিন্তু সার্ভার-লগে যায় না (§৩১, LOW)

---

## ১৭. Privacy & Data Exposure

- কোনো রুট পাসওয়ার্ড-হ্যাশ/2FA সিক্রেট/recovery কোড/API-কী ফেরত দেয় না (স্ট্যাটিক + রানটাইম যাচাই)
- পাতার HTML ও API উত্তরে সিক্রেটের ছাঁচ (DB URL, bcrypt হ্যাশ, বট-টোকেন) **পাওয়া যায়নি**
- গ্রাহক A কখনো B-এর অর্ডার/চালান/টিকিট/রিভিউ পায় না (৮টি পথ, সরাসরি API-তে ৪০৪)
- ব্যাকআপে পাসওয়ার্ড-হ্যাশ বাদ; 2FA সিক্রেট এনক্রিপ্টেড (কী ব্যাকআপে নেই)

---

## ১৮. Dependency / Supply-Chain Review

| | আগে | পরে |
|---|---|---|
| প্রোডাকশন-নির্ভরতা | ১ critical (next) + ১ high (nanoid) | **১ critical (next)** — বাকি সব ঠিক |
| সব (dev সহ) | ২ critical · ৮ high · ৪ moderate | ২ critical · ৪ high · ৩ moderate (সবই dev-only: vitest/vite/esbuild, major লাগে) |

- `npm audit fix` (patch-স্তর, মালিক-অনুমোদিত): ১১টি প্যাকেজ — **nanoid 3.3.16 → 3.3.19**, js-yaml, brace-expansion, browserslist ইত্যাদি; `package.json` অপরিবর্তিত
- **Next.js**: প্যাচ কেবল ≥15.5.24; 14.x-এ নেই। মালিকের সিদ্ধান্তে **AVIF বন্ধ** করা হয়েছে
  (critical RCE-পথ), পূর্ণ আপগ্রেড আলাদা কাজ হিসেবে পরিকল্পিত
- postinstall স্ক্রিপ্ট: কেবল `prisma generate` (প্রকল্পের নিজের)

---

## ১৯. Deployment & Environment Configuration

| জিনিস | অবস্থা |
|---|---|
| প্রোডাকশন বিল্ড | ✅ (`prisma generate` · typecheck ০ · lint ০ · build ✅) |
| `NEXTAUTH_URL` / `NEXTAUTH_SECRET` / `DATABASE_URL` | CONFIGURED (রিগে) · প্রোডাকশনে **UNVERIFIED** |
| `RESEND_API_KEY` / `EMAIL_FROM` | রিগে MISSING (ইচ্ছাকৃত) · প্রোডাকশনে **UNVERIFIED** → §৩২ |
| `BLOB_READ_WRITE_TOKEN` | রিগে MISSING · প্রোডাকশনে **UNVERIFIED** → §১০ |
| `CRON_SECRET` + GitHub `APP_BASE_URL` | ডকুমেন্টেড; প্রোডাকশনে **UNVERIFIED** |
| সোর্সম্যাপ | প্রোডাকশনে বন্ধ (`productionBrowserSourceMaps: false`) |
| `X-Powered-By` | বন্ধ |
| ⚠️ বিল্ড-টাইম নেটওয়ার্ক | `next/font` বিল্ডের সময় Google থেকে ফন্ট নামায় — egress না থাকলে বিল্ড আটকে যায় (এই রানে একবার ঘটেছে) |

---

## ২০. Backup & Disaster Recovery

- **সংশোধনী (EXTREME অডিট, ২০২৬-০৯-১৮):** আগে এখানে লেখা ছিল "backup/restore কেবল কনফিগ ও ক্যাটালগ ফেরায় (অর্ডার/খতিয়ান নয়)" — **এটি backup-এর ক্ষেত্রে ভুল ছিল**। `src/app/api/admin/backup/route.ts` ১৭টি টেবিলই ডাম্প করে: `user` (পাসওয়ার্ড হ্যাশ বাদ), `order`, `ledgerEntry`, `deposit`, `couponUse`, `notification`, `adminLog` সহ। সীমাবদ্ধতাটি **restore**-এর — সে কেবল কনফিগ/ক্যাটালগ ফেরায়।
- restore-এ checksum যাচাই, অ্যাডমিন-only, `confirm=RESTORE`, লগ হয় — অপরিবর্তিত
- ⚠️ পুরনো ব্যাকআপ restore করলে **পেমেন্ট নাম্বার ও দাম পুরনোটায় ফিরে যায়**
- লেনদেনের ডেটার আসল DR = **Neon-এর PITR/ব্যাকআপ** — **UNVERIFIED** (প্রোডাকশন কনসোল মালিকের)
- ধ্বংসাত্মক restore পরীক্ষা লাইভে চালানো হয়নি (ইচ্ছাকৃত)

---

## ২১. Cron / Background Jobs

| জব | অথ | দুবার চললে | টাইমজোন |
|---|---|---|---|
| `cron/ratelimit-cleanup` | Bearer, constant-time, সিক্রেট না থাকলে ৪০১ | নিরাপদ (মেয়াদোত্তীর্ণ সারি মোছা) | প্রযোজ্য নয় |
| `cron/sla-breach` | ঐ | **নিরাপদ** — শেষ সফল রানের সময় ধরে কেবল নতুন ভঙ্গ | ঢাকা (`lib/date.ts`) |
| `cron/telegram-scheduler` | ঐ | job-run স্টেট + শিডিউলার নিজের গার্ড | ঢাকা |
| `admin/telegram/scheduler/tick` | Bearer **বা** অ্যাডমিন সেশন | ঐ | ঢাকা |

রানটাইমে যাচাই: সিক্রেট ছাড়া তিনটি cron endpoint-ই **৪০১** (অ্যাডমিন সেশনেও)।

---

## ২২. SEO / Web Production Hygiene

`headers-seo` **১৩০/১৩০** — CSP (nonce + strict-dynamic, `unsafe-inline` **নেই**, `object-src 'none'`,
`frame-ancestors 'none'`), nosniff, Referrer-Policy, Permissions-Policy, HSTS, COOP/CORP,
`X-Powered-By` নেই; robots.txt-এ `/admin` `/account` `/api` বন্ধ; sitemap-এ ব্যক্তিগত পথ নেই;
**`/admin` ও `/account` এখন `noindex`** (নতুন); ৪০৪ পাতা বাংলা, স্ট্যাক ফাঁস নেই; title/description/favicon আছে।

---

## ২৩. Real Production Tests

**NOT YET POSSIBLE** — প্রোডাকশন ডিপ্লয় ও আসল ডোমেইনে পরীক্ষা করতে Vercel-এ ডিপ্লয় ও
env সেট করা দরকার, যা মালিকের কনসোলে (§৩২ MANUAL ACTION)। এই অডিটের সব রানটাইম-প্রমাণ
**আসল প্রোডাকশন বিল্ড + TLS** (`next start` + প্রক্সি) থেকে এসেছে, dev সার্ভার থেকে নয়।

## ২৪. Admin Security Verification

**BLOCKED (মালিকের কাজ)** — লাইভ Neon-এ read-only যাচাইয়ে (২০২৬-০৯-১৮) একমাত্র ADMIN
এখনো রিপোতে লেখা সিড-পাসওয়ার্ডে, 2FA বন্ধ। কোনো master/backdoor পাসওয়ার্ড নেই
(রিকভারি-লিংক এক-বারের, ৩০ মিনিট, অডিটেড — ৯টি টেস্ট)।

## ২৫. Email / OTP Verification

- **CODE VERIFIED:** OTP ইস্যু/যাচাই/মেয়াদ (১০ মিনিট)/সর্বোচ্চ ৫ চেষ্টা/এক-বার ব্যবহার,
  কোড কেবল bcrypt-হ্যাশ হিসেবে DB-তে, সমান্তরাল ব্যবহারে ঠিক একটি সফল
- **EXTERNAL UNVERIFIED:** Resend ডোমেইন verify + `EMAIL_FROM` — আসল ইমেইল ডেলিভারি
  (§৩২)। `health` সঠিকভাবে sandbox-প্রেরক ধরে `down` বলে, আর readiness এখন সেটিকে **blocker** গোনে

## ২৬. Blob Upload Verification

**UNVERIFIED (প্রোডাকশন)** — রিগে Blob টোকেন নেই; লোকাল ড্রাইভারে আপলোড হয় কিন্তু
প্রোডাকশন বিল্ডে পরিবেশিত হয় না (§১০)। প্রোডাকশনে Blob টোকেন দেওয়ার পরে একটি আসল
আপলোড করে ছবিটি খুলে দেখা আবশ্যক (§৩২)।

## ২৭. /api/admin/readiness

রিগে (ইচ্ছাকৃতভাবে ইমেইল/Blob ছাড়া) **`ready: false`** — blockers:
১) রেজিস্ট্রেশনের OTP ইমেইল ছাড়া যাবে না · ২) প্রোডাকশনে লোকাল স্টোরেজ।
warnings: Resend/Telegram/Sentry কনফিগ নেই · তিনটি cron কখনো চলেনি।
**এটাই সৎ অবস্থা** — আগে একই পরিবেশে `ready: true` দেখাত (সারানো হয়েছে)।

---

## ২৮. Issues Found

প্রতিটি: severity · area · evidence · root cause · fix · verification

### I-1 · CRITICAL · নির্ভরতা (Next.js)
- **Evidence:** `npm audit --omit=dev` → `next 9.5.0–15.5.23` critical; GHSA-2xp9-vwfh-vxw4 (AVIF Image-Optimizer RCE), GHSA-p293-qw3h-jr36 (Windows-host RCE), CSP-nonce XSS (GHSA-ffhc-5mcf-pf4q) সহ ১৩টি; ইনস্টলড 14.2.35; `next.config.js`-এ AVIF চালু ছিল
- **Root cause:** 14.x লাইনে প্যাচ নেই — ফিক্স কেবল ≥15.5.24
- **Fix:** মালিকের সিদ্ধান্তে **AVIF বন্ধ** (`formats: ['image/webp']`) — critical RCE-পথ বন্ধ; Windows-RCE Vercel (Linux)-এ প্রযোজ্য নয়; পূর্ণ আপগ্রেড আলাদা কাজ
- **Verification:** বিল্ড সবুজ, ছবি WebP-তে পরিবেশিত; বাকি ঝুঁকি §৩১-এ খোলা

### I-2 · HIGH · readiness মিথ্যা সবুজ
- **Evidence:** ইমেইল `not_configured` + storage `local` অবস্থাতেও `ready: true`
- **Root cause:** কেবল `critical: true` সাবসিস্টেম (শুধু DB) blocker গণ্য হতো
- **Fix:** OTP-বাধ্যতামূলক রেজিস্ট্রেশনে ইমেইল অচল ⇒ blocker; প্রোডাকশনে লোকাল স্টোরেজ ⇒ blocker
- **Verification:** এখন `ready:false` + ঠিক দুটি ব্লকার (§২৭)

### I-3 · MEDIUM · আপলোড-রুটে ৫০০
- **Evidence:** JSON/text বডিতে `/api/upload`, `/api/admin/upload`, `/api/admin/media` → **500** + error-লগ + টেলিগ্রাম ops-অ্যালার্ম
- **Root cause:** `req.formData()` থ্রো করলে `apiError` সেটিকে অপ্রত্যাশিত ৫০০ ধরত
- **Fix:** `readForm()` গার্ড (`guard.ts`) — ৪০০ + বাংলা বার্তা
- **Verification:** তিনটি রুটেই ৪০০ (আগে/পরে মাপা)

### I-4 · MEDIUM · ব্যক্তিগত API উত্তরে ক্যাশ-হেডার ছিল না
- **Evidence:** `/api/me`, `/api/notifications`, `/api/admin/readiness` — `Cache-Control` অনুপস্থিত
- **Root cause:** route handler নিজে হেডার দিত না; পাতার জন্য Next দেয়
- **Fix:** middleware → `/api/*`-এ `no-store, must-revalidate` (রুট চাইলে override করতে পারে)
- **Verification:** `headers-seo` ১৩০/১৩০

### I-5 · MEDIUM · টাকা তোলার ফিচার প্যানেল থেকে চালু করা যেত না
- **Evidence:** `/admin/withdrawals` পাতা "সেটিংসে দিন" বলে, অথচ settings API-র ALLOWED-এ কী নেই
- **Fix (মালিক-অনুমোদিত):** ৫টি কী ALLOWED-এ, সংখ্যাগুলো NUM_KEYS-এ; পাতার নির্দেশ সঠিক করা
- **Verification:** typecheck/lint/build সবুজ; state-machine প্রোব প্রত্যাহারের পূর্ণ পথ চালিয়ে দেখেছে

### I-6 · LOW · `/admin`, `/account` ইনডেক্সযোগ্য ছিল
- **Fix:** দুই layout-এ `robots: { index: false, follow: false }` · **Verification:** `headers-seo` PASS

### I-7 · LOW · প্রোডাকশন-নির্ভরতায় nanoid HIGH
- **Fix:** `npm audit fix` → nanoid 3.3.19 · **Verification:** prod audit-এ high ০; ৩৫৪ টেস্ট সবুজ

### I-8 · LOW · `/api/stream` (SSE) ব্যবহারকারীহীন + ডক বিভ্রান্তিকর
- **Evidence:** কোডে কোথাও `EventSource` নেই; Navbar ১২০s পোলিং করে
- **Fix:** `PRODUCTION_CONFIG.md`-এ সত্য লেখা (endpoint আছে, ক্লায়েন্ট নেই)

### I-9 · LOW · **এই অডিটেরই একটি পরিবর্তনে** ৩২০px-এ ওভারফ্লো (নিজে ধরা, নিজে সারানো)
- **Evidence:** I-5-এর অংশ হিসেবে `/admin/withdrawals`-এ যোগ করা লম্বা `<code>withdrawal_daily_cap</code>`
  ৩২০px-এ wrap করেনি — responsive অডিটে `admin-mobile@320x568` রুটে overhang ৩২px (দুই থিমেই)
- **Root cause:** `<code>` ডিফল্টে `break-word` নয়
- **Fix:** ঐ টোকেনগুলোতে `break-all`
- **Verification:** rebuild করে দুই থিমে আবার পূর্ণ responsive অডিট — **ওভারফ্লো ০**

---

## ২৯. Fixes Applied

| ফাইল | কী বদলাল |
|---|---|
| `next.config.js` | AVIF ফরম্যাট বন্ধ (critical RCE-পথ) |
| `src/lib/guard.ts` | নতুন `readForm()` — malformed multipart ⇒ ৪০০ |
| `src/app/api/upload/route.ts`, `admin/upload`, `admin/media` | `readForm()` ব্যবহার |
| `src/middleware.ts` | `/api/*` উত্তরে `Cache-Control: no-store` |
| `src/app/admin/layout.tsx`, `src/app/account/layout.tsx` | `noindex` মেটাডেটা |
| `src/app/api/admin/readiness/route.ts` | সৎ readiness — ইমেইল/স্টোরেজ blocker |
| `src/app/api/admin/settings/route.ts` | withdrawal কী অনুমোদন + সংখ্যা-যাচাই |
| `src/app/admin/withdrawals/page.tsx` | সঠিক নির্দেশ + `break-all` (৩২০px ওভারফ্লো, I-9) |
| `PRODUCTION_CONFIG.md` | STREAM_ENABLED ও storage-এর সত্য বিবরণ |
| `package-lock.json` | patch-স্তরের নিরাপত্তা-আপডেট (১১ প্যাকেজ) |
| **নতুন যাচাই-স্ক্রিপ্ট** | `api-auth-matrix.ts` · `state-machine.ts` · `headers-seo.ts` |

---

## ৩০. Regression Verification

সব ফিক্স ও `npm audit fix`-এর **পরে**, নতুন প্রোডাকশন বিল্ডে সবকিছু আবার চালানো হয়েছে।

### বাধ্যতামূলক চেক
`prisma generate` ✅ · `typecheck` **০ ত্রুটি** · `lint` **০ সতর্কতা** · `next build` ✅

### স্বয়ংক্রিয় টেস্ট
| | ফল |
|---|---|
| Vitest | **৩৫৪/৩৫৪** (৩৩ ফাইল) |
| `money-invariants` (ডেভ DB) | **১৮/১৮** |
| লাইভ Neon `verify:migrate-status` (read-only) | **১২/১২ প্রয়োগ · drift ০** |

### প্রোডাকশন রানটাইম (`next start` + আসল TLS)
| স্যুট | ফল |
|---|---|
| **api-auth-matrix** (নতুন) | **২১০/২১০** |
| **state-machine** (নতুন) | **৩০/৩০** |
| **headers-seo** (নতুন) | **১৩০/১৩০** |
| customer-journey · admin-journey · auth-ui-edges | ৫৯/৫৯ · ৭২/৭২ · ১৫/১৫ |
| security-probes · malformed-requests | ২২/২২ · ৯৯০ অনুরোধে **৫০০ = ০** |
| a11y-scan · upload-security | ৭৭/৭৭ · ১৫/১৫ |
| resilience · stale-data · timezone-boundary | ১৪/১৪ · ১০/১০ · ২/২ |
| prod-auth-e2e · business-flow-e2e | ৫৮/৫৮ · ৩০/৩০ |
| double-submit · slow-network · interaction-sweep | ১৬/১৬ · ৯/৯ · ১২৫/১২৫ |
| semantic-tokens · storefront-contrast | ১০৭/১০৭ · ১০৮/১০৮ |
| load-test ১০/২৫/৫০/১০০ | ৫xx ০ · ডুপ্লিকেট ০ · oversell ০ · খতিয়ান অটুট |
| responsive (২ থিম × ১৬ ভিউপোর্ট) | সব কাউন্টার **০** |

### ডেভ-সার্ভার নির্ভর স্যুট
route-guard-audit **৮০ রুট, ০ অরক্ষিত** · no-live-writes ১৫/১৫ · integrations ১৯/১৯ ·
order-price-lock ✅ · ban-revocation ✅ · ip-spoofing ✅ · ratelimit-failclosed ✅ ·
isr-no-user-leak ✅ · csp-nonce ✅ · theme-meta-token ✅ · support-flow-e2e ৩৮/৩৮

### লাইভ (read-only)
মাইগ্রেশন drift ০ · অ্যাডমিন-পাসওয়ার্ড যাচাই (§২৪) — **এখনো সিড-পাসওয়ার্ড**

---

## ৩১. Remaining Risks

| # | মাত্রা | ঝুঁকি | লঞ্চ আটকায়? |
|---|---|---|---|
| R-1 | **CRITICAL (খোলা)** | Next.js 14.2.35 — CSP-nonce XSS, SSRF, DoS ও ২টি RCE advisory; AVIF বন্ধ করে প্রধান RCE-পথ প্রশমিত, বাকিগুলো খোলা। ফিক্স = ≥15.5.24 আপগ্রেড | মালিকের সিদ্ধান্ত: **না** (প্রশমন সহ), কিন্তু দ্রুত পরিকল্পনা করা উচিত |
| R-2 | **BLOCKER** | লাইভ অ্যাডমিন সিড-পাসওয়ার্ডে, 2FA বন্ধ | **হ্যাঁ** |
| R-3 | **BLOCKER** | Resend/`EMAIL_FROM` অযাচাই — OTP না গেলে রেজিস্ট্রেশন অসম্ভব | **হ্যাঁ** |
| R-4 | HIGH | প্রোডাকশনে Blob টোকেন না দিলে আপলোড বন্ধ/৪০৪ (readiness এখন ধরবে) | ছবি দরকার হলে হ্যাঁ |
| R-5 | MEDIUM | বড় export: ১ বছরের orders CSV ৩ লাখে ২২.৬s/৪২MB; পুরো backup ১১০MB — serverless সীমা ছাড়াবে | না (মালিক: পরে) |
| R-6 | MEDIUM | সবাইকে ঘোষণা ১ লাখ গ্রাহকে ৬.৭s (batching/queue নেই) | না |
| R-7 | MEDIUM | ধীর মোবাইলে LCP ২.৮–৬.০s | না |
| R-8 | LOW | তালিকায় পেজিনেশন নেই (অ্যাডমিন ১০০/৩০০, গ্রাহক ৫০) | না |
| R-9 | LOW | `x-request-id` সার্ভার-লগে যায় না | না |
| R-10 | LOW | ডুপ্লিকেট `clientRef` রেসে Prisma stderr-এ ভুয়া "error" | না |
| R-11 | LOW | Firefox-এ হাতে-কলমে যাচাই বাকি (Playwright-Firefox অস্থির — ৩টি প্রমাণিত harness-কারণ) | না |
| R-12 | INFO | Neon PITR/ব্যাকআপ **UNVERIFIED**; পেমেন্ট গেটওয়ে সব স্টাব (ম্যানুয়াল প্রবাহই চালু) | না |

---

## ৩২. Final GO / NO-GO Decision

## **NO-GO**

কোডের দিক থেকে সব স্বয়ংক্রিয় গেট সবুজ, কিন্তু GO-র শর্তগুলোর মধ্যে **তিনটি** এখনো
পূরণ হয়নি — এবং সেগুলো নরম করে GO বলা হবে অসৎ:

| GO-শর্ত | অবস্থা |
|---|---|
| unresolved CRITICAL নেই | ❌ Next.js advisory খোলা (AVIF-পথ প্রশমিত, আপগ্রেড বাকি — মালিকের সিদ্ধান্তে পরের কাজ) |
| admin security যাচাই | ❌ লাইভ অ্যাডমিন সিড-পাসওয়ার্ডে, 2FA বন্ধ |
| ইমেইল/OTP আসল প্রোডাকশনে | ❌ UNVERIFIED (Resend ডোমেইন/`EMAIL_FROM`) |
| storage/upload আসল প্রোডাকশনে | ❌ UNVERIFIED (Blob টোকেন) |
| `/api/admin/readiness` GREEN | ❌ এখন সৎভাবে `ready:false` (উপরের কারণেই) |
| production build · E2E · financial invariant · concurrency · DB integrity · secret exposure | ✅ সব সবুজ |

---

## MANUAL ACTION REQUIRED (আপনার করণীয়)

**১. লাইভ অ্যাডমিন নিরাপদ করুন**
- কোথায়: লাইভ সাইট → `/account/profile`
- কী: পাসওয়ার্ড বদলান → 2FA (Authenticator) চালু → "সব ডিভাইস থেকে সাইন-আউট"
- কখনো শেয়ার করবেন না: নতুন পাসওয়ার্ড, 2FA সিক্রেট/QR, recovery কোড
- যাচাই: পুরনো (রিপোতে লেখা) পাসওয়ার্ডে লগইন **ব্যর্থ** হয় · নতুন পাসওয়ার্ড + কোডে সফল ·
  `/admin/logs`-এ `LOGIN` ও `TWO_FACTOR_ENABLE` সারি আছে

**২. ইমেইল/OTP চালু করুন**
- কোথায়: Resend ড্যাশবোর্ড (ডোমেইন verify: SPF/DKIM) + Vercel → Project → Environment Variables
- কী: `RESEND_API_KEY`, `EMAIL_FROM` (verify-করা ডোমেইনের ঠিকানা, `@resend.dev` নয়), `NEXTAUTH_URL` (https)
- কখনো শেয়ার করবেন না: API কী-এর মান
- যাচাই: deploy → `GET /api/admin/readiness` → `ready: true` ও blockers খালি → একটি **আসল রেজিস্ট্রেশন**
  করে OTP ইমেইল পাওয়া ও অ্যাকাউন্ট সক্রিয় হওয়া

**৩. ছবি আপলোড (দরকার হলে)**
- কোথায়: Vercel → Storage → Blob → টোকেন; env-এ `BLOB_READ_WRITE_TOKEN`
- **`STORAGE_DRIVER=local` প্রোডাকশনে দেবেন না** (আপলোড করা ফাইল ৪০৪ — মাপা)
- যাচাই: অ্যাডমিন থেকে একটি ছবি আপলোড করে সেটি ব্রাউজারে খুলে দেখা

**৪. নির্ধারিত জব**
- কোথায়: GitHub → Settings → Secrets and variables → Actions
- কী: `APP_BASE_URL` (https://আপনার-ডোমেইন), `CRON_SECRET` (Vercel env-এর হুবহু একই মান)
- যাচাই: Actions → "Cron Jobs" → Run workflow → `all` → সবুজ; পরে readiness-এ "কখনো চলেনি" সতর্কতা চলে যাবে

এই চারটি সম্পন্ন হলে জানালে আমি আবার যাচাই চালিয়ে (readiness, আসল রেজিস্ট্রেশন-ফানেল,
আপলোড) চূড়ান্ত **GO/NO-GO** হালনাগাদ করব।
