-- ═══════════════════════════════════════════════════════════
-- ★ Phase 3 পারফরম্যান্স — Order টেবিলে বিক্রি-হিসাবের index
--
--   getShowcase() চালায়: groupBy(variantId) WHERE status='COMPLETED'।
--   আগে [status, createdAt] ও [userId] index ছিল, কিন্তু (status,
--   variantId) এর জন্য কিছু ছিল না — order বড় হলে পূর্ণ scan হতো।
--
--   CONCURRENTLY — বড় টেবিলেও লক ছাড়া index তৈরি (production-নিরাপদ)।
--   IF NOT EXISTS — পুনঃপ্রয়োগ নিরাপদ।
--   ⚠️ CONCURRENTLY transaction-এ চলে না; Prisma প্রতিটি statement
--      আলাদা চালায়, তাই এখানে সমস্যা নেই।
-- ═══════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS "Order_status_variantId_idx" ON "Order"("status", "variantId");
CREATE INDEX IF NOT EXISTS "Order_variantId_idx" ON "Order"("variantId");
