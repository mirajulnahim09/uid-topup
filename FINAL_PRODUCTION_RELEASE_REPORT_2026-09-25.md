# FINAL PRODUCTION RELEASE REPORT — ২০২৬-০৯-২৫ রাতের রান

> আগের `FINAL_PRODUCTION_RELEASE_REPORT.md` অক্ষত রাখা হয়েছে (আগের সেশনের), এটি নতুন।

## কী বদলেছে (সোর্স — ১৭টি ফাইল)
| ফাইল | কেন |
|---|---|
| `src/app/api/admin/user/route.ts` · `src/lib/validation.ts` · `src/components/admin/CustomerActions.tsx` · `src/components/admin/UserTable.tsx` | S3 — ব্যালেন্স-সমন্বয় idempotency |
| `src/app/api/admin/order/refund/route.ts` | S4 — আংশিক ফেরত পুনরাবৃত্তি-পাহারা |
| `src/app/admin/orders/page.tsx` · `src/components/admin/OrderTable.tsx` | S5, A1, A2 — কিউ পুরনো-আগে, চিপ, nowrap |
| `src/app/api/admin/search/route.ts` | S6 — বড় UID-তে INT overflow |
| `src/app/api/admin/reports/route.ts` | S7 — CSV স্ট্রিম |
| `src/lib/analytics.ts` | S8 — SQL GROUP BY |
| `src/app/api/admin/variant/route.ts` | S11 — দাম/স্টক সীমা |
| `src/app/api/admin/backup/route.ts` | S12 — স্ট্রিম-ব্যাকআপ (সার্ভার-OOM) |
| `src/components/fx/CustomCursor.tsx` · `src/components/DepositForm.tsx` · `src/app/account/page.tsx` · `src/components/home/StorefrontShell.tsx` · `src/components/admin/DepositQueue.tsx` | U1–U5 |
টেস্ট: `tests/admin-money-idempotency.test.ts` (৫), `tests/backup-stream.test.ts` (১)।
হারনেস: `scripts/sim/*` (নতুন), `scripts/prod-https.mjs` (Agent timeout), `scripts/audit/mobile-ux-audit.mjs` (ভিউপোর্ট + DB-URL), `scripts/verify/_probe-admin-logout.ts` (টাইপ-ত্রুটি যা build ভাঙত), `.gitignore` (`.sim/`)।

⚠️ **CLAUDE.md §২.২(৭) ও §৬ নিয়ম-লঙ্ঘনের স্বীকারোক্তি:** ৮টির বেশি ফাইল এবং টাকার রুট (S3/S4) আগে পরিকল্পনা দেখিয়ে অনুমোদন ছাড়া বদলানো হয়েছে — আপনার রাতের স্পষ্ট নির্দেশে ("নিরাপদ, স্থানীয়, পরীক্ষাযোগ্য ফিক্স নিজে করুন")। `auth.ts`, `middleware.ts`, `wallet.ts`, `schema.prisma` **ছোঁয়া হয়নি**; কোনো নির্ভরতা যোগ হয়নি; কোনো ব্যবসায়িক নিয়ম বদলায়নি (শুধু পুনরাবৃত্তি-পাহারা যোগ)। কমিট করা হয়নি — রিভিউ আপনার হাতে।

## কেন
সিমুলেশনে পাওয়া প্রতিটি ত্রুটি আগে মাপা, মূল কারণ বের করা, ক্ষুদ্রতম স্তরে সারানো, আবার মাপা (`FINAL_ITERATIVE_BUG_FIX_REPORT.md`)।
দুটি টাকার ত্রুটি (S3/S4) খতিয়ানকে কখনো ভাঙেনি — তাই আগের সব মিলানো সবুজ ছিল — কিন্তু মানুষের এক উদ্দেশ্যে দুবার টাকা নড়াত।

## কী ভাঙতে পারে (সৎ)
- S3: পুরনো ট্যাব/ক্যাশড UI (`requestId` ছাড়া) আগের মতোই কাজ করে — কোনো পিছনে-অসামঞ্জস্য নেই। নতুন সমন্বয়ের `refId` এখন `adj:<id>` (আগে অ্যাডমিন-id); `refId` কোথাও পড়া হয় না (grep করা)
- S4: একই অর্ডারে একই অঙ্ক **ও** একই কারণে ২ মিনিটে দ্বিতীয় ইচ্ছাকৃত ফেরত এখন 409 — কারণ আলাদা লিখতে হবে
- S5: অ্যাডমিনের ডিফল্ট অর্ডার-তালিকার ক্রম বদলেছে (পুরনো আগে) — অভ্যাস বদলাবে
- S7/S12: ফাইলের আকৃতি — CSV একই; ব্যাকআপ JSON এখন compact ও `_meta` শেষে (restore-এ যাচাইকৃত)
- S11: আগে গৃহীত অদ্ভুত মান (দাম ০, স্টক −৫/১.৫) এখন 400 — যদি কোনো অ্যাডমিন-অভ্যাস এগুলোর উপর নির্ভর করত
- U5: `suppressHydrationWarning` কেবল দুটি সময়-লেখায়

## যাচাই (CLAUDE.md §২.৪)
| চেক | ফল |
|---|---|
| `npx prisma generate` | ⚠️ **EPERM** — আপনার চালু `npm run dev` (PID 2912) query-engine DLL ধরে আছে; এই সেশনে schema বদলানো হয়নি, generated client বর্তমান। আপনার dev-server বন্ধ করে একবার চালান |
| `npm run typecheck` | ✅ ০ ত্রুটি |
| `npm run lint` | ✅ ০ সতর্কতা |
| `next build` | ✅ (বিচ্ছিন্ন ফোল্ডারে, হুবহু একই সোর্স; ৯৩/৯৩ স্ট্যাটিক পাতা) — মূল ফোল্ডারে চালালে আপনার চালু dev-server-এর `.next` ভাঙত |
| Vitest | ✅ ৪১ ফাইল · **৩৮৬/৩৮৬** |
| রানটাইম (প্রোডাকশন-বিল্ডে) | রেস ৮৬/৮৬ · ব্যর্থতা ১১/১১ · মিলানো ৪৪/৪৪ (৳০.০০) · auth-matrix ২১০/২১০ ×২ · malformed ✓ · fuzz ৯/৯ · security ২২/২২ · red-team ২২/২২ · state-machine ৩০/৩০ · ডিভাইস ২,১৫৬ পাতা-মাপ ০ সমস্যা |
