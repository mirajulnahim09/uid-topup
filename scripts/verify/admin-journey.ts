/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ অ্যাডমিন-যাত্রা — UI দিয়ে প্রতিটি মিউটেশন, DB ও গ্রাহক-পক্ষে ফল
 *     (চূড়ান্ত অডিট, ২০২৬-০৯-১৭)
 *
 *   `business-flow-e2e` ডিপোজিট-অনুমোদন ও অর্ডার-সম্পন্ন ঢাকে,
 *   `support-flow-e2e` টিকিট ও প্রত্যাহার। বাকি অ্যাডমিন-কাজগুলো আগে
 *   কখনো **আসল পর্দা দিয়ে** করা হয়নি — এখানে হয়:
 *
 *     ১. লগইন ও ড্যাশবোর্ড
 *     ২. প্রোডাক্ট তৈরি (খালি নামে আটকায়) → প্যাকেজ যোগ → স্টোরফ্রন্টে দেখা যায়
 *     ৩. কুপন তৈরি → গ্রাহকের কুপন-যাচাই ছাড় দেয়
 *     ৪. অর্ডার বাতিল (UI) → পুরো ফেরত, স্টক ও কুপন ফেরত, খতিয়ান
 *     ৫. অর্ডার সম্পন্ন → আংশিক ফেরত → অতিরিক্ত ফেরত প্রত্যাখ্যাত
 *     ৬. ডিপোজিট বাতিল (UI) → ব্যালেন্স অক্ষত
 *     ৭. ব্যালেন্স সমন্বয় (UI) → খতিয়ান; ঋণাত্মক-হয়ে-যাবে প্রত্যাখ্যাত
 *     ৮. স্থায়ী বন্ধ (UI) → গ্রাহক API ৪০৩, লগইন ব্যর্থ → সক্রিয় → লগইন চলে
 *     ৯. অ্যাক্টিভিটি লগে প্রতিটি কাজ · SUM(খতিয়ান) = ব্যালেন্স
 *    ১০. লগআউট → /admin বন্ধ
 *
 *   চালানো: VERIFY_BASE=https://localhost:3443 npx tsx scripts/verify/admin-journey.ts
 *   ⚠️ নিজের তৈরি প্রতিটি সারি শেষে মুছে ফেলে।
 * ═══════════════════════════════════════════════════════════
 */
import { db, BASE, dbLabel } from './_db';
import { openBrowser } from './_browser';
import { creditWallet } from '../../src/lib/services/wallet';
import bcrypt from 'bcryptjs';
import { mkdirSync } from 'node:fs';
import { request, type Page, type APIRequestContext } from 'playwright-core';

const SHOTS = 'audit/shots';
mkdirSync(SHOTS, { recursive: true });
const TAG = `adm${Date.now().toString(36)}`;
const ADMIN = { email: 'admin@uidtopup.local', password: 'Admin@2026Secure' };
const CUST_PASS = 'AdminJourney2026';

