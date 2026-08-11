import { createHash } from 'node:crypto';
import { prisma } from './prisma';
import { logger } from './logger';
import { isRedisConfigured, redisIncrWindow, redisCmd, redisDel } from './redis';

/**
 * ★★★ Group H — Redis-এ যাওয়া কী **হ্যাশ করা**।
 *
 *   কারণ: বাকেট-কী-তে আসল মান থাকে — `login:email:rakib@gmail.com`,
 *   `forgot:ip:103.x.x.x`, `order:<userId>`। Postgres আমাদের নিজের
 *   ডাটাবেস, কিন্তু Upstash একটি **তৃতীয় পক্ষ**; সেখানে গ্রাহকের
 *   ইমেইল ও IP জমা করার কোনো দরকার নেই। কাউন্টারের জন্য কী-টির
 *   **অর্থ** লাগে না, কেবল তার অনন্যতা লাগে।
 *
 *   ⚠️ একই ইনপুট সবসময় একই হ্যাশ দেয়, তাই incr/peek/reset তিনটিই
 *   একই কী-তে পৌঁছায় — নাহলে reset কাজ করত না।
 */
function redisKey(key: string): string {
  return `rl:${createHash('sha256').update(key, 'utf8').digest('hex').slice(0, 32)}`;
}

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
 *   ⚠️ ডিফল্ট fail-**open**: রেট-লিমিট DB কল ব্যর্থ হলে সাধারণ ট্রাফিক
 *   আটকাবো না (লিমিটার নিজেই যেন ডস না বানায়)। ব্যর্থতা লগ হয়।
 *
 *   ★★★ C4 — কিন্তু **অথ-পথে fail-open অগ্রহণযোগ্য**।
 *   Postgres চাপে পড়লে (বা কেউ ইচ্ছে করে চাপ দিলে) লগইন ব্রুট-ফোর্স
 *   গার্ড সম্পূর্ণ উধাও হয়ে যেত — অর্থাৎ যে মুহূর্তে ডাটাবেস দুর্বল,
 *   ঠিক সেই মুহূর্তে পাসওয়ার্ড অনুমান **সীমাহীন** হয়ে পড়ত। আক্রমণকারীর
 *   জন্য এটি একটি সরাসরি রেসিপি: আগে DB-তে চাপ দাও, তারপর ব্রুট-ফোর্স।
 *   তাই `login:*` / `forgot:*` / `reset:*` / `2fa:*` (ও `pw:*`) কল-সাইট
 *   `{ failClosed: true }` পাঠায় — ব্যর্থ হলে অনুরোধ **আটকে যায়**।
 *
 *   ⚠️ signature পিছন-সঙ্গতিপূর্ণ: চতুর্থ প্যারামিটার ঐচ্ছিক, তাই
 *   পুরনো কোনো কল-সাইট বদলাতে হয়নি।
 * ═══════════════════════════════════════════════════════════
 */

export type RateLimitResult = {
  ok: boolean;
  remaining: number;
  retryAfter: number;
  /**
   * ★ লিমিটার **নিজে** ব্যর্থ হয়েছে (DB ত্রুটি) — সীমা ছাড়ায়নি।
   *   কল-সাইট এটি দেখে ভিন্ন বার্তা দেখায়: "অনেক বেশি চেষ্টা" নয়,
   *   বরং সার্ভার-সমস্যার বার্তা। ⚠️ বার্তায় কখনো বলা হয় না যে
   *   রেট-লিমিটার ভেঙেছে — সেটি আক্রমণকারীকে জানিয়ে দিত কখন
   *   গার্ড দুর্বল।
   */
  failed?: boolean;
};

export type RateLimitOptions = {
  /** ব্যর্থ হলে অনুরোধ আটকাবে? অথ-পথে সবসময় `true`। ডিফল্ট `false`। */
  failClosed?: boolean;
};

/**
 * ★ লিমিটার ব্যর্থ হলে ব্যবহারকারী যা দেখবেন।
 *   ইচ্ছাকৃতভাবে নিরাকার — "রেট-লিমিট ডাটাবেস ডাউন" বলা মানে
 *   আক্রমণকারীকে সময় বলে দেওয়া।
 */
