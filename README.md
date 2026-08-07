# SS UID TOPUP

Free Fire ডায়মন্ড / ডিজিটাল টপ-আপ storefront — Bangladesh মার্কেটের জন্য। ম্যানুয়াল-ফুলফিলমেন্ট মডেল (bKash/Nagad), wallet ledger, অ্যাডমিন অপারেশন প্যানেল, ব্র্যান্ড/থিম/টেলিগ্রাম স্তর।

> **Stack:** Next.js 14 (App Router) · TypeScript · Prisma + PostgreSQL (Neon) · NextAuth · Tailwind · Framer Motion · Resend · Vercel Blob · Vercel deploy

---

## দ্রুত শুরু (Local Development)

```bash
# 1. নির্ভরতা ইনস্টল
npm install

# 2. পরিবেশ ফাইল তৈরি — .env.example কপি করে মান বসান
cp .env.example .env
#    ন্যূনতম দরকার: DATABASE_URL, NEXTAUTH_SECRET

# 3. ডাটাবেস প্রস্তুত (প্রথমবার)
npm run db:migrate:deploy   # মাইগ্রেশন প্রয়োগ (নিচে "Database" দেখুন)
npm run db:seed             # প্রাথমিক ডেটা (অ্যাডমিন, ক্যাটাগরি, সেটিংস)

# 4. ডেভ সার্ভার
npm run dev                 # http://localhost:3000
```

প্রথম অ্যাডমিন লগইন: `.env`-এর `ADMIN_EMAIL` / `ADMIN_PASSWORD` (seed তৈরি করে)।

---

## পরিবেশ ভেরিয়েবল (.env)

| Key | আবশ্যক? | কী |
|---|---|---|
| `DATABASE_URL` | ✅ | Postgres connection string (`postgresql://...?sslmode=require`) |
| `NEXTAUTH_SECRET` | ✅ | `openssl rand -base64 32` — ন্যূনতম ২৪ অক্ষর |
| `NEXTAUTH_URL` | ✅ (prod) | সাইটের পূর্ণ URL — OAuth callback ও ইমেইল লিংকে লাগে |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | seed-এ | প্রথম অ্যাডমিন অ্যাকাউন্ট |
| `BLOB_READ_WRITE_TOKEN` | ⬜ | Vercel Blob — ছবি আপলোড। না থাকলে আপলোড বন্ধ |
| `RESEND_API_KEY` | ⬜ | ইমেইল ও পাসওয়ার্ড রিসেট। **না থাকলে ইমেইল নীরবে বন্ধ** (লগে warn) |
| `SENTRY_DSN` | ⬜ | production exception ট্র্যাকিং। না থাকলে ক্র্যাশ অদৃশ্য |
| `GOOGLE_CLIENT_ID` / `_SECRET` | ⬜ | Google দিয়ে লগইন |
| `TELEGRAM_BOT_TOKEN` / `_CHAT_ID` | ⬜ | env-fallback বট (মূল কনফিগ অ্যাডমিন প্যানেলে) |

অ্যাপ চালুর সময় `src/lib/env.ts` আবশ্যক মান যাচাই করে — ভুল থাকলে পরিষ্কার বার্তাসহ থামে (নীরব ভাঙা নয়)।

---

## Database — Prisma Migrate

এই প্রজেক্ট এখন **versioned migration** ব্যবহার করে (`prisma db push` নয়)।

```bash
npm run db:migrate            # ডেভ: schema বদলে নতুন migration তৈরি + প্রয়োগ
npm run db:migrate:deploy     # প্রোড: বিদ্যমান migration প্রয়োগ (নতুন তৈরি করে না)
npm run db:migrate:status     # কোন migration বাকি আছে দেখুন
```

### ⚠️ বিদ্যমান (production) DB-তে প্রথমবার — Baseline

