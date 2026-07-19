'use client';

import Link from 'next/link';
import SafeImage from '@/components/fx/SafeImage';
import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Diamond from '@/components/fx/Diamond';

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
      {/* search */}
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
        className="relative mx-auto mb-12 max-w-lg">
        <svg className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2" style={{ color: 'var(--mut)' }}
          width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
        </svg>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="প্রোডাক্ট খুঁজুন..." aria-label="প্রোডাক্ট খুঁজুন" className="input pl-11 pr-11" />
        <AnimatePresence>
          {q && (
            <motion.button initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.7 }}
              onClick={() => setQ('')} aria-label="খোঁজা বাতিল"
              className="absolute right-3.5 top-1/2 -translate-y-1/2 rounded p-1" style={{ color: 'var(--mut)' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12" /></svg>
            </motion.button>
          )}
        </AnimatePresence>
      </motion.div>

      <p className="sr-only" aria-live="polite">{total} টি প্রোডাক্ট পাওয়া গেছে</p>

      {filtered.length === 0 ? (
        <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="py-20 text-center">
          <div className="mx-auto w-fit opacity-40"><Diamond size={56} /></div>
          <p className="mt-5 text-sm font-light" style={{ color: 'var(--mut)' }}>কোনো প্রোডাক্ট পাওয়া যায়নি</p>
          <button onClick={() => setQ('')} className="btn-ghost mt-5">খোঁজা মুছুন</button>
        </motion.div>
      ) : (
        filtered.map((c: C) => (
          <section key={c.id} id={`cat-${c.id}`} className="mb-16 scroll-mt-24">
            {/* section head */}
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease: [0.2, 0.8, 0.2, 1] }}
              className="mb-9">
              <div className="text-[10px] font-semibold uppercase" style={{ letterSpacing: '.32em', color: 'var(--gold)' }}>
                The Collection
              </div>
              <h2 className="dsp lux-text mt-3 text-2xl font-medium sm:text-3xl" style={{ letterSpacing: '-.018em' }}>{c.name}</h2>
              <div className="mt-3 h-px w-24" style={{ background: 'linear-gradient(90deg,rgba(230,197,132,.7),transparent)' }} />
            </motion.div>

            <motion.div
              variants={{ hidden: {}, show: { transition: { staggerChildren: 0.045 } } }}
              initial="hidden" animate="show"
              className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
            >
              <AnimatePresence mode="popLayout">
                {c.products.map((p: P) => (
                  <motion.div
                    key={p.id} layout
                    variants={{
                      hidden: { opacity: 0, y: 28, scale: 0.97 },
                      show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.6, ease: [0.2, 0.8, 0.2, 1] } },
                    }}
                    exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.2 } }}
                    whileHover={{ y: -7 }} whileTap={{ scale: 0.97 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 24 }}
                    className="group"
                  >
                    <Link href={`/product/${p.id}/${p.slug}`} prefetch className="prod-card block">
                      {/* top */}
                      <div className="relative grid aspect-[16/11] place-items-center overflow-hidden"
                        style={{ background: 'linear-gradient(150deg,#101228,#080a18)' }}>
                        <span className="pointer-events-none absolute inset-0"
                          style={{ background: 'radial-gradient(circle at 50% 38%,rgba(167,219,255,.16),transparent 62%)' }} />
                        {p.image ? (
                          <SafeImage src={p.image} alt=""
                            sizes="(max-width:640px) 50vw, (max-width:1024px) 25vw, 220px"
                            className="object-cover transition-transform duration-700 group-hover:scale-110" />
                        ) : (
                          <span className="relative transition-transform duration-500 group-hover:scale-110 group-hover:-translate-y-0.5">
                            <Diamond size={52} />
                          </span>
                        )}
                        {/* sheen */}
                        <span className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
                          style={{ background: 'linear-gradient(115deg,transparent 38%,rgba(255,255,255,.09),transparent 62%)' }} />
                      </div>
                      {/* body */}
                      <div className="p-4">
                        <p className="dsp text-[13px] font-semibold leading-tight" style={{ color: '#f2f3fa' }}>{p.name}</p>
                        <p className="mt-1.5 text-[10px] uppercase" style={{ letterSpacing: '.12em', color: 'var(--mut)' }}>
                          Top-Up
                        </p>
                        <div className="mt-3.5 w-full rounded-lg py-2 text-center text-[10px] font-semibold uppercase transition-all duration-300 group-hover:bg-white group-hover:text-[#08070f]"
                          style={{ letterSpacing: '.1em', border: '1px solid var(--hair)', color: 'var(--ink)' }}>
                          Order now
                        </div>
                      </div>
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
