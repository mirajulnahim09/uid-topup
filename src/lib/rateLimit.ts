/**
 * In-memory rate limiter.
 * ⚠️ Serverless এ প্রতিটা instance এর আলাদা memory — perfect নয়,
 *    কিন্তু casual brute-force ও spam আটকাবে।
 *    বড় ট্রাফিক হলে Upstash Redis এ সরান।
 */
type Bucket = { count: number; resetAt: number };
const store = new Map<string, Bucket>();

let lastSweep = Date.now();
function sweep() {
  const now = Date.now();
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [k, v] of Array.from(store.entries())) {
    if (v.resetAt < now) store.delete(k);
  }
}

export type RateLimitResult = { ok: boolean; remaining: number; retryAfter: number };

export function rateLimit(key: string, limit: number, windowSec: number): RateLimitResult {
  sweep();
  const now = Date.now();
  const b = store.get(key);

  if (!b || b.resetAt < now) {
    store.set(key, { count: 1, resetAt: now + windowSec * 1000 });
    return { ok: true, remaining: limit - 1, retryAfter: 0 };
  }

  if (b.count >= limit) {
    return { ok: false, remaining: 0, retryAfter: Math.ceil((b.resetAt - now) / 1000) };
  }

  b.count++;
  return { ok: true, remaining: limit - b.count, retryAfter: 0 };
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
