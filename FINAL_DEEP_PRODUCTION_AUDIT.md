# FINAL DEEP PRODUCTION AUDIT

**তারিখ:** ২০২৬-০৮-০৭
**পদ্ধতি:** পূর্ববর্তী কোনো রিপোর্টকে সত্য ধরা হয়নি। প্রতিটি দাবি চলমান
অ্যাপ্লিকেশনের বিরুদ্ধে **প্রকৃত execution** দিয়ে যাচাই করা হয়েছে — HTTP
স্ট্যাটাস, রেন্ডার করা DOM, পরিমাপ করা পিক্সেল, এবং ডাটাবেসের সারি।
**সার্ভার:** `next dev` (auth-নির্ভর স্যুট কখনো `next start`-over-http এ নয়
— §29.9 দেখুন)।

---

## ১. সারসংক্ষেপ — মোট সমস্যা

| শ্রেণি | পাওয়া গেছে | সমাধান হয়েছে | অবশিষ্ট |
|---|---|---|---|
| **Critical** | 3 | **3** | 0 |
| **High** | 1 | 0 | 1 *(upstream — নিচে দেখুন)* |
| **Medium** | 3 | 3 | 0 |
| **Low / Info** | 4 | 1 | 3 *(ইচ্ছাকৃত/গ্রহণযোগ্য)* |
| **মোট** | **11** | **7** | **4** |

> ⚠️ **সবচেয়ে গুরুত্বপূর্ণ কথা:** অডিট শুরুর সময় প্রকল্পটি
> **টাইপচেক বা বিল্ড কোনোটাই করতে পারত না**, এবং **নিবন্ধন ও লগইন
> সম্পূর্ণ অচল ছিল** (প্রতিটি চেষ্টায় HTTP 500)। আগের রিপোর্টগুলো
> "PASS" দেখালেও বাস্তবে অ্যাপটি ব্যবহারযোগ্য ছিল না।

---

## ২. CRITICAL — ৩টি (সবগুলো সমাধান করা হয়েছে)

### C1 — ডাটাবেস স্কিমা drift: নিবন্ধন ও লগইন সম্পূর্ণ ভাঙা ⛔

**প্রমাণ (পুনরুৎপাদনযোগ্য):**
```
POST /api/register  →  HTTP 500
prisma:error  The column `User.twoFactorEnabled` does not exist in the current database.
```

`prisma/schema.prisma`-তে ক্ষেত্রগুলো ছিল, কিন্তু **লাইভ Neon ডাটাবেসে
কোনো migration কখনো প্রয়োগ হয়নি** — `_prisma_migrations` টেবিলে ৫টির
একটিও applied ছিল না। ডাটাবেসটি মূলত `db push` দিয়ে তৈরি (যা কিছুই
রেকর্ড করে না), আর পরের ৪টি migration কখনো পৌঁছায়নি।

অনুপস্থিত কলাম: `User.twoFactorSecret`, `User.twoFactorEnabled`,
`User.twoFactorRecovery`, `User.sessionEpoch`, `Order.costPrice`।

**প্রভাব:** নিবন্ধন, লগইন, 2FA — তিনটিই ১০০% অচল। কোনো নতুন গ্রাহক
অ্যাকাউন্ট খুলতে পারত না; কোনো পুরনো গ্রাহক ঢুকতে পারত না।

**সমাধান:** ৩টি অপ্রয়োগকৃত migration-এর SQL আগে পড়া হয়েছে — সবগুলোই
`ADD COLUMN IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`, অর্থাৎ
**সম্পূর্ণ additive ও idempotent**, কোনো ধ্বংসাত্মক statement নেই।
তাই DB-তে ইতিমধ্যে প্রতিফলিত ২টি migration baseline করা হয়েছে
(`migrate resolve --applied`), তারপর `migrate deploy`।

**যাচাই:**
```
POST /api/register            →  200  {"success":true,...}
POST /api/register (duplicate) →  409  "এই ইমেইল দিয়ে অ্যাকাউন্ট আছে"
prisma migrate diff (live DB vs schema)  →  "This is an empty migration."   ← শূন্য drift
```

---

