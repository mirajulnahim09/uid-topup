'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { CampaignItem } from '@/lib/campaigns';
import { themeFor } from './campaignTheme';
import Countdown from './Countdown';
import Icon from '@/components/fx/Icon';

/**
 * ═══════════════════════════════════════════════════════════
 * ★ FLOATING CARD — ভাসমান ঘোষণা কার্ড (Phase 3)
 *
 *   অ্যাডমিন-নিয়ন্ত্রিত Campaign(FLOAT)। পর্দার নিচ-বাঁ কোণে একটি
 *   ছোট কার্ড ভেসে ওঠে (কিছুক্ষণ পর), kind অনুযায়ী থিম, CTA ও
 *   ঐচ্ছিক countdown সহ। বন্ধ করা যায়, বন্ধ করা মনে রাখা হয়।
 *
 *   • মোবাইলে বটম-ট্যাব বারের উপরে, নিরাপদ দূরত্বে
 *   • একবারে একটি (অগ্রাধিকার ক্রমে প্রথম না-বন্ধ করা কার্ড)
 *   • কোনো FLOAT campaign না থাকলে কিছুই দেখায় না
 * ═══════════════════════════════════════════════════════════
 */
export default function FloatingCard({ cards }: { cards: CampaignItem[] }) {
  const [active, setActive] = useState<CampaignItem | null>(null);

  useEffect(() => {
    let seen: string[] = [];
    try { seen = JSON.parse(localStorage.getItem('volt_float_seen') || '[]'); } catch { /* */ }
    const next = cards.find((c) => !seen.includes(String(c.id)));
    if (!next) return;
    const t = setTimeout(() => setActive(next), 2200);
    return () => clearTimeout(t);
  }, [cards]);

  function close() {
    if (active) {
      try {
        const seen: string[] = JSON.parse(localStorage.getItem('volt_float_seen') || '[]');
        seen.push(String(active.id));
        localStorage.setItem('volt_float_seen', JSON.stringify(seen));
      } catch { /* */ }
    }
    setActive(null);
  }

  const th = active ? themeFor(active.kind) : null;

  return (
    <AnimatePresence>
      {active && th && (
        <motion.div
          className="fixed bottom-[72px] left-3 z-[90] w-[calc(100%-1.5rem)] max-w-[340px] sm:bottom-5 sm:left-5"
          initial={{ opacity: 0, y: 24, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.96 }}
          transition={{ type: 'spring', stiffness: 320, damping: 26 }}
          role="complementary"
          aria-label={active.title || th.label}
        >
          <div
            className="v-panel relative overflow-hidden p-4 pr-11"
            style={{ ['--nc' as string]: '12px', ['--panel-edge' as string]: th.edge, ['--panel-fill' as string]: 'var(--v-steel)' }}
          >
            <button onClick={close} aria-label="বন্ধ করুন"
              className="absolute right-1 top-1 grid h-10 w-10 place-items-center" style={{ color: 'var(--v-mut)' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M18 6L6 18M6 6l12 12" /></svg>
            </button>

            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center"
                style={{ background: th.soft, border: `1px solid ${th.edge}`, borderRadius: 3, color: th.accent }}>
                <Icon name={th.icon} size={20} />
              </span>
              <div className="min-w-0">
                <p className="v-dsp text-sm font-extrabold leading-snug" style={{ color: 'var(--v-ink)' }}>
                  {active.title || th.label}
                </p>
                {active.subtitle && (
                  <p className="mt-1 text-[12.5px] leading-snug" style={{ color: 'var(--v-mut)' }}>{active.subtitle}</p>
                )}
                {active.endsAt && <Countdown to={active.endsAt} compact className="mt-1.5 block" style={{ color: th.accent }} />}
                {active.ctaLink && (
                  <Link href={active.ctaLink} onClick={close}
                    className="v-hud mt-2 inline-flex min-h-[24px] items-center gap-1 text-[12px] font-bold hover:underline"
                    style={{ color: th.accent }}>
                    {active.ctaLabel || 'দেখুন'}
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8"><path d="M5 12h13M12 5l7 7-7 7" /></svg>
                  </Link>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
