'use client';

import { useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useVisibleInterval } from '@/lib/useVisibleInterval';

/**
 * ★ Real-time order tracking — প্রতি {seconds} সেকেন্ডে দেখে কিছু বদলেছে কি না,
 *   বদলালে server component নীরবে refresh করে (status auto আপডেট, পেজ রিলোড ছাড়াই)।
 *
 *   ★★★ H4 — আগে `setInterval` **চলতেই থাকত**, ভেতরে কেবল
 *   `visibilityState` দেখে কাজটি এড়াত। এখন `useVisibleInterval`
 *   ট্যাব লুকালে টাইমারটাই বন্ধ করে দেয়, আর ট্যাব ফিরলে সাথে সাথে
 *   একবার দেখে — ফলে ফিরে এসে বাসি স্ট্যাটাস দেখতে হয় না।
 *
 *   ★★★ SCL-02 — আগে প্রতি টিকেই `router.refresh()` = পুরো সার্ভার-রেন্ডার
 *   (১০k খোলা পাতায় ≈ ৩৩৩ রেন্ডার/সেকেন্ড, প্রতিটিতে কয়েকটি কোয়েরি — মডেল)।
 *   এখন কেবল ছোট ছাপ (`/api/account/orders/fingerprint`, একটি কোয়েরি) চাওয়া হয়;
 *   ছাপ বদলালে **তবেই** রিফ্রেশ। শুরুর ছাপ সার্ভার-রেন্ডারের সময়ই আসে (`initial`),
 *   তাই রেন্ডার আর প্রথম টিকের মাঝের বদলও ধরা পড়ে। ছাপ-অনুরোধ ব্যর্থ হলে আগের
 *   মতোই রিফ্রেশ — স্ট্যাটাস কখনো বাসি থাকে না (সেশন শেষ হলে পাতা-গার্ড লগইনে নেয়)।
 */
export default function AutoRefresh({
  seconds = 30,
  scope = 'recent',
  orderId,
  initial,
}: {
  seconds?: number;
  scope?: 'recent' | 'smm' | 'one';
  orderId?: string;
  /** সার্ভার-রেন্ডারের মুহূর্তের ছাপ; না থাকলে প্রতিবার রিফ্রেশ (পুরনো আচরণ) */
  initial?: string;
}) {
  const router = useRouter();
  const last = useRef(initial);

  const tick = useCallback(async () => {
    if (last.current === undefined) { router.refresh(); return; }
    try {
      const q = new URLSearchParams({ scope, ...(orderId ? { id: orderId } : {}) });
      const r = await fetch(`/api/account/orders/fingerprint?${q}`, { cache: 'no-store' });
      if (!r.ok) { router.refresh(); return; }
      const { v } = (await r.json()) as { v: string };
      if (v !== last.current) {
        last.current = v;
        router.refresh();
      }
    } catch {
      router.refresh();
    }
  }, [router, scope, orderId]);

  useVisibleInterval(() => { void tick(); }, seconds * 1000);
  return null;
}