### C2 — নির্ভরতা অনুপস্থিত: প্রকল্প কম্পাইলই করত না ⛔

`qrcode` ও `@types/qrcode` `package.json`-এ ঘোষিত ছিল কিন্তু
`node_modules`-এ **সম্পূর্ণ অনুপস্থিত**।

```
src/app/api/account/2fa/route.ts(11,20): error TS2307:
  Cannot find module 'qrcode' or its corresponding type declarations.
```

**সমাধান:** `npm install` — ২৫টি প্যাকেজ পুনরুদ্ধার।

---

### C3 — বাসি Prisma client: ৩৭টি টাইপ-ত্রুটি ⛔

জেনারেট করা client (০৪:১৯) সোর্সের (১৮:০৬) চেয়ে পুরনো ছিল, তাই
`twoFactorEnabled`, `sessionEpoch`, `costPrice` ইত্যাদি client টাইপে
ছিল না — `auth.ts`, `analytics.ts`, `order/route.ts` জুড়ে ৩৭টি ত্রুটি।

**সমাধান:** `prisma generate`।

**যাচাই (C2+C3):** `tsc --noEmit` → **0 ত্রুটি**; `next lint` →
**"No ESLint warnings or errors"**; `npm run build` → **সফল**।

---

## ৩. HIGH — ১টি (অবশিষ্ট, upstream)

### H1 — `next@14.2.35` এ ৫টি পরিচিত নিরাপত্তা-পরামর্শ ⚠️

```
next  9.5.0 - 15.5.20   Severity: high
 · Image Optimizer remotePatterns দিয়ে DoS        (GHSA-9g9p-9gw9-jx7f)
 · rewrites এ HTTP request smuggling               (GHSA-ggv3-7p47-pfv8)
 · React Server Components এ DoS                   (GHSA-q4gf-8mx6-v5v3)
 · অসীম next/image ডিস্ক-ক্যাশ                     (GHSA-3x4c-7xq6-9pq8)
 · insecure RSC deserialization → DoS              (GHSA-h25m-26qc-wcjf)
```

এই প্রকল্প `next.config.js`-এ **remotePatterns ব্যবহার করে**
(`**.public.blob.vercel-storage.com`), তাই প্রথমটি প্রযোজ্য।

**কেন এখনো সমাধান করা হয়নি — এবং করা উচিত হয়নি:** একমাত্র প্যাচ পথ
`next@16.3.0`, অর্থাৎ **দুই major সংস্করণ লাফ** (14 → 16)। চূড়ান্ত
রিলিজ-অডিটের মধ্যে এমন উন্নয়ন করলে App Router, middleware ও
next-auth-এর আচরণ বদলে যেত এবং এই রিপোর্টের প্রতিটি যাচাই অকার্যকর
হয়ে পড়ত। এটি সচেতন সিদ্ধান্ত, অবহেলা নয়।

**সুপারিশ (রিলিজের পরে, নিজস্ব শাখায়):** Next 16-এ উন্নয়ন করে সম্পূর্ণ
gate পুনরায় চালান। ইতিমধ্যে ঝুঁকি কমাতে — remotePatterns যতটা সম্ভব
সংকীর্ণ রাখুন এবং image optimizer-এর সামনে CDN/rate-limit বসান।

*(দুটি dev-only পরামর্শ — `brace-expansion`, `glob` — কেবল
`eslint-config-next`-এর অধীনে; প্রোডাকশন বান্ডলে যায় না।)*

---

## ৪. MEDIUM — ৩টি (সবগুলো সমাধান করা হয়েছে)

### M1 — CannedPicker ড্রপডাউন পুরো পাতায় অনুভূমিক স্ক্রল আনত ✅

`/admin/tools` — "💬 তৈরি বার্তা" বোতামে ক্লিক করলে ২৮৮px চওড়া প্যানেল
মোড়কের **বাঁ** প্রান্তে বাঁধা থাকায় ভিউপোর্ট ছাড়িয়ে যেত।

**পরিমাপ (প্যানেল খোলা অবস্থায়, `documentElement.scrollWidth − clientWidth`):**

