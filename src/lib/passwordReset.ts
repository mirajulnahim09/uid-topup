import crypto from 'crypto';
import { prisma } from './prisma';

/**
 * ═══════════════════════════════════════════════════════════════
 * ★ পাসওয়ার্ড রিসেট টোকেন — কোনো নতুন DB টেবিল ছাড়াই।
 *
 *   টোকেন = base64url(payload) + "." + signature
 *   payload   = { uid, exp }               (কার জন্য, কখন শেষ)
 *   signature = HMAC-SHA256(payload, key)
 *   key       = NEXTAUTH_SECRET + বর্তমান পাসওয়ার্ড হ্যাশের শেষ ১২ অক্ষর
 *
 *   ➜ ফলাফল: পাসওয়ার্ড একবার বদলালেই হ্যাশ বদলে যায়, তাই পুরনো
 *     লিংক স্বয়ংক্রিয়ভাবে অকেজো হয়ে যায় (single-use, replay নয়)।
 *   ➜ ৩০ মিনিট পর টোকেন এমনিতেই expire।
 * ═══════════════════════════════════════════════════════════════
 */

export const RESET_TTL_MINUTES = 30;
const TTL_MS = RESET_TTL_MINUTES * 60 * 1000; // ৩০ মিনিট

/**
 * ★ টোকেন কোন পথে তৈরি — কেবল অডিট-লগের জন্য (অনুমতিতে কোনো পার্থক্য নেই)।
 *   `admin` = অ্যাডমিনের জরুরি রিকভারি-লিংক (`/api/admin/user/recovery`)।
 */
export type ResetSource = 'email' | 'admin';

function secret(): string {
  const s = process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error('NEXTAUTH_SECRET সেট করা নেই');
  return s;
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64url');
}

function sign(payloadB64: string, pwHash: string): string {
  // ★ পাসওয়ার্ড হ্যাশ key এর অংশ — পাসওয়ার্ড বদলালে টোকেন বাতিল
  const key = secret() + pwHash.slice(-12);
  return crypto.createHmac('sha256', key).update(payloadB64).digest('base64url');
}

/** ★ রিসেট টোকেন তৈরি — শুধু userId ও বর্তমান হ্যাশ লাগে */
export function makeResetToken(userId: string, pwHash: string, source: ResetSource = 'email'): string {
  // ★ `n` — ক্রিপ্টোগ্রাফিক র‍্যান্ডম nonce। স্বাক্ষর আগেই অনুমান-অযোগ্য ছিল,
  //   কিন্তু একই মিলিসেকেন্ডে একই ইউজারের দুটি টোকেন হুবহু এক হতো; এখন
  //   প্রতিটি টোকেন অনন্য (চূড়ান্ত অডিট — জরুরি রিকভারির শর্ত)।
  const payload = { uid: userId, exp: Date.now() + TTL_MS, n: crypto.randomBytes(16).toString('base64url'), src: source };
  const payloadB64 = b64url(JSON.stringify(payload));
  const sig = sign(payloadB64, pwHash);
  return `${payloadB64}.${sig}`;
}

/**
 * ★ টোকেন যাচাই — বৈধ হলে userId ফেরত, নাহলে null।
 *   DB থেকে বর্তমান হ্যাশ এনে signature মেলানো হয় (timing-safe)।
 */
export async function verifyResetToken(token: string): Promise<string | null> {
  try {
    if (!token || typeof token !== 'string' || !token.includes('.')) return null;

    const [payloadB64, sig] = token.split('.');
    if (!payloadB64 || !sig) return null;

    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as {
      uid?: string;
      exp?: number;
    };
    if (!payload.uid || !payload.exp) return null;

    // ★ মেয়াদ শেষ?
    if (Date.now() > payload.exp) return null;

    // ★ বর্তমান পাসওয়ার্ড হ্যাশ এনে signature মেলাই
    const user = await prisma.user.findUnique({
      where: { id: payload.uid },
      select: { id: true, password: true, isBanned: true },
    });
    if (!user || user.isBanned) return null;

    const expected = sign(payloadB64, user.password);

    // ★ timing-safe তুলনা
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return null;
    if (!crypto.timingSafeEqual(a, b)) return null;

    return user.id;
  } catch {
    return null;
  }
}

/**
 * ★ টোকেনের উৎস — **কেবল `verifyResetToken` সফল হওয়ার পরে** ডাকতে হবে
 *   (এখানে স্বাক্ষর যাচাই হয় না)। অনুমতির সিদ্ধান্তে ব্যবহার নিষিদ্ধ;
 *   শুধু অডিট-লগে "কোন পথে রিসেট হলো" লেখার জন্য।
 */
export function resetTokenSource(token: string): ResetSource {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8')) as { src?: string };
    return payload.src === 'admin' ? 'admin' : 'email';
  } catch {
    return 'email';
  }
}
