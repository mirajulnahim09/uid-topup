import { prisma } from './prisma';

/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ AUTH-06 — TOTP replay-রোধ (RFC 6238 §5.2)
 *
 *   আগে একটি বৈধ কোড ±১ ধাপ window-এ প্রায় ৯০ সেকেন্ড চলত — ফিশিং-প্রক্সি
 *   ব্যবহারকারীর দেওয়া কোডটিই আবার ব্যবহার করতে পারত। এখন প্রতিটি সফল TOTP
 *   যাচাইয়ের পর মেলা ধাপটি ব্যবহারকারীর জন্য **খরচ** হয়: একই বা আগের ধাপ আর
 *   গ্রহণযোগ্য নয় (পরের ৩০s-এর কোডের জন্য অপেক্ষা করতে হয়)।
 *
 *   ── কেন Setting সারি, User-এ নতুন কলাম নয় ──
 *   কলাম মানে প্রোডাকশন migration। একটিমাত্র শর্তসাপেক্ষ upsert-ই যথেষ্ট ও
 *   **atomic**: `ON CONFLICT … DO UPDATE … WHERE পুরনো < নতুন` — দুটি সমান্তরাল
 *   লগইন একই কোড নিয়ে এলে Postgres সারি-লক করে একটিকেই জেতায়। কী-তে `:` থাকায়
 *   সারিটি সাইট-settings-এ ঢোকে না (`getSettings` বাদ দেয়), restore-এ allowlist-
 *   বহির্ভূত বলে ফেরত আসে না (তাই পুরনো ধাপে "ফিরে যাওয়া" যায় না)।
 * ═══════════════════════════════════════════════════════════
 */
export const totpStepKey = (userId: string) => `totp:last-step:${userId}`;

/** ★ `true` = ধাপটি এইমাত্র দাবি করা হলো (আগে কখনো এটি বা পরের ধাপ ব্যবহৃত হয়নি) */
export async function claimTotpStep(userId: string, step: number): Promise<boolean> {
  if (!Number.isSafeInteger(step) || step < 0) return false;
  const key = totpStepKey(userId);
  const value = String(step);
  const rows = await prisma.$queryRaw<Array<{ key: string }>>`
    INSERT INTO "Setting" ("key", "value") VALUES (${key}, ${value})
    ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value"
    WHERE CAST("Setting"."value" AS BIGINT) < CAST(EXCLUDED."value" AS BIGINT)
    RETURNING "key"`;
  return rows.length === 1;
}
