/**
 * ভূমিকা-রঙ (--sem-*) মাইগ্রেশনের **দৃশ্য**-যাচাই।
 *
 * মাপা আর দেখা এক জিনিস নয়: `semantic-tokens.ts` প্রমাণ করে মানগুলো
 * ঠিক, কিন্তু "নতুন রঙ চোখে কেমন" সেটি নয়। এই স্ক্রিপ্টটি ঠিক সেই
 * ছয়টি পর্দা তোলে যেখানে শাখাগুলো ফোটে — দুই থিমে।
 *
 * ⚠️ আগে `_fixture-semantic.ts` চালাতে হবে, নাহলে অর্ধেক পর্দা খালি।
 *
 *   SEM_BREACHED=<orderId> SEM_REFUNDED=<orderId> node scripts/audit/_semshots.mjs
 */
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';

const BASE = process.env.AUDIT_BASE || 'https://localhost:3443';
const DIR = 'audit/shots';
if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].find(existsSync);

const BREACHED = process.env.SEM_BREACHED || '';
const REFUNDED = process.env.SEM_REFUNDED || '';
const CUSTOMER = { email: 'semtok.customer@dev.local', password: 'Customer@2026Secure' };
const ADMIN = { email: 'admin@uidtopup.local', password: 'Admin@2026Secure' };

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--ignore-certificate-errors'] });

async function settle(page) {
  await page.waitForSelector('#v-boot', { state: 'detached', timeout: 30000 }).catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(600);
}

async function login(page, who) {
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
  await settle(page);
  await page.fill('#email', who.email);
  await page.fill('#pw', who.password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await settle(page);
}

async function shoot(page, url, name, full = false) {
  await page.goto(BASE + url, { waitUntil: 'domcontentloaded' });
  await settle(page);
  // ★ গ্রাহকের অর্ডার-পাতায় SLA/বাতিল ব্লক ভাঁজের নিচে — fullPage ছাড়া
  //   শটে আসেই না (প্রথমবার তা-ই হয়েছিল, আর মনে হচ্ছিল রেন্ডারই হয়নি)।
  await page.screenshot({ path: `${DIR}/${name}.png`, fullPage: full });
  console.log(`  ✓ ${name}`);
}

for (const theme of ['light', 'dark']) {
  // ── অ্যাডমিন ──
  let ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, ignoreHTTPSErrors: true });
  let page = await ctx.newPage();
  await page.addInitScript((t) => { try { localStorage.setItem('theme', t); } catch {} }, theme);
  await login(page, ADMIN);
  await shoot(page, '/admin/orders', `sem-admin-orders-${theme}`);
  await shoot(page, '/admin/deposits', `sem-admin-deposits-${theme}`);
  await shoot(page, '/admin/payments', `sem-admin-payments-${theme}`);
  await ctx.close();

  // ── গ্রাহক ──
  ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true });
  page = await ctx.newPage();
  await page.addInitScript((t) => { try { localStorage.setItem('theme', t); } catch {} }, theme);
  await login(page, CUSTOMER);
  if (BREACHED) await shoot(page, `/account/orders/${BREACHED}`, `sem-order-late-${theme}`, true);
  if (REFUNDED) await shoot(page, `/account/orders/${REFUNDED}?placed=1`, `sem-order-refunded-${theme}`, true);
  await shoot(page, '/account/wallet/deposit', `sem-wallet-deposit-${theme}`, true);
  await ctx.close();
}

await browser.close();
console.log('শট শেষ → audit/shots/sem-*.png');
