-- ═══════════════════════════════════════════════════════════
-- ★ Group I (৩) — চ্যানেল-নিরপেক্ষ OTP
--
--   ⚠️ সম্পূর্ণ **additive ও অ-ধ্বংসাত্মক**:
--     · নতুন enum `OtpChannel`, `OtpPurpose`
--     · নতুন টেবিল `Otp` — কোনো বিদ্যমান টেবিল ছোঁয় না
--     · `User.phoneVerified` — NOT NULL কিন্তু DEFAULT false, তাই
--       বিদ্যমান প্রতিটি সারি স্বয়ংক্রিয়ভাবে মান পায়
--
--   ⚠️ `emailVerified` এর ডিফল্ট **বদলানো হয়নি**। নতুন সাইনআপ
--   রুট-হ্যান্ডলারে স্পষ্টভাবে `true` লিখবে (কোড যাচাইয়ের পর, একই
--   ট্রানজেকশনে)। ডিফল্ট `true` করলে OTP পথ কখনো ভাঙলেও অ্যাকাউন্ট
--   "যাচাইকৃত" দেখাত — অর্থাৎ ব্যর্থতা নীরব হতো।
--
--   কোনো বিদ্যমান কলাম বদলায় না, কোনো সারি মুছে যায় না।
-- ═══════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OtpChannel') THEN
    CREATE TYPE "OtpChannel" AS ENUM ('EMAIL', 'SMS');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OtpPurpose') THEN
    CREATE TYPE "OtpPurpose" AS ENUM ('REGISTER', 'PHONE_ADD', 'DEPOSIT');
  END IF;
END
$$;

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "phoneVerified" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "Otp" (
  "id"          TEXT NOT NULL,
  "channel"     "OtpChannel" NOT NULL,
  "purpose"     "OtpPurpose" NOT NULL DEFAULT 'REGISTER',
  "destination" TEXT NOT NULL,
  "codeHash"    TEXT NOT NULL,
  "attempts"    INTEGER NOT NULL DEFAULT 0,
  "expiresAt"   TIMESTAMP(3) NOT NULL,
  "consumedAt"  TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ip"          TEXT,

  CONSTRAINT "Otp_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Otp_destination_purpose_consumedAt_idx"
  ON "Otp" ("destination", "purpose", "consumedAt");
CREATE INDEX IF NOT EXISTS "Otp_expiresAt_idx" ON "Otp" ("expiresAt");