| ভিউপোর্ট | আগে | পরে |
|---|---|---|
| 2560px ultrawide | 0px | 0px |
| 1440px desktop | **80px** | **0px** |
| 1280px laptop | **160px** | **0px** |
| 820px tablet | **160px** | **0px** |
| 390px mobile | **168px** | **0px** |
| 320px small | **168px** | **0px** |

মূল কারণ নিশ্চিত করা হয়েছে উপাদানটি লুকিয়ে — overflow 80 → 0।

**সমাধান** (`src/components/admin/CannedPicker.tsx`): `right-0` যোগ —
প্যানেল এখন ডান প্রান্তে বাঁধা, বাঁ দিকে খোলে; সাথে
`max-w-[calc(100vw-2rem)]` যাতে সরু পর্দায় কখনো ভিউপোর্ট ছাড়ায় না।

---

### M2 — release-gate কুপন-পরীক্ষা মিথ্যা আশ্বাস দিত ✅

দুটি ত্রুটি একসাথে:
1. পাঠানো হতো `{ code, amount }` — কিন্তু `/api/coupon/check` চায়
   `variantId` (দাম **সার্ভারেই** বের হয়, যাতে ক্লায়েন্ট দাম বলতে না
   পারে — নকশাটি সঠিক)। তাই বৈধ কুপনেও schema-ভুলে 400 আসত।
2. দাবি ছিল `good.status() < 500` — অর্থাৎ সেই 400-ও "পাস" গণ্য হতো।

ফলে **"বৈধ কুপন গৃহীত হয়" কখনোই প্রমাণিত হয়নি**।

**পণ্যটি ঠিক ছিল** — স্বাধীনভাবে প্রমাণিত:
```
VALID   → 200 {"discount":"3.60","subtotal":"36.00","finalPrice":"32.40"}   ← ঠিক ১০%
INVALID → 400 {"error":"কুপন কোডটি সঠিক নয়"}
```

**সমাধান:** gate এখন নিশ্চিতভাবে বৈধ একটি কুপন তৈরি করে, `variantId`
পাঠায়, এবং **স্ট্যাটাস ও ছাড়ের অঙ্ক দুটোই** মেলায়, তারপর কুপনটি মুছে দেয়।

---

### M3 — audit-pages ক্র্যাশ করত, অ্যাডমিন পাতা কখনো পরীক্ষা হতো না ✅

```
page.evaluate: Execution context was destroyed, most likely because of a navigation
    at overflowAt (scripts/audit-pages.ts:86)
```

রিসাইজের পরপর ক্লায়েন্ট-সাইড নেভিগেশন চললে প্রক্রিয়াটি **মরে যেত** —
গ্রাহক-পাতার পরেই থেমে যেত, ফলে **১৬টি অ্যাডমিন পাতা নিঃশব্দে
অপরীক্ষিত** থেকে যেত অথচ আউটপুট দেখে সব ঠিক মনে হতো।

**সমাধান:** context হারালে থিতু হয়ে একবার পুনঃচেষ্টা; উপরন্তু প্রতিটি
পাতা `safeAudit()` দিয়ে মোড়ানো — একটি পাতার ব্যতিক্রম আর পুরো অডিট
থামাতে পারে না, বরং **রেকর্ড** হয়।

**ফল:** পাতা-আচ্ছাদন ২২ → **৩২** (সব অ্যাডমিন পাতা সহ)।

---

## ৫. LOW / INFO — ৪টি

| # | বিষয় | অবস্থা |
|---|---|---|
| L1 | `src/lib/sanitize.ts`-এর মন্তব্যে লেখা "কোথাও `dangerouslySetInnerHTML` নেই" — বাস্তবে ৪টি ব্যবহার আছে | **সংশোধিত** (নিচে) |
| L2 | `src/components/ui/DataTable.tsx` — সম্পূর্ণ টেবিল-ইঞ্জিন, কিন্তু **কোনো ফাইল import করে না** | রাখা হয়েছে — ব্যাখ্যা §৭ |
| L3 | `lib/payments/webhookSignature.ts`, `lib/trustMetrics.ts` অব্যবহৃত | ইচ্ছাকৃত ভবিষ্যৎ-কাঠামো |
| L4 | dev-only npm advisories (`brace-expansion`, `glob`) | প্রোডাকশনে যায় না |

