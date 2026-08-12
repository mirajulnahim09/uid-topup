-- ═══════════════════════════════════════════════════════════
-- ★ Group I (৪) — ইন-অ্যাপ টিকিট ও বিরোধ-থ্রেড
--
--   ⚠️ সম্পূর্ণ **additive ও অ-ধ্বংসাত্মক**:
--     · নতুন enum `TicketStatus`, `TicketKind`
--     · নতুন টেবিল `Ticket`, `TicketMessage`
--   কোনো বিদ্যমান টেবিল, কলাম বা সারি স্পর্শ করে না।
--
--   ⚠️ `Ticket.orderId` → `ON DELETE SET NULL`, CASCADE নয়।
--   বিরোধের থ্রেড একটি আর্থিক রেকর্ড; অর্ডার সারি কোনোদিন মুছে গেলেও
--   "কে কী দাবি করেছিল" থেকে যেতে হবে (CLAUDE.md §2.1(৫))।
--
--   ⚠️ `TicketMessage.ticketId` → CASCADE, কারণ টিকিট ছাড়া একটি
--   অনাথ বার্তার কোনো অর্থ নেই।
-- ═══════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TicketStatus') THEN
    CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'ANSWERED', 'CLOSED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TicketKind') THEN
    CREATE TYPE "TicketKind" AS ENUM ('GENERAL', 'DISPUTE');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "Ticket" (
  "id"            TEXT NOT NULL,
  "userId"        TEXT NOT NULL,
  "orderId"       TEXT,
  "kind"          "TicketKind" NOT NULL DEFAULT 'GENERAL',
  "status"        "TicketStatus" NOT NULL DEFAULT 'OPEN',
  "subject"       TEXT NOT NULL,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedAt"      TIMESTAMP(3),

  CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Ticket_userId_lastMessageAt_idx" ON "Ticket" ("userId", "lastMessageAt");
CREATE INDEX IF NOT EXISTS "Ticket_status_lastMessageAt_idx" ON "Ticket" ("status", "lastMessageAt");

CREATE TABLE IF NOT EXISTS "TicketMessage" (
  "id"         TEXT NOT NULL,
  "ticketId"   TEXT NOT NULL,
  "authorId"   TEXT,
  "authorName" TEXT NOT NULL,
  "isStaff"    BOOLEAN NOT NULL DEFAULT false,
  "body"       TEXT NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TicketMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "TicketMessage_ticketId_createdAt_idx"
  ON "TicketMessage" ("ticketId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Ticket_userId_fkey') THEN
    ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Ticket_orderId_fkey') THEN
    ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_orderId_fkey"
      FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TicketMessage_ticketId_fkey') THEN
    ALTER TABLE "TicketMessage" ADD CONSTRAINT "TicketMessage_ticketId_fkey"
      FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;
