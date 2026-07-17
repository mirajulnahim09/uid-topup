'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

/**
 * ★ পাতা বদলানোর সময় উপরে একটা লাল প্রগ্রেস বার।
 *   ক্লিকের সাথে সাথেই feedback — "কিছু হচ্ছে না" মনে হবে না।
 */
export default function NavProgress() {
  const path = usePathname();
  const [loading, setLoading] = useState(false);
  const [width, setWidth] = useState(0);

  // যেকোনো internal link ক্লিক ধরা
  useEffect(() => {
    function onClick(e: MouseEvent) {
      const a = (e.target as HTMLElement)?.closest?.('a');
      if (!a) return;
      const href = a.getAttribute('href');
      if (!href || !href.startsWith('/')) return;
      if (a.getAttribute('target') === '_blank') return;
      if (href === window.location.pathname) return;
      setLoading(true);
    }
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  // path বদলালে শেষ
  useEffect(() => {
    setLoading(false);
    setWidth(100);
    const t = setTimeout(() => setWidth(0), 250);
    return () => clearTimeout(t);
  }, [path]);

  // লোড হওয়ার সময় বার এগোবে
  useEffect(() => {
    if (!loading) return;
    setWidth(15);
    const t1 = setTimeout(() => setWidth(45), 80);
    const t2 = setTimeout(() => setWidth(70), 250);
    const t3 = setTimeout(() => setWidth(88), 600);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [loading]);

  if (width === 0) return null;

  return (
    <div
      className="fixed inset-x-0 top-0 z-[150] h-0.5 bg-transparent"
      role="progressbar"
      aria-hidden="true"
    >
      <div
        className="h-full bg-gradient-to-r from-rose-500 to-rose-600 shadow-[0_0_8px_rgba(225,29,72,0.6)]"
        style={{
          width: `${width}%`,
          transition: width === 100 ? 'width 0.15s ease-out' : 'width 0.3s ease-out',
        }}
      />
    </div>
  );
}
