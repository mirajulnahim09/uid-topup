/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ MASTER 2 — নতুন গ্রাহকের চোখে পুরো যাত্রা, প্রতিটি ধাপে স্ক্রিনশট
 *
 *   উদ্দেশ্য "পাস/ফেল" নয় — **দেখা**। প্রতিটি পর্দা ছবি হয়ে
 *   `audit/sim/walk/<vp>/NN-নাম.png`-এ যায়, আর মানুষের চোখে (অডিটর)
 *   বিচার হয়: চোখ প্রথমে কোথায় যায়, পরের কাজ স্পষ্ট কি না, দাম/অবস্থা
 *   বোঝা যায় কি না। সাথে যন্ত্র-মাপ: অনুভূমিক ওভারফ্লো, ছোট tap-target,
 *   কনসোল-ত্রুটি।
 *
 *   যাত্রা (কেবল পর্দায় যা দেখা যায় তা দিয়ে):
 *     হোম → লগইন → হোম → প্রোডাক্ট → প্যাকেজ বাছা → "টাকা কম" →
 *     Add Money → ডিপোজিট-দাবি → (অ্যাডমিন অনুমোদন) → প্রোডাক্ট → UID →
 *     অর্ডার → নিশ্চিতকরণ → রসিদ → অর্ডার-তালিকা → ওয়ালেট → লগআউট
 *   অ্যাডমিন: ড্যাশবোর্ড → অর্ডার-কিউ → ডিপোজিট → গ্রাহক-বিস্তারিত
 *
 *   VW=390,1440 (ডিফল্ট)। THEME=dark|light।
 * ═══════════════════════════════════════════════════════════
 */
import { db, BASE, mintCookie, call } from './_lib';
import { openBrowser } from '../verify/_browser';
import bcrypt from 'bcryptjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { Page } from 'playwright-core';

const VWS = (process.env.VW || '390,1440').split(',').map(Number);
const THEME = process.env.THEME || 'dark';
const PASSWORD = 'Walk#Customer2026';
const findings: Array<{ vp: number; step: string; overflowPx: number; smallTargets: string[]; consoleErrors: string[]; ms: number }> = [];

async function settle(page: Page) {
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForFunction(() => !document.getElementById('v-boot') && !document.querySelector('.v-ovl'), null, { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(500);
}

async function measure(page: Page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const overflow = Math.max(0, doc.scrollWidth - window.innerWidth);
    const small: string[] = [];
    for (const el of Array.from(document.querySelectorAll('a,button,[role="button"],input,select,textarea'))) {
      const r = (el as HTMLElement).getBoundingClientRect();
      const st = getComputedStyle(el as HTMLElement);
      if (r.width === 0 || r.height === 0 || st.visibility === 'hidden' || st.display === 'none') continue;
      if (r.bottom < 0 || r.top > window.innerHeight * 3) continue;
      if (window.innerWidth < 800 && (r.height < 32 || r.width < 32)) {
        const t = ((el as HTMLElement).innerText || (el as HTMLElement).getAttribute('aria-label') || el.tagName).trim().slice(0, 30);
        small.push(`${t} ${Math.round(r.width)}×${Math.round(r.height)}`);
      }
    }
    return { overflow, small: small.slice(0, 12) };
  });
}

