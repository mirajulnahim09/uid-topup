import { createHash, timingSafeEqual } from 'node:crypto';
import { ApiError } from './guard';
import { logger } from './logger';

/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ Cron endpoint অথেন্টিকেশন (C2)
 *
 *   তিনটি শিডিউলড জব বাইরে থেকে (GitHub Actions) ডাকা হয়।
 *   একটি অরক্ষিত জব-endpoint যে কাউকে বারবার ব্রডকাস্ট পাঠানোর বা
 *   ডাটাবেসে লেখার সুযোগ দিত — তাই প্রতিটি কলে
 *   `Authorization: Bearer <CRON_SECRET>` লাগে।
 *
 *   ── কেন constant-time ──
 *   `a === b` স্ট্রিং তুলনা প্রথম অমিল অক্ষরেই থেমে যায়। বহুবার ডেকে
 *   সেই সময়ের পার্থক্য মেপে আক্রমণকারী সিক্রেটটি অক্ষরে-অক্ষরে বের
 *   করে ফেলতে পারে। `timingSafeEqual` সবসময় পুরোটা মেলায়।
 *
 *   ── কেন আগে sha256 ──
 *   `timingSafeEqual` দুটি সমান-দৈর্ঘ্যের বাফার চায়, নাহলে throw করে।
 *   কাঁচা মান সরাসরি দিলে **দৈর্ঘ্যই** একটি oracle হয়ে যেত (ভুল
 *   দৈর্ঘ্য = সাথে সাথে throw, সঠিক দৈর্ঘ্য = তুলনা চলে)। দুই পাশকে
 *   sha256 করলে সবসময় ৩২ বাইট — দৈর্ঘ্য আর কিছু ফাঁস করে না।
 *
 *   ── fail-closed ──
 *   `CRON_SECRET` সেট না থাকলে **সব** cron কল প্রত্যাখ্যাত। একটি
 *   অনুপস্থিত env যেন নীরবে endpoint-গুলো খুলে না দেয়।
 * ═══════════════════════════════════════════════════════════
 */

const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest();

/** হেডার থেকে Bearer টোকেন — না থাকলে খালি স্ট্রিং */
function bearerOf(req: Request): string {
  const auth = req.headers.get('authorization') || '';
  return auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
}

/**
 * ★ সিক্রেট মেলে কিনা — boolean। throw করে না।
 *   (পুরনো `/api/admin/telegram/scheduler/tick` এটি ব্যবহার করে,
 *   কারণ সেখানে অ্যাডমিন-সেশন fallback-ও আছে।)
 */
export function verifyCronSecret(req: Request): boolean {
  const secret = (process.env.CRON_SECRET || '').trim();
  if (!secret) return false;
  const token = bearerOf(req);
  if (!token) return false;
  return timingSafeEqual(sha(token), sha(secret));
}

/**
 * ★ cron-only endpoint-এর গার্ড — না মিললে 401 ছুঁড়ে দেয়।
 *
 *   @param job লগে দেখার জন্য জবের নাম
 */
export function assertCronAuth(req: Request, job: string): void {
  if (verifyCronSecret(req)) return;

  const secretMissing = !(process.env.CRON_SECRET || '').trim();
  logger.warn('cron', 'unauthorized cron call', {
    job,
    reason: secretMissing ? 'CRON_SECRET সেট নেই' : 'টোকেন মেলেনি',
  });

  // ⚠️ বার্তায় কারণ আলাদা করা হয় না — বাইরের কেউ যেন বুঝতে না পারে
  //    সিক্রেট অনুপস্থিত না ভুল।
  throw new ApiError('অনুমতি নেই', 401);
}
