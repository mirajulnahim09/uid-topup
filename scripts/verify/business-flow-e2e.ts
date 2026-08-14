/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ গ্রাহক → অ্যাডমিন — সম্পূর্ণ ব্যবসায়িক প্রবাহ, ব্রাউজারে
 *
 *   `npx tsx scripts/verify/business-flow-e2e.ts`
 *
 *   প্রোডাকশন বিল্ডের বিরুদ্ধে (https প্রক্সি), প্রতিটি ধাপ **UI দিয়ে**
 *   চালানো হয় এবং প্রতিটি ধাপের পর **ডাটাবেসের অবস্থা** মিলিয়ে দেখা হয়।
 *   "বোতামটি আছে" যথেষ্ট নয় — বোতামের ফল খতিয়ানে পৌঁছেছে কি না, সেটিই দাবি।
 *
 *     রেজিস্টার → লগইন → ড্যাশবোর্ড → ডিপোজিট জমা →
 *     অ্যাডমিন অনুমোদন → ব্যালেন্স ও খতিয়ান → প্রোডাক্ট বাছাই →
 *     অর্ডার (ওয়ালেট থেকে কাটা) → অ্যাডমিন ডেলিভারি →
 *     গ্রাহকের পাতায় অবস্থা
 *
 *   শেষে **খতিয়ান invariant**: SUM(LedgerEntry.amount) === User.balance
 *
 *   ⚠️ সব সারি শেষে মুছে ফেলা হয়। DB স্থানীয় না হলে `_db.ts` চলতেই দেয় না।
 * ═══════════════════════════════════════════════════════════
 */
import { db, dbLabel } from './_db';

import { chromium, type Browser, type Page } from 'playwright-core';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { issueOtp } from '../../src/lib/otp/core';

const BASE = process.env.VERIFY_BASE || 'https://localhost:3443';
const ADMIN = { email: 'admin@uidtopup.local', password: 'Admin@2026Secure' };
const TAG = `bflow-${Date.now().toString(36)}`;
const EMAIL = `${TAG}@verify.local`;
const PASSWORD = 'Verify@2026Pass';
const DEPOSIT_AMOUNT = 1000;

