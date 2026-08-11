import type { OtpChannel as OtpChannelEnum } from '@prisma/client';
import { emailOtpCode, isEmailConfigured } from '../email';
import { getSmsProvider } from '../sms';
import { getOtpConfig } from './settings';
import { OTP_TTL_MINUTES } from './core';

/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ Group I (৩) — কোড কীভাবে পৌঁছাবে
 *
 *   একটিই ইন্টারফেস, দুটি বাস্তবায়ন। `core.ts` কোড বানায় ও যাচাই
 *   করে; এই ফাইল কেবল পৌঁছে দেয়। নতুন মাধ্যম (WhatsApp, push)
 *   যোগ করা মানে এখানে একটি এন্ট্রি — বাকি কিছুই বদলায় না।
 *
 *   ⚠️⚠️ `deliver()` **সত্যি বলে**: পাঠানো না গেলে `ok:false` ফেরে।
 *   `src/lib/email.ts` এর সাধারণ `send()` ব্যর্থতা গিলে ফেলে (ঠিকই
 *   করে — একটি স্বাগত-ইমেইল ব্যর্থ হলে রেজিস্ট্রেশন ভাঙা উচিত নয়)।
 *   কিন্তু OTP-তে সেটি বিপর্যয়: কোড না গেলে গ্রাহক **কখনোই**
 *   রেজিস্ট্রেশন শেষ করতে পারবেন না, অথচ পর্দায় লেখা থাকবে
 *   "কোড পাঠানো হয়েছে"। তাই OTP-র জন্য আলাদা, সত্যবাদী পথ।
 * ═══════════════════════════════════════════════════════════
 */

export type DeliverResult = { ok: true } | { ok: false; reason: string };

export type Channel = {
  id: OtpChannelEnum;
  /** ★ অ্যাডমিন চালু রেখেছেন **এবং** কারিগরিভাবে পাঠানো সম্ভব */
  available(): Promise<boolean>;
  /** ★ গন্তব্য বৈধ কি না (ইমেইল ঠিকানা / BD মোবাইল) */
  normalize(raw: string): string | null;
  deliver(destination: string, code: string): Promise<DeliverResult>;
};

/** ★ BD মোবাইল — `01XXXXXXXXX`। `+880`/`880` উপসর্গ মেনে নিয়ে ছেঁটে দেয়। */
export function normalizeBdPhone(raw: string): string | null {
  const digits = (raw || '').replace(/[\s-]/g, '');
  const m = /^(?:\+?880)?(01[3-9]\d{8})$/.exec(digits);
  return m ? m[1] : null;
}

export function normalizeEmail(raw: string): string | null {
  const e = (raw || '').trim().toLowerCase();
  // ★ সরল যাচাই — কড়া যাচাই zod schema করে; এটি কেবল normalize
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 120 ? e : null;
}

const emailChannel: Channel = {
  id: 'EMAIL',
  async available() {
    const cfg = await getOtpConfig();
    // ★ দুটোই লাগে: অ্যাডমিন চালু রেখেছেন, আর কী সত্যিই আছে
    return cfg.emailEnabled && isEmailConfigured();
  },
  normalize: normalizeEmail,
  async deliver(destination, code) {
    const sent = await emailOtpCode(destination, code, OTP_TTL_MINUTES);
    return sent ? { ok: true } : { ok: false, reason: 'ইমেইল পাঠানো যায়নি' };
  },
};

const smsChannel: Channel = {
  id: 'SMS',
  async available() {
    return (await getSmsProvider()) !== null;
  },
  normalize: normalizeBdPhone,
  async deliver(destination, code) {
    const provider = await getSmsProvider();
    if (!provider) return { ok: false, reason: 'SMS চ্যানেল চালু নেই' };
    const r = await provider.send({
      to: destination,
      text: `আপনার যাচাই কোড: ${code} (${OTP_TTL_MINUTES} মিনিট বৈধ)`,
    });
    return r.status === 'SENT' ? { ok: true } : { ok: false, reason: r.reason || 'SMS পাঠানো যায়নি' };
  },
};

export const CHANNELS: Record<OtpChannelEnum, Channel> = {
  EMAIL: emailChannel,
  SMS: smsChannel,
};

/**
 * ★ সাইনআপে কোন চ্যানেল(গুলো) ব্যবহার হবে — সেটিংস অনুযায়ী।
 *
 *   `either` = যেটি পাওয়া যায় সেটি (ইমেইল আগে, কারণ সেটিই কনফিগার্ড)
 *   `both`   = দুটোতেই কোড যাবে
 */
export async function signupChannels(): Promise<Channel[]> {
  const cfg = await getOtpConfig();
  const email = (await emailChannel.available()) ? emailChannel : null;
  const sms = (await smsChannel.available()) ? smsChannel : null;

  switch (cfg.signupChannel) {
    case 'sms':
      return sms ? [sms] : [];
    case 'both':
      return [email, sms].filter(Boolean) as Channel[];
    case 'either':
      return (email ?? sms) ? [(email ?? sms) as Channel] : [];
    case 'email':
    default:
      return email ? [email] : [];
  }
}
