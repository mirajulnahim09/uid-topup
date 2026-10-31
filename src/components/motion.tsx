'use client';

import { motion, AnimatePresence, type Variants } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';

/* ═══════════ শেয়ার্ড ভ্যারিয়েন্ট ═══════════ */

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] } },
};

export const stagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.04, delayChildren: 0.05 } },
};

export const popIn: Variants = {
  hidden: { opacity: 0, scale: 0.94 },
  show: { opacity: 1, scale: 1, transition: { duration: 0.2, ease: 'easeOut' } },
};

/** গ্রিড / লিস্ট — একটার পর একটা ফুটে ওঠে */
export function Stagger({
  children, className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      variants={stagger}
      initial="hidden"
      animate="show"
      className={className}
    >
      {children}
    </motion.div>
  );
}

/** স্ক্রলে এলে ফুটে ওঠে (একবারই) */
export function Reveal({
  children, className, delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.45, delay, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/* ═══════════ সংখ্যা গোনা ═══════════ */

/**
 * ★ দাম বদলালে সংখ্যা গড়িয়ে যায় — ঝট করে বদলায় না।
 *   কেনাকাটার সাইটে এটা খুব তৃপ্তিদায়ক লাগে।
 */
export function CountUp({
  value, prefix = '', decimals = 2, className,
}: {
  value: number;
  prefix?: string;
  decimals?: number;
  className?: string;
}) {
  const [display, setDisplay] = useState(value);
  const raf = useRef<number | undefined>(undefined);
  const from = useRef(value);

  useEffect(() => {
    const start = performance.now();
    const dur = 420;
    const a = from.current;
    const b = value;

    if (a === b) return;

    function tick(now: number) {
      const t = Math.min(1, (now - start) / dur);
      // easeOutCubic
      const e = 1 - Math.pow(1 - t, 3);
      setDisplay(a + (b - a) * e);
      if (t < 1) raf.current = requestAnimationFrame(tick);
      else from.current = b;
    }

    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [value]);

  return (
    <span className={className}>
      {prefix}
      {display.toFixed(decimals)}
    </span>
  );
}

/* ═══════════ সফল হওয়ার সেলিব্রেশন ═══════════ */

/** ★ অর্ডার সফল হলে টিক মার্ক আঁকা হয় + রিং ছড়ায় */
export function SuccessBurst({ show }: { show: boolean }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="pointer-events-none fixed inset-0 z-[120] grid place-items-center"
        >
          <motion.div
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 1.15, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 18 }}
            className="relative grid h-28 w-28 place-items-center rounded-full bg-emerald-500 shadow-2xl shadow-emerald-300"
          >
            {/* ছড়িয়ে পড়া রিং */}
            <motion.span
              initial={{ scale: 1, opacity: 0.6 }}
              animate={{ scale: 1.9, opacity: 0 }}
              transition={{ duration: 0.9, ease: 'easeOut' }}
              className="absolute inset-0 rounded-full border-4 border-emerald-400"
            />

            {/* টিক — আঁকা হয় */}
            <svg width="52" height="52" viewBox="0 0 52 52" fill="none" aria-hidden="true">
              <motion.path
                d="M14 27l8 8 16-18"
                stroke="white"
                strokeWidth="5"
                strokeLinecap="round"
                strokeLinejoin="round"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.35, delay: 0.12, ease: 'easeOut' }}
              />
            </svg>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export { motion, AnimatePresence };
