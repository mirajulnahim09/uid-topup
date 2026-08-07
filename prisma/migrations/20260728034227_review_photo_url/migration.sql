-- ★ ফিচার ১৬ — রিভিউতে ঐচ্ছিক স্ক্রিনশট
-- গ্রাহক চাইলে অর্ডারের ছবি যোগ করতে পারবে (বাধ্যতামূলক নয়)।
--
-- ⚠️ IF NOT EXISTS — কারণ baseline init migration (00000000000000_init)
--    বর্তমান schema-র পূর্ণ রূপ ধরে, তাই সেখানে `photoUrl` ইতিমধ্যে আছে।
--    fresh DB-তে baseline চললে এই কলাম আগেই তৈরি; existing DB-তে যেখানে
--    এই migration আগে db push দিয়ে প্রয়োগ হয়েছিল, সেখানেও নিরাপদ।
ALTER TABLE "Review" ADD COLUMN IF NOT EXISTS "photoUrl" TEXT;
