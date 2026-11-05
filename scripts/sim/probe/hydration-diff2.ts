import { db, BASE } from '../_lib';
import { firefox } from 'playwright-core';
(async () => {
  const b = await firefox.launch({ headless: true });
  const opts = { ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 }, locale: 'bn-BD', colorScheme: 'dark' as const, hasTouch: true };
  for (let i = 0; i < 3; i++) {
    const ctx = await b.newContext(opts);
    await ctx.addInitScript(() => { try { localStorage.setItem('theme', 'dark'); } catch { /* */ } });
    const p = await ctx.newPage(); let errs = 0; p.on('pageerror', () => errs++);
    const resp = await p.goto(`${BASE}/`, { waitUntil: 'commit' });
    const html = await resp!.text();
    await p.waitForLoadState('networkidle'); await p.waitForTimeout(2000);
    const client = (await p.locator('body').innerText()).split('\n').map((s) => s.trim()).filter(Boolean);
    const serverText = html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, '\n').split('\n').map((s) => s.trim()).filter(Boolean);
    const sset = new Set(serverText);
    console.log(`run ${i} errors ${errs} · কেবল ক্লায়েন্টে:`, JSON.stringify(client.filter((l) => !sset.has(l) && l.length < 80).slice(0, 12)));
    await ctx.close();
  }
  await b.close();
})().finally(() => db.$disconnect());
