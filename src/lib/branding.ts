import { getSettings } from './settings';
import { BRAND } from './brand';

/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ ব্র্যান্ড আইডেন্টিটি — সম্পূর্ণ অ্যাডমিন-নিয়ন্ত্রিত
 *
 *   কোনো লোগো বা ব্র্যান্ড-লেখা কোডে হার্ডকোড করা নেই। সবই
 *   `Setting` সারি থেকে আসে; সেট না থাকলে `brand.ts`-এর ডিফল্টে
 *   পড়ে যায় (যাতে নতুন ইনস্টলেও সাইট সম্পূর্ণ দেখায়)।
 *
 *   ── কেন `brand.ts` আর `branding.ts` আলাদা ──
 *   `brand.ts` = কোডে লেখা **ফলব্যাক ধ্রুবক** (DB ছাড়াই কাজ করে,
 *   তাই ক্লায়েন্ট বান্ডলেও নিরাপদ)। `branding.ts` = **রানটাইম
 *   রেজোলিউশন** (DB পড়ে, শুধু সার্ভারে চলে)। দুটো মেলালে ক্লায়েন্ট
 *   কম্পোনেন্ট প্রতিবার DB টানতে চাইত।
 * ═══════════════════════════════════════════════════════════
 */

export type LogoSlotKey =
  | 'primary' | 'secondary' | 'compact' | 'square' | 'favicon'
  | 'pwa' | 'login' | 'loading' | 'email' | 'og';

export type LogoSlot = {
  key: LogoSlotKey;
  label: string;
  hint: string;
  /** ক্রপের অনুপাত — null = মুক্ত */
  aspect: number | null;
  /** সংরক্ষণের আগে সর্বোচ্চ প্রস্থ/উচ্চতা (px) — স্বয়ংক্রিয় রিসাইজ */
  max: number;
  /** কোথায় ব্যবহৃত হয় — UI-তে দেখানো হয়, যাতে অ্যাডমিন বোঝে */
  usedIn: string;
};

/**
 * ⚠️ `max` ইচ্ছাকৃতভাবে ছোট। ফেভিকন ২৫৬px-এর বেশি হলে ব্রাউজার
 *    এমনিতেই ছোট করে, কিন্তু বাইটগুলো তবু ডাউনলোড হয় — প্রতিটি
 *    পাতা-লোডে অপচয়। OG ১২০০px কারণ সোশ্যাল ক্রলার তাই চায়।
 */
export const LOGO_SLOTS: LogoSlot[] = [
  { key: 'primary', label: 'প্রধান লোগো', hint: 'প্রস্থে লম্বা (wordmark) হলে ভালো', aspect: null, max: 512, usedIn: 'নেভিগেশন, অ্যাডমিন সাইডবার' },
  { key: 'secondary', label: 'সেকেন্ডারি লোগো', hint: 'বিকল্প পটভূমির জন্য', aspect: null, max: 512, usedIn: 'ফুটার' },
  { key: 'compact', label: 'কমপ্যাক্ট লোগো', hint: 'সংকীর্ণ জায়গার জন্য ছোট রূপ', aspect: null, max: 256, usedIn: 'মোবাইল নেভ, ট্যাব বার' },
  { key: 'square', label: 'স্কয়ার লোগো', hint: '১:১ — চিহ্ন/মনোগ্রাম', aspect: 1, max: 512, usedIn: 'অ্যাভাটার, সোশ্যাল প্রোফাইল' },
  { key: 'favicon', label: 'ফেভিকন', hint: '১:১ — খুব ছোট আকারেও পড়া যাবে এমন', aspect: 1, max: 256, usedIn: 'ব্রাউজার ট্যাব' },
  { key: 'pwa', label: 'PWA আইকন', hint: '১:১ — হোম-স্ক্রিন আইকন', aspect: 1, max: 512, usedIn: 'ইনস্টল প্রম্পট, ম্যানিফেস্ট' },
  { key: 'login', label: 'লগইন লোগো', hint: 'লগইন/রেজিস্টার পাতার উপরে', aspect: null, max: 512, usedIn: 'লগইন, রেজিস্টার, পাসওয়ার্ড রিসেট' },
  { key: 'loading', label: 'লোডিং লোগো', hint: '১:১ হলে সবচেয়ে ভালো', aspect: 1, max: 256, usedIn: 'লোডিং ওভারলে, স্প্ল্যাশ' },
  { key: 'email', label: 'ইমেইল লোগো', hint: 'ইমেইলে দেখাতে **পূর্ণ URL** দরকার (নিচে সাইট URL দিন)', aspect: null, max: 512, usedIn: 'ইমেইল হেডার' },
  { key: 'og', label: 'সোশ্যাল শেয়ার (OpenGraph)', hint: '১২০০×৬৩০ প্রস্তাবিত', aspect: 1200 / 630, max: 1200, usedIn: 'Facebook/WhatsApp/Twitter শেয়ার কার্ড' },
];

