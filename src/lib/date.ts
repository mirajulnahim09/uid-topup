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

/* ═══════════════════════════════════════════════════════════
 * ★★★ দিনের সীমা — ঢাকার ক্যালেন্ডারে (চূড়ান্ত মাস্টার অডিট, ২০২৬-০৯-১৭)
 *
 *   ফরম্যাটিং ঠিক ছিল, কিন্তু **হিসাবের** দিন-সীমা ছিল সার্ভারের ঘড়িতে:
 *   `setHours(0,0,0,0)` Vercel-এ (UTC) মানে ঢাকার সকাল ৬টা, আর
 *   `new Date('2026-09-14')` যেকোনো সার্ভারে UTC-মধ্যরাত = ঢাকার সকাল ৬টা।
 *   মাপা (`scripts/verify/timezone-boundary.ts`): ঢাকা-দিনের অর্ডার-রিপোর্টে
 *   রাত ১২টা–সকাল ৬টার অর্ডার বাদ, UTC-সার্ভারে পরের দিনের প্রথম ৬ ঘণ্টা যুক্ত।
 *   ফলে "আজকের" পরিসংখ্যান, রিপোর্ট ও প্রত্যাহারের দৈনিক সীমা ভুল দিনে গুনত।
 *
 *   নিয়ম: দিন/তারিখ-সীমা লাগলে এখানকার ফাংশন — কখনো `setHours`/`setDate` নয়।
 * ═══════════════════════════════════════════════════════════ */

/** ঢাকা UTC+6, DST নেই — তাই স্থির অফসেট নিরাপদ */
const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * ঢাকার একটি ক্যালেন্ডার-দিনের শুরু (সেই মুহূর্তের আসল UTC instant)।
 * `addDays`: ০ = আজ, −৭ = সাত দিন আগের দিনের শুরু, ১ = আগামীকালের শুরু।
 */
export function dhakaDayStart(at: Date = new Date(), addDays = 0): Date {
  const local = new Date(at.getTime() + DHAKA_OFFSET_MS);
  const startLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + addDays);
  return new Date(startLocal - DHAKA_OFFSET_MS);
}

/** একটি মুহূর্তের ঢাকা-তারিখ 'YYYY-MM-DD' */
export function dhakaDayKey(at: Date): string {
  return new Date(at.getTime() + DHAKA_OFFSET_MS).toISOString().slice(0, 10);
}

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 'YYYY-MM-DD' (ঢাকার তারিখ) → সেই দিনের শুরু ও শেষ মিলিসেকেন্ড; অবৈধ হলে null */
export function dhakaDateBounds(ymd: string): { start: Date; end: Date } | null {
  const m = YMD.exec(ymd.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  const startLocal = Date.UTC(y, mo, d);
  const chk = new Date(startLocal);
  // ২০২৬-০২-৩১ এর মতো অস্তিত্বহীন দিন নয়
  if (chk.getUTCFullYear() !== y || chk.getUTCMonth() !== mo || chk.getUTCDate() !== d) return null;
  const start = new Date(startLocal - DHAKA_OFFSET_MS);
  return { start, end: new Date(start.getTime() + DAY_MS - 1) };
}

/**
 * ফিল্টারের "থেকে" — 'YYYY-MM-DD' হলে ঢাকার সেই দিনের শুরু; অঞ্চলসহ পূর্ণ
 * টাইমস্ট্যাম্প হলে হুবহু সেই মুহূর্ত; অবৈধ হলে null।
 */
export function dhakaRangeFrom(v: string): Date | null {
  const b = dhakaDateBounds(v);
  if (b) return b.start;
  return parseDhakaDateTime(v);
}

/** ফিল্টারের "পর্যন্ত" — 'YYYY-MM-DD' হলে ঢাকার সেই দিনের **শেষ**; নাহলে হুবহু মুহূর্ত */
export function dhakaRangeTo(v: string): Date | null {
  const b = dhakaDateBounds(v);
  if (b) return b.end;
  return parseDhakaDateTime(v);
}

/**
 * অ্যাডমিনের `datetime-local` মান ('2026-09-17T20:00', অঞ্চল ছাড়া) → ঢাকার সেই
 * ঘড়ি-সময়। অঞ্চলসহ ISO ('…Z' / '+06:00') হুবহু। অবৈধ হলে null।
 *   ⚠️ অঞ্চলহীন স্ট্রিং `new Date()` সার্ভারের সময় ধরে — Vercel-এ ৬ ঘণ্টা সরে যেত।
 */
export function parseDhakaDateTime(v: string): Date | null {
  const s = v.trim();
  const local = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?$/.exec(s);
  const d = local ? new Date(`${local[1]}T${local[2]}:${local[3]}:${local[4] ?? '00'}+06:00`) : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
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