চারটি `dangerouslySetInnerHTML` **প্রত্যেকটি পরীক্ষা করা হয়েছে — সবগুলো নিরাপদ**:
`layout.tsx` (স্থির ধ্রুবক), `LegalPage` (আগে সম্পূর্ণ HTML-escape, তারপর
কেবল `**bold**`), `TwoFactorSettings` (সার্ভারে তৈরি QR SVG),
`TemplatesPanel` (টেমপ্লেট-বডি ইচ্ছাকৃতভাবে HTML — Telegram
`parse_mode=HTML`; **ইন্টারপোলেট করা সব মান `esc()` দিয়ে escaped**)।

---

## ৬. যাচাইয়ের পূর্ণ ফলাফল

### ৬.১ প্রোডাকশন যাচাই

| যাচাই | ফল |
|---|---|
| `tsc --noEmit` | **0 ত্রুটি** (শুরুতে ছিল ৩৭) |
| `next lint` | **0 warning, 0 error** |
| `npm run build` | **সফল** — First Load JS shared **87.4 kB**, middleware 49.2 kB |
| `prisma migrate diff` | **শূন্য drift** |

### ৬.২ Release gate — চলমান অ্যাপের বিরুদ্ধে

**ফল: ৩৮টি যাচাই, ০ ব্যর্থ, ০ blocker, ০ major** *(elapsed 680s)*

| ধাপ | উল্লেখযোগ্য প্রমাণ |
|---|---|
| **Auth** | নিবন্ধন→সেশন, duplicate→409, দুর্বল পাসওয়ার্ড→400, ভুল পাসওয়ার্ড প্রত্যাখ্যাত |
| **Brute-force** | ৬ ব্যর্থ চেষ্টার পর **সঠিক পাসওয়ার্ডও প্রত্যাখ্যাত** (৫/১৫মিনিট প্রতি ইমেইল) |
| **Authz** | **১৫৬টি probe প্রত্যাখ্যাত** (401×51, 403×47, 405×58) — কোনো admin API guest/customer-এর নাগালে নেই; ২০টি সরাসরি admin-URL redirect |
| **Workflow** | ডিপোজিট→অনুমোদন→ওয়ালেট ক্রেডিট (৳0→৳500)→অর্ডার (৳500→৳335, দাম ৳165) — প্রকৃত DB সারি মিলিয়ে |
| **Security** | stored XSS চলে না, SQLi লগইন ভাঙে না, HTML/API-তে কোনো secret নেই, cookie httpOnly+SameSite=Lax |
| **Concurrency** | **১০টি সমসাময়িক অভিন্ন ডিপোজিট → ঠিক ১টি সারি**; ৮টি সমসাময়িক অর্ডারে ব্যালেন্স কখনো ঋণাত্মক নয় |
| **N+1** | ২০টি অর্ডার × ৩ স্তরের relation → **৪টি query** (N+1 হলে ২০+) |

### ৬.৩ টাকার অপরিবর্তনীয় নিয়ম — **১৮/১৮ পাস**

খতিয়ানের শৃঙ্খল অটুট · সর্বশেষ খতিয়ান == বর্তমান ব্যালেন্স ·
কোনো ঋণাত্মক ব্যালেন্স নেই · `price == subtotal − discount` ·
`refundedAmount <= price` এবং খতিয়ানের REFUND যোগফলের সমান ·
প্রতিটি অনুমোদিত ডিপোজিটের খতিয়ান আছে · `coupon.usageCount ==
CouponUse` সারি-সংখ্যা · কোনো অনাথ খতিয়ান নেই · ওয়ালেট সার্ভিসের সব
আচরণ-পরীক্ষা rollback হয়েছে।

> ⓘ ২টি "খতিয়ানের বাইরে ব্যালেন্স বদল" পাওয়া গেছে — এগুলো Phase 2 QA-র
> সময় **সরাসরি DB সম্পাদনা**, কোডের ত্রুটি নয়।

### ৬.৪ System audit — **৫৪/৫৪ পাস**

