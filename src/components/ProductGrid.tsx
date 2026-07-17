'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

type P = { id: number; name: string; slug: string; image: string | null; description: string | null };
type C = { id: number; name: string; icon: string | null; products: P[] };

export default function ProductGrid({ categories }: { categories: C[] }) {
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return categories;
    return categories
      .map((c: C) => ({
        ...c,
        products: c.products.filter(
          (p: P) => p.name.toLowerCase().includes(needle) || (p.description ?? '').toLowerCase().includes(needle)
        ),
      }))
      .filter((c: C) => c.products.length > 0);
  }, [categories, q]);

  const total = filtered.reduce((n: number, c: C) => n + c.products.length, 0);

  return (
    <>
      {/* ── Search ── */}
      <motion.div
        initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
        className="relative mx-auto mb-10 max-w-lg"
      >
        <svg className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--mut)' }}
          width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
        </svg>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="প্রোডাক্ট খুঁজুন..." aria-label="প্রোডাক্ট খুঁজুন" className="input pl-10 pr-10" />
        <AnimatePresence>
          {q && (
            <motion.button initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.7 }}
              onClick={() => setQ('')} aria-label="খোঁজা বাতিল"
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 transition" style={{ color: 'var(--mut)' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12" /></svg>
            </motion.button>
          )}
        </AnimatePresence>
      </motion.div>

      <p className="sr-only" aria-live="polite">{total} টি প্রোডাক্ট পাওয়া গেছে</p>

      {filtered.length === 0 ? (
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="py-16 text-center">
          <p className="text-4xl" aria-hidden="true">🔍</p>
          <p className="mt-3 font-semibold" style={{ color: 'var(--mut)' }}>কোনো প্রোডাক্ট পাওয়া যায়নি</p>
          <button onClick={() => setQ('')} className="btn-ghost mt-4">খোঁজা মুছুন</button>
        </motion.div>
      ) : (
        filtered.map((c: C) => (
          <section key={c.id} id={`cat-${c.id}`} className="mb-14 scroll-mt-24">
            {/* section heading with neon underline */}
            <motion.div
              initial={{ opacity: 0, y: 14 }} whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-40px' }} transition={{ duration: 0.4 }}
              className="mb-8 text-center"
            >
              <h2 className="grad-text inline-block text-2xl font-extrabold uppercase tracking-wider sm:text-3xl">{c.name}</h2>
              <div className="mx-auto mt-2 h-[3px] w-20 rounded-full" style={{ background: 'linear-gradient(90deg,transparent,#ff2d78,#22e0ee,transparent)' }} />
            </motion.div>

            <motion.div
              variants={{ hidden: {}, show: { transition: { staggerChildren: 0.035 } } }}
              initial="hidden" whileInView="show" viewport={{ once: true, margin: '-60px' }}
              className="grid grid-cols-3 gap-3 sm:grid-cols-4 sm:gap-4 md:grid-cols-5 lg:grid-cols-7"
            >
              <AnimatePresence mode="popLayout">
                {c.products.map((p: P) => (
                  <motion.div
                    key={p.id} layout
                    variants={{
                      hidden: { opacity: 0, y: 20, scale: 0.94 },
                      show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] } },
                    }}
                    exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.15 } }}
                    whileHover={{ y: -6 }} whileTap={{ scale: 0.96 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                    className="group relative"
                  >
                    {/* animated glow border */}
                    <span
                      className="pointer-events-none absolute -inset-[1.5px] rounded-2xl opacity-0 blur-[2px] transition-opacity duration-300 group-hover:opacity-100"
                      style={{ background: 'linear-gradient(135deg,#22e0ee,#ff2d78,#8b5cf6,#ffcf5a)' }}
                      aria-hidden="true"
                    />
                    <Link
                      href={`/product/${p.id}/${p.slug}`} prefetch
                      className="relative block overflow-hidden rounded-2xl"
                      style={{ background: '#120e28', border: '1px solid var(--line)' }}
                    >
                      <div className="relative grid aspect-square place-items-center overflow-hidden"
                        style={{ background: 'linear-gradient(135deg,#4c1d95,#7c3aed 45%,#db2777)' }}>
                        {p.image ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.image} alt="" loading="lazy"
                            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110" />
                        ) : (
                          <motion.span className="text-4xl" aria-hidden="true"
                            style={{ filter: 'drop-shadow(0 0 12px rgba(34,224,238,.7))' }}
                            whileHover={{ rotate: [0, -12, 12, 0], scale: 1.15 }} transition={{ duration: 0.5 }}>💎</motion.span>
                        )}
                        {/* holographic shine sweep */}
                        <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/30 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
                      </div>
                      <p className="px-2 py-2.5 text-center text-[11px] font-bold leading-tight transition-colors sm:text-xs"
                        style={{ color: '#e9e6ff' }}>
                        {p.name}
                      </p>
                    </Link>
                  </motion.div>
                ))}
              </AnimatePresence>
            </motion.div>
          </section>
        ))
      )}
    </>
  );
}
