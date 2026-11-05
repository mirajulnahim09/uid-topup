/** sand→--gold মাইগ্রেশনের দৃশ্য-যাচাই: যে পর্দাগুলোয় আভা বদলেছে */
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';
const BASE = process.env.AUDIT_BASE || 'https://localhost:3443';
const DIR = 'audit/shots';
if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
const CUSTOMER = { email: 'customer@uidtopup.local', password: 'Customer@2026Secure' };
const ADMIN = { email: 'admin@uidtopup.local', password: 'Admin@2026Secure' };

const browser = await chromium.launch({ executablePath: CHROME, headless: true });

async function login(page, who) {
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#v-boot', { state: 'detached', timeout: 20000 }).catch(() => {});
  await page.fill('input[type="email"]', who.email);
  await page.fill('input[type="password"]', who.password);
  await Promise.all([page.waitForNavigation({ timeout: 30000 }).catch(() => {}), page.click('button[type="submit"]')]);
  await page.waitForTimeout(1500);
}

for (const theme of ['light', 'dark']) {
  // ── গ্রাহক ──
  let ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true });
  let page = await ctx.newPage();
  await page.addInitScript(t => { try { localStorage.setItem('theme', t); } catch {} }, theme);
  await page.goto(BASE + '/track', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${DIR}/gold-track-${theme}.png` });
  await login(page, CUSTOMER);
  await page.goto(BASE + '/account', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${DIR}/gold-account-${theme}.png` });
  console.log(`  ✓ ${theme}: track · account`);
  await ctx.close();

  // ── অ্যাডমিন ──
  ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true });
  page = await ctx.newPage();
  await page.addInitScript(t => { try { localStorage.setItem('theme', t); } catch {} }, theme);
  await login(page, ADMIN);
  await page.goto(BASE + '/admin/deposits', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${DIR}/gold-deposits-${theme}.png` });
  console.log(`  ✓ ${theme}: admin/deposits`);
  await ctx.close();
}
await browser.close();
console.log('শট শেষ → audit/shots/gold-*.png');
