import { db, BASE } from '../_lib';
import { openBrowser } from '../../verify/_browser';
(async () => {
  const b = await openBrowser({ headless: true });
  for (const [label, opts] of [['touch', { isMobile: true, hasTouch: true }], ['desktop-reduced-motion', { reducedMotion: 'reduce' as const }]] as const) {
    const ctx = await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 }, ...opts });
    const p = await ctx.newPage();
    await p.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(1200);
    const n = await p.evaluate(() => [...document.querySelectorAll('div[aria-hidden="true"] > div.fixed.rounded-full')].map((d) => String(d.className).slice(0, 140) + ' | ' + String(d.parentElement?.parentElement?.className).slice(0, 60)));
    console.log(label, 'CustomCursor dot/ring elements in DOM:', n);
    await ctx.close();
  }
  await b.close();
})().finally(() => db.$disconnect());
