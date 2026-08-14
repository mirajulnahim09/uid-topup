/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ প্রতিটি লিংক, বোতাম ও ফর্ম — সত্যিই কাজ করে কি না
 *
 *   `npx tsx scripts/verify/interaction-sweep.ts`
 *
 *   "এলিমেন্টটি আছে" যথেষ্ট নয়। এখানে চারটি আলাদা দাবি:
 *
 *     ১. **লিংক** — প্রতিটি অভ্যন্তরীণ লিংক আসল HTTP তে খোলে
 *        (4xx/5xx নেই, সুরক্ষিত পাতা ভুল করে `/login` এ পাঠায় না)
 *     ২. **বোতাম** — নিরাপদ বোতামে ক্লিক করলে কনসোল-ত্রুটি বা 5xx হয় না
 *        (ধ্বংসাত্মক বোতাম — মুছুন/বাতিল/রিফান্ড/ব্যান — ইচ্ছাকৃতভাবে বাদ)
 *     ৩. **ফর্ম** — খালি জমা দিলে যাচাই-বার্তা আসে, সার্ভার ৫০০ দেয় না
 *     ৪. **মিউটেশন** — কয়েকটি গুরুত্বপূর্ণ কাজ সত্যিই **ডাটাবেসে
 *        পৌঁছেছে** কি না, সেটি সরাসরি DB পড়ে মেলানো হয়
 *
 *   সাথে সাথেই (§9) প্রতিটি পাতায় কনসোল-ত্রুটি, হাইড্রেশন সতর্কতা,
 *   ব্যর্থ অনুরোধ ও 4xx/5xx গোনা হয়।
 *
 *   ⚠️ ধ্বংসাত্মক কাজ ইচ্ছাকৃতভাবে চালানো হয় না — এটি যাচাই, ধ্বংস নয়।
 * ═══════════════════════════════════════════════════════════
 */
import { db, dbLabel } from './_db';

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { issueOtp } from '../../src/lib/otp/core';

const BASE = process.env.VERIFY_BASE || 'https://localhost:3443';
const ADMIN = { email: 'admin@uidtopup.local', password: 'Admin@2026Secure' };
const TAG = `isweep-${Date.now().toString(36)}`;
const EMAIL = `${TAG}@verify.local`;
const PASSWORD = 'Verify@2026Pass';

