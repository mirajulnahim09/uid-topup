/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ ধীর নেটওয়ার্কে সত্য বলা — লোডিং, ডুপ্লিকেট, বাসি অবস্থা
 *
 *   `npx tsx scripts/verify/slow-network.ts`
 *
 *   দ্রুত সংযোগে প্রায় সব UI ঠিক দেখায়। সমস্যাগুলো বেরোয় ধীর
 *   সংযোগে — আর এই বাজারের গ্রাহক প্রায়ই ২G/৩G-তে। CDP দিয়ে
 *   সত্যিকারের থ্রটলিং বসিয়ে চারটি দাবি মাপা হয়:
 *
 *     ১. **লোডিং অ্যানিমেশন আগে শেষ হয় না** — অনুরোধের উত্তর আসার
 *        আগেই ওভারলে মিলিয়ে গেলে গ্রাহক ভাবেন কাজ শেষ, অথচ হয়নি
 *     ২. **দুইবার ক্লিকে দুটি সারি তৈরি হয় না** — ধীর সংযোগে
 *        অধৈর্য ক্লিকই স্বাভাবিক আচরণ
 *     ৩. **বুট-পর্দা হাইড্রেশনের আগে সরে না** — সরলে ফাঁকা/মৃত পাতা
 *     ৪. **অবস্থা বাসি থাকে না** — কাজের পর রিলোডে DB-র সত্যিটাই দেখায়
 *
 *   ⚠️ থ্রটলিং প্রকৃত CDP `Network.emulateNetworkConditions` দিয়ে,
 *      কৃত্রিম `setTimeout` দিয়ে নয় — নাহলে যা মাপা হচ্ছে তা বাস্তব নয়।
 * ═══════════════════════════════════════════════════════════
 */
import { db, dbLabel } from './_db';

import { chromium, type Browser, type Page } from 'playwright-core';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { issueOtp } from '../../src/lib/otp/core';

const BASE = process.env.VERIFY_BASE || 'https://localhost:3443';
const TAG = `slow-${Date.now().toString(36)}`;
const EMAIL = `${TAG}@verify.local`;
const PASSWORD = 'Verify@2026Pass';