export type BrandTheme = 'dark' | 'light';

/** সেটিংস কী — `brand_logo_primary_dark` ইত্যাদি */
export const logoKey = (slot: LogoSlotKey, theme: BrandTheme) => `brand_logo_${slot}_${theme}`;

/** সম্পাদনাযোগ্য টেক্সট ক্ষেত্র — allowlist হিসেবেও ব্যবহৃত */
export const TEXT_FIELDS = [
  { key: 'site_name', label: 'সাইটের নাম', hint: 'নেভিগেশন, ফুটার ও সর্বত্র', max: 60 },
  { key: 'brand_short_name', label: 'সংক্ষিপ্ত নাম', hint: 'সংকীর্ণ জায়গা (≤১২ অক্ষর ভালো)', max: 20 },
  { key: 'brand_name', label: 'ব্র্যান্ড নাম', hint: 'আইনি/বিপণন নাম', max: 60 },
  { key: 'brand_company', label: 'কোম্পানির নাম', hint: 'কপিরাইট ও চালানে', max: 80 },
  { key: 'brand_copyright', label: 'কপিরাইট লেখা', hint: '© সহ পুরো লাইন। খালি রাখলে স্বয়ংক্রিয়', max: 120 },
  { key: 'brand_footer_text', label: 'ফুটার লেখা', hint: 'ফুটারে সংক্ষিপ্ত বিবরণ', max: 200 },
  { key: 'brand_browser_title', label: 'ব্রাউজার টাইটেল', hint: 'ট্যাবে যা দেখাবে। খালি = সাইটের নাম', max: 70 },
  { key: 'brand_meta_title', label: 'মেটা টাইটেল (SEO)', hint: 'সার্চ ফলাফলের শিরোনাম', max: 70 },
  { key: 'brand_meta_description', label: 'মেটা বিবরণ (SEO)', hint: '১৫০–১৬০ অক্ষর সবচেয়ে ভালো', max: 300 },
  { key: 'brand_keywords', label: 'কীওয়ার্ড', hint: 'কমা দিয়ে আলাদা', max: 300 },
  { key: 'brand_og_title', label: 'OpenGraph টাইটেল', hint: 'শেয়ার কার্ডের শিরোনাম', max: 90 },
  { key: 'brand_og_description', label: 'OpenGraph বিবরণ', hint: 'শেয়ার কার্ডের বিবরণ', max: 200 },
  { key: 'brand_manifest_name', label: 'ম্যানিফেস্ট নাম', hint: 'PWA ইনস্টল প্রম্পটে', max: 90 },
  { key: 'brand_manifest_short', label: 'ম্যানিফেস্ট সংক্ষিপ্ত নাম', hint: 'হোম-স্ক্রিনে (≤১২ অক্ষর)', max: 20 },
  { key: 'site_url', label: 'সাইটের পূর্ণ URL', hint: 'ইমেইল ও শেয়ার-কার্ডে ছবির পূর্ণ পথ বানাতে', max: 200 },
] as const;

export type TextFieldKey = (typeof TEXT_FIELDS)[number]['key'];
const TEXT_KEYS = new Set<string>(TEXT_FIELDS.map((f) => f.key));
export const isTextField = (k: string): k is TextFieldKey => TEXT_KEYS.has(k);

export type LogoPair = { dark: string; light: string };

export type Branding = {
  siteName: string;
  shortName: string;
  brandName: string;
  company: string;
  copyright: string;
  footerText: string;
  browserTitle: string;
  metaTitle: string;
  metaDescription: string;
  keywords: string[];
  ogTitle: string;
  ogDescription: string;
  manifestName: string;
  manifestShort: string;
  siteUrl: string;
  logos: Record<LogoSlotKey, LogoPair>;
};

const DEFAULT_DESC =
  'ফ্রি ফায়ার ডায়মন্ড টপ আপ — কম দামে ভালো সার্ভিস। bKash / Nagad এ পেমেন্ট করে ১০ সেকেন্ডে সরাসরি অ্যাকাউন্টে ডায়মন্ড। ২৪/৭ সাপোর্ট।';
