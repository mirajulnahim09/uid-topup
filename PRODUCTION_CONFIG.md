# PRODUCTION_CONFIG — বাহ্যিক নির্ভরতার সঠিক কনফিগারেশন

তারিখ: ২০২৬-০৮-৩১ · উৎস: কোড থেকে গোনা (`process.env` এর প্রতিটি পাঠ)

> ⚠️ এই ফাইলে **কোনো সিক্রেটের মান নেই এবং কখনো থাকবে না** — কেবল
> কী-এর নাম, কোথায় পাবেন, আর না দিলে কী ভাঙবে। মান বসবে Vercel-এর
> Environment Variables-এ, রিপোতে নয় (CLAUDE.md §2.3)।

---

## ১. 🔴 আবশ্যক — না থাকলে অ্যাপ চালুই হয় না

`src/lib/env.ts` → `assertEnv()` রানটাইমে throw করে।

| কী | কোথায় পাবেন | যাচাই |
|---|---|---|
| `DATABASE_URL` | Neon ড্যাশবোর্ড → Connection string → **Pooled** (হোস্টে `-pooler`) | `postgresql://` দিয়ে শুরু; শেষে `?sslmode=require&pgbouncer=true&connection_limit=5&pool_timeout=10&connect_timeout=15` |
| `DIRECT_URL` | একই পাতা → **Pooled বন্ধ** করে (হোস্টে `-pooler` নেই) | কেবল Prisma CLI (migrate/db push) পড়ে; না থাকলে `migrate deploy` **P1012**-এ থামে। Vercel-এ রাখলেও ক্ষতি নেই, রানটাইম পড়ে না |
| `NEXTAUTH_SECRET` | নিজে বানান: `openssl rand -base64 32` | ≥ ২৪ অক্ষর |
| `NEXTAUTH_URL` | সাইটের পূর্ণ https URL | production-এ না দিলে **লগইন ভাঙে** |

⚠️ `NEXTAUTH_URL` অবশ্যই `https://` দিয়ে শুরু হতে হবে। কারণ NextAuth
এটি দেখেই ঠিক করে কুকির নাম `__Secure-next-auth.session-token` হবে
কি না। `http://` দিলে middleware অন্য নামের কুকি খোঁজে ও প্রতিটি
সুরক্ষিত পাতা `/login`-এ ফেরত পাঠায় (`src/lib/authCookies.ts`)।

---

## ২. 🔴 রেজিস্ট্রেশন চালু করতে — আজকের একমাত্র লঞ্চ-ব্লকার

**দুটি কী একসাথে লাগে। একটি থাকলেই যথেষ্ট নয়।**

| কী | মান কেমন | না দিলে |
|---|---|---|
| `RESEND_API_KEY` | resend.com → API Keys | OTP তৈরি হয়, পাঠানো যায় না → `/api/auth/otp/send` **৫০২** |
| `EMAIL_FROM` | `SS UID TOPUP <no-reply@আপনার-ডোমেইন>` | ডিফল্ট **স্যান্ডবক্স** — মালিক ছাড়া কেউ মেইল পান না |

### কেন `EMAIL_FROM` আলাদা করে গুরুত্বপূর্ণ

`RESEND_API_KEY` থাকলেই ইমেইল "কনফিগার করা" মনে হয়। কিন্তু
`EMAIL_FROM` না দিলে কোড `BRAND.emailFrom` ব্যবহার করে, যা
`onboarding@resend.dev` — Resend-এর **স্যান্ডবক্স প্রেরক**। সেটি দিয়ে
কেবল আপনার নিজের ঠিকানায় মেইল যায়। ফলে:

- নতুন গ্রাহক OTP পান না → **রেজিস্ট্রেশন অসম্ভব**
- পাসওয়ার্ড রিসেট কাজ করে না
- টাকা তোলার OTP আসে না

আর এই অবস্থায় আগে কোথাও কোনো ত্রুটি দেখা যেত না।
**২০২৬-০৮-৩১ থেকে দুটি জায়গায় ধরা পড়ে:**

- `GET /api/health` → `subsystems[email].state = "down"`
  (বিস্তারিত বার্তা — যেমন `resend.dev` — ২০২৬-০৯-১৭ থেকে কেবল
  অ্যাডমিনের `GET /api/admin/readiness` এ; পাবলিক হেলথ আর `detail` দেয় না,
  কারণ DB ডাউন হলে সেখানে ডাটাবেস-হোস্টের নাম ফাঁস হতো)
- `EMAIL_FROM` এখন `src/lib/env.ts` এর তালিকায় — অ্যাডমিন
  release-checklist এ "সেট করা নেই" দেখাবে

