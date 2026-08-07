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
```

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
