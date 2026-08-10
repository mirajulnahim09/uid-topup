import { getSettings } from '../settings';

/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ টেলিগ্রাম ইভেন্ট ব্যবস্থা — ১৫টি ইভেন্ট, দুই স্তরের সুইচ
 *
 *   ১. `telegram_enabled`     — মাস্টার সুইচ
 *   ২. `telegram_ev_<key>`    — প্রতি ইভেন্টে আলাদা
 *
 *   দুটোই চালু থাকলে তবেই বার্তা যায়।
 *
 *   ⚠️ সুইচগুলো **কেবল টেলিগ্রামের**। ইন-অ্যাপ নোটিফিকেশন সবসময়
 *   যাবে — নাহলে একটি টেলিগ্রাম-সুইচ বন্ধ করলে ঘটনাটি অ্যাডমিন
 *   প্যানেল থেকেও হারিয়ে যেত।
 * ═══════════════════════════════════════════════════════════
 */

export type EventGroup = 'money' | 'order' | 'user' | 'system' | 'digest';

export const GROUP_LABEL: Record<EventGroup, string> = {
  money: '💰 টাকা',
  order: '📦 অর্ডার',
  user: '👤 ইউজার',
  system: '⚙️ সিস্টেম',
  digest: '📊 সারসংক্ষেপ',
};

export const TELEGRAM_EVENTS = [
  // ── টাকা ──
  { key: 'deposit_new', group: 'money', label: 'নতুন ডিপোজিট', hint: 'গ্রাহক রিচার্জ রিকোয়েস্ট পাঠালে', default: true, wired: true },
  { key: 'deposit_approved', group: 'money', label: 'ডিপোজিট অনুমোদিত', hint: 'অ্যাডমিন ডিপোজিট অনুমোদন করলে', default: false, wired: true },
  { key: 'deposit_rejected', group: 'money', label: 'ডিপোজিট বাতিল', hint: 'অ্যাডমিন ডিপোজিট বাতিল করলে', default: false, wired: true },
  { key: 'wallet_credit', group: 'money', label: 'ওয়ালেট ক্রেডিট', hint: 'ম্যানুয়ালি ব্যালেন্স যোগ/সমন্বয় হলে', default: true, wired: true },
  { key: 'refund', group: 'money', label: 'রিফান্ড', hint: 'অর্ডার বাতিল বা আংশিক ফেরত হলে', default: true, wired: true },
  // ── অর্ডার ──
  { key: 'order_new', group: 'order', label: 'নতুন অর্ডার', hint: 'গ্রাহক অর্ডার করলে', default: true, wired: true },
  { key: 'order_completed', group: 'order', label: 'অর্ডার সম্পন্ন', hint: 'অ্যাডমিন ডেলিভারি সম্পন্ন করলে', default: false, wired: true },
  { key: 'coupon', group: 'order', label: 'কুপন', hint: 'কুপন তৈরি বা ব্যবহার হলে', default: false, wired: true },
  // ★ C2 — শিডিউলার এসেছে, তাই এটি এখন সত্যিই পাঠানো যায়।
  //   `slaBreach.ts` আগে কেবল *দেখার* সতর্কতা ছিল (অ্যাডমিন পাতায়
  //   খুললে তবেই চোখে পড়ত)। এখন `/api/cron/sla-breach` প্রতি ১৫
  //   মিনিটে দেখে ও **নতুন** ভঙ্গ হওয়া অর্ডারের জন্য বার্তা পাঠায়।
  {
    key: 'sla_breach', group: 'order', label: 'SLA ভঙ্গ',
    hint: 'কোনো অর্ডার প্রতিশ্রুত সময় পেরিয়ে গেলে', default: true, wired: true,
  },
  // ★ Group G — অটো-ডেলিভারি ব্যর্থ বা **অনিশ্চিত**। ডিফল্ট চালু ও
  //   বন্ধ করা যায়, কিন্তু বন্ধ করলে অর্ডারটি নীরবে ম্যানুয়াল কিউতে
  //   পড়ে থাকবে — তাই hint-এ সেটি স্পষ্ট বলা।
  {
    key: 'fulfillment_failed', group: 'order', label: 'অটো-ডেলিভারি ব্যর্থ',
    hint: 'অটো-ডেলিভারি না হলে বা ফল অনিশ্চিত থাকলে (ম্যানুয়াল যাচাই দরকার)',
    default: true, wired: true,
  },
  // ── ইউজার ──
  { key: 'user_registered', group: 'user', label: 'নতুন রেজিস্ট্রেশন', hint: 'নতুন অ্যাকাউন্ট খুললে', default: false, wired: true },
  // ── সিস্টেম ──
  { key: 'campaign', group: 'system', label: 'ক্যাম্পেইন', hint: 'ক্যাম্পেইন প্রকাশিত হলে', default: false, wired: true },
  { key: 'maintenance', group: 'system', label: 'মেইনটেন্যান্স', hint: 'সাইট বন্ধ/চালু করলে', default: true, wired: true },
  { key: 'low_stock', group: 'system', label: 'স্টক শেষ', hint: 'কোনো ভ্যারিয়েন্টের স্টক ০ হলে', default: true, wired: true },
  {
    key: 'server_warning', group: 'system', label: 'সার্ভার সতর্কতা',
    hint: 'ডাটাবেস/সার্ভার ত্রুটি ধরা পড়লে', default: true, wired: true,
  },
  {
    key: 'security_alert', group: 'system', label: 'নিরাপত্তা সতর্কতা',
    hint: 'সন্দেহজনক লগইন বা অ্যাকাউন্ট দখলের চেষ্টা', default: true, wired: true,
  },
  // ── সারসংক্ষেপ ──
  //   ⚠️ `wired: false` — এই দুটির জন্য একটি **শিডিউলার** দরকার
  //   (cron / external trigger), যা এই অ্যাপে নেই। সুইচ ও পাঠানোর
  //   কোড প্রস্তুত; শুধু কেউ ডাকে না। মিথ্যা প্রতিশ্রুতি এড়াতে
  //   UI-তে "শিডিউলার দরকার" বলে চিহ্নিত থাকে।
  {
    key: 'daily_summary', group: 'digest', label: 'দৈনিক সারসংক্ষেপ',
    hint: 'প্রতিদিনের বিক্রি ও অর্ডারের সারাংশ', default: false, wired: false,
  },
  {
    key: 'weekly_summary', group: 'digest', label: 'সাপ্তাহিক সারসংক্ষেপ',
    hint: 'সপ্তাহের সারাংশ', default: false, wired: false,
  },
] as const;

