-- AUTH-05: per-session (per-device) logout revocation list.
-- Additive only: one new table + one index. No existing table/column is changed; no data is removed.

-- CreateTable
CREATE TABLE "RevokedSession" (
    "sid" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RevokedSession_pkey" PRIMARY KEY ("sid")
);

-- CreateIndex
CREATE INDEX "RevokedSession_expiresAt_idx" ON "RevokedSession"("expiresAt");
