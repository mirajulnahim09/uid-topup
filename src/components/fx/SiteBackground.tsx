'use client';

import { useEffect, useRef } from 'react';

/**
 * ═══════════════════════════════════════════════════════════
 * ★ VOLT global background
 *
 *   স্তর (পেছন → সামনে):
 *     ১. mesh — চারটি বিশাল ঝাপসা আলোক-বলয় (ঠান্ডা প্রাধান্য,
 *        একটিমাত্র উষ্ণ)
 *     ২. godrays — উপর থেকে নামা আয়তনিক আলো
 *     ৩. starfield — canvas, parallax
 *     ৪. ion drift — উঠে যাওয়া কণা (বিশুদ্ধ CSS, প্রতি-ফ্রেমে
 *        কোনো JS খরচ নেই)
 *     ৫. spotlight — কার্সর অনুসরণকারী আলো (ডেস্কটপ)
 *
 *   ⚠️ পারফরম্যান্স চুক্তি অপরিবর্তিত (CLAUDE.md §4/§15):
 *   • `prefers-reduced-motion` হলে rAF/listener কিছুই সেট হয় না
 *     — শর্তটি সব সেটআপের **আগে**, তাই খরচ শূন্য।
 *   • canvas এর কাজ O(n)/frame — কণা-সংযোগ রেখার O(n²) জাল
 *     ফিরিয়ে আনা হয়নি।
 *   • টাচ ডিভাইসে তারার সংখ্যা এক-তৃতীয়াংশ, spotlight বন্ধ।
 *
 *   রিডিজাইনে কেবল **রঙ ও স্তরের ভারসাম্য** বদলেছে। কাঠামো ও
 *   খরচ অপরিবর্তিত — একই তারা-সংখ্যা, একই O(n)/frame।
 * ═══════════════════════════════════════════════════════════
 */
export default function SiteBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const spotRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const canvas = canvasRef.current;
    const spot = spotRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const touch = window.matchMedia('(hover: none)').matches;
    let W = (canvas.width = window.innerWidth);
    let H = (canvas.height = window.innerHeight);
    let px = 0, py = 0;
    let mx = W / 2, my = H / 2, sx = mx, sy = my;

    const stars = Array.from({ length: touch ? 34 : 100 }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      z: Math.random() * 0.9 + 0.1,
      r: Math.random() * 1.2 + 0.3,
      t: Math.random() * 6.3,
    }));

    const onResize = () => { W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight; };
    const onMove = (e: MouseEvent) => {
      mx = e.clientX; my = e.clientY;
      px = e.clientX / window.innerWidth - 0.5;
      py = e.clientY / window.innerHeight - 0.5;
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('mousemove', onMove);

    let raf = 0;
    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      for (const s of stars) {
        s.t += 0.02;
        const tw = 0.32 + Math.abs(Math.sin(s.t)) * 0.68;
        ctx.beginPath();
        ctx.arc(s.x + px * s.z * 26, s.y + py * s.z * 26, s.r, 0, 7);
        // ঠান্ডা সাদা — ARC এর সায়ান আভা বহন করে
        ctx.fillStyle = `rgba(214,240,255,${tw * s.z})`;
        ctx.fill();
      }
      if (spot && !touch) {
        sx += (mx - sx) * 0.06;
        sy += (my - sy) * 0.06;
        spot.style.left = sx + 'px';
        spot.style.top = sy + 'px';
      }
      raf = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('mousemove', onMove);
    };
  }, []);

  return (
    <div aria-hidden="true" className="site-bg">
      {/* ১. mesh — তিনটি ঠান্ডা, একটি উষ্ণ।
          অনুপাতটি ইচ্ছাকৃত: উষ্ণ রঙ যদি পটভূমিতেই ছড়িয়ে থাকে,
          তবে ember বোতামগুলো আর আলাদা করে "কাজের রঙ" থাকে না।
          ★ light থিমে গাঢ় mesh blob অনেক ম্লান হয় (globals.css) —
            নাহলে সাদা পটভূমিতে ময়লা ছোপ পড়ত। */}
      <div className="site-bg-mesh pointer-events-none fixed inset-0 z-0 opacity-[.5]" style={{ filter: 'blur(100px)' }}>
        <span className="v-lift absolute rounded-full" style={{ width: '46vw', height: '46vw', background: '#12325f', top: '-16%', left: '-2%', animationDuration: '26s' }} />
        <span className="v-lift absolute rounded-full" style={{ width: '40vw', height: '40vw', background: '#3d1f8c', top: '6%', right: '-8%', animationDuration: '33s' }} />
        <span className="v-lift absolute rounded-full opacity-60" style={{ width: '32vw', height: '32vw', background: '#2f5c10', bottom: '4%', left: '22%', animationDuration: '30s' }} />
        <span className="v-lift absolute rounded-full opacity-[.28]" style={{ width: '24vw', height: '24vw', background: '#5c7a12', bottom: '24%', right: '10%', animationDuration: '38s' }} />
      </div>

      {/* ২. godrays */}
      <div
        className="v-breathe pointer-events-none fixed left-1/2 top-[-24%] z-0 -translate-x-1/2"
        style={{
          width: '88vw', height: '92vh', filter: 'blur(8px)',
          background:
            'conic-gradient(from 180deg at 50% 0,transparent 41%,rgba(200,255,61,.09) 45%,transparent 49%,rgba(123,44,255,.12) 53%,transparent 57%,rgba(125,227,255,.08) 61%,transparent 65%)',
        }}
      />

      {/* ৩. starfield */}
      <canvas ref={canvasRef} className="pointer-events-none fixed inset-0 z-0" />

      {/* ৪. ion drift — বিশুদ্ধ CSS, প্রতি-ফ্রেমে JS খরচ শূন্য */}
      <div className="pointer-events-none fixed inset-0 z-[1] overflow-hidden">
        {Array.from({ length: 16 }).map((_, i) => (
          <span
            key={i}
            className="absolute rounded-full"
            style={{
              bottom: '-8px',
              left: `${(i * 6.7 + 3) % 100}%`,
              width: `${1.5 + (i % 3)}px`,
              height: `${1.5 + (i % 3)}px`,
              background: i % 4 === 0 ? 'rgba(200,255,61,.85)' : 'rgba(125,227,255,.7)',
              boxShadow: i % 4 === 0 ? '0 0 10px rgba(200,255,61,.9)' : '0 0 9px rgba(125,227,255,.75)',
              animation: `ion-rise ${9 + (i % 8)}s linear ${i * 0.9}s infinite`,
            }}
          />
        ))}
      </div>

      {/* ৫. spotlight — কেবল ডেস্কটপ (md+) */}
      <div
        ref={spotRef}
        className="pointer-events-none fixed z-[1] hidden -translate-x-1/2 -translate-y-1/2 rounded-full md:block"
        style={{
          width: 640, height: 640,
          background: 'radial-gradient(circle,rgba(200,255,61,.07),rgba(123,44,255,.07) 42%,transparent 68%)',
        }}
      />

      <style>{`@keyframes ion-rise{0%{transform:translateY(0) translateX(0);opacity:0}12%{opacity:1}88%{opacity:.55}100%{transform:translateY(-104vh) translateX(26px);opacity:0}}`}</style>
    </div>
  );
}
