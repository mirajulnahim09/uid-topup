/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ Vitest সেটআপ — টেস্ট ডাটাবেস ও প্রোডাকশন-গার্ড (Group D)
 *
 *   ⚠️⚠️ সবচেয়ে বড় ঝুঁকি: টেস্ট ভুল করে **লাইভ Neon**-এ চলা।
 *   প্রতিটি টেস্ট টেবিল truncate করে; একবার ভুল হলে আসল গ্রাহক,
 *   অর্ডার ও খতিয়ান মুছে যেত — CLAUDE.md §2.1(৫) সরাসরি নিষেধ।
 *
 *   তাই তিন স্তরের গার্ড, এবং যেকোনো একটি না মিললে **প্রক্রিয়া
 *   থেমে যায়** (skip নয় — নীরব skip মানে কেউ ভাববে টেস্ট চলেছে):
 *     ১. হোস্ট অবশ্যই localhost / 127.0.0.1
 *     ২. ডাটাবেসের নাম অবশ্যই `_test` দিয়ে শেষ
 *     ৩. URL কখনোই `DATABASE_URL` (প্রোডাকশন) এর সমান নয়
 *
 *   ⚠️ কোনো পরিস্থিতিতে এই গার্ড শিথিল করবেন না।
 * ═══════════════════════════════════════════════════════════
 */
import { beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';

const TEST_URL =
  process.env.TEST_DATABASE_URL ||
  'postgresql://test:test@localhost:5433/uidtopup_test';

function assertSafe(url: string): void {
  let u: URL;
  try { u = new URL(url); } catch { throw new Error(`TEST_DATABASE_URL পার্স হয়নি: ${url}`); }

  const host = u.hostname;
  const name = u.pathname.replace(/^\//, '');

  if (!['localhost', '127.0.0.1', '::1', 'test-db'].includes(host)) {
    throw new Error(
      `\n✗ থামানো হলো — টেস্ট ডাটাবেসের হোস্ট "${host}", localhost নয়।\n` +
      `  টেস্ট প্রতিটি টেবিল truncate করে। রিমোট (Neon) ডাটাবেসে\n` +
      `  চালানো সম্পূর্ণ নিষিদ্ধ — CLAUDE.md §2.1।\n` +
      `  ডকার চালু করুন: npm run test:db:up\n`,
    );
  }
  if (!name.endsWith('_test')) {
    throw new Error(`\n✗ থামানো হলো — ডাটাবেসের নাম "${name}" "_test" দিয়ে শেষ হয় না।\n`);
  }
  const prod = process.env.DATABASE_URL;
  if (prod) {
    try {
      const p = new URL(prod);
      if (p.hostname === host && p.pathname === u.pathname) {
        throw new Error('\n✗ থামানো হলো — টেস্ট ও প্রোডাকশন ডাটাবেস একই।\n');
      }
    } catch { /* prod URL পার্স না হলে উপেক্ষা — উপরের গার্ডই যথেষ্ট */ }
  }
}

assertSafe(TEST_URL);

export const db = new PrismaClient({ datasources: { db: { url: TEST_URL } } });

/**
 * ★ প্রতিটি টেস্টের আগে সব টেবিল খালি — টেস্ট পরস্পরকে দূষিত করবে না।
 *   `TRUNCATE … RESTART IDENTITY CASCADE` দ্রুত এবং auto-increment
 *   রিসেট করে, তাই orderNo-এর মতো ক্রমিক মান প্রতিটি টেস্টে অনুমেয়।
 */
async function truncateAll(): Promise<void> {
  const rows = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'`;
  if (!rows.length) return;
  const list = rows.map((r) => `"public"."${r.tablename}"`).join(', ');
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

beforeAll(async () => { await db.$connect(); });
beforeEach(async () => { await truncateAll(); });
afterAll(async () => { await db.$disconnect(); });