export const RATE_LIMIT_UNAVAILABLE_MSG =
  'সার্ভারে সাময়িক সমস্যা হচ্ছে, একটু পরে আবার চেষ্টা করুন';

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
  windowSec: number,
  opts: RateLimitOptions = {}
): Promise<RateLimitResult> {
  const now = Date.now();
  const failClosed = opts.failClosed === true;

  // ═══════════════════════════════════════════════════════
  // ★★★ Group H — Redis কাউন্টার (কনফিগার করা থাকলে)।
  //
  //   কেন: প্রতিটি অনুরোধে একটি Postgres **লেখা** হয়। Neon-এ সংযোগ
  //   সীমিত ও auto-suspend আছে (H4), আর রেট-লিমিট কোনো খতিয়ান নয় —
  //   এটি নিছক একটি কাউন্টার। এর জন্য সবচেয়ে দামি সম্পদটি খরচ করা
  //   অপচয়।
  //
  //   ⚠️⚠️ C4-এর fail-closed আচরণ **অক্ষত**: Redis অনুপলব্ধ হলে
  //   `redisIncrWindow()` `null` ফেরে এবং নিচের Postgres পথটিই চলে —
  //   অর্থাৎ অথ-পথে ব্যর্থতা এখনো আটকায়। Redis একটি **দ্রুততর পথ**,
  //   গার্ডের বিকল্প নয়। কনফিগার না থাকলে একটিও নেটওয়ার্ক কল হয় না।
  //
  //   ⚠️ মাপা সীমা, সৎভাবে: Redis চালু থাকা অবস্থায় কাউন্টার কেবল
  //   Redis-এ থাকে। Redis হঠাৎ বন্ধ হলে (বা key evict হলে) গণনা
  //   শূন্য থেকে শুরু হবে, কারণ ঐ সময়ের কোনো গণনা Postgres-এ লেখা
  //   হয়নি। দুই জায়গায় লিখলে খরচ দ্বিগুণ হতো অথচ সুরক্ষা প্রায়
  //   একই — কাউন্টার হারানো সাময়িক ও স্ব-নিরাময়যোগ্য।
  // ═══════════════════════════════════════════════════════
  if (isRedisConfigured()) {
    const r = await redisIncrWindow(redisKey(key), windowSec);
    if (r) {
      if (r.count > limit) {
        return { ok: false, remaining: 0, retryAfter: Math.max(1, r.ttl) };
      }
      return { ok: true, remaining: Math.max(0, limit - r.count), retryAfter: 0 };
    }
    // ★ null = Redis ব্যর্থ → নিচের Postgres পথে (fail-closed সহ)
  }

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
    // ★ দুই ক্ষেত্রেই `error` লেভেলে লগ — নীরব অবনতি যেন না ঘটে।
    //   `failClosed` লগে রাখা হয় যাতে অপারেটর বুঝতে পারেন কোন
    //   ট্রাফিক আসলে আটকে গেছে।
    logger.error('rateLimit', failClosed ? 'db error, failing CLOSED' : 'db error, failing open', {
      key: key.split(':').slice(0, 2).join(':'), // ⚠️ পুরো key নয় — এতে ইমেইল/IP থাকে
      failClosed,
      err: e,
    });

    if (failClosed) {
      // ★ ৩০s — যথেষ্ট যেন স্বয়ংক্রিয় ব্রুট-ফোর্স কার্যত থেমে যায়,
      //   অথচ ক্ষণস্থায়ী DB হেঁচকিতে বৈধ ব্যবহারকারী দীর্ঘক্ষণ আটকে না থাকেন।
      return { ok: false, remaining: 0, retryAfter: 30, failed: true };
    }
    return { ok: true, remaining: limit, retryAfter: 0, failed: true };
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
): Promise<{ limited: boolean; retryAfter: number; failed?: boolean }> {
  // ★★★ Group H — কাউন্টার যেখানে, peek-ও সেখানেই।
  //   দুটো আলাদা জায়গা দেখলে UI একটা বলত আর গার্ড আরেকটা করত:
  //   লগইন পাতা "চেষ্টা বাকি আছে" দেখাত, অথচ অনুরোধ ৪২৯ পেত।
  if (isRedisConfigured()) {
    const rk = redisKey(key);
    const out = await redisCmd(['GET', rk]);
    if (out !== null) {
      const count = Number(out);
      if (Number.isFinite(count)) {
        const ttlRaw = await redisCmd(['TTL', rk]);
        const ttl = Number(ttlRaw);
        return {
          limited: count > limit,
          retryAfter: Number.isFinite(ttl) && ttl > 0 ? ttl : 0,
        };
      }
    }
    // ★ কী নেই = কোনো চেষ্টাই হয়নি। ⚠️ কিন্তু Redis **ব্যর্থ** হলেও
    //   `null` আসে — দুটো আলাদা করা যায় না, তাই নিরাপদ দিকে গিয়ে
    //   Postgres-কেও জিজ্ঞেস করি (নিচে)। খরচ কেবল peek-এর ক্ষেত্রে,
    //   যা লগইন ব্যর্থ হলেই কেবল ডাকা হয়।
  }

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
    // ★ peek কেবল **তথ্য** — এটি কাউকে ঢুকতে দেয় না, তাই এখানে
    //   fail-closed করার কিছু নেই। কিন্তু `failed` ফেরত দিই যাতে
    //   কল-সাইট "সীমা নেই" আর "জানা যায়নি" আলাদা করতে পারে —
    //   নাহলে লগইন পাতা DB-ডাউন অবস্থাতেও "পাসওয়ার্ড ভুল" বলত।
    logger.error('rateLimit', 'peek failed', { err: e });
    return { limited: false, retryAfter: 0, failed: true };
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
  // ★★★ Group H — **দুই জায়গাতেই** মুছতে হয়।
  //
  //   ⚠️ এটি ঐচ্ছিক পরিচ্ছন্নতা নয়। এই ফাংশনটিই সফল লগইনের পর
  //   বাকেট মুছে দেয়; Redis-এর কী রয়ে গেলে ব্যবহারকারী নিজের সফল
  //   লগইন দিয়েই নিজেকে লক-আউট করে ফেলতেন — হুবহু সেই বাগটিই
  //   একবার প্রোডাকশনে ঘটেছিল (উপরের মন্তব্য দেখুন)। তাই Redis
  //   কনফিগার থাকলে সেখানেও, আর Postgres-এ সবসময়ই (পুরনো সারি
  //   থাকতে পারে — যেমন Redis চালু হওয়ার আগে লেখা)।
  if (isRedisConfigured()) {
    await redisDel(redisKey(key));
  }
  try {
    await prisma.$executeRaw`DELETE FROM "RateLimitBucket" WHERE "key" = ${key}`;
  } catch (e) {
    logger.error('rateLimit', 'reset failed', { key, err: e });
  }
}

