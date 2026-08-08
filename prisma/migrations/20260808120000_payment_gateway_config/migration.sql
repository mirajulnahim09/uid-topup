-- ═══════════════════════════════════════════════════════════
-- ★ Group E — পেমেন্ট গেটওয়ে কনফিগ টেবিল
--
--   কনফিগ আগে `Setting`-এ key/value ছিল। সেখানে lastTestedAt /
--   lastError / updatedBy রাখার জায়গা ছিল না — টাকার পথের কনফিগে
--   "কে কখন বদলাল" না থাকা অডিটের ফাঁক।
--
--   ⚠️ সম্পূর্ণ **additive**: শুধু নতুন টেবিল। কোনো বিদ্যমান টেবিল,
--   কলাম বা সারি স্পর্শ করে না, তাই ডেটা হারানোর ঝুঁকি নেই।
--   পুরনো `Setting` সারিগুলো অক্ষত থাকে ও কোড সেগুলো এখনো পড়ে
--   (পিছন-সঙ্গতি); `scripts/migrate-payment-keys.ts` সেগুলো সরায়।
--
--   ⚠️ `credentials` এনক্রিপ্টেড JSON — কলামে কখনো প্লেইনটেক্সট নয়।
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS "PaymentGatewayConfig" (
    "provider"      TEXT NOT NULL,
    "isEnabled"     BOOLEAN NOT NULL DEFAULT false,
    "mode"          TEXT NOT NULL DEFAULT 'test',
    "credentials"   TEXT NOT NULL DEFAULT '',
    "lastTestedAt"  TIMESTAMP(3),
    "lastError"     TEXT,
    "updatedById"   TEXT,
    "updatedByName" TEXT,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- ⚠️ `updatedAt`-এ ইচ্ছাকৃতভাবে DB-ডিফল্ট নেই: Prisma-র `@updatedAt`
    --    মানটি ক্লায়েন্ট-স্তরে বসায়। DB-ডিফল্ট দিলে schema ও migration
    --    আলাদা হয়ে যেত (`migrate diff` drift দেখাত)।
    "updatedAt"     TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentGatewayConfig_pkey" PRIMARY KEY ("provider")
);
