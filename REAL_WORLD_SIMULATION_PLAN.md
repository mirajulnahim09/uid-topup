# REAL-WORLD SIMULATION PLAN — ১০,০০০ গ্রাহক · ৳১ কোটি (সিন্থেটিক)

> তারিখ: ২০২৬-০৯-২৫ · লেখক: Claude (রাতের স্বয়ংক্রিয় রান) · সব টাকা **সিন্থেটিক**

## ১. ফরেনসিক বেসলাইন (যা পড়া ও যাচাই করা হলো)
- Next 14.2.35 (App Router) · Prisma 5.22 · Postgres (লাইভ Neon; এখানে ডকার postgres:18)
- ৩৮টি মডেল; টাকার মডেল: `User.balance` + append-only `LedgerEntry` (`balanceAfter`) —
  একমাত্র পথ `src/lib/services/wallet.ts` (`creditWallet`/`debitWallet`)
- টাকার রুট: `/api/deposit` (দাবি) · `/api/admin/deposit` (অনুমোদন/প্রত্যাখ্যান) · `/api/order` (ওয়ালেট অর্ডার,
  `services/order.ts`, লক variant→coupon→user, `clientRef` idempotency, `expectedPrice` বাসি-দাম সীমা) ·
  `/api/admin/order` (PROCESSING/COMPLETE/FAIL=পূর্ণ রিফান্ড) · `/api/admin/order/refund` (আংশিক, কেবল COMPLETED) ·
  `/api/admin/order/bulk` · `/api/account/withdraw` (OTP, অনুরোধেই কাটা) · `/api/admin/withdrawals` · `/api/admin/user` (সমন্বয়)
- সব গেটওয়ে stub → ফুলফিলমেন্ট ১০০% ম্যানুয়াল; ইমেইল Resend, টেলিগ্রাম, SMS — বাইরের সেবা

## ২. কী কোথায় চালানো নিরাপদ
| জিনিস | কোথায় | কেন |
|---|---|---|
| সব লেখা-পরীক্ষা | `localhost:5434/uidtopup_sim` (ডেভ-কনটেইনারে **আলাদা** database) | `_lib.ts` নাম `_sim` না হলে থামে; `_db.ts` localhost-গার্ড |
| সার্ভার | `../v2-simbuild`-এ `next build`/`next start` + TLS প্রক্সি :3443 | মালিকের `npm run dev` একই `.next` ভাঙত (মাপা) |
| env | কোনো env-ফাইল লোড হয় না (`__NEXT_PROCESSED_ENV`), ৬৫টি বাইরের কী খালি, NEXTAUTH_SECRET ফেলনা র‍্যান্ডম | লাইভ Resend/Telegram/পেমেন্ট কী কখনো ছোঁয়া যায় না |
| ইমেইল/টেলিগ্রাম/SMS | বন্ধ (কী খালি) — OTP "পৌঁছানো" DB-তে সিন্থেটিক Otp-সারি দিয়ে | হাজারো আসল বার্তা নয় |
| লাইভ Neon | **কখনো নয়** — একটি সংযোগও খোলা হয়নি | |
| Vitest | `../v2-testrun` মিরর + টেস্ট-DB :5433 | একই `.next` সংঘর্ষ এড়াতে |

## ৩. পৃথিবী
১০,০০০ গ্রাহক (`sim-NNNNNN@sim.invalid`, RFC-2606 — কখনো আসল ঠিকানা নয়); পারসোনা ২০/২০/১৯/১৫/১০/৫/৫/৫%;
ডিভাইস Android ৫৫%, iPhone ১২%, PC ১৩%, ল্যাপটপ ১২%, ট্যাবলেট ৮%; নেটওয়ার্ক fast/normal/slow/intermittent/timeout/offline;
১০% রেফারেলে আসা। ব্যালেন্স সবার ০ — টাকা ঢোকে কেবল আসল ডিপোজিট-পথে।

## ৪. ধাপ ও স্ক্রিপ্ট (`scripts/sim/`)
`sim-rig.mjs` · `01-world` · `02-business-day` (২৪ ঘণ্টা, বক্ররেখা অনুযায়ী) · `03-reconcile` (কেবল পড়া) ·
`04-races` (২/৫/১০/২৫/৫০/১০০) · `05-load` · `06-failure` · `07-growth` · `10-walkthrough` (স্ক্রিনশট) · `probe/*`

## ৫. সৎ সীমা (আগেই ঘোষিত)
- এক ল্যাপটপে ক্লায়েন্ট+সার্ভার+DB — "১০k একসাথে" দাবি করা হবে না; closed-loop ও think-time মডেল আলাদা রিপোর্ট
- ২৪ "ঘণ্টা" ~১৮ মিনিটে সংকুচিত; প্রতি ঘণ্টায় RateLimitBucket মোছা (বাস্তবে জানালা নিজেই খালি হতো), 429 আগে গোনা
- সেশনগুলো আসল NextAuth JWT (সার্ভারের সিক্রেটে স্বাক্ষরিত), লগইন-পথ আলাদা স্যুটে মাপা
- Vercel-এর অনুভূমিক স্কেল, Neon pgbouncer, আসল ফোন/Safari — স্থানীয়ভাবে পরীক্ষাযোগ্য নয়
