'use client';

import { useEffect, useRef } from 'react';

/**
 * ★ Custom cursor — glow বিন্দু + পিছনে চলা ring।
 *   শুধু desktop (hover) এ; touch device এ স্বাভাবিক cursor।
 */
export default function CustomCursor() {
  const dotRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const touch = window.matchMedia('(hover: none)').matches;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (touch || reduce) return;

    document.body.style.cursor = 'none';
    const dot = dotRef.current!;
    const ring = ringRef.current!;
    let mx = window.innerWidth / 2,
      my = window.innerHeight / 2,
      rx = mx,
      ry = my;

    const onMove = (e: MouseEvent) => {
      mx = e.clientX;
      my = e.clientY;
      dot.style.left = mx + 'px';
      dot.style.top = my + 'px';
    };
    const over = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('a,button,[role="button"],input,select,textarea')) {
        ring.style.width = '54px';
        ring.style.height = '54px';
        ring.style.borderColor = 'rgba(255,45,120,.7)';
        dot.style.opacity = '.4';
      } else {
        ring.style.width = '34px';
        ring.style.height = '34px';
        ring.style.borderColor = 'rgba(34,224,238,.6)';
        dot.style.opacity = '1';
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseover', over);

    let raf = 0;
    const loop = () => {
      rx += (mx - rx) * 0.18;
      ry += (my - ry) * 0.18;
      ring.style.left = rx + 'px';
      ring.style.top = ry + 'px';
      raf = requestAnimationFrame(loop);
    };
    loop();

    return () => {
      document.body.style.cursor = '';
      cancelAnimationFrame(raf);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseover', over);
    };
  }, []);

  return (
    <div aria-hidden="true">
      <div
        ref={dotRef}
        className="pointer-events-none fixed z-[9999] h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ background: 'radial-gradient(circle,#22e0ee,transparent 70%)', mixBlendMode: 'screen' }}
      />
      <div
        ref={ringRef}
        className="pointer-events-none fixed z-[9998] h-[34px] w-[34px] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ border: '1.5px solid rgba(34,224,238,.6)', transition: 'width .25s,height .25s,border-color .25s' }}
      />
    </div>
  );
}
