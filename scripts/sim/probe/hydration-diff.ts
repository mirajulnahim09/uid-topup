// ★ Firefox-এ হাইড্রেশন-অমিল কোথায় — সার্ভার-HTML (JS বন্ধ) বনাম হাইড্রেটেড DOM-এর লেখা
import { db, BASE } from '../_lib';
import { firefox } from 'playwright-core';
(async () => {
  const b = await firefox.launch({ headless: true });
  const opts = { ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 }, locale: process.env.LOC || 'bn-BD', timezoneId: process.env.TZ_ID || undefined };
  const noJs = await b.newContext({ ...opts, javaScriptEnabled: false });
  const p1 = await noJs.newPage(); await p1.goto(`${BASE}/`, { waitUntil: 'load' });
  const server = (await p1.locator('body').innerText()).split('\n').map((s) => s.trim()).filter(Boolean);
  const js = await b.newContext(opts);
  const p2 = await js.newPage(); const errs: string[] = [];
  p2.on('pageerror', (e) => errs.push(String(e).slice(0, 80)));
  await p2.goto(`${BASE}/`, { waitUntil: 'networkidle' }); await p2.waitForTimeout(2500);
  const client = (await p2.locator('body').innerText()).split('\n').map((s) => s.trim()).filter(Boolean);
  const sset = new Set(server), cset = new Set(client);
  console.log('locale', opts.locale, 'errors', errs.length);
  console.log('কেবল সার্ভারে:', JSON.stringify(server.filter((l) => !cset.has(l)).slice(0, 15)));
  console.log('কেবল ক্লায়েন্টে:', JSON.stringify(client.filter((l) => !sset.has(l)).slice(0, 15)));
  await b.close();
})().finally(() => db.$disconnect());
