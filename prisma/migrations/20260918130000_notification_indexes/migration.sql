-- ═══════════════════════════════════════════════════════════════
-- ★ বিজ্ঞপ্তি-পোলিং সস্তা করা (EXTREME অডিট, ২০২৬-০৯-১৮)
--
--   `/api/notifications` প্রতিটি লগইন-করা গ্রাহকের জন্য Navbar থেকে
--   প্রতি ১২০ সেকেন্ডে ডাকা হয় এবং দুটি কোয়েরি চালায়:
--     ১. `WHERE userId = ? ORDER BY createdAt DESC LIMIT 20`
--     ২. `COUNT(*) WHERE userId = ? AND isRead = false`
--
--   বিদ্যমান `(userId, isRead)` ইনডেক্স কোনোটিকেই সাহায্য করত না —
--   দুটোই **Seq Scan** হতো। মাপা (১ লাখ সারি, স্থানীয় ডেভ DB):
--     · তালিকা      : ১৭.৪ms → ০.০৫ms   (`(userId, createdAt)`)
--     · unread গণনা : ১১.৩ms → ~০ms      (partial index, কেবল অপঠিত সারি)
--
--   partial index ইচ্ছাকৃত: অপঠিত বিজ্ঞপ্তিই কেবল গোনা হয়, তাই ইনডেক্সটি
--   ছোট থাকে ও পড়া-হয়ে-যাওয়া সারিতে লেখা-খরচ বাড়ায় না।
-- ═══════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS "Notification_userId_createdAt_idx"
  ON "Notification" ("userId", "createdAt");

CREATE INDEX IF NOT EXISTS "Notification_userId_unread_idx"
  ON "Notification" ("userId")
  WHERE "isRead" = false;
