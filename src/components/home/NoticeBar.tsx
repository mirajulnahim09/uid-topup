'use client';

import { useEffect, useState } from 'react';
import type { CampaignItem } from '@/lib/campaigns';

/**
 * ═══════════════════════════════════════════════════════════
 * ★ NOTICE BAR — চলমান নোটিশ + ব্রেকিং নিউজ (Phase 3)
 *
 *   অ্যাডমিন-নিয়ন্ত্রিত Campaign(NOTICE) থেকে চলমান বার্তা।
 *   • kind=WARNING থাকলে → "ব্রেকিং" ধরনের উষ্ণ-লাল বার (জরুরি)
 *   • নাহলে → বরফ-নীল সাধারণ নোটিশ বার
 *   একাধিক নোটিশ পাশাপাশি চলমান (বিশুদ্ধ CSS marquee — প্রতি-ফ্রেমে
 *   JS খরচ নেই)।
 *
 *   • সেশন-dismiss: একবার × চাপলে ঐ সেশনে আর দেখায় না।
 *   • কোনো NOTICE campaign না থাকলে কিছুই রেন্ডার হয় না।
 *
 *   ⚠️ SSR নিরাপত্তা: dismiss অবস্থা mount এর পর পড়া হয়; প্রথম
 *   রেন্ডার সবসময় দৃশ্যমান (হাইড্রেশন মিসম্যাচ নেই, কনটেন্ট লুকায় না)।
 * ═══════════════════════════════════════════════════════════
 */
export default function NoticeBar({ notices }: { notices: CampaignItem[] }) {
  const [dismissed, setDismissed] = useState(false);

  // সেশনে আগে বন্ধ করা হয়েছিল কিনা — কনটেন্টের স্বাক্ষর ধরে
  const sig = notices.map((n) => n.id).join('-');
  useEffect(() => {
    try {
      if (sessionStorage.getItem(`volt_notice_${sig}`) === '1') setDismissed(true);
    } catch { /* */ }
  }, [sig]);

  if (notices.length === 0 || dismissed) return null;

  const breaking = notices.some((n) => n.kind === 'WARNING');
  const accent = breaking ? '#ff8f78' : '#7de3ff';
  const soft = breaking ? 'rgba(255,90,60,.1)' : 'rgba(125,227,255,.08)';
  const edge = breaking ? 'rgba(255,90,60,.28)' : 'rgba(125,227,255,.24)';
  const tag = breaking ? 'ব্রেকিং' : 'নোটিশ';

  // প্রতিটি নোটিশ একটি আইটেম; লিংক থাকলে ক্লিকযোগ্য
  // ⚠️ চলমান বারে প্রতিটি আইটেম **টেক্সট**, লিংক নয়: চলন্ত লিংকে
  //    ট্যাপ করা কঠিন ও ছোট স্পর্শ-লক্ষ্য তৈরি করত। ক্লিকযোগ্য
  //    প্রচারণা চাইলে অ্যাডমিন স্লাইডার/ভাসমান কার্ড ব্যবহার করেন।
  const items = notices.map((n) => (
    <span key={n.id} className="inline-flex items-center px-6">
      {n.badge && (
        <span className="v-hud mr-2 px-1.5 py-0.5 text-[10px] font-bold uppercase"
          style={{ color: '#0a0400', background: accent, borderRadius: 2 }}>
          {n.badge}
        </span>
      )}
      <span style={{ color: 'var(--v-ink)' }}>{n.title}</span>
      <span className="pl-6" aria-hidden="true" style={{ color: accent }}>◆</span>
    </span>
  ));

  return (
    <div
      className="relative overflow-hidden"
      style={{ background: soft, borderBottom: `1px solid ${edge}` }}
      role="status"
    >
      {/* বাঁ পাশের স্থির ট্যাগ */}
      <div
        className="absolute left-0 top-0 z-10 flex h-full min-h-[40px] items-center gap-2 pl-4 pr-6"
        style={{ background: `linear-gradient(90deg, var(--v-void) 64%, transparent)` }}
      >
        {breaking && (
          <span className="v-blink h-1.5 w-1.5 rounded-full" style={{ background: accent, boxShadow: `0 0 8px ${accent}` }} aria-hidden="true" />
        )}
        <span className="v-hud text-[11px] font-bold uppercase tracking-wide" style={{ color: accent }}>{tag}</span>
      </div>

      <div className="v-hud py-2.5 text-[12.5px] font-semibold">
        <div className="marquee-track">
          {items}
          {items /* দ্বিগুণ — নিরবচ্ছিন্ন লুপ */}
        </div>
      </div>

      {/* ডান পাশে বন্ধ */}
      <button
        onClick={() => {
          setDismissed(true);
          try { sessionStorage.setItem(`volt_notice_${sig}`, '1'); } catch { /* */ }
        }}
        aria-label="নোটিশ বন্ধ করুন"
        className="absolute right-0 top-0 z-10 grid h-full w-10 min-h-[40px] place-items-center"
        style={{ background: `linear-gradient(270deg, var(--v-void) 55%, transparent)`, color: 'var(--v-mut)' }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M18 6L6 18M6 6l12 12" /></svg>
      </button>
    </div>
  );
}
