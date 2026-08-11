import bcrypt from 'bcryptjs';
import { randomInt } from 'node:crypto';
import { prisma } from '../prisma';
import { logger } from '../logger';
import type { OtpChannel, OtpPurpose } from '@prisma/client';

/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ Group I (৩) — এককালীন কোডের মূল যুক্তি (চ্যানেল-নিরপেক্ষ)
 *
 *   এই ফাইলটি **জানে না** কোড কীভাবে পৌঁছাবে। ইমেইল না SMS —
 *   সেটি `channels.ts` এর কাজ। এখানে কেবল: কোড বানানো, হ্যাশ করা,
 *   মেয়াদ, চেষ্টা-গণনা, এবং যাচাই।
 *
 *   ── নিরাপত্তার সিদ্ধান্তগুলো ও কারণ ──
 *
 *   ⚠️ কোড **হ্যাশ করে** রাখা হয় (bcrypt), প্লেইনটেক্সট নয়। ডাটাবেস
 *   ডাম্প ফাঁস হলে তা দিয়ে কারও রেজিস্ট্রেশন সম্পূর্ণ করা যাবে না।
 *   পাসওয়ার্ড ও TOTP secret এর ক্ষেত্রে এই কোডবেস যা করে, একই নীতি।
 *
 *   ⚠️ কোড তৈরিতে `randomInt` (crypto), `Math.random()` নয় —
 *   `Math.random()` অনুমানযোগ্য, আর এটি কার্যত একটি প্রমাণপত্র।
 *
 *   ⚠️ নতুন কোড চাইলে আগের অব্যবহৃত কোডগুলো **বাতিল** হয়ে যায়।
 *   নাহলে একসাথে অনেকগুলো বৈধ কোড ভাসত ও brute-force সহজ হতো।
 *
 *   ⚠️ চেষ্টা-গণনা ডাটাবেসে, গন্তব্যের সাথে বাঁধা। IP rate-limit
 *   আছে, কিন্তু আক্রমণকারী IP বদলাতে পারে — এটি বদলাতে পারে না।
 *
 *   ⚠️ যাচাই ও ব্যবহার **এক ট্রানজেকশনে** (দেখুন `consumeOtp`)।
 *   আলাদা করলে "যাচাই হয়েছে কিন্তু অ্যাকাউন্ট তৈরি হয়নি" নামে একটি
 *   অবস্থা তৈরি হতো, আর সেই ফাঁকে একই কোড দুবার ব্যবহার করা যেত।
 * ═══════════════════════════════════════════════════════════
 */

/** ★ ৬ অঙ্ক — মুখে বলা/টাইপ করা যায়, আবার ১০ লাখ সম্ভাবনা */
export const OTP_LENGTH = 6;
/** ★ ১০ মিনিট — ইমেইল আসতে দেরি হলেও যথেষ্ট, আবার চুরি হলে অল্প সময় */
export const OTP_TTL_MINUTES = 10;
/** ★ ৫ বার ভুল হলে কোডটি মৃত — নতুন কোড চাইতে হবে */
export const OTP_MAX_ATTEMPTS = 5;

/** ★ bcrypt cost — পাসওয়ার্ডের (১২) চেয়ে কম, কারণ কোডের আয়ু ১০ মিনিট
 *   ও চেষ্টা ৫টিতে সীমিত; ১২ দিলে প্রতিটি যাচাইয়ে অকারণ ~২৫০ms যেত। */
const OTP_BCRYPT_COST = 8;

export type OtpIssue = {
  /** ★ প্লেইনটেক্সট কোড — **কেবল** চ্যানেলে পাঠানোর জন্য, কোথাও রাখা নয় */
  code: string;
  expiresAt: Date;
};

/** ★ ৬ অঙ্কের কোড। শুরুতে শূন্য থাকতে পারে — তাই স্ট্রিং, সংখ্যা নয়। */
function generateCode(): string {
  let s = '';
  for (let i = 0; i < OTP_LENGTH; i++) s += String(randomInt(0, 10));
  return s;
}

/**
 * ★ নতুন কোড তৈরি ও সংরক্ষণ। আগের অব্যবহৃত কোড বাতিল হয়।
 *
 *   ⚠️ ফেরত দেওয়া প্লেইনটেক্সট কোডটি কলার **কেবল** চ্যানেলে পাঠাবে।
 *   লগে, উত্তরে বা অন্য কোথাও যেন কখনো না যায়।
 */
