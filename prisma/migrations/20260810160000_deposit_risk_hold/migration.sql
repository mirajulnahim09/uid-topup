-- ═══════════════════════════════════════════════════════════
-- ★ Group H — ডিপোজিটে ঝুঁকির snapshot ও auto-hold
--
--   ⚠️ সম্পূর্ণ **additive ও অ-ধ্বংসাত্মক**:
--     · নতুন enum `DepositRisk`
--     · `riskLevel` — NOT NULL কিন্তু DEFAULT 'NORMAL', তাই বিদ্যমান
--       প্রতিটি সারি স্বয়ংক্রিয়ভাবে NORMAL পায়
--     · `riskNote` · `riskHeldAt` — দুটোই NULLable
--
--   ⚠️ পুরনো ডিপোজিটে `riskHeldAt` NULL, অর্থাৎ কোনোটিই hold হয় না —
--   মাইগ্রেশন চালানোমাত্র কারও টাকা আটকে যাবে না।
--
--   কোনো বিদ্যমান কলাম বদলায় না, কোনো সারি মুছে যায় না।
-- ═══════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DepositRisk') THEN
    CREATE TYPE "DepositRisk" AS ENUM ('TRUSTED', 'NORMAL', 'ELEVATED');
  END IF;
END
$$;

ALTER TABLE "Deposit"
  ADD COLUMN IF NOT EXISTS "riskLevel" "DepositRisk" NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN IF NOT EXISTS "riskNote" TEXT,
  ADD COLUMN IF NOT EXISTS "riskHeldAt" TIMESTAMP(3);
