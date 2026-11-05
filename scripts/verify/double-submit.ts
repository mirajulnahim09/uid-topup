/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ দুইবার জমা — টাকার প্রতিটি পথে
 *
 *   `npx tsx scripts/verify/double-submit.ts`
 *
 *   ধীর সংযোগে অধৈর্য হয়ে দুইবার ট্যাপ করা **স্বাভাবিক** আচরণ।
 *   প্রশ্ন একটাই: দ্বিতীয় ট্যাপে কি দ্বিতীয়বার টাকা কাটে?
 *
 *   প্রতিটি প্রবাহ দুইভাবে চাপ দেওয়া হয়:
 *     · **UI** — বোতামে পরপর দুইবার ক্লিক (গ্রাহক যা করেন)
 *     · **সমান্তরাল API** — একই সেশনে দুটি অনুরোধ একসাথে
 *       (মোবাইল নেটওয়ার্কে দুটি ট্যাপই সার্ভারে পৌঁছালে যা হয়;
 *        এখানেই row-lock সত্যিই পরীক্ষা হয়)
 *
 *   দাবি সবসময় **ডাটাবেসে** মাপা হয় — সারি ক'টি হলো, খতিয়ানে
 *   ক'টি এন্ট্রি, ব্যালেন্স কতটা বদলালো।
 *
 *   ⚠️ ওয়েব অর্ডার-রুট ইচ্ছাকৃতভাবে `clientRef: null` পাঠায়
 *      (`api/order/route.ts`) — অর্থাৎ ওয়েবে idempotency key **নেই**,
 *      সুরক্ষাটি UI-এর দায়িত্ব। তাই এখানে সেটিই সবচেয়ে কড়া করে মাপা।
 * ═══════════════════════════════════════════════════════════
 */
import { db, dbLabel } from './_db';

import { type Page } from 'playwright-core';
import { openBrowser } from './_browser';
import { issueOtp } from '../../src/lib/otp/core';

const BASE = process.env.VERIFY_BASE || 'https://localhost:3443';
const ADMIN = { email: 'admin@uidtopup.local', password: 'Admin@2026Secure' };
const TAG = `dbl-${Date.now().toString(36)}`;
const EMAIL = `${TAG}@verify.local`;
const PASSWORD = 'Verify@2026Pass';

