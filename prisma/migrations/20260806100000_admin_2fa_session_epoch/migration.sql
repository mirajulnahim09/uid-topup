-- ═══════════════════════════════════════════════════════════
-- ★ Phase 2 — Admin 2FA (TOTP) + Session Epoch
--
--   User টেবিলে যোগ:
--   · twoFactorSecret    — এনক্রিপ্টেড TOTP secret (base32)
--   · twoFactorEnabled   — 2FA চালু কিনা
--   · twoFactorRecovery  — recovery কোডের SHA-256 হ্যাশ (JSON array)
--   · sessionEpoch       — "সব ডিভাইস সাইন-আউট" (বাড়ালে পুরনো JWT বাতিল)
--
--   সবই additive ও nullable/defaulted — পুরনো সারি ও কোড অক্ষত।
--   IF NOT EXISTS — baseline-পরবর্তী নিরাপদ পুনঃপ্রয়োগ।
-- ═══════════════════════════════════════════════════════════
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "twoFactorSecret" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "twoFactorRecovery" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "sessionEpoch" INTEGER NOT NULL DEFAULT 0;
