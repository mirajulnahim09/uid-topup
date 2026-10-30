-- DB-01: index for AdminLog lookups by targetId (admin customer timeline; partial-refund
-- idempotency lookup that runs while the Order row lock is held).
-- CONCURRENTLY: building on a large production table must not block AdminLog writes.
-- Postgres forbids CONCURRENTLY inside a transaction, so this file holds this single statement only.
-- If a previous attempt failed midway, an INVALID index may remain: DROP INDEX CONCURRENTLY it and re-run.

-- CreateIndex
CREATE INDEX CONCURRENTLY IF NOT EXISTS "AdminLog_targetId_createdAt_idx" ON "AdminLog"("targetId", "createdAt");
