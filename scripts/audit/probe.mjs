/**
 * ★ এক-পাতা মাপজোখের ছোট যন্ত্র — অডিটে কিছু সন্দেহজনক দেখলে
 *   এখানে সেটি হাতে-কলমে যাচাই করা হয়।
 *
 *   node scripts/audit/probe.mjs <route> <width> [selector]
 *   উদাহরণ: node scripts/audit/probe.mjs / 390 "a.fnav"
 */
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';

const [route = '/', width = '390', selector = ''] = process.argv.slice(2);
const BASE = process.env.AUDIT_BASE || 'http://localhost:3000';
const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
].find(existsSync);

const browser = await chromium.launch({ headless: true, executablePath: CHROME });
const ctx = await browser.newContext({
  viewport: { width: Number(width), height: 844 },
  isMobile: true, hasTouch: true, deviceScaleFactor: 2, ignoreHTTPSErrors: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
});
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.log('  [console]', m.text().slice(0, 300)); });
await page.goto(BASE + route, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(`!document.getElementById('v-boot')`, null, { timeout: 45000 }).catch(() => {});
await page.waitForTimeout(600);

if (selector) {
  const out = await page.evaluate((sel) => {
    return [...document.querySelectorAll(sel)].map((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        text: (el.textContent || '').trim().slice(0, 40),
        x: Math.round(r.x), y: Math.round(r.y),
        w: Math.round(r.width), h: Math.round(r.height),
        display: cs.display, fontSize: cs.fontSize, minHeight: cs.minHeight,
        whiteSpace: cs.whiteSpace, overflow: cs.overflow,
      };
    });
  }, selector);
  console.log(JSON.stringify(out, null, 1));
} else {
  const out = await page.evaluate(() => ({
    vw: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    bodyStyle: document.body.getAttribute('style'),
  }));
  console.log(JSON.stringify(out, null, 1));
}

await browser.close();
