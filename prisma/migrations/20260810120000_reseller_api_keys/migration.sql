-- ═══════════════════════════════════════════════════════════
-- ★ Group F (৩) — রিসেলার API কী ও অর্ডার idempotency
--
--   ⚠️ সম্পূর্ণ **additive ও অ-ধ্বংসাত্মক**:
--     · নতুন টেবিল `ApiKey` — কোনো বিদ্যমান টেবিল ছোঁয় না
--     · `Order.clientRef` — **NULLable**, ডিফল্ট NULL, তাই বিদ্যমান
--       প্রতিটি অর্ডার হুবহু আগের মতোই থাকে
--
--   ⚠️ `Order_userId_clientRef_key` ইউনিক ইনডেক্স কেন নিরাপদ:
--   Postgres-এ ইউনিক ইনডেক্স একাধিক NULL মানে বাধা দেয় না। ওয়েবের
--   সব অর্ডার (পুরনো ও নতুন) clientRef = NULL, তাই তারা কখনো
--   পরস্পরের সাথে সংঘর্ষ করে না। বাধাটি কেবল API চ্যানেলে প্রযোজ্য,
--   আর সেখানেই এটি ডাবল-চার্জ ঠেকায়।
--
--   কোনো বিদ্যমান কলাম বদলায় না, কোনো সারি মুছে যায় না।
-- ═══════════════════════════════════════════════════════════

ALTER TABLE "Order"
  ADD COLUMN IF NOT EXISTS "clientRef" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Order_userId_clientRef_key"
  ON "Order" ("userId", "clientRef");

CREATE TABLE IF NOT EXISTS "ApiKey" (
  "id"            TEXT NOT NULL,
  "userId"        TEXT NOT NULL,
  "label"         TEXT NOT NULL,
  "prefix"        TEXT NOT NULL,
  "hash"          TEXT NOT NULL,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt"    TIMESTAMP(3),
  "revokedAt"     TIMESTAMP(3),
  "createdById"   TEXT,
  "createdByName" TEXT,

  CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ApiKey_hash_key" ON "ApiKey" ("hash");
CREATE INDEX IF NOT EXISTS "ApiKey_userId_revokedAt_idx" ON "ApiKey" ("userId", "revokedAt");

-- ★ ইউজার মুছে গেলে তার কীগুলোও যায় — একটি অনাথ কী দিয়ে অর্ডার
--   করার পথ যেন কোনো অবস্থাতেই খোলা না থাকে।
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ApiKey_userId_fkey'
  ) THEN
    ALTER TABLE "ApiKey"
      ADD CONSTRAINT "ApiKey_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;