নিরাপত্তা-হেডার · secret ফাঁস (`/.env` → 404) · SEO/PWA (manifest,
robots, sitemap ২০ URL, OpenGraph) · **DB integrity: ৭৪ index, ১৬ FK,
২০১ check-constraint, ০ অনাথ সারি, ০ ঋণাত্মক ব্যালেন্স** · তিনটি
theme মোড · accessibility (label/alt/নাম/lang/একক h1/skip-link) ·
reduced-motion · **সব CSS animation compositor-only (transform, opacity)**।

### ৬.৫ নিরাপত্তা-হেডার (লাইভ response থেকে যাচাই)

`Content-Security-Policy` (`object-src 'none'`, `frame-ancestors 'none'`,
`base-uri 'self'`) · `X-Frame-Options: DENY` · `X-Content-Type-Options:
nosniff` · `Referrer-Policy: strict-origin-when-cross-origin` ·
`Permissions-Policy` (camera/mic/geo/payment বন্ধ) ·
`Cross-Origin-Opener-Policy` · `Cross-Origin-Resource-Policy` ·
`X-Permitted-Cross-Domain-Policies: none` · HSTS (isProd+https-এ)।

### ৬.৬ কোড-স্তরের নিরাপত্তা যাচাই

- **SQL injection:** সব raw query **tagged template** (`$queryRaw\`…\``) —
  parameterized। কোথাও `$queryRawUnsafe` ব্যবহারকারীর ইনপুট নিয়ে নয়।
- **Race condition:** প্রতিটি টাকার পথ transaction-এর ভেতরে
  `SELECT … FOR UPDATE` (pessimistic lock)।
- **Webhook:** signature ছাড়া কিছু বিশ্বাস করা হয় না; parser না থাকলে
  **fail-closed (501)**; idempotency **atomic create-first** (check-then-act
  নয়) — future gateway-এ double-credit অসম্ভব।
- **File upload:** magic-byte signature যাচাই, **SVG ইচ্ছাকৃতভাবে
  allowlist-এর বাইরে** (SVG/XSS injection বন্ধ), ৮MB সীমা।
- **Authorization:** `requireUser()` **DB থেকে** role ও ban-অবস্থা পড়ে —
  JWT-র দাবিতে ভরসা করে না। ৩৯টি admin route-এর প্রতিটিতে guard।
- **Secrets:** AES-256-GCM + HKDF + `timingSafeEqual`; ক্লায়েন্টে কেবল
  `NEXT_PUBLIC_SITE_URL`; কোনো secret লগ হয় না।

---

## ৭. টেবিল-সারিবদ্ধতা যাচাই ★

> ব্যবহারকারীর রিপোর্ট: "একাধিক পাতায় হেডার ও সারি দৃশ্যত মিলছে না।"

**পদ্ধতি:** সোর্স পড়ে নয় — **রেন্ডার করা পিক্সেল** মেপে। প্রতিটি কলামের
জন্য: (১) `th`-সংখ্যা == প্রতিটি সারির `td`-সংখ্যা, (২) হেডারের কার্যকর
`text-align` == সেই কলামের `td`-দের, (৩) লেখার প্রকৃত content-box প্রান্ত।
৬টি ভিউপোর্টে (320px → 2560px), light ও dark উভয় থিমে, এবং ফিল্টার/
সার্চ/পেজিনেশনের পরে — অ্যাকর্ডিয়ন/`<details>` জোর করে খুলে, যাতে লুকানো
টেবিলও বাদ না যায়।

### ফলাফল

```
═══ 54 table-renders · 444 column-checks ═══
TOTAL ISSUES: 0
  PASS  every table cell uses the single alignment vocabulary (.num / .ctr)
```

**কোনো ভুল-সারিবদ্ধতা পাওয়া যায়নি।** কারণ কাঠামোগত:

1. সব টেবিল **প্রকৃত `<table>`** markup — কলামের *বাক্স* ব্রাউজারের
   টেবিল-অ্যালগরিদমই এক অক্ষে ধরে রাখে; সেটি সরা **অসম্ভব**।
