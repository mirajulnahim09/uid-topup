'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * ★ Custom cursor — glow বিন্দু + পিছনে চলা ring।
 *   শুধু desktop (hover) এ; touch device এ স্বাভাবিক cursor।
 *
 * ⚠️ touch/reduced-motion-এ বিন্দু ও রিং **রেন্ডারই হয় না**। আগে effect
 *   শুধু আগেভাগে ফিরে যেত, কিন্তু div দুটি থেকে যেত — `fixed` অথচ
 *   `left/top` কখনো বসত না, তাই পাতার মাঝখানে একটি স্থির হলুদ রিং
 *   ভাসত: প্যাকেজ-কার্ডের উপর, পেমেন্ট-বোতামের উপর, ফুটারে।
 *   মাপা (MASTER 2 walkthrough, ২০২৬-০৯-২৫, ৩৯০px স্ক্রিনশট) —
 *   অর্থাৎ **প্রত্যেক মোবাইল গ্রাহক** এটি দেখতেন।
 */
export default function CustomCursor() {
  const dotRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const touch = window.matchMedia('(hover: none)').matches;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setEnabled(!touch && !reduce);
  }, []);

  useEffect(() => {
    if (!enabled || !dotRef.current || !ringRef.current) return;

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
        // ★ ইন্টার‌্যাক্টিভ কিছুর উপর রিং লাইম হয় — কার্সরই বলে দেয়
        //   "এখানে কাজ করা যায়", প্যালেটের নিয়ম মেনেই
        ring.style.width = '54px';
        ring.style.height = '54px';
        ring.style.borderColor = 'rgba(200,255,61,.9)';
        dot.style.opacity = '.4';
      } else {
        ring.style.width = '34px';
        ring.style.height = '34px';
        ring.style.borderColor = 'rgba(125,227,255,.45)';
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
  }, [enabled]);

  if (!enabled) return null;

  return (
    <div aria-hidden="true">
      <div
        ref={dotRef}
        className="pointer-events-none fixed z-[9999] h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ background: 'radial-gradient(circle,#c8ff3d,transparent 70%)', mixBlendMode: 'screen' }}
      />
      <div
        ref={ringRef}
        className="pointer-events-none fixed z-[9998] h-[34px] w-[34px] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ border: '1.5px solid rgba(125,227,255,.45)', transition: 'width .25s,height .25s,border-color .25s' }}
      />
    </div>
  );
}
