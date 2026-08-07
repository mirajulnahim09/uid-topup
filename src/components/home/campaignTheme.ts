import type { IconName } from '@/components/fx/Icon';

/**
 * ★ Campaign kind → থিম (Phase 3)
 *   প্রতিটি ধরনের নিজস্ব অ্যাকসেন্ট, সফট-পটভূমি, বাংলা লেবেল ও আইকন।
 *   ভূমিকা-নিয়ম মানা: লাইম = কাজ/অফার, বরফ = তথ্য/ইভেন্ট,
 *   বেগুনি = গিভঅ্যাওয়ে, উষ্ণ-লাল = সতর্কতা/টুর্নামেন্ট (জরুরি)।
 */
export type Theme = {
  accent: string;   // উজ্জ্বল রঙ (লেখা/আইকন) — সবগুলো ৪.৫:১ এর উপরে
  soft: string;     // হালকা পটভূমি
  edge: string;     // কিনারা
  label: string;    // বাংলা লেবেল
  icon: IconName;
};

const T = {
  volt: { accent: '#c8ff3d', soft: 'rgba(200,255,61,.1)', edge: 'rgba(200,255,61,.4)' },
  ice: { accent: '#7de3ff', soft: 'rgba(125,227,255,.1)', edge: 'rgba(125,227,255,.4)' },
  plasma: { accent: '#b39bff', soft: 'rgba(123,44,255,.16)', edge: 'rgba(179,155,255,.45)' },
  heat: { accent: '#ff8f78', soft: 'rgba(255,90,60,.1)', edge: 'rgba(255,90,60,.42)' },
} as const;

const MAP: Record<string, Theme> = {
  OFFER: { ...T.volt, label: 'অফার', icon: 'tag' },
  COUPON: { ...T.volt, label: 'কুপন', icon: 'tag' },
  PROMO: { ...T.volt, label: 'প্রচার', icon: 'tag' },
  NEW: { ...T.ice, label: 'নতুন', icon: 'plus' },
  EVENT: { ...T.ice, label: 'ইভেন্ট', icon: 'clock' },
  INFO: { ...T.ice, label: 'তথ্য', icon: 'chat' },
  GIVEAWAY: { ...T.plasma, label: 'গিভঅ্যাওয়ে', icon: 'gift' },
  TOURNAMENT: { ...T.heat, label: 'টুর্নামেন্ট', icon: 'shield' },
  WARNING: { ...T.heat, label: 'সতর্কতা', icon: 'alert' },
};

export function themeFor(kind: string): Theme {
  return MAP[kind] ?? MAP.PROMO;
}