2. যা সরতে পারত তা হলো বাক্সের ভেতরে **লেখার অবস্থান**। `globals.css`-এ
   একটিই শব্দভাণ্ডার: `.num` → ডানে, `.ctr` → কেন্দ্রে — **হেডার ও সেল
   দুটোতেই একই নিয়ম** (`table.tbl th.num, table.tbl td.num`)।
3. পুরনো ফাঁদটি (`<th className="text-right">` নীরবে ব্যর্থ হতো, কারণ
   `.tbl thead th`-এ `@apply text-left` বেশি নির্দিষ্ট) **আর কোথাও নেই** —
   সোর্স-স্ক্যানে ০টি অবশিষ্ট।

**একমাত্র টেবিল-সম্পর্কিত সমস্যা** ছিল `/admin/tools`-এর ৮০px পাতা-ওভারফ্লো —
সেটি টেবিলের নয়, CannedPicker ড্রপডাউনের (M1), এবং **সমাধান করা হয়েছে**।

### `DataTable.tsx` প্রসঙ্গে (L2)

`src/components/ui/DataTable.tsx` একটি সুনির্মিত ভাগাভাগি টেবিল-ইঞ্জিন
(এক কলাম-সংজ্ঞা থেকেই `th` ও `td`, প্রস্থ কেবল `<colgroup>`-এ) — কিন্তু
**কোনো ফাইল এটি import করে না**; ১৪টি টেবিলই হাতে-লেখা।

**তবু ১৪টি টেবিল স্থানান্তর করা হয়নি — সচেতনভাবে।** পরিমাপ বলছে
বর্তমান টেবিলগুলো **ইতিমধ্যেই ১০০% সারিবদ্ধ** (৪৪৪/৪৪৪)। চূড়ান্ত
রিলিজ-অডিটের মুহূর্তে ১৪টি কর্মক্ষম টেবিল পুনর্লিখন করলে বাস্তব
regression-ঝুঁকি তৈরি হতো, অথচ পরিমাপযোগ্য কোনো উন্নতি হতো না।
`DataTable` **ভবিষ্যতের নতুন টেবিলের জন্য** সঠিক পছন্দ, এবং সেটিই
সুপারিশ — বিদ্যমানগুলোর জন্য `.num`/`.ctr` শৃঙ্খলা যথেষ্ট ও প্রমাণিত।

---

## ৮. পাতা-যাচাই (৩২টি পাতা)

```
pages audited      : 32
HTTP failures      : 0*
console errors     : 0
overflow (any vp)   : 0        ← 1440px / 768px / 390px
```

সব পাবলিক পাতা 200 · সব auth-guard সঠিকভাবে
`/login?callbackUrl=…`-এ redirect · 404 পাতা কাজ করে · ৬টি গ্রাহক-পাতা ও
১৬টি অ্যাডমিন-পাতা 200।

> \* একটি রানে `/admin/telegram` **HTTP -1 (45s networkidle timeout)** এবং
> `/account`-এ `/api/notifications net::ERR_ABORTED` দেখা গিয়েছিল।
> **দুটিই বিচ্ছিন্নভাবে পুনরুৎপাদনযোগ্য নয়** — লক্ষ্য করে মাপা হয়েছে:
> `/admin/telegram` → **cold 3883ms, warm 2647ms, networkidle ~5s, HTTP 200**।
> এগুলো সমসাময়িক লোডের অধীনে `networkidle`-গেটের সাময়িক ফল, পাতার ত্রুটি নয়।
> `ERR_ABORTED` হলো নেভিগেশনের সময় বাতিল হওয়া fetch — নিরীহ।

---

## ৯. পারফরম্যান্স

| পরিমাপ | মান |
|---|---|
| First Load JS (shared) | **87.4 kB** |
| সবচেয়ে বড় রুট | `/product/[id]/[slug]` — 160 kB |
| Middleware | 49.2 kB |
| ৫০টি সমসাময়িক অনুরোধ | **সব সফল**, 2859ms wall, ~17 req/s, **০ 5xx** |
| DB index | ৭৪টি (২৮ টেবিল) |
| অর্ডার-তালিকা | ৪ query / ২০ অর্ডার — **N+1 নেই** |
| CSS animation | ২৭টি — **সবগুলো compositor-only** |

