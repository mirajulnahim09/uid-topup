/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ D5 — ফ্রন্টএন্ড-ব্যাকএন্ড সিঙ্ক (আসল Chrome, ধীর 3G)
 *
 *   D5-2 — ডাবল-সাবমিট: দুটি সাবমিট **একই ফ্রেমে** (ধীর ফোনে মেইন-থ্রেড জ্যামে
 *   জমে থাকা দুটি ট্যাপ ঠিক এভাবেই আসে — React `disabled` বসার আগে)। দাবি:
 *   নেটওয়ার্কে একটিই POST যায়, আর গ্রাহক নিজের সফল জমার পরে "TrxID আগে
 *   ব্যবহার হয়েছে" ধরনের বিভ্রান্তিকর ত্রুটি দেখেন না।
 *
 *   D5-1 — Vercel 504 (HTML/টেক্সট বডি, JSON নয়): **রিগ্রেশন-পাহারা।** অডিটে
 *   অনুমান করা হয়েছিল গ্রাহক "Unexpected token" দেখেন — মাপে ভুল প্রমাণিত:
 *   `Toast` আগে থেকেই `friendlyError()` দিয়ে বাংলা করে, আর স্পিনার থামে।
 * ═══════════════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { chromium, type Page } from 'playwright-core';
import { db } from '../vitest.setup';
import { baseUrl } from './helpers/app';
import { createUser, DEFAULT_PASSWORD } from './helpers/factories';

const EXE = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium',
].find(existsSync);

let seq = 0;
const trx = () => `UX${Date.now().toString(36).toUpperCase()}${seq++}`;

/** ★ Chrome DevTools-এর "Slow 3G" প্রিসেট */
async function slow3g(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false, latency: 400, downloadThroughput: (400 * 1024) / 8, uploadThroughput: (400 * 1024) / 8,
  });
}

async function openDepositForm() {
  await db.paymentChannel.upsert({
    where: { id: 9001 }, update: { isActive: true },
    create: { id: 9001, method: 'BKASH', accountNo: '01711111111', isActive: true },
  });
  const user = await createUser(db, {});
  const browser = await chromium.launch({ headless: true, executablePath: EXE });
  const page = await browser.newPage();
  await page.goto(`${baseUrl()}/login`, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.locator('#v-boot').waitFor({ state: 'detached', timeout: 30_000 }).catch(() => {});
  await page.fill('#email', user.email);
  await page.fill('#pw', user.plainPassword ?? DEFAULT_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 45_000 });
  await page.goto(`${baseUrl()}/account/wallet/deposit`, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.locator('#v-boot').waitFor({ state: 'detached', timeout: 30_000 }).catch(() => {});
  await page.locator('[role=radiogroup] [role=radio]').first().click();
  await page.fill('#amt', '100');
  await page.fill('#trx', trx());
  await page.fill('#snd', '01712345678');
  return { browser, page, user };
}

const toasts = (page: Page) =>
  page.locator('[role=status], [role=alert]').allInnerTexts().then((t) => t.join(' | '));

describe.skipIf(!EXE)('D5 — আসল ব্রাউজারে UX-কেয়স', () => {
  it('D5-2 ডাবল-সাবমিট (একই ফ্রেমে ২টি, ধীর 3G) → নেটওয়ার্কে ১টি POST, বিভ্রান্তিকর ত্রুটি নেই', async () => {
    const { browser, page, user } = await openDepositForm();
    try {
      await slow3g(page);
      let posts = 0;
      page.on('request', (r) => { if (r.method() === 'POST' && r.url().endsWith('/api/deposit')) posts++; });

      await page.evaluate(() => {
        const f = document.querySelector('form[aria-labelledby="d2"]') as HTMLFormElement;
        f.requestSubmit();
        f.requestSubmit();
      });
      await page.waitForTimeout(8000);

      const t = await toasts(page);
      const rows = await db.deposit.count({ where: { userId: user.id } });
      console.log(`[D5-2] POSTs=${posts} rows=${rows} toasts="${t}"`);
      expect(rows).toBe(1);
      expect(posts).toBe(1);
      expect(t).not.toMatch(/আগে ব্যবহার/);
    } finally {
      await browser.close();
    }
  });

  it('D5-1 (রিগ্রেশন) Vercel 504 টেক্সট-বডি → বাংলা বার্তা (friendlyError), কাঁচা JS-ত্রুটি নয়, স্পিনার থামে', async () => {
    const { browser, page } = await openDepositForm();
    try {
      await page.route('**/api/deposit', (route) =>
        route.fulfill({
          status: 504, contentType: 'text/plain',
          body: 'An error occurred with your deployment\n\nFUNCTION_INVOCATION_TIMEOUT\nbom1::abcde-123',
        }));
      await page.click('form[aria-labelledby="d2"] button[type="submit"]');
      await page.waitForTimeout(2500);

      const t = await toasts(page);
      const btn = page.locator('form[aria-labelledby="d2"] button[type="submit"]');
      console.log(`[D5-1] toast="${t}" disabled=${await btn.isDisabled()} label="${await btn.innerText()}"`);
      expect(t).not.toMatch(/Unexpected token|JSON|SyntaxError|is not valid/i);
      // ★ আগে থেকেই সমাধান ছিল (`Toast` → `friendlyError`) — এটি কেবল তা পাহারা দেয়
      expect(t).toContain('সার্ভার এই মুহূর্তে সাড়া দিচ্ছে না');
      expect(await btn.isDisabled()).toBe(false);
    } finally {
      await browser.close();
    }
  });
});
