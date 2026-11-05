// ★ রেসপনসিভ ম্যাট্রিক্স — ৫ ভিউপোর্ট × light/dark × মূল স্ক্রিন; অনুভূমিক ওভারফ্লো গোনা হয়
//   কেবল সিম-রিগ ও সিম-DB; headed Chrome (ws.txt)-এ চলে, মালিক দেখতে পান।
import { db, BASE, mintCookie } from '../_lib';
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';

const OUT = 'audit/sim/matrix';
mkdirSync(OUT, { recursive: true });
const VIEWPORTS = [[390, 844], [430, 932], [768, 1024], [1366, 768], [1440, 900]] as const;
const THEMES = ['light', 'dark'] as const;

async function addCookie(ctx: BrowserContext, cookie: string) {
  const [k, ...v] = cookie.split('=');
  await ctx.addCookies([{ name: k, value: v.join('='), domain: 'localhost', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' }]);
}
const settle = async (p: Page) => { await p.waitForLoadState('domcontentloaded').catch(() => {}); await p.waitForFunction(() => !document.getElementById('v-boot'), null, { timeout: 20_000 }).catch(() => {}); await p.waitForTimeout(700); };

(async () => {
  const browser = await chromium.connect(readFileSync('ws.txt', 'utf8').trim());
  const cust = await db.user.findFirstOrThrow({ where: { email: { startsWith: 'visible-' } }, orderBy: { createdAt: 'desc' } });
  const ord = await db.order.findFirstOrThrow({ where: { userId: cust.id }, orderBy: { createdAt: 'desc' } });
  const product = await db.product.findFirstOrThrow({ where: { isActive: true, needsUid: true } });
  const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin@uidtopup.local' } });
  const custCookie = await mintCookie(cust);
  const adminCookie = await mintCookie(admin);

  const SCREENS: { name: string; path: string; who: 'guest' | 'cust' | 'admin' }[] = [
    { name: 'home', path: '/', who: 'guest' },
    { name: 'login', path: '/login', who: 'guest' },
    { name: 'product', path: `/product/${product.id}/${encodeURIComponent(product.slug)}`, who: 'cust' },
    { name: 'deposit', path: '/account/wallet/deposit', who: 'cust' },
    { name: 'orders', path: '/account/orders', who: 'cust' },
    { name: 'order-detail', path: `/account/orders/${ord.id}`, who: 'cust' },
    { name: 'track', path: '/track', who: 'guest' },
    { name: 'admin-orders', path: `/admin/orders?order=${ord.id}`, who: 'admin' },
    { name: 'admin-deposits', path: '/admin/deposits', who: 'admin' },
  ];

  const rows: string[] = ['screen\tviewport\ttheme\toverflowPx\tstatus'];
  for (const theme of THEMES) {
    for (const [w, h] of VIEWPORTS) {
      const mobile = w < 768;
      const ctxs: Record<string, BrowserContext> = {};
      for (const who of ['guest', 'cust', 'admin']) {
        const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile });
        await ctx.addInitScript(`try { localStorage.setItem('theme', '${theme}'); } catch {}`);
        if (who === 'cust') await addCookie(ctx, custCookie);
        if (who === 'admin') await addCookie(ctx, adminCookie);
        ctxs[who] = ctx;
      }
      for (const s of SCREENS) {
        const p = await ctxs[s.who].newPage();
        const res = await p.goto(`${BASE}${s.path}`).catch(() => null);
        await settle(p);
        const over = Number(await p.evaluate('Math.max(0, document.documentElement.scrollWidth - window.innerWidth)'));
        const f = `${OUT}/${s.name}-${w}x${h}-${theme}.png`;
        await p.screenshot({ path: f });
        const status = res?.status() ?? 0;
        rows.push(`${s.name}\t${w}x${h}\t${theme}\t${over}\t${status}`);
        console.log(`[SCREENSHOT] ${f}${over ? `  ⚠️ overflow ${over}px` : ''}${status >= 400 ? `  ⚠️ HTTP ${status}` : ''}`);
        await p.close();
      }
      for (const c of Object.values(ctxs)) await c.close();
    }
  }
  writeFileSync(`${OUT}/matrix.tsv`, rows.join('\n'));
  const bad = rows.slice(1).filter((r) => { const [, , , o, st] = r.split('\t'); return Number(o) > 0 || Number(st) >= 400; });
  console.log(`[VERIFY] ${rows.length - 1} স্ক্রিনশট; সমস্যা: ${bad.length}`);
  bad.forEach((b) => console.log(`  ${b}`));
  await db.$disconnect(); process.exit(0);
})().catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1); });