⚠️ `email` সাবসিস্টেম `critical: false` — অর্থাৎ `/api/health` তবু
২০০ দেয়, লোড-ব্যালান্সার ফেলে দেয় না। ইচ্ছাকৃত।

### করণীয় — ক্রম অনুসারে

1. resend.com/domains → ডোমেইন যোগ করুন
2. Resend যে **SPF** ও **DKIM** রেকর্ড দেবে, সেগুলো DNS-এ বসান
3. Resend-এ ডোমেইনটি "Verified" দেখানো পর্যন্ত অপেক্ষা (DNS প্রচারে ১–২৪ ঘণ্টা)
4. Vercel-এ `EMAIL_FROM` = ঐ ডোমেইনের ঠিকানা
5. **পুনরায় deploy করুন** — env পরিবর্তনে Vercel স্বয়ংক্রিয়ভাবে rebuild করে না
6. যাচাই: `GET /api/health` → `email.state` এখন `"up"` হওয়ার কথা
7. ⚠️ তারপরও শেষ নয় — **ডেলিভারেবিলিটি আলাদা সমস্যা**। পরীক্ষামূলক OTP
   একবার Gmail স্প্যামে পড়েছিল। Gmail, Yahoo ও একটি BD ISP-তে আলাদা
   করে পরীক্ষা করুন; ইনবক্সে না গেলে গ্রাহকের কাছে "সাইট ভাঙা"

**সাময়িক পথ (সমাধান নয়):** `Setting` টেবিলে `otp_require_at_signup = 0`
দিলে সাইনআপ চলবে, কিন্তু অ্যাকাউন্ট **যাচাই-হীন** তৈরি হবে
(`emailVerified = false`)। BD বাজারে ভুয়া অ্যাকাউন্টের বিরুদ্ধে এটিই
একমাত্র প্রতিরক্ষা, তাই এটি স্থায়ী সমাধান নয়।

---

## ৩. 🟡 ঐচ্ছিক — না দিলে ঐ ফিচারটুকু নীরবে বন্ধ

| কী | কী চালু করে | না দিলে |
|---|---|---|
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob — ছবি আপলোড | টোকেন না থাকলে প্রোডাকশনে আপলোড **বন্ধ** থাকে (স্পষ্ট বার্তাসহ) — নিচের ⚠️ দেখুন |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google দিয়ে লগইন | বোতামটি কাজ করে না |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | অ্যাডমিন সতর্কতা | ঝুঁকি-সতর্কতা কোথাও যায় না |
| `TELEGRAM_ENC_KEY` | টেলিগ্রাম কনফিগ এনক্রিপশন | কনফিগ সেভ ব্যর্থ হয় |
| `CRON_SECRET` | নির্ধারিত জব (broadcast, SLA, cleanup) | জবগুলো কেবল লগইন-করা অ্যাডমিন চালাতে পারেন |
| `SENTRY_DSN` | ত্রুটি-মনিটরিং | রিপোর্ট কোথাও যায় না (scrubbing তৈরি) |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | দ্রুত রেট-লিমিট কাউন্টার | Postgres পথ চলে — আচরণ অভিন্ন |
| `FF_LOOKUP_API_KEY` | Free Fire UID যাচাই | UID যাচাই নিষ্ক্রিয় |
| `TRUSTED_PROXY` | Vercel নয় এমন হোস্টে সঠিক IP | ক্লায়েন্টের `x-forwarded-for` **উপেক্ষিত** (নিরাপদ ডিফল্ট) |
| `STREAM_ENABLED` | `/api/stream` (SSE) endpoint চালু করে | কিছুই বদলায় না — নিচের ⚠️ দেখুন |

⚠️ **`STREAM_ENABLED` এখন কার্যত নিষ্ক্রিয়।** endpoint (`/api/stream`) তৈরি আছে, কিন্তু
ক্লায়েন্টের কোথাও `EventSource` নেই — Navbar ১২০s ও অর্ডার-পাতা ৩০s পোলিংই করে
(স্বাধীন অডিটে যাচাই, ২০২৬-০৯-১৮)। সেট করলেও আচরণ বদলাবে না; বন্ধ থাকলে endpoint
৫০৩ + `{enabled:false}` ফেরায়। SSE সত্যিই চালু করতে ক্লায়েন্ট-দিক লেখা বাকি।

