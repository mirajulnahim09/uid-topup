import { prisma } from './prisma';
import { logger } from './logger';

/**
 * ═══════════════════════════════════════════════════════════
 * ★ শেয়ার্ড রেট লিমিটার (C2 — fixed)
 *
 *   আগে counters একটা in-memory `Map` এ থাকত। Vercel serverless-এ
 *   প্রতিটি ইনস্ট্যান্সের আলাদা মেমরি — তাই লগইন ব্রুট-ফোর্স / spam /
 *   deposit / order থ্রটল বাইপাস হতো (রিকোয়েস্ট ভিন্ন ইনস্ট্যান্সে
 *   পড়লেই কাউন্টার রিসেট)। এখন state Postgres-এ, একটি **atomic**
 *   `INSERT … ON CONFLICT … RETURNING` দিয়ে — সব ইনস্ট্যান্স একই
 *   কাউন্টার দেখে, race-free।
 *
 *   ⚠️ fail-open: রেট-লিমিট DB কল ব্যর্থ হলে বৈধ ইউজারকে **আটকাবো না**
 *   (নিরাপত্তার চেয়ে প্রাপ্যতা এখানে অগ্রাধিকার — লিমিটার নিজেই যেন
 *   ডস না বানায়)। ব্যর্থতা লগ হয়।
 *
 *   ⚠️ signature অপরিবর্তিত (এখন async): সব কল-সাইট শুধু `await` যোগ করে।
 * ═══════════════════════════════════════════════════════════
 */

export type RateLimitResult = { ok: boolean; remaining: number; retryAfter: number };

/**
 * ★ লগইন-সীমা এক জায়গায়।
 *   আগে সংখ্যাগুলো `auth.ts`-এ হার্ডকোড ছিল, ফলে `/api/auth/login-status`
 *   একই সীমা ধরে হিসাব করতে পারত না — দুই জায়গার মান আলাদা হয়ে গেলে
 *   UI ভুল বার্তা দিত। এখন একটিই উৎস।
 */
export const LOGIN_LIMITS = {
  ip: { limit: 10, window: 600 },     // ১০ চেষ্টা / ১০ মিনিট / IP
  email: { limit: 5, window: 900 },   // ৫ চেষ্টা / ১৫ মিনিট / ইমেইল
} as const;

export async function rateLimit(
  key: string,
  limit: number,
  windowSec: number
): Promise<RateLimitResult> {
  const now = Date.now();

  try {
    // ★ একটিমাত্র atomic স্টেটমেন্ট: নতুন key হলে count=1; বিদ্যমান হলে —
    //   উইন্ডো শেষ হয়ে গেলে রিসেট (count=1, নতুন resetAt), নাহলে count+1।
    //   RETURNING দিয়ে হালনাগাদ মান ফেরত আসে — check-then-write race নেই।
    //   ⚠️ তুলনা ও নতুন resetAt দুটোই **DB ঘড়ি** (NOW()) দিয়ে হিসাব হয়,
    //   অ্যাপ-ঘড়ি (Date.now()) নয় — নাহলে অ্যাপ ও DB সার্ভারের clock-skew
    //   ছোট উইন্ডোতে ভুল ফল দিত।
    const rows = await prisma.$queryRaw<Array<{ count: number; resetAt: Date }>>`
      INSERT INTO "RateLimitBucket" ("key", "count", "resetAt")
      VALUES (${key}, 1, NOW() + ${windowSec} * INTERVAL '1 second')
      ON CONFLICT ("key") DO UPDATE SET
        "count"   = CASE WHEN "RateLimitBucket"."resetAt" < NOW() THEN 1 ELSE "RateLimitBucket"."count" + 1 END,
        "resetAt" = CASE WHEN "RateLimitBucket"."resetAt" < NOW() THEN NOW() + ${windowSec} * INTERVAL '1 second' ELSE "RateLimitBucket"."resetAt" END
      RETURNING "count", "resetAt"
    `;

    const row = rows[0];
    if (!row) return { ok: true, remaining: limit, retryAfter: 0 };

    const count = Number(row.count);
    const ra = new Date(row.resetAt).getTime();

    // ★ মেয়াদোত্তীর্ণ সারি periodically পরিষ্কার — প্রতি কলে নয় (সস্তা রাখতে
    //   ~2% সম্ভাবনায়), fire-and-forget।
    if (Math.random() < 0.02) {
      prisma.$executeRaw`DELETE FROM "RateLimitBucket" WHERE "resetAt" < NOW()`.catch(() => {});
    }

    if (count > limit) {
      return { ok: false, remaining: 0, retryAfter: Math.max(1, Math.ceil((ra - now) / 1000)) };
    }
    return { ok: true, remaining: Math.max(0, limit - count), retryAfter: 0 };
  } catch (e) {
    // ★ fail-open — লিমিটার DB সমস্যা হলে বৈধ ট্রাফিক আটকানো যাবে না
    logger.error('rateLimit', 'db error, failing open', { err: e });
    return { ok: true, remaining: limit, retryAfter: 0 };
  }
}

