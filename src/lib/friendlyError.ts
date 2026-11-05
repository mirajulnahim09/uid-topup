/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ ব্রাউজারের কারিগরি ত্রুটি-বার্তা → গ্রাহকের বোঝার মতো বাংলা
 *     (চূড়ান্ত মাস্টার অডিট, ২০২৬-০৯-১৭)
 *
 *   প্রায় সব ফর্ম `fetch → res.json() → throw new Error(d.error)` এবং
 *   `toast.error(e.message)` করে। সার্ভার উত্তর দিলে বার্তা বাংলাই থাকে;
 *   কিন্তু দুটি ক্ষেত্রে ব্রাউজার নিজের ইংরেজি বার্তা ছোড়ে, যা হুবহু
 *   গ্রাহকের সামনে যেত (Playwright-এ মাপা, `scripts/verify/resilience.ts`):
 *
 *     · নেট কেটে গেলে / উত্তর হারালে — "Failed to fetch" (Chrome),
 *       "NetworkError when attempting to fetch resource." (Firefox),
 *       "Load failed" (Safari)
 *     · গেটওয়ে HTML ফেরালে (Vercel টাইমআউট ৫০২/৫০৪) — `res.json()`:
 *       "Unexpected token '<', "<html>…" is not valid JSON"
 *
 *   বাংলাদেশের মোবাইল নেটে এটি নিয়মিত ঘটনা। বিভ্রান্ত গ্রাহক পাতা রিলোড
 *   করে আবার অর্ডার দিলে নতুন clientRef-এ **দ্বিতীয় অর্ডার** হয় — অথচ
 *   একই পাতায় আবার চাপলে একই clientRef যায় এবং সার্ভার আগের ফলই ফেরত
 *   দেয় (মাপা)। তাই বার্তা "একই পাতায় আবার চেষ্টা করুন" বলে।
 *
 *   সার্ভারের নিজের (বাংলা) বার্তা কখনো বদলায় না — কেবল জানা কারিগরি ছাঁচ।
 * ═══════════════════════════════════════════════════════════
 */

const NETWORK = [
  /^Failed to fetch$/i,
  /NetworkError when attempting to fetch resource/i,
  /^Load failed$/i,
  /The network connection was lost/i,
  /The Internet connection appears to be offline/i,
  /A server with the specified hostname could not be found/i,
  /^network ?error$/i,
];

const BAD_RESPONSE = [
  /is not valid JSON/i,
  /^Unexpected token/i,
  /Unexpected end of JSON input/i,
  /^JSON\.parse:/i,
  /JSON Parse error/i,
  /The string did not match the expected pattern/i,
];

export const NETWORK_MSG =
  'ইন্টারনেট সংযোগে সমস্যা — সার্ভারে পৌঁছানো যায়নি বা উত্তর আসেনি। সংযোগ দেখে এই পাতাতেই আবার চেষ্টা করুন।';
export const SERVER_BUSY_MSG =
  'সার্ভার এই মুহূর্তে সাড়া দিচ্ছে না — একটু পরে এই পাতাতেই আবার চেষ্টা করুন।';

export function friendlyError(message: string): string {
  const m = (message || '').trim();
  if (NETWORK.some((re) => re.test(m))) return NETWORK_MSG;
  if (BAD_RESPONSE.some((re) => re.test(m))) return SERVER_BUSY_MSG;
  return message;
}
