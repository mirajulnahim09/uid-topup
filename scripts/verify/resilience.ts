/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ বিপর্যয়ে আচরণ — নেটওয়ার্ক, গেটওয়ে, ডাটাবেস
 *     (চূড়ান্ত মাস্টার অডিট, ২০২৬-০৯-১৭)
 *
 *   ক. গেটওয়ে ৫০২ (HTML) — Vercel টাইমআউটের মতো; গ্রাহক কী দেখে
 *   খ. অফলাইনে অর্ডার — বার্তা; অনলাইনে ফিরে আবার চাপলে ঠিক একটি অর্ডার
 *   গ. সার্ভারে অর্ডার হলো কিন্তু উত্তর হারাল (মোবাইল নেট কেটে গেল) →
 *      আবার চাপলে **দ্বিতীয় অর্ডার/দ্বিতীয় কাটা নয়** (clientRef)
 *   ঘ. ডাটাবেস বন্ধ → স্বাস্থ্য-API, পাতা, লগইন কী করে; ভেতরের তথ্য ফাঁস নয়;
 *      DB ফিরলে সার্ভার রিস্টার্ট ছাড়াই সেরে ওঠে
 *
 *   ⚠️ ঘ-অংশ `docker stop uidtopup-dev-db` চালায় — কেবল স্থানীয় ডেভ DB।
 *   চালানো: VERIFY_BASE=https://localhost:3443 npx tsx scripts/verify/resilience.ts
 * ═══════════════════════════════════════════════════════════
 */
import { db, BASE, dbLabel } from './_db';
import { openBrowser } from './_browser';
import { creditWallet } from '../../src/lib/services/wallet';
import bcrypt from 'bcryptjs';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { request, type Page } from 'playwright-core';

const SHOTS = 'audit/shots';
mkdirSync(SHOTS, { recursive: true });
const TAG = `resil-${Date.now().toString(36)}`;
const PASSWORD = 'Resilience2026Pass';
const FUND = 500;
const DB_CONTAINER = 'uidtopup-dev-db';
const LEAK = /prisma|ECONNREFUSED|5434|postgres|at async|node_modules|TypeError|SyntaxError/i;

