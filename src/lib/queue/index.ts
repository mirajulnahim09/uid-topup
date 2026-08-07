import { logger } from '../logger';

/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ Queue-Ready Design (Phase 4 — ready, not yet built)
 *
 *   ── উদ্দেশ্য ──
 *   পেমেন্ট গেটওয়ে চালু হলে কিছু কাজ **async** করা দরকার হবে:
 *   webhook → deposit approve, fulfillment retry, refund reconcile।
 *   এই ফাইল সেই কাজের একটি সাধারণ চুক্তি (interface) দেয়, যাতে
 *   পরে একটি প্রকৃত queue (Vercel Queue / QStash / DB-poll) যোগ করা
 *   গেলে consumer কোড না বদলায় (Dependency Inversion)।
 *
 *   ── কেন এখন worker বানানো হয়নি (সৎ) ──
 *   এখনো কোনো লাইভ গেটওয়ে নেই, তাই async করার মতো কাজও নেই। এখনই
 *   একটি পূর্ণ background worker/poller বানানো = ব্যবহারহীন জটিলতা
 *   (roadmap-এর "no dummy implementation" নীতির বিরুদ্ধে)। তাই এখানে:
 *     ১. `JobHandler` চুক্তি — future consumer এই আকারে লেখা হবে
 *     ২. `runWithRetry` — exponential backoff সহ নিরাপদ execution,
 *        যা এখনই inline (সিঙ্ক্রোনাস) কাজেও ব্যবহারযোগ্য
 *   প্রকৃত queue backend যোগ করার সময় শুধু enqueue()/worker যুক্ত হবে;
 *   handler ও retry যুক্তি অপরিবর্তিত থাকবে।
 *
 *   ⚠️ money-safety: শুধু **idempotent** কাজই retry-safe। handler-কে
 *      অবশ্যই idempotency নিশ্চিত করতে হবে (যেমন webhook eventId marker),
 *      নাহলে retry = double-processing।
 * ═══════════════════════════════════════════════════════════
 */

/** একটি async কাজের সাধারণ আকার — future queue consumer এই চুক্তি মানবে */
export interface JobHandler<TPayload> {
  readonly name: string;
  /** কাজটি **idempotent** কিনা (retry-safe)। money-সংশ্লিষ্ট হলে অবশ্যই true হতে হবে। */
  readonly idempotent: boolean;
  handle(payload: TPayload): Promise<void>;
}

export type RetryOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
  /** কোন error-এ retry হবে (ডিফল্ট: সব)। money-কাজে সংকীর্ণ রাখুন। */
  retryable?: (err: unknown) => boolean;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * ★ নিরাপদ execution + exponential backoff retry।
 *   queue backend না থাকলেও inline ব্যবহারযোগ্য (যেমন webhook হ্যান্ডলিং)।
 *   কখনো throw করে না — শেষ চেষ্টাও ব্যর্থ হলে ফল `{ ok:false }`।
 */
export async function runWithRetry(
  fn: () => Promise<void>,
  opts: RetryOptions = {}
): Promise<{ ok: boolean; attempts: number; error?: unknown }> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const baseDelay = opts.baseDelayMs ?? 500;
  const retryable = opts.retryable ?? (() => true);

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await fn();
      return { ok: true, attempts: attempt };
    } catch (e) {
      lastErr = e;
      if (attempt === maxAttempts || !retryable(e)) break;
      await sleep(baseDelay * 2 ** (attempt - 1));
    }
  }
  logger.error('queue', 'job failed after retries', {
    attempts: maxAttempts, err: lastErr,
  });
  return { ok: false, attempts: maxAttempts, error: lastErr };
}
