/**
 * ═══════════════════════════════════════════════════════════
 * Loading/failure states in a real browser (master audit 2026-11-05)
 *
 *   VERIFY_BASE=https://localhost:3443 npx tsx scripts/verify/loading-failure-states.ts
 *   (VERIFY_BROWSER=firefox|webkit for the other engines)
 *
 *   Local dev DB only (`_db.ts` refuses anything else). Uses the local seed
 *   accounts; passwords are never printed. Read-only: no order is placed.
 *
 *   1  MA-09 product page: `/api/me` fails → the wallet button area shows an
 *      error with "আবার চেষ্টা" instead of an endless skeleton; retry recovers.
 *   2  MA-02 `/login?callbackUrl=/login`: a successful sign-in leaves the
 *      login page (role default) instead of a button stuck on "অপেক্ষা করুন...".
 *   3  MA-10 `/admin/tools`: readiness fetch fails → visible failure card with
 *      retry (it used to render nothing); retry recovers.
 * ═══════════════════════════════════════════════════════════
 */
import { db, BASE } from './_db';
import { openBrowser } from './_browser';
import type { BrowserContext, Page } from 'playwright-core';
import { DEFAULT_SEED_ADMIN_EMAIL, DEFAULT_SEED_ADMIN_PASSWORD } from '../../src/lib/seedDefaults';

const CUSTOMER = { email: 'customer@uidtopup.local', password: 'Customer@2026Secure' };
const ADMIN = { email: DEFAULT_SEED_ADMIN_EMAIL, password: DEFAULT_SEED_ADMIN_PASSWORD };

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, note = '') => {
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${note ? ` — ${note}` : ''}`);
};

async function apiLogin(ctx: BrowserContext, who: { email: string; password: string }) {
  const { csrfToken } = await (await ctx.request.get(`${BASE}/api/auth/csrf`)).json();
  await ctx.request.post(`${BASE}/api/auth/callback/credentials`, {
    form: { csrfToken, email: who.email, password: who.password, json: 'true' },
    maxRedirects: 0, failOnStatusCode: false,
  });
}

async function settle(page: Page) {
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForFunction(() => !document.querySelector('.v-ovl'), null, { timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(600);
}

(async () => {
  console.log(`═══ loading/failure states · ${BASE} ═══`);
  await db.rateLimitBucket.deleteMany({}); // local dev DB only (guarded by _db)
  const variant = await db.variant.findFirst({
    where: { isActive: true, stock: { not: 0 }, product: { isActive: true } },
    select: { label: true, product: { select: { id: true, slug: true } } },
  });
  if (!variant) throw new Error('no active variant with stock in the dev DB');
  const product = variant.product;

  const browser = await openBrowser({ headless: true });
  try {
    /* ── 1. OrderForm: /api/me failure ── */
    console.log('\n── 1. প্রোডাক্ট পাতা — /api/me ব্যর্থ ──');
    const c1 = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 } });
    await apiLogin(c1, CUSTOMER);
    const p1 = await c1.newPage();
    let failMe = true;
    await p1.route('**/api/me', (r) => (failMe ? r.fulfill({ status: 500, body: 'boom' }) : r.continue()));
    await p1.goto(`${BASE}/product/${product.id}/${product.slug}`, { waitUntil: 'load' });
    await settle(p1);
    await p1.locator('[role="radio"]').filter({ hasText: variant.label }).first().click({ timeout: 10_000 }).catch(() => {});
    await p1.waitForTimeout(800);
    const retry = p1.getByRole('button', { name: 'আবার চেষ্টা' });
    check('ব্যর্থতায় "আবার চেষ্টা" দেখায় (চিরস্থায়ী skeleton নয়)', await retry.isVisible().catch(() => false));
    failMe = false;
    await retry.click().catch(() => {});
    await p1.waitForTimeout(1500);
    const recovered = !(await retry.isVisible().catch(() => false));
    const actionable = await p1.locator('text=/অর্ডার করুন|টাকা কম আছে|আইডি|UID/').first().isVisible().catch(() => false);
    check('"আবার চেষ্টা"-র পর ব্যালেন্স আসে, বোতাম ফেরে', recovered && actionable);
    await c1.close();

    /* ── 2. Login with callbackUrl=/login ── */
    console.log('\n── 2. /login?callbackUrl=/login ──');
    await db.rateLimitBucket.deleteMany({});
    const c2 = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 } });
    const p2 = await c2.newPage();
    await p2.goto(`${BASE}/login?callbackUrl=%2Flogin`, { waitUntil: 'load' });
    await settle(p2);
    await p2.fill('#email', CUSTOMER.email);
    await p2.fill('#pw', CUSTOMER.password);
    await p2.click('button[type="submit"]');
    await p2.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20_000 }).catch(() => {});
    const path2 = new URL(p2.url()).pathname;
    check('লগইনের পর লগইন-পাতা ছাড়ে (আটকে থাকে না)', !path2.startsWith('/login'), path2);
    await c2.close();

    /* ── 3. Admin readiness failure ── */
    console.log('\n── 3. /admin/tools — readiness ব্যর্থ ──');
    await db.rateLimitBucket.deleteMany({});
    const c3 = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 } });
    await apiLogin(c3, ADMIN);
    const p3 = await c3.newPage();
    let failReady = true;
    await p3.route('**/api/admin/readiness', (r) => (failReady ? r.fulfill({ status: 503, body: '{}' }) : r.continue()));
    await p3.goto(`${BASE}/admin/tools`, { waitUntil: 'load' });
    await settle(p3);
    const retry3 = p3.getByRole('button', { name: 'আবার চেষ্টা' });
    check('readiness ব্যর্থ হলে ব্যর্থতার কার্ড ও "আবার চেষ্টা"', await retry3.isVisible().catch(() => false));
    failReady = false;
    await retry3.click().catch(() => {});
    await p3.waitForTimeout(2500);
    check('"আবার চেষ্টা"-র পর প্রস্তুতি-প্যানেল আসে', await p3.getByText('সিস্টেম প্রস্তুতি').first().isVisible().catch(() => false));
    await c3.close();
  } finally {
    await browser.close();
    await db.rateLimitBucket.deleteMany({});
    await db.$disconnect();
  }
  console.log(`\n════ ${pass}/${pass + fail} পাস ════`);
  if (fail) process.exitCode = 1;
})().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; });
