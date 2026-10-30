/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ গ্রাহক-যাত্রা — বাকি ফাঁকগুলো (চূড়ান্ত অডিট, ২০২৬-০৯-১৭)
 *
 *   `business-flow-e2e` টাকার মূল পথ (ডিপোজিট → অনুমোদন → অর্ডার →
 *   সম্পন্ন) ঢাকে, `prod-auth-e2e` অথ। এই স্ক্রিপ্ট সেগুলোর **মাঝের**
 *   জিনিসগুলো আসল ব্রাউজারে করে, যা আগে কোথাও মাপা হয়নি:
 *
 *     ১. হোমপেজ → সার্চ বক্সে লেখা → ফলাফল → প্রোডাক্ট পাতা
 *     ২. ব্যালেন্স শূন্যে "টাকা কম" ব্লক ও Add Money লিংক
 *     ৩. UID যাচাই — ছোট, অবৈধ অক্ষর, দুই ঘর না মেলা
 *     ৪. UI দিয়ে অর্ডার → DB (দাম, খতিয়ান, স্টক)
 *     ৫. রিফ্রেশ, back/forward, লগআউট → পুনঃলগইন, অর্ডার টিকে আছে
 *     ৬. অন্য গ্রাহকের অর্ডার/চালান/টিকিট — পাতা ও API (IDOR)
 *     ৭. বন্ধ প্যাকেজ, অস্তিত্বহীন প্রোডাক্ট, অবৈধ id — সাদা পর্দা নয়
 *     ৮. বাসি দাম — পাতা খোলার পর দাম বাড়লে ৪০৯, কিছু কাটে না, নতুন দাম দেখায়
 *
 *   চালানো: VERIFY_BASE=https://localhost:3443 npx tsx scripts/verify/customer-journey.ts
 *   ⚠️ নিজের তৈরি ব্যবহারকারী ও সারি শেষে মুছে ফেলে।
 * ═══════════════════════════════════════════════════════════
 */
import { db, BASE, dbLabel } from './_db';
import { openBrowser } from './_browser';
import { creditWallet } from '../../src/lib/services/wallet';
import bcrypt from 'bcryptjs';
import { mkdirSync } from 'node:fs';
import type { Page, BrowserContext } from 'playwright-core';

const SHOTS = 'audit/shots';
mkdirSync(SHOTS, { recursive: true });
const TAG = `journey-${Date.now().toString(36)}`;
const PASSWORD = 'Journey2026Pass';

