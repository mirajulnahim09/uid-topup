/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ Group I (১) — পাবলিক সার্চের **ভাগ করা** অংশ
 *
 *   এই ফাইলটি সার্ভার ও ব্রাউজার **দুই দিকেই** যায় — `SearchBox`
 *   একটি ক্লায়েন্ট কম্পোনেন্ট, আর সে এখান থেকেই `SEARCH_MIN_LEN`
 *   ইত্যাদি নেয়।
 *
 *   ⛔ **এই ফাইলে কখনো `prisma`, `logger`, বা কোনো সার্ভার-মডিউল
 *      import করবেন না।** আসল কোয়েরিটি `src/lib/services/search.ts`
 *      এ থাকে, ঠিক এই কারণেই।
 *
 *   ⚠️ কেন এত জোর দিয়ে লেখা: প্রথমে সবকিছু এক ফাইলে ছিল, আর
 *   `SearchBox` সেখান থেকে ধ্রুবক নিত। ফলে **পুরো PrismaClient
 *   ব্রাউজার বান্ডলে ঢুকে যেত** — হোমপেজে (নেভবারে সার্চ আছে)
 *   `PrismaClient is unable to run in this browser environment`
 *   ও `.env` যাচাইয়ের ত্রুটি কনসোলে ছাপা হতো। `e2e-smoke` টেস্ট
 *   এটি ধরে ফেলে। একটি ধ্রুবক ভাগ করে নেওয়ার দাম ছিল গোটা
 *   ডাটাবেস ড্রাইভার — তাই ভাগটি এখন ফাইল-স্তরেই আলাদা।
 * ═══════════════════════════════════════════════════════════
 */

export type SearchHit = {
  productId: number;
  name: string;
  slug: string;
  image: string | null;
  categoryName: string;
  /** সক্রিয় ভ্যারিয়েন্টগুলোর সর্বনিম্ন দাম — `null` মানে কোনো দাম নেই */
  fromPrice: number | null;
  variantCount: number;
};

/** ছোট শব্দে ফলাফল অর্থহীন হয়ে যায় (এক অক্ষরে পুরো ক্যাটালগ) */
export const SEARCH_MIN_LEN = 2;
export const SEARCH_MAX_LEN = 60;
export const SEARCH_LIMIT = 20;

/** ★ প্রশ্নটি ব্যবহারযোগ্য কি না (যা ব্যবহারকারীকে দেখানো হবে) */
export function normalizeQuery(raw: string | null | undefined): string | null {
  const q = (raw ?? '').trim().replace(/\s+/g, ' ');
  if (q.length < SEARCH_MIN_LEN || q.length > SEARCH_MAX_LEN) return null;
  return q;
}

/**
 * ★★★ LIKE-ওয়াইল্ডকার্ড escape — **প্যারামিটারাইজেশন এটি করে না।**
 *
 *   ⚠️ প্রথমে ধরে নিয়েছিলাম দরকার নেই, কারণ Prisma প্যারামিটারাইজড
 *   কোয়েরি বানায়। কিন্তু টেস্ট চালিয়ে দেখা গেল ধারণাটি **ভুল**:
 *   প্যারামিটারাইজেশন SQL **ইনজেকশন** ঠেকায়, LIKE-এর ওয়াইল্ডকার্ড
 *   নয়। `contains: '%'` শেষমেশ `ILIKE '%' || '%' || '%'` হয়ে যায়,
 *   অর্থাৎ কেউ শুধু `%` লিখলেই পুরো ক্যাটালগ ফেরত আসত (সীমা পর্যন্ত),
 *   আর `_` যেকোনো এক অক্ষরের সাথে মিলত।
 *
 *   নিরাপত্তার বড় ছিদ্র নয় — ক্যাটালগ এমনিতেই পাবলিক — কিন্তু সার্চ
 *   তখন যা দেখায় তা ব্যবহারকারীর প্রশ্নের উত্তর নয়। Postgres-এ
 *   LIKE-এর ডিফল্ট escape অক্ষর `\`, তাই তিনটিকেই escape করা হয়।
 */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}