⚠️ **`STORAGE_DRIVER=local` প্রোডাকশনে ব্যবহার করবেন না।** Next প্রোডাকশন বিল্ড
`public/`-এর তালিকা **বিল্ডের সময়** ধরে; পরে লেখা ফাইল আর পরিবেশন করে না —
মাপা (চূড়ান্ত মাস্টার অডিট, ২০২৬-০৯-১৭): আপলোডের পরপরই `/uploads/…` = **404**,
অথচ বিল্ডের আগে থাকা `/sw.js` = 200। অর্থাৎ পেমেন্ট-প্রমাণের ছবি অ্যাডমিন
কখনোই দেখতে পাবেন না (ডেভ সার্ভারে কাজ করে বলে চোখে পড়ে না)। ছবি আপলোড
লাগলে `BLOB_READ_WRITE_TOKEN` (বা `STORAGE_DRIVER=s3` + S3/R2) দিন; টোকেন না
দিলে প্রোডাকশনে আপলোড নিজে থেকেই বন্ধ থাকে ও গ্রাহক স্পষ্ট বার্তা দেখেন।

---

## ৪. ⬛ পেমেন্ট গেটওয়ে — env-এ **নয়**

⚠️ গেটওয়ে ক্রেডেনশিয়াল env-এ বসানোর দরকার নেই এবং বসানো উচিত নয়।
সেগুলো অ্যাডমিন প্যানেল (`/admin/payments`) থেকে বসে ও ডাটাবেসে
**এনক্রিপ্টেড** থাকে (`secretbox.ts`, AES-256-GCM)। কারণ:
কী বদলাতে redeploy লাগে না, আর মান কখনো বিল্ড-আর্টিফ্যাক্টে যায় না।

`SSLCZ_STORE_ID`, `SSLCZ_STORE_PASSWD`, `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET` — এগুলো কেবল **পশ্চাৎ-সঙ্গতির** জন্য পড়া হয়।

⚠️ **তবে গেটওয়ে দিয়ে টাকা জমা এখনো সম্ভব নয়** — কারণ কী-এর অভাব নয়,
বরং auto-credit money path লেখাই হয়নি (§৫ দেখুন)।

---

## ৫. GitHub Actions

| সিক্রেট | কেন |
|---|---|
| `PRODUCTION_DATABASE_URL` | CI-র `migrate-guard` জব — এটি ছাড়া **ইচ্ছাকৃতভাবে লাল** থাকে |
| `PRODUCTION_DIRECT_URL` | ঐচ্ছিক — `migrate-guard`-এর non-pooler URL (না থাকলে উপরেরটিই) |
| `APP_BASE_URL` | `cron.yml` — কোন সাইটের cron-endpoint ডাকা হবে (যেমন `https://আপনার-ডোমেইন`) |
| `CRON_SECRET` | `cron.yml` — Vercel env-এর **হুবহু একই মান**; না মিললে প্রতিটি জব ৪০১ |

গার্ডটি ঠিক সেই বাগ ধরে যা ২০২৬-০৮-১১ তারিখে প্রতিটি প্রোডাক্ট পাতা
৫০০ করে দিয়েছিল (মাইগ্রেশন টেস্ট DB-তে গিয়েছিল, লাইভে নয়)।

⚠️ **নির্ধারিত জব Vercel Cron-এ নয়, GitHub Actions-এ চলে** (`.github/workflows/cron.yml`,
প্রতি ১০/১৫ মিনিট ও দিনে একবার)। `APP_BASE_URL` বা `CRON_SECRET` না থাকলে ওয়ার্কফ্লো
প্রতিবার লাল হয় এবং **নির্ধারিত broadcast, SLA-লঙ্ঘন সতর্কতা ও রেট-লিমিট পরিষ্কার
নীরবে বন্ধ থাকে**। deploy-এর পরে Actions ট্যাবে "Cron Jobs" → Run workflow → `all`
চালিয়ে সবুজ দেখে নিন। (চূড়ান্ত মাস্টার অডিট, ২০২৬-০৯-১৭ — আগে এই দুটি কেবল
`SECRET_ROTATION_CHECKLIST.md`-এ ছিল, এখানে নয়।)

---

## ৬. যা কোনোভাবেই প্রোডাকশনে দেওয়া যাবে না

| কী | কেন |
|---|---|
| `ALLOW_LIVE_WRITES` | যাচাই-স্ক্রিপ্টের লাইভ-DB গার্ড খুলে দেয় |
| `NODE_TLS_REJECT_UNAUTHORIZED=0` | TLS যাচাই বন্ধ — কেবল লোকাল রিগের জন্য |
| `VERIFY_ALLOW_REMOTE` | verify স্ক্রিপ্টকে দূরবর্তী DB ছুঁতে দেয় |
| `TEST_DATABASE_URL` · `VERIFY_DATABASE_URL` | কেবল টেস্ট/যাচাই পরিবেশের |

---

## ৭. deploy-এর পরে যা দেখে নিশ্চিত হবেন

