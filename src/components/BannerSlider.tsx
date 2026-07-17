'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';

type B = {
  id: number; image: string;
  title: string | null; subtitle: string | null; link: string | null;
};

export default function BannerSlider({ banners }: { banners: B[] }) {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const touchX = useRef<number | null>(null);

  const n = banners.length;
  const next = useCallback(() => setI((v) => (v + 1) % n), [n]);
  const prev = useCallback(() => setI((v) => (v - 1 + n) % n), [n]);

  // Auto-advance — hover/focus এ থামবে
  useEffect(() => {
    if (n <= 1 || paused) return;
    const t = setInterval(next, 5000);
    return () => clearInterval(t);
  }, [n, paused, next]);

  // ♿ Arrow key navigation
  useEffect(() => {
    if (n <= 1) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') prev();
      if (e.key === 'ArrowRight') next();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [n, next, prev]);

  if (n === 0) return null;
  const b = banners[i];

  const slide = (
    <div className="relative h-full w-full">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={b.image}
        alt={b.title || 'ব্যানার'}
        className="h-full w-full object-cover"
        loading={i === 0 ? 'eager' : 'lazy'}
      />
      {(b.title || b.subtitle) && (
        <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/85 via-black/30 to-transparent p-5 sm:p-7">
          {b.title && (
            <h2 className="text-lg font-extrabold text-white drop-shadow-lg sm:text-2xl">{b.title}</h2>
          )}
          {b.subtitle && (
            <p className="mt-1 max-w-lg text-xs text-white/90 drop-shadow sm:text-sm">
              {b.subtitle}
            </p>
          )}
        </div>
      )}
    </div>
  );

  return (
    <section
      aria-roledescription="carousel"
      aria-label="প্রচারণা ব্যানার"
      className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-md"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      onTouchStart={(e) => {
        touchX.current = e.touches[0].clientX;
      }}
      onTouchEnd={(e) => {
        if (touchX.current === null) return;
        const dx = e.changedTouches[0].clientX - touchX.current;
        if (Math.abs(dx) > 50) (dx < 0 ? next : prev)();
        touchX.current = null;
      }}
    >
      <div
        className="aspect-[16/7] sm:aspect-[21/7]"
        role="group"
        aria-roledescription="slide"
        aria-label={`${i + 1} / ${n}`}
      >
        {b.link ? (
          b.link.startsWith('/') ? (
            <Link href={b.link} className="block h-full">{slide}</Link>
          ) : (
            <a href={b.link} target="_blank" rel="noopener noreferrer nofollow" className="block h-full">
              {slide}
            </a>
          )
        ) : (
          slide
        )}
      </div>

      {n > 1 && (
        <>
          <button
            onClick={prev}
            aria-label="আগের ব্যানার"
            className="absolute left-2 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-black/50 text-white backdrop-blur transition hover:bg-black/70"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <button
            onClick={next}
            aria-label="পরের ব্যানার"
            className="absolute right-2 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-black/50 text-white backdrop-blur transition hover:bg-black/70"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>

          <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1.5">
            {banners.map((_, idx) => (
              <button
                key={idx}
                onClick={() => setI(idx)}
                aria-label={`ব্যানার ${idx + 1}`}
                aria-current={idx === i}
                className={`h-1.5 rounded-full transition-all ${
                  idx === i ? 'w-6 bg-white' : 'w-1.5 bg-white/50 hover:bg-white/80'
                }`}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
