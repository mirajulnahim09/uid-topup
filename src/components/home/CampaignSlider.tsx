'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { CampaignItem } from '@/lib/campaigns';
import { themeFor } from './campaignTheme';
import Countdown from './Countdown';
import Icon from '@/components/fx/Icon';

/**
 * ═══════════════════════════════════════════════════════════
 * ★ CAMPAIGN SLIDER — প্রচারণা স্লাইডার (Phase 3)
 *
 *   অ্যাডমিন-নিয়ন্ত্রিত Campaign(SLIDER)। প্রতিটি স্লাইড:
 *   ছবি (থাকলে) / kind-থিম পটভূমি + ব্যাজ + শিরোনাম + বিবরণ +
 *   CTA + countdown (endsAt থাকলে — ফ্ল্যাশ সেল/সিজনাল প্রচারণা)।
 *
 *   • অটো-অ্যাডভান্স (hover/focus এ থামে), তীর, ডট, সোয়াইপ, ♿ arrow-key
 *   • Framer AnimatePresence — মসৃণ স্লাইড ট্রানজিশন
 *   • endsAt = ফ্ল্যাশ/সিজনাল, startsAt = সার্ভারেই সময়সূচি-ফিল্টার্ড
 *   • কোনো SLIDER campaign না থাকলে কিছুই রেন্ডার হয় না
 * ═══════════════════════════════════════════════════════════
 */
export default function CampaignSlider({ slides }: { slides: CampaignItem[] }) {
  const [i, setI] = useState(0);
  const [dir, setDir] = useState(1);
  const [paused, setPaused] = useState(false);
  const touchX = useRef<number | null>(null);
  const n = slides.length;

  const go = useCallback((d: 1 | -1) => { setDir(d); setI((v) => (v + d + n) % n); }, [n]);

  useEffect(() => {
    if (n <= 1 || paused) return;
    const t = setInterval(() => go(1), 5500);
    return () => clearInterval(t);
  }, [n, paused, go]);

  useEffect(() => {
    if (n <= 1) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'ArrowLeft') go(-1); if (e.key === 'ArrowRight') go(1); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [n, go]);

  if (n === 0) return null;
  const s = slides[i];
  const th = themeFor(s.kind);
  const flash = (s.kind === 'OFFER' || s.kind === 'COUPON') && !!s.endsAt;

  return (
    <section
      aria-roledescription="carousel" aria-label="প্রচারণা"
      className="v-panel relative overflow-hidden"
      style={{ ['--nc' as string]: '16px', ['--panel-fill' as string]: 'var(--v-steel)', ['--panel-edge' as string]: th.edge }}
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}
      onTouchStart={(e) => { touchX.current = e.touches[0].clientX; }}
      onTouchEnd={(e) => {
        if (touchX.current === null) return;
        const dx = e.changedTouches[0].clientX - touchX.current;
        if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
        touchX.current = null;
      }}
    >
      <div className="relative aspect-[21/9] sm:aspect-[24/7]" role="group" aria-label={`${i + 1} / ${n}`}>
        <AnimatePresence initial={false} custom={dir} mode="popLayout">
          <motion.div
            key={s.id}
            custom={dir}
            initial={{ x: dir * 60, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: dir * -60, opacity: 0 }}
            transition={{ duration: 0.45, ease: [0.2, 0.8, 0.2, 1] }}
            className="absolute inset-0"
          >
            {/* পটভূমি: ছবি বা থিম-গ্রেডিয়েন্ট */}
            {s.imageUrl ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.imageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
                <span className="absolute inset-0" style={{ background: 'linear-gradient(90deg, rgba(6,8,14,.92), rgba(6,8,14,.35) 60%, transparent)' }} />
              </>
            ) : (
              <span className="absolute inset-0" style={{ background: `radial-gradient(ellipse at 82% 40%, ${th.soft}, transparent 60%), linear-gradient(120deg,#6d28d9,#4c1d95)` }} />
            )}

            {/* কনটেন্ট */}
            <div className="relative flex h-full flex-col justify-center gap-3 p-5 sm:p-8 lg:max-w-[62%]">
              <span className="v-hud inline-flex w-fit items-center gap-1.5 px-2.5 py-1 text-[10px] font-bold uppercase"
                style={{ color: th.accent, background: th.soft, border: `1px solid ${th.edge}`, borderRadius: 3 }}>
                <Icon name={th.icon} size={12} />
                {flash ? 'ফ্ল্যাশ সেল' : (s.badge || th.label)}
              </span>
              {s.title && (
                <p className="v-dsp text-xl font-extrabold leading-tight sm:text-3xl" style={{ color: 'var(--v-ink)' }}>{s.title}</p>
              )}
              {s.subtitle && (
                <p className="max-w-lg text-[13px] leading-relaxed sm:text-[15px]" style={{ color: 'var(--v-mut)' }}>{s.subtitle}</p>
              )}
              {s.endsAt && <Countdown to={s.endsAt} className="mt-1" />}
              {s.ctaLink && (
                <Link href={s.ctaLink} className="v-btn v-btn--volt mt-1 w-fit px-6"
                  style={th.accent !== '#c8ff3d' ? { ['--panel-fill' as string]: `linear-gradient(135deg, ${th.accent}, ${th.accent})`, color: '#0a1400' } : undefined}>
                  {s.ctaLabel || 'দেখুন'}
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" aria-hidden="true"><path d="M5 12h13M12 5l7 7-7 7" /></svg>
                </Link>
              )}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      {n > 1 && (
        <>
          <button onClick={() => go(-1)} aria-label="আগের" className="absolute left-3 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center"
            style={{ background: 'rgba(6,8,14,.6)', border: '1px solid var(--v-edge2)', borderRadius: 3, color: 'var(--v-ink)' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          <button onClick={() => go(1)} aria-label="পরের" className="absolute right-3 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center"
            style={{ background: 'rgba(6,8,14,.6)', border: '1px solid var(--v-edge2)', borderRadius: 3, color: 'var(--v-ink)' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 18l6-6-6-6" /></svg>
          </button>
          <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1.5">
            {slides.map((sl, idx) => (
              <button key={sl.id} onClick={() => { setDir(idx > i ? 1 : -1); setI(idx); }} aria-label={`স্লাইড ${idx + 1}`} aria-current={idx === i}
                data-dot="1" className="grid h-6 min-w-[24px] place-items-center px-2">
                <span className="block h-1.5 rounded-full transition-all" style={{ width: idx === i ? 22 : 6, background: idx === i ? th.accent : 'rgba(255,255,255,.28)' }} />
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