/**
 * ★ মেয়াদোত্তীর্ণ বাকেট মুছে ফেলা — C2-এর cron জব এটি ডাকে।
 *
 *   আগে পরিষ্কারের একমাত্র পথ ছিল প্রতি কলে **২% সম্ভাবনার**
 *   fire-and-forget DELETE (নিচে, `rateLimit()`-এর ভেতরে)। ট্রাফিক
 *   কম থাকলে সেটি কার্যত কখনোই চলত না, আর টেবিল বাড়তেই থাকত।
 *   এখন একটি নির্ধারিত জব দিনে একবার নিশ্চিতভাবে পরিষ্কার করে;
 *   ২%-এর পথটি fallback হিসেবে **রেখে দেওয়া হয়েছে** (H5 অনুযায়ী),
 *   যাতে cron বন্ধ থাকলেও টেবিল সম্পূর্ণ অনিয়ন্ত্রিত না হয়।
 *
 *   @returns কতগুলো সারি মুছল
 */
export async function cleanupRateLimitBuckets(): Promise<number> {
  const deleted = await prisma.$executeRaw`
    DELETE FROM "RateLimitBucket" WHERE "resetAt" < NOW()
  `;
  return Number(deleted);
}

/**
 * ★ বাকেট **পড়ে দেখা** — গণনা বাড়ায় না।
 *
 *   কেন দরকার: লগইন ব্যর্থ হলে UI জানতে চায় "পাসওয়ার্ড ভুল, না কি
 *   অনেকবার চেষ্টা হয়েছে?" — কিন্তু সেটা জিজ্ঞেস করতে গিয়ে যদি
 *   কাউন্টার আরেক ধাপ বাড়ে, তবে প্রশ্নটাই ব্যবহারকারীকে আরও গভীরে
 *   আটকে দিত। তাই খাঁটি SELECT।
 */
export async function peekRateLimit(
  key: string,
  limit: number
): Promise<{ limited: boolean; retryAfter: number }> {
  try {
    const rows = await prisma.$queryRaw<Array<{ count: number; resetAt: Date }>>`
      SELECT "count", "resetAt" FROM "RateLimitBucket"
      WHERE "key" = ${key} AND "resetAt" > NOW()
    `;
    const row = rows[0];
    if (!row) return { limited: false, retryAfter: 0 };
    const retryAfter = Math.max(0, Math.ceil((new Date(row.resetAt).getTime() - Date.now()) / 1000));
    return { limited: Number(row.count) > limit, retryAfter };
  } catch (e) {
    // ★ fail-open — পড়তে না পারলে "আটকানো হয়নি" ধরে নিই
    logger.error('rateLimit', 'peek failed', { err: e });
    return { limited: false, retryAfter: 0 };
  }
}

/**
 * ★ বাকেট মুছে ফেলা — সফল প্রমাণীকরণের পর।
 *
 *   ⚠️ এটি নিরাপত্তা দুর্বল করে না, **ঠিক** করে। ব্রুট-ফোর্স গার্ডের
 *   কাজ **ব্যর্থ** চেষ্টা গোনা। সফল লগইনও গুনলে একজন বৈধ ব্যবহারকারী
 *   নিজের সফল লগইন দিয়েই নিজেকে লক-আউট করে ফেলতেন — বাস্তবে ঠিক
 *   তাই ঘটেছিল (৫টি সফল লগইনের পর ষষ্ঠটি "পাসওয়ার্ড ভুল" বলত)।
 *   পাসওয়ার্ড জানা থাকলে আক্রমণকারীর আর ব্রুট-ফোর্স করার কিছু নেই,
 *   তাই সফল চেষ্টা গুনে রাখার কোনো প্রতিরক্ষামূলক মূল্যও নেই।
 */
export async function resetRateLimit(key: string): Promise<void> {
  try {
    await prisma.$executeRaw`DELETE FROM "RateLimitBucket" WHERE "key" = ${key}`;
  } catch (e) {
    logger.error('rateLimit', 'reset failed', { key, err: e });
  }
}

export function getIp(req: Request): string {
  const h = req.headers;
  return (
    h.get('x-real-ip') ||
    h.get('cf-connecting-ip') ||
    h.get('x-forwarded-for')?.split(',')[0].trim() ||
    'unknown'
  );
}

export const LIMITS = {
  register: { limit: 5, window: 3600 },
  order: { limit: 20, window: 300 },
  deposit: { limit: 10, window: 600 },
  coupon: { limit: 15, window: 300 },
  upload: { limit: 25, window: 600 },
  // ★ UID যাচাই তৃতীয় পক্ষের সার্ভিসে যায় — enumeration ও কোটা
  //   নষ্ট হওয়া ঠেকাতে সীমা
  uidVerify: { limit: 30, window: 300 },
  // ★ অর্ডার ট্র্যাকিং — অননুমোদিত endpoint, তাই IP ভিত্তিক কড়া সীমা।
  //   অর্ডার নাম্বার + ফোন brute-force করার সুযোগ দেওয়া যাবে না।
  track: { limit: 10, window: 300 },
  // ★ TrxID ডুপ্লিকেট পরীক্ষা — enumeration ঠেকাতে সীমা
  trxCheck: { limit: 20, window: 300 },
} as const;
