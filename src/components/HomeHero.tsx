'use client';

import { motion } from 'framer-motion';
import Diamond from '@/components/fx/Diamond';

/**
 * ★ Maison hero — crafted diamond (orbit rings + halo), split-text reveal,
 *   luxury CTA, brand marquee strip।
 */
const MARQUEE = [
  'Instant Delivery', 'bKash · Nagad', '24/7 Live Support',
  'Best Price Guaranteed', 'Secure Payment', 'Trusted by 52,000+',
];

export default function HomeHero({ title, subtitle }: { title: string; subtitle: string }) {
  const w1 = title.split(' ');
  const w2 = subtitle.split(' ');

  return (
    <section className="relative overflow-hidden">
      <div className="relative mx-auto max-w-4xl px-4 pb-8 pt-14 text-center sm:pt-16">
        {/* live tag */}
        <motion.div
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}
          className="inline-flex items-center gap-2.5 rounded-full px-4 py-1.5 text-[11px] font-medium uppercase"
          style={{ letterSpacing: '.14em', color: '#c9cfe4', background: 'var(--glass)', border: '1px solid var(--hair)' }}
        >
          <motion.span className="h-1.5 w-1.5 rounded-full" style={{ background: '#5fe0a6', boxShadow: '0 0 12px #5fe0a6' }}
            animate={{ opacity: [1, 0.35, 1] }} transition={{ duration: 2, repeat: Infinity }} />
          10s Delivery · 24/7 Live
        </motion.div>

        {/* diamond */}
        <motion.div
          initial={{ opacity: 0, scale: 0.6, rotate: -20 }} animate={{ opacity: 1, scale: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 120, damping: 16 }}
          className="relative mx-auto mt-6 grid h-[210px] w-[210px] place-items-center"
          style={{ filter: 'drop-shadow(0 44px 80px rgba(74,63,176,.55))' }}
        >
          <span className="halo-pulse absolute -inset-x-[14%] -inset-y-[24%] -z-10 rounded-full"
            style={{ background: 'radial-gradient(ellipse at 50% 44%,rgba(167,219,255,.32),rgba(154,140,247,.13) 42%,transparent 70%)' }} />
          <span className="spin-slow absolute -inset-[14%] rounded-full" style={{ border: '1px solid rgba(230,197,132,.22)' }} />
          <span className="spin-rev absolute -inset-[26%] rounded-full" style={{ border: '1px dashed rgba(167,219,255,.14)' }} />
          <span className="floaty"><Diamond size={150} dispersion /></span>
        </motion.div>

        {/* split-text headline */}
        <h1 className="dsp mt-4 text-3xl font-medium leading-[1.06] sm:text-5xl md:text-6xl" style={{ letterSpacing: '-.018em' }}>
          <span className="lux-text">
            {w1.map((w, i) => (
              <motion.span key={i} className="inline-block"
                initial={{ opacity: 0, y: 26, rotateX: 40 }} animate={{ opacity: 1, y: 0, rotateX: 0 }}
                transition={{ duration: 0.8, delay: 0.15 + i * 0.09, ease: [0.2, 0.8, 0.2, 1] }}>
                {w}&nbsp;
              </motion.span>
            ))}
          </span>
          <span className="grad-text block font-semibold">
            {w2.map((w, i) => (
              <motion.span key={i} className="inline-block"
                initial={{ opacity: 0, y: 26, rotateX: 40 }} animate={{ opacity: 1, y: 0, rotateX: 0 }}
                transition={{ duration: 0.8, delay: 0.45 + i * 0.09, ease: [0.2, 0.8, 0.2, 1] }}>
                {w}&nbsp;
              </motion.span>
            ))}
          </span>
        </h1>

        <motion.p
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.7 }}
          className="mx-auto mt-5 max-w-lg text-sm font-light leading-[1.75] sm:text-base"
          style={{ color: 'var(--mut)' }}
        >
          শুধু UID দিন — bKash / Nagad এ পেমেন্ট করে সরাসরি অ্যাকাউন্টে ডায়মন্ড। নিরাপদ, দ্রুত, বিশ্বস্ত।
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.85 }}
          className="mt-8 flex flex-wrap justify-center gap-3"
        >
          <motion.a href="#products" whileHover={{ scale: 1.04, y: -3 }} whileTap={{ scale: 0.97 }} className="btn-primary px-8 py-4">
            টপ আপ করুন
          </motion.a>
          <motion.a href="/faq" whileHover={{ scale: 1.04, y: -3 }} whileTap={{ scale: 0.97 }} className="btn-ghost px-8 py-4">
            কিভাবে কাজ করে
          </motion.a>
        </motion.div>
      </div>

      {/* brand marquee */}
      <div className="overflow-hidden py-4" style={{ borderTop: '1px solid var(--hair)', borderBottom: '1px solid var(--hair)', background: 'rgba(255,255,255,.015)' }}>
        <div className="marquee-track dsp text-[11px] uppercase" style={{ letterSpacing: '.24em', color: 'rgba(230,197,132,.55)' }}>
          {[...MARQUEE, ...MARQUEE].map((m, i) => (
            <span key={i} className="px-7">
              {m}<span className="pl-7" style={{ color: 'rgba(167,219,255,.35)' }}>◆</span>
            </span>
          ))}
        </div>
      </div>

      {/* trust counters */}
      <div className="mx-auto flex max-w-4xl flex-wrap items-start justify-center gap-x-12 gap-y-6 px-4 pt-10">
        {[
          { n: '৫২,০০০+', l: 'Orders' },
          { n: '১০', l: 'Sec Delivery' },
          { n: '৯৯%', l: 'Satisfaction' },
          { n: '২৪/৭', l: 'Support' },
        ].map((s, i) => (
          <motion.div key={s.l} initial={{ opacity: 0, y: 14 }} whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }} transition={{ delay: i * 0.08, duration: 0.7 }} className="text-center">
            <div className="dsp text-2xl font-medium sm:text-3xl"
              style={{ background: 'linear-gradient(180deg,#fff,#aab0d2)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', letterSpacing: '-.02em' }}>
              {s.n}
            </div>
            <div className="mt-1.5 text-[10px] uppercase" style={{ letterSpacing: '.16em', color: 'var(--mut)' }}>{s.l}</div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
