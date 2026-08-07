/**
 * ★ প্রোডাকশন পারফরম্যান্স মাপ — `next start` এর বিপরীতে।
 * dev-mode এর সংখ্যা বিভ্রান্তিকর (প্রতি রুটে on-demand compile),
 * তাই আসল দাবি করার আগে প্রোডাকশন বিল্ডেই মাপা হয়।
 */
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

const BASE = process.env.PERF_BASE || 'http://localhost:3000';
const PAGES = ['/', '/track', '/faq', '/login', '/register', '/terms', '/privacy'];

async function timeIt(path: string, runs = 3): Promise<{ ttfb: number; total: number; bytes: number }> {
  let best = { ttfb: Infinity, total: Infinity, bytes: 0 };
  for (let i = 0; i < runs; i++) {
    const t0 = Date.now();
    const res = await fetch(BASE + path);
    const ttfb = Date.now() - t0;
    const body = await res.text();
    const total = Date.now() - t0;
    if (total < best.total) best = { ttfb, total, bytes: Buffer.byteLength(body) };
  }
  return best;
}

(async () => {
  console.log(`\n═══ PRODUCTION TIMINGS (${BASE}) ═══`);
  console.log('  best of 3 per route, warm\n');
  console.log('  route                 TTFB     total    html');
  let worst = 0;
  for (const p of PAGES) {
    await timeIt(p, 1); // ওয়ার্ম-আপ
    const r = await timeIt(p, 3);
    worst = Math.max(worst, r.total);
    console.log(`  ${p.padEnd(20)} ${String(r.ttfb).padStart(5)}ms ${String(r.total).padStart(6)}ms ${String(Math.round(r.bytes / 1024)).padStart(5)}KB`);
  }

  console.log('\n═══ API TIMINGS ═══');
  for (const p of ['/api/health', '/api/me', '/api/notifications']) {
    const t0 = Date.now();
    const res = await fetch(BASE + p);
    console.log(`  ${p.padEnd(20)} ${String(Date.now() - t0).padStart(5)}ms  HTTP ${res.status}`);
  }

  console.log(`\n  worst page total: ${worst}ms`);
})();
