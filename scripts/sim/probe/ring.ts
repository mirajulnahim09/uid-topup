import { db, BASE, mintCookie } from '../_lib';
import { openBrowser } from '../../verify/_browser';
(async () => {
  const b = await openBrowser({ headless: true });
  const ctx = await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/product/1/free-fire-bd-server`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);
  const out = await p.evaluate(() => {
    const els = document.elementsFromPoint(195, 420).slice(0, 6).map((e) => `${e.tagName}.${String((e as HTMLElement).className).slice(0, 90)}`);
    const rings = [...document.querySelectorAll('div')].filter((d) => { const s = getComputedStyle(d); return s.borderRadius.includes('50%') || s.borderRadius === '9999px'; })
      .filter((d) => { const r = d.getBoundingClientRect(); return r.width > 25 && r.width < 70 && Math.abs(r.width - r.height) < 2 && getComputedStyle(d).position === 'fixed'; })
      .map((d) => `${String(d.className).slice(0, 120)} @${Math.round(d.getBoundingClientRect().left)},${Math.round(d.getBoundingClientRect().top)} parent=${String(d.parentElement?.className).slice(0, 60)}`);
    return { hover: matchMedia('(hover: none)').matches, els, rings };
  });
  console.log(JSON.stringify(out, null, 1));
  await b.close();
})().finally(() => db.$disconnect());
