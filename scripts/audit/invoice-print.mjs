/** এককালীন: চালান-পাতা চোখে দেখা — পর্দায় ও কাগজে (print media) */
import { chromium } from 'playwright-core';
import { readFileSync, existsSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

const BASE = 'https://localhost:3443';
const OUT = process.argv[2] || 'audit/shots';
const db = new PrismaClient({ datasources: { db: { url: 'postgresql://dev:dev@localhost:5434/uidtopup_dev' } } });

const cust = await db.user.findUnique({ where: { email: 'customer@uidtopup.local' }, select: { id: true } });
const order = await db.order.findFirst({ where: { userId: cust.id }, orderBy: { createdAt: 'desc' }, select: { id: true } });
await db.rateLimitBucket.deleteMany({});
await db.$disconnect();

const ws = 'ws.txt';
const browser = existsSync(ws) ? await chromium.connect(readFileSync(ws, 'utf8').trim()) : await chromium.launch({ headless: true });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1024, height: 1400 } });
const page = await ctx.newPage();

await page.goto(`${BASE}/login?callbackUrl=%2Faccount`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(`!document.getElementById('v-boot')`, null, { timeout: 30000 }).catch(() => {});
await page.fill('input[type="email"]', 'customer@uidtopup.local');
await page.fill('input[type="password"]', 'Customer@2026Secure');
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 }).catch(() => {});

const url = `${BASE}/account/orders/${order.id}/invoice`;
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/invoice-screen.png`, fullPage: true });

// ── কাগজ: print media + A4 প্রস্থ (৯৬dpi তে ২১cm ≈ ৭৯৪px) ──
await page.emulateMedia({ media: 'print' });
await page.setViewportSize({ width: 794, height: 1123 });
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/invoice-print.png`, fullPage: true });
const pdf = await page.pdf({ format: 'A4', printBackground: true }).catch((e) => String(e).slice(0, 120));
if (typeof pdf !== 'string') {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(`${OUT}/invoice.pdf`, pdf);
  console.log('pdf pages saved');
} else console.log('pdf skipped:', pdf);

// ★ কাগজে কী গেল তার জ্যামিতি — চোখের পাশাপাশি সংখ্যাও
const geo = await page.evaluate(`(() => {
  const sheet = document.querySelector('.invoice-sheet');
  const r = sheet ? sheet.getBoundingClientRect() : null;
  const hidden = [...document.querySelectorAll('.print\\\\:hidden')].length;
  const wide = [...document.querySelectorAll('body *')].filter(function (e) {
    const b = e.getBoundingClientRect();
    return b.width > 794 + 1 && getComputedStyle(e).position !== 'fixed';
  }).map(function (e) { return e.tagName.toLowerCase() + '.' + String(e.className).split(' ').slice(0,2).join('.') + ' w=' + Math.round(e.getBoundingClientRect().width); });
  return { sheet: r ? { w: Math.round(r.width), h: Math.round(r.height) } : null, printHiddenCount: hidden, widerThanPage: wide.slice(0, 6), docH: document.documentElement.scrollHeight };
})()`);
console.log(JSON.stringify(geo, null, 1));

await ctx.close();
await browser.close().catch(() => {});
