import { createHmac, timingSafeEqual } from 'crypto';

/**
 * ═══════════════════════════════════════════════════════════
 * ★ Webhook signature যাচাই — সাধারণ, নিরাপদ helper (Phase 4)
 *
 *   বেশিরভাগ গেটওয়ে (Stripe, SSLCommerz, Razorpay) HMAC দিয়ে webhook
 *   sign করে — raw body + secret দিয়ে একটি hash, header-এ পাঠানো।
 *   প্রতিটি provider-এর parseWebhook() এই helper দিয়ে যাচাই করবে,
 *   যাতে signature-যাচাই কোড বারবার (ভুলভাবে) লেখা না হয়।
 *
 *   ⚠️ timing-safe তুলনা — নাহলে byte-by-byte সময় মেপে signature
 *      অনুমান করা সম্ভব হতো।
 *   ⚠️ raw body **অপরিবর্তিত** হতে হবে (JSON.parse করে আবার stringify
 *      করলে signature ভাঙবে) — তাই receiver req.text() ব্যবহার করে।
 * ═══════════════════════════════════════════════════════════
 */

/** HMAC hex signature হিসাব করে */
export function computeHmac(
  rawBody: string,
  secret: string,
  algo: 'sha256' | 'sha512' = 'sha256'
): string {
  return createHmac(algo, secret).update(rawBody, 'utf8').digest('hex');
}

/**
 * ★ প্রাপ্ত signature বৈধ কিনা (timing-safe)।
 *   দৈর্ঘ্য না মিললে সাথে সাথে false — timingSafeEqual সমান দৈর্ঘ্য চায়।
 */
export function verifyHmacSignature(
  rawBody: string,
  receivedSignature: string,
  secret: string,
  algo: 'sha256' | 'sha512' = 'sha256'
): boolean {
  if (!receivedSignature || !secret) return false;
  const expected = computeHmac(rawBody, secret, algo);

  // অনেক গেটওয়ে "sha256=..." প্রিফিক্স দেয় — খুলে নিই
  const clean = receivedSignature.includes('=')
    ? receivedSignature.split('=').pop()!.trim()
    : receivedSignature.trim();

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(clean, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
