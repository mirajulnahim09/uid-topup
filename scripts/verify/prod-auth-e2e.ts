/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ প্রোডাকশন বিল্ডে auth — শুরু থেকে শেষ, ব্রাউজারে
 *
 *   `npx tsx scripts/verify/prod-auth-e2e.ts`
 *
 *   ── কেন এটি `next dev` এ চালালে চলবে না ──
 *   প্রোডাকশনে কুকির নাম `__Secure-next-auth.session-token` ও তাতে
 *   `Secure` থাকে; ব্রাউজার সেটি **শুধু https** এ রাখে। তাই যাচাই
 *   চলে `scripts/prod-https.mjs` এর TLS স্তরের পিছনে থাকা প্রকৃত
 *   `next start` বিল্ডের বিরুদ্ধে। (এই পার্থক্যটিই একবার একটি আসল
 *   প্রোডাকশন বাগকে "লোকাল artifact" বলে আড়াল করেছিল।)
 *
 *   যা মাপা হয় — প্রতিটি মোবাইল **ও** ডেস্কটপ, দুই থিমে নয় (থিম
 *   আলাদা স্ক্রিপ্টে), কিন্তু প্রতিটি ধাপে কনসোল-ত্রুটি ও ব্যর্থ
 *   নেটওয়ার্ক অনুরোধ গোনা হয়:
 *     ১. নতুন গ্রাহক রেজিস্ট্রেশন (আসল OTP পথ)
 *     ২. লগইন
 *     ৩. সেশন কুকি — নাম, Secure, httpOnly, sameSite
 *     ৪. ড্যাশবোর্ড খোলে
 *     ৫. রিফ্রেশ করেও লগইন থাকে
 *     ৬. সুরক্ষিত রুটে **সরাসরি** নেভিগেশন
 *     ৭. লগআউট — কুকি মুছে যায়, সুরক্ষিত রুট আর খোলে না
 *     ৮. পুনঃলগইন
 *     ৯. অ্যাডমিন লগইন + অ্যাডমিন ড্যাশবোর্ড
 *    ১০. সাধারণ ইউজার `/admin` এ ঢুকতে পারে না
 *
 *   ⚠️ টেস্ট অ্যাকাউন্ট শেষে **মুছে ফেলা হয়**। DB অবশ্যই স্থানীয়
 *      (`_db.ts` এর গার্ড), তাই লাইভ গ্রাহকের ডেটা কখনো ছোঁয়া হয় না।
 * ═══════════════════════════════════════════════════════════
 */
import { db, dbLabel } from './_db';

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { issueOtp } from '../../src/lib/otp/core';

const BASE = process.env.VERIFY_BASE || 'https://localhost:3443';
const ADMIN = { email: 'admin@uidtopup.local', password: 'Admin@2026Secure' };
const TAG = `pe2e-${Date.now().toString(36)}`;

