'use client';

import { useEffect, useRef } from 'react';

/**
 * ★ Maison global background — সব পেজে (root layout এ একবার)।
 *   স্তর: mesh gradient · godrays · starfield (parallax) · golden dust · spotlight
 *   পারফরম্যান্স: canvas সীমিত, মোবাইলে হালকা, reduced-motion respect।
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
        ctx.arc(s.x + px * s.z * 24, s.y + py * s.z * 24, s.r, 0, 7);
        ctx.fillStyle = `rgba(210,218,255,${tw * s.z})`;
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
    <div aria-hidden="true">
      {/* mesh gradient — ৪ স্তর */}
      <div className="pointer-events-none fixed inset-0 z-0 opacity-[.55]" style={{ filter: 'blur(90px)' }}>
        <span className="floaty absolute rounded-full" style={{ width: '48vw', height: '48vw', background: '#4a3fb0', top: '-14%', left: '2%', animationDuration: '24s' }} />
        <span className="floaty absolute rounded-full" style={{ width: '38vw', height: '38vw', background: '#1e3a6e', top: '12%', right: '-6%', animationDuration: '30s' }} />
        <span className="floaty absolute rounded-full opacity-50" style={{ width: '30vw', height: '30vw', background: '#6b4f2a', bottom: '2%', left: '26%', animationDuration: '28s' }} />
        <span className="floaty absolute rounded-full opacity-40" style={{ width: '26vw', height: '26vw', background: '#7a2f55', bottom: '20%', right: '14%', animationDuration: '34s' }} />
      </div>

      {/* volumetric godrays */}
      <div
        className="halo-pulse pointer-events-none fixed left-1/2 top-[-22%] z-0 -translate-x-1/2"
        style={{
          width: '86vw', height: '92vh', filter: 'blur(7px)',
          background:
            'conic-gradient(from 180deg at 50% 0,transparent 41%,rgba(154,140,247,.11) 45%,transparent 49%,rgba(167,219,255,.09) 53%,transparent 57%,rgba(230,197,132,.08) 61%,transparent 65%)',
        }}
      />

      {/* starfield */}
      <canvas ref={canvasRef} className="pointer-events-none fixed inset-0 z-0" />

      {/* golden dust */}
      <div className="pointer-events-none fixed inset-0 z-[1] overflow-hidden">
        {Array.from({ length: 16 }).map((_, i) => (
          <span
            key={i}
            className="absolute rounded-full"
            style={{
              bottom: '-8px',
              left: `${(i * 6.7 + 3) % 100}%`,
              width: `${2 + (i % 3)}px`,
              height: `${2 + (i % 3)}px`,
              background: 'rgba(230,197,132,.7)',
              boxShadow: '0 0 8px rgba(230,197,132,.8)',
              animation: `dust-rise ${9 + (i % 8)}s linear ${i * 0.9}s infinite`,
            }}
          />
        ))}
      </div>

      {/* spotlight — cursor follow */}
      <div
        ref={spotRef}
        className="pointer-events-none fixed z-[1] hidden -translate-x-1/2 -translate-y-1/2 rounded-full md:block"
        style={{
          width: 620, height: 620,
          background: 'radial-gradient(circle,rgba(154,140,247,.10),rgba(167,219,255,.05) 40%,transparent 68%)',
        }}
      />

      <style>{`@keyframes dust-rise{0%{transform:translateY(0) translateX(0);opacity:0}12%{opacity:1}88%{opacity:.6}100%{transform:translateY(-104vh) translateX(30px);opacity:0}}`}</style>
    </div>
  );
}