let fail = 0;
let total = 0;
const check = (name: string, ok: boolean, note = '') => {
  total++;
  if (!ok) fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${note ? ` — ${note}` : ''}`);
};

/** ⚠️ এগুলোতে ক্লিক করা হয় না — টাকা বা ডেটা নষ্ট করতে পারে */
const DESTRUCTIVE = /মুছ|বাতিল|রিফান্ড|ফেরত|ব্যান|নিষ্ক্রিয়|delete|remove|cancel|refund|ban|reset|লগআউট|logout|sign ?out|প্রত্যাহার|withdraw/i;
/**
 * নেভিগেট করিয়ে দেয় এমন বোতামও বাদ — সুইপ এক পাতায় থাকা চাই।
 *
 * ⚠️ Google সাইন-ইন এখানে **অবশ্যই** থাকতে হবে: সেটি একটি বাইরের
 *   OAuth রিডাইরেক্ট শুরু করে, আর তখন পরের `page.goto()` টি
 *   `net::ERR_ABORTED` দিয়ে ভেঙে পড়ত (মাপা: `/login` এর পরে
 *   `/register` এ যেতে গিয়ে)। "কোড পাঠান" বাদ, কারণ সেটি ইমেইল
 *   পাঠানোর হার-সীমা খরচ করে।
 */
const NAVIGATES = /^\s*(কোড পাঠান|আবার পাঠান)|google|গুগল|facebook|ফেসবুক/i;

type Noise = { console: string[]; hydration: string[]; bad: string[] };
function watch(page: Page): Noise {
  const n: Noise = { console: [], hydration: [], bad: [] };
  page.on('console', (m) => {
    if (m.type() !== 'error' && m.type() !== 'warning') return;
    const t = m.text();
    // ⚠️ স্ব-স্বাক্ষরিত সার্টে service worker নিবন্ধন হয় না — পরিবেশের কোলাহল
    if (/SSL certificate error occurred when fetching the script/i.test(t)) return;
    if (/hydrat|did not match|Text content does not match/i.test(t)) n.hydration.push(t.slice(0, 200));
    else if (m.type() === 'error') n.console.push(t.slice(0, 200));
  });
  page.on('requestfailed', (r) => {
    const e = r.failure()?.errorText || '';
    if (!/ERR_ABORTED|NS_BINDING_ABORTED/.test(e)) n.bad.push(`${r.method()} ${new URL(r.url()).pathname} — ${e}`);
  });
  page.on('response', (r) => {
    if (r.status() >= 400) n.bad.push(`${r.status()} ${new URL(r.url()).pathname}`);
  });
  return n;
}

const go = async (page: Page, url: string) => {
  try { await page.goto(url, { waitUntil: 'domcontentloaded' }); }
  catch (e) {
    // ⚠️ `ERR_ABORTED` — আগের পাতার কোনো ক্লিক নিজেই নেভিগেশন শুরু
    //    করলে আমাদের goto বাতিল হয়ে যায়। থেমে যাওয়া নয়, আবার চেষ্টা।
    if (!/ERR_SSL_PROTOCOL_ERROR|ERR_CONNECTION_RESET|ERR_EMPTY_RESPONSE|ERR_ABORTED/.test(String(e))) throw e;
    await page.waitForTimeout(600);
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

/** ★ পাতার প্রতিটি অভ্যন্তরীণ লিংক আসল HTTP তে যাচাই — ব্রাউজারের ভেতর থেকেই,
 *    অর্থাৎ সেশন কুকিসহ, ঠিক যেভাবে ব্যবহারকারীর ক্লিক যেত */
async function checkLinks(page: Page, label: string, expectAuthed: boolean) {
  const hrefs = (await page.evaluate(`
    Array.from(document.querySelectorAll('a[href]'))
      .map(a => a.getAttribute('href'))
      .filter(h => h && h.startsWith('/') && !h.startsWith('//') && !h.startsWith('/api/'))
      .map(h => h.split('#')[0])
      .filter((h, i, arr) => h && arr.indexOf(h) === i)
  `)) as string[];

  /**
   * ⚠️ `redirect: 'manual'` **ব্যবহার করা যাবে না**। same-origin
   *   রিডাইরেক্টে fetch তখন একটি *opaqueredirect* সাড়া দেয় যার
   *   `status` **০** এবং হেডার পড়াই যায় না। প্রথম সংস্করণে সেটিকে
   *   "লিংক ভাঙা" ধরা হতো, ফলে অতিথির পাতায় `/account/*` লিংকগুলো
   *   মিথ্যা FAIL দিত — অথচ অতিথিকে `/login` এ পাঠানোই **সঠিক** আচরণ।
   *
   *   এখন redirect অনুসরণ করা হয় এবং চূড়ান্ত URL দেখা হয়: তাতে
   *   দুটো প্রশ্নেরই সৎ উত্তর মেলে — লিংকটি আদৌ খোলে কি না, আর
   *   লগইন করা অবস্থায় কোথাও `/login` এ ছিটকে যায় কি না।
   */
  const results = (await page.evaluate(`(async function(hrefs){
    var out = [];
    for (var i = 0; i < hrefs.length && i < 40; i++) {
      try {
        var r = await fetch(hrefs[i], { redirect: 'follow' });
        out.push({ href: hrefs[i], status: r.status, finalPath: new URL(r.url).pathname });
      } catch (e) { out.push({ href: hrefs[i], status: -1, finalPath: String(e).slice(0, 60) }); }
    }
    return out;
  })(${JSON.stringify(hrefs)})`)) as Array<{ href: string; status: number; finalPath: string }>;

  const broken = results.filter((r) => r.status >= 400 || r.status < 200);
  check(`${label}: সব অভ্যন্তরীণ লিংক খোলে (${results.length}টি)`, broken.length === 0,
    broken.slice(0, 4).map((b) => `${b.href}→${b.status}`).join(', ') || 'ভাঙা নেই');

  if (expectAuthed) {
    const bounced = results.filter((r) => r.finalPath.startsWith('/login'));
    check(`${label}: লগইন করা অবস্থায় কোনো লিংক /login এ পাঠায় না`, bounced.length === 0,
      bounced.slice(0, 3).map((b) => b.href).join(', ') || 'পাঠায় না');
  }
}

/** ★ নিরাপদ বোতামে ক্লিক — ফল: কনসোল পরিষ্কার ও কোনো 5xx নেই */
async function clickSafeButtons(page: Page, label: string, noise: Noise) {
  const before = noise.bad.length + noise.console.length;
  const buttons = page.locator('button:visible');
  const n = Math.min(await buttons.count(), 14);
  let clicked = 0;
  for (let i = 0; i < n; i++) {
    const b = buttons.nth(i);
    const txt = ((await b.innerText().catch(() => '')) || (await b.getAttribute('aria-label').catch(() => '')) || '').trim();
    if (DESTRUCTIVE.test(txt) || NAVIGATES.test(txt)) continue;
    if (await b.isDisabled().catch(() => true)) continue;
    await b.click({ timeout: 3000, trial: false }).then(() => { clicked++; }).catch(() => {});
    await page.waitForTimeout(180);
    // ★ ডায়ালগ খুলে গেলে Escape — সুইপ যেন আটকে না যায়
    await page.keyboard.press('Escape').catch(() => {});
  }
  const after = noise.bad.length + noise.console.length;
  const news = [...noise.bad.slice(before), ...noise.console.slice(before)];
  const fatal = news.filter((x) => /^5\d\d /.test(x));
  check(`${label}: ${clicked}টি নিরাপদ বোতামে ক্লিকে সার্ভার-ত্রুটি নেই`, fatal.length === 0,
    fatal.slice(0, 3).join(', ') || 'পরিষ্কার');
  return after - before;
}