let fail = 0;
let total = 0;
const check = (name: string, ok: boolean, note = '') => {
  total++;
  if (!ok) fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${note ? ` — ${note}` : ''}`);
};

const go = async (page: Page, url: string) => {
  try { await page.goto(url, { waitUntil: 'domcontentloaded' }); }
  catch (e) {
    if (!/ERR_SSL_PROTOCOL_ERROR|ERR_CONNECTION_RESET|ERR_EMPTY_RESPONSE/.test(String(e))) throw e;
    await page.waitForTimeout(400);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
  }
};

const settle = async (page: Page) => {
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForFunction(
    `!document.querySelector('.v-ovl') && !document.getElementById('v-boot')`, null, { timeout: 30_000 },
  ).catch(() => {});
  await page.waitForTimeout(300);
};

/** ⚠️ ব্রুট-ফোর্স গার্ড যেন হারনেসকে না আটকায় (কারণ prod-auth-e2e.ts এ ব্যাখ্যা করা) */
const clearRateLimits = () => db.$executeRawUnsafe('DELETE FROM "RateLimitBucket"').catch(() => {});

async function login(page: Page, email: string, password: string, want: string) {
  await clearRateLimits();
  await go(page, `${BASE}/login?callbackUrl=${encodeURIComponent(want)}`);
  await settle(page);
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 }).catch(() => {});
  await settle(page);
  return new URL(page.url()).pathname;
}

(async () => {
  console.log('═══ গ্রাহক → অ্যাডমিন — সম্পূর্ণ প্রবাহ ═══');
  console.log(`  সার্ভার: ${BASE} · DB: ${dbLabel()}\n`);

  const wsPath = path.join(process.cwd(), 'ws.txt');
  let browser: Browser;
  if (existsSync(wsPath)) browser = await chromium.connect(readFileSync(wsPath, 'utf8').trim());
  else browser = await chromium.launch({
    headless: true,
    executablePath: ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(existsSync),
  });

  const ctxOpts = { ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } };
  const cust = await browser.newContext(ctxOpts);
  const adm = await browser.newContext(ctxOpts);
  const cp = await cust.newPage();
  const ap = await adm.newPage();

  let userId = '';
  const trxId = `T${Date.now().toString(36).toUpperCase()}`;

  try {
    // ═══ ১. রেজিস্ট্রেশন ═══
    console.log('── ১. রেজিস্ট্রেশন ──');
    await go(cp, `${BASE}/register`);
    await settle(cp);
    await cp.fill('#name', 'প্রবাহ যাচাই');
    await cp.fill('#email', EMAIL);
    await cp.fill('#phone', `018${String(Date.now()).slice(-8)}`);
    await cp.fill('#password', PASSWORD);
    const { code } = await issueOtp({ channel: 'EMAIL', purpose: 'REGISTER', destination: EMAIL, ip: '127.0.0.1' });
    await cp.fill('#otp', code);
    await cp.click('button[type="submit"]');
    await cp.waitForTimeout(2500);

    const u0 = await db.user.findUnique({ where: { email: EMAIL }, select: { id: true, balance: true } });
    check('অ্যাকাউন্ট তৈরি হয়েছে', Boolean(u0), u0 ? `ব্যালেন্স ৳${Number(u0.balance)}` : '—');
    check('নতুন অ্যাকাউন্টের ব্যালেন্স ০', Number(u0?.balance ?? -1) === 0);
    userId = u0!.id;

    // ═══ ২. লগইন ও ড্যাশবোর্ড ═══
    console.log('\n── ২. লগইন ও ড্যাশবোর্ড ──');
    check('লগইনের পর /account', (await login(cp, EMAIL, PASSWORD, '/account')).startsWith('/account'));

    // ═══ ৩. ডিপোজিট জমা (UI) ═══
    console.log('\n── ৩. ডিপোজিট জমা ──');
    await go(cp, `${BASE}/account/wallet/deposit`);
    await settle(cp);
    // ★ পেমেন্ট মাধ্যম বাছাই — প্রথম সক্রিয় চ্যানেল
    const channel = cp.locator('button[type="button"]').filter({ hasText: /bKash|Nagad|Rocket|বিকাশ|নগদ/i }).first();
    const hasChannel = (await channel.count()) > 0;
    check('অন্তত একটি পেমেন্ট চ্যানেল দেখা যাচ্ছে', hasChannel);
    if (hasChannel) await channel.click();
    await cp.fill('#amt', String(DEPOSIT_AMOUNT));
    await cp.fill('#trx', trxId);
    await cp.fill('#snd', '01711111111');
    await cp.click('button[type="submit"]');
    await cp.waitForTimeout(2500);

    const dep = await db.deposit.findFirst({
      where: { userId, trxId }, select: { id: true, status: true, amount: true, depositNo: true },
    });
    check('ডিপোজিট সারি তৈরি হয়েছে', Boolean(dep), dep ? `#${dep.depositNo} · ${dep.status}` : 'তৈরি হয়নি');
    check('ডিপোজিটের অবস্থা PENDING', dep?.status === 'PENDING', String(dep?.status));
    check('ডিপোজিটের অঙ্ক ঠিক', Number(dep?.amount) === DEPOSIT_AMOUNT, `৳${Number(dep?.amount)}`);
    check('অনুমোদনের আগে ব্যালেন্স বাড়েনি',
      Number((await db.user.findUnique({ where: { id: userId }, select: { balance: true } }))?.balance) === 0);

    // ═══ ৪. অ্যাডমিন অনুমোদন (UI) ═══
    console.log('\n── ৪. অ্যাডমিন অনুমোদন ──');
    check('অ্যাডমিন লগইন', (await login(ap, ADMIN.email, ADMIN.password, '/admin')).startsWith('/admin'));
    await go(ap, `${BASE}/admin/deposits`);
    await settle(ap);

    const card = ap.locator('article').filter({ hasText: trxId }).first();
    const found = (await card.count()) > 0;
    check('অ্যাডমিন সারিতে ডিপোজিটটি দেখা যাচ্ছে', found, found ? trxId : 'কার্ড পাওয়া যায়নি');

    if (found) {
      /**
       * ⚠️ অনুমোদন বোতামটি ইচ্ছাকৃতভাবে **নিষ্ক্রিয়** যতক্ষণ না সব
       *   সতর্কতা টিক দেওয়া হয় (DepositQueue.tsx §3.6 — টাকা ঢোকানোর
       *   দিকে বাড়তি ঘর্ষণ)। তাই আগে চেকবক্সগুলো, তারপর বোতাম,
       *   তারপর নিশ্চিতকরণ ডায়ালগ।
       */
      const boxes = card.locator('input[type="checkbox"]');
      const n = await boxes.count();
      for (let i = 0; i < n; i++) await boxes.nth(i).check().catch(() => {});
      const approve = card.locator('button', { hasText: /অনুমোদন/ }).first();
      await approve.click({ timeout: 10_000 }).catch(() => {});
      await ap.waitForTimeout(400);
      const confirm = ap.locator('button', { hasText: 'হ্যাঁ, অনুমোদন করুন' }).first();
      const confirmed = await confirm.click({ timeout: 10_000 }).then(() => true).catch(() => false);
      check('নিশ্চিতকরণ ডায়ালগে অনুমোদন করা গেছে', confirmed);
      await ap.waitForTimeout(2500);
    }

    const depAfter = await db.deposit.findFirst({ where: { userId, trxId }, select: { status: true } });
    check('ডিপোজিট APPROVED হয়েছে', depAfter?.status === 'APPROVED', String(depAfter?.status));

    const u1 = await db.user.findUnique({ where: { id: userId }, select: { balance: true } });
    check('ব্যালেন্স ঠিক ততটাই বেড়েছে', Number(u1?.balance) === DEPOSIT_AMOUNT, `৳${Number(u1?.balance)}`);

    const led1 = await db.ledgerEntry.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
    check('একটি DEPOSIT খতিয়ান এন্ট্রি', led1.length === 1 && led1[0].type === 'DEPOSIT',
      `${led1.length} টি · ${led1[0]?.type}`);
    check('খতিয়ানের balanceAfter ব্যালেন্সের সমান',
      Number(led1[0]?.balanceAfter) === Number(u1?.balance), `৳${Number(led1[0]?.balanceAfter)}`);

    // ═══ ৫. গ্রাহকের পাতায় ব্যালেন্স ═══
    console.log('\n── ৫. গ্রাহকের পাতায় ব্যালেন্স ──');
    await go(cp, `${BASE}/account`);
    await settle(cp);
    const shown = await cp.evaluate(`document.body.innerText.includes('1000') || document.body.innerText.includes('১০০০')`);
    check('ড্যাশবোর্ডে হালনাগাদ ব্যালেন্স দেখা যাচ্ছে', Boolean(shown));

    // ═══ ৬. প্রোডাক্ট বাছাই ও অর্ডার ═══
    console.log('\n── ৬. অর্ডার ──');
    /**
     * ⚠️ `stock: { gt: 0 }` **ভুল শর্ত**। এই ডোমেইনে `stock === 0`
     *   মানে শেষ, আর **ঋণাত্মক মানে সীমাহীন** (`services/order.ts`:
     *   `if (liveStock === 0) throw` এবং `if (liveStock > 0)` হলেই কেবল
     *   decrement)। আসল ক্যাটালগের প্রায় সব ভ্যারিয়েন্টে `stock = -1`,
     *   তাই আগের শর্তে "কেনার মতো কিছু নেই" আসত — ডেটা নয়, প্রশ্নটাই ভুল ছিল।
     */
    const variant = await db.variant.findFirst({
      where: { isActive: true, stock: { not: 0 }, price: { lte: DEPOSIT_AMOUNT }, product: { isActive: true } },
      select: { id: true, price: true, label: true, product: { select: { id: true, slug: true, name: true } } },
      orderBy: { price: 'asc' },
    });
    check('কেনার মতো একটি ভ্যারিয়েন্ট আছে', Boolean(variant),
      variant ? `${variant.product.name} · ${variant.label} · ৳${Number(variant.price)}` : 'নেই');

    if (variant) {
      await go(cp, `${BASE}/product/${variant.product.id}/${variant.product.slug}`);
      await settle(cp);

      const pack = cp.locator(`[role="radio"]`).filter({ hasText: variant.label }).first();
      if (await pack.count()) await pack.click();
      else await cp.locator('[role="radio"]').first().click().catch(() => {});

      await cp.fill('#uid', '123456789');
      if (await cp.locator('#uid2').count()) await cp.fill('#uid2', '123456789');

      /**
       * ★ ওয়ালেট থেকে পরিশোধ।
       *
       *   ⚠️ `hasText: /ওয়ালেট/` দিয়ে খুঁজলে **ভুল বোতাম** ধরা পড়ে:
       *   ডাইরেক্ট-পে কার্ডে লেখা থাকে "ওয়ালেট **লাগবে না**"। ফলে
       *   হারনেস ডাইরেক্ট-পে বেছে ফেলত, ফর্ম TrxID চাইত, আর অর্ডার
       *   কখনো জমা হতো না — দেখে মনে হচ্ছিল অর্ডার ভাঙা। তাই
       *   ওয়ালেট কার্ডের নিজস্ব লেখা ("Pay With Wallet") ধরা হয়।
       */
      const wallet = cp.locator('[role="radio"]').filter({ hasText: /Pay With Wallet/i }).first();
      if (await wallet.count()) await wallet.click().catch(() => {});
      await cp.waitForTimeout(300);

      /**
       * ⚠️ অর্ডার-ফর্মে **কোনো `type="submit"` বোতাম নেই**। বোতামটি
       *   সাধারণ `<button onClick={() => setConfirm(true)}>` এবং তার
       *   লেখা দামসহ: "৳20.00 — অর্ডার করুন" (`OrderForm.tsx:986`)।
       *   `button[type="submit"]` খুঁজতে গিয়ে হারনেস ৩০ সেকেন্ড
       *   অপেক্ষা করে টাইমআউট করত, আর রিপোর্টে "অর্ডার ভাঙা" আসত।
       */
      await cp.locator('button', { hasText: /অর্ডার করুন\s*$/ }).last()
        .click({ timeout: 15_000 }).catch(() => {});
      await cp.waitForTimeout(500);
      const okBtn = cp.locator('button', { hasText: 'হ্যাঁ, অর্ডার করুন' }).first();
      const placed = await okBtn.click({ timeout: 10_000 }).then(() => true).catch(() => false);
      check('অর্ডার নিশ্চিতকরণ ডায়ালগ কাজ করে', placed);
      await cp.waitForTimeout(3000);
    }

    const order = await db.order.findFirst({
      where: { userId }, orderBy: { createdAt: 'desc' },
      select: { id: true, orderNo: true, status: true, subtotal: true, price: true },
    });
    check('অর্ডার সারি তৈরি হয়েছে', Boolean(order), order ? `#${order.orderNo} · ${order.status}` : 'তৈরি হয়নি');
    check('অর্ডারের দাম ভ্যারিয়েন্টের দামের সমান',
      Number(order?.price) === Number(variant?.price), `৳${Number(order?.price)} vs ৳${Number(variant?.price)}`);

    const u2 = await db.user.findUnique({ where: { id: userId }, select: { balance: true } });
    const expected = DEPOSIT_AMOUNT - Number(variant?.price ?? 0);
    check('ওয়ালেট থেকে ঠিক ততটাই কেটেছে', Number(u2?.balance) === expected,
      `৳${Number(u2?.balance)} (প্রত্যাশিত ৳${expected})`);

    const led2 = await db.ledgerEntry.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
    check('দ্বিতীয় খতিয়ান এন্ট্রি (ORDER) যোগ হয়েছে', led2.length === 2, `${led2.length} টি`);
    check('খতিয়ানের যোগফল = ব্যালেন্স',
      led2.reduce((s, l) => s + Number(l.amount), 0) === Number(u2?.balance),
      `যোগফল ৳${led2.reduce((s, l) => s + Number(l.amount), 0)} · ব্যালেন্স ৳${Number(u2?.balance)}`);

    // ═══ ৭. অ্যাডমিন প্রক্রিয়াকরণ ═══
    console.log('\n── ৭. অ্যাডমিন প্রক্রিয়াকরণ ──');
    await go(ap, `${BASE}/admin/orders`);
    await settle(ap);
    /**
     * ⚠️ অর্ডার না থাকলে এই দাবিটি **ব্যর্থ হতে হবে**। আগে
     *   `innerText.includes('')` লেখা হতো, আর খালি স্ট্রিং সবসময় থাকে —
     *   অর্থাৎ অর্ডার তৈরিই না হলেও "দেখা যাচ্ছে" PASS দেখাত। মিথ্যা
     *   সবুজ মিথ্যা লালের চেয়েও খারাপ।
     */
    const orderVisible = order
      ? await ap.evaluate(`document.body.innerText.includes(${JSON.stringify(String(order.orderNo))})`)
      : false;
    check('অ্যাডমিন তালিকায় অর্ডারটি দেখা যাচ্ছে', Boolean(orderVisible), order ? `#${order.orderNo}` : 'অর্ডারই নেই');

    /**
     * ★ ডেলিভারি **API দিয়ে** করা হচ্ছে, UI দিয়ে নয়।
     *   কারণ ডেলিভারি ফর্মটি প্রতি-প্রোডাক্টে ভিন্ন (কোড/লিংক/টেক্সট)
     *   এবং অ্যাডমিন সারিতে দাবি-করা (claim) ধাপ আছে; সেগুলোর UI
     *   যাচাই আলাদা স্ক্রিপ্টে। এখানে দাবি একটাই: অবস্থা বদলালে
     *   গ্রাহক সেটি দেখতে পান কি না। অনুরোধটি অ্যাডমিনের **আসল
     *   সেশন কুকি** নিয়েই যায়, তাই গার্ডও পরীক্ষা হয়।
     */
    /**
     * ⚠️ প্রকৃত চুক্তিটি হলো **POST** এবং `{ orderId, action }` —
     *   `action` ∈ PROCESSING | COMPLETE | FAIL (`validation.ts:181`)।
     *   প্রথমে `PATCH { status: 'DELIVERED' }` পাঠানো হয়েছিল, উত্তর ছিল
     *   `405` — API নয়, **আমার অনুমান** ভুল ছিল। দুই ধাপেই চালাই,
     *   কারণ বাস্তবে অ্যাডমিন আগে PROCESSING তারপর COMPLETE করেন।
     */
    if (order) {
      const call = async (action: string) =>
        (await ap.evaluate(
          `fetch('/api/admin/order', {
             method: 'POST',
             headers: { 'content-type': 'application/json' },
             body: JSON.stringify({ orderId: ${JSON.stringify(order.id)}, action: ${JSON.stringify(action)} }),
           }).then(async r => ({ status: r.status, body: await r.text() }))`,
        )) as { status: number; body: string };

      const r1 = await call('PROCESSING');
      check('অ্যাডমিন অর্ডার PROCESSING করতে পারে', r1.status === 200, `HTTP ${r1.status} ${r1.body.slice(0, 100)}`);
      const r2 = await call('COMPLETE');
      check('অ্যাডমিন অর্ডার COMPLETE করতে পারে', r2.status === 200, `HTTP ${r2.status} ${r2.body.slice(0, 100)}`);
    }

    const ordAfter = await db.order.findFirst({ where: { userId }, select: { status: true } });
    // ★ স্কিমায় চূড়ান্ত সফল অবস্থার নাম `COMPLETED` — `DELIVERED` বলে
    //   কিছু নেই (tsc ধরিয়ে দিয়েছে; অনুমানে লিখলে দাবিটাই ভুল হতো)।
    check('অর্ডারের অবস্থা COMPLETED', ordAfter?.status === 'COMPLETED', String(ordAfter?.status));

    // ═══ ৮. গ্রাহক অবস্থা দেখেন ═══
    console.log('\n── ৮. গ্রাহকের অর্ডার-অবস্থা ──');
    await go(cp, `${BASE}/account/orders`);
    await settle(cp);
    const custSees = order
      ? await cp.evaluate(`document.body.innerText.includes(${JSON.stringify(String(order.orderNo))})`)
      : false;
    check('গ্রাহকের তালিকায় অর্ডারটি আছে', Boolean(custSees), order ? `#${order.orderNo}` : 'অর্ডারই নেই');
    /**
     * ⚠️ পুরো পাতায় "সম্পন্ন" খোঁজা **যথেষ্ট নয়** — ফিল্টার-চিপেও ঐ
     *   শব্দ থাকে, তাই অর্ডার PENDING থাকা অবস্থাতেও PASS আসত। দাবিটি
     *   এখন নির্দিষ্ট: **ঐ অর্ডারের সারিতেই** সম্পন্ন-অবস্থা লেখা আছে।
     */
    const delivered = order
      ? await cp.evaluate(`(function(){
          var no = ${JSON.stringify(String(order.orderNo))};
          var els = Array.from(document.querySelectorAll('article, li, tr, div'));
          var row = els.filter(function(e){ return e.innerText && e.innerText.includes(no) && e.innerText.length < 600; }).pop();
          return row ? /সম্পন্ন|ডেলিভার|Delivered|Completed/i.test(row.innerText) : false;
        })()`)
      : false;
    check('গ্রাহকের ঐ অর্ডারের সারিতেই সম্পন্ন-অবস্থা দেখা যায়', Boolean(delivered));

    // ═══ ৯. চূড়ান্ত খতিয়ান invariant ═══
    console.log('\n── ৯. খতিয়ান invariant ──');
    const uFinal = await db.user.findUnique({ where: { id: userId }, select: { balance: true } });
    const ledFinal = await db.ledgerEntry.findMany({ where: { userId } });
    const sum = ledFinal.reduce((s, l) => s + Number(l.amount), 0);
    check('SUM(খতিয়ান) === ব্যালেন্স', sum === Number(uFinal?.balance),
      `৳${sum} vs ৳${Number(uFinal?.balance)}`);
  } finally {
    if (userId) {
      await db.orderEvent.deleteMany({ where: { order: { userId } } }).catch(() => {});
      await db.order.deleteMany({ where: { userId } }).catch(() => {});
      await db.deposit.deleteMany({ where: { userId } }).catch(() => {});
      await db.ledgerEntry.deleteMany({ where: { userId } }).catch(() => {});
      await db.notification.deleteMany({ where: { userId } }).catch(() => {});
    }
    await db.otp.deleteMany({ where: { destination: EMAIL } }).catch(() => {});
    await db.user.deleteMany({ where: { email: EMAIL } }).catch(() => {});
    console.log('\n  (যাচাই-ডেটা মুছে ফেলা হলো)');
    await cust.close(); await adm.close();
    await db.$disconnect();
  }

  console.log('\n════════════════════════════════════════');
  console.log(`  ${total - fail}/${total} পাস${fail ? ` · ${fail} ব্যর্থ` : ''}`);
  process.exit(fail ? 1 : 0);
})();
