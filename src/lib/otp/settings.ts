import { getSettings } from '../settings';

/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ Group I (৩) — OTP এর কনফিগ (Group E গেটওয়ে-প্যাটার্ন অনুসরণে)
 *
 *   সব মান `Setting` টেবিলে key/value — অর্থাৎ অ্যাডমিন প্যানেল থেকে
 *   বদলানো যায়, redeploy লাগে না।
 *
 *   ⚠️ ডিফল্টগুলো ইচ্ছাকৃতভাবে দুই রকম:
 *     · **রেজিস্ট্রেশনে ইমেইল OTP — ডিফল্টে চালু।** পণ্যটি এখনো
 *       চালু হয়নি, একটিও গ্রাহক নেই, তাই grandfathering-এর প্রশ্নই
 *       নেই — প্রতিটি অ্যাকাউন্ট প্রথম দিন থেকেই যাচাইকৃত। কোনো
 *       "পরে চালু করব" সুইচ রাখা মানে সেটি কখনোই চালু না হওয়া।
 *     · **বাকি সব enforcement — ডিফল্টে বন্ধ।** ডিপোজিট ও অর্ডারে
 *       বাধ্যতামূলক করা টাকার প্রবাহে সরাসরি আঘাত; আসল ট্রাফিকে
 *       জালিয়াতি কেমন দেখায় তা না জেনে সেটি করা অনুমান।
 *     · **SMS চ্যানেল — ডিফল্টে বন্ধ।** কোনো গেটওয়ে নেই।
 * ═══════════════════════════════════════════════════════════
 */

export const OTP_KEYS = {
  emailEnabled: 'otp_email_enabled',
  smsEnabled: 'otp_sms_enabled',
  /** email | sms | either | both */
  signupChannel: 'otp_signup_channel',
  requireAtSignup: 'otp_require_at_signup',
  requireAtDeposit: 'otp_require_at_deposit',
  requireAtOrder: 'otp_require_at_order',
  /** SMS গেটওয়ে — এনক্রিপ্টেড JSON (Group E এর `credentials` এর মতোই) */
  smsProvider: 'otp_sms_provider',
  smsCredentials: 'otp_sms_credentials',
} as const;

export type SignupChannel = 'email' | 'sms' | 'either' | 'both';

export type OtpConfig = {
  emailEnabled: boolean;
  smsEnabled: boolean;
  signupChannel: SignupChannel;
  requireAtSignup: boolean;
  requireAtDeposit: boolean;
  requireAtOrder: boolean;
  smsProvider: string;
};

/** ★ `'1'`/`'true'` → true; অনুপস্থিত হলে দেওয়া ডিফল্ট */
function flag(v: string | undefined, dflt: boolean): boolean {
  if (v === undefined || v === '') return dflt;
  return v === '1' || v.toLowerCase() === 'true';
}

export async function getOtpConfig(): Promise<OtpConfig> {
  const s = await getSettings();

  const raw = (s[OTP_KEYS.signupChannel] || 'email').toLowerCase();
  const signupChannel: SignupChannel =
    raw === 'sms' || raw === 'either' || raw === 'both' ? raw : 'email';

  return {
    // ★ ইমেইল ডিফল্টে চালু — Resend ইতিমধ্যেই কনফিগার করা
    emailEnabled: flag(s[OTP_KEYS.emailEnabled], true),
    // ★ SMS ডিফল্টে বন্ধ — গেটওয়ে নেই
    smsEnabled: flag(s[OTP_KEYS.smsEnabled], false),
    signupChannel,
    // ★★★ সাইনআপে বাধ্যতামূলক — প্রথম দিন থেকেই
    requireAtSignup: flag(s[OTP_KEYS.requireAtSignup], true),
    // ★ বাকিগুলো বন্ধ — মালিক আসল ট্রাফিক দেখে সিদ্ধান্ত নেবেন
    requireAtDeposit: flag(s[OTP_KEYS.requireAtDeposit], false),
    requireAtOrder: flag(s[OTP_KEYS.requireAtOrder], false),
    smsProvider: s[OTP_KEYS.smsProvider] || '',
  };
}
