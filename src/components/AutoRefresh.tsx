'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * ★ Real-time order tracking — প্রতি {seconds} সেকেন্ডে server component
 *   নীরবে refresh করে (status auto আপডেট, পেজ রিলোড ছাড়াই)।
 *   ট্যাব লুকানো থাকলে থেমে যায় (ব্যাটারি/নেট বাঁচে)।
 */
export default function AutoRefresh({ seconds = 30 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const iv = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, seconds * 1000);
    return () => clearInterval(iv);
  }, [router, seconds]);
  return null;
}
