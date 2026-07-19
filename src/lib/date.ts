/**
 * ═══════════════════════════════════════════════════════════
 * ★ তারিখ/সময় ফরম্যাটিং — সবসময় বাংলাদেশ সময়ে (Asia/Dhaka)
 *
 *   কেন timeZone স্পষ্ট করে দেওয়া জরুরি:
 *   আগে কোনো timeZone দেওয়া ছিল না, তাই তারিখ দেখাত
 *   **সার্ভারের** লোকাল সময়ে। লোকাল মেশিনে (ঢাকা) ঠিক দেখালেও
 *   Vercel এ সার্ভার UTC — অর্থাৎ প্রতিটি ডিপোজিট/অর্ডার/লগের
 *   সময় ৬ ঘন্টা ভুল দেখাত।
 *
 *   টাকার বিরোধ মেটানোর সময় এই টাইমস্ট্যাম্পই প্রমাণ — তাই
 *   এটি ভুল হওয়া গুরুতর। (AUDIT_REPORT.md M4)
 *
 *   নিয়ম: নতুন কোথাও `toLocaleString` সরাসরি ব্যবহার করবেন না,
 *   এখানকার হেল্পারগুলো ব্যবহার করুন।
 * ═══════════════════════════════════════════════════════════
 */

/** বাংলাদেশ সময় অঞ্চল — UTC+6, কোনো DST নেই */
export const APP_TIME_ZONE = 'Asia/Dhaka';

function toDate(d: Date | string): Date {
  return typeof d === 'string' ? new Date(d) : d;
}

/** পূর্ণ তারিখ ও সময় — যেমন: 18 Jul 2026, 11:12 pm */
export function fmtDate(d: Date | string): string {
  return toDate(d).toLocaleString('en-GB', {
    timeZone: APP_TIME_ZONE,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

/** শুধু তারিখ — যেমন: 18 Jul 2026 */
export function fmtDay(d: Date | string): string {
  return toDate(d).toLocaleDateString('en-GB', {
    timeZone: APP_TIME_ZONE,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/** সংক্ষিপ্ত তারিখ+সময় — তালিকা/নোটিফিকেশনের জন্য (যেমন: 18 Jul, 11:12 pm) */
export function fmtShort(d: Date | string): string {
  return toDate(d).toLocaleString('en-GB', {
    timeZone: APP_TIME_ZONE,
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}