let total = 0;
let fail = 0;
function check(name: string, ok: boolean, note = '') {
  total++;
  if (!ok) fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${note ? ` — ${note}` : ''}`);
}

async function settle(page: Page) {
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForFunction(() => !document.getElementById('v-boot') && !document.querySelector('.v-ovl'), null, { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(400);
}

async function go(page: Page, path: string) {
  const res = await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  await settle(page);
  return res;
}

async function makeUser(label: string) {
  const email = `${TAG}-${label}@verify.local`;
  return db.user.create({
    data: {
      name: `যাত্রা ${label}`, email, phone: `017${String(Date.now()).slice(-8)}`,
      password: await bcrypt.hash(PASSWORD, 10), emailVerified: true,
      referralCode: `J${label}${Date.now().toString(36)}`.toUpperCase().slice(0, 12),
    },
    select: { id: true, email: true },
  });
}

async function login(page: Page, email: string, want: string) {
  await db.rateLimitBucket.deleteMany({});
  await go(page, `/login?callbackUrl=${encodeURIComponent(want)}`);
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 }).catch(() => {});
  // ★ এই যাত্রা ফোন অনুকরণ করে — আসল ফোনে লগইন-বোতাম চাপার পর কোনো "পড়ে থাকা"
  //   মাউস-পয়েন্টার থাকে না। থাকলে redirect-এর পর প্যাকেজ-কার্ড ঠিক তার নিচে এসে
  //   hover-lift-এ দোলে, আর WebKit-এ ক্লিক "not stable" হয়ে নীরবে ব্যর্থ হয়
  //   (EXTREME অডিট ২০২৬-০৯-১৯-এ মাপা: ৩s-এ ২০টি ভিন্ন অবস্থা; পয়েন্টার সরালে ক্লিক সফল)।
  await page.mouse.move(1, 1).catch(() => {});
  await settle(page);
  return new URL(page.url()).pathname;
}

async function main() {
  console.log(`═══ গ্রাহক-যাত্রা · ${BASE} · DB ${dbLabel()} ═══`);
  const browser = await openBrowser({ headless: process.env.HEADLESS === '1' });
  const ctx: BrowserContext = await browser.newContext({
    ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
  });
  const page = await ctx.newPage();
  const consoleErrors: string[] = [];
  const badResponses: string[] = [];
  /** ★ ইচ্ছাকৃত ৪০৪-নেভিগেশন — ব্রাউজার নিজেই "Failed to load resource: 404" লেখে; সেটি অ্যাপের ত্রুটি নয় */
  const intentional404: string[] = [];
  /** ★ বাসি-দাম ধাপে ৪০৯ ইচ্ছাকৃত — ব্রাউজার সেটিকেও "Failed to load resource" লেখে */
  let expected409 = false;
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const here = page.url().replace(BASE, '');
    // ★ WebKit ইচ্ছাকৃত ৪০৪-এর বার্তা URL commit-এর **আগে** পাঠায় (তখন page.url() আগের পাতা),
    //   তাই অনুরোধের নিজের URL-ও মেলানো হয়
    const res = (m.location()?.url || '').replace(BASE, '');
    if (/Failed to load resource.*404/.test(m.text()) && intentional404.some((p) => here.startsWith(p) || res.startsWith(p))) return;
    if (expected409 && /Failed to load resource.*409/.test(m.text())) return;
    consoleErrors.push(`${m.text().slice(0, 140)} @ ${page.url()}`);
  });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${String(e).slice(0, 140)} @ ${page.url()}`));
  page.on('response', (r) => {
    // ★ IDOR/৪০৪-পরীক্ষার ইচ্ছাকৃত ৪০৪ ও কেবল নিজের origin গোনা হয়
    if (r.status() >= 500 && r.url().startsWith(BASE)) badResponses.push(`${r.status()} ${r.url().replace(BASE, '')}`);
  });

  const variant = await db.variant.findFirst({
    where: { isActive: true, stock: { not: 0 }, product: { isActive: true, needsUid: true } },
    orderBy: { price: 'asc' },
    include: { product: { select: { id: true, slug: true, name: true } } },
  });
  if (!variant) throw new Error('কেনার মতো কোনো ভ্যারিয়েন্ট নেই');
  const productPath = `/product/${variant.product.id}/${variant.product.slug}`;

  const A = await makeUser('a');
  const B = await makeUser('b');
  const tempVariantIds: number[] = [];

  try {
    /* ── ১. হোম → সার্চ → প্রোডাক্ট ── */
    console.log('\n── ১. হোমপেজ → সার্চ → প্রোডাক্ট (অতিথি) ──');
    const home = await go(page, '/');
    check('হোমপেজ ২০০', home?.status() === 200, String(home?.status()));
    const term = variant.product.name.split(/\s+/)[0];
    // ★ ফোনে সার্চ হ্যামবার্গার মেনুর সবার উপরে (`Navbar.tsx` "মোবাইল মেনু") —
    //   গ্রাহক যেভাবে পান, সেভাবেই: মেনু খোলা, তারপর লেখা
    await page.locator('button[aria-label="মেনু খুলুন"]').first().click();
    await page.waitForTimeout(500);
    const searchInput = page.locator('input[type="search"]:visible').first();
    check('ফোনে মেনু খুললে সার্চ বক্স দেখা যায়', await searchInput.isVisible().catch(() => false));
    await searchInput.fill(term);
    await searchInput.press('Enter');
    await page.waitForURL((u) => u.pathname === '/search', { timeout: 15_000 }).catch(() => {});
    await settle(page);
    check('সার্চ-পাতায় পৌঁছায়', new URL(page.url()).pathname === '/search', page.url().replace(BASE, ''));
    // ★ ধরা পড়া বাগ: আগে মেনু খোলা থাকত ও দেরিতে আসা সাজেশন ফলাফল ঢেকে দিত
    await page.waitForTimeout(1200); // ঝুলে থাকা debounce-উত্তর আসার সময়
    check('সার্চের পর মোবাইল মেনু বন্ধ', (await page.locator('[aria-label="মোবাইল মেনু"]').count()) === 0);
    check('ফলাফল-পাতায় পুরনো সাজেশন-ড্রপডাউন নেই',
      (await page.locator('header ul.absolute:visible').count()) === 0);
    const hit = page.locator(`a[href^="/product/${variant.product.id}"]`).first();
    const hasHit = (await hit.count()) > 0;
    check(`"${term}" এর ফলাফলে প্রোডাক্টটি আছে`, hasHit);
    await page.screenshot({ path: `${SHOTS}/journey-1-search.png` });
    if (hasHit) {
      await hit.click();
      await page.waitForURL((u) => u.pathname.startsWith(`/product/${variant.product.id}`), { timeout: 20_000 }).catch(() => {});
      await settle(page);
    } else {
      await go(page, productPath);
    }
    check('প্রোডাক্ট পাতা খোলে', new URL(page.url()).pathname.startsWith(`/product/${variant.product.id}`));
    const empty = await go(page, '/search?q=');
    check('খালি সার্চ ভাঙে না', (empty?.status() ?? 0) < 500, String(empty?.status()));
    const weird = await go(page, `/search?q=${encodeURIComponent('😀<script>"\' ধ্রুব')}`);
    check('ইমোজি/বিশেষ অক্ষর/বাংলায় সার্চ ভাঙে না', (weird?.status() ?? 0) < 500, String(weird?.status()));

    /* ── ২. শূন্য ব্যালেন্স ── */
    console.log('\n── ২. লগইন, শূন্য ব্যালেন্সে "টাকা কম" ──');
    check('লগইনের পর প্রোডাক্ট পাতায় ফেরে', (await login(page, A.email, productPath)).startsWith(`/product/${variant.product.id}`));
    await page.locator('[role="radio"]').filter({ hasText: variant.label }).first().click().catch(() => {});
    await page.locator('[role="radio"]').filter({ hasText: /Pay With Wallet/i }).first().click().catch(() => {});
    await page.waitForTimeout(500);
    const shortVisible = await page.getByText(/টাকা কম আছে/).first().isVisible().catch(() => false);
    check('"টাকা কম আছে" দেখায়', shortVisible);
    check('Add Money লিংক আছে', (await page.locator('a[href="/account/wallet/deposit"]').count()) > 0);
    await page.screenshot({ path: `${SHOTS}/journey-2-insufficient.png`, fullPage: false });

    /* ── ৩. UID যাচাই ── */
    console.log('\n── ৩. UID যাচাই ──');
    await db.$transaction((tx) => creditWallet({ tx, userId: A.id, amount: 5000, type: 'ADMIN_ADJUST', note: 'যাত্রা-যাচাই' }));
    await page.reload();
    await settle(page);
    await page.locator('[role="radio"]').filter({ hasText: variant.label }).first().click().catch(() => {});
    await page.locator('[role="radio"]').filter({ hasText: /Pay With Wallet/i }).first().click().catch(() => {});
    await page.fill('#uid', 'ab');
    await page.locator('#uid').blur();
    await page.waitForTimeout(300);
    const errShort = await page.locator('#uid-err').textContent().catch(() => null);
    check('২ অক্ষরের UID-এ ত্রুটি', Boolean(errShort), errShort ?? 'বার্তা নেই');
    await page.fill('#uid', '12 34$');
    await page.locator('#uid').blur();
    await page.waitForTimeout(300);
    const errChars = await page.locator('#uid-err').textContent().catch(() => null);
    check('অবৈধ অক্ষরে ত্রুটি', Boolean(errChars), errChars ?? 'বার্তা নেই');
    await page.fill('#uid', '1234567890');
    await page.locator('#uid').blur();
    await page.fill('#uid2', '1234567899');
    await page.waitForTimeout(300);
    const mismatch = await page.locator('button', { hasText: /মিলছে না/ }).first().isDisabled().catch(() => false);
    check('দুই ঘর না মিললে বোতাম বন্ধ', mismatch);
    await page.screenshot({ path: `${SHOTS}/journey-3-uid-mismatch.png` });

    /* ── ৪. অর্ডার ── */
    console.log('\n── ৪. UI দিয়ে অর্ডার ──');
    await page.fill('#uid2', '1234567890');
    await page.waitForTimeout(300);
    const before = await db.variant.findUnique({ where: { id: variant.id }, select: { stock: true, price: true } });
    const orderBtn = page.locator('button', { hasText: /অর্ডার করুন\s*$/ }).last();
    check('মিললে অর্ডার বোতাম চালু', await orderBtn.isEnabled().catch(() => false));
    await orderBtn.click();
    const dialog = page.locator('[role="dialog"], [role="alertdialog"]').first();
    await dialog.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
    const dialogText = await dialog.innerText().catch(() => '');
    check('নিশ্চিতকরণে UID ও দাম দেখায়', dialogText.includes('1234567890') && dialogText.includes(Number(before!.price).toFixed(2)));
    await page.screenshot({ path: `${SHOTS}/journey-4-confirm.png` });
    const [orderRes] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/api/order') && r.request().method() === 'POST', { timeout: 30_000 }),
      page.locator('button', { hasText: 'হ্যাঁ, অর্ডার করুন' }).first().click(),
    ]);
    check('অর্ডার API ২০০', orderRes.status() === 200, String(orderRes.status()));
    await page.waitForTimeout(2500);
    const order = await db.order.findFirst({ where: { userId: A.id }, orderBy: { createdAt: 'desc' } });
    check('DB-তে অর্ডার', Boolean(order), order ? `#${order.orderNo} ${order.status}` : 'নেই');
    check('দাম = লক করা ভ্যারিয়েন্ট-দাম', Number(order?.price) === Number(before?.price));
    const uA = await db.user.findUnique({ where: { id: A.id }, select: { balance: true } });
    const ledSum = await db.ledgerEntry.aggregate({ where: { userId: A.id }, _sum: { amount: true } });
    check('ব্যালেন্স = ৫০০০ − দাম', Number(uA?.balance) === 5000 - Number(before?.price), `৳${Number(uA?.balance)}`);
    check('SUM(খতিয়ান) = ব্যালেন্স', Number(ledSum._sum.amount) === Number(uA?.balance));
    const after = await db.variant.findUnique({ where: { id: variant.id }, select: { stock: true } });
    check('স্টক ঠিকভাবে বদলেছে', before!.stock < 0 ? after!.stock === before!.stock : after!.stock === before!.stock - 1,
      `${before!.stock} → ${after!.stock}`);

    /* ── ৫. স্থায়িত্ব ── */
    console.log('\n── ৫. রিফ্রেশ, back/forward, লগআউট → পুনঃলগইন ──');
    await go(page, '/account/orders');
    const listed = async () => (await page.locator('body').innerText()).includes(String(order?.orderNo));
    check('অর্ডার তালিকায় আছে', await listed(), `#${order?.orderNo}`);
    await page.reload(); await settle(page);
    check('রিফ্রেশের পরেও আছে', await listed());
    await page.goBack(); await settle(page);
    check('back → আগের পাতা', new URL(page.url()).pathname !== '/account/orders', page.url().replace(BASE, ''));
    await page.goForward(); await settle(page);
    check('forward → অর্ডার তালিকা, ভাঙে না', new URL(page.url()).pathname === '/account/orders' && await listed());
    const detail = await go(page, `/account/orders/${order?.id}`);
    check('নিজের অর্ডার-বিস্তারিত ২০০', detail?.status() === 200);
    const inv = await go(page, `/account/orders/${order?.id}/invoice`);
    check('নিজের চালান ২০০', inv?.status() === 200);
    await page.screenshot({ path: `${SHOTS}/journey-5-invoice.png` });

    const csrf = await (await page.request.get(`${BASE}/api/auth/csrf`)).json();
    await page.request.post(`${BASE}/api/auth/signout`, { form: { csrfToken: csrf.csrfToken, json: 'true' } });
    await go(page, '/account/orders');
    check('লগআউটের পর /account/orders → /login', new URL(page.url()).pathname === '/login');
    check('পুনঃলগইনে অর্ডার-তালিকায় ফেরে', (await login(page, A.email, '/account/orders')) === '/account/orders');
    check('পুনঃলগইনের পর অর্ডার টিকে আছে', await listed());

    /* ── ৬. IDOR ── */
    console.log('\n── ৬. অন্য গ্রাহকের তথ্য (IDOR) ──');
    const bOrder = await db.order.create({
      data: {
        userId: B.id, variantId: variant.id, playerUid: 'IDORB7UID42', subtotal: variant.price, price: variant.price,
        productName: variant.product.name, variantName: variant.label, status: 'COMPLETED', completedAt: new Date(),
      },
    });
    const bTicket = await db.ticket.create({
      data: {
        userId: B.id, subject: 'IDORB7SUBJECT', status: 'OPEN', lastMessageAt: new Date(),
        messages: { create: { authorId: B.id, authorName: 'B', isStaff: false, body: 'IDORB7BODY' } },
      },
    });
    /**
     * ⚠️ HTTP status এখানে প্রশ্ন নয়। `/account/loading.tsx` থাকায় Next
     *   স্ট্রিমিং শুরু করে ২০০ পাঠিয়ে দেয়, তারপর `notFound()` এর ৪০৪-UI
     *   আসে (Next 14-এর জানা আচরণ; পাতাগুলো `noindex`)। নিরাপত্তার আসল
     *   প্রশ্ন দুটি: **কাঁচা HTML/RSC-তে** B-এর তথ্য আছে কি না, আর গ্রাহক
     *   ৪০৪-পর্দা দেখেন কি না। (চূড়ান্ত অডিটে মাপা: ফাঁস নেই।)
     */
    for (const p of [`/account/orders/${bOrder.id}`, `/account/orders/${bOrder.id}/invoice`, `/account/tickets/${bTicket.id}`]) {
      const raw = await (await page.request.get(`${BASE}${p}`)).text();
      await go(page, p);
      const text = await page.locator('body').innerText();
      const label = p.replace(bOrder.id, '<B>').replace(bTicket.id, '<B>');
      check(`${label} → কাঁচা HTML-এ B-এর তথ্য নেই`,
        !/IDORB7(UID42|SUBJECT|BODY)/.test(raw));
      check(`${label} → ৪০৪-পর্দা দেখায়`, text.includes('পাতাটি পাওয়া যায়নি'));
    }
    const apiChecks: Array<[string, () => Promise<number>]> = [
      ['GET /api/tickets/<B>', async () => (await page.request.get(`${BASE}/api/tickets/${bTicket.id}`)).status()],
      ['POST /api/tickets/<B> (উত্তর)', async () => (await page.request.post(`${BASE}/api/tickets/${bTicket.id}`, { data: { body: 'হ্যাক' } })).status()],
      ['PATCH /api/tickets/<B> (বন্ধ)', async () => (await page.request.patch(`${BASE}/api/tickets/${bTicket.id}`)).status()],
      ['POST /api/order/confirm <B>', async () => (await page.request.post(`${BASE}/api/order/confirm`, { data: { orderId: bOrder.id, arrived: false } })).status()],
      ['POST /api/review <B>', async () => (await page.request.post(`${BASE}/api/review`, { data: { orderId: bOrder.id, rating: 1 } })).status()],
    ];
    for (const [name, fn] of apiChecks) {
      const st = await fn();
      check(`${name} → ৪০৪`, st === 404, `HTTP ${st}`);
    }
    const bStill = await db.ticket.findUnique({ where: { id: bTicket.id }, include: { messages: true } });
    check('B-এর টিকিট অক্ষত (বার্তা ১, OPEN)', bStill?.messages.length === 1 && bStill.status === 'OPEN');
    const trackOther = await page.request.post(`${BASE}/api/track`, { data: { orderNo: bOrder.orderNo, contact: '01800000000' } });
    check('অর্ডার-নং + ভুল ফোনে ট্র্যাক → ৪০৪', trackOther.status() === 404, `HTTP ${trackOther.status()}`);
    await go(page, '/admin');
    check('গ্রাহক /admin → বাইরে পাঠানো হয়', !new URL(page.url()).pathname.startsWith('/admin'), page.url().replace(BASE, ''));

    /* ── ৭. অনুপস্থিত/বন্ধ ── */
    console.log('\n── ৭. বন্ধ প্যাকেজ, অস্তিত্বহীন প্রোডাক্ট ──');
    const off = await db.variant.create({
      data: { productId: variant.product.id, label: `${TAG}-off`, price: 10, costPrice: 0, stock: -1, isActive: false },
    });
    tempVariantIds.push(off.id);
    const offRes = await page.request.post(`${BASE}/api/order`, { data: { variantId: off.id, playerUid: '1234567890' } });
    const offBody = await offRes.json().catch(() => ({}));
    check('বন্ধ প্যাকেজে অর্ডার → ৪০০, বাংলা বার্তা', offRes.status() === 400 && /পাওয়া যাচ্ছে না/.test(offBody.error ?? ''), `${offRes.status()} ${offBody.error ?? ''}`);
    const zero = await db.variant.create({
      data: { productId: variant.product.id, label: `${TAG}-zero`, price: 10, costPrice: 0, stock: 0, isActive: true },
    });
    tempVariantIds.push(zero.id);
    const zRes = await page.request.post(`${BASE}/api/order`, { data: { variantId: zero.id, playerUid: '1234567890' } });
    check('স্টক শেষ → ৪০০', zRes.status() === 400, String(zRes.status()));
    for (const [p, label] of [['/product/99999999/nothing', 'অস্তিত্বহীন প্রোডাক্ট'], ['/product/abc', 'অবৈধ id'], ['/account/orders/does-not-exist', 'অস্তিত্বহীন অর্ডার']] as const) {
      intentional404.push(p);
      const r = await go(page, p);
      // ★ ৪০৪ পাতার লিংকগুলো (/track, /refund…) Next সাথে সাথে prefetch করে। সেগুলো
      //   শেষ হওয়ার আগেই পরের পাতায় গেলে WebKit বাতিল fetch-কে "access control
      //   checks"/"Load failed" ত্রুটি হিসেবে লগ করে — ছেড়ে-যাওয়া পাতায়, ব্যবহারকারীর
      //   অদৃশ্য (EXTREME অডিট ২০২৬-০৯-১৯-এ মাপা: সাথে সাথে গেলে ৩, অপেক্ষা করলে ০)।
      //   তাই মানুষের মতো নেটওয়ার্ক থামা পর্যন্ত অপেক্ষা; কনসোল-দাবি অপরিবর্তিত।
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
      const t = (await page.locator('body').innerText()).trim();
      // ★ `/account/…` স্ট্রিমিং-এ ২০০ দেয় (উপরে ব্যাখ্যা) — পর্দাটাই প্রশ্ন
      check(`${label} → ৪০৪ পাতা (সাদা পর্দা নয়)`,
        (r?.status() === 404 || p.startsWith('/account/')) && t.includes('পাতাটি পাওয়া যায়নি') && !/Error:|at \w+ \(/.test(t),
        `HTTP ${r?.status()}`);
    }
    await page.screenshot({ path: `${SHOTS}/journey-7-404.png` });

    /* ── ৮. বাসি দাম ── */
    console.log('\n── ৮. বাসি দাম (পাতা খোলার পর দাম বাড়ল) ──');
    const stale = await db.variant.create({
      data: { productId: variant.product.id, label: `${TAG}-stale`, price: 50, costPrice: 0, stock: -1, isActive: true, sortOrder: 0 },
    });
    tempVariantIds.push(stale.id);
    await go(page, productPath);
    await page.locator('[role="radio"]').filter({ hasText: `${TAG}-stale` }).first().click();
    await page.locator('[role="radio"]').filter({ hasText: /Pay With Wallet/i }).first().click().catch(() => {});
    await page.fill('#uid', '1234567890');
    await page.fill('#uid2', '1234567890');
    await page.waitForTimeout(300);
    const shownLabel = await page.locator('button', { hasText: /অর্ডার করুন\s*$/ }).last().innerText();
    // ★ আসল অ্যাডমিনের পথে দাম বদল — `revalidatePath` চলে, তাই পাতার ISR-ক্যাশও নতুন হয়।
    //   (সরাসরি DB-তে বদলালে ৬০s পর্যন্ত পুরনো দাম পরিবেশিত হতো — সেটি অ্যাপের আচরণ নয়)
    const adminCtx = await browser.newContext({ ignoreHTTPSErrors: true });
    await db.rateLimitBucket.deleteMany({});
    const { csrfToken: adminCsrf } = await (await adminCtx.request.get(`${BASE}/api/auth/csrf`)).json();
    await adminCtx.request.post(`${BASE}/api/auth/callback/credentials`, {
      form: { csrfToken: adminCsrf, email: 'admin@uidtopup.local', password: 'Admin@2026Secure', json: 'true' },
      maxRedirects: 0, failOnStatusCode: false,
    });
    const patch = await adminCtx.request.patch(`${BASE}/api/admin/variant`, { data: { id: stale.id, price: 60 }, failOnStatusCode: false });
    check('অ্যাডমিন দাম ৳৫০ → ৳৬০ করলেন', patch.status() === 200, String(patch.status()));
    await adminCtx.close();

    const balBeforeStale = Number((await db.user.findUnique({ where: { id: A.id }, select: { balance: true } }))!.balance);
    expected409 = true;
    await page.locator('button', { hasText: /অর্ডার করুন\s*$/ }).last().click();
    const [staleRes] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/api/order') && r.request().method() === 'POST', { timeout: 30_000 }),
      page.locator('button', { hasText: 'হ্যাঁ, অর্ডার করুন' }).first().click(),
    ]);
    const staleBody = await staleRes.json().catch(() => ({}));
    await page.waitForTimeout(3000);
    const staleOrder = await db.order.findFirst({ where: { userId: A.id, variantId: stale.id } });
    console.log(`  মাপা: বোতামে দেখানো "${shownLabel.trim()}" · API ${staleRes.status()} ${staleBody.code ?? ''}`);
    check('দেখানো দামের চেয়ে বেশি → ৪০৯ PRICE_CHANGED', staleRes.status() === 409 && staleBody.code === 'PRICE_CHANGED');
    check('কোনো অর্ডার হয়নি, এক পয়সাও কাটা হয়নি',
      !staleOrder && Number((await db.user.findUnique({ where: { id: A.id }, select: { balance: true } }))!.balance) === balBeforeStale);
    check('গ্রাহক কারণসহ বার্তা দেখেন', (await page.locator('body').innerText()).includes('দাম বদলেছে'));
    const refreshedLabel = await page.locator('button', { hasText: /অর্ডার করুন\s*$/ }).last().innerText().catch(() => '');
    check('পাতা নিজে থেকেই নতুন দাম দেখায় (৳60.00)', refreshedLabel.includes('60.00'), refreshedLabel.trim());
    await page.screenshot({ path: `${SHOTS}/journey-8-price-changed.png` });
    const [again] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/api/order') && r.request().method() === 'POST', { timeout: 30_000 }),
      (async () => {
        await page.locator('button', { hasText: /অর্ডার করুন\s*$/ }).last().click();
        await page.locator('button', { hasText: 'হ্যাঁ, অর্ডার করুন' }).first().click();
      })(),
    ]);
    await page.waitForTimeout(1500);
    const okOrder = await db.order.findFirst({ where: { userId: A.id, variantId: stale.id } });
    check('নতুন দাম দেখে আবার নিশ্চিত করলে অর্ডার হয় — ৳৬০', again.status() === 200 && Number(okOrder?.price) === 60,
      `API ${again.status()} · ৳${okOrder ? Number(okOrder.price) : '—'}`);
    expected409 = false;

    /* ── কোলাহল ── */
    console.log('\n── কনসোল ও নেটওয়ার্ক ──');
    check('কনসোলে ত্রুটি নেই', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | ') || '০');
    check('কোনো ৫xx নেই', badResponses.length === 0, badResponses.slice(0, 3).join(' | ') || '০');
  } finally {
    const ids = [A.id, B.id];
    await db.ticketMessage.deleteMany({ where: { ticket: { userId: { in: ids } } } }).catch(() => {});
    await db.ticket.deleteMany({ where: { userId: { in: ids } } }).catch(() => {});
    await db.orderEvent.deleteMany({ where: { order: { userId: { in: ids } } } }).catch(() => {});
    await db.review.deleteMany({ where: { userId: { in: ids } } }).catch(() => {});
    await db.order.deleteMany({ where: { userId: { in: ids } } }).catch(() => {});
    await db.ledgerEntry.deleteMany({ where: { userId: { in: ids } } }).catch(() => {});
    await db.notification.deleteMany({ where: { userId: { in: ids } } }).catch(() => {});
    await db.adminLog.deleteMany({ where: { adminId: { in: ids } } }).catch(() => {});
    await db.user.deleteMany({ where: { id: { in: ids } } }).catch(() => {});
    if (tempVariantIds.length) await db.variant.deleteMany({ where: { id: { in: tempVariantIds } } }).catch(() => {});
    await db.rateLimitBucket.deleteMany({});
    await browser.close().catch(() => {});
    await db.$disconnect();
  }

  console.log(`\n════ ${total - fail}/${total} পাস${fail ? ` · ${fail} ব্যর্থ` : ''} ════`);
  process.exitCode = fail ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
