import { createHash, randomBytes } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { ApiError } from './guard';
import { logger } from './logger';

/**
 * ★★★ AUTH-01 — একজন ব্যবহারকারীর **সব সক্রিয়** API কী প্রত্যাহার।
 *
 *   ── কেন দরকার ──
 *   পাসওয়ার্ড রিসেট, "সব ডিভাইস থেকে সাইন-আউট" ও অ্যাডমিন-রিকভারি কেবল
 *   `sessionEpoch` বাড়াত; API কী সেশন-নিরপেক্ষ (`requireApiKey` epoch দেখে না),
 *   তাই বেহাত অ্যাকাউন্টের কী মালিকের রিসেটের **পরেও** তাঁর ওয়ালেট থেকে অর্ডার
 *   দিতে পারত। "অ্যাকাউন্ট সুরক্ষিত করলাম" মানে সব শংসাপত্র বাতিল।
 *
 *   ⚠️ কী **মোছা হয় না** — `revokedAt` বসে (অ্যাডমিনের প্রত্যাহারের মতোই),
 *   ইতিহাস অক্ষত। কলারের transaction-এ চলে, তাই epoch-বৃদ্ধি ও কী-প্রত্যাহার
 *   একসাথে হয় অথবা কোনোটিই নয়।
 *   @returns কতগুলো কী প্রত্যাহার হলো
 */
export async function revokeUserApiKeys(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<number> {
  const r = await tx.apiKey.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return r.count;
}

/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ রিসেলার API কী (Group F ৩)
 *
 *   রিসেলার নিজের সিস্টেম/বট থেকে অর্ডার পাঠান — সেখানে ব্রাউজার
 *   নেই, তাই NextAuth সেশন-কুকিও নেই। একটি দীর্ঘজীবী শংসাপত্র লাগে।
 *
 *   ── যা এখানে ইচ্ছাকৃতভাবে করা হয়েছে ──
 *
 *   ১. **কাঁচা কী কখনো সংরক্ষিত হয় না।** DB-তে কেবল SHA-256 হ্যাশ।
 *      ডাটাবেস ব্যাকআপ ফাঁস হলেও তা দিয়ে অর্ডার করা যাবে না।
 *
 *   ২. **হ্যাশই লুকআপ-কী** (ইউনিক ইনডেক্স)। কী মেলানো তাই একটি
 *      ইনডেক্স-লুকআপ — সব সারি ঘুরে তুলনা নয়। এতে timing side
 *      channel-ও থাকে না, কারণ তুলনাটি ডাটাবেসের ইনডেক্সে হয়,
 *      গোপন মানের বাইট-বাই-বাইট তুলনায় নয়।
 *
 *   ৩. `revokedAt` — কী **মোছা হয় না**, প্রত্যাহার করা হয়। "কোন কী
 *      কবে সক্রিয় ছিল" প্রশ্নের উত্তর পরে দরকার হবেই (একটি অর্ডার
 *      নিয়ে বিতর্ক হলে সবার আগে ওটাই জিজ্ঞেস করতে হয়)।
 *
 *   ⚠️ **কী শুধু RESELLER স্তরের ব্যবহারকারীর জন্য কাজ করে।** স্তর
 *   ফিরিয়ে NORMAL করলেই কী তাৎক্ষণিকভাবে অকেজো — আলাদা করে প্রতিটি
 *   কী প্রত্যাহার করতে হয় না। একটি ভুলে যাওয়া কী যেন নীরবে সক্রিয়
 *   না থাকে।
 * ═══════════════════════════════════════════════════════════
 */

/** ★ চেনার মতো উপসর্গ — লগে বা কোডে দেখা গেলেই বোঝা যায় এটি কী */
const KEY_PREFIX = 'uidk_';

/** ★ অ্যাডমিন UI-তে দেখানো অংশ (উপসর্গ + ৬ অক্ষর) — গোপন নয় */
const VISIBLE_PREFIX_LEN = KEY_PREFIX.length + 6;

/**
 * ★ একই কী বারবার ব্যবহৃত হলে প্রতি কলে `lastUsedAt` লেখা মানে
 *   প্রতি অনুরোধে একটি বাড়তি UPDATE। রিসেলার মিনিটে বহুবার ডাকেন,
 *   আর Neon-এ সংযোগ সীমিত (H4)। "শেষ কবে ব্যবহার হয়েছে" প্রশ্নের
 *   উত্তরে এক মিনিটের নির্ভুলতাই যথেষ্ট।
 */
