/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ verify স্ক্রিপ্টগুলোর জন্য **নিরাপদ** DB সংযোগ ও env
 *
 *   ── কোন সমস্যাটি এটি ঠেকায় ──
 *
 *   verify স্ক্রিপ্টগুলো দুই জায়গায় কথা বলে:
 *     ১. `http://localhost:3000` — অর্থাৎ `next dev`, যে
 *        **`.env.development`** পড়ে (ডেভ DB, পোর্ট 5434)
 *     ২. নিজের Prisma ক্লায়েন্ট — যেটি আগে `src/lib/prisma`
 *        থেকে আসত, আর সে `.env` পড়ে — অর্থাৎ **লাইভ Neon**
 *
 *   ফলে দুটি আলাদা ডাটাবেস: স্ক্রিপ্ট টেস্ট-ইউজার বানাত
 *   **প্রোডাকশনে**, অথচ API কল করত ডেভ ডাটাবেসে। দুই দিকেই
 *   ক্ষতি — প্রকৃত গ্রাহকের ডাটাবেসে আবর্জনা, আর যাচাইয়ের ফল
 *   অর্থহীন (যে সারিটি বানানো হলো API সেটি দেখতেই পায় না)।
 *   ২০২৬-০৮-১১ এর আগে দুটি এক ডাটাবেস ছিল, তাই এটি তখন ধরা পড়েনি।
 *
 *   ── নীতি ──
 *   ১. env লোড হয় **dev মোডে** (`loadEnvConfig(dir, true)`) —
 *      ঠিক যেভাবে `next dev` করে, অর্থাৎ `.env.development`
 *      `.env` এর উপরে বসে। NEXTAUTH_SECRET-ও তাই সার্ভারের
 *      সাথে হুবহু মেলে; নাহলে হাতে বানানো কুকি সার্ভার কখনো
 *      যাচাই করতে পারত না।
 *   ২. DB URL **স্থানীয় না হলে স্ক্রিপ্ট চলে না**। এই স্ক্রিপ্টগুলো
 *      সারি তৈরি ও মুছে — সেটি প্রোডাকশনে করার জিনিস নয়।
 *      সচেতনভাবে দরকার হলে `VERIFY_ALLOW_REMOTE=1`।
 * ═══════════════════════════════════════════════════════════
 */
import { loadEnvConfig } from '@next/env';

// ⚠️ `dev = true` — `.env.development` ওভারলে করার একমাত্র উপায়
loadEnvConfig(process.cwd(), true);

import { PrismaClient } from '@prisma/client';

/** যাচাই কোন সার্ভারের বিরুদ্ধে চলবে */
export const BASE = process.env.VERIFY_BASE || 'http://localhost:3000';

const URL_ = process.env.VERIFY_DATABASE_URL || process.env.DATABASE_URL || '';

/** হোস্ট স্থানীয় কি না — পাসওয়ার্ড ছাপা হয় না, শুধু হোস্ট দেখা হয় */
function isLocal(u: string): boolean {
  try {
    const h = new URL(u).hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]';
  } catch {
    return false;
  }
}

if (!URL_) {
  console.error('✗ DATABASE_URL পাওয়া যায়নি — যাচাই চালানো যাচ্ছে না');
  process.exit(1);
}

if (!isLocal(URL_) && process.env.VERIFY_ALLOW_REMOTE !== '1') {
  console.error(
    '✗ DATABASE_URL স্থানীয় নয়।\n' +
      '  verify স্ক্রিপ্ট টেস্ট-সারি তৈরি ও মুছে — লাইভ ডাটাবেসে সেটি চালানো হয় না।\n' +
      '  ডেভ DB চালু করুন (`npm run dev:db:up`) অথবা সচেতনভাবে\n' +
      '  VERIFY_ALLOW_REMOTE=1 দিন।',
  );
  process.exit(1);
}

/**
 * ★★★ `process.env.DATABASE_URL` **এখানেই স্থির করে দেওয়া হয়**।
 *
 *   কারণ কিছু যাচাই স্ক্রিপ্টের অ্যাপের **নিজের** ক্লায়েন্টটাই লাগে
 *   (`src/lib/prisma`) — যেমন `ratelimit-failclosed` সেটির
 *   `$queryRaw` সাময়িকভাবে ভাঙে। সেই মডিউলটি import হওয়ার সময়
 *   `process.env.DATABASE_URL` পড়ে, তাই এই ফাইলটি আগে চললে সে-ও
 *   একই (স্থানীয়) ডাটাবেসেই যুক্ত হয়।
 */
process.env.DATABASE_URL = URL_;

/**
 * ★ URL **স্পষ্ট করে** দেওয়া হচ্ছে। `new PrismaClient()` খালি হাতে
 *   ডাকলে Prisma নিজে `.env` পড়ে — অর্থাৎ আবার সেই লাইভ Neon,
 *   `.env.development` তার কাছে অদৃশ্য।
 */
export const db = new PrismaClient({ datasources: { db: { url: URL_ } } });

/** কোন ডাটাবেসে চলছে তা রানের মাথায় দেখানো (হোস্ট+নাম, শংসাপত্র নয়) */
export function dbLabel(): string {
  try {
    const u = new URL(URL_);
    return `${u.hostname}:${u.port || '5432'}${u.pathname}`;
  } catch {
    return 'অজানা';
  }
}