```
GET /api/health
```

| ক্ষেত্র | প্রত্যাশিত |
|---|---|
| `status` | `"ok"` |
| `subsystems[].database.state` | `"up"` |
| `subsystems[].email.state` | `"up"` — `"down"` হলে §২ পড়ুন |
| `subsystems[].storage.state` | `"up"` (Blob টোকেন থাকলে) |

কোনো অবস্থা `up` না হলে **কারণ** দেখুন অ্যাডমিন হিসেবে লগইন করে
`GET /api/admin/readiness` এ — পাবলিক `/api/health` ইচ্ছাকৃতভাবে বিবরণ দেয় না।

⚠️ **সিড সম্পর্কে:** `npm run db:seed` / `db:setup` ডিফল্টে `.env`-এর ডাটাবেস
ছোঁয়। ২০২৬-০৯-১৭ থেকে লোকাল নয় এমন ডাটাবেসে `ADMIN_PASSWORD` না দিলে সিড
থেমে যায়। আগে সেখানে রিপোতে লেখা ডিফল্ট পাসওয়ার্ড বসত — লাইভে কখনো সিড
চালিয়ে থাকলে অ্যাডমিন পাসওয়ার্ড অবশ্যই বদলান।

তারপর **হাতে একবার**: একটি নতুন ইমেইলে রেজিস্টার করে দেখুন OTP
সত্যিই ইনবক্সে (স্প্যামে নয়) পৌঁছায় কি না। এটিই একমাত্র যাচাই যা
স্থানীয়ভাবে করা যায় না।

---

## ৮. ডাটাবেস মাইগ্রেশন — deploy-এর ক্রম (আবশ্যক)

⚠️ **কোনো স্বয়ংক্রিয় ধাপ নেই** (EXTREME অডিটে পাওয়া, ২০২৬-০৯-১৮): Vercel-এর
build কমান্ড `prisma generate && next build` — এটি **মাইগ্রেশন চালায় না**।
CI-র `migrate-guard` জব কেবল **ধরিয়ে দেয়** (বাকি মাইগ্রেশন থাকলে লাল হয়),
প্রয়োগ করে না। অর্থাৎ নতুন কলাম/সীমা যোগ হলে আপনি নিজে না চালালে লাইভ
ডাটাবেসে পৌঁছাবে না — আর কোড নতুন কলাম চাইলে পাতা ৫০০ দেবে।

**সঠিক ক্রম (প্রতিবার schema বদলালে):**

```bash
# ১. লাইভ DB-তে মাইগ্রেশন — কেবল GitHub Actions থেকে (O-15):
#    Actions → "Production migration (manual)" → main → MIGRATE-PRODUCTION →
#    production environment-এর reviewer অনুমোদন → status (বাকি নামগুলো) → migrate deploy → status
#    ⚠️ আপনার মেশিন থেকে নয়: `.env`-এ লাইভ URL রাখা হয় না, আর `npm run db:migrate:deploy`
#       localhost ছাড়া অন্য হোস্ট পেলে প্রিজমা চালুর আগেই থামে (scripts/assert-local-db.mjs)।

# ২. যাচাই — সব প্রয়োগ হয়েছে ও drift নেই: CI-র `migrate-guard` জব (দৈনিক ও main-এ push-এ)

# ৩. তারপর অ্যাপ deploy (Vercel)
```

একবারের সেটআপ: GitHub → Settings → Environments → `production` → **Required reviewers**, আর environment
secret `PRODUCTION_DATABASE_URL` (ঐচ্ছিক `PRODUCTION_DIRECT_URL`)। Workflow কেবল `prisma migrate deploy` চালায় —
`migrate reset`/`migrate dev`/`db push` কখনো নয়; লগে ডাটাবেস হোস্ট ঢাকা থাকে।

**পুরনো ডাটাবেসে প্রথমবার:** ডাটাবেসটি আগে `db push` দিয়ে তৈরি হলে একবার
baseline করতে হয় (`prisma migrate resolve --applied <migration>`), নইলে
`migrate deploy` আগের মাইগ্রেশনগুলো নতুন করে চালাতে গিয়ে ব্যর্থ হবে।

**টাকার DB-গার্ড:** `balance >= 0`, `discount <= subtotal`, `amount > 0`,
`stock >= -1` — এগুলো এখন মাইগ্রেশনেই আছে
(`20260918120000_money_check_constraints`, idempotent)। আগে কেবল
`npm run db:constraints` দিয়ে হাতে বসাতে হতো এবং নতুন/পুনর্গঠিত ডাটাবেসে
নীরবে অনুপস্থিত থাকত (মাপা: নতুন DB-তে constraint ছিল **০**)।
