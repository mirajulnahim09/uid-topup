'use client';

import { useEffect, useState } from 'react';
import type { CampaignItem } from '@/lib/campaigns';

/**
 * ═══════════════════════════════════════════════════════════
 * ★ NOTICE BAR — চলমান নোটিশ + ব্রেকিং নিউজ (Phase 3)
 *
 *   উৎস (অগ্রাধিকার অপরিবর্তিত, দুটোই অ্যাডমিন-নিয়ন্ত্রিত):
 *     ১. Campaign(NOTICE) — একাধিক বার্তা, kind=WARNING হলে "ব্রেকিং"
 *     ২. নাহলে settings `site_notice` (`fallback`)
 *   দুটোর একটিও না থাকলে কিছুই রেন্ডার হয় না — কোনো বানানো নোটিশ নয়।
 *
 *   ★ চেহারা (২০২৬-০৯-২৫, তিন-রেফারেন্স ব্লুপ্রিন্ট): topupbuzz-এর এক-লাইন
 *     বার — বাঁয়ে স্থির "নোটিশ" পিল, মাঝে চলমান লেখা, ডানে ✕; আর
 *     uidtopup/fristtopup-এর মতো হেডারের ঠিক নিচে, কনটেইনারের ভেতরে,
 *     হিরো থেকে স্পষ্ট আলাদা। আগে campaign ও site_notice দুটি ভিন্ন
 *     চেহারায় আসত (একটি চলমান, অন্যটি স্থির ব্যান্ড) — এখন একটিই।
 *
 *   • সেশন-dismiss: একবার × চাপলে ঐ সেশনে আর দেখায় না (বার্তার স্বাক্ষর ধরে —
 *     অ্যাডমিন নতুন নোটিশ দিলে আবার দেখায়)।
 *   • চলন বিশুদ্ধ CSS (`marquee-track`); reduced-motion-এ গ্লোবাল নিয়ম থামায়।
 *
 *   ⚠️ SSR নিরাপত্তা: dismiss অবস্থা mount এর পর পড়া হয়; প্রথম
 *   রেন্ডার সবসময় দৃশ্যমান (হাইড্রেশন মিসম্যাচ নেই, কনটেন্ট লুকায় না)।
 * ═══════════════════════════════════════════════════════════
 */
export default function NoticeBar({ notices, fallback }: { notices: CampaignItem[]; fallback?: string | null }) {
  const [dismissed, setDismissed] = useState(false);

  const text = (fallback || '').trim();
  // ★ শিরোনামহীন campaign চলমান বারে একটি ফাঁকা বিন্দু হয়ে বসত — বাদ
  const items: { id: string; title: string; badge?: string | null }[] = notices.length > 0
    ? notices
        .filter((n) => (n.title || '').trim())
        .map((n) => ({ id: String(n.id), title: (n.title || '').trim(), badge: n.badge }))
    : text ? [{ id: 'site', title: text }] : [];

  // সেশনে আগে বন্ধ করা হয়েছিল কিনা — কনটেন্টের স্বাক্ষর ধরে
  const sig = notices.length > 0 ? notices.map((n) => n.id).join('-') : `site-${hash(text)}`;
  useEffect(() => {
    try {
      if (sessionStorage.getItem(`volt_notice_${sig}`) === '1') setDismissed(true);
    } catch { /* */ }
  }, [sig]);

  if (items.length === 0 || dismissed) return null;

  /**
   * 🔑 পিলের **লেখার** রঙ `--v-void` (পাতার পটভূমি), পটভূমি accent নিজেই —
   *   ডার্কে void কালো (উজ্জ্বল accent-এর উপর), লাইটে প্রায় সাদা (গাঢ়
   *   accent-এর উপর), তাই বৈপরীত্য দুই থিমেই আপনা-আপনি ঠিক থাকে (C3)।
   */
  const breaking = notices.some((n) => n.kind === 'WARNING');
  const accent = breaking ? 'var(--sem-danger)' : 'var(--sem-info)';
  const tag = breaking ? 'ব্রেকিং' : 'নোটিশ';

  // ⚠️ চলমান বারে প্রতিটি আইটেম **টেক্সট**, লিংক নয়: চলন্ত লিংকে ট্যাপ করা
  //    কঠিন ও ছোট স্পর্শ-লক্ষ্য তৈরি করত। ক্লিকযোগ্য প্রচারণা চাইলে
  //    অ্যাডমিন স্লাইডার/ভাসমান কার্ড ব্যবহার করেন।
  const row = items.map((n) => (
    <span key={n.id} className="inline-flex items-center px-5">
      {n.badge && (
        <span className="mr-2 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase"
          style={{ color: 'var(--v-void)', background: accent }}>
          {n.badge}
        </span>
      )}
      <span style={{ color: 'var(--v-ink)' }}>{n.title}</span>
      <span className="pl-5" aria-hidden="true" style={{ color: accent }}>•</span>
    </span>
  ));

  return (
    <div className="mx-auto max-w-7xl px-4 pt-3 sm:px-6 sm:pt-4">
      <div
        className="relative flex h-[42px] items-center overflow-hidden"
        style={{
          borderRadius: 12,
          background: 'var(--v-pit)',
          border: `1px solid color-mix(in srgb, ${accent} 30%, var(--v-edge))`,
          boxShadow: 'var(--v-shadow-1)',
        }}
        role="status"
        aria-label={tag}
      >
        {/* বাঁ পাশের স্থির পিল */}
        <span className="relative z-10 ml-1 inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[9px] px-2.5 text-[11.5px] font-extrabold"
          style={{ background: accent, color: 'var(--v-void)' }}>
          <span className="relative inline-flex h-1.5 w-1.5" aria-hidden="true">
            <span className="v-blink absolute inline-flex h-full w-full rounded-full" style={{ background: 'var(--v-void)' }} />
          </span>
          {tag}
        </span>

        {/* চলমান লেখা — দুই কপি পাশাপাশি = নিরবচ্ছিন্ন লুপ; দ্বিতীয়টি স্ক্রিন-রিডার থেকে লুকানো */}
        {/* ⚠️ `marquee-viewport` (globals.css): reduced-motion-এ চলন থামে, তখন এই অংশ
            আড়াআড়ি স্ক্রলযোগ্য হয় — নাহলে লম্বা নোটিশের শেষটুকু কারও পড়ার উপায় থাকত না */}
        <div className="marquee-viewport min-w-0 flex-1 text-[12.5px] font-semibold sm:text-[13px]">
          <div className="marquee-track">
            <span className="inline-flex">{row}</span>
            <span className="inline-flex" aria-hidden="true">{row}</span>
          </div>
        </div>

        {/* ডান পাশে বন্ধ */}
        <button
          onClick={() => {
            setDismissed(true);
            try { sessionStorage.setItem(`volt_notice_${sig}`, '1'); } catch { /* */ }
          }}
          aria-label="নোটিশ বন্ধ করুন"
          // ★ ছোঁয়ার এলাকা ৪০×৪০ (প্রকল্পের নিয়ম), দৃশ্যমান বৃত্ত আগের মতোই ৩২px
          className="relative z-10 grid h-10 w-10 shrink-0 place-items-center"
        >
          <span className="grid h-8 w-8 place-items-center rounded-full" style={{ background: 'var(--v-steel)', color: 'var(--v-mut)' }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </span>
        </button>
      </div>
    </div>
  );
}

// ছোট স্থিতিশীল স্বাক্ষর — site_notice বদলালে dismiss-চাবিও বদলায়
function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
