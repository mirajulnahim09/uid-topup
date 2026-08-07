'use client';

import { useEffect, useState } from 'react';

/**
 * ★ Countdown — প্রচারণার শেষ সময় পর্যন্ত সৎ পাল্টা-গণনা (Phase 3)
 *
 *   কার্যকারিতা: campaign.endsAt পর্যন্ত বাকি সময় দেখায়, প্রতি সেকেন্ডে
 *   হালনাগাদ। ফুরিয়ে গেলে কিছুই দেখায় না (onExpire ডাকতে পারে)।
 *
 *   ⚠️ সৎ: এটি প্রকৃত endsAt থেকে হিসাব — কোনো বানানো "সীমিত সময়"
 *   নয়। অ্যাডমিন যে সময় দিয়েছে ঠিক তা-ই গোনা হয়।
 *   ⚠️ SSR নিরাপদ: প্রথম রেন্ডারে null, mount এর পর গণনা শুরু —
 *   তাই সার্ভার/ক্লায়েন্ট মিসম্যাচ হয় না।
 */
function parts(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return {
    d: Math.floor(s / 86400),
    h: Math.floor((s % 86400) / 3600),
    m: Math.floor((s % 3600) / 60),
    s: s % 60,
  };
}
const bn = (n: number) => String(n).padStart(2, '0').replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[Number(d)]);

export default function Countdown({
  to,
  compact = false,
  className = '',
  style,
}: {
  to: string;
  compact?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    const end = Date.parse(to);
    if (Number.isNaN(end)) return;
    const tick = () => setLeft(end - Date.now());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [to]);

  if (left === null || left <= 0) return null;
  const p = parts(left);

  const cells: [number, string][] = [
    [p.d, 'দিন'],
    [p.h, 'ঘণ্টা'],
    [p.m, 'মিনিট'],
    [p.s, 'সেকেন্ড'],
  ].filter(([, lbl], i) => !(i === 0 && p.d === 0)) as [number, string][]; // দিন ০ হলে বাদ

  if (compact) {
    return (
      <span className={`v-hud font-bold tabular-nums ${className}`} style={style}>
        {cells.map(([n], i) => (
          <span key={i}>
            {bn(n)}
            {i < cells.length - 1 ? ':' : ''}
          </span>
        ))}
      </span>
    );
  }

  return (
    <div className={`flex gap-1.5 ${className}`} style={style} aria-label="বাকি সময়">
      {cells.map(([n, lbl], i) => (
        <div
          key={i}
          className="v-hud flex min-w-[46px] flex-col items-center px-2 py-1.5"
          style={{ background: 'rgba(255,255,255,.05)', border: '1px solid var(--v-edge2)', borderRadius: 3 }}
        >
          <span className="text-lg font-bold tabular-nums" style={{ color: 'var(--v-ink)' }}>{bn(n)}</span>
          <span className="text-[9px]" style={{ color: 'var(--v-mut)' }}>{lbl}</span>
        </div>
      ))}
    </div>
  );
}