export async function issueOtp(opts: {
  channel: OtpChannel;
  purpose: OtpPurpose;
  destination: string;
  ip?: string | null;
}): Promise<OtpIssue> {
  const code = generateCode();
  const codeHash = await bcrypt.hash(code, OTP_BCRYPT_COST);
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60_000);

  await prisma.$transaction(async (tx) => {
    // ★ আগের অব্যবহৃত কোডগুলো এখনই মৃত — একসাথে একটিই বৈধ কোড
    await tx.otp.updateMany({
      where: { destination: opts.destination, purpose: opts.purpose, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    await tx.otp.create({
      data: {
        channel: opts.channel,
        purpose: opts.purpose,
        destination: opts.destination,
        codeHash,
        expiresAt,
        ip: opts.ip ?? null,
      },
    });
  });

  return { code, expiresAt };
}

export type OtpCheck =
  | { ok: true }
  | { ok: false; reason: 'NO_CODE' | 'EXPIRED' | 'TOO_MANY' | 'WRONG' };

/** ★ ব্যবহারকারীকে দেখানোর বার্তা — কারণ-ভেদে, কিন্তু কখনো এমন কিছু
 *   নয় যা কোড অনুমানে সাহায্য করে। */
export function otpMessage(reason: Exclude<OtpCheck, { ok: true }>['reason']): string {
  switch (reason) {
    case 'NO_CODE':
      return 'কোনো কোড পাঠানো হয়নি — আগে কোড চান।';
    case 'EXPIRED':
      return 'কোডের মেয়াদ শেষ। নতুন কোড চান।';
    case 'TOO_MANY':
      return 'অনেকবার ভুল হয়েছে। নতুন কোড চান।';
    case 'WRONG':
      return 'কোডটি মিলছে না।';
  }
}

/**
 * ★★★ কোড যাচাই **ও** ব্যবহার — একই ট্রানজেকশনে, কলারের কাজসহ।
 *
 *   ⚠️ কলারের কাজটি (`run`) একই ট্রানজেকশনের ভেতরে চলে। রেজিস্ট্রেশনে
 *   সেটি ইউজার তৈরি। ফলে হয় **দুটোই** ঘটে, নয় **কিছুই** না —
 *   "কোড খরচ হয়ে গেছে কিন্তু অ্যাকাউন্ট হয়নি" বলে কিছু থাকে না।
 *
 *   ⚠️ `FOR UPDATE` দিয়ে সারিটি লক করা হয় পড়ার **আগে**। নাহলে দুটি
 *   সমান্তরাল অনুরোধ একই কোড পড়ে দুটোই সফল হতে পারত (CLAUDE.md
 *   §2.1(৩) এর একই যুক্তি — সিদ্ধান্তের ভিত্তি লক করা রো থেকে আসে)।
 */
export async function consumeOtp<T>(
  opts: { purpose: OtpPurpose; destination: string; code: string },
  run: (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => Promise<T>,
): Promise<{ ok: true; result: T } | Exclude<OtpCheck, { ok: true }>> {
  return prisma.$transaction(async (tx) => {
    // ★ সর্বশেষ অব্যবহৃত কোড, লক করা
    const rows = await tx.$queryRaw<
      { id: string; codeHash: string; attempts: number; expiresAt: Date }[]
    >`
      SELECT "id", "codeHash", "attempts", "expiresAt"
      FROM "Otp"
      WHERE "destination" = ${opts.destination}
        AND "purpose" = ${opts.purpose}::"OtpPurpose"
        AND "consumedAt" IS NULL
      ORDER BY "createdAt" DESC
      LIMIT 1
      FOR UPDATE
    `;

    const row = rows[0];
    if (!row) return { ok: false as const, reason: 'NO_CODE' as const };

    if (row.expiresAt.getTime() < Date.now()) {
      await tx.otp.update({ where: { id: row.id }, data: { consumedAt: new Date() } });
      return { ok: false as const, reason: 'EXPIRED' as const };
    }

    if (row.attempts >= OTP_MAX_ATTEMPTS) {
      await tx.otp.update({ where: { id: row.id }, data: { consumedAt: new Date() } });
      return { ok: false as const, reason: 'TOO_MANY' as const };
    }

    const match = await bcrypt.compare(opts.code, row.codeHash);
    if (!match) {
      // ★ ভুল চেষ্টা গোনা হয় — এটিই DB-স্তরের brute-force বাধা
      await tx.otp.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
      return { ok: false as const, reason: 'WRONG' as const };
    }

    // ★ সঠিক — এখনই খরচ করে ফেলি, তারপর কলারের কাজ (একই ট্রানজেকশন)
    await tx.otp.update({ where: { id: row.id }, data: { consumedAt: new Date() } });
    const result = await run(tx);
    return { ok: true as const, result };
  });
}

/**
 * ★ মেয়াদোত্তীর্ণ ও ব্যবহৃত সারি মুছে ফেলা — cron থেকে ডাকা হয়।
 *   টেবিলটি নাহলে অসীম বাড়ত (H5 এর `RateLimitBucket` এর মতোই)।
 */
export async function purgeExpiredOtps(olderThanHours = 24): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanHours * 3600_000);
  try {
    const r = await prisma.otp.deleteMany({
      where: { OR: [{ expiresAt: { lt: cutoff } }, { consumedAt: { lt: cutoff } }] },
    });
    return r.count;
  } catch (e) {
    logger.error('otp', 'purge failed', { err: e });
    return 0;
  }
}
