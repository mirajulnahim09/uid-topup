'use client';

import { motion } from 'framer-motion';
import { useRef } from 'react';

/**
 * ★ হোমপেজ hero — 3D faceted ডায়মন্ড, gradient shine টাইটেল,
 *   magnetic CTA, animated counter। preview অনুযায়ী।
 */
export default function HomeHero({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <section className="relative overflow-hidden">
      <style>{`
        .hh-stage{width:180px;height:180px;margin:6px auto;position:relative;perspective:700px}
        .hh-rays{position:absolute;inset:-40px;border-radius:50%;filter:blur(2px);animation:hh-spin 8s linear infinite;
          background:conic-gradient(from 0deg,transparent,rgba(34,224,238,.22),transparent 25%,rgba(255,45,120,.22),transparent 50%,rgba(255,207,90,.22),transparent 75%,rgba(139,92,246,.22),transparent)}
        .hh-glow{position:absolute;inset:20px;border-radius:50%;filter:blur(8px);animation:hh-pul 2.6s ease-in-out infinite;
          background:radial-gradient(circle,rgba(34,224,238,.5),transparent 65%)}
        .hh-gem{position:absolute;inset:0;transform-style:preserve-3d;animation:hh-gemrot 7s linear infinite}
        .hh-gem i{position:absolute;left:50%;top:50%;width:60px;height:88px;margin:-44px 0 0 -30px;
          clip-path:polygon(50% 0,100% 32%,50% 100%,0 32%);opacity:.92;backface-visibility:hidden;box-shadow:0 0 26px rgba(34,224,238,.7)}
        .hh-gem i:nth-child(1){transform:rotateY(0) translateZ(30px);background:linear-gradient(160deg,#bff9ff,#22e0ee 30%,#8b5cf6 70%,#ff2d78)}
        .hh-gem i:nth-child(2){transform:rotateY(72deg) translateZ(30px);background:linear-gradient(160deg,#ffe6a0,#ffcf5a 30%,#ff6b2c 75%,#ff2d78)}
        .hh-gem i:nth-child(3){transform:rotateY(144deg) translateZ(30px);background:linear-gradient(160deg,#d9c6ff,#8b5cf6 30%,#ff2d78 75%,#22e0ee)}
        .hh-gem i:nth-child(4){transform:rotateY(216deg) translateZ(30px);background:linear-gradient(160deg,#bff9ff,#22e0ee 30%,#8b5cf6 75%,#ffcf5a)}
        .hh-gem i:nth-child(5){transform:rotateY(288deg) translateZ(30px);background:linear-gradient(160deg,#ffd0e4,#ff2d78 30%,#ff6b2c 75%,#ffcf5a)}
        .hh-orb{position:absolute;inset:-30px;animation:hh-spin 5s linear infinite reverse}
        .hh-orb b{position:absolute;top:0;left:50%;font-size:16px;filter:drop-shadow(0 0 8px #ffcf5a)}
        @keyframes hh-spin{to{transform:rotate(360deg)}}
        @keyframes hh-gemrot{to{transform:rotateY(360deg)}}
        @keyframes hh-pul{0%,100%{transform:scale(.9);opacity:.6}50%{transform:scale(1.15);opacity:1}}
        @media(prefers-reduced-motion:reduce){.hh-rays,.hh-glow,.hh-gem,.hh-orb{animation:none!important}}
      `}</style>

      <div className="relative mx-auto max-w-4xl px-4 py-14 text-center sm:py-16">
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="mb-2 inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-semibold"
          style={{ color: '#c9ffe0', background: 'rgba(34,224,238,.1)', border: '1px solid rgba(34,224,238,.3)' }}
        >
          <motion.span
            className="h-2 w-2 rounded-full"
            style={{ background: '#22ee9a' }}
            animate={{ scale: [1, 1.4, 1], opacity: [1, 0.6, 1] }}
            transition={{ duration: 1.6, repeat: Infinity }}
          />
          ১০ সেকেন্ডে ডেলিভারি · ২৪/৭ লাইভ
        </motion.div>

        {/* 3D diamond */}
        <motion.div
          initial={{ opacity: 0, scale: 0.7 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', stiffness: 160, damping: 14 }}
          className="hh-stage"
          aria-hidden="true"
        >
          <div className="hh-rays" />
          <div className="hh-glow" />
          <div className="hh-orb"><b>💎</b></div>
          <div className="hh-gem"><i /><i /><i /><i /><i /></div>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.15 }}
          className="mx-auto mt-2 max-w-3xl text-3xl font-black leading-tight sm:text-5xl"
        >
          {title}
          <span className="grad-text mt-2 block">{subtitle}</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.28 }}
          className="mx-auto mt-5 max-w-xl text-sm sm:text-base"
          style={{ color: 'var(--mut)' }}
        >
          শুধু UID দিন — bKash / Nagad দিয়ে পেমেন্ট করে সরাসরি অ্যাকাউন্টে ডায়মন্ড নিন।
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.4 }}
          className="mt-8 flex flex-wrap justify-center gap-3"
        >
          <motion.a href="#products" whileHover={{ scale: 1.06, y: -3 }} whileTap={{ scale: 0.96 }}
            className="btn-primary glow-pulse px-8 py-3.5 text-base font-bold">
            ⚡ এখনই টপ আপ করুন
          </motion.a>
          <motion.a href="/faq" whileHover={{ scale: 1.06, y: -3 }} whileTap={{ scale: 0.96 }}
            className="btn-ghost px-8 py-3.5 text-base">
            কিভাবে কাজ করে?
          </motion.a>
        </motion.div>

        {/* trust counters */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.55 }}
          className="mt-10 flex flex-wrap items-center justify-center gap-3"
        >
          {[
            { n: '৫২,০০০+', l: 'সফল অর্ডার' },
            { n: '১০ সেকেন্ড', l: 'ডেলিভারি' },
            { n: '৯৯%', l: 'সন্তুষ্ট গ্রাহক' },
          ].map((s, i) => (
            <motion.div
              key={s.l}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.55 + i * 0.1 }}
              className="card min-w-[140px] px-6 py-4"
            >
              <div className="eng text-2xl font-bold" style={{ background: 'linear-gradient(135deg,#22e0ee,#8b5cf6)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>{s.n}</div>
              <div className="mt-0.5 text-xs" style={{ color: 'var(--mut)' }}>{s.l}</div>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