let total = 0;
let fail = 0;
function check(name: string, ok: boolean, note = '') {
  total++;
  if (!ok) fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${note ? ` — ${note}` : ''}`);
}

async function settle(page: Page, ms = 500) {
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForFunction(() => !document.getElementById('v-boot') && !document.querySelector('.v-ovl'), null, { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(ms);
}
async function go(page: Page, path: string) {
  try {
    await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  } catch (e) {
    // ★ WebKit: আগের ধাপের `router.refresh()` আর এই goto একই URL-এ পড়লে
    //   "interrupted by another navigation" — গন্তব্য একই, তাই কেবল সেটিই সহ্য করা হয়
    if (!/interrupted by another navigation/.test(String(e))) throw e;
    await page.waitForURL(`${BASE}${path}`, { timeout: 30_000 });
  }
  await settle(page);
}
/** ★ ডায়ালগের নিশ্চিত-বোতাম — `role=dialog` এর ভেতরে, নাম ধরে */
async function confirmDialog(page: Page, label: string | RegExp) {
  const dlg = page.locator('[role="dialog"], [role="alertdialog"]').last();
  await dlg.waitFor({ state: 'visible', timeout: 10_000 });
  await dlg.getByRole('button', { name: label }).click();
}
/** ★ API অনুরোধের উত্তর ধরা — UI ক্লিক আসলেই সার্ভারে পৌঁছাল কি না */
function waitApi(page: Page, path: string) {
  return page.waitForResponse((r) => r.url().includes(path) && r.request().method() !== 'GET', { timeout: 20_000 });
}
async function apiLogin(email: string, password: string): Promise<{ api: APIRequestContext; ok: boolean }> {
  await db.rateLimitBucket.deleteMany({});
  const api = await request.newContext({ baseURL: BASE, ignoreHTTPSErrors: true });
  const { csrfToken } = await (await api.get('/api/auth/csrf')).json();
  await api.post('/api/auth/callback/credentials', {
    form: { csrfToken, email, password, json: 'true' }, maxRedirects: 0, failOnStatusCode: false,
  });
  const s = await (await api.get('/api/auth/session')).json().catch(() => null);
  return { api, ok: Boolean(s?.user?.id) };
}
const balanceOf = async (id: string) => Number((await db.user.findUnique({ where: { id }, select: { balance: true } }))?.balance);
const ledgerSum = async (id: string) => Number((await db.ledgerEntry.aggregate({ where: { userId: id }, _sum: { amount: true } }))._sum.amount ?? 0);

async function main() {
  console.log(`═══ অ্যাডমিন-যাত্রা · ${BASE} · DB ${dbLabel()} ═══`);
  const created = { productIds: [] as number[], couponIds: [] as number[], userId: '' };

  const cust = await db.user.create({
    data: {
      name: `অ্যাডমিন-যাত্রা ${TAG}`, email: `${TAG}@verify.local`, phone: `016${String(Date.now()).slice(-8)}`,
      password: await bcrypt.hash(CUST_PASS, 10), emailVerified: true, referralCode: TAG.toUpperCase().slice(0, 12),
    },
  });
  created.userId = cust.id;
  await db.$transaction((tx) => creditWallet({ tx, userId: cust.id, amount: 1000, type: 'ADMIN_ADJUST', note: 'অ্যাডমিন-যাত্রা' }));

  const browser = await openBrowser({ headless: process.env.HEADLESS === '1' });
  // ★ ADMIN_VP=390x844 — একই যাত্রা ফোন/ট্যাবলেটে (প্রি-প্রোডাকশন লক ২০২৬-০৯-২৭); ডিফল্ট আগের মতোই ১৪৪০
  const [AW, AH] = (process.env.ADMIN_VP || '1440x900').split('x').map(Number);
  console.log(`ভিউপোর্ট ${AW}×${AH}`);
  const ctx = await browser.newContext({
    ignoreHTTPSErrors: true, viewport: { width: AW, height: AH }, ...(AW < 768 ? { isMobile: true, hasTouch: true } : {}),
  });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror ${String(e).slice(0, 120)}`));
  page.on('response', (r) => { if (r.status() >= 500 && r.url().startsWith(BASE)) errors.push(`${r.status()} ${r.url().replace(BASE, '')}`); });

  try {
    /* ── ১ ── */
    console.log('\n── ১. লগইন ও ড্যাশবোর্ড ──');
    await db.rateLimitBucket.deleteMany({});
    await go(page, '/login?callbackUrl=/admin');
    await page.fill('input[type="email"]', ADMIN.email);
    await page.fill('input[type="password"]', ADMIN.password);
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => u.pathname.startsWith('/admin'), { timeout: 30_000 }).catch(() => {});
    await settle(page, 1000);
    check('অ্যাডমিন লগইনে /admin', new URL(page.url()).pathname === '/admin', page.url().replace(BASE, ''));
    check('সাইডবারে মূল লিংকগুলো', (await page.locator('a[href="/admin/orders"]').count()) > 0 && (await page.locator('a[href="/admin/users"]').count()) > 0);
    await page.screenshot({ path: `${SHOTS}/admin-journey-1-dashboard.png` });

    /* ── ২ ── */
    console.log('\n── ২. প্রোডাক্ট ও প্যাকেজ ──');
    await go(page, '/admin/products');
    await page.getByRole('button', { name: /নতুন প্রোডাক্ট যোগ করুন/ }).click();
    const cat = await db.category.findFirst({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } });
    await page.selectOption('select[aria-label="ক্যাটাগরি"]', String(cat!.id));
    // খালি নামে তৈরি হয় না
    const before = await db.product.count();
    await page.getByRole('button', { name: 'প্রোডাক্ট তৈরি করুন' }).click();
    await page.waitForTimeout(1500);
    check('খালি নামে প্রোডাক্ট তৈরি হয় না', (await db.product.count()) === before);
    const pname = `${TAG} যাচাই-প্রোডাক্ট`;
    await page.fill('input[aria-label="প্রোডাক্টের নাম"]', pname);
    const [pr] = await Promise.all([waitApi(page, '/api/admin/product'), page.getByRole('button', { name: 'প্রোডাক্ট তৈরি করুন' }).click()]);
    check('প্রোডাক্ট API সফল', pr.status() === 200, String(pr.status()));
    await page.waitForTimeout(1500);
    const prod = await db.product.findFirst({ where: { name: pname } });
    if (prod) created.productIds.push(prod.id);
    check('প্রোডাক্ট DB-তে', Boolean(prod), prod ? `#${prod.id} ${prod.slug}` : '');

    await page.reload(); await settle(page, 800);
    const card = page.locator('div.card').filter({ hasText: pname }).first();
    await card.getByRole('button', { name: 'দাম দেখুন' }).click();
    await card.getByRole('button', { name: /নতুন প্যাকেজ যোগ করুন/ }).click();
    await page.fill('input[aria-label="প্যাকেজের নাম"]', `${TAG} 100 Diamond`);
    await page.fill('input[aria-label="বিক্রয় দাম (৳)"]', '77');
    await page.fill('input[aria-label="ক্রয় দাম (৳)"]', '60');
    await page.fill('input[aria-label="স্টক (−1 = আনলিমিটেড)"]', '5');
    const [vr] = await Promise.all([waitApi(page, '/api/admin/variant'), confirmDialog(page, 'যোগ করুন')]);
    check('প্যাকেজ API সফল', vr.status() === 200, String(vr.status()));
    await page.waitForTimeout(1000);
    const variant = prod ? await db.variant.findFirst({ where: { productId: prod.id } }) : null;
    check('প্যাকেজ DB-তে দাম ৳৭৭ · স্টক ৫', Number(variant?.price) === 77 && variant?.stock === 5,
      variant ? `৳${Number(variant.price)} · ${variant.stock}` : 'নেই');
    await page.screenshot({ path: `${SHOTS}/admin-journey-2-product.png` });

    const shopper = await apiLogin(cust.email, CUST_PASS);
    check('গ্রাহক লগইন (API)', shopper.ok);
    if (prod) {
      // ★ নামটি বাংলা, তাই slug-ও বাংলা — এই রানেই ধরা পড়েছিল যে এমন পাতা ৫০০ দিত
      check('slug-এ বাংলা অক্ষর আছে (পরীক্ষাটি অর্থবহ)', /[ঀ-৿]/.test(prod.slug), prod.slug);
      const pp = await shopper.api.get(`/product/${prod.id}/${encodeURIComponent(prod.slug)}`);
      const html = await pp.text();
      check('বাংলা-slug প্রোডাক্ট পাতা ২০০ ও নতুন প্যাকেজ দেখা যায়', pp.status() === 200 && html.includes(`${TAG} 100 Diamond`), `HTTP ${pp.status()}`);
      const short = await shopper.api.get(`/product/${prod.id}`);
      check('/product/<id> → ক্যানোনিক্যাল বাংলা-slug পাতায় পৌঁছায় (৫০০ নয়)', short.status() === 200, `HTTP ${short.status()} ${short.url().replace(BASE, '')}`);
    }

    /* ── ৩ ── */
    console.log('\n── ৩. কুপন ──');
    await go(page, '/admin/coupons');
    await page.getByRole('button', { name: /নতুন কুপন তৈরি করুন/ }).click();
    const code = `${TAG}C`.toUpperCase().slice(0, 20);
    await page.fill('input[aria-label="কুপন কোড"]', code);
    await page.fill('input[aria-label="মান (%)"], input[placeholder="10"]', '10');
    const [cr] = await Promise.all([waitApi(page, '/api/admin/coupon'), page.getByRole('button', { name: 'কুপন তৈরি করুন' }).click()]);
    check('কুপন API সফল', cr.status() === 200, String(cr.status()));
    const coupon = await db.coupon.findUnique({ where: { code } });
    if (coupon) created.couponIds.push(coupon.id);
    check('কুপন DB-তে (১০%)', coupon?.type === 'PERCENT' && Number(coupon.value) === 10);
    if (variant) {
      const chk = await shopper.api.post('/api/coupon/check', { data: { code, variantId: variant.id }, failOnStatusCode: false });
      const cj = await chk.json().catch(() => ({}));
      check('গ্রাহকের কুপন-যাচাই: ৳৭৭ → ৳৬৯.৩০', chk.status() === 200 && cj.finalPrice === '69.30', `${chk.status()} ${JSON.stringify(cj).slice(0, 80)}`);
    }

    /* ── ৪ ── */
    console.log('\n── ৪. অর্ডার বাতিল (UI) → পুরো ফেরত ──');
    let o1 = null;
    if (variant) {
      const r = await shopper.api.post('/api/order', { data: { variantId: variant.id, playerUid: '5550001', couponCode: code }, failOnStatusCode: false });
      check('গ্রাহকের অর্ডার (কুপনসহ)', r.status() === 200, String(r.status()));
      o1 = await db.order.findFirst({ where: { userId: cust.id }, orderBy: { createdAt: 'desc' } });
    }
    const bal1 = await balanceOf(cust.id);
    check('কাটা হয়েছে ৳৬৯.৩০', Math.abs(bal1 - (1000 - 69.3)) < 0.001, `৳${bal1}`);
    if (o1) {
      // ?order= pins the row: the default view lists the 100 OLDEST open orders,
      // so on a DB with a large backlog (sim) the new order is not on page one.
      await go(page, `/admin/orders?order=${o1.id}`);
      const row = page.locator('tr').filter({ hasText: `#${o1.orderNo}` }).first();
      await row.getByRole('button', { name: /বাতিল/ }).click();
      await page.selectOption('#ord-reason', 'OUT_OF_STOCK');
      await page.screenshot({ path: `${SHOTS}/admin-journey-4-fail-dialog.png` });
      const [fr] = await Promise.all([waitApi(page, '/api/admin/order'), confirmDialog(page, 'নিশ্চিত')]);
      check('বাতিল API সফল', fr.status() === 200, String(fr.status()));
      await page.waitForTimeout(800);
      const after = await db.order.findUnique({ where: { id: o1.id } });
      check('অর্ডার REFUNDED, refundedAmount = দাম', after?.status === 'REFUNDED' && Number(after.refundedAmount) === Number(after.price));
      check('ব্যালেন্স ফেরত ৳১০০০', (await balanceOf(cust.id)) === 1000);
      check('স্টক ফেরত (৫)', (await db.variant.findUnique({ where: { id: variant!.id } }))?.stock === 5);
      check('কুপন ব্যবহার ফেরত (০)', (await db.coupon.findUnique({ where: { code } }))?.usageCount === 0);
      const refundLedger = await db.ledgerEntry.findFirst({ where: { userId: cust.id, type: 'REFUND', refId: o1.id } });
      check('REFUND খতিয়ান এন্ট্রি', Number(refundLedger?.amount) === 69.3);
      const again = await (await apiLogin(ADMIN.email, ADMIN.password)).api.post('/api/admin/order', {
        data: { orderId: o1.id, action: 'FAIL', failReason: 'OUT_OF_STOCK' }, failOnStatusCode: false,
      });
      check('দ্বিতীয়বার বাতিল → ৪০৯ (দুবার ফেরত নয়)', again.status() === 409, String(again.status()));
      check('ব্যালেন্স তবু ৳১০০০', (await balanceOf(cust.id)) === 1000);
    }

    /* ── ৫ ── */
    console.log('\n── ৫. সম্পন্ন → আংশিক ফেরত ──');
    let o2 = null;
    if (variant) {
      await shopper.api.post('/api/order', { data: { variantId: variant.id, playerUid: '5550002' } });
      o2 = await db.order.findFirst({ where: { userId: cust.id, status: 'PENDING' }, orderBy: { createdAt: 'desc' } });
    }
    if (o2) {
      await go(page, `/admin/orders?order=${o2.id}`);
      const row = page.locator('tr').filter({ hasText: `#${o2.orderNo}` }).first();
      await row.getByRole('button', { name: /সম্পন্ন/ }).click();
      const [cr2] = await Promise.all([waitApi(page, '/api/admin/order'), confirmDialog(page, 'নিশ্চিত')]);
      check('সম্পন্ন API সফল', cr2.status() === 200, String(cr2.status()));
      await page.waitForTimeout(800);
      check('অর্ডার COMPLETED', (await db.order.findUnique({ where: { id: o2.id } }))?.status === 'COMPLETED');

      await go(page, '/admin/orders?status=COMPLETED');
      const row2 = page.locator('tr').filter({ hasText: `#${o2.orderNo}` }).first();
      const balBefore = await balanceOf(cust.id);
      // অতিরিক্ত ফেরত — ৳৭৭ এর বেশি।
      // ★ দুই স্তর আলাদা করে: (ক) UI নিজেই থামায়, API ডাকেই না (`runPartialRefund`
      //   এ সীমা-যাচাই); (খ) UI বাইপাস করে সরাসরি API-তে পাঠালেও সার্ভার থামায়।
      await row2.getByRole('button', { name: /আংশিক ফেরত/ }).click();
      await page.fill('#pr-amount', '100');
      await page.fill('#pr-reason', 'অতিরিক্ত-পরীক্ষা');
      let refundCalls = 0;
      const countRefund = (r: { url(): string }) => { if (r.url().includes('/api/admin/order/refund')) refundCalls++; };
      page.on('request', countRefund);
      await confirmDialog(page, 'ফেরত দিন');
      await page.waitForTimeout(1200);
      page.off('request', countRefund);
      check('UI: অতিরিক্ত ফেরতে বার্তা, API ডাকাই হয় না',
        refundCalls === 0 && (await page.locator('body').innerText()).includes('ফেরত দেওয়া যাবে'), `API কল ${refundCalls}`);
      const direct = await (await apiLogin(ADMIN.email, ADMIN.password)).api.post('/api/admin/order/refund', {
        data: { orderId: o2.id, amount: 100, reason: 'সরাসরি-API-অতিরিক্ত', requestId: `journey-over-${Date.now()}` }, failOnStatusCode: false,
      });
      check('API সরাসরি: অতিরিক্ত ফেরত → ৪০০', direct.status() === 400, String(direct.status()));
      check('অতিরিক্ত চেষ্টায় ব্যালেন্স অপরিবর্তিত', (await balanceOf(cust.id)) === balBefore);
      await page.keyboard.press('Escape').catch(() => {});
      await go(page, '/admin/orders?status=COMPLETED');
      const row3 = page.locator('tr').filter({ hasText: `#${o2.orderNo}` }).first();
      await row3.getByRole('button', { name: /আংশিক ফেরত/ }).click();
      await page.fill('#pr-amount', '10');
      await page.fill('#pr-reason', 'দেরির ক্ষতিপূরণ');
      const [part] = await Promise.all([waitApi(page, '/api/admin/order/refund'), confirmDialog(page, 'ফেরত দিন')]);
      check('আংশিক ফেরত ৳১০ সফল', part.status() === 200, String(part.status()));
      await page.waitForTimeout(600);
      check('refundedAmount = ১০', Number((await db.order.findUnique({ where: { id: o2.id } }))?.refundedAmount) === 10);
      check('ব্যালেন্স +১০', (await balanceOf(cust.id)) === balBefore + 10);
    }

    /* ── ৬ ── */
    console.log('\n── ৬. ডিপোজিট বাতিল (UI) ──');
    const trx = `ADMJ${Date.now()}`.slice(0, 20);
    const dr = await shopper.api.post('/api/deposit', { data: { method: 'BKASH', amount: 500, trxId: trx, senderNo: '01712345678' }, failOnStatusCode: false });
    check('গ্রাহকের ডিপোজিট দাবি', dr.status() === 200, String(dr.status()));
    const balBeforeDep = await balanceOf(cust.id);
    await go(page, '/admin/deposits');
    const dcard = page.locator('article').filter({ hasText: trx }).first();
    check('অ্যাডমিন সারিতে দাবিটি দেখা যায়', (await dcard.count()) > 0);
    if (await dcard.count()) {
      await dcard.getByRole('button', { name: /বাতিল/ }).click();
      await page.selectOption('#q-reason', 'TRX_NOT_FOUND');
      const [rj] = await Promise.all([waitApi(page, '/api/admin/deposit'), confirmDialog(page, 'হ্যাঁ, বাতিল করুন')]);
      check('বাতিল API সফল', rj.status() === 200, String(rj.status()));
      await page.waitForTimeout(600);
      check('ডিপোজিট REJECTED', (await db.deposit.findUnique({ where: { trxId: trx } }))?.status === 'REJECTED');
      check('ব্যালেন্স অক্ষত', (await balanceOf(cust.id)) === balBeforeDep);
    }

    /* ── ৭ ── */
    console.log('\n── ৭. ব্যালেন্স সমন্বয় (UI) ──');
    await go(page, `/admin/users/${cust.id}`);
    const b7 = await balanceOf(cust.id);
    await page.getByRole('button', { name: /ব্যালেন্স যোগ \/ কাটা/ }).click();
    await page.fill('input[aria-label="পরিমাণ (+ / −)"]', '-99999');
    await page.fill('input[aria-label="কারণ (বাধ্যতামূলক)"]', 'ঋণাত্মক-পরীক্ষা');
    const [neg] = await Promise.all([waitApi(page, '/api/admin/user'), confirmDialog(page, 'সমন্বয় করুন')]);
    check('ব্যালেন্স ঋণাত্মক করা যায় না → ৪০০', neg.status() === 400, String(neg.status()));
    check('ব্যালেন্স অপরিবর্তিত', (await balanceOf(cust.id)) === b7);
    await go(page, `/admin/users/${cust.id}`);
    await page.getByRole('button', { name: /ব্যালেন্স যোগ \/ কাটা/ }).click();
    await page.fill('input[aria-label="পরিমাণ (+ / −)"]', '50');
    await page.fill('input[aria-label="কারণ (বাধ্যতামূলক)"]', 'যাচাই-বোনাস');
    const [adj] = await Promise.all([waitApi(page, '/api/admin/user'), confirmDialog(page, 'সমন্বয় করুন')]);
    check('সমন্বয় +৫০ সফল', adj.status() === 200, String(adj.status()));
    check('ব্যালেন্স +৫০', (await balanceOf(cust.id)) === b7 + 50);
    check('ADMIN_ADJUST খতিয়ান', Boolean(await db.ledgerEntry.findFirst({ where: { userId: cust.id, type: 'ADMIN_ADJUST', amount: 50 } })));

    /* ── ৮ ── */
    console.log('\n── ৮. বন্ধ ও সক্রিয় (UI) ──');
    await go(page, `/admin/users/${cust.id}`);
    await page.getByRole('button', { name: /স্থায়ীভাবে বন্ধ/ }).click();
    const [ban] = await Promise.all([waitApi(page, '/api/admin/user'), confirmDialog(page, 'নিশ্চিত করুন')]);
    check('বন্ধ API সফল', ban.status() === 200, String(ban.status()));
    check('DB: isBanned', (await db.user.findUnique({ where: { id: cust.id } }))?.isBanned === true);
    const me = await shopper.api.get('/api/me', { failOnStatusCode: false });
    check('বন্ধ গ্রাহকের পুরনো সেশনে API → ৪০৩', me.status() === 403, String(me.status()));
    const ord = variant ? await shopper.api.post('/api/order', { data: { variantId: variant.id, playerUid: '5550003' }, failOnStatusCode: false }) : null;
    check('বন্ধ গ্রাহক অর্ডার দিতে পারেন না', ord?.status() === 403, String(ord?.status()));
    check('বন্ধ গ্রাহক নতুন করে লগইন করতে পারেন না', !(await apiLogin(cust.email, CUST_PASS)).ok);
    await go(page, `/admin/users/${cust.id}`);
    await page.getByRole('button', { name: /সক্রিয় করুন/ }).click();
    const [unban] = await Promise.all([waitApi(page, '/api/admin/user'), confirmDialog(page, 'নিশ্চিত করুন')]);
    check('সক্রিয় API সফল', unban.status() === 200, String(unban.status()));
    check('সক্রিয় করার পর লগইন চলে', (await apiLogin(cust.email, CUST_PASS)).ok);

    /* ── ৮.৫ ── */
    console.log('\n── ৮.৫. জরুরি রিকভারি-লিংক (UI) ──');
    await go(page, `/admin/users/${cust.id}`);
    await page.getByRole('button', { name: /রিকভারি-লিংক/ }).click();
    const [rec] = await Promise.all([waitApi(page, '/api/admin/user/recovery'), confirmDialog(page, 'লিংক তৈরি করুন')]);
    check('রিকভারি API সফল', rec.status() === 200, String(rec.status()));
    const linkInput = page.locator('input[aria-label="রিকভারি-লিংক"]');
    await linkInput.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
    const link = await linkInput.inputValue().catch(() => '');
    check('লিংক একবার দেখানো হয় (কপি-যোগ্য)', link.includes('/reset-password?token='));
    await page.screenshot({ path: `${SHOTS}/admin-journey-8-recovery-link.png` });
    await page.getByRole('button', { name: 'হয়ে গেছে' }).click().catch(() => {});
    const token = link ? new URL(link).searchParams.get('token') ?? '' : '';
    const RECOVERED = 'Recovered2026x';
    const custPage = await (await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 } })).newPage();
    await custPage.goto(`${BASE}/reset-password?token=${encodeURIComponent(token)}`, { waitUntil: 'domcontentloaded' });
    await settle(custPage);
    await custPage.fill('#pw', RECOVERED);
    await custPage.fill('#pw2', RECOVERED);
    const [rr] = await Promise.all([
      custPage.waitForResponse((r) => r.url().endsWith('/api/auth/reset'), { timeout: 20_000 }),
      custPage.click('button[type="submit"]'),
    ]);
    check('গ্রাহক লিংকে নতুন পাসওয়ার্ড দেন', rr.status() === 200, String(rr.status()));
    check('পুরনো পাসওয়ার্ড আর চলে না', !(await apiLogin(cust.email, CUST_PASS)).ok);
    check('নতুন পাসওয়ার্ডে লগইন', (await apiLogin(cust.email, RECOVERED)).ok);
    const reuse = await custPage.request.post(`${BASE}/api/auth/reset`, { data: { token, password: 'Again2026xyz' }, failOnStatusCode: false });
    check('একই লিংক দ্বিতীয়বার → ৪০০', reuse.status() === 400, String(reuse.status()));
    await custPage.context().close();

    /* ── ৯ ── */
    console.log('\n── ৯. লগ ও খতিয়ান ──');
    const actions = (await db.adminLog.findMany({ where: { createdAt: { gte: cust.createdAt } }, select: { action: true } })).map((a) => a.action);
    for (const a of ['PRODUCT_CREATE', 'VARIANT_CREATE', 'COUPON_CREATE', 'ORDER_REFUND', 'ORDER_COMPLETE', 'ORDER_PARTIAL_REFUND', 'DEPOSIT_REJECT', 'BALANCE_ADJUST', 'USER_BAN', 'USER_UNBAN', 'ACCOUNT_RECOVERY_LINK', 'PASSWORD_RESET']) {
      check(`অ্যাক্টিভিটি লগে ${a}`, actions.includes(a));
    }
    await go(page, '/admin/logs');
    check('/admin/logs পাতায় সমন্বয়-এন্ট্রি দেখা যায়', (await page.locator('body').innerText()).includes('ব্যালেন্স সমন্বয়'));
    check('SUM(খতিয়ান) = ব্যালেন্স', Math.abs((await ledgerSum(cust.id)) - (await balanceOf(cust.id))) < 0.001,
      `৳${await ledgerSum(cust.id)} / ৳${await balanceOf(cust.id)}`);

    /* ── ১০ ── */
    console.log('\n── ১০. লগআউট ──');
    await go(page, '/admin');
    await page.getByRole('button', { name: /^লগআউট$/ }).first().click();
    await page.waitForURL((u) => u.pathname.startsWith('/login'), { timeout: 20_000 }).catch(() => {});
    check('লগআউটে /login', new URL(page.url()).pathname === '/login', page.url().replace(BASE, ''));
    await go(page, '/admin');
    check('লগআউটের পর /admin বন্ধ', new URL(page.url()).pathname === '/login', page.url().replace(BASE, ''));

    check('কোনো pageerror বা ৫xx নেই', errors.length === 0, errors.slice(0, 3).join(' | ') || '০');
  } finally {
    const id = created.userId;
    await db.couponUse.deleteMany({ where: { userId: id } }).catch(() => {});
    await db.orderEvent.deleteMany({ where: { order: { userId: id } } }).catch(() => {});
    await db.order.deleteMany({ where: { userId: id } }).catch(() => {});
    await db.deposit.deleteMany({ where: { userId: id } }).catch(() => {});
    await db.ledgerEntry.deleteMany({ where: { userId: id } }).catch(() => {});
    await db.notification.deleteMany({ where: { userId: id } }).catch(() => {});
    await db.adminLog.deleteMany({ where: { OR: [{ targetId: id }, { adminId: id }, { detail: { contains: TAG } }] } }).catch(() => {});
    await db.user.delete({ where: { id } }).catch(() => {});
    if (created.couponIds.length) await db.coupon.deleteMany({ where: { id: { in: created.couponIds } } }).catch(() => {});
    if (created.productIds.length) {
      await db.variant.deleteMany({ where: { productId: { in: created.productIds } } }).catch(() => {});
      await db.product.deleteMany({ where: { id: { in: created.productIds } } }).catch(() => {});
    }
    await db.rateLimitBucket.deleteMany({});
    await browser.close().catch(() => {});
    await db.$disconnect();
  }

  console.log(`\n════ ${total - fail}/${total} পাস${fail ? ` · ${fail} ব্যর্থ` : ''} ════`);
  process.exitCode = fail ? 1 : 0;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