const DEFAULT_KEYWORDS = [
  'ফ্রি ফায়ার টপ আপ', 'Free Fire diamond', 'UID top up',
  'bKash Nagad top up', 'ডায়মন্ড কেনা', 'Bangladesh game top up',
];

/** কাঁচা সেটিংস → সম্পূর্ণ ব্র্যান্ড কনফিগ (ফলব্যাক সহ) */
export function resolveBranding(s: Record<string, string>): Branding {
  const g = (k: string) => (s[k] ?? '').trim();

  const siteName = g('site_name') || BRAND.name;
  const brandName = g('brand_name') || siteName;
  const company = g('brand_company') || brandName;
  const year = new Date().getFullYear();

  const logos = {} as Record<LogoSlotKey, LogoPair>;
  for (const slot of LOGO_SLOTS) {
    const dark = g(logoKey(slot.key, 'dark'));
    const light = g(logoKey(slot.key, 'light'));
    // ★ একটি থিমের লোগো দিলে অন্যটিতেও সেটিই — অ্যাডমিনকে দুটো
    //   আপলোড করতে বাধ্য করা হয় না; বেশিরভাগ লোগো দুই থিমেই চলে।
    logos[slot.key] = { dark: dark || light, light: light || dark };
  }

  // ★ নির্দিষ্ট স্লট খালি থাকলে primary-তে পড়ে যায় — একটি লোগো
  //   আপলোড করলেই পুরো সাইট ব্র্যান্ডেড হয়ে যায়।
  const fallbackChain: [LogoSlotKey, LogoSlotKey[]][] = [
    ['secondary', ['primary']],
    ['compact', ['square', 'primary']],
    ['login', ['primary']],
    ['loading', ['square', 'primary']],
    ['email', ['primary']],
    ['og', ['primary']],
    ['pwa', ['square', 'favicon']],
    ['favicon', ['square', 'pwa']],
    ['square', ['favicon', 'pwa']],
  ];
  for (const [target, sources] of fallbackChain) {
    for (const t of ['dark', 'light'] as BrandTheme[]) {
      if (logos[target][t]) continue;
      for (const src of sources) {
        if (logos[src][t]) { logos[target][t] = logos[src][t]; break; }
      }
    }
  }

  return {
    siteName,
    shortName: g('brand_short_name') || BRAND.short,
    brandName,
    company,
    copyright: g('brand_copyright') || `© ${year} ${company}. সর্বস্বত্ব সংরক্ষিত।`,
    footerText: g('brand_footer_text'),
    browserTitle: g('brand_browser_title') || siteName,
    metaTitle: g('brand_meta_title') || `${siteName} | ফ্রি ফায়ার ডায়মন্ড টপ আপ`,
    metaDescription: g('brand_meta_description') || DEFAULT_DESC,
    keywords: g('brand_keywords')
      ? g('brand_keywords').split(',').map((k) => k.trim()).filter(Boolean)
      : [siteName, ...DEFAULT_KEYWORDS],
    ogTitle: g('brand_og_title') || g('brand_meta_title') || `${siteName} | ফ্রি ফায়ার ডায়মন্ড টপ আপ`,
    ogDescription: g('brand_og_description') || 'কম দামে ভালো সার্ভিস — ১০ সেকেন্ডে ডায়মন্ড ডেলিভারি। bKash / Nagad।',
    manifestName: g('brand_manifest_name') || `${siteName} — ফ্রি ফায়ার ডায়মন্ড টপ আপ`,
    manifestShort: g('brand_manifest_short') || g('brand_short_name') || BRAND.short,
    siteUrl: g('site_url'),
    logos,
  };
}

/** সার্ভার-সাইড রেজোলিউশন — DB না পেলেও ডিফল্টে সাইট চলে */
export async function getBranding(): Promise<Branding> {
  try {
    return resolveBranding(await getSettings());
  } catch {
    return resolveBranding({});
  }
}

/** আপেক্ষিক পথকে পূর্ণ URL — ইমেইল ও OG কার্ডে আবশ্যক */
export function absoluteUrl(path: string, siteUrl: string): string {
  if (!path) return '';
  if (/^https?:\/\//i.test(path) || path.startsWith('data:')) return path;
  const base = (siteUrl || process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXTAUTH_URL || '').replace(/\/$/, '');
  return base ? `${base}${path.startsWith('/') ? '' : '/'}${path}` : path;
}
