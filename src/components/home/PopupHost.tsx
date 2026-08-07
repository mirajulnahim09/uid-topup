'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import type { CampaignItem } from '@/lib/campaigns';
import { themeFor } from './campaignTheme';
import Countdown from './Countdown';
import Icon from '@/components/fx/Icon';

/**
 * ═══════════════════════════════════════════════════════════
 * ★ POPUP HOST — প্রবেশ পপআপ ব্যবস্থা (Phase 3)
 *
 *   অ্যাডমিন-নিয়ন্ত্রিত Campaign(POPUP) থেকে একটি পপআপ দেখায় —
 *   অফার/গিভঅ্যাওয়ে/কুপন/টুর্নামেন্ট/ইভেন্ট/maintenance, সবই একই
 *   কম্পোনেন্ট, kind অনুযায়ী থিম।
 *
 *   পপআপ নিয়ম (সব বাস্তবায়িত):
 *   • সুন্দর প্রবেশ ও প্রস্থান অ্যানিমেশন (Framer AnimatePresence)
 *   • frequency নিয়ন্ত্রণ — once / session / always (অ্যাডমিন-সেট)
 *   • close বোতাম (dismissible হলে) + Esc + backdrop-ক্লিক
 *   • dismiss মনে রাখা (localStorage/sessionStorage)
 *   • মোবাইলে বটম-শিট, ডেস্কটপে কেন্দ্রীভূত কার্ড
 *
 *   ⚠️ কিছু হার্ডকোড নয় — কোনো POPUP campaign না থাকলে কিছুই
 *   দেখায় না। যা দেখায় তার পুরোটাই অ্যাডমিনের বসানো।
 *
 *   ⚠️ SSR নিরাপদ: প্রথমে কিছু রেন্ডার হয় না; mount + সামান্য
 *   বিলম্বের পর যোগ্য পপআপ ভেসে ওঠে (হাইড্রেশন মিসম্যাচ নেই,
 *   আর তাৎক্ষণিক ঝাঁপিয়ে পড়া বিরক্তিকর হয় না)।
 * ═══════════════════════════════════════════════════════════
 */

function isSeen(c: CampaignItem): boolean {
  if (typeof window === 'undefined') return true;
  try {
    if (c.frequency === 'always') return false;
    if (c.frequency === 'session') return sessionStorage.getItem(`volt_pop_s_${c.id}`) === '1';
    // once (ডিফল্ট) — স্থায়ীভাবে মনে রাখা
    return localStorage.getItem(`volt_pop_${c.id}`) === '1';
  } catch {
    return false;
  }
}

function markSeen(c: CampaignItem) {
  try {
    if (c.frequency === 'session') sessionStorage.setItem(`volt_pop_s_${c.id}`, '1');
    else if (c.frequency !== 'always') localStorage.setItem(`volt_pop_${c.id}`, '1');
  } catch { /* storage unavailable — নীরব */ }
}

export default function PopupHost({ popups }: { popups: CampaignItem[] }) {
  const [active, setActive] = useState<CampaignItem | null>(null);

  useEffect(() => {
    // প্রথম যোগ্য (না-দেখা) পপআপ — অগ্রাধিকার ক্রমেই আসে
    const next = popups.find((p) => !isSeen(p));
    if (!next) return;
    const t = setTimeout(() => setActive(next), 850);
    return () => clearTimeout(t);
  }, [popups]);

  // Esc + scroll-lock
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && active.dismissible) close(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  function close() {
    if (active) markSeen(active);
    setActive(null);
  }

  const th = active ? themeFor(active.kind) : null;

  return (
    <AnimatePresence>
      {active && th && (
        <motion.div
          className="fixed inset-0 z-[120] flex items-end justify-center sm:items-center"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          role="dialog" aria-modal="true"
          aria-label={active.title || th.label}
        >
          {/* backdrop */}
          <div
            className="absolute inset-0"
            style={{ background: 'rgba(3,4,8,.72)', backdropFilter: 'blur(4px)' }}
            onClick={() => active.dismissible && close()}
          />

          {/* card — মোবাইলে বটম-শিট, ডেস্কটপে কেন্দ্রীভূত */}
          <motion.div
            className="v-panel relative w-full max-w-[440px] overflow-hidden"
            style={{
              ['--nc' as string]: '18px',
              ['--panel-edge' as string]: th.edge,
              ['--panel-fill' as string]: 'var(--v-steel)',
            }}
            initial={{ y: 40, scale: 0.94, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: 30, scale: 0.96, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
          >
            {/* উপরের অ্যাকসেন্ট আভা */}
            <span className="pointer-events-none absolute inset-x-0 top-0 h-24"
              style={{ background: `radial-gradient(ellipse at 50% 0, ${th.soft}, transparent 70%)` }} aria-hidden="true" />

            {/* close */}
            {active.dismissible && (
              <button
                onClick={close}
                aria-label="বন্ধ করুন"
                className="absolute right-3 top-3 z-10 grid h-10 w-10 place-items-center"
                style={{ background: 'var(--v-void)', border: '1px solid var(--v-edge)', borderRadius: 8, color: 'var(--v-mut)' }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            )}

            {/* image (থাকলে) */}
            {active.imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={active.imageUrl} alt="" className="h-40 w-full object-cover" />
            )}

            <div className="relative p-6 sm:p-7">
              {/* kind ব্যাজ */}
              <span
                className="v-hud inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold uppercase"
                style={{ color: th.accent, background: th.soft, border: `1px solid ${th.edge}`, borderRadius: 3 }}
              >
                <Icon name={th.icon} size={13} />
                {active.badge || th.label}
              </span>

              <h2 className="v-dsp mt-4 text-2xl font-extrabold leading-tight" style={{ color: 'var(--v-ink)' }}>
                {active.title || th.label}
              </h2>
              {active.subtitle && (
                <p className="mt-2.5 text-[14.5px] leading-[1.75]" style={{ color: 'var(--v-mut)' }}>
                  {active.subtitle}
                </p>
              )}

              {active.endsAt && (
                <div className="mt-5">
                  <p className="hud hud-mut mb-2">শেষ হতে বাকি</p>
                  <Countdown to={active.endsAt} />
                </div>
              )}

              <div className="mt-6 flex flex-col gap-2.5 sm:flex-row">
                {active.ctaLink && (
                  <a
                    href={active.ctaLink}
                    onClick={close}
                    className="v-btn v-btn--volt flex-1"
                    style={th.accent !== '#c8ff3d' ? { ['--panel-fill' as string]: `linear-gradient(135deg, ${th.accent}, ${th.accent})`, color: '#0a1400' } : undefined}
                  >
                    {active.ctaLabel || 'দেখুন'}
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" aria-hidden="true"><path d="M5 12h13M12 5l7 7-7 7" /></svg>
                  </a>
                )}
                {active.dismissible && (
                  <button onClick={close} className="v-btn v-btn--ghost sm:w-auto">পরে</button>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
