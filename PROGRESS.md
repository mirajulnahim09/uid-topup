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
```
