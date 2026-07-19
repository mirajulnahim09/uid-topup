import { randomBytes } from 'crypto';

/**
 * ═══════════════════════════════════════════════════════════
 * ★ লগইন ছাড়া অর্ডার ট্র্যাকিং — নিরাপদভাবে
 *
 *   প্রতিযোগী BD Game Ghor এ "Order Tracker" আছে যেখানে শুধু
 *   অর্ডার নাম্বার দিলেই অর্ডার দেখা যায়। অর্ডার নাম্বার ধারাবাহিক
 *   পূর্ণসংখ্যা — তাই ১, ২, ৩… চালিয়ে **যে কেউ অন্য গ্রাহকদের
 *   অর্ডার, Player UID ও প্যাকেজ দেখে ফেলতে পারে**
 *   (COMPETITOR_ANALYSIS.md §7 anti-pattern #১)।
 *
 *   ধারণাটি ভালো (গ্রাহক লগইন ছাড়াই অবস্থা দেখতে চায়),
 *   বাস্তবায়নটি নয়। তাই এখানে দুটি নিরাপদ পথ:
 *
 *     ১. গোপন টোকেন — অনুমানযোগ্য নয় (১৬ বাইট random)
 *     ২. অর্ডার নাম্বার **+** নিবন্ধিত ফোন/ইমেইল (দ্বিতীয় প্রমাণ)
 *
 *   ★ এবং যা দেখানো হয় তাও সীমিত — সম্পূর্ণ UID বা প্রেরকের
 *     নাম্বার কখনো অননুমোদিত কাউকে দেখানো হয় না।
 * ═══════════════════════════════════════════════════════════
 */

/** ★ অনুমান-অসম্ভব ট্র্যাকিং টোকেন (URL-নিরাপদ) */
export function generateTrackToken(): string {
  return randomBytes(16).toString('base64url'); // ১২৮ বিট
}

/**
 * ★ সংবেদনশীল তথ্য ঢেকে দেখানো।
 *   গ্রাহক নিজের UID চিনতে পারবে (শুরু ও শেষ দেখে), কিন্তু
 *   কেউ এটি টুকে নিয়ে অন্য কোথাও ব্যবহার করতে পারবে না।
 */
export function maskUid(uid: string): string {
  const s = uid.trim();
  if (s.length <= 4) return '•'.repeat(s.length);
  const head = s.slice(0, 3);
  const tail = s.slice(-2);
  return `${head}${'•'.repeat(Math.max(3, s.length - 5))}${tail}`;
}

/** ★ ফোন নাম্বার ঢেকে — মিল যাচাইয়ের জন্য যথেষ্ট, চুরির জন্য নয় */
export function maskPhone(phone: string): string {
  const s = phone.trim();
  if (s.length <= 5) return '•'.repeat(s.length);
  return `${s.slice(0, 3)}${'•'.repeat(s.length - 5)}${s.slice(-2)}`;
}

/**
 * ★ দ্বিতীয় প্রমাণ মেলানো — ফোন বা ইমেইল।
 *   ছোট-বড় হাতের অক্ষর ও স্পেস উপেক্ষা করে, যাতে সঠিক গ্রাহক
 *   অকারণে আটকে না যায়।
 */
export function contactMatches(
  input: string,
  user: { phone: string; email: string }
): boolean {
  const v = input.trim().toLowerCase();
  if (!v) return false;
  // ফোনে +88 উপসর্গ থাকতে পারে — শুধু সংখ্যা তুলনা করি
  const digits = v.replace(/\D/g, '');
  const userDigits = user.phone.replace(/\D/g, '');
  if (digits.length >= 10 && userDigits.endsWith(digits.slice(-11))) return true;
  return v === user.email.trim().toLowerCase();
}