let fail = 0;
let total = 0;
const check = (name: string, ok: boolean, note = '') => {
  total++;
  if (!ok) fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${note ? ` — ${note}` : ''}`);
};

/** পাতা-ভিত্তিক কনসোল ত্রুটি ও ব্যর্থ অনুরোধ — §9 এর দাবি */
type Noise = { console: string[]; bad: string[] };
function watch(page: Page): Noise {
  const n: Noise = { console: [], bad: [] };
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    /**
     * ⚠️ **একমাত্র উপেক্ষিত ত্রুটি**: service worker রেজিস্ট্রেশন।
     *   Chrome স্ব-স্বাক্ষরিত সার্টিফিকেটে SW নিবন্ধন করতে অস্বীকার করে
     *   (`ignoreHTTPSErrors` নেভিগেশনে কাজ করে, SW-এ নয়) — বার্তাটি
     *   হুবহু "An SSL certificate error occurred when fetching the script."।
     *   `PWA.tsx:83` এই নিবন্ধনটি `.catch(() => {})` দিয়ে ঘিরে রেখেছে,
     *   অর্থাৎ ব্যর্থ হলেও অ্যাপ স্বাভাবিক চলে। আসল ডোমেইনে বৈধ
     *   সার্টিফিকেট থাকায় সেখানে এটি ঘটে না — তাই এটি **যাচাই-পরিবেশের**
     *   কোলাহল, প্রোডাক্টের ত্রুটি নয়।
     */
    if (/SSL certificate error occurred when fetching the script/i.test(t)) return;
    n.console.push(t.slice(0, 200));
  });
  page.on('requestfailed', (r) => {
    // ⚠️ ব্রাউজার নিজেই বাতিল করা অনুরোধ (নেভিগেশনের সময়) গোনা হয় না
    const e = r.failure()?.errorText || '';
    if (!/ERR_ABORTED|NS_BINDING_ABORTED/.test(e)) n.bad.push(`${r.method()} ${r.url().slice(0, 120)} — ${e}`);
  });
  page.on('response', (r) => {
    if (r.status() >= 400) {
      const u = new URL(r.url());
      // ★ প্রত্যাশিত 4xx — যাচাইয়েরই অংশ (লগআউটের পর গার্ড ইত্যাদি)
      if (/\/api\/auth\/(session|providers|csrf)/.test(u.pathname)) return;
      n.bad.push(`${r.status()} ${u.pathname}`);
    }
  });
  return n;
}

/**
 * ★ নেভিগেশনে একবার পুনঃচেষ্টা।
 *
 *   ⚠️ স্ব-স্বাক্ষরিত TLS প্রক্সির সাথে Chrome মাঝেমধ্যে বন্ধ হয়ে যাওয়া
 *   keep-alive সংযোগ পুনর্ব্যবহার করতে গিয়ে `ERR_SSL_PROTOCOL_ERROR`
 *   দেয়। প্রক্সিতে টাইমআউট বাড়ানো হয়েছে, তবু রেসটি সম্পূর্ণ বাদ দিতে
 *   এখানে একটি নিরীহ পুনঃচেষ্টা — এটি **যাচাইয়ের সরঞ্জামের** দুর্বলতা,
 *   অ্যাপের নয়, তাই ঢেকে দেওয়া বৈধ।
 */
const go = async (page: Page, url: string) => {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
  } catch (e) {
    if (!/ERR_SSL_PROTOCOL_ERROR|ERR_CONNECTION_RESET|ERR_EMPTY_RESPONSE/.test(String(e))) throw e;
    await page.waitForTimeout(400);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
  }
};

const settle = async (page: Page) => {
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page
    .waitForFunction(
      `!document.querySelector('.v-ovl') && !document.getElementById('v-boot')`,
      null,
      { timeout: 30_000 },
    )
    .catch(() => {});
  await page.waitForTimeout(250);
};

async function cookieNames(ctx: BrowserContext) {
  return (await ctx.cookies()).map((c) => ({
    name: c.name, secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite,
  }));
}

/**
 * ⚠️ প্রতিটি লগইনের আগে বাকেট খালি।
 *
 *   অ্যাপের ব্রুট-ফোর্স গার্ড এক IP থেকে ১০ মিনিটে ১০টি চেষ্টা মানে।
 *   এই স্ক্রিপ্ট একটানা ৬–৮টি লগইন করে, আর একই মেশিনে অডিটও চলে —
 *   ফলে অ্যাডমিন লগইন `401` পেত এবং রিপোর্টে "অ্যাডমিন লগইন ভাঙা"
 *   দেখাত (২০২৬-০৮-১৪ তে মাপা: `login:ip:unknown = 12`)। এটি
 *   **হারনেসের সীমা**, অ্যাপের ত্রুটি নয় — সীমার নিজস্ব যাচাই
 *   `ratelimit-failclosed` ও `ip-spoofing` এ আলাদা করে হয়।
 */
async function clearRateLimits() {
  await db.$executeRawUnsafe('DELETE FROM "RateLimitBucket"').catch(() => {});
}

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

async function runPersona(browser: Browser, label: string, mobile: boolean) {
  console.log(`\n━━━ ${label} ━━━`);
  const ctx = await browser.newContext({
    // ⚠️ স্ব-স্বাক্ষরিত localhost সার্ট — এটি ছাড়া প্রতিটি নেভিগেশন ব্যর্থ
    ignoreHTTPSErrors: true,
    viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    isMobile: mobile,
    hasTouch: mobile,
    deviceScaleFactor: mobile ? 3 : 1,
    ...(mobile
      ? { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' }
      : {}),
  });
  const page = await ctx.newPage();
  const noise = watch(page);

  const email = `${TAG}-${mobile ? 'm' : 'd'}@verify.local`;
  const password = 'Verify@2026Pass';
  const phone = `019${String(Date.now()).slice(-8)}`;

  // ── ১. রেজিস্ট্রেশন (আসল OTP পথে) ──
  await go(page, `${BASE}/register`);
  await settle(page);
  await page.fill('#name', 'যাচাই গ্রাহক');
  await page.fill('#email', email);
  await page.fill('#phone', phone);
  await page.fill('#password', password);

  /**
   * ★ কোডটি **আসল ইস্যু-পথ** দিয়েই বানানো হয় (`issueOtp`), হাতে
   *   হ্যাশ বসানো হয় না — তাই যাচাইয়ের যুক্তিটিও পরীক্ষা হয়ে যায়।
   *   ইমেইল পাঠানো এই সার্ভারে বন্ধ (RESEND_API_KEY খালি), তাই কোড
   *   ডেভ DB থেকে নেওয়া ছাড়া উপায় নেই — টেস্ট-স্যুটও একই কাজ করে।
   */
  const { code } = await issueOtp({ channel: 'EMAIL', purpose: 'REGISTER', destination: email, ip: '127.0.0.1' });
  await page.fill('#otp', code);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2500);
  await settle(page);

  const created = await db.user.findUnique({
    where: { email }, select: { id: true, emailVerified: true, role: true },
  });
  check(`${label}: রেজিস্ট্রেশনে অ্যাকাউন্ট তৈরি হয়`, Boolean(created), created ? `id=${created.id.slice(0, 8)}…` : 'তৈরি হয়নি');
  check(`${label}: emailVerified = true (OTP পথ)`, created?.emailVerified === true);
  check(`${label}: ভূমিকা USER`, created?.role === 'USER', String(created?.role));

  // ── ২+৩. লগইন ও সেশন কুকি ──
  const landed = await login(page, email, password, '/account');
  check(`${label}: লগইনের পর /account এ পৌঁছায়`, landed.startsWith('/account'), landed);

  const cookies = await cookieNames(ctx);
  const sess = cookies.find((c) => c.name.endsWith('next-auth.session-token'));
  check(`${label}: সেশন কুকির নাম প্রোডাকশন-রূপে`, sess?.name === '__Secure-next-auth.session-token', sess?.name ?? 'কুকি নেই');
  check(`${label}: সেশন কুকি Secure + httpOnly`, Boolean(sess?.secure && sess?.httpOnly),
    `secure=${sess?.secure} httpOnly=${sess?.httpOnly}`);
  const csrf = cookies.find((c) => c.name.endsWith('next-auth.csrf-token'));
  check(`${label}: csrf কুকি __Host- prefix`, csrf?.name === '__Host-next-auth.csrf-token', csrf?.name ?? 'নেই');

  const session = await page.evaluate(`fetch('/api/auth/session').then(r=>r.json()).catch(()=>null)`) as
    { user?: { email?: string; role?: string } } | null;
  check(`${label}: /api/auth/session সঠিক ইউজার দেয়`, session?.user?.email === email, session?.user?.email ?? 'খালি');

  // ── ৪. ড্যাশবোর্ড ──
  const dashHasBalance = await page.evaluate(`!!document.body.innerText.match(/ব্যালেন্স|Balance/)`);
  check(`${label}: ড্যাশবোর্ডে ব্যালেন্স দেখা যায়`, Boolean(dashHasBalance));

  // ── ৫. রিফ্রেশ করেও লগইন থাকে ──
  await page.reload({ waitUntil: 'domcontentloaded' });
  await settle(page);
  check(`${label}: রিফ্রেশের পরেও লগইন থাকে`, new URL(page.url()).pathname.startsWith('/account'), new URL(page.url()).pathname);

  // ── ৬. সুরক্ষিত রুটে সরাসরি নেভিগেশন ──
  for (const r of ['/account/orders', '/account/wallet/deposit', '/account/profile']) {
    await go(page, BASE + r);
    await settle(page);
    check(`${label}: সরাসরি ${r} খোলে`, new URL(page.url()).pathname === r, new URL(page.url()).pathname);
  }

  // ── ১০. সাধারণ ইউজার /admin এ ঢুকতে পারে না ──
  await go(page, `${BASE}/admin`);
  await settle(page);
  check(`${label}: সাধারণ ইউজার /admin এ ঢুকতে পারে না`, new URL(page.url()).pathname !== '/admin', new URL(page.url()).pathname);

  // ── ৭. লগআউট ──
  await go(page, `${BASE}/account`);
  await settle(page);
  /**
   * ⚠️ লগআউট বোতামটি **দুই জায়গায় দুই রকম**: বড় পর্দায় ন্যাভবারে
   *   সরাসরি, ছোট পর্দায় হ্যামবার্গার-ড্রয়ারের ভেতরে
   *   (`Navbar.tsx`, `aria-label="মোবাইল মেনু"`)। ড্রয়ার না খুলে
   *   ক্লিক করতে গেলে টাইমআউট হয় আর মনে হয় লগআউট ভাঙা — প্রথম
   *   সংস্করণে ঠিক সেই মিথ্যা FAIL এসেছিল।
   */
  const logoutBtn = () => page.locator('button:visible', { hasText: /^\s*(লগআউট|Logout|Sign out)\s*$/i }).first();
  if ((await logoutBtn().count()) === 0) {
    const burger = page.locator('button[aria-label="মেনু খুলুন"]').first();
    if (await burger.count()) {
      await burger.click().catch(() => {});
      await page.waitForTimeout(600);
    }
  }
  const clicked = await logoutBtn().click({ timeout: 8000 }).then(() => true).catch(() => false);
  check(`${label}: লগআউট বোতাম পাওয়া ও ক্লিক করা গেছে`, clicked);
  await page.waitForTimeout(2500);
  await settle(page);

  const afterCookies = await cookieNames(ctx);
  const stillThere = afterCookies.find((c) => c.name.endsWith('next-auth.session-token'));
  check(`${label}: লগআউটে সেশন কুকি মুছে যায়`, !stillThere, stillThere ? 'কুকি রয়ে গেছে' : 'মুছেছে');

  await go(page, `${BASE}/account`);
  await settle(page);
  check(`${label}: লগআউটের পর /account আর খোলে না`, new URL(page.url()).pathname.startsWith('/login'), new URL(page.url()).pathname);

  // ── ৮. পুনঃলগইন ──
  const again = await login(page, email, password, '/account');
  check(`${label}: পুনঃলগইন কাজ করে`, again.startsWith('/account'), again);

  // ── কোলাহল ──
  check(`${label}: কনসোলে ত্রুটি নেই`, noise.console.length === 0,
    noise.console.slice(0, 3).join(' | ') || 'পরিষ্কার');
  check(`${label}: ব্যর্থ/4xx-5xx অনুরোধ নেই`, noise.bad.length === 0,
    noise.bad.slice(0, 3).join(' | ') || 'পরিষ্কার');

  await ctx.close();
}

async function runAdmin(browser: Browser, label: string, mobile: boolean) {
  console.log(`\n━━━ ${label} ━━━`);
  const ctx = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 3 : 1,
  });
  const page = await ctx.newPage();
  const noise = watch(page);

  const landed = await login(page, ADMIN.email, ADMIN.password, '/admin');
  check(`${label}: অ্যাডমিন লগইনে /admin এ পৌঁছায়`, landed.startsWith('/admin'), landed);

  const session = await page.evaluate(`fetch('/api/auth/session').then(r=>r.json()).catch(()=>null)`) as
    { user?: { role?: string } } | null;
  check(`${label}: সেশনের ভূমিকা ADMIN`, session?.user?.role === 'ADMIN', String(session?.user?.role));

  const cookies = await cookieNames(ctx);
  check(`${label}: অ্যাডমিন সেশন কুকিও __Secure-`,
    Boolean(cookies.find((c) => c.name === '__Secure-next-auth.session-token')));

  for (const r of ['/admin/orders', '/admin/deposits', '/admin/users']) {
    await go(page, BASE + r);
    await settle(page);
    check(`${label}: ${r} খোলে`, new URL(page.url()).pathname === r, new URL(page.url()).pathname);
  }

  await page.reload({ waitUntil: 'domcontentloaded' });
  await settle(page);
  check(`${label}: রিফ্রেশের পরেও অ্যাডমিন সেশন টিকে থাকে`,
    new URL(page.url()).pathname.startsWith('/admin'), new URL(page.url()).pathname);

  check(`${label}: কনসোলে ত্রুটি নেই`, noise.console.length === 0, noise.console.slice(0, 3).join(' | ') || 'পরিষ্কার');
  check(`${label}: ব্যর্থ/4xx-5xx অনুরোধ নেই`, noise.bad.length === 0, noise.bad.slice(0, 3).join(' | ') || 'পরিষ্কার');

  await ctx.close();
}

(async () => {
  console.log('═══ প্রোডাকশন বিল্ডে auth — end-to-end ═══');
  console.log(`  সার্ভার: ${BASE} · DB: ${dbLabel()}\n`);

  // ★ চলমান headed ব্রাউজার থাকলে সেটিই ব্যবহার — সেশনের রীতি
  const wsPath = path.join(process.cwd(), 'ws.txt');
  let browser: Browser;
  if (existsSync(wsPath)) {
    browser = await chromium.connect(readFileSync(wsPath, 'utf8').trim());
  } else {
    const CHROME = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(existsSync);
    browser = await chromium.launch({ headless: true, executablePath: CHROME });
  }

  try {
    await runPersona(browser, 'গ্রাহক · মোবাইল', true);
    await runPersona(browser, 'গ্রাহক · ডেস্কটপ', false);
    await runAdmin(browser, 'অ্যাডমিন · মোবাইল', true);
    await runAdmin(browser, 'অ্যাডমিন · ডেস্কটপ', false);
  } finally {
    // ★ যাচাই-অ্যাকাউন্ট ও তার সব সন্তান-সারি মুছে ফেলা
    const users = await db.user.findMany({ where: { email: { startsWith: TAG } }, select: { id: true } });
    for (const u of users) {
      await db.ledgerEntry.deleteMany({ where: { userId: u.id } });
      await db.orderEvent.deleteMany({ where: { order: { userId: u.id } } });
      await db.order.deleteMany({ where: { userId: u.id } });
      await db.notification.deleteMany({ where: { userId: u.id } }).catch(() => {});
    }
    await db.otp.deleteMany({ where: { destination: { startsWith: TAG } } }).catch(() => {});
    await db.user.deleteMany({ where: { email: { startsWith: TAG } } });
    console.log('\n  (যাচাই-অ্যাকাউন্ট মুছে ফেলা হলো)');
    await db.$disconnect();
  }

  console.log('\n════════════════════════════════════════');
  console.log(`  ${total - fail}/${total} পাস${fail ? ` · ${fail} ব্যর্থ` : ''}`);
  process.exit(fail ? 1 : 0);
})();