export type TelegramEvent = (typeof TELEGRAM_EVENTS)[number]['key'];

export const eventSettingKey = (e: TelegramEvent | string) => `telegram_ev_${e}`;
export const MASTER_KEY = 'telegram_enabled';

const DEFAULTS = new Map<string, boolean>(TELEGRAM_EVENTS.map((e) => [e.key, e.default]));

export async function getEventFlags(): Promise<{
  enabled: boolean;
  events: Record<TelegramEvent, boolean>;
}> {
  let s: Record<string, string> = {};
  try {
    s = await getSettings();
  } catch {
    /* সেটিংস না পড়া গেলে ডিফল্ট */
  }
  const enabled = (s[MASTER_KEY] ?? '1') === '1';
  const events = {} as Record<TelegramEvent, boolean>;
  for (const e of TELEGRAM_EVENTS) {
    const raw = s[eventSettingKey(e.key)];
    events[e.key] = raw === undefined ? e.default : raw === '1';
  }
  return { enabled, events };
}

/** এই ইভেন্টের বার্তা পাঠানো যাবে কি না */
export async function shouldSend(event?: TelegramEvent): Promise<boolean> {
  const { enabled, events } = await getEventFlags();
  if (!enabled) return false;
  if (!event) return true;
  return events[event] ?? DEFAULTS.get(event) ?? false;
}

/** UI-র জন্য গোষ্ঠীবদ্ধ তালিকা */
export function eventsByGroup() {
  const out: { group: EventGroup; label: string; items: typeof TELEGRAM_EVENTS[number][] }[] = [];
  for (const g of ['money', 'order', 'user', 'system', 'digest'] as EventGroup[]) {
    const items = TELEGRAM_EVENTS.filter((e) => e.group === g);
    if (items.length) out.push({ group: g, label: GROUP_LABEL[g], items: [...items] });
  }
  return out;
}
