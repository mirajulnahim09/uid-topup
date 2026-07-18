'use client';

import { motion } from 'framer-motion';

type Section = { h: string; p: string[]; warn?: boolean; ok?: boolean };


/**
 * ★ নিরাপদ **bold** রেন্ডার — XSS প্রতিরোধ।
 *   আগে কাঁচা টেক্সট সরাসরি HTML হিসেবে বসত; কেউ (বা ভবিষ্যতে DB থেকে আসা
 *   কন্টেন্ট) <script> ঢোকালে চলে যেত। এখন আগে সব HTML escape করা হয়,
 *   তারপর কেবল **...** কে <strong> এ রূপ দেওয়া হয় — আর কিছু নয়।
 */
function boldOnly(text: string): string {
  const esc = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  return esc.replace(/\*\*(.+?)\*\*/g, '<strong class="text-slate-900">$1</strong>');
}

export default function LegalPage({
  icon, title, subtitle, sections,
}: {
  icon: string;
  title: string;
  subtitle: string;
  sections: Section[];
}) {
  return (
    <div className="prose-measure mx-auto max-w-3xl page-x page-y">
      <motion.header
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-10 text-center"
      >
        <div className="text-3xl opacity-70" aria-hidden="true">{icon}</div>
        <h1 className="lux-text mt-4 text-3xl font-medium sm:text-4xl">{title}</h1>
        <p className="mt-2.5 text-sm font-light" style={{ color: 'var(--mut)' }}>{subtitle}</p>
        <div className="rule-gold mx-auto" />
      </motion.header>

      <div className="space-y-5">
        {sections.map((s, i) => (
          <motion.section
            key={s.h}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-40px' }}
            transition={{ duration: 0.4, delay: i * 0.05 }}
            className={`card p-5 ${
              s.warn ? 'border-l-4 border-l-amber-400' : s.ok ? 'border-l-4 border-l-emerald-400' : ''
            }`}
          >
            <h2 className="mb-3 text-base font-semibold text-slate-900">{s.h}</h2>
            <div className="space-y-2">
              {s.p.map((para, j) => (
                <p
                  key={j}
                  className="text-[13.5px] font-light leading-[1.8] text-slate-600"
                  dangerouslySetInnerHTML={{ __html: boldOnly(para) }}
                />
              ))}
            </div>
          </motion.section>
        ))}
      </div>

      <p className="mt-10 text-center text-[11px] uppercase tracking-[.16em] text-slate-400">
        সর্বশেষ হালনাগাদ: {new Date().toLocaleDateString('bn-BD')}
      </p>
    </div>
  );
}