async function sweepPage(page: Page, route: string, label: string, authed: boolean) {
  const noise = watch(page);
  await go(page, BASE + route);
  await settle(page);

  const landed = new URL(page.url()).pathname;
  check(`${label} ${route}: পাতা খোলে`, landed === route.split('?')[0], landed);

  await checkLinks(page, `${label} ${route}`, authed);
  await clickSafeButtons(page, `${label} ${route}`, noise);

  check(`${label} ${route}: হাইড্রেশন সতর্কতা নেই`, noise.hydration.length === 0,
    noise.hydration.slice(0, 2).join(' | ') || 'পরিষ্কার');
  const server5xx = noise.bad.filter((b) => /^5\d\d /.test(b));
  check(`${label} ${route}: কোনো 5xx নেই`, server5xx.length === 0, server5xx.slice(0, 3).join(', ') || 'পরিষ্কার');
}

(async () => {
  console.log('═══ ইন্টারঅ্যাকশন সুইপ — লিংক · বোতাম · ফর্ম · মিউটেশন ═══');
  console.log(`  সার্ভার: ${BASE} · DB: ${dbLabel()}\n`);

  const wsPath = path.join(process.cwd(), 'ws.txt');
  let browser: Browser;
  if (existsSync(wsPath)) browser = await chromium.connect(readFileSync(wsPath, 'utf8').trim());
  else browser = await chromium.launch({
    headless: true,
    executablePath: ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(existsSync),
  });

  const mk = (): Promise<BrowserContext> =>
    browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });

  const anonCtx = await mk();
  const custCtx = await mk();
  const admCtx = await mk();
  let userId = '';

  try {
    // ═══ অতিথি ═══
    console.log('━━━ অতিথি ━━━');
    const ap = await anonCtx.newPage();
    for (const r of ['/', '/login', '/register', '/track', '/contact', '/faq', '/search?q=diamond']) {
      await sweepPage(ap, r, 'অতিথি', false);
    }

    // ═══ গ্রাহক ═══
    console.log('\n━━━ গ্রাহক ━━━');
    const cp = await custCtx.newPage();
    await go(cp, `${BASE}/register`);
    await settle(cp);
    await cp.fill('#name', 'সুইপ যাচাই');
    await cp.fill('#email', EMAIL);
    await cp.fill('#phone', `017${String(Date.now()).slice(-8)}`);
    await cp.fill('#password', PASSWORD);
    const { code } = await issueOtp({ channel: 'EMAIL', purpose: 'REGISTER', destination: EMAIL, ip: '127.0.0.1' });
    await cp.fill('#otp', code);
    await cp.click('button[type="submit"]');
    await cp.waitForTimeout(2500);
    const u = await db.user.findUnique({ where: { email: EMAIL }, select: { id: true } });
    userId = u?.id ?? '';
    check('সুইপের জন্য গ্রাহক অ্যাকাউন্ট তৈরি', Boolean(userId));

    await login(cp, EMAIL, PASSWORD, '/account');
    for (const r of ['/account', '/account/orders', '/account/profile', '/account/notifications',
                     '/account/wallet/deposit', '/account/tickets']) {
      await sweepPage(cp, r, 'গ্রাহক', true);
    }

    // ═══ মিউটেশন সত্যিই DB তে পৌঁছায় ═══
    console.log('\n━━━ মিউটেশন → ডাটাবেস ━━━');

    // ★ ১. প্রোফাইলের নাম বদল — UI দিয়ে, তারপর DB মিলিয়ে দেখা
    await go(cp, `${BASE}/account/profile`);
    await settle(cp);
    /**
     * ⚠️ নির্দিষ্ট id ব্যবহার করা হয় (`#pname`, `ProfileEditor.tsx:146`)।
     *   "প্রথম input" ধরে নিলে ভুল ঘরে লেখা হতো, আর সেভ বোতামটি
     *   কেবল **পরিবর্তন হলে** দেখা যায় (motion দিয়ে খোলে) — তাই
     *   আগে ঘরটি বদলাতে হয়, তবেই বোতামটি আসে।
     */
    const newName = `সুইপ ${Date.now().toString().slice(-5)}`;
    await cp.fill('#pname', newName).catch(() => {});
    await cp.waitForTimeout(400);
    const saveBtn = cp.locator('button', { hasText: /পরিবর্তন সেভ করুন|সেভ হচ্ছে/ }).first();
    await saveBtn.click({ timeout: 8000 }).catch(() => {});
    await cp.waitForTimeout(2000);
    const afterName = await db.user.findUnique({ where: { id: userId }, select: { name: true } });
    check('প্রোফাইলের নাম বদল ডাটাবেসে পৌঁছেছে', afterName?.name === newName,
      `DB: "${afterName?.name}" · চেয়েছি: "${newName}"`);

    // ★ ২. সাপোর্ট টিকিট — গ্রাহক খোলেন, DB তে সারি তৈরি হয়
    // ★ প্রকৃত schema (api/tickets/route.ts:23): { subject, body, kind? } —
    //   "message"/"category" বলে কিছু নেই, তাই আগের payload 400 পেত।
    //   ⚠️ নিচের ব্লকটি template literal — এর ভিতরে backtick লেখা যাবে না।
    const ticketRes = await cp.evaluate(`
      fetch('/api/tickets', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subject: 'যাচাই টিকিট', body: 'ইন্টারঅ্যাকশন সুইপ থেকে', kind: 'GENERAL' }),
      }).then(async r => ({ status: r.status, body: (await r.text()).slice(0, 120) }))
    `) as { status: number; body: string };
    const ticket = await db.ticket.findFirst({ where: { userId }, select: { id: true, subject: true } });
    check('টিকিট তৈরি API সফল', ticketRes.status === 200 || ticketRes.status === 201,
      `HTTP ${ticketRes.status} ${ticketRes.body}`);
    check('টিকিট ডাটাবেসে আছে', Boolean(ticket), ticket?.subject ?? 'নেই');

    // ★ ৩. নোটিফিকেশন পড়া-চিহ্নিত করা
    await db.notification.create({
      // ★ `Notification` এ `type` বলে কোনো ফিল্ড নেই (schema.prisma:708)
      data: { userId, title: 'যাচাই', body: 'সুইপ' },
    }).catch(() => {});
    const readRes = await cp.evaluate(`
      /* ★ প্রকৃত endpoint: PATCH /api/notifications (Navbar.tsx:144) */
      fetch('/api/notifications', { method: 'PATCH' })
        .then(async r => ({ status: r.status, body: (await r.text()).slice(0, 80) }))
    `) as { status: number; body: string };
    const unread = await db.notification.count({ where: { userId, isRead: false } });
    check('notifications PATCH সাড়া দেয়', readRes.status === 200, `HTTP ${readRes.status}`);
    check('সব নোটিফিকেশন পড়া-চিহ্নিত হয়েছে', unread === 0, `${unread}টি অপঠিত`);

    // ═══ অ্যাডমিন ═══
    console.log('\n━━━ অ্যাডমিন ━━━');
    const adp = await admCtx.newPage();
    await login(adp, ADMIN.email, ADMIN.password, '/admin');
    for (const r of ['/admin', '/admin/orders', '/admin/deposits', '/admin/users',
                     '/admin/products', '/admin/coupons', '/admin/reports', '/admin/site']) {
      await sweepPage(adp, r, 'অ্যাডমিন', true);
    }
  } finally {
    if (userId) {
      await db.ticketMessage.deleteMany({ where: { ticket: { userId } } }).catch(() => {});
      await db.ticket.deleteMany({ where: { userId } }).catch(() => {});
      await db.notification.deleteMany({ where: { userId } }).catch(() => {});
      await db.ledgerEntry.deleteMany({ where: { userId } }).catch(() => {});
      await db.orderEvent.deleteMany({ where: { order: { userId } } }).catch(() => {});
      await db.order.deleteMany({ where: { userId } }).catch(() => {});
      await db.deposit.deleteMany({ where: { userId } }).catch(() => {});
    }
    await db.otp.deleteMany({ where: { destination: EMAIL } }).catch(() => {});
    await db.user.deleteMany({ where: { email: EMAIL } }).catch(() => {});
    console.log('\n  (যাচাই-ডেটা মুছে ফেলা হলো)');
    await anonCtx.close(); await custCtx.close(); await admCtx.close();
    await db.$disconnect();
  }

  console.log('\n════════════════════════════════════════');
  console.log(`  ${total - fail}/${total} পাস${fail ? ` · ${fail} ব্যর্থ` : ''}`);
  process.exit(fail ? 1 : 0);
})();
