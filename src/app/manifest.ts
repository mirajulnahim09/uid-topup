import type { MetadataRoute } from 'next';
import { getBranding } from '@/lib/branding';

/**
 * ★ PWA ম্যানিফেস্ট — সম্পূর্ণ অ্যাডমিন-নিয়ন্ত্রিত (2026-08-05)।
 *
 *   নাম, সংক্ষিপ্ত নাম, বিবরণ ও আইকন `/admin/branding` থেকে আসে।
 *   PWA আইকন আপলোড না থাকলে স্ট্যাটিক `/icon.svg`-এ পড়ে যায়, তাই
 *   ইনস্টল-প্রম্পট কখনো আইকনহীন হয় না।
 *
 *   ⚠️ `force-dynamic` — নাহলে Next বিল্ড-টাইমে একবার রেন্ডার করে
 *   ক্যাশ করত, আর অ্যাডমিন নাম বদলালেও ম্যানিফেস্ট পুরনোই থাকত।
 */
export const dynamic = 'force-dynamic';

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const b = await getBranding();
  const icon = b.logos.pwa.dark || b.logos.favicon.dark;

  return {
    name: b.manifestName,
    // ★ হোম-স্ক্রিনে আইকনের নিচে ~১২ অক্ষরের বেশি কেটে যায়
    short_name: b.manifestShort,
    description: b.metaDescription,
    start_url: '/',
    display: 'standalone',
    /* ★ DARK থিম: ইনস্টল করা অ্যাপের স্প্ল্যাশ ও স্ট্যাটাস-বার সাইটের
       গাঢ় থিমের সাথে মেলে — নাহলে চালু হওয়ার সময় সাদা ঝলকানি দিত। */
    background_color: '#0a0b11',
    theme_color: '#7c3aed',
    lang: 'bn',
    orientation: 'portrait',
    categories: ['shopping', 'games'],
    icons: icon
      ? [
          { src: icon, sizes: 'any', type: icon.endsWith('.svg') ? 'image/svg+xml' : 'image/png', purpose: 'any' },
          { src: icon, sizes: 'any', type: icon.endsWith('.svg') ? 'image/svg+xml' : 'image/png', purpose: 'maskable' },
        ]
      : [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
  };
}