/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ H2 — ক্লায়েন্টের পাঠানো হেডার বিশ্বাস করা যাবে না
 *
 *   আগে সবার আগে `x-real-ip`, তারপর `x-forwarded-for` পড়া হতো —
 *   কোনো শর্ত ছাড়াই। Vercel/Cloudflare-এর পেছনে এটি নিরাপদ, কারণ
 *   প্ল্যাটফর্ম ওই হেডারগুলো **নিজে বসায় ও ওভাররাইট করে**।
 *
 *   কিন্তু সরাসরি (VPS, ডকার, `next start`) চালালে যে কেউ
 *   `X-Forwarded-For: 1.2.3.4` পাঠিয়ে প্রতিটি অনুরোধে **নতুন IP**
 *   দাবি করতে পারত। ফল: IP-ভিত্তিক প্রতিটি সীমা অর্থহীন —
 *   `login:ip:*` ব্রুট-ফোর্স গার্ড, `forgot:*`, `track:*`, `reg:*`
 *   সবই হেডার বদলে বাইপাস করা যেত। C4-এ যে ফাঁক বন্ধ করলাম,
 *   এটি ছিল সেটিরই আরেকটি দরজা।
 *
 *   ── এখনকার নিয়ম ──
 *   `TRUSTED_PROXY` সেট থাকলে (অর্থাৎ অপারেটর নিশ্চিত করেছেন সামনে
 *   একটি বিশ্বস্ত প্রক্সি আছে যা হেডার পুনর্লিখন করে) → `x-forwarded-for`
 *   এর বাঁ-দিকের মান ব্যবহার হয়।
 *
 *   সেট না থাকলে → কেবল **প্ল্যাটফর্ম-নির্ধারিত** হেডার
 *   (`x-real-ip`, `cf-connecting-ip`); ব্যবহারকারী-নিয়ন্ত্রিত
 *   `x-forwarded-for` **সম্পূর্ণ উপেক্ষা** করা হয়।
 *
 *   ⚠️ স্বীকৃত সীমাবদ্ধতা: Next.js route handler-এ কাঁচা socket ঠিকানা
 *   পাওয়া যায় না, তাই প্রক্সি-বিহীন স্থাপনায় `x-real-ip`-ও তাত্ত্বিকভাবে
 *   জাল হতে পারে। সেই ক্ষেত্রে সামনে একটি প্রক্সি রাখা এবং
 *   `TRUSTED_PROXY=1` দেওয়াই সঠিক স্থাপনা। Vercel-এ (এই প্রকল্পের
 *   লক্ষ্য) প্ল্যাটফর্মই হেডার বসায়, তাই ডিফল্ট নিরাপদ।
 * ═══════════════════════════════════════════════════════════
 */
