/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ UPL-01 — **আমাদের নিজের** Vercel Blob স্টোরের হুবহু হোস্ট
 *
 *   ── কেন ──
 *   আগে সর্বত্র `*.public.blob.vercel-storage.com` (যেকোনো স্টোর) বিশ্বাস
 *   করা হতো। যে কেউ নিজের Blob স্টোর খুলতে পারে, তাই গ্রাহক নিজের স্টোরের
 *   ছবি ডিপোজিটের "স্ক্রিনশট" হিসেবে দিতে পারত — জমার পরে ছবিটি বদলানো যেত
 *   (জাল প্রমাণ), আর অ্যাডমিন কিউ খুললেই ছবিটি আক্রমণকারীর সার্ভার থেকে লোড
 *   হয়ে অ্যাডমিনের IP ও সময় জানিয়ে দিত। `/_next/image`-ও অন্যের ছবি প্রসেস করত।
 *
 *   ── হোস্ট কীভাবে জানা যায় (অনুমান নয়) ──
 *   `@vercel/blob` 2.6.1 নিজেই: `storeId = token.split("_")[3]`
 *   (`parseStoreIdFromReadWriteToken`) এবং URL = `https://${storeId}.public.
 *   blob.vercel-storage.com/…`। তাই `BLOB_READ_WRITE_TOKEN` থেকেই হুবহু হোস্ট।
 *   চাইলে `BLOB_PUBLIC_HOST` দিয়ে সরাসরি বসানো যায় (অগ্রাধিকার পায়)।
 *
 *   ⚠️ বিশুদ্ধ ফাংশন — Node API নেই, তাই edge middleware-এও চলে।
 *   ⚠️ `next.config.js` (CommonJS) এই একই নিয়ম আলাদা করে লেখে — বদলালে দুটোই।
 * ═══════════════════════════════════════════════════════════
 */
const SUFFIX = '.public.blob.vercel-storage.com';

/** @returns ছোট-হাতের হুবহু হোস্ট, অথবা `null` (Blob কনফিগার নেই/অবৈধ) */
export function ownBlobHost(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const explicit = (env.BLOB_PUBLIC_HOST || '').trim().toLowerCase();
  if (explicit) {
    return /^[a-z0-9]+\.public\.blob\.vercel-storage\.com$/.test(explicit) ? explicit : null;
  }
  const token = (env.BLOB_READ_WRITE_TOKEN || '').trim();
  const storeId = (token.split('_')[3] || '').toLowerCase();
  return /^[a-z0-9]+$/.test(storeId) ? `${storeId}${SUFFIX}` : null;
}
