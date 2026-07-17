'use client';

import { useEffect, useRef } from 'react';

/**
 * ★ পুরো সাইটের global animated background।
 *   root layout এ একবার বসানো — তাই সব পেজে animation দেখা যায়।
 *   - particle network (মাউসের সাথে reactive)
 *   - aurora orbs (নড়াচড়া)
 *   - floating diamonds
 *   পারফরম্যান্স: particle সীমিত, মোবাইলে হালকা, reduced-motion respect।
 */
export default function SiteBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const touch = window.matchMedia('(hover: none)').matches;
    let W = (canvas.width = window.innerWidth);
    let H = (canvas.height = window.innerHeight);
    const mouse = { x: -999, y: -999 };

    const N = touch ? 28 : 64;
    const COL = ['34,224,238', '255,45,120', '255,207,90', '139,92,246'];
    const ps = Array.from({ length: N }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() - 0.5) * 0.4,
      r: Math.random() * 1.8 + 0.6,
    }));

    const onResize = () => {
      W = canvas.width = window.innerWidth;
      H = canvas.height = window.innerHeight;
    };
    const onMove = (e: MouseEvent) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('mousemove', onMove);

    let raf = 0;
    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      for (let i = 0; i < ps.length; i++) {
        const p = ps[i];
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > W) p.vx *= -1;
        if (p.y < 0 || p.y > H) p.vy *= -1;
        const dx = mouse.x - p.x,
          dy = mouse.y - p.y,
          md = Math.hypot(dx, dy);
        if (md < 140) {
          p.x += (dx / md) * 0.6;
          p.y += (dy / md) * 0.6;
        }
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, 7);
        ctx.fillStyle = 'rgba(180,200,255,.6)';
        ctx.fill();
        for (let j = i + 1; j < ps.length; j++) {
          const q = ps[j],
            d = Math.hypot(p.x - q.x, p.y - q.y);
          if (d < 116) {
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(q.x, q.y);
            ctx.strokeStyle = `rgba(${COL[i % 4]},${(1 - d / 116) * 0.3})`;
            ctx.lineWidth = 0.7;
            ctx.stroke();
          }
        }
        if (md < 160) {
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(mouse.x, mouse.y);
          ctx.strokeStyle = `rgba(34,224,238,${(1 - md / 160) * 0.4})`;
          ctx.lineWidth = 0.8;
          ctx.stroke();
        }
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
      {/* aurora orbs */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <span className="absolute -left-[10%] -top-[12%] h-[52vw] w-[52vw] rounded-full opacity-50 blur-[90px] floaty" style={{ background: '#8b5cf6', mixBlendMode: 'screen', animationDuration: '18s' }} />
        <span className="absolute -right-[12%] top-[8%] h-[46vw] w-[46vw] rounded-full opacity-50 blur-[90px] floaty" style={{ background: '#ff6b2c', mixBlendMode: 'screen', animationDuration: '23s' }} />
        <span className="absolute -bottom-[16%] left-[18%] h-[42vw] w-[42vw] rounded-full opacity-40 blur-[90px] floaty" style={{ background: '#ff2d78', mixBlendMode: 'screen', animationDuration: '20s' }} />
      </div>
      {/* grid overlay */}
      <div
        className="pointer-events-none fixed inset-0 z-0 opacity-40"
        style={{
          backgroundImage:
            'linear-gradient(rgba(139,92,246,.06) 1px,transparent 1px),linear-gradient(90deg,rgba(139,92,246,.06) 1px,transparent 1px)',
          backgroundSize: '44px 44px',
          maskImage: 'radial-gradient(ellipse at 50% 0%,#000 30%,transparent 75%)',
          WebkitMaskImage: 'radial-gradient(ellipse at 50% 0%,#000 30%,transparent 75%)',
        }}
      />
      {/* particle network */}
      <canvas ref={canvasRef} className="pointer-events-none fixed inset-0 z-0" />
    </div>
  );
}