let fail = 0;
let total = 0;
const check = (name: string, ok: boolean, note = '') => {
  total++;
  if (!ok) fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${note ? ` — ${note}` : ''}`);
};

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
    `!document.querySelector('.v-ovl') && !document.getElementById('v-boot')`, null, { timeout: 60_000 },
  ).catch(() => {});
  await page.waitForTimeout(300);
};
const clearRateLimits = () => db.$executeRawUnsafe('DELETE FROM "RateLimitBucket"').catch(() => {});

async function login(page: Page, email: string, password: string, want: string) {
  await clearRateLimits();
  await go(page, `${BASE}/login?callbackUrl=${encodeURIComponent(want)}`);
  await settle(page);
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 }).catch(() => {});
  await settle(page);
  return new URL(page.url()).pathname;
}

/** ★ একই সেশনে **সত্যিই সমান্তরাল** দুটি অনুরোধ */
async function twice(page: Page, url: string, body: unknown) {
  return (await page.evaluate(`(async function(){
    var opts = { method: 'POST', headers: { 'content-type': 'application/json' },
                 body: JSON.stringify(${JSON.stringify(body)}) };
    var rs = await Promise.all([fetch(${JSON.stringify(url)}, opts), fetch(${JSON.stringify(url)}, opts)]);
    return await Promise.all(rs.map(async function(r){ return { status: r.status, body: (await r.text()).slice(0, 120) }; }));
  })()`)) as Array<{ status: number; body: string }>;
}

(async () => {
  console.log('═══ দুইবার জমা — ডুপ্লিকেট প্রতিরোধ ═══');
  console.log(`  সার্ভার: ${BASE} · DB: ${dbLabel()}\n`);

  // Shared helper: tries ws.txt, falls back to a local headless browser when it is stale.
  const browser = await openBrowser();

  const cust = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 } });
  const adm = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
  const cp = await cust.newPage();
  const ap = await adm.newPage();
  let userId = '';

  try {
    // ── সেটআপ ──
    await go(cp, `${BASE}/register`);
    await settle(cp);
    await cp.fill('#name', 'ডাবল যাচাই');
    await cp.fill('#email', EMAIL);
    await cp.fill('#phone', `014${String(Date.now()).slice(-8)}`);
    await cp.fill('#password', PASSWORD);
    const { code } = await issueOtp({ channel: 'EMAIL', purpose: 'REGISTER', destination: EMAIL, ip: '127.0.0.1' });
    await cp.fill('#otp', code);
    await cp.click('button[type="submit"]');
    await cp.waitForTimeout(2500);
    userId = (await db.user.findUnique({ where: { email: EMAIL }, select: { id: true } }))?.id ?? '';
    check('সেটআপ: অ্যাকাউন্ট তৈরি', Boolean(userId));
    await login(cp, EMAIL, PASSWORD, '/account');

    // ═══ ১. ডিপোজিট — UI তে দুইবার ক্লিক ═══
    console.log('\n── ১. ডিপোজিট জমা (UI, দুইবার ক্লিক) ──');
    await go(cp, `${BASE}/account/wallet/deposit`);
    await settle(cp);
    const trxId = `DBL${Date.now().toString(36).toUpperCase()}`;
    const ch = cp.locator('button[type="button"]').filter({ hasText: /bKash|Nagad|Rocket|বিকাশ|নগদ/i }).first();
    if (await ch.count()) await ch.click();
    await cp.fill('#amt', '1000');
    await cp.fill('#trx', trxId);
    await cp.fill('#snd', '01711111111');
    const dsubmit = cp.locator('button[type="submit"]').last();
    await dsubmit.click();
    await cp.waitForTimeout(80);
    await dsubmit.click({ force: true }).catch(() => {});
    await cp.waitForTimeout(4000);
    const deps = await db.deposit.count({ where: { userId } });
    check('দুইবার ক্লিকেও একটিই ডিপোজিট', deps === 1, `${deps}টি`);

    // ═══ ২. অ্যাডমিন অনুমোদন — সমান্তরাল দুটি API ═══
    console.log('\n── ২. ডিপোজিট অনুমোদন (সমান্তরাল দুটি অনুরোধ) ──');
    check('অ্যাডমিন লগইন', (await login(ap, ADMIN.email, ADMIN.password, '/admin')).startsWith('/admin'));
    const dep = await db.deposit.findFirst({ where: { userId }, select: { id: true } });
    const appr = dep ? await twice(ap, '/api/admin/deposit', { depositId: dep.id, action: 'APPROVE' }) : [];
    console.log(`     উত্তর: ${appr.map((r) => r.status).join(' , ')}`);
    const okCount = appr.filter((r) => r.status === 200).length;
    check('দুটির মধ্যে ঠিক একটি সফল হয়', okCount === 1, `${okCount}টি সফল`);

    const bal1 = Number((await db.user.findUnique({ where: { id: userId }, select: { balance: true } }))?.balance);
    check('ব্যালেন্স একবারই বেড়েছে', bal1 === 1000, `৳${bal1}`);
    const depLedger = await db.ledgerEntry.count({ where: { userId, type: 'DEPOSIT' } });
    check('খতিয়ানে একটিই DEPOSIT এন্ট্রি', depLedger === 1, `${depLedger}টি`);

    // ═══ ৩. অর্ডার — UI তে দুইবার নিশ্চিতকরণ ═══
    console.log('\n── ৩. অর্ডার (UI, নিশ্চিতকরণে দুইবার ক্লিক) ──');
    const variant = await db.variant.findFirst({
      where: { isActive: true, stock: { not: 0 }, price: { lte: 300 }, product: { isActive: true } },
      orderBy: { price: 'asc' },
      select: { id: true, label: true, price: true, product: { select: { id: true, slug: true } } },
    });
    check('সেটআপ: কেনার মতো ভ্যারিয়েন্ট আছে', Boolean(variant));

    if (variant) {
      await go(cp, `${BASE}/product/${variant.product.id}/${variant.product.slug}`);
      await settle(cp);
      const pack = cp.locator('[role="radio"]').filter({ hasText: variant.label }).first();
      if (await pack.count()) await pack.click();
      await cp.fill('#uid', '123456789');
      if (await cp.locator('#uid2').count()) await cp.fill('#uid2', '123456789');
      const wallet = cp.locator('[role="radio"]').filter({ hasText: /Pay With Wallet/i }).first();
      if (await wallet.count()) await wallet.click().catch(() => {});
      await cp.waitForTimeout(300);
      await cp.locator('button', { hasText: /অর্ডার করুন\s*$/ }).last().click({ timeout: 15_000 }).catch(() => {});
      await cp.waitForTimeout(400);

      // ★★★ নিশ্চিতকরণ বোতামে পরপর দুইবার — ডাবল-চার্জের আসল ঝুঁকি
      const ok = cp.locator('button', { hasText: 'হ্যাঁ, অর্ডার করুন' }).first();
      await ok.click({ timeout: 10_000 }).catch(() => {});
      await cp.waitForTimeout(60);
      await ok.click({ force: true, timeout: 3000 }).catch(() => {});
      await cp.waitForTimeout(6000);

      const orders = await db.order.count({ where: { userId } });
      check('দুইবার ক্লিকেও একটিই অর্ডার', orders === 1, `${orders}টি`);

      const orderLedger = await db.ledgerEntry.count({ where: { userId, type: 'ORDER' } });
      check('খতিয়ানে একটিই ORDER এন্ট্রি (ডাবল-চার্জ নেই)', orderLedger === 1, `${orderLedger}টি`);

      const bal2 = Number((await db.user.findUnique({ where: { id: userId }, select: { balance: true } }))?.balance);
      check('ব্যালেন্স একবারই কেটেছে', bal2 === 1000 - Number(variant.price),
        `৳${bal2} (প্রত্যাশিত ৳${1000 - Number(variant.price)})`);
    }

    // ═══ ৪. অ্যাডমিন অর্ডার-অ্যাকশন — সমান্তরাল দুটি ═══
    console.log('\n── ৪. অর্ডার COMPLETE (সমান্তরাল দুটি অনুরোধ) ──');
    const order = await db.order.findFirst({ where: { userId }, select: { id: true } });
    if (order) {
      await ap.evaluate(`fetch('/api/admin/order', { method:'POST', headers:{'content-type':'application/json'},
        body: JSON.stringify({ orderId: ${JSON.stringify(order.id)}, action: 'PROCESSING' }) })`);
      await ap.waitForTimeout(800);
      const done = await twice(ap, '/api/admin/order', { orderId: order.id, action: 'COMPLETE' });
      console.log(`     উত্তর: ${done.map((r) => r.status).join(' , ')}`);
      check('COMPLETE দুইবার পাঠালেও ঠিক একটি সফল', done.filter((r) => r.status === 200).length === 1,
        `${done.filter((r) => r.status === 200).length}টি সফল`);
      const st = await db.order.findUnique({ where: { id: order.id }, select: { status: true } });
      check('অর্ডার COMPLETED অবস্থায়', st?.status === 'COMPLETED', String(st?.status));
    }

    // ═══ ৫. রিফান্ড — সমান্তরাল দুটি (ডাবল-রিফান্ড অসম্ভব হতে হবে) ═══
    console.log('\n── ৫. রিফান্ড (সমান্তরাল দুটি অনুরোধ) ──');
    if (order) {
      const before = Number((await db.user.findUnique({ where: { id: userId }, select: { balance: true } }))?.balance);
      // ★ প্রকৃত schema: { orderId, amount, reason } — amount আবশ্যক ও ধনাত্মক
      const refunds = await twice(ap, '/api/admin/order/refund', {
        orderId: order.id, amount: Number(variant?.price ?? 20), reason: 'যাচাই — ডাবল রিফান্ড পরীক্ষা',
      });
      console.log(`     উত্তর: ${refunds.map((r) => r.status).join(' , ')}`);
      const after = Number((await db.user.findUnique({ where: { id: userId }, select: { balance: true } }))?.balance);
      const refundEntries = await db.ledgerEntry.count({ where: { userId, type: 'REFUND' } });
      check('খতিয়ানে সর্বোচ্চ একটি REFUND এন্ট্রি', refundEntries <= 1, `${refundEntries}টি`);
      check('ব্যালেন্স দুইবার ফেরত পায়নি',
        after <= before + Number(variant?.price ?? 0), `৳${before} → ৳${after}`);
    }

    // ═══ ৬. টিকিট — সমান্তরাল দুটি ═══
    console.log('\n── ৬. সাপোর্ট টিকিট (সমান্তরাল দুটি অনুরোধ) ──');
    const tk = await twice(cp, '/api/tickets', { subject: 'ডাবল যাচাই', body: 'দুইবার পাঠানো হলো', kind: 'GENERAL' });
    console.log(`     উত্তর: ${tk.map((r) => r.status).join(' , ')}`);
    check('টিকিট API সার্ভার-ত্রুটি দেয় না', tk.every((r) => r.status < 500),
      tk.map((r) => r.status).join(','));
    const tickets = await db.ticket.count({ where: { userId } });
    console.log(`     তৈরি হয়েছে ${tickets}টি টিকিট (টাকার পথ নয়, তাই একাধিক হলেও ক্ষতি নেই)`);

    // ═══ ৭. চূড়ান্ত খতিয়ান invariant ═══
    console.log('\n── ৭. খতিয়ান invariant ──');
    const uFinal = await db.user.findUnique({ where: { id: userId }, select: { balance: true } });
    const led = await db.ledgerEntry.findMany({ where: { userId } });
    const sum = led.reduce((s, l) => s + Number(l.amount), 0);
    check('SUM(খতিয়ান) === ব্যালেন্স', sum === Number(uFinal?.balance),
      `৳${sum} vs ৳${Number(uFinal?.balance)} · ${led.length}টি এন্ট্রি`);
  } finally {
    if (userId) {
      await db.ticketMessage.deleteMany({ where: { ticket: { userId } } }).catch(() => {});
      await db.ticket.deleteMany({ where: { userId } }).catch(() => {});
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