const LAST_USED_THROTTLE_MS = 60_000;

export type ApiKeyActor = {
  keyId: string;
  keyLabel: string;
  user: {
    id: string;
    name: string;
    email: string;
    tier: 'NORMAL' | 'RESELLER';
  };
};

/** ★ কাঁচা কী → hex হ্যাশ। তৈরি ও যাচাই — দুই পথেই একটিই ফাংশন। */
export function hashApiKey(plain: string): string {
  return createHash('sha256').update(plain.trim(), 'utf8').digest('hex');
}

/**
 * ★ নতুন কী তৈরি।
 *   ৩২ বাইট (২৫৬ বিট) ক্রিপ্টো-random — অনুমান করা অসম্ভব।
 *   কাঁচা মানটি **কেবল এখানেই** থাকে; কলার সেটি একবার দেখিয়ে ভুলে যায়।
 */
export function generateApiKey(): { plain: string; hash: string; prefix: string } {
  const plain = KEY_PREFIX + randomBytes(32).toString('base64url');
  return {
    plain,
    hash: hashApiKey(plain),
    prefix: plain.slice(0, VISIBLE_PREFIX_LEN),
  };
}

/** ★ হেডার থেকে কাঁচা কী — `Authorization: Bearer …` বা `X-API-Key` */
export function readApiKey(req: Request): string {
  const auth = req.headers.get('authorization') || '';
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return (req.headers.get('x-api-key') || '').trim();
}

/**
 * ★★★ API কী যাচাই — না মিললে throw।
 *
 *   ⚠️ ৪০১-এর বার্তা সব ক্ষেত্রেই এক: কী নেই, কী ভুল, কী প্রত্যাহৃত —
 *   কোনোটিই আলাদা করে বলা হয় না। "এই কী ছিল কিন্তু প্রত্যাহার করা
 *   হয়েছে" বলা মানে আক্রমণকারীকে জানিয়ে দেওয়া যে সে একটি বৈধ কী
 *   পেয়েছে, শুধু দেরি করে ফেলেছে।
 *
 *   ব্যান ও স্তর আলাদা বার্তা পায়, কারণ সেখানে কীটি বৈধ — মালিকই
 *   সেটি ব্যবহার করছেন এবং তাঁর জানা দরকার কেন কাজ করছে না।
 */
export async function requireApiKey(req: Request): Promise<ApiKeyActor> {
  const plain = readApiKey(req);
  if (!plain || !plain.startsWith(KEY_PREFIX)) {
    throw new ApiError('API কী দিন (Authorization: Bearer …)', 401);
  }

  const record = await prisma.apiKey.findUnique({
    where: { hash: hashApiKey(plain) },
    select: {
      id: true, label: true, revokedAt: true, lastUsedAt: true,
      user: {
        select: { id: true, name: true, email: true, tier: true, isBanned: true },
      },
    },
  });

  if (!record || record.revokedAt) {
    throw new ApiError('API কী সঠিক নয়', 401);
  }

  if (record.user.isBanned) {
    throw new ApiError('আপনার অ্যাকাউন্ট বন্ধ করা হয়েছে', 403);
  }

  // ★ স্তরই আসল অনুমতি — কী থাকলেই রিসেলার নন।
  if (record.user.tier !== 'RESELLER') {
    throw new ApiError('এই অ্যাকাউন্টে রিসেলার অ্যাক্সেস নেই', 403);
  }

  // ★ থ্রটলড, fire-and-forget — এটি কেবল তথ্য, অনুমতির অংশ নয়,
  //   তাই ব্যর্থ হলে অনুরোধ আটকানোর কোনো কারণ নেই।
  const last = record.lastUsedAt?.getTime() ?? 0;
  if (Date.now() - last > LAST_USED_THROTTLE_MS) {
    prisma.apiKey
      .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
      .catch((e) => logger.warn('apiKey', 'lastUsedAt update failed', { err: e }));
  }

  return {
    keyId: record.id,
    keyLabel: record.label,
    user: {
      id: record.user.id,
      name: record.user.name,
      email: record.user.email,
      tier: record.user.tier,
    },
  };
}
