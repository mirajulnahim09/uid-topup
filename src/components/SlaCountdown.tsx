'use client';

import { useEffect, useState } from 'react';

/**
 * ═══════════════════════════════════════════════════════════
 * ★ ডেলিভারির বাকি সময় — জীবন্ত কাউন্টডাউন
 *
 *   কেন: অনির্দিষ্ট স্পিনারের চেয়ে "আর ২৩ মিনিট" অনেক বেশি
 *   আশ্বস্ত করে। গ্রাহক জানে কখন অভিযোগ করা যৌক্তিক।
 *
 *   ★ সময় পেরিয়ে গেলে লুকানো হয় না — বরং সাইট নিজেই আগে
 *     স্বীকার করে ("দেরি হচ্ছে, দুঃখিত")। গ্রাহকের কাছে ধরা
 *     পড়ার চেয়ে নিজে বলা অনেক ভালো।
 * ═══════════════════════════════════════════════════════════
 */
export default function SlaCountdown({
  dueAt,
  className = '',
}: {
  /** ISO string — সার্ভার থেকে আসে */
  dueAt: string;
  className?: string;
}) {
  // ★ SSR ও প্রথম রেন্ডারে একই আউটপুট দরকার (hydration mismatch এড়াতে),
  //   তাই প্রকৃত সময় mount এর পর সেট হয়
  const [remainingMs, setRemainingMs] = useState<number | null>(null);

  useEffect(() => {
    const due = new Date(dueAt).getTime();
    if (!Number.isFinite(due)) return;

    const tick = () => setRemainingMs(due - Date.now());
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [dueAt]);

  if (remainingMs === null) {
    return (
      <span className={className} style={{ color: 'var(--mut)' }}>
        সময় হিসাব হচ্ছে…
      </span>
    );
  }

  const late = remainingMs <= 0;
  const totalSec = Math.floor(Math.abs(remainingMs) / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;

  const parts = h > 0 ? `${h} ঘন্টা ${m} মিনিট` : m > 0 ? `${m} মিনিট ${s} সেকেন্ড` : `${s} সেকেন্ড`;

  if (late) {
    return (
      <span
        className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-semibold ${className}`}
        style={{
          background: 'rgba(242,168,196,.10)',
          border: '1px solid rgba(242,168,196,.35)',
          color: 'var(--red)',
        }}
        role="status"
      >
        <span aria-hidden="true">⏰</span>
        <span>
          প্রতিশ্রুত সময়ের চেয়ে {parts} দেরি হয়ে গেছে — দুঃখিত, আমরা দেখছি
        </span>
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-semibold ${className}`}
      style={{
        background: 'rgba(230,197,132,.08)',
        border: '1px solid var(--hair)',
        color: 'var(--ink)',
      }}
      role="status"
      aria-live="off"
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: 'var(--gold)' }}
        aria-hidden="true"
      />
      <span>
        ডেলিভারির বাকি{' '}
        <span className="tabular-nums" style={{ color: 'var(--gold)' }}>
          {parts}
        </span>
      </span>
    </span>
  );
}
