/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ যাচাই/অডিট স্ক্রিপ্ট লাইভ ডাটাবেসে **লিখতে পারবে না**
 *
 *   `import './_guard-live-db';`  — ফাইলের **প্রথম** import হিসেবে।
 *
 *   ── কোন ঝুঁকিটি এটি বন্ধ করে ──
 *   `scripts/` এর ডজনখানেক স্ক্রিপ্ট `src/lib/prisma` ব্যবহার করে, আর
 *   সেটি `.env` পড়ে — অর্থাৎ **লাইভ Neon**। এদের অনেকগুলো টেস্ট-ইউজার
 *   বানায়, সেটিংস বদলায়, বাকেট মুছে দেয়। একটিবার ভুল করে চালালেই
 *   আসল গ্রাহকের ডাটাবেসে আবর্জনা — বা তার চেয়েও খারাপ, বদলে যাওয়া
 *   সেটিংস। ২০২৬-০৮-১৪ এর যাচাইয়ে `scripts/verify/*` এ ঠিক এই
 *   সমস্যাটিই পাওয়া গিয়েছিল।
 *
 *   ── নীতি: পড়া চলবে, লেখা নয় ──
 *   অনেক স্ক্রিপ্ট **ইচ্ছাকৃতভাবে** লাইভ সিস্টেম পরীক্ষা করে
 *   (`money-invariants`, `audit-system`) — সেগুলো পড়ে মাত্র, আর পড়া
 *   নিরাপদ। তাই সংযোগ আটকানো হয় না; আটকানো হয় কেবল **লেখার**
 *   অপারেশনগুলো, যখন DB স্থানীয় নয়।
 *
 *   ইচ্ছাকৃতভাবে লাইভে লিখতে হলে (যেমন `migrate-payment-keys`):
 *   `ALLOW_LIVE_WRITES=1` — সেই স্ক্রিপ্টগুলো এই গার্ড import করেই না।
 *
 *   ⚠️ এটি শেষ প্রতিরক্ষা, প্রথম নয়। প্রথমটি হলো ডেভ ডাটাবেস
 *   ব্যবহার করা (`scripts/verify/_db.ts`, যেটি সংযোগই দেয় না)।
 * ═══════════════════════════════════════════════════════════
 */
import { prisma } from '../src/lib/prisma';

/** লেখার অপারেশন — Prisma middleware এর `action` নাম */
const WRITE_ACTIONS = new Set([
  'create', 'createMany', 'createManyAndReturn',
  'update', 'updateMany', 'upsert',
  'delete', 'deleteMany',
  'executeRaw', 'executeRawUnsafe', 'runCommandRaw',
]);

function hostOf(url: string): string {
  try { return new URL(url).hostname; } catch { return ''; }
}

const URL_ = process.env.DATABASE_URL || '';
const host = hostOf(URL_);
const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1';

if (!isLocal && process.env.ALLOW_LIVE_WRITES !== '1') {
  /**
   * ⚠️ `$queryRaw` **আটকানো হয় না** — সেটি পড়ার পথ। কিন্তু কেউ
   *   `$queryRaw` দিয়ে `UPDATE ... RETURNING` চালালে সেটি গার্ড
   *   এড়িয়ে যাবে। তাই raw SQL-এ লেখার শব্দ থাকলেও থামানো হয়।
   */
  const RAW_WRITE = /\b(insert|update|delete|truncate|drop|alter|create)\b/i;

  prisma.$use(async (params, next) => {
    if (WRITE_ACTIONS.has(params.action)) {
      throw new Error(
        `✋ লাইভ ডাটাবেসে লেখা আটকানো হলো (${params.model ?? 'raw'}.${params.action}).\n` +
          `   হোস্ট: ${host}\n` +
          `   যাচাই স্ক্রিপ্ট ডেভ DB-তে চালান (npm run dev:db:up), অথবা\n` +
          `   সচেতনভাবে ALLOW_LIVE_WRITES=1 দিন।`,
      );
    }
    if (params.action === 'queryRaw') {
      const sql = String((params.args as { query?: string; sql?: string })?.query
        ?? (params.args as { sql?: string })?.sql ?? '');
      if (RAW_WRITE.test(sql)) {
        throw new Error(`✋ লাইভ ডাটাবেসে raw লেখা আটকানো হলো — হোস্ট: ${host}`);
      }
    }
    return next(params);
  });

  console.warn(`⚠️  লাইভ DB (${host}) — এই স্ক্রিপ্ট কেবল **পড়তে** পারবে, লিখতে নয়।`);
}

/** টেস্টে ব্যবহারের জন্য — গার্ড সক্রিয় কি না */
export const liveWriteGuardActive = !isLocal && process.env.ALLOW_LIVE_WRITES !== '1';
