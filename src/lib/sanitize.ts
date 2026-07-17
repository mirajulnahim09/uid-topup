/**
 * ═══════════════════════════════════════════════════════════
 * XSS প্রতিরোধ — Defense in depth
 *
 * React by default সব escape করে, আর কোথাও dangerouslySetInnerHTML নেই।
 * তবুও অ্যাডমিন/ইউজারের দেওয়া টেক্সট DB তে ঢোকার আগে পরিষ্কার করা হয় —
 * কারণ ডেটা অন্য জায়গায় (ইমেইল, JSON API, ভবিষ্যতের কোড) যেতে পারে।
 * ═══════════════════════════════════════════════════════════
 */

// HTML স্পেশাল ক্যারেক্টার — এগুলোই XSS এর হাতিয়ার
const DANGEROUS_CHARS = /[<>"'`]/g;

// অনিরাপদ URL স্কিম (whitespace/tab/newline দিয়ে বাইপাস চেষ্টাও ধরে)
const BAD_PROTO = /^[\s\x00-\x20]*(?:j[\s\x00-\x20]*a[\s\x00-\x20]*v[\s\x00-\x20]*a[\s\x00-\x20]*s[\s\x00-\x20]*c[\s\x00-\x20]*r[\s\x00-\x20]*i[\s\x00-\x20]*p[\s\x00-\x20]*t|d[\s\x00-\x20]*a[\s\x00-\x20]*t[\s\x00-\x20]*a|v[\s\x00-\x20]*b[\s\x00-\x20]*s[\s\x00-\x20]*c[\s\x00-\x20]*r[\s\x00-\x20]*i[\s\x00-\x20]*p[\s\x00-\x20]*t|f[\s\x00-\x20]*i[\s\x00-\x20]*l[\s\x00-\x20]*e|b[\s\x00-\x20]*l[\s\x00-\x20]*o[\s\x00-\x20]*b)[\s\x00-\x20]*:/i;

// কন্ট্রোল ক্যারেক্টার (null byte, ইত্যাদি) — লগ ইনজেকশন / বাইপাসে ব্যবহৃত
const CONTROL = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

/**
 * ★ HTML ট্যাগ নয় — সব বিপজ্জনক ক্যারেক্টার মুছে দেয়।
 *
 *   পুরনো পদ্ধতি (<[^>]*> রিজেক্স) দুর্বল ছিল:
 *     '"><script>alert(1)</script>'  →  '">alert(1)'   ← > থেকে গেল!
 *
 *   এখন < > " ' ` সব মুছে যায় — কিছুই থাকে না।
 */
export function stripTags(s: string): string {
  return String(s)
    .replace(CONTROL, '')          // কন্ট্রোল ক্যারেক্টার
    .replace(DANGEROUS_CHARS, '')  // < > " ' `
    .trim();
}

/** টেক্সট পরিষ্কার + দৈর্ঘ্য সীমা */
export function cleanText(s: string, maxLen = 500): string {
  return stripTags(String(s ?? '')).slice(0, maxLen);
}

/**
 * ★ URL যাচাই — javascript:, data:, vbscript:, file:, blob: সব আটকায়।
 *   whitespace/tab দিয়ে বাইপাস চেষ্টাও ধরে (java\tscript: → আটকাবে)।
 *   অনিরাপদ হলে null ফেরত দেয়।
 */
export function safeUrl(s: string): string | null {
  const raw = String(s ?? '');

  // কন্ট্রোল ক্যারেক্টার সরিয়ে দেখি
  const v = raw.replace(CONTROL, '').trim();
  if (!v) return null;

  // ★ স্কিম চেক — বাইপাস-প্রতিরোধী
  if (BAD_PROTO.test(v)) return null;

  // relative path — শুধু / দিয়ে শুরু, // (protocol-relative) নয়
  if (v.startsWith('/')) {
    if (v.startsWith('//')) return null; // //evil.com → বাইরের সাইট!
    // path এ কোনো HTML ক্যারেক্টার থাকবে না
    if (/[<>"'`\s]/.test(v)) return null;
    return v;
  }

  try {
    const u = new URL(v);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * ★ ইউজারের নাম / লেবেল — অক্ষর, সংখ্যা, বাংলা, স্পেস, সাধারণ বিরামচিহ্ন।
 *   অন্য সব বাদ।
 */
export function cleanName(s: string, maxLen = 80): string {
  return String(s ?? '')
    .replace(CONTROL, '')
    .replace(/[^\p{L}\p{N}\s.,\-_()[\]।]/gu, '') // অক্ষর, সংখ্যা, নিরাপদ চিহ্ন
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

/** ★ TrxID / রেফারেল কোডের মতো — শুধু অক্ষর ও সংখ্যা */
export function cleanCode(s: string, maxLen = 30): string {
  return String(s ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, maxLen);
}
