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
/**
 * ⚠️⚠️ `./_env` **সবার আগে ও আলাদা ফাইলে** — কেন, তা ওই ফাইলে
 *   বিস্তারিত। সংক্ষেপে: এখানে `loadEnvConfig()` লিখলেও ESM
 *   `@prisma/client` কে তার **আগে** লোড করে ফেলত, আর Prisma লোড
 *   হওয়ার সময়েই `.env` (লাইভ Neon) থেকে `DATABASE_URL` বসিয়ে দিত।
 */
import './_env';

import { PrismaClient } from '@prisma/client';

/** যাচাই কোন সার্ভারের বিরুদ্ধে চলবে */
export const BASE = process.env.VERIFY_BASE || 'http://localhost:3000';

/**
 * ★ প্রোডাকশন রিগের (`scripts/prod-rig.mjs`) সার্টিফিকেট **self-signed**,
 *   তাই Node-এর `fetch` তাকে `DEPTH_ZERO_SELF_SIGNED_CERT` দিয়ে ফিরিয়ে দেয়।
 *   ফলে fetch-ভিত্তিক স্ক্রিপ্ট (order-price-lock, ban-revocation,
 *   ip-spoofing) রিগে চালালে **দাবি ব্যর্থ হওয়ার আগেই** ক্র্যাশ করত —
 *   দেখে মনে হতো regression, আসলে হারনেসের।
 *
 *   ⚠️ ছাড়টি **কেবল localhost https**-এ। দূরের হোস্ট হলে যাচাই আগের
 *   মতোই সার্ট যাচাই করে — নাহলে একদিন কেউ `VERIFY_BASE` এ আসল ডোমেইন
 *   দিয়ে TLS-অন্ধ হয়ে যাচাই চালাত।
 */
if (/^https:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(BASE)) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

/**
 * ★★★ রিগে চালালে স্ক্রিপ্ট-প্রসেসও `production` — নইলে **ফাঁপা পাস**
 *
 *   ⚠️ যে ফাঁদটি ধরা পড়েছে (EXTREME অডিট, ২০২৬-০৯-১৮):
 *   `authCookies.ts` কুকির নাম ঠিক করে `NODE_ENV` দেখে। রিগের সার্ভার
 *   `next start` — অর্থাৎ production — তাই সে পড়ে
 *   `__Secure-next-auth.session-token`। কিন্তু যাচাই-স্ক্রিপ্টের নিজের
 *   প্রসেসে `NODE_ENV` production ছিল না, তাই সে হাতে-বানানো সেশন কুকি
 *   লিখত `next-auth.session-token` নামে — সার্ভার যা কখনো পড়েই না।
 *
 *   ফল দুই রকম, দুটোই খারাপ:
 *     · `ban-revocation` / `order-price-lock` — 401 পেয়ে **মিথ্যা লাল**।
 *     · `isr-no-user-leak` — দুই "ভিন্ন" ইউজারই আসলে **অতিথি** হয়ে
 *       যেত, তাই "A এর তথ্য B এর HTML এ নেই" দাবিটি শূন্যগর্ভভাবে পাস
 *       করত (মাপা: দুজনের মার্কআপ-হ্যাশ হুবহু এক)। এটিই বেশি বিপজ্জনক —
 *       লাল হলে চোখে পড়ে, ফাঁপা সবুজ পড়ে না।
 *
 *   তাই রিগের ঠিকানায় চালালে এখানেই একবার স্থির করে দেওয়া হয়, এবং
 *   `authCookies` এর **আগেই** (consumer → `_db` → `authCookies`)।
 */
if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]):(3443|3100)(\/|$)/.test(BASE)) {
  // ⚠️ Next-এর টাইপে `NODE_ENV` read-only (অ্যাপ-কোড যেন বদলাতে না পারে)।
  //    এটি অ্যাপ নয়, আলাদা যাচাই-প্রসেস — রানটাইমে বদলানো বৈধ ও উদ্দেশ্যমূলক,
  //    তাই সরাসরি অ্যাসাইনমেন্টের বদলে `Object.assign` (typecheck ভাঙে না)।
  Object.assign(process.env, { NODE_ENV: 'production' });
}

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
