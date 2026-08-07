'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useVisibleInterval } from '@/lib/useVisibleInterval';

/**
 * ★ Real-time order tracking — প্রতি {seconds} সেকেন্ডে server component
 *   নীরবে refresh করে (status auto আপডেট, পেজ রিলোড ছাড়াই)।
 *
 *   ★★★ H4 — আগে `setInterval` **চলতেই থাকত**, ভেতরে কেবল
 *   `visibilityState` দেখে কাজটি এড়াত। এখন `useVisibleInterval`
 *   ট্যাব লুকালে টাইমারটাই বন্ধ করে দেয়, আর ট্যাব ফিরলে সাথে সাথে
 *   একবার refresh করে — ফলে ফিরে এসে বাসি স্ট্যাটাস দেখতে হয় না
 *   (আগে সর্বোচ্চ {seconds} সেকেন্ড পুরনো তথ্য থাকত)।
 */
export default function AutoRefresh({ seconds = 30 }: { seconds?: number }) {
  const router = useRouter();
  const refresh = useCallback(() => router.refresh(), [router]);
  useVisibleInterval(refresh, seconds * 1000);
  return null;
}