**⚠️ সততার সাথে:** উপরের latency `next dev`-এ মাপা (React dev build +
on-demand compile) — **প্রোডাকশন সংখ্যা নয়**, তাই এখানে p50/p95 উদ্ধৃত
করা হয়নি।

### লোড-প্রস্তুতি (১০০ → ১০,০০০ সমসাময়িক)

**৫,০০০/১০,০০০ ব্যবহারকারীর স্ট্রেস-টেস্ট করা হয়নি** — এর জন্য
বিতরণকৃত লোড-জেনারেটর ও একটি **অ-প্রোডাকশন** ডাটাবেস প্রয়োজন;
লাইভ Neon DB-তে চালালে প্রকৃত গ্রাহক-তথ্য ঝুঁকিতে পড়ত। কোনো অনুমানকে
পরিমাপ বলে দাবি করা হবে না।

কাঠামোগত পর্যবেক্ষণ থেকে যা বলা যায়:

- **১০০–৫০০:** নিরাপদ। সব টাকার পথ index-সমর্থিত ও row-locked।
- **১০০০–৫০০০:** সম্ভাব্য বাধা — (ক) Neon **pooler** সংযোগ-সীমা,
  (খ) `RateLimitBucket` DB-ভিত্তিক (প্রতি অনুরোধে লেখা) — উচ্চ লোডে
  Redis/Upstash-এ সরানো উচিত, (গ) `SELECT … FOR UPDATE` জনপ্রিয়
  variant-এ সিরিয়ালাইজ করবে (নিরাপত্তার জন্য ইচ্ছাকৃত)।
- **১০,০০০:** কেবল পরিমাপের পর — read-replica, ক্যাশ স্তর ও
  rate-limiter স্থানান্তর ছাড়া নয়।

---

## ১০. ইন্টিগ্রেশন যাচাই

| ইন্টিগ্রেশন | অবস্থা |
|---|---|
| **Telegram** | টোকেন কনফিগার্ড; API পৌঁছানো যায় (302, 0.8s); ৮s timeout + ৩ চেষ্টা + backoff; টোকেন কখনো RSC payload-এ যায় না (`toPublic()`) |
| **Email (Resend)** | `RESEND_API_KEY` **অনুপস্থিত** — অ্যাপ সঠিকভাবে ফিচারটি বন্ধ রাখে ও সতর্ক করে |
| **Blob storage** | `BLOB_READ_WRITE_TOKEN` **অনুপস্থিত** — একই আচরণ |
| **Payment providers** | ম্যানুয়াল পথ সক্রিয় ও যাচাইকৃত; স্বয়ংক্রিয় গেটওয়ে কাঠামো প্রস্তুত, fail-closed |

> ⚠️ **রিলিজের আগে অবশ্যই:** প্রোডাকশন পরিবেশে `RESEND_API_KEY` ও
> `BLOB_READ_WRITE_TOKEN` সেট করতে হবে — নাহলে **পাসওয়ার্ড-রিসেট ইমেইল ও
> ছবি আপলোড কাজ করবে না**। কোডে ত্রুটি নেই; এটি স্থাপনার কনফিগারেশন।

---

## ১১. পরিবর্তিত ফাইল

| ফাইল | পরিবর্তন |
|---|---|
| `src/components/admin/CannedPicker.tsx` | `right-0` + `max-w-[calc(100vw-2rem)]` — পাতা-ওভারফ্লো (M1) |
| `scripts/release-gate.ts` | কুপন-পরীক্ষা প্রকৃত করা হয়েছে — `variantId` + ছাড়ের অঙ্ক যাচাই (M2) |
| `scripts/audit-pages.ts` | context-destroyed পুনঃচেষ্টা + `safeAudit()` — অ্যাডমিন পাতা আর বাদ যায় না (M3) |
| `src/lib/sanitize.ts` | বাসি মন্তব্য সংশোধন (L1) |
| **ডাটাবেস** | ৩টি migration প্রয়োগ (additive) + ২টি baseline |
| **node_modules** | ২৫টি অনুপস্থিত প্যাকেজ পুনরুদ্ধার |

