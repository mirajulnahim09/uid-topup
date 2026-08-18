/**
 * ★ স্ক্রিনশট সংগ্রাহক — চোখে দেখে যাচাইয়ের জন্য।
 *
 *   স্বয়ংক্রিয় মাপ "৩৯০px-এ আঁটে" প্রমাণ করে; সেটি "৩৯০px ফোনের
 *   জন্য পেশাদারভাবে নকশা করা" প্রমাণ করে না। তাই প্রতিটি পাসের
 *   পরে এই ছবিগুলো হাতে দেখা হয়।
 *
 *   node scripts/audit/shots.mjs <persona> <width> [--full]
 *     persona: anon | customer | admin
 */
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

const [persona = 'anon', width = '390', ...flags] = process.argv.slice(2);
const FULL = flags.includes('--full');
const TAG = process.env.SHOT_TAG || 'now';
const BASE = process.env.AUDIT_BASE || 'http://localhost:3000';
const THEME = process.env.AUDIT_THEME || '';
const DIR = `audit/shots/${TAG}`;

const DEV_URL = 'postgresql://dev:dev@localhost:5434/uidtopup_dev';
const db = new PrismaClient({ datasources: { db: { url: DEV_URL } } });

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
].find(existsSync);

const CREDS = {
  customer: { email: 'customer@uidtopup.local', password: 'Customer@2026Secure' },
  admin: { email: 'admin@uidtopup.local', password: 'Admin@2026Secure' },
};

const ROUTES = {
  anon: ['/', '/login', '/register', '/track', '/contact', '/faq', '/search?q=diamond'],
  customer: ['/account', '/account/orders', '/account/wallet', '/account/wallet/deposit',
             '/account/wallet/withdraw', '/account/profile', '/account/tickets', '/account/notifications'],
  admin: ['/admin', '/admin/orders', '/admin/deposits', '/admin/users', '/admin/products',
          '/admin/withdrawals', '/admin/site', '/admin/reports'],
};

mkdirSync(DIR, { recursive: true });

const browser = await chromium.launch({ headless: true, executablePath: CHROME });
const ctx = await browser.newContext({
  viewport: { width: Number(width), height: 844 },
  isMobile: Number(width) < 768, hasTouch: Number(width) < 768,
  deviceScaleFactor: 2, ignoreHTTPSErrors: true,
  ...(Number(width) < 768 ? { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' } : {}),
});
if (THEME) await ctx.addInitScript(`try { localStorage.setItem('theme', ${JSON.stringify(THEME)}); } catch {}`);
const page = await ctx.newPage();

async function settle() {
  await page.waitForFunction(`!document.getElementById('v-boot')`, null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(700);
}

if (CREDS[persona]) {
  await db.$executeRawUnsafe('DELETE FROM "RateLimitBucket"').catch(() => {});
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await settle();
  await page.fill('input[type="email"]', CREDS[persona].email);
  await page.fill('input[type="password"]', CREDS[persona].password);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 40000 }).catch(() => {});
  await settle();
  console.log(`লগইন → ${page.url()}`);
}

let productRoute = null;
try {
  const p = await db.product.findFirst({ where: { isActive: true }, select: { id: true, slug: true } });
  if (p) productRoute = `/product/${p.id}/${p.slug}`;
} catch { /* */ }

/** ★ `SHOT_ROUTES=/,/login` — কেবল এই রুটগুলো */
const list = process.env.SHOT_ROUTES
  ? process.env.SHOT_ROUTES.split(',').map((s) => s.trim()).filter(Boolean)
  : [...ROUTES[persona]];
if (!process.env.SHOT_ROUTES && persona === 'anon' && productRoute) list.push(productRoute);

/** ★ `--scroll` — পুরো পাতাকে ভিউপোর্ট-সমান টুকরোয় ভাগ করে ছবি তোলে।
 *   একটি ৬৮০০px লম্বা fullPage ছবি চোখে পড়া যায় না; পর পর কয়েকটি
 *   ফোন-পর্দার ছবি ঠিক যা ব্যবহারকারী দেখেন তা-ই দেখায়। */
const SCROLL = flags.includes('--scroll');

for (const r of list) {
  await page.goto(BASE + r, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await settle();
  const name = `${persona}-${width}${THEME ? '-' + THEME : ''}${r.replace(/[^\w]+/g, '_')}`;
  const h = await page.evaluate(`document.documentElement.scrollHeight`);
  if (SCROLL) {
    const vh = 844;
    const steps = Math.min(8, Math.ceil(h / vh));
    for (let i = 0; i < steps; i++) {
      await page.evaluate(`window.scrollTo(0, ${i * vh})`);
      await page.waitForTimeout(450);
      await page.screenshot({ path: `${DIR}/${name}--${i}.png` }).catch(() => {});
    }
    await page.evaluate(`window.scrollTo(0, 0)`);
    console.log(`  ${r.padEnd(34)} উচ্চতা ${h}px  → ${name}--0..${steps - 1}.png`);
  } else {
    await page.screenshot({ path: `${DIR}/${name}.png`, fullPage: FULL }).catch(() => {});
    console.log(`  ${r.padEnd(34)} উচ্চতা ${h}px  → ${name}.png`);
  }
}

await browser.close();
await db.$disconnect();