async function main() {
  const browser = await openBrowser({ headless: true });
  const adminUser = await db.user.findUniqueOrThrow({ where: { email: 'admin@uidtopup.local' } });
  const A = await mintCookie(adminUser);
  const product = await db.product.findFirstOrThrow({
    where: { isActive: true, needsUid: true },
    include: { variants: { where: { isActive: true, stock: -1 }, orderBy: { price: 'asc' } } },
  });
  const variant = product.variants[Math.min(2, product.variants.length - 1)];

  for (const vw of VWS) {
    const vh = vw < 800 ? 844 : 900;
    const dir = `audit/sim/walk/${THEME}-${vw}`;
    mkdirSync(dir, { recursive: true });
    const tag = `${vw}-${Date.now().toString(36)}`;
    const email = `walk-${tag}@sim.invalid`;
    await db.user.create({ data: {
      name: 'Walk Customer', email, phone: `013${String(Date.now()).slice(-8)}`,
      password: await bcrypt.hash(PASSWORD, 10), referralCode: `WK${tag}`.toUpperCase().slice(0, 14), emailVerified: true,
    } });
    await db.rateLimitBucket.deleteMany({});

    const ctx = await browser.newContext({
      ignoreHTTPSErrors: true, viewport: { width: vw, height: vh }, deviceScaleFactor: 1,
      isMobile: vw < 800, hasTouch: vw < 800, locale: 'bn-BD',
      colorScheme: THEME === 'light' ? 'light' : 'dark',
    });
    await ctx.addInitScript((t) => { try { localStorage.setItem('theme', t); } catch { /* */ } }, THEME);
    const page = await ctx.newPage();
    const errs: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });
    page.on('pageerror', (e) => errs.push('pageerror: ' + String(e).slice(0, 160)));
    let n = 0;
    const shot = async (name: string, full = false) => {
      const t = Date.now();
      await settle(page);
      const m = await measure(page);
      const file = `${dir}/${String(++n).padStart(2, '0')}-${name}.png`;
      await page.screenshot({ path: file, fullPage: full });
      findings.push({ vp: vw, step: name, overflowPx: m.overflow, smallTargets: m.small, consoleErrors: errs.splice(0), ms: Date.now() - t });
      console.log(`  [${vw}] ${name}${m.overflow ? ` ⚠️ overflow ${m.overflow}px` : ''}${m.small.length ? ` · ছোট ${m.small.length}` : ''}`);
    };
    const go = async (path: string) => { await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' }); await settle(page); };

    // ── ১. প্রথম দেখা ──
    await go('/');
    await shot('home-first-view');
    await shot('home-full', true);

    // ── ২. লগইন ──
    await go('/login');
    await shot('login');
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 }).catch(() => {});
    await shot('after-login');

    // ── ৩. প্রোডাক্ট ──
    await go(`/product/${product.id}/${encodeURIComponent(product.slug)}`);
    await shot('product-first-view');
    await shot('product-full', true);
    await page.locator('[role="radio"]').filter({ hasText: variant.label }).first().click().catch(() => {});
    await page.locator('[role="radio"]').filter({ hasText: /Pay With Wallet/i }).first().click().catch(() => {});
    await page.waitForTimeout(400);
    await shot('product-variant-chosen-zero-balance', true);

    // ── ৪. টাকা যোগ ──
    await go('/account/wallet/deposit');
    await shot('deposit-page');
    await shot('deposit-full', true);
    const trx = `WALK${Date.now().toString(36).toUpperCase()}`;
    // ফর্মের ঘরগুলো লেবেল/placeholder দেখে খোঁজা — মানুষ যেভাবে খোঁজেন
    // ★ পর্দায় যে ইঙ্গিত দেখা যায় (placeholder) তা ধরে — মানুষ যেভাবে ঘর চেনেন
    await page.locator('input[placeholder*="যত টাকা"]').first().fill(String(Math.ceil(Number(variant.price) + 50))).catch(() => {});
    await page.locator('input[placeholder*="9A7B"]').first().fill(trx).catch(() => {});
    await page.locator('input[placeholder^="01X"]').first().fill('01711111111').catch(() => {});
    await shot('deposit-filled', true);
    await page.locator('button[type="submit"]').last().click().catch(() => {});
    await page.waitForTimeout(2500);
    await shot('deposit-submitted', true);
    const dep = await db.deposit.findFirst({ where: { user: { email } }, orderBy: { createdAt: 'desc' } });
    if (dep) {
      const r = await call('walk approve', A, 'POST', '/api/admin/deposit', { depositId: dep.id, action: 'APPROVE' }, { record: false });
      console.log(`  [${vw}] ডিপোজিট দাবি পাওয়া গেছে ৳${dep.amount} → অনুমোদন HTTP ${r.status}`);
    } else {
      console.log(`  [${vw}] ⚠️ UI দিয়ে ডিপোজিট-দাবি জমা হয়নি — ফর্মের স্ক্রিনশট দেখুন`);
      const u = await db.user.findUniqueOrThrow({ where: { email } });
      const c = await mintCookie(u);
      await call('walk dep api', c, 'POST', '/api/deposit', { method: 'BKASH', amount: Math.ceil(Number(variant.price) + 50), trxId: trx, senderNo: '01711111111' }, { record: false });
      const d2 = await db.deposit.findFirstOrThrow({ where: { trxId: trx } });
      await call('walk approve', A, 'POST', '/api/admin/deposit', { depositId: d2.id, action: 'APPROVE' }, { record: false });
    }
    await go('/account');
    await shot('account-after-deposit');

    // ── ৫. অর্ডার ──
    await go(`/product/${product.id}/${encodeURIComponent(product.slug)}`);
    await page.locator('[role="radio"]').filter({ hasText: variant.label }).first().click().catch(() => {});
    await page.locator('[role="radio"]').filter({ hasText: /Pay With Wallet/i }).first().click().catch(() => {});
    await page.fill('#uid', '1234567890').catch(() => {});
    await page.fill('#uid2', '1234567890').catch(() => {});
    await page.waitForTimeout(300);
    await shot('product-ready-to-order', true);
    await page.locator('button', { hasText: /অর্ডার করুন\s*$/ }).last().click().catch(() => {});
    await page.waitForTimeout(700);
    await shot('order-confirm-dialog');
    await page.locator('button', { hasText: 'হ্যাঁ, অর্ডার করুন' }).first().click().catch(() => {});
    await page.waitForTimeout(3000);
    await shot('order-result', true);

    // ── ৬. পরে দেখা ──
    await go('/account/orders');
    await shot('orders-list', true);
    const o = await db.order.findFirst({ where: { user: { email } }, orderBy: { createdAt: 'desc' } });
    if (o) {
      await go(`/account/orders/${o.id}`);
      await shot('order-detail', true);
      await call('walk complete', A, 'POST', '/api/admin/order', { orderId: o.id, action: 'COMPLETE', takeover: true }, { record: false });
      await go(`/account/orders/${o.id}`);
      await shot('order-detail-completed', true);
    }
    await go('/account');
    await shot('account-full', true);
    await go('/account/notifications');
    await shot('notifications', true);

    // ── ৭. অ্যাডমিন ──
    const actx = await browser.newContext({
      ignoreHTTPSErrors: true, viewport: { width: vw, height: vh }, isMobile: vw < 800, hasTouch: vw < 800,
      colorScheme: THEME === 'light' ? 'light' : 'dark',
    });
    const cookieVal = A.split('=').slice(1).join('=');
    await actx.addCookies([{ name: A.split('=')[0], value: cookieVal, domain: 'localhost', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' }]);
    await actx.addInitScript((t) => { try { localStorage.setItem('theme', t); } catch { /* */ } }, THEME);
    const ap = await actx.newPage();
    ap.on('console', (m) => { if (m.type() === 'error') errs.push('admin: ' + m.text().slice(0, 160)); });
    const ashot = async (name: string, path: string, full = true) => {
      await ap.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
      await settle(ap);
      const m = await measure(ap);
      await ap.screenshot({ path: `${dir}/${String(++n).padStart(2, '0')}-admin-${name}.png`, fullPage: full });
      findings.push({ vp: vw, step: 'admin-' + name, overflowPx: m.overflow, smallTargets: m.small, consoleErrors: errs.splice(0), ms: 0 });
      console.log(`  [${vw}] admin-${name}${m.overflow ? ` ⚠️ overflow ${m.overflow}px` : ''}`);
    };
    await ashot('dashboard', '/admin', false);
    await ashot('orders-queue', '/admin/orders', false);
    await ashot('deposits', '/admin/deposits', false);
    await ashot('withdrawals', '/admin/withdrawals', false);
    const u = await db.user.findUniqueOrThrow({ where: { email } });
    await ashot('customer-detail', `/admin/users/${u.id}`, true);
    await actx.close();

    // ── ৮. লগআউট ──
    await go('/account');
    await ctx.close();
  }
  await browser.close();
  writeFileSync('audit/sim/walk/findings.json', JSON.stringify(findings, null, 2));
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());
