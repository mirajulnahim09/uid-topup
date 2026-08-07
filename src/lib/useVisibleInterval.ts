'use client';

import { useEffect, useRef } from 'react';

/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ H4 — ট্যাব দেখা না গেলে টাইমার **সম্পূর্ণ থামে**
 *
 *   ── কী সমস্যা ছিল ──
 *   `Navbar` প্রতি ৬০ সেকেন্ডে `/api/me` + `/api/notifications` ডাকত,
 *   **দৃশ্যমানতা না দেখেই**। ব্যবহারকারীর ব্রাউজারে ৫টি ট্যাব খোলা
 *   থাকলে (এই ধরনের সাইটে স্বাভাবিক) পাঁচটিই মিনিটে দুটি করে DB-ছোঁয়া
 *   অনুরোধ পাঠাত — যার প্রায় সবই এমন ট্যাবের জন্য যা কেউ দেখছেই না।
 *   Neon-এ সংযোগ-সীমা ও auto-suspend আছে, তাই এটি প্রকৃত খরচ।
 *
 *   `AutoRefresh` ভেতরে `visibilityState` দেখত ঠিকই, কিন্তু **টাইমার
 *   চলতেই থাকত** — শুধু কাজটি এড়াত। DB-চাপের হিসেবে সেটি যথেষ্ট,
 *   তবু টাইমার বন্ধ থাকলে ব্যাটারি/CPU-ও বাঁচে।
 *
 *   ── এখনকার আচরণ ──
 *   · ট্যাব লুকালে `clearInterval` — কিছুই চলে না
 *   · ট্যাব ফিরলে **সাথে সাথে একবার** চালিয়ে তারপর টাইমার শুরু,
 *     যাতে ফিরে এসে বাসি ব্যালেন্স/নোটিফিকেশন দেখতে না হয়
 *   · `fn` প্রতি রেন্ডারে বদলালেও টাইমার রিসেট হয় না (ref-এ রাখা)
 * ═══════════════════════════════════════════════════════════
 */
export function useVisibleInterval(
  fn: () => void,
  ms: number,
  enabled = true,
): void {
  const saved = useRef(fn);
  useEffect(() => { saved.current = fn; }, [fn]);

  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return;

    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer === null) timer = setInterval(() => saved.current(), ms);
    };
    const stop = () => {
      if (timer !== null) { clearInterval(timer); timer = null; }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        // ★ ফিরে আসার সাথে সাথে একবার — নাহলে পুরো `ms` অপেক্ষা করতে হতো
        saved.current();
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [ms, enabled]);
}
