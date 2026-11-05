// ★ REAL-USER অডিট — প্রতিটি পাতার ফুল-পেজ স্ক্রিনশট (৩৯০ ডার্ক, ১৪৪০ লাইট)
import { db, BASE, mintCookie } from '../_lib';
import { openBrowser } from '../../verify/_browser';
import { mkdirSync } from 'node:fs';
import type { Page } from 'playwright-core';

const PUBLIC = ['/', '/register', '/login', '/forgot-password', '/track', '/faq', '/contact', '/refund', '/terms', '/search?q=free', '/product/99999'];
const CUSTOMER = ['/account', '/account/orders', '/account/wallet/deposit', '/account/wallet/withdraw', '/account/tickets', '/account/notifications', '/account/profile', '/account/smm-orders'];
const ADMIN = ['/admin', '/admin/orders?status=PENDING', '/admin/deposits', '/admin/users', '/admin/logs', '/admin/tickets', '/admin/withdrawals', '/admin/products'];

async function settle(p: Page) {
  await p.waitForLoadState('domcontentloaded').catch(() => {});
  await p.waitForFunction(() => !document.getElementById('v-boot'), null, { timeout: 20_000 }).catch(() => {});
  await p.waitForTimeout(600);
}

(async () => {
  const b = await openBrowser({ headless: true });
  const cust = await db.user.findFirstOrThrow({ where: { email: { startsWith: 'sim-' }, orders: { some: {} }, balance: { gt: 50 } } });
  const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin@uidtopup.local' } });
  const product = await db.product.findFirstOrThrow({ where: { isActive: true, needsUid: true } });
  const order = await db.order.findFirstOrThrow({ where: { userId: cust.id }, orderBy: { createdAt: 'desc' } });
  const sets: Array<[string, string[], string | null]> = [
    ['public', [...PUBLIC, `/product/${product.id}/${encodeURIComponent(product.slug)}`], null],
    ['customer', [...CUSTOMER, `/account/orders/${order.id}`], await mintCookie(cust)],
    ['admin', [...ADMIN, `/admin/users/${cust.id}`], await mintCookie(admin)],
  ];
  for (const [vw, theme] of [[390, 'dark'], [1440, 'light']] as const) {
    for (const [name, paths, cookie] of sets) {
      const ctx = await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: vw, height: vw < 800 ? 844 : 900 }, colorScheme: theme, isMobile: vw < 800, hasTouch: vw < 800 });
      await ctx.addInitScript((t) => { try { localStorage.setItem('theme', t); } catch { /* */ } }, theme);
      if (cookie) {
        const [k, ...v] = cookie.split('=');
        await ctx.addCookies([{ name: k, value: v.join('='), domain: 'localhost', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' }]);
      }
      const p = await ctx.newPage();
      const dir = `audit/sim/tour/${theme}-${vw}/${name}`;
      mkdirSync(dir, { recursive: true });
      let i = 0;
      for (const path of paths) {
        await p.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
        await settle(p);
        const file = `${dir}/${String(++i).padStart(2, '0')}-${path.replace(/[^a-z0-9]+/gi, '_').slice(0, 40) || 'home'}.png`;
        await p.screenshot({ path: file, fullPage: true });
        console.log(file);
      }
      await ctx.close();
    }
  }
  await b.close();
})().finally(() => db.$disconnect());