let total = 0; let fail = 0;
function ev(page: string, role: string, action: string, expected: string, actual: string, ok: boolean) {
  total++; if (!ok) fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'} | PAGE: ${page} | ROLE: ${role} | ACTION: ${action} | EXPECTED: ${expected} | ACTUAL: ${actual}`);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function settle(page: Page) {
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForFunction(() => !document.getElementById('v-boot') && !document.querySelector('.v-ovl'), null, { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(400);
}

/** প্রোডাক্ট পাতায় প্যাকেজ + ওয়ালেট + UID দুই ঘর পূরণ, তারপর অর্ডার → নিশ্চিত */
async function submitOrder(page: Page, label: string) {
  await page.locator('[role="radio"]').filter({ hasText: label }).first().click().catch(() => {});
  await page.locator('[role="radio"]').filter({ hasText: /Pay With Wallet/i }).first().click().catch(() => {});
  if (!(await page.inputValue('#uid').catch(() => ''))) {
    await page.fill('#uid', '1234567890');
    await page.locator('#uid').blur();
    await page.fill('#uid2', '1234567890');
    await page.waitForTimeout(300);
  }
  await page.locator('button', { hasText: /অর্ডার করুন\s*$/ }).last().click();
  await page.locator('[role="dialog"], [role="alertdialog"]').first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
  await page.locator('button', { hasText: 'হ্যাঁ, অর্ডার করুন' }).first().click();
}

/**
 * ⚠️ `[role="alert"]` একা নয় — Next-এর route announcer-ও `role="alert"` (পাতার শিরোনাম
 *   ধরে), প্রথম রানে সেটিই "বার্তা" হিসেবে পড়ে ভুয়া PASS দিয়েছিল। তাই টোস্টের নিজের ক্লাস।
 */
async function toastText(page: Page) {
  const t = page.locator('.v-toast .v-toast__msg').last();
  await t.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
  return (await t.innerText().catch(() => '')).trim();
}

const dockerCmd = (...args: string[]) => execFileSync('docker', args, { encoding: 'utf8', timeout: 120_000 }).trim();

async function main() {
  console.log(`═══ বিপর্যয়-যাচাই · ${BASE} · DB ${dbLabel()} ═══`);
  const variant = await db.variant.findFirst({
    where: { isActive: true, stock: -1, price: { lte: 100 }, product: { isActive: true, needsUid: true } },
    orderBy: { price: 'asc' }, include: { product: true },
  });
  if (!variant) throw new Error('উপযুক্ত প্যাকেজ নেই');
  const price = Number(variant.price);
  const productPath = `/product/${variant.product.id}/${encodeURIComponent(variant.product.slug)}`;
  const user = await db.user.create({
    data: {
      name: 'বিপর্যয় যাচাই', email: `${TAG}@verify.local`, phone: `016${String(Date.now()).slice(-8)}`,
      password: await bcrypt.hash(PASSWORD, 10), emailVerified: true, referralCode: TAG.toUpperCase().slice(0, 12),
    },
  });
  await db.$transaction((tx) => creditWallet({ tx, userId: user.id, amount: FUND, type: 'ADMIN_ADJUST', note: 'বিপর্যয়-যাচাই' }));
  const orders = () => db.order.count({ where: { userId: user.id } });
  const balance = async () => Number((await db.user.findUnique({ where: { id: user.id }, select: { balance: true } }))!.balance);

  const browser = await openBrowser({ headless: true });
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)));

  try {
    await db.rateLimitBucket.deleteMany({});
    await page.goto(`${BASE}/login?callbackUrl=${encodeURIComponent(productPath)}`, { waitUntil: 'domcontentloaded' });
    await settle(page);
    await page.fill('input[type="email"]', user.email);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => u.pathname.startsWith('/product/'), { timeout: 30_000 });
    await settle(page);

    /* ── ক. গেটওয়ে ৫০২ HTML ── */
    console.log('\n── ক. গেটওয়ে ৫০২ (HTML উত্তর) ──');
    await page.route('**/api/order', (r) => r.fulfill({ status: 502, contentType: 'text/html', body: '<html><body>502 Bad Gateway</body></html>' }));
    await submitOrder(page, variant.label);
    const t502 = await toastText(page);
    await page.screenshot({ path: `${SHOTS}/resilience-1-gateway-502.png` });
    ev(productPath, 'গ্রাহক (390x844)', 'অর্ডার → ৫০২ HTML', 'বাংলা বোধগম্য বার্তা, কারিগরি ইংরেজি নয়', t502 || '(কোনো বার্তা নেই)', Boolean(t502) && !LEAK.test(t502) && !/Unexpected token|JSON/i.test(t502));
    ev(productPath, 'সিস্টেম', '৫০২-এর পর DB', 'অর্ডার ০, ব্যালেন্স অপরিবর্তিত', `অর্ডার ${await orders()}, ৳${await balance()}`, (await orders()) === 0 && (await balance()) === FUND);
    await page.unroute('**/api/order');

    /* ── খ. অফলাইন ── */
    console.log('\n── খ. অফলাইন → অনলাইন ──');
    await page.waitForTimeout(4500); // আগের টোস্ট সরে যাক
    await ctx.setOffline(true);
    await submitOrder(page, variant.label);
    const tOff = await toastText(page);
    await page.screenshot({ path: `${SHOTS}/resilience-2-offline.png` });
    ev(productPath, 'গ্রাহক (390x844)', 'অফলাইনে অর্ডার', 'বাংলা বার্তা ("ইন্টারনেট সংযোগ" ধরনের)', tOff || '(কোনো বার্তা নেই)', Boolean(tOff) && !/Failed to fetch|NetworkError|Load failed/i.test(tOff));
    await ctx.setOffline(false);
    await page.waitForTimeout(4500);
    const [okRes] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/api/order') && r.request().method() === 'POST', { timeout: 30_000 }),
      submitOrder(page, variant.label),
    ]);
    await page.waitForTimeout(1500);
    ev(productPath, 'গ্রাহক (390x844)', 'অনলাইনে ফিরে আবার', '২০০, ঠিক ১টি অর্ডার, একবার কাটা', `${okRes.status()}, অর্ডার ${await orders()}, ৳${await balance()}`, okRes.status() === 200 && (await orders()) === 1 && (await balance()) === FUND - price);

    /* ── গ. উত্তর হারাল ── */
    console.log('\n── গ. সার্ভারে অর্ডার হলো, উত্তর হারাল → আবার চাপা ──');
    await go(page, productPath);
    let reached = false;
    await page.route('**/api/order', async (r) => {
      if (!reached) {
        reached = true;
        await r.fetch().catch(() => null); // সার্ভারে পৌঁছায় ও কাজ হয়
        await r.abort('internetdisconnected'); // কিন্তু ব্রাউজার উত্তর পায় না
      } else {
        await r.continue();
      }
    });
    await submitOrder(page, variant.label);
    const tLost = await toastText(page);
    await sleep(1000);
    ev(productPath, 'সিস্টেম', 'উত্তর হারানোর পর DB', 'সার্ভারে অর্ডার হয়েছে (২য়)', `অর্ডার ${await orders()}`, (await orders()) === 2);
    ev(productPath, 'গ্রাহক (390x844)', 'উত্তর হারাল', 'বাংলা বার্তা', tLost || '(কোনো বার্তা নেই)', Boolean(tLost) && !/Failed to fetch|NetworkError|Load failed/i.test(tLost));
    await page.waitForTimeout(4500);
    const [retry] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/api/order') && r.request().method() === 'POST', { timeout: 30_000 }),
      submitOrder(page, variant.label),
    ]);
    await page.waitForTimeout(1500);
    ev(productPath, 'গ্রাহক (390x844)', 'একই অর্ডার আবার চাপা', '২০০, দ্বিতীয় অর্ডার/কাটা নয় (মোট ২টি)', `${retry.status()}, অর্ডার ${await orders()}, ৳${await balance()}`, retry.status() === 200 && (await orders()) === 2 && (await balance()) === FUND - 2 * price);
    await page.unroute('**/api/order');

    /* ── ঘ. ডাটাবেস বন্ধ ── */
    // ★ `RESILIENCE_SKIP_DB=1` — কেবল নেটওয়ার্ক-অংশ আবার চালাতে (DB বন্ধ না করে)
    if (process.env.RESILIENCE_SKIP_DB === '1') { console.log('\n── ঘ. বাদ (RESILIENCE_SKIP_DB=1) ──'); return; }
    console.log('\n── ঘ. ডাটাবেস বন্ধ → চালু ──');
    const anon = await request.newContext({ ignoreHTTPSErrors: true });
    dockerCmd('stop', DB_CONTAINER);
    const t0 = Date.now();
    try {
      const h = await anon.get(`${BASE}/api/health`, { failOnStatusCode: false, timeout: 60_000 });
      const hb = await h.text();
      ev('/api/health', 'মনিটর', 'DB বন্ধ অবস্থায়', 'অ-২০০ (৫০৩) ও ভেতরের তথ্য নেই', `${h.status()} ${hb.slice(0, 80)}`, h.status() !== 200 && !/5434|postgres:\/\/|ECONNREFUSED/i.test(hb));

      const home = await anon.get(`${BASE}/`, { failOnStatusCode: false, timeout: 60_000 });
      const homeHtml = await home.text();
      ev('/', 'অতিথি', 'DB বন্ধ অবস্থায় হোম', 'ত্রুটি-পাতা, স্ট্যাক/DB তথ্য ফাঁস নয়', `${home.status()} · ফাঁস ${/ECONNREFUSED|5434|postgres:\/\/|at async|PrismaClient/i.test(homeHtml) ? 'হ্যাঁ' : 'না'}`, !/ECONNREFUSED|5434|postgres:\/\/|at async|PrismaClient/i.test(homeHtml));

      await page.goto(`${BASE}/account/orders`, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => null);
      await page.waitForTimeout(2500);
      const body = await page.locator('body').innerText().catch(() => '');
      await page.screenshot({ path: `${SHOTS}/resilience-3-db-down.png` });
      ev('/account/orders', 'গ্রাহক (390x844)', 'DB বন্ধ অবস্থায়', 'বাংলা ত্রুটি-পাতা, ফাঁস নয়', body.replace(/\s+/g, ' ').slice(0, 90), body.length > 0 && !/ECONNREFUSED|5434|postgres:\/\/|PrismaClient/i.test(body));

      const csrf = await anon.get(`${BASE}/api/auth/csrf`, { failOnStatusCode: false });
      const { csrfToken } = await csrf.json().catch(() => ({ csrfToken: '' }));
      const lg = await anon.post(`${BASE}/api/auth/callback/credentials`, {
        form: { csrfToken, email: user.email, password: PASSWORD, json: 'true' }, maxRedirects: 0, failOnStatusCode: false, timeout: 60_000,
      });
      const sess = await (await anon.get(`${BASE}/api/auth/session`, { failOnStatusCode: false })).json().catch(() => null);
      ev('/api/auth/callback/credentials', 'অতিথি', 'DB বন্ধ অবস্থায় লগইন', 'লগইন হয় না (fail-closed)', `${lg.status()} · সেশন ${sess?.user ? 'আছে' : 'নেই'}`, !sess?.user);
    } finally {
      dockerCmd('start', DB_CONTAINER);
    }
    let healthyAt = -1;
    for (let i = 0; i < 60; i++) {
      await sleep(2000);
      const h = await anon.get(`${BASE}/api/health`, { failOnStatusCode: false }).catch(() => null);
      if (h && h.status() === 200) { healthyAt = Math.round((Date.now() - t0) / 1000); break; }
    }
    const homeBack = await anon.get(`${BASE}/`, { failOnStatusCode: false });
    ev('/api/health + /', 'মনিটর', 'DB চালুর পর (সার্ভার রিস্টার্ট ছাড়া)', '২০০-তে ফেরে', `health ${healthyAt < 0 ? '১২০s-এও নয়' : `DB বন্ধের ${healthyAt}s পর ২০০`} · হোম ${homeBack.status()}`, healthyAt > 0 && homeBack.status() === 200);
    await page.goto(`${BASE}/account/orders`, { waitUntil: 'domcontentloaded' });
    await settle(page);
    ev('/account/orders', 'গ্রাহক (390x844)', 'DB ফেরার পর একই সেশনে', 'পাতা স্বাভাবিক, আগের সেশন বৈধ', page.url().includes('/account/orders') ? 'অর্ডার-পাতা খুলেছে' : page.url(), page.url().includes('/account/orders'));
    await anon.dispose();

    ev('সব পাতা', 'গ্রাহক', 'JS pageerror', '০', pageErrors.length ? pageErrors.join(' | ') : '০', pageErrors.length === 0);
  } finally {
    await browser.close();
    // পরিষ্কার — কেবল এই যাচাইয়ের ব্যবহারকারী
    for (let i = 0; i < 30; i++) { try { await db.$queryRaw`SELECT 1`; break; } catch { await sleep(2000); } }
    await db.notification.deleteMany({ where: { userId: user.id } });
    await db.adminLog.deleteMany({ where: { OR: [{ adminId: user.id }, { targetId: user.id }] } });
    await db.ledgerEntry.deleteMany({ where: { userId: user.id } });
    await db.order.deleteMany({ where: { userId: user.id } });
    await db.user.delete({ where: { id: user.id } });
    await db.rateLimitBucket.deleteMany({});
  }
  console.log(`\nফল: ${total - fail}/${total} PASS`);
  if (fail) process.exitCode = 1;
}

async function go(page: Page, path: string) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  await settle(page);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());
