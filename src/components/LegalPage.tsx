'use client';

import { motion } from 'framer-motion';

type Section = { h: string; p: string[]; warn?: boolean; ok?: boolean };

export default function LegalPage({
  icon, title, subtitle, sections,
}: {
  icon: string;
  title: string;
  subtitle: string;
  sections: Section[];
}) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <motion.header
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8 text-center"
      >
        <div className="text-5xl" aria-hidden="true">{icon}</div>
        <h1 className="mt-3 text-3xl font-extrabold text-slate-900">{title}</h1>
        <p className="mt-1 text-slate-500">{subtitle}</p>
      </motion.header>

      <div className="space-y-4">
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
            <h2 className="mb-3 font-bold text-slate-900">{s.h}</h2>
            <div className="space-y-2">
              {s.p.map((para, j) => (
                <p
                  key={j}
                  className="text-sm leading-relaxed text-slate-600"
                  dangerouslySetInnerHTML={{
                    __html: para.replace(
                      /\*\*(.+?)\*\*/g,
                      '<strong class="text-slate-900">$1</strong>'
                    ),
                  }}
                />
              ))}
            </div>
          </motion.section>
        ))}
      </div>

      <p className="mt-8 text-center text-xs text-slate-400">
        সর্বশেষ হালনাগাদ: {new Date().toLocaleDateString('bn-BD')}
      </p>
    </div>
  );
}
