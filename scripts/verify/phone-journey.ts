/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ ফোনে পুরো গ্রাহক-যাত্রা — প্রতিটি ধাপে "দেখা যায় ও চাপা যায়" মাপা
 *     (প্রি-প্রোডাকশন লক, ২০২৬-০৯-২৭)
 *
 *   `customer-journey` অর্ডার/IDOR ঢাকে, `business-flow-e2e` টাকার পথ ডেস্কটপে।
 *   এটি **ফোনে** সেই ধাপগুলো করে যা একসাথে কোথাও ছিল না:
 *     রেজিস্টার → ভুল পাসওয়ার্ড → লগইন → হোম/মেনু → প্রোডাক্ট → (অবৈধ অর্ডার)
 *     → ডিপোজিট (অবৈধ → মাধ্যম → প্রমাণ-ছবি → লম্বা TrxID → বৈধ) → অ্যাডমিন অনুমোদন
 *     (ফোনেই) → বৈধ অর্ডার → অর্ডারের অবস্থা → অ্যাকাউন্ট/লেনদেনের ইতিহাস →
 *     প্রত্যাহার (অবৈধ → বৈধ) → মেনু থেকে লগআউট
 *
 *   প্রতিটি মূল বোতাম/ত্রুটির জন্য `usable()`: স্ক্রল করে আনলে পুরোটা ভিউপোর্টের
 *   ভেতরে, আর কেন্দ্রবিন্দুতে `elementFromPoint` সেটিই (কোনো স্থির বার ঢেকে নেই)।
 *   প্রতিটি পাতায় `noHScroll()`: html/body-র overflow সাময়িক `visible` করে আসল নথি-প্রস্থ।
 *
 *   চালানো: VERIFY_BASE=https://localhost:3443 PJ_VP=390x844 npx tsx scripts/verify/phone-journey.ts
 *   ⚠️ নিজের তৈরি ব্যবহারকারী ও সারি শেষে মুছে; বদলানো সেটিং আগের মানে ফেরায়।
 * ═══════════════════════════════════════════════════════════
 */
import { db, BASE, dbLabel } from './_db';
import { openBrowser } from './_browser';
import { issueOtp } from '../../src/lib/otp/core';
import type { Page, Locator } from 'playwright-core';

const [VW, VH] = (process.env.PJ_VP || '390x844').split('x').map(Number);
const TAG = `pj${Date.now().toString(36)}`;
const EMAIL = `${TAG}@verify.local`;
const PASSWORD = 'PhoneJourney2026x';
const ADMIN = { email: 'admin@uidtopup.local', password: 'Admin@2026Secure' };
const DEPOSIT = 1500;

