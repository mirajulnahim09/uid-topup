-- ═══════════════════════════════════════════════════════════
-- ★ Group F — রিসেলার স্তর ও রিসেলার দাম
--
--   ⚠️ সম্পূর্ণ **additive ও অ-ধ্বংসাত্মক**:
--     · নতুন enum `UserTier`
--     · `User.tier` — NOT NULL কিন্তু DEFAULT 'NORMAL', তাই বিদ্যমান
--       প্রতিটি সারি স্বয়ংক্রিয়ভাবে NORMAL পায় ও দাম অপরিবর্তিত থাকে
--     · `Variant.resellerPrice` — **NULLable**, ডিফল্ট NULL
--
--   ⚠️ `resellerPrice` কেন DEFAULT 0 নয়: `0` মানে "ফ্রি", যা
--   "রিসেলার ছাড় নেই" থেকে সম্পূর্ণ আলাদা। ডিফল্ট 0 দিলে মাইগ্রেশন
--   চালানোমাত্র প্রতিটি রিসেলার অর্ডার শূন্য টাকায় চলে যেত।
--   NULL = ছাড় নেই → সাধারণ `price` প্রযোজ্য।
--
--   কোনো বিদ্যমান কলাম বা সারি বদলায় না, কিছু মুছে যায় না।
-- ═══════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'UserTier') THEN
    CREATE TYPE "UserTier" AS ENUM ('NORMAL', 'RESELLER');
  END IF;
END
$$;

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "tier" "UserTier" NOT NULL DEFAULT 'NORMAL';

ALTER TABLE "Variant"
  ADD COLUMN IF NOT EXISTS "resellerPrice" DECIMAL(12,2);
