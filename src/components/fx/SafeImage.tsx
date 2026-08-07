'use client';

import Image from 'next/image';
import { useState } from 'react';

/**
 * ═══════════════════════════════════════════════════════════
 * ★ SafeImage — next/image এর সুবিধা, কিন্তু ক্র্যাশ ছাড়া।
 *
 *   সমস্যা ১: next/image শুধু next.config.js এর remotePatterns এ
 *   থাকা host থেকেই ছবি নিতে পারে। অন্য host হলে পুরো পেজ
 *   runtime error দিয়ে ভেঙে যায়।
 *   → সমাধান: অনুমোদিত host হলে next/image, নাহলে সাধারণ <img>।
 *
 *   সমস্যা ২ (২০২৬-০৮-০৫ অডিটে ধরা): ফাইলটি **নেই** এমন পথ দিলে
 *   (যেমন DB-তে Media সারি আছে কিন্তু ডিস্কে ফাইল মুছে গেছে)
 *   অপ্টিমাইজার 400 ফেরত দেয় — ফলে ভাঙা ছবির বাক্স, আর প্রতিটি
 *   ছবির জন্য কনসোলে ত্রুটি। গ্রাহকের প্রোডাক্ট পাতাতেও একই।
 *   → সমাধান: `onError` ধরে একটি নিরপেক্ষ প্লেসহোল্ডার দেখানো।
 *     ভাঙা ছবির আইকনের চেয়ে "ছবি নেই" বলা সৎ ও পরিচ্ছন্ন।
 * ═══════════════════════════════════════════════════════════
 */

/** next.config.js এর remotePatterns এর সাথে মিল রেখে রাখুন */
const OPTIMIZABLE = [/\.public\.blob\.vercel-storage\.com$/i];

function canOptimize(src: string): boolean {
  if (!src) return false;
  if (src.startsWith('/')) return true; // নিজের /public ফোল্ডার
  try {
    const host = new URL(src).hostname;
    return OPTIMIZABLE.some((re) => re.test(host));
  } catch {
    return false; // data:, blob:, ভাঙা URL
  }
}

type Props = {
  src: string;
  alt: string;
  sizes?: string;
  className?: string;
  priority?: boolean;
};

/** ছবি না পাওয়া গেলে — ডিজাইন-টোকেন ব্যবহার করে, দুই থিমেই মানানসই */
function Placeholder({ alt }: { alt: string }) {
  return (
    <span
      role="img"
      aria-label={alt ? `${alt} — ছবি পাওয়া যায়নি` : 'ছবি পাওয়া যায়নি'}
      className="absolute inset-0 flex flex-col items-center justify-center gap-1"
      style={{ background: 'var(--v-steel)', color: 'var(--v-dim)' }}
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="3" y="4" width="18" height="16" rx="2.5" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="8.5" cy="9.5" r="1.6" fill="currentColor" />
        <path d="M4.5 17.5l4.6-4.6a1.6 1.6 0 0 1 2.2 0l4 4M14.5 15l1.6-1.6a1.6 1.6 0 0 1 2.2 0l1.2 1.2"
          stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      <span className="text-[10px] font-semibold">ছবি নেই</span>
    </span>
  );
}

export default function SafeImage({ src, alt, sizes, className = '', priority = false }: Props) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) return <Placeholder alt={alt} />;

  if (canOptimize(src)) {
    return (
      <Image
        src={src}
        alt={alt}
        fill
        sizes={sizes}
        className={className}
        priority={priority}
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      className={`absolute inset-0 h-full w-full ${className}`}
      onError={() => setFailed(true)}
    />
  );
}