আগে `db push` দিয়ে চলা একটি DB-তে migration চালু করতে হলে, Prisma-কে জানাতে হবে যে
বর্তমান migration গুলো **ইতিমধ্যে প্রয়োগিত** — নইলে সে আবার সব টেবিল বানাতে চেয়ে ব্যর্থ হবে:

```bash
npx prisma migrate resolve --applied 00000000000000_init
npx prisma migrate resolve --applied 20260728034227_review_photo_url
npx prisma migrate status    # যাচাই: "Database schema is up to date"
```

এরপর থেকে স্বাভাবিক `db:migrate:deploy` কাজ করবে। বিস্তারিত: `MANUAL_PRO.md → Migration Baseline`।

নতুন খালি DB-তে (যেমন নতুন Neon branch) শুধু `db:migrate:deploy` চালালেই পুরো schema তৈরি হবে।

---

## উৎপাদন (Production) স্ক্রিপ্ট

```bash
npm run typecheck     # tsc --noEmit
npm run lint          # next lint
npm run build         # prisma generate && next build
npm run start         # production সার্ভার
```

CI (`.github/workflows/ci.yml`) প্রতিটি push/PR-এ উপরের তিনটি (typecheck/lint/build) + `npm audit` চালায়।

---

## স্থাপত্য (Architecture) — সংক্ষেপে

```
src/
├── app/
│   ├── (public)/        # storefront, product, login, register, track...
│   ├── account/         # গ্রাহক ড্যাশবোর্ড (wallet, orders, profile)
│   ├── admin/           # অ্যাডমিন প্যানেল (১৮ পেজ)
│   └── api/             # ৫৬+ route handler
├── components/          # UI — admin/, home/, fx/, theme/, i18n/, telegram/
├── lib/
│   ├── services/wallet.ts   ★ টাকার একমাত্র প্রবেশপথ (credit/debit + ledger)
│   ├── health.ts            ★ সব সাবসিস্টেম হেলথ (একক সত্যের উৎস)
│   ├── errorReporter.ts     ★ Sentry-সামঞ্জস্যপূর্ণ exception sink
│   ├── rateLimit.ts         ★ DB-backed shared rate limiter
│   ├── payments/            ★ provider registry (manual live; বাকি stub)
│   ├── fulfillment/         ★ delivery interface seam (আজ MANUAL)
│   ├── telegram/            ★ multi-bot, scheduler, templates, analytics
│   └── ...
├── middleware.ts        ★ রুট সুরক্ষা + CSP + নিরাপত্তা হেডার
└── prisma/schema.prisma ★ ২৭ model · ১২ enum
```

### টাকার নিরাপত্তা (core invariant)

- প্রতিটি ব্যালেন্স পরিবর্তন = `services/wallet.ts` দিয়ে, একই transaction-এ `LedgerEntry` লেখা (`balanceAfter` সহ)।
- অর্ডার/ডিপোজিট/রিফান্ড সিদ্ধান্তের আগে `SELECT ... FOR UPDATE` row-lock — double-spend, stock race, coupon race, double-refund সব ঠেকানো।
- আংশিক রিফান্ড: `refundedAmount + অঙ্ক ≤ price` — লক করা রো-তে যাচাই।

এই স্তর **পরিবর্তনের আগে সতর্ক থাকুন** — এখানেই আসল টাকা।

---

## হেলথ চেক

`GET /api/health` → সব সাবসিস্টেমের অবস্থা (database, email, storage, telegram, monitoring)।
`200` = সব critical চালু · `503` = database অচল। আপটাইম মনিটর এখানে পিং করে।

---

## আরও দলিল

- `MANUAL_PRO.md` — সম্পূর্ণ স্থাপত্য সিদ্ধান্ত, প্রতিটি ফিচারের কারণ, migration baseline গাইড
- `ULTIMATE_PROJECT_GAP_ANALYSIS.md` — ফিচার ইনভেন্টরি ও ভবিষ্যৎ রোডম্যাপ
- `FINAL_PRODUCTION_RELEASE_REPORT.md` — সর্বশেষ রিলিজ যাচাই
