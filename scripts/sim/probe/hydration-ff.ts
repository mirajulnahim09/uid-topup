import { db, BASE } from '../_lib';
import { firefox } from 'playwright-core';
(async () => {
  const b = await firefox.launch({ headless: true });
  for (const [label, o] of [
    ['dark+touch+theme', { colorScheme: 'dark' as const, hasTouch: true, theme: 'dark' }],
    ['dark+theme', { colorScheme: 'dark' as const, hasTouch: false, theme: 'dark' }],
    ['light+theme', { colorScheme: 'light' as const, hasTouch: true, theme: 'light' }],
    ['no-theme', { colorScheme: 'dark' as const, hasTouch: true, theme: '' }],
  ] as const) {
    let n = 0; const kinds = new Set<string>();
    for (let i = 0; i < 4; i++) {
      const ctx = await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 }, locale: 'bn-BD', colorScheme: o.colorScheme, hasTouch: o.hasTouch });
      if (o.theme) await ctx.addInitScript((t) => { try { localStorage.setItem('theme', t); } catch { /* */ } }, o.theme);
      const p = await ctx.newPage();
      p.on('pageerror', (e) => { n++; kinds.add(String(e).match(/#\d+/)?.[0] ?? 'x'); });
      await p.goto(`${BASE}/`, { waitUntil: 'networkidle' }); await p.waitForTimeout(1500);
      await ctx.close();
    }
    console.log(label, 'pageerrors', n, [...kinds].join(','));
  }
  await b.close();
})().finally(() => db.$disconnect());
