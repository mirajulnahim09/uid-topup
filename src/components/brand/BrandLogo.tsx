'use client';

import { useTheme } from '@/components/theme/ThemeProvider';
import VoltMark from '@/components/fx/VoltMark';
import type { LogoSlotKey, LogoPair } from '@/lib/branding';

/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ BrandLogo — অ্যাডমিনের আপলোড করা লোগো, থিম-সচেতন
 *
 *   • অ্যাডমিন লোগো দিলে সেটিই দেখায় (থিম অনুযায়ী dark/light)
 *   • না দিলে বিদ্যমান `VoltMark` চিহ্নে পড়ে যায় — অর্থাৎ নতুন
 *     ইনস্টলেও সাইট কখনো "লোগোহীন" দেখায় না
 *
 *   ── থিম বদলালে লোগোও বদলায় ──
 *   `useTheme().resolved` ব্যবহার করা হয় (system হলেও প্রকৃত মান)।
 *   ⚠️ সার্ভার-রেন্ডারে থিম জানা যায় না, তাই **দুটো ছবিই** DOM-এ
 *   থাকে এবং CSS (`data-theme`) একটিকে লুকিয়ে রাখে। এতে থিম বদলে
 *   ঝলকানি হয় না, আর হাইড্রেশন-অমিলও হয় না — `resolved` দিয়ে
 *   শর্তসাপেক্ষে রেন্ডার করলে প্রথম পেইন্টে ভুল লোগো দেখাত।
 * ═══════════════════════════════════════════════════════════
 */

type Props = {
  logos: LogoPair;
  slot: LogoSlotKey;
  alt: string;
  /** উচ্চতা px — প্রস্থ অনুপাত অনুযায়ী */
  height?: number;
  className?: string;
  /** ফলব্যাক VoltMark-এর আকার */
  markSize?: number;
  /** LCP-গুরুত্বপূর্ণ জায়গায় (নেভ/লগইন) */
  priority?: boolean;
};

export default function BrandLogo({
  logos, slot, alt, height = 36, className = '', markSize, priority = false,
}: Props) {
  const { resolved } = useTheme();
  const hasAny = Boolean(logos?.dark || logos?.light);

  if (!hasAny) {
    return <VoltMark size={markSize ?? height} uid={`brand-${slot}`} />;
  }

  const dark = logos.dark || logos.light;
  const light = logos.light || logos.dark;
  const same = dark === light;

  // একই ছবি দুই থিমে — একবারই রেন্ডার, অকারণ ডাউনলোড নয়
  if (same) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={dark} alt={alt} style={{ height, width: 'auto' }}
        className={`object-contain ${className}`}
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
        data-brand-slot={slot}
      />
    );
  }

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={dark} alt={alt} style={{ height, width: 'auto' }}
        className={`brand-logo-dark object-contain ${className}`}
        loading={priority ? 'eager' : 'lazy'} decoding="async"
        data-brand-slot={slot} data-brand-theme="dark"
        aria-hidden={resolved === 'light'}
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={light} alt={alt} style={{ height, width: 'auto' }}
        className={`brand-logo-light object-contain ${className}`}
        loading={priority ? 'eager' : 'lazy'} decoding="async"
        data-brand-slot={slot} data-brand-theme="light"
        aria-hidden={resolved === 'dark'}
      />
    </>
  );
}