/**
 * ★ হেডার-উৎস নিরপেক্ষ রূপ।
 *   `authorize()` (NextAuth) একটি সাধারণ অবজেক্ট দেয়, `Request` নয় —
 *   তাই দুই জায়গায় যুক্তি নকল না করে একটিই ফাংশন। আগে লগইন-পথে
 *   আলাদা কপি ছিল, আর সেখানেই `x-forwarded-for` নিঃশর্তে পড়া হতো —
 *   অর্থাৎ সবচেয়ে গুরুত্বপূর্ণ সীমাটিই সবচেয়ে সহজে বাইপাসযোগ্য ছিল।
 */
export function pickIp(get: (name: string) => string | null | undefined): string {
  const trustProxy = ['1', 'true', 'yes'].includes(
    (process.env.TRUSTED_PROXY || '').trim().toLowerCase(),
  );

  if (trustProxy) {
    const fwd = get('x-forwarded-for')?.split(',')[0]?.trim();
    if (fwd) return fwd;
  }

  return get('x-real-ip')?.trim() || get('cf-connecting-ip')?.trim() || 'unknown';
}

export function getIp(req: Request): string {
  return pickIp((n) => req.headers.get(n));
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
  /**
   * ★★★ Group F — রিসেলারের bulk অর্ডার, **নিজস্ব** সীমা।
   *
   *   কেন `order`-এর সীমা ব্যবহার করা যায় না: সেটি একজন মানুষের
   *   ব্রাউজারের জন্য (৫ মিনিটে ২০)। একটি রিসেলার-স্ক্রিপ্ট দিনে
   *   হাজার অর্ডার পাঠাতে পারে — সেটিই তো ফিচারটির উদ্দেশ্য। তাই
   *   আলাদা, উদারতর সীমা, কিন্তু সীমাহীন নয়।
   *
   *   প্রতি **কী** ৬০ সেকেন্ডে ৩০টি অনুরোধ × সর্বোচ্চ ২০টি আইটেম
   *   = মিনিটে ৬০০ অর্ডার। একটি বাগে-পড়া ক্লায়েন্ট-লুপ যেন পুরো
   *   ডাটাবেস (ও ওয়ালেট) নিয়ে দৌড়াতে না পারে।
   */
  resellerBulk: { limit: 30, window: 60 },
  /**
   * ★ ব্যর্থ API-কী যাচাই, IP ভিত্তিক।
   *
   *   কী অনুমান করা কার্যত অসম্ভব (২৫৬ বিট), কিন্তু চেষ্টা করলে
   *   প্রতিটি চেষ্টায় একটি DB লুকআপ হতো — অর্থাৎ endpoint-টি
   *   একটি বিনামূল্যের কোয়েরি-অ্যামপ্লিফায়ার হয়ে যেত। তাই
   *   **ব্যর্থ** চেষ্টা গোনা হয়; সফল কল এই বাকেট ছোঁয়ও না।
   */
  resellerAuth: { limit: 20, window: 300 },
  /**
   * ★ Group I — পাবলিক সার্চ। উদার, কারণ টাইপ করার সময় নেভবার
   *   পরপর কয়েকটি কল পাঠায় (debounce থাকা সত্ত্বেও); কিন্তু
   *   সীমাহীন নয়, কারণ প্রতিটি কল একটি `contains` কোয়েরি — যা
   *   ইনডেক্স ব্যবহার করে না।
   */
  search: { limit: 60, window: 60 },
} as const;
