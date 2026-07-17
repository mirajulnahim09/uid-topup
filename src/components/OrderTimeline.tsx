'use client';

import { motion } from 'framer-motion';
import { fmtDate } from '@/lib/date';

/**
 * ★ অর্ডার কোথায় আছে — ধাপে ধাপে দেখায়।
 *   কাস্টমার বারবার জিজ্ঞেস করবে না "আমার অর্ডার কী হলো?"
 */
export default function OrderTimeline({
  status, createdAt, completedAt,
}: {
  status: string;
  createdAt: string;
  completedAt: string | null;
}) {
  const failed = status === 'REFUNDED' || status === 'FAILED';
  const done = status === 'COMPLETED';
  const processing = status === 'PROCESSING';

  const steps = [
    {
      label: 'অর্ডার গ্রহণ',
      sub: fmtDate(createdAt),
      state: 'done' as const,
    },
    {
      label: 'প্রসেস করা হচ্ছে',
      sub: done || processing || failed ? 'অ্যাডমিন দেখছে' : 'অপেক্ষায়',
      state: (done || processing || failed ? 'done' : 'wait') as 'done' | 'wait',
    },
    failed
      ? {
          label: 'বাতিল — টাকা ফেরত',
          sub: completedAt ? fmtDate(completedAt) : '',
          state: 'failed' as const,
        }
      : {
          label: 'ডেলিভারি সম্পন্ন',
          sub: done && completedAt ? fmtDate(completedAt) : 'অপেক্ষায়',
          state: (done ? 'done' : 'wait') as 'done' | 'wait',
        },
  ];

  return (
    <section className="card p-5">
      <ol className="relative space-y-6">
        {steps.map((s, i) => {
          const isLast = i === steps.length - 1;
          const color =
            s.state === 'done'
              ? 'bg-emerald-500'
              : s.state === 'failed'
              ? 'bg-red-500'
              : 'bg-slate-200';

          return (
            <li key={s.label} className="relative flex gap-4">
              {/* সংযোগ রেখা */}
              {!isLast && (
                <span
                  className="absolute left-[15px] top-8 h-full w-0.5 bg-slate-200"
                  aria-hidden="true"
                >
                  {s.state === 'done' && (
                    <motion.span
                      className="block w-full bg-emerald-500"
                      initial={{ height: 0 }}
                      animate={{ height: '100%' }}
                      transition={{ duration: 0.4, delay: i * 0.15 + 0.2 }}
                    />
                  )}
                </span>
              )}

              {/* বৃত্ত */}
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 300, damping: 20, delay: i * 0.15 }}
                className={`relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-bold text-white ${color}`}
              >
                {s.state === 'done' ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5">
                    <motion.path
                      d="M20 6L9 17l-5-5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      initial={{ pathLength: 0 }}
                      animate={{ pathLength: 1 }}
                      transition={{ duration: 0.3, delay: i * 0.15 + 0.15 }}
                    />
                  </svg>
                ) : s.state === 'failed' ? (
                  '✕'
                ) : (
                  <span className="h-2 w-2 rounded-full bg-slate-400" />
                )}

                {/* চলমান ধাপে ধুকধুক */}
                {s.state === 'wait' && i === 1 && (
                  <motion.span
                    className="absolute inset-0 rounded-full border-2 border-amber-400"
                    animate={{ scale: [1, 1.4], opacity: [0.7, 0] }}
                    transition={{ duration: 1.4, repeat: Infinity, ease: 'easeOut' }}
                  />
                )}
              </motion.span>

              <motion.div
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.15 + 0.1 }}
                className="min-w-0 pb-1"
              >
                <p
                  className={`font-bold ${
                    s.state === 'failed'
                      ? 'text-red-700'
                      : s.state === 'done'
                      ? 'text-slate-900'
                      : 'text-slate-400'
                  }`}
                >
                  {s.label}
                </p>
                {s.sub && <p className="text-xs text-slate-500">{s.sub}</p>}
              </motion.div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
