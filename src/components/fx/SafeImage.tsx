'use client';

import Image from 'next/image';

/**
 * ═══════════════════════════════════════════════════════════
 * ★ SafeImage — next/image এর সুবিধা, কিন্তু ক্র্যাশ ছাড়া।
 *
 *   সমস্যা: next/image শুধু next.config.js এর remotePatterns এ
 *   থাকা host থেকেই ছবি নিতে পারে। অন্য host হলে পুরো পেজ
 *   runtime error দিয়ে ভেঙে যায়।
 *
 *   সমাধান: অনুমোদিত host হলে next/image (WebP/AVIF, srcset,
 *   lazy — দ্রুত লোড)। অন্য কিছু হলে সাধারণ <img> — ধীর হলেও
 *   সাইট ভাঙবে না।
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

export default function SafeImage({ src, alt, sizes, className = '', priority = false }: Props) {
  if (canOptimize(src)) {
    return <Image src={src} alt={alt} fill sizes={sizes} className={className} priority={priority} />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      className={`absolute inset-0 h-full w-full ${className}`}
    />
  );
}