let total = 0;
let fail = 0;
function check(name: string, ok: boolean, note = '') {
  total++;
  if (!ok) fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${note ? ` — ${note}` : ''}`);
}

async function settle(page: Page) {
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  // ★ চলমান RSC-prefetch শেষ হতে দেওয়া — নাহলে পাতা ছাড়ার মুহূর্তে বাতিল prefetch
  //   "Failed to fetch RSC payload" লেখে, যা হারনেসের তাড়াহুড়ো, অ্যাপের ত্রুটি নয়
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  await page.waitForFunction(() => !document.getElementById('v-boot') && !document.querySelector('.v-ovl'), null, { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(400);
}
async function go(page: Page, path: string) {
  const res = await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  await settle(page);
  return res;
}

/** ★ আসল নথি-প্রস্থ — body-র overflow-x:hidden ওভারফ্লো লুকায়, তাই সাময়িক খুলে মাপা */
async function noHScroll(page: Page, label: string) {
  const r = await page.evaluate(`(function(){
    var de=document.documentElement, b=document.body;
    var h=de.style.overflowX, bb=b.style.overflowX;
    de.style.overflowX='visible'; b.style.overflowX='visible';
    var w=de.scrollWidth; de.style.overflowX=h; b.style.overflowX=bb;
    return { sw: w, vw: de.clientWidth };
  })()`) as { sw: number; vw: number };
  check(`${label}: আড়াআড়ি স্ক্রল নেই`, r.sw <= r.vw + 1, `নথি ${r.sw}px / ভিউপোর্ট ${r.vw}px`);
}

/** ★ দেখা যায় ও চাপা যায়: ভিউপোর্টের ভেতরে পুরোটা, আর কেন্দ্রে অন্য কিছু চাপা পড়ে নেই */
async function usable(page: Page, loc: Locator, label: string) {
  const el = loc.first();
  const vis = await el.isVisible().catch(() => false);
  if (!vis) { check(`${label}: দেখা যায়`, false, 'অদৃশ্য/নেই'); return false; }
  // ★ ব্যবহারকারী যেভাবে দেখেন — উপাদানটি পর্দার মাঝে এনে। Playwright-এর ন্যূনতম স্ক্রল
  //   উপাদানকে ঠিক কিনারায় (স্থির হেডার/বটম-নেভের নিচে) রাখে, যা কোনো মানুষ করে না।
  //   পাতার একদম শেষের উপাদান মাঝে আসতে না পারলে যতটা সম্ভব ওঠে — তখনো ঢাকা থাকলে
  //   সেটিই আসল ত্রুটি (নিচে যথেষ্ট ফাঁকা জায়গা নেই)।
  await el.evaluate((n) => n.scrollIntoView({ block: 'center', inline: 'nearest' })).catch(() => {});
  await page.waitForTimeout(250);
  const box = await el.boundingBox();
  const inside = !!box && box.x >= -1 && box.x + box.width <= VW + 1 && box.y >= -1 && box.y + box.height <= VH + 1;
  const top = await el.evaluate((n) => {
    const r = n.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!hit && (hit === n || n.contains(hit) || hit.contains(n));
  }).catch(() => false);
  const ok = inside && top;
  check(`${label}: দেখা যায় ও চাপা যায়`, ok,
    box ? `x=${Math.round(box.x)} w=${Math.round(box.width)} y=${Math.round(box.y)} h=${Math.round(box.height)}${top ? '' : ' · উপরে অন্য কিছু'}` : 'বাক্স নেই');
  return ok;
}

/** ★ 1×1 PNG — পেমেন্ট-প্রমাণ হিসেবে আপলোডের জন্য */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function main() {
  console.log(`ডাটাবেস: ${dbLabel()} · সাইট: ${BASE} · ফোন ${VW}×${VH}`);
  const browser = await openBrowser({ headless: process.env.HEADLESS === '1' });
  const ctxOpts = { ignoreHTTPSErrors: true, viewport: { width: VW, height: VH }, isMobile: true, hasTouch: true };
  const cctx = await browser.newContext(ctxOpts);
  const actx = await browser.newContext(ctxOpts);
  const page = await cctx.newPage();
  const ap = await actx.newPage();

  const consoleErrors: string[] = [];
  const badResponses: string[] = [];
  /**
   * ★ ব্যাখ্যাত কোলাহল — **লুকানো নয়**, আলাদা গোনা ও শেষে ছাপা। কেবল দুটি শ্রেণি, সংকীর্ণ শর্তে:
   *   ১. লোকাল-স্টোরেজ রিগ: `STORAGE_DRIVER=local` + `next build`-এ রানটাইম-আপলোড পরিবেশিত
   *      হয় না (/uploads/… ৪০৪, তার /_next/image ৪০০)। প্রোডাকশনে ছবি Blob-এ — সেটি আলাদা যাচাই।
   *   ২. পাতা ছাড়ার মুহূর্তে বাতিল হওয়া RSC-prefetch ("Failed to fetch RSC payload … Falling
   *      back to browser navigation") — স্ক্রিপ্টের `goto`, অ্যাপের ত্রুটি নয়।
   *   বাকি যেকোনো কনসোল-ত্রুটি আগের মতোই FAIL।
   */
  const explained: string[] = [];
  const uploadNoise = new Set<string>();
  let expectedStatus: number[] = [];
  for (const p of [page, ap]) {
    p.on('console', (m) => {
      if (m.type() !== 'error') return;
      // ★ ইচ্ছাকৃত ৪xx (ভুল পাসওয়ার্ড, অবৈধ অনুরোধ) — ব্রাউজার নিজেই "Failed to load resource" লেখে
      if (expectedStatus.some((s) => new RegExp(`Failed to load resource.*${s}`).test(m.text()))) return;
      const src = m.location()?.url || '';
      if (/Failed to load resource/.test(m.text()) && (src.includes('/uploads/') || src.includes('url=%2Fuploads%2F'))) {
        explained.push(`লোকাল-আপলোড পরিবেশিত নয়: ${src.replace(BASE, '').slice(0, 90)}`); return;
      }
      if (/^Failed to fetch RSC payload for .* Falling back to browser navigation/.test(m.text())) {
        explained.push(`বাতিল RSC-prefetch: ${m.text().slice(29, 110)}`); return;
      }
      consoleErrors.push(`${m.text().slice(0, 300)} @ ${p.url().replace(BASE, '')}`);
      // ★ next-auth-এর বার্তার আসল কারণ argument-এ থাকে — উৎস চিনতে ছাপা
      if (m.text().includes('next-auth')) {
        void Promise.all(m.args().map((a) => a.jsonValue().catch(() => '?'))).then((v) =>
          console.log(`      · next-auth বিস্তারিত @ ${p.url().replace(BASE, '')}: ${JSON.stringify(v).slice(0, 400)}`));
      }
    });
    p.on('pageerror', (e) => consoleErrors.push(`pageerror: ${String(e).slice(0, 140)} @ ${p.url().replace(BASE, '')}`));
    p.on('response', (r) => {
      if (r.status() >= 500 && r.url().startsWith(BASE)) badResponses.push(`${r.status()} ${r.url().replace(BASE, '')}`);
      if (r.status() >= 400 && r.url().includes('uploads')) uploadNoise.add(`${r.status()} ${r.url().replace(BASE, '').slice(0, 90)}`);
    });
  }

  // ★ টাকা তোলার সেটিং — চালু, hold ০ (যাতে সদ্য জমা দিয়েই বৈধ অনুরোধ মাপা যায়); শেষে আগের মানে ফেরে
  const WKEYS = ['withdrawal_enabled', 'withdrawal_hold_hours', 'withdrawal_min'];
  const prevSettings = await db.setting.findMany({ where: { key: { in: WKEYS } } });

  const variant = await db.variant.findFirst({
    where: { isActive: true, stock: { not: 0 }, price: { lte: 1000 }, product: { isActive: true, needsUid: true } },
    orderBy: { price: 'asc' },
    include: { product: { select: { id: true, slug: true } } },
  });
  if (!variant) throw new Error('কেনার মতো কোনো ভ্যারিয়েন্ট নেই');
  const productPath = `/product/${variant.product.id}/${variant.product.slug}`;
  let userId = '';

  try {
    await db.rateLimitBucket.deleteMany({});

    /* ── ১. রেজিস্টার ── */
    console.log('\n── ১. রেজিস্টার (ফোনে) ──');
    await go(page, '/register');
    await noHScroll(page, '/register');
    // ★ প্রথমে অবৈধ: ৬০ অক্ষরের বেশি নাম — ত্রুটি ফোনে দেখা যায় ও বোতাম হাতের নাগালে থাকে
    await page.fill('#name', 'ফোন যাত্রা পরীক্ষক — অনেক লম্বা বাংলা নাম যাতে লেআউট ভাঙে কি না দেখা যায়');
    await page.fill('#email', EMAIL);
    await page.fill('#phone', `019${String(Date.now()).slice(-8)}`);
    await page.fill('#password', PASSWORD);
    const { code: regCode } = await issueOtp({ channel: 'EMAIL', purpose: 'REGISTER', destination: EMAIL, ip: '127.0.0.1' });
    await page.fill('#otp', regCode);
    await usable(page, page.locator('button[type="submit"]'), 'রেজিস্টার বোতাম');
    expectedStatus = [400];
    await page.click('button[type="submit"]');
    await page.waitForTimeout(1500);
    const regErr = page.locator('[role="alert"]:not(#__next-route-announcer__), .v-toast .v-toast__msg').filter({ hasText: /./ });
    const regErrText = (await regErr.first().innerText().catch(() => '')).trim();
    check('লম্বা নামে (৬০+) ত্রুটি দেখায়', /[ঀ-৿]/.test(regErrText), regErrText.slice(0, 60) || 'বার্তা নেই');
    await usable(page, regErr, 'রেজিস্টার-ত্রুটি');
    await noHScroll(page, '/register (ত্রুটিসহ)');
    check('অবৈধ নামে অ্যাকাউন্ট তৈরি হয়নি', !(await db.user.findUnique({ where: { email: EMAIL }, select: { id: true } })));
    expectedStatus = [];
    // ★ তারপর বৈধ: সীমার ভেতরে লম্বা বাংলা নাম (৫৫ অক্ষর)
    await page.fill('#name', 'ফোন যাত্রা পরীক্ষক — লম্বা বাংলা নাম লেআউট যাচাইয়ের জন্য');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(2500);
    const u0 = await db.user.findUnique({ where: { email: EMAIL }, select: { id: true } });
    check('অ্যাকাউন্ট তৈরি হয়েছে', Boolean(u0));
    userId = u0?.id ?? '';
    if (!userId) throw new Error('রেজিস্টার ব্যর্থ — বাকি যাত্রা অর্থহীন');

    /* ── ২. ভুল পাসওয়ার্ড → ত্রুটি; তারপর সঠিক লগইন ── */
    console.log('\n── ২. লগইন: ভুল পাসওয়ার্ড → ত্রুটি → সঠিক ──');
    const csrf0 = await (await page.request.get(`${BASE}/api/auth/csrf`)).json();
    await page.request.post(`${BASE}/api/auth/signout`, { form: { csrfToken: csrf0.csrfToken, json: 'true' } });
    await db.rateLimitBucket.deleteMany({});
    await go(page, '/login');
    await noHScroll(page, '/login');
    await page.fill('input[type="email"]', EMAIL);
    await page.fill('input[type="password"]', 'WrongPass2026x');
    expectedStatus = [401];
    await page.click('button[type="submit"]');
    await page.waitForTimeout(2500);
    check('ভুল পাসওয়ার্ডে /login-এই থাকে', new URL(page.url()).pathname === '/login');
    const loginErr = page.locator('[role="alert"]:not(#__next-route-announcer__), .v-toast .v-toast__msg').filter({ hasText: /./ });
    const errText = (await loginErr.first().innerText().catch(() => '')).trim();
    check('ত্রুটি-বার্তা দেখায় (বাংলা)', /[ঀ-৿]/.test(errText), errText.slice(0, 60) || 'বার্তা নেই');
    await usable(page, loginErr, 'লগইন-ত্রুটি');
    await usable(page, page.locator('button[type="submit"]'), 'ত্রুটির পরেও লগইন বোতাম');
    expectedStatus = [];
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 }).catch(() => {});
    await page.mouse.move(1, 1).catch(() => {});
    await settle(page);
    check('সঠিক পাসওয়ার্ডে লগইন', !new URL(page.url()).pathname.startsWith('/login'), page.url().replace(BASE, ''));

    /* ── ৩. হোমপেজ ও মোবাইল মেনু ── */
    console.log('\n── ৩. হোমপেজ ও মেনু ──');
    await go(page, '/');
    await noHScroll(page, '/');
    await usable(page, page.locator('header a[href="/"]'), 'লোগো');
    await usable(page, page.locator('button[aria-label="মেনু খুলুন"]'), 'মেনু বোতাম');
    await page.click('button[aria-label="মেনু খুলুন"]');
    await page.waitForTimeout(500);
    const menu = page.locator('[aria-label="মোবাইল মেনু"]');
    check('মেনু খোলে', await menu.isVisible().catch(() => false));
    const mb = await menu.boundingBox().catch(() => null);
    check('মেনু ভিউপোর্টের ভেতরে', !!mb && mb.x >= -1 && mb.x + mb.width <= VW + 1, mb ? `x=${Math.round(mb.x)} w=${Math.round(mb.width)}` : '');
    await usable(page, menu.locator('button, a').filter({ hasText: 'লগআউট' }), 'মেনুর লগআউট');
    await page.click('button[aria-label="মেনু বন্ধ করুন"]').catch(() => page.keyboard.press('Escape'));
    await page.waitForTimeout(400);

    /* ── ৪. প্রোডাক্ট ও অবৈধ অর্ডার-অবস্থা ── */
    console.log('\n── ৪. প্রোডাক্ট → অবৈধ অর্ডার-অবস্থা (ব্যালেন্স ০) ──');
    await go(page, productPath);
    await noHScroll(page, 'প্রোডাক্ট পাতা');
    await page.locator('[role="radio"]').filter({ hasText: variant.label }).first().click().catch(() => {});
    await page.locator('[role="radio"]').filter({ hasText: /Pay With Wallet/i }).first().click().catch(() => {});
    await page.waitForTimeout(500);
    await usable(page, page.getByText(/টাকা কম আছে/), '"টাকা কম আছে" বার্তা');
    await usable(page, page.locator('a[href="/account/wallet/deposit"]').last(), 'Add Money লিংক');
    await page.fill('#uid', '12 34$');
    await page.locator('#uid').blur();
    await page.waitForTimeout(300);
    await usable(page, page.locator('#uid-err'), 'UID-ত্রুটি');

    /* ── ৫. ডিপোজিট: অবৈধ → মাধ্যম → প্রমাণ → লম্বা TrxID → বৈধ ── */
    console.log('\n── ৫. ডিপোজিট ──');
    await go(page, '/account/wallet/deposit');
    await noHScroll(page, 'ডিপোজিট পাতা');
    const channel = page.locator('button[type="button"]').filter({ hasText: /bKash|Nagad|Rocket|বিকাশ|নগদ/i }).first();
    await usable(page, channel, 'পেমেন্ট-মাধ্যম বোতাম');
    await channel.click().catch(() => {});
    expectedStatus = [400];
    await page.click('form[aria-labelledby="d2"] button[type="submit"]');
    await page.waitForTimeout(800);
    const depErr = page.locator('form[aria-labelledby="d2"] [role="alert"]');
    check('খালি জমায় ঘরভিত্তিক ত্রুটি দেখায়', (await depErr.count()) > 0, `${await depErr.count()}টি`);
    await usable(page, depErr, 'প্রথম ডিপোজিট-ত্রুটি');
    await usable(page, page.locator('form[aria-labelledby="d2"] button[type="submit"]'), 'ত্রুটির পরেও জমা বোতাম');
    await page.fill('#amt', '5');
    await page.locator('#amt').blur();
    await page.waitForTimeout(300);
    await noHScroll(page, 'ডিপোজিট (ত্রুটিসহ)');
    expectedStatus = [];

    const longTrx = `PJ${Date.now().toString(36).toUpperCase()}`.padEnd(30, '7').slice(0, 30);
    await page.fill('#amt', String(DEPOSIT));
    await page.fill('#trx', longTrx);
    await page.locator('#trx').blur();
    await page.fill('#snd', '01711111111');
    await noHScroll(page, 'ডিপোজিট (৩০-অক্ষরের TrxID)');
    const trxBox = await page.locator('#trx').boundingBox();
    check('লম্বা TrxID ঘর ভিউপোর্টে থাকে', !!trxBox && trxBox.x + trxBox.width <= VW + 1, trxBox ? `ডান ${Math.round(trxBox.x + trxBox.width)}px` : '');
    const file = page.locator('form[aria-labelledby="d2"] input[type="file"]');
    check('প্রমাণ-ছবির ঘর আছে', (await file.count()) > 0);
    // ★ আপলোডার দুই ধাপের: ছবি বাছলে আগে প্রিভিউ, তারপর "✓ সংরক্ষণ করুন"
    await file.first().setInputFiles({ name: 'proof.png', mimeType: 'image/png', buffer: PNG }).catch(() => {});
    const save = page.locator('button', { hasText: 'সংরক্ষণ করুন' }).first();
    await save.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
    await usable(page, save, 'প্রমাণ-ছবির "সংরক্ষণ" বোতাম');
    await noHScroll(page, 'ডিপোজিট (ছবির প্রিভিউ)');
    const [up] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/upload') && r.request().method() === 'POST', { timeout: 20_000 }).catch(() => null),
      save.click().catch(() => {}),
    ]);
    check('প্রমাণ-ছবি আপলোড ২০০', up?.status() === 200, String(up?.status() ?? 'অনুরোধ হয়নি'));
    await page.waitForTimeout(800);
    await noHScroll(page, 'ডিপোজিট (প্রমাণসহ)');
    await usable(page, page.locator('form[aria-labelledby="d2"] button[type="submit"]'), 'জমা বোতাম');
    await page.click('form[aria-labelledby="d2"] button[type="submit"]');
    await page.waitForTimeout(2500);
    const dep = await db.deposit.findFirst({ where: { userId, trxId: longTrx }, select: { id: true, status: true, amount: true, screenshot: true } });
    check('ডিপোজিট PENDING, অঙ্ক ঠিক', dep?.status === 'PENDING' && Number(dep.amount) === DEPOSIT, `${dep?.status} ৳${Number(dep?.amount)}`);
    check('প্রমাণ-ছবি ডিপোজিটে যুক্ত', Boolean(dep?.screenshot));
    await noHScroll(page, 'ডিপোজিট (জমার পরে)');

    /* ── ৬. অ্যাডমিন অনুমোদন — অ্যাডমিনও ফোনে ── */
    console.log('\n── ৬. অ্যাডমিন অনুমোদন (ফোনে) ──');
    await db.rateLimitBucket.deleteMany({});
    await go(ap, '/login?callbackUrl=%2Fadmin%2Fdeposits');
    await ap.fill('input[type="email"]', ADMIN.email);
    await ap.fill('input[type="password"]', ADMIN.password);
    await ap.click('button[type="submit"]');
    await ap.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 }).catch(() => {});
    await go(ap, '/admin/deposits');
    await noHScroll(ap, '/admin/deposits');
    const card = ap.locator('article').filter({ hasText: longTrx }).first();
    check('অ্যাডমিন সারিতে ডিপোজিট (লম্বা TrxID সহ)', (await card.count()) > 0);
    const boxes = card.locator('input[type="checkbox"]');
    for (let i = 0; i < await boxes.count(); i++) await boxes.nth(i).check().catch(() => {});
    const approve = card.locator('button', { hasText: /অনুমোদন/ }).first();
    await usable(ap, approve, 'অনুমোদন বোতাম');
    await approve.click({ timeout: 10_000 }).catch(() => {});
    const confirm = ap.locator('button', { hasText: 'হ্যাঁ, অনুমোদন করুন' }).first();
    await confirm.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
    const dlg = ap.locator('[role="dialog"], [role="alertdialog"]').first();
    const db_ = await dlg.boundingBox().catch(() => null);
    check('নিশ্চিতকরণ-ডায়ালগ ভিউপোর্টে', !!db_ && db_.x >= -1 && db_.x + db_.width <= VW + 1 && db_.y >= -1 && db_.y + db_.height <= VH + 1,
      db_ ? `${Math.round(db_.width)}×${Math.round(db_.height)} @ ${Math.round(db_.x)},${Math.round(db_.y)}` : 'ডায়ালগ নেই');
    await usable(ap, confirm, '"হ্যাঁ, অনুমোদন করুন"');
    await confirm.click().catch(() => {});
    await ap.waitForTimeout(2500);
    const depAfter = await db.deposit.findUnique({ where: { id: dep?.id ?? '' }, select: { status: true } });
    check('ডিপোজিট APPROVED', depAfter?.status === 'APPROVED', String(depAfter?.status));

    /* ── ৭. বৈধ অর্ডার ── */
    console.log('\n── ৭. বৈধ অর্ডার ──');
    await go(page, productPath);
    await page.locator('[role="radio"]').filter({ hasText: variant.label }).first().click().catch(() => {});
    await page.locator('[role="radio"]').filter({ hasText: /Pay With Wallet/i }).first().click().catch(() => {});
    await page.fill('#uid', '1234567890');
    await page.locator('#uid').blur();
    await page.fill('#uid2', '1234567890');
    await page.waitForTimeout(400);
    const orderBtn = page.locator('button', { hasText: /অর্ডার করুন\s*$/ }).last();
    await usable(page, orderBtn, 'অর্ডার বোতাম');
    await orderBtn.click();
    const odlg = page.locator('[role="dialog"], [role="alertdialog"]').first();
    await odlg.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
    const ob = await odlg.boundingBox().catch(() => null);
    check('অর্ডার-নিশ্চিতকরণ ভিউপোর্টে', !!ob && ob.x >= -1 && ob.x + ob.width <= VW + 1 && ob.y + ob.height <= VH + 1,
      ob ? `${Math.round(ob.width)}×${Math.round(ob.height)}` : 'নেই');
    const yes = page.locator('button', { hasText: 'হ্যাঁ, অর্ডার করুন' }).first();
    await usable(page, yes, '"হ্যাঁ, অর্ডার করুন"');
    const [ores] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/api/order') && r.request().method() === 'POST', { timeout: 30_000 }).catch(() => null),
      yes.click(),
    ]);
    check('অর্ডার API ২০০', ores?.status() === 200, String(ores?.status()));
    await page.waitForTimeout(2000);
    const order = await db.order.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' }, select: { id: true, orderNo: true, price: true } });
    check('DB-তে অর্ডার', Boolean(order), order ? `#${order.orderNo}` : '');

    /* ── ৮. অর্ডারের অবস্থা ── */
    console.log('\n── ৮. অর্ডারের অবস্থা ──');
    await go(page, '/account/orders');
    await noHScroll(page, '/account/orders');
    await usable(page, page.getByText(`#${order?.orderNo}`), 'তালিকায় অর্ডার-নম্বর');
    await go(page, `/account/orders/${order?.id}`);
    await noHScroll(page, 'অর্ডার-বিস্তারিত');
    await usable(page, page.getByText(/অপেক্ষমাণ|প্রক্রিয়াধীন|পেন্ডিং|PENDING/).first(), 'অর্ডারের অবস্থা');

    /* ── ৯. অ্যাকাউন্ট ও লেনদেনের ইতিহাস ── */
    console.log('\n── ৯. অ্যাকাউন্ট ও লেনদেনের ইতিহাস ──');
    await go(page, '/account');
    await noHScroll(page, '/account');
    const hist = page.locator('h2', { hasText: 'লেনদেনের ইতিহাস' });
    await usable(page, hist, 'লেনদেনের ইতিহাস শিরোনাম');
    // ★ পাতা হাজারের কমা দিয়ে লেখে (৳1,500.00) — তুলনার আগে কমা বাদ
    const histText = (await hist.locator('xpath=..').innerText().catch(() => '')).replace(/,/g, '');
    check('ইতিহাসে জমা ও অর্ডার দুটোই', histText.includes(DEPOSIT.toFixed(2)) && histText.includes(Number(order?.price).toFixed(2)),
      histText.replace(/\s+/g, ' ').slice(0, 90));
    const bal = await db.user.findUnique({ where: { id: userId }, select: { balance: true } });
    const led = await db.ledgerEntry.aggregate({ where: { userId }, _sum: { amount: true } });
    check('SUM(খতিয়ান) = ব্যালেন্স', Number(led._sum.amount) === Number(bal?.balance), `৳${Number(bal?.balance)}`);

    /* ── ১০. প্রত্যাহার: অবৈধ → বৈধ ── */
    console.log('\n── ১০. টাকা তোলা ──');
    for (const [key, value] of [['withdrawal_enabled', '1'], ['withdrawal_hold_hours', '0'], ['withdrawal_min', '100']]) {
      await db.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
    }
    // ★ সেটিং-ক্যাশ — পাতা নতুন মান দেখা পর্যন্ত অপেক্ষা (এক মিনিট পর্যন্ত)
    let formShown = false;
    for (let i = 0; i < 15 && !formShown; i++) {
      await go(page, '/account/wallet/withdraw');
      formShown = (await page.locator('#wcode').count()) > 0;
      if (!formShown) await page.waitForTimeout(4000);
    }
    check('প্রত্যাহার-ফর্ম দেখা যায়', formShown);
    await noHScroll(page, '/account/wallet/withdraw');
    await page.fill('#amt', '50');
    await page.fill('#acc', '01712345678');
    await page.fill('#wcode', '000000');
    expectedStatus = [400];
    await page.click('form button[type="submit"]');
    await page.waitForTimeout(1500);
    const wErr = page.locator('[role="alert"]:not(#__next-route-announcer__), .v-toast .v-toast__msg').filter({ hasText: /./ });
    const wErrText = (await wErr.first().innerText().catch(() => '')).trim();
    check('অবৈধ প্রত্যাহারে ত্রুটি দেখায়', wErrText.length > 0, wErrText.slice(0, 70));
    await usable(page, wErr, 'প্রত্যাহার-ত্রুটি');
    await usable(page, page.locator('form button[type="submit"]'), 'ত্রুটির পরেও প্রত্যাহার বোতাম');
    check('অবৈধ অনুরোধে কিছু কাটেনি', (await db.withdrawal.count({ where: { userId } })) === 0);
    expectedStatus = [];
    const balNow = Number((await db.user.findUnique({ where: { id: userId }, select: { balance: true } }))?.balance);
    const wAmt = Math.floor(Math.min(balNow, 1000) / 100) * 100;
    await page.fill('#amt', String(wAmt));
    const { code: wCode } = await issueOtp({ channel: 'EMAIL', purpose: 'WITHDRAW', destination: EMAIL });
    await page.fill('#wcode', wCode);
    const [wres] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/account/withdraw') && r.request().method() === 'POST', { timeout: 20_000 }).catch(() => null),
      page.click('form button[type="submit"]'),
    ]);
    check('বৈধ প্রত্যাহার ২০০', wres?.status() === 200, `${wres?.status()} · ৳${wAmt}`);
    await page.waitForTimeout(1500);
    await noHScroll(page, 'প্রত্যাহার (জমার পরে)');
    const bal2 = Number((await db.user.findUnique({ where: { id: userId }, select: { balance: true } }))?.balance);
    const led2 = Number((await db.ledgerEntry.aggregate({ where: { userId }, _sum: { amount: true } }))._sum.amount);
    check('প্রত্যাহারে ব্যালেন্স ঠিক কমেছে, খতিয়ান মেলে', bal2 === balNow - wAmt && led2 === bal2, `৳${balNow} → ৳${bal2}`);

    /* ── ১১. মেনু থেকে লগআউট ── */
    console.log('\n── ১১. লগআউট ──');
    await go(page, '/account');
    await page.click('button[aria-label="মেনু খুলুন"]');
    await page.waitForTimeout(500);
    const logout = page.locator('[aria-label="মোবাইল মেনু"]').locator('button, a').filter({ hasText: 'লগআউট' }).first();
    await usable(page, logout, 'লগআউট বোতাম');
    await logout.click();
    await page.waitForURL((u) => u.pathname === '/', { timeout: 20_000 }).catch(() => {});
    // ★ লগআউটের পর হোমপেজ নিজের session-fetch শেষ করুক — নাহলে পরের `goto` সেটি বাতিল
    //   করে আর next-auth "CLIENT_FETCH_ERROR: Failed to fetch" লেখে (৩২০px-এ ৩ রানে ১ বার মাপা)
    await settle(page);
    await go(page, '/account');
    check('লগআউটের পর /account → /login', new URL(page.url()).pathname === '/login', page.url().replace(BASE, ''));

    console.log('\n── কনসোল ও নেটওয়ার্ক ──');
    check('কনসোলে অপ্রত্যাশিত ত্রুটি নেই', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | ') || '০');
    check('কোনো ৫xx নেই', badResponses.length === 0, badResponses.slice(0, 3).join(' | ') || '০');
    console.log(`  (তথ্য) ব্যাখ্যাত কনসোল-কোলাহল ${explained.length}টি${explained.length ? ':' : ''}`);
    for (const e of [...new Set(explained)].slice(0, 6)) console.log(`      · ${e}`);
    for (const u of uploadNoise) console.log(`      · আপলোড-উত্তর ${u}`);
  } finally {
    // ★ সেটিং আগের অবস্থায়
    for (const key of WKEYS) {
      const prev = prevSettings.find((s) => s.key === key);
      if (prev) await db.setting.update({ where: { key }, data: { value: prev.value } }).catch(() => {});
      else await db.setting.deleteMany({ where: { key } }).catch(() => {});
    }
    if (userId) {
      await db.withdrawal.deleteMany({ where: { userId } }).catch(() => {});
      await db.orderEvent.deleteMany({ where: { order: { userId } } }).catch(() => {});
      await db.order.deleteMany({ where: { userId } }).catch(() => {});
      await db.deposit.deleteMany({ where: { userId } }).catch(() => {});
      await db.ledgerEntry.deleteMany({ where: { userId } }).catch(() => {});
      await db.notification.deleteMany({ where: { userId } }).catch(() => {});
      await db.otp.deleteMany({ where: { destination: EMAIL } }).catch(() => {});
      await db.adminLog.deleteMany({ where: { OR: [{ adminId: userId }, { targetId: userId }] } }).catch(() => {});
      await db.user.deleteMany({ where: { id: userId } }).catch(() => {});
    }
    await db.rateLimitBucket.deleteMany({});
    await browser.close().catch(() => {});
    await db.$disconnect();
  }

  console.log(`\n════ ${total - fail}/${total} পাস${fail ? ` · ${fail} ব্যর্থ` : ''} (${VW}×${VH}) ════`);
  process.exitCode = fail ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