let fail = 0;
let total = 0;
const check = (name: string, ok: boolean, note = '') => {
  total++;
  if (!ok) fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${note ? ` — ${note}` : ''}`);
};

/** ★ "Slow 3G" এর কাছাকাছি — Chrome DevTools যা ব্যবহার করে */
const SLOW = { offline: false, latency: 400, downloadThroughput: (500 * 1024) / 8, uploadThroughput: (500 * 1024) / 8 };

const go = async (page: Page, url: string) => {
  try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90_000 }); }
  catch (e) {
    if (!/ERR_SSL_PROTOCOL_ERROR|ERR_CONNECTION_RESET|ERR_EMPTY_RESPONSE|ERR_ABORTED/.test(String(e))) throw e;
    await page.waitForTimeout(600);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  }
};

const settle = async (page: Page) => {
  await page.waitForFunction(
    `!document.querySelector('.v-ovl') && !document.getElementById('v-boot')`, null, { timeout: 90_000 },
  ).catch(() => {});
  await page.waitForTimeout(300);
};

const clearRateLimits = () => db.$executeRawUnsafe('DELETE FROM "RateLimitBucket"').catch(() => {});

(async () => {
  console.log('═══ ধীর নেটওয়ার্কে যাচাই ═══');
  console.log(`  সার্ভার: ${BASE} · DB: ${dbLabel()}`);
  console.log(`  থ্রটলিং: ${Math.round(SLOW.downloadThroughput * 8 / 1024)}kbps · ${SLOW.latency}ms latency\n`);

  const wsPath = path.join(process.cwd(), 'ws.txt');
  let browser: Browser;
  if (existsSync(wsPath)) browser = await chromium.connect(readFileSync(wsPath, 'utf8').trim());
  else browser = await chromium.launch({
    headless: true,
    executablePath: ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(existsSync),
  });

  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  let userId = '';

  try {
    // ── অ্যাকাউন্ট তৈরি (স্বাভাবিক গতিতে — সেটআপ, যাচাই নয়) ──
    await go(page, `${BASE}/register`);
    await settle(page);
    await page.fill('#name', 'ধীর যাচাই');
    await page.fill('#email', EMAIL);
    await page.fill('#phone', `015${String(Date.now()).slice(-8)}`);
    await page.fill('#password', PASSWORD);
    const { code } = await issueOtp({ channel: 'EMAIL', purpose: 'REGISTER', destination: EMAIL, ip: '127.0.0.1' });
    await page.fill('#otp', code);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(2500);
    const u = await db.user.findUnique({ where: { email: EMAIL }, select: { id: true } });
    userId = u?.id ?? '';
    check('সেটআপ: অ্যাকাউন্ট তৈরি', Boolean(userId));

    await clearRateLimits();
    await go(page, `${BASE}/login?callbackUrl=%2Faccount`);
    await settle(page);
    await page.fill('input[type="email"]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL((u2) => !u2.pathname.startsWith('/login'), { timeout: 60_000 }).catch(() => {});
    await settle(page);

    // ═══ থ্রটলিং চালু ═══
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', SLOW);

    // ── ৩. বুট-পর্দা হাইড্রেশনের আগে সরে না ──
    console.log('\n── ৩. বুট-পর্দা ও হাইড্রেশন ──');
    await go(page, `${BASE}/account`);
    /**
     * ★ দাবি: `#v-boot` সরার মুহূর্তে React **জীবিত** থাকতে হবে।
     *   `BootDismiss` একটি ক্লায়েন্ট কম্পোনেন্টের `useEffect` —
     *   অর্থাৎ সে চললেই হাইড্রেশন হয়ে গেছে। উল্টোটা হলে (CSS-এর
     *   ৮s safety পথে সরলে) পাতা দেখা যেত কিন্তু ক্লিক কাজ করত না।
     */
    const bootGone = await page.waitForFunction(
      `!document.getElementById('v-boot')`, null, { timeout: 90_000 },
    ).then(() => true).catch(() => false);
    check('ধীর সংযোগেও বুট-পর্দা শেষ পর্যন্ত সরে', bootGone);

    const hydrated = await page.evaluate(`(function(){
      var el = document.querySelector('nav, header');
      if (!el) return false;
      return Object.keys(el).some(function(k){ return k.indexOf('__react') === 0; })
          || Object.keys(document.body).some(function(k){ return k.indexOf('__react') === 0; });
    })()`);
    check('পর্দা সরার পর React সত্যিই hydrate করেছে', Boolean(hydrated));

    // ── ১+২. লোডিং ওভারলে ও ডুপ্লিকেট সাবমিশন ──
    console.log('\n── ১+২. লোডিং ওভারলে ও দুইবার ক্লিক ──');
    await go(page, `${BASE}/account/wallet/deposit`);
    await settle(page);

    const trxId = `SLOW${Date.now().toString(36).toUpperCase()}`;
    const channel = page.locator('button[type="button"]').filter({ hasText: /bKash|Nagad|Rocket|বিকাশ|নগদ/i }).first();
    if (await channel.count()) await channel.click();
    await page.fill('#amt', '500');
    await page.fill('#trx', trxId);
    await page.fill('#snd', '01711111111');

    /**
     * ★ সময় মাপা হয় পাতার ভেতরে: POST এর উত্তর কখন এলো, আর
     *   ওভারলে কখন অদৃশ্য হলো। ওভারলে **আগে** মিলিয়ে গেলে
     *   অ্যানিমেশনটি মিথ্যা বলছে।
     */
    await page.evaluate(`(function(){
      window.__probe = { respAt: 0, overlayGoneAt: 0, overlaySeen: false };
      var of = window.fetch;
      window.fetch = function(){
        var args = arguments;
        var isDeposit = String(args[0]).indexOf('/api/deposit') === 0 && args[1] && args[1].method === 'POST';
        return of.apply(this, args).then(function(r){
          if (isDeposit) window.__probe.respAt = performance.now();
          return r;
        });
      };
      var seen = false;
      var iv = setInterval(function(){
        var has = !!document.querySelector('.v-ovl');
        if (has) { seen = true; window.__probe.overlaySeen = true; }
        else if (seen && !window.__probe.overlayGoneAt) {
          window.__probe.overlayGoneAt = performance.now();
          clearInterval(iv);
        }
      }, 20);
    })()`);

    // ★★★ দুইবার ক্লিক — ধীর সংযোগে অধৈর্য গ্রাহকের অনুকরণ
    const submit = page.locator('button[type="submit"]').last();
    await submit.click();
    await page.waitForTimeout(120);
    await submit.click({ force: true }).catch(() => {});
    await page.waitForTimeout(12_000);

    const probe = (await page.evaluate(`window.__probe`)) as
      { respAt: number; overlayGoneAt: number; overlaySeen: boolean };

    check('মিউটেশনে লোডিং ওভারলে দেখা গেছে', probe.overlaySeen === true);
    if (probe.overlaySeen && probe.respAt && probe.overlayGoneAt) {
      check('ওভারলে উত্তর আসার **আগে** মিলিয়ে যায় না',
        probe.overlayGoneAt >= probe.respAt - 50,
        `উত্তর ${Math.round(probe.respAt)}ms · ওভারলে গেল ${Math.round(probe.overlayGoneAt)}ms`);
    } else {
      check('ওভারলে উত্তর আসার আগে মিলিয়ে যায় না', false,
        `মাপা যায়নি (respAt=${Math.round(probe.respAt)} overlayGoneAt=${Math.round(probe.overlayGoneAt)})`);
    }

    const deposits = await db.deposit.count({ where: { userId } });
    check('দুইবার ক্লিকেও একটিই ডিপোজিট সারি', deposits === 1, `${deposits}টি সারি`);

    // ── ৪. বাসি অবস্থা নয় ──
    console.log('\n── ৪. রিলোডে বাসি অবস্থা নেই ──');
    await go(page, `${BASE}/account/wallet/deposit`);
    await settle(page);
    const dbTrx = await db.deposit.findFirst({ where: { userId }, select: { trxId: true, status: true } });
    check('জমা দেওয়া TrxID ডাটাবেসে আছে', dbTrx?.trxId === trxId, String(dbTrx?.trxId));
    check('ডিপোজিট PENDING অবস্থায়', dbTrx?.status === 'PENDING', String(dbTrx?.status));

    await go(page, `${BASE}/account`);
    await settle(page);
    const balShown = await page.evaluate(`document.body.innerText.includes('৳0.00') || document.body.innerText.includes('৳0')`);
    check('অনুমোদনের আগে ড্যাশবোর্ডে ব্যালেন্স ০ (বাসি/আগাম নয়)', Boolean(balShown));
  } finally {
    if (userId) {
      await db.deposit.deleteMany({ where: { userId } }).catch(() => {});
      await db.ledgerEntry.deleteMany({ where: { userId } }).catch(() => {});
      await db.notification.deleteMany({ where: { userId } }).catch(() => {});
    }
    await db.otp.deleteMany({ where: { destination: EMAIL } }).catch(() => {});
    await db.user.deleteMany({ where: { email: EMAIL } }).catch(() => {});
    console.log('\n  (যাচাই-ডেটা মুছে ফেলা হলো)');
    await ctx.close();
    await db.$disconnect();
  }

  console.log('\n════════════════════════════════════════');
  console.log(`  ${total - fail}/${total} পাস${fail ? ` · ${fail} ব্যর্থ` : ''}`);
  process.exit(fail ? 1 : 0);
})();
