// ★ অস্থায়ী প্রোব (EXTREME অডিট ২০২৬-০৯-২২) — অ্যাডমিন ডিপোজিট/প্রোডাক্ট পাতার CLS-এর উৎস।
//   perf-browser-এর মতোই: ৩৯০×৮৪৪, ৪× CPU, ১.৬Mbps। কেবল পড়ে।
import { db, BASE } from './_db';
import { openBrowser } from './_browser';

const COLLECT = `(() => { window.__fonts = []; document.fonts && document.fonts.addEventListener('loadingdone', (ev) => {
  const h = document.querySelector('main h1')?.parentElement; window.__fonts.push({ t: Math.round(performance.now()), n: ev.fontfaces.map(f => f.family).join(','), hdrH: h ? Math.round(h.getBoundingClientRect().height) : -1 }); });
  window.__ls = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) {
  if (e.hadRecentInput) continue;
  window.__ls.push({ v: +e.value.toFixed(4), t: Math.round(e.startTime), src: (e.sources || []).map((s) => {
    const n = s.node; const d = n && n.nodeType === 1 ? n : n && n.parentElement;
    return d ? (d.tagName.toLowerCase() + (d.id ? '#' + d.id : '') + '.' + String(d.className || '').split(' ').filter(Boolean).slice(0, 4).join('.')
      + ' [' + (s.previousRect.y|0) + '→' + (s.currentRect.y|0) + ' h' + (s.previousRect.height|0) + '→' + (s.currentRect.height|0) + ']'
      + ' «' + (d.textContent || '').trim().slice(0, 30) + '»') : '?';
  }) }); } }).observe({ type: 'layout-shift', buffered: true }); })()`;

async function main() {
  const browser = await openBrowser({ headless: true });
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await db.rateLimitBucket.deleteMany({});
  // ★ perf-browser-এর হুবহু পদ্ধতি: API দিয়ে লগইন — কোনো পাতা আগে লোড হয় না (ঠান্ডা ক্যাশ)
  const { csrfToken } = await (await ctx.request.get(`${BASE}/api/auth/csrf`)).json();
  await ctx.request.post(`${BASE}/api/auth/callback/credentials`, {
    form: { csrfToken, email: 'admin@uidtopup.local', password: 'Admin@2026Secure', json: 'true' }, maxRedirects: 0, failOnStatusCode: false,
  });

  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 200_000, uploadThroughput: 90_000 });
  await page.addInitScript(COLLECT);

  for (const p of (process.env.PAGES || '/admin/deposits,/admin/products').split(',')) {
    await page.goto(`${BASE}${p}`, { waitUntil: 'load', timeout: 120_000 });
    await page.waitForTimeout(4000);
    const shifts = await page.evaluate('window.__ls') as Array<{ v: number; t: number; src: string[] }>;
    const total = shifts.reduce((s, e) => s + e.v, 0);
    console.log(`\n${p} — মোট CLS ≈ ${total.toFixed(3)} (${shifts.length}টি শিফট)`);
    for (const s of shifts.sort((a, b) => b.v - a.v).slice(0, 6)) console.log(`  ${s.v} @${s.t}ms  ${s.src.join(' | ')}`);
    const fonts = await page.evaluate('window.__fonts') as Array<{ t: number; n: string; hdrH: number }>;
    for (const f of fonts) console.log(`  font-loadingdone @${f.t}ms  [${f.n}]  header-h=${f.hdrH}`);
    const hdrNow = await page.evaluate(`(() => { const h = document.querySelector('main h1')?.parentElement; return h ? Math.round(h.getBoundingClientRect().height) : -1; })()`);
    console.log(`  header-h (শেষে) = ${hdrNow}`);
  }
  await browser.close();
  await db.rateLimitBucket.deleteMany({});
  await db.$disconnect();
}
main().catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(2); });
