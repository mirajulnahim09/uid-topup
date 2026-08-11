import { logger } from '../logger';
import { getOtpConfig, OTP_KEYS } from '../otp/settings';
import { getSettings } from '../settings';
import { decryptSecret, isEncrypted } from '../secretbox';
import type { SmsProvider, SendResult } from '../integrations/types';

/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ Group I (৩) — SMS প্রোভাইডার রেজিস্ট্রি
 *
 *   ⚠️⚠️ **কোনো বাংলাদেশি গেটওয়ে বাস্তবায়ন করা হয়নি — ইচ্ছাকৃতভাবে।**
 *   SSL Wireless / Alpha SMS / BulkSMSBD — কারও প্রামাণিক API ডকুমেন্ট
 *   মার্চেন্ট অ্যাকাউন্ট ছাড়া পাওয়া যায় না, আর CLAUDE.md §6 স্পষ্ট:
 *   না-পড়া third-party API contract **অনুমান করা নিষিদ্ধ**। একটি ভুল
 *   অনুমান মানে OTP নীরবে না-পৌঁছানো, অর্থাৎ গ্রাহক লগইনই করতে
 *   পারবেন না — আর সেটি প্রোডাকশনে গিয়ে ধরা পড়ত।
 *
 *   তাই যা আছে: **কনফিগের আকার** (অ্যাডমিন প্যানেল থেকে ক্রেডেনশিয়াল,
 *   এনক্রিপ্টেড at rest) এবং একটি **log প্রোভাইডার** যাতে গেটওয়ে
 *   ছাড়াই পুরো প্রবাহটি ডেভে চালিয়ে দেখা যায়।
 *
 *   গেটওয়ে যুক্ত করার সময় কেবল একটি নতুন `SmsProvider` লিখে
 *   `PROVIDERS`-এ যোগ করতে হবে — বাকি কিছুই বদলাবে না।
 *   PROGRESS.md-এ এটি `SKIPPED — no public docs` হিসেবে লেখা।
 * ═══════════════════════════════════════════════════════════
 */

/** ★ অ্যাডমিন যে ক্ষেত্রগুলো পূরণ করবেন — প্রোভাইডার-ভেদে আলাদা */
export type SmsCredentialField = { key: string; label: string; secret: boolean };

export type SmsProviderMeta = {
  id: string;
  label: string;
  /** ★ বাস্তবায়িত কি না। false = কেবল কনফিগ-আকার আছে। */
  implemented: boolean;
  fields: SmsCredentialField[];
  note?: string;
};

export const SMS_PROVIDERS: SmsProviderMeta[] = [
  {
    id: 'log',
    label: 'Log (ডেভ — কোথাও পাঠায় না)',
    implemented: true,
    fields: [],
    note: 'কোডটি সার্ভার লগে লেখে। কেবল ডেভে — প্রোডাকশনে বেছে নেবেন না।',
  },
  {
    id: 'sslwireless',
    label: 'SSL Wireless',
    implemented: false,
    fields: [
      { key: 'apiToken', label: 'API Token', secret: true },
      { key: 'sid', label: 'SID', secret: false },
    ],
    note: 'বাস্তবায়িত নয় — প্রামাণিক ডকুমেন্ট মার্চেন্ট অ্যাকাউন্ট ছাড়া নেই।',
  },
  {
    id: 'alphasms',
    label: 'Alpha SMS',
    implemented: false,
    fields: [{ key: 'apiKey', label: 'API Key', secret: true }],
    note: 'বাস্তবায়িত নয় — প্রামাণিক ডকুমেন্ট পাওয়া যায়নি।',
  },
];

/**
 * ★ ডেভ প্রোভাইডার — কোড সার্ভার লগে যায়, কোথাও পাঠানো হয় না।
 *
 *   ⚠️ এটিই একমাত্র জায়গা যেখানে OTP কোড লগে ওঠে, এবং সেটি
 *   ইচ্ছাকৃত: গেটওয়ে ছাড়া প্রবাহটি পরীক্ষা করার আর কোনো উপায় নেই।
 *   প্রোডাকশনে এই প্রোভাইডার বেছে নিলে অ্যাডমিন UI সতর্ক করে।
 */
const logProvider: SmsProvider = {
  id: 'log',
  label: 'Log (ডেভ)',
  category: 'sms',
  kind: 'BUILTIN',
  isConfigured: () => true,
  async send({ to, text }): Promise<SendResult> {
    logger.warn('sms', '★ DEV প্রোভাইডার — কোনো SMS পাঠানো হয়নি', { to, text });
    return { status: 'SENT', ref: 'log' };
  },
};

/** ★ বাস্তবায়িত নয় এমন প্রোভাইডারের জায়গায় — স্পষ্টভাবে ব্যর্থ হয়, নীরবে নয় */
function unimplemented(meta: SmsProviderMeta): SmsProvider {
  return {
    id: meta.id,
    label: meta.label,
    category: 'sms',
    kind: 'GATEWAY',
    isConfigured: () => false,
    async send(): Promise<SendResult> {
      return {
        status: 'FAILED',
        reason: `${meta.label} এখনো বাস্তবায়িত হয়নি — গেটওয়ের ডকুমেন্ট দরকার।`,
      };
    },
  };
}

/** ★ অ্যাডমিনের সংরক্ষিত ক্রেডেনশিয়াল — এনক্রিপ্টেড থাকলে খুলে দেয় */
export async function readSmsCredentials(): Promise<Record<string, string>> {
  try {
    const s = await getSettings();
    const raw = s[OTP_KEYS.smsCredentials];
    if (!raw) return {};
    const json = isEncrypted(raw) ? decryptSecret(raw) : raw;
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as Record<string, string>;
  } catch {
    // ★ বিকৃত/অ-ডিক্রিপ্টযোগ্য সারিতে "কী নেই" — কখনো throw নয়
    return {};
  }
}

/** ★ বর্তমানে সক্রিয় প্রোভাইডার (সেটিংস অনুযায়ী) */
export async function getSmsProvider(): Promise<SmsProvider | null> {
  const cfg = await getOtpConfig();
  if (!cfg.smsEnabled) return null;

  const id = cfg.smsProvider || 'log';
  if (id === 'log') return logProvider;

  const meta = SMS_PROVIDERS.find((p) => p.id === id);
  if (!meta) return null;
  // ⚠️ বাস্তবায়িত নয় — স্পষ্ট ব্যর্থতা ফেরে, যাতে "পাঠানো হয়েছে" বলে
  //    ভুল বার্তা কখনো না যায়
  return unimplemented(meta);
}
