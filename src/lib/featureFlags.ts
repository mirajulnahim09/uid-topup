import { getSettings } from './settings';

/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ Feature Flags (Enterprise) — কোড deploy ছাড়া ফিচার on/off
 *
 *   ── কেন ──
 *   আগে ফিচার-সুইচ ছড়ানো ছিল (home_live_activity, maintenance_mode…)।
 *   একটি নতুন ফিচারে সমস্যা হলে দ্রুত বন্ধ করার একক, নিরাপদ জায়গা
 *   দরকার — deploy/rollback ছাড়াই। এই মডিউল সব flag এক ছাদের নিচে
 *   আনে, টাইপ-নিরাপদ, ডিফল্ট সহ।
 *
 *   ── কীভাবে কাজ করে ──
 *   flag DB-র Setting টেবিলে `flag_<key>` কী হিসেবে ('1'/'0')। অ্যাডমিন
 *   প্যানেল থেকে বদলানো যায়; settings cache-এর উপর বসে বলে দ্রুত ও
 *   invalidate-সচেতন। কোনো নতুন টেবিল নয় (additive)।
 *
 *   ⚠️ flag কেবল **UI/অ-আর্থিক** ফিচার নিয়ন্ত্রণ করে। টাকা/অর্ডার/
 *      নিরাপত্তা পথ কখনো flag দিয়ে বন্ধ করা হয় না — সেগুলোর নিজস্ব
 *      কঠোর guard আছে, আর flag ভুলে বদলালে টাকা নড়া উচিত নয়।
 * ═══════════════════════════════════════════════════════════
 */

/** সব সমর্থিত flag ও তাদের ডিফল্ট (on/off)। নতুন flag = এখানে এক লাইন। */
export const FEATURE_FLAGS = {
  /** হোমপেজে লাইভ ডেলিভারি ফিড */
  live_activity: { label: 'লাইভ ডেলিভারি ফিড', default: true },
  /** গ্রাহক রিভিউ প্রদর্শন */
  reviews: { label: 'রিভিউ প্রদর্শন', default: true },
  /** রেফারেল প্রোগ্রাম */
  referral: { label: 'রেফারেল প্রোগ্রাম', default: true },
  /** রিভিউতে ছবি আপলোড */
  review_photos: { label: 'রিভিউ ছবি', default: true },
  /** প্রোডাক্ট রেটিং ব্যাজ */
  rating_badges: { label: 'রেটিং ব্যাজ', default: true },
} as const;

export type FeatureKey = keyof typeof FEATURE_FLAGS;

const SETTING_PREFIX = 'flag_';

/** একটি flag চালু কিনা (ডিফল্ট সহ) */
export async function isFeatureEnabled(key: FeatureKey): Promise<boolean> {
  const settings = await getSettings();
  const raw = settings[`${SETTING_PREFIX}${key}`];
  if (raw === undefined || raw === '') return FEATURE_FLAGS[key].default;
  return raw === '1';
}

/** সব flag-এর বর্তমান অবস্থা (অ্যাডমিন প্যানেল/readiness এর জন্য) */
export async function allFeatureFlags(): Promise<
  { key: FeatureKey; label: string; enabled: boolean; isDefault: boolean }[]
> {
  const settings = await getSettings();
  return (Object.keys(FEATURE_FLAGS) as FeatureKey[]).map((key) => {
    const raw = settings[`${SETTING_PREFIX}${key}`];
    const enabled = raw === undefined || raw === '' ? FEATURE_FLAGS[key].default : raw === '1';
    return {
      key,
      label: FEATURE_FLAGS[key].label,
      enabled,
      isDefault: raw === undefined || raw === '',
    };
  });
}

/** Setting-কী নাম (অ্যাডমিন সেভ রুট এটি ব্যবহার করে) */
export function flagSettingKey(key: FeatureKey): string {
  return `${SETTING_PREFIX}${key}`;
}
