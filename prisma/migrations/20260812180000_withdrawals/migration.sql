-- ═══════════════════════════════════════════════════════════
-- ★ Group I (৫) — ওয়ালেট থেকে টাকা তোলা
--
--   ⚠️ সম্পূর্ণ **additive ও অ-ধ্বংসাত্মক**:
--     · `LedgerType`-এ দুটি নতুন মান (enum-এ যোগ, কিছু সরানো নয়)
--     · `OtpPurpose`-এ `WITHDRAW`
--     · নতুন enum `WithdrawalStatus`, নতুন টেবিল `Withdrawal`
--   কোনো বিদ্যমান কলাম বা সারি বদলায় না।
--
--   ⚠️ `Withdrawal.userId` → `ON DELETE RESTRICT`। প্রত্যাহার একটি
--   আর্থিক রেকর্ড; যে ইউজারের টাকা বেরিয়েছে তাকে মুছে ফেলে ইতিহাস
--   হারানো যাবে না।
-- ═══════════════════════════════════════════════════════════

ALTER TYPE "LedgerType" ADD VALUE IF NOT EXISTS 'WITHDRAWAL';
ALTER TYPE "LedgerType" ADD VALUE IF NOT EXISTS 'WITHDRAWAL_REVERSAL';
ALTER TYPE "OtpPurpose" ADD VALUE IF NOT EXISTS 'WITHDRAW';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WithdrawalStatus') THEN
    CREATE TYPE "WithdrawalStatus" AS ENUM ('PENDING', 'HELD', 'APPROVED', 'REJECTED');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "Withdrawal" (
  "id"              TEXT NOT NULL,
  "userId"          TEXT NOT NULL,
  "amount"          DECIMAL(12,2) NOT NULL,
  "method"          TEXT NOT NULL,
  "accountNumber"   TEXT NOT NULL,
  "status"          "WithdrawalStatus" NOT NULL DEFAULT 'PENDING',
  "riskLevel"       "DepositRisk" NOT NULL DEFAULT 'NORMAL',
  "riskNote"        TEXT,
  "heldAt"          TIMESTAMP(3),
  "adminNote"       TEXT,
  "payoutRef"       TEXT,
  "processedById"   TEXT,
  "processedByName" TEXT,
  "processedAt"     TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Withdrawal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Withdrawal_userId_status_idx" ON "Withdrawal" ("userId", "status");
CREATE INDEX IF NOT EXISTS "Withdrawal_status_createdAt_idx" ON "Withdrawal" ("status", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Withdrawal_userId_fkey') THEN
    ALTER TABLE "Withdrawal" ADD CONSTRAINT "Withdrawal_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;