---

## ১২. উন্নতির সারাংশ

**নিরাপত্তা:** ২FA ও session-epoch কলাম বাস্তবে এল (আগে সব 2FA কোড
runtime-এ ভাঙত) · কুপন-যাচাইয়ের প্রকৃত প্রমাণ · sanitize.ts-এর ভুল
নিরাপত্তা-দাবি সংশোধন।

**ডাটাবেস:** লাইভ DB ও schema এখন **শূন্য drift** · migration ইতিহাস
baseline হয়ে **ভবিষ্যতের `migrate deploy` নিরাপদ** · `Order.costPrice`
আসায় মুনাফা-রিপোর্ট সঠিক · দুটি Order index যুক্ত (`(status, variantId)`,
`(variantId)`) — showcase-এর groupBy আর full scan নয়।

**UI:** ৬টি ভিউপোর্টেই পাতা-ওভারফ্লো ০ · ৪৪৪/৪৪৪ কলাম সারিবদ্ধ।

**পরীক্ষা-অবকাঠামো:** ৩টি harness-ত্রুটি সারানো — অডিট এখন যা দাবি করে
তা সত্যিই মাপে (পাতা-আচ্ছাদন ২২ → ৩২)।

---

## ১৩. প্রোডাকশন-প্রস্তুতি স্কোর

| ক্ষেত্র | স্কোর |
|---|---|
| কার্যকারিতা (৩৮/৩৮ gate) | 20 / 20 |
| ডাটাবেস ও টাকার নিরাপত্তা (১৮/১৮) | 20 / 20 |
| নিরাপত্তা (৫৪/৫৪ + কোড-পাঠ) | 17 / 20 — *H1 upstream* |
| UI / টেবিল / responsive | 15 / 15 |
| কোড-মান (tsc/lint/build ০) | 10 / 10 |
| পারফরম্যান্স | 8 / 10 — *প্রোডাকশন-লোড অপরিমাপিত* |
| ইন্টিগ্রেশন | 4 / 5 — *২টি env অনুপস্থিত* |

### **মোট: ৯৪ / ১০০**

---

## ১৪. এই প্রকল্প কি নিরাপদে লাইভ যেতে পারে?

# ✅ হ্যাঁ — দুটি শর্তে

অডিট শুরুর অবস্থায় উত্তরটি ছিল **স্পষ্ট "না"** — নিবন্ধন ও লগইন
সম্পূর্ণ ভাঙা ছিল এবং প্রকল্পটি বিল্ডই হতো না। সেই তিনটি critical
ত্রুটি এখন সমাধান ও যাচাই করা হয়েছে।

**লাইভ যাওয়ার আগে অবশ্যপালনীয় (কোড নয়, স্থাপনা):**

1. **`RESEND_API_KEY` ও `BLOB_READ_WRITE_TOKEN` সেট করুন** — নাহলে
   পাসওয়ার্ড-রিসেট ইমেইল ও ছবি আপলোড নীরবে অচল থাকবে।
2. **HTTPS-এ স্থাপন করুন** — `Secure` cookie ও HSTS কেবল
   `NODE_ENV=production` + https-এ সক্রিয় হয় (এই অডিট http-dev-এ চলেছে;
   §29.9 অনুযায়ী এটিই সঠিক পদ্ধতি)।

**রিলিজের পরে, নিজস্ব শাখায়:**

3. **H1** — Next 16-এ উন্নয়ন করে সম্পূর্ণ gate পুনরায় চালান।
4. উচ্চ লোডের আগে `RateLimitBucket` Redis-এ সরান।
5. প্রকৃত লোড-টেস্ট চালান — অ-প্রোডাকশন ডাটাবেসে।

---

*এই রিপোর্টের প্রতিটি সংখ্যা চলমান অ্যাপ্লিকেশন থেকে পরিমাপ করা।
যেখানে কিছু পরিমাপ করা হয়নি (৫,০০০-ব্যবহারকারী স্ট্রেস, প্রোডাকশন
latency), সেখানে অনুমান দিয়ে ফাঁক পূরণ না করে স্পষ্টভাবে বলা হয়েছে।*
