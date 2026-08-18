/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ যাচাই — ভূমিকা-সচেতন গন্তব্য · নাগালে লগআউট · বার-ছাড়
 *
 *   `npx tsx scripts/verify/mobile-nav-logout.ts`
 *   (ঐচ্ছিক `--headed` — জানালা দেখতে চাইলে)
 *
 *   ⚠️ `next dev` :3000-এ চালু থাকতে হবে, আর ডেভ DB (`npm run
 *   dev:db:up`) — স্ক্রিপ্টটি রেট-লিমিট বাকেট মোছে ও লগইন করে।
 *
 *   ── তিনটি দাবি, তিনটি বাগের বিপরীতে ──
 *
 *   ১. **ভূমিকা-সচেতন গন্তব্য** — অ্যাডমিন লগইন করলে `/admin`-এ
 *      নামেন, গ্রাহক `/`-এ। আগে দুজনেই স্টোরফ্রন্টে নামতেন, ফলে
 *      অ্যাডমিন গ্রাহকের ন্যাভবার দেখতেন।
 *      ⚠️ এটি কেবল **গন্তব্য** — অনুমতি নয়। তাই একই সাথে মাপা হয়
 *      গ্রাহক `/admin` ও অ্যাডমিন-API দুটোতেই আটকান কি না।
 *
 *   ২. **লগআউট সত্যিই নাগালে ও কার্যকর** — অ্যাডমিন হেডারে,
 *      `/account` পাতায়, এবং ফোনের হ্যামবার্গার মেনুতে। শুধু
 *      "দেখা যাচ্ছে" নয় — `elementFromPoint()` দিয়ে দেখা হয় ট্যাপটি
 *      সত্যিই ওই বোতামে পৌঁছায়, তারপর ক্লিক করে সেশন শেষ হওয়া ও
 *      Back বোতামে প্যানেল ফিরে না আসা যাচাই হয়।
 *
 *   ৩. **বটম-বার কিছু ঢাকে না** — পাতার তলায় স্ক্রল করে পর্দার
 *      সবচেয়ে নিচের ট্যাপযোগ্য জিনিসটি বারের (ও তার উপরে ভাসা
 *      FAB-এর) উপরে আছে কি না।
 *
 *   ── হারনেসের তিনটি ফাঁদ, প্রতিটি মেপে ধরা পড়েছে ──
 *   ক) **হাইড্রেশনের আগে ফিল** — ইনপুটের DOM মান বসে, কিন্তু React
 *      state খালিই থাকে, তাই সাবমিটে `email=""`/`password=""` যায় ও
 *      সার্ভার যথাযথভাবেই ৪০১ দেয়। পড়া যেত "লগইন ভেঙেছে", অথচ
 *      প্রোডাক্ট নির্দোষ: আসল ব্যবহারকারীর ট্যাপ `#v-boot` বুট-পর্দা
 *      আটকে রাখে যতক্ষণ না `BootDismiss` মাউন্ট হয়। তাই পর্দাটি DOM
 *      থেকে সরা পর্যন্ত অপেক্ষা — সেটিই "React জীবিত"-র সংকেত।
 *   খ) **DOM-ক্রমের শেষ ≠ পর্দার সবচেয়ে নিচে** — আগে DOM-ক্রমে শেষ
 *      এলিমেন্ট নেওয়া হতো, যেটি মাপা গেছে ভিউপোর্টের ৮৫৮px উপরে।
 *      এখন সর্বোচ্চ `rect.bottom` ওয়ালাটি নেওয়া হয়, আর খোঁজা হয়
 *      **পুরো পাতায়** — কারণ তলায় স্ক্রল করলে পর্দা ফুটার দখল করে,
 *      `main`-এ খুঁজলে দাবিটি অর্থহীনভাবে সত্য হতো।
 *   গ) **বার সবসময় থাকে না** — `md:hidden`, অর্থাৎ ৭৬৮px+ প্রস্থে
 *      রেন্ডারই হয় না। লুকানো এলিমেন্টের rect সব শূন্য, তাই তুলনা
 *      করলে "সবকিছু বারের নিচে" — মিথ্যা ব্যর্থতা। উচ্চতা ০ হলে
 *      পরীক্ষাটি স্পষ্টভাবে skip হয়।
 * ═══════════════════════════════════════════════════════════
 */
/** ⚠️ `./_db` সবার আগে — নাহলে Prisma `.env` (লাইভ Neon) ধরে ফেলে */
import { BASE, db, dbLabel } from './_db';

import { chromium, type Page, type BrowserContext } from 'playwright-core';
import { existsSync } from 'node:fs';

const HEADED = process.argv.includes('--headed');

/** ডেভ ফিক্সচার — `scripts/dev-db-seed.mjs` ও `dev-make-customer.mjs` */
const ADMIN = {
  email: (process.env.ADMIN_EMAIL || 'admin@uidtopup.local').trim().replace(/^["']|["']$/g, ''),
  // ⚠️ পাসওয়ার্ড কখনো ফাইলে লেখা হয় না — env থেকেই আসে (§2.3)
  pass: (process.env.ADMIN_PASSWORD || '').trim().replace(/^["']|["']$/g, ''),
};
const CUST = { email: 'customer@uidtopup.local', pass: 'Customer@2026Secure' };

let fail = 0;
function log(name: string, ok: boolean, note = '') {
  if (!ok) fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${note ? ` — ${note}` : ''}`);
}

/**
 * ⚠️ প্রতিটি লগইনের আগে বাকেট খালি — `login:ip` ১০ মিনিটে ১০টি, আর
 *   এই স্ক্রিপ্ট এক রানে ২০+ বার লগইন করে। না মুছলে মাঝপথে সীমা
 *   ধরত এবং পড়া যেত "লগইন ভেঙেছে"। পরীক্ষার সুবিধা, অ্যাপের আচরণ নয়।
 */
async function clearLimits() {
  await db.rateLimitBucket.deleteMany({});
}

async function login(page: Page, u: { email: string; pass: string }) {
  await clearLimits();
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  // ★ হাইড্রেশন-গেট — ফাঁদ (ক), উপরে বিস্তারিত
  await page.waitForSelector('#v-boot', { state: 'detached', timeout: 45000 }).catch(() => {
    console.log('    ⚠ #v-boot এখনো আছে — হাইড্রেশন হয়নি?');
  });
  await page.fill('#email', u.email);
  await page.fill('#pw', u.pass);
  await page.click('button[type=submit]');
  await page.waitForFunction(() => !location.pathname.startsWith('/login'), null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2000);
}

const role = (p: Page) =>
  p.evaluate(async () => (await fetch('/api/auth/session').then((r) => r.json()))?.user?.role ?? null);

/** ভূমিকা-সচেতন গন্তব্য + লগআউট — প্রতিটি প্রস্থে */
async function roleFlow(ctx: BrowserContext, w: number) {
  const tag = `[${w}px]`;
  const page = await ctx.newPage();

  // ═══ অ্যাডমিন ═══
  await login(page, ADMIN);
  log(`${tag} ADMIN লগইন → /admin`, new URL(page.url()).pathname === '/admin', page.url().replace(BASE, ''));
  log(`${tag} ADMIN সেশনে role`, (await role(page)) === 'ADMIN');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  log(`${tag} ADMIN রিফ্রেশেও role ও পাতা অটুট`,
    (await role(page)) === 'ADMIN' && new URL(page.url()).pathname === '/admin');

  for (const p of ['/admin/orders', '/admin/users', '/admin/deposits', '/admin/site']) {
    await page.goto(`${BASE}${p}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);
    log(`${tag} ADMIN সরাসরি ${p}`, new URL(page.url()).pathname === p, page.url().replace(BASE, ''));
  }

  await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  const btn = page.locator('header button', { hasText: 'লগআউট' });
  const box = (await btn.isVisible().catch(() => false)) ? await btn.boundingBox() : null;
  log(`${tag} ADMIN হেডারে লগআউট দৃশ্যমান ও ভিউপোর্টে`,
    !!box && box.x >= 0 && box.x + box.width <= w + 1 && box.y >= 0,
    box ? `x=${Math.round(box.x)} w=${Math.round(box.width)} h=${Math.round(box.height)}` : 'পাওয়া যায়নি');

  const ovf = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  log(`${tag} ADMIN হেডারে অনুভূমিক ওভারফ্লো নেই`, ovf <= 0, `overflow=${ovf}px`);

  await btn.click({ timeout: 10000 }).catch((e) => log(`${tag} ADMIN লগআউট ক্লিক`, false, String(e).slice(0, 60)));
  await page.waitForFunction(() => location.pathname === '/login', null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1200);
  log(`${tag} ADMIN লগআউট → /login`, new URL(page.url()).pathname === '/login', page.url().replace(BASE, ''));
  log(`${tag} ADMIN সেশন শেষ`, (await role(page)) === null);

  await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  log(`${tag} ADMIN লগআউটের পর /admin বন্ধ`, new URL(page.url()).pathname === '/login', page.url().replace(BASE, ''));
  await page.goBack().catch(() => {});
  await page.waitForTimeout(1200);
  log(`${tag} Back বোতামে প্যানেল ফেরে না`,
    !new URL(page.url()).pathname.startsWith('/admin') || (await role(page)) === null, page.url().replace(BASE, ''));

  // ═══ গ্রাহক ═══
  /**
   * ⚠️ `clearCookies()` ইচ্ছাকৃতভাবে **নয়** — সেটি NextAuth-এর csrf
   *   কুকিটিও মোছে ও পরের `signIn` ৪০১ দেয় (পরীক্ষার আর্টিফ্যাক্ট,
   *   অ্যাপের বাগ নয়)। অ্যাডমিন উপরে লগআউট হয়েই গেছেন, আর বাস্তব
   *   ব্যবহারকারীও ঠিক এভাবেই একই ব্রাউজারে অন্য অ্যাকাউন্টে ঢোকেন।
   */
  await login(page, CUST);
  log(`${tag} CUSTOMER লগইন → /`, new URL(page.url()).pathname === '/', page.url().replace(BASE, ''));
  log(`${tag} CUSTOMER সেশনে role`, (await role(page)) === 'USER');

  await page.goto(`${BASE}/account`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  log(`${tag} CUSTOMER ড্যাশবোর্ড /account`, new URL(page.url()).pathname === '/account');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  log(`${tag} CUSTOMER রিফ্রেশেও USER`, (await role(page)) === 'USER');

  await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  log(`${tag} CUSTOMER /admin বন্ধ`, new URL(page.url()).pathname !== '/admin', page.url().replace(BASE, ''));

  // ★ UI নয়, সরাসরি API — গন্তব্য বদলালেও পাহারা অটুট কি না
  const api = await page.evaluate(async () => (await fetch('/api/admin/users', { headers: { accept: 'application/json' } })).status);
  log(`${tag} CUSTOMER অ্যাডমিন API বন্ধ`, api === 401 || api === 403 || api === 404, `status=${api}`);

  await page.goto(`${BASE}/account`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  const cbtn = page.locator('main button', { hasText: 'লগআউট' }).first();
  const cbox = (await cbtn.isVisible().catch(() => false)) ? await cbtn.boundingBox() : null;
  log(`${tag} CUSTOMER /account-এ লগআউট`, !!cbox && cbox.x + cbox.width <= w + 1,
    cbox ? `x=${Math.round(cbox.x)} w=${Math.round(cbox.width)}` : 'পাওয়া যায়নি');
  await cbtn.click({ timeout: 10000 }).catch((e) => log(`${tag} CUSTOMER লগআউট ক্লিক`, false, String(e).slice(0, 60)));
  await page.waitForFunction(() => location.pathname === '/login', null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1200);
  log(`${tag} CUSTOMER লগআউট → /login`, new URL(page.url()).pathname === '/login', page.url().replace(BASE, ''));
  log(`${tag} CUSTOMER সেশন শেষ`, (await role(page)) === null);
  await page.goto(`${BASE}/account`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  log(`${tag} লগআউটের পর /account বন্ধ`, new URL(page.url()).pathname === '/login', page.url().replace(BASE, ''));

  await page.close();
}

/** ফোন: বটম-বার কিছু ঢাকছে কি না + মেনুর শেষ আইটেম নাগালে কি না */
async function mobileFlow(ctx: BrowserContext, w: number, h: number) {
  const tag = `[${w}x${h}]`;
  const page = await ctx.newPage();
  await login(page, CUST);

  for (const p of ['/account', '/account/profile', '/account/orders', '/account/tickets', '/contact', '/']) {
    await page.goto(`${BASE}${p}`, { waitUntil: 'networkidle' }).catch(() => {});
    await page.waitForTimeout(700);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(700);

    const r = await page.evaluate(() => {
      const bar = document.querySelector('nav[aria-label="মোবাইল নেভিগেশন"]') as HTMLElement | null;
      const barRect = bar?.getBoundingClientRect();
      // ফাঁদ (গ) — বার রেন্ডার না হলে তুলনার কিছু নেই
      if (!bar || !barRect || barRect.height === 0) return { skip: true, why: 'বার রেন্ডার হয়নি (md+)' } as const;
      const fabRect = (bar.querySelector('span.v-sheen') as HTMLElement | null)?.getBoundingClientRect();
      // ★ FAB বারের **উপরে** ভাসে, তাই ঢাকার সীমা দুটির মধ্যে ছোটটি
      const occl = Math.min(barRect.top, fabRect && fabRect.height > 0 ? fabRect.top : Infinity);

      // ফাঁদ (খ) — পুরো পাতা, আর DOM-ক্রম নয় বরং সর্বোচ্চ bottom
      const els = Array.from(document.querySelectorAll('a, button, input, select, [role=button]'))
        .map((e) => e as HTMLElement)
        .filter((el) => !el.closest('nav[aria-label="মোবাইল নেভিগেশন"], header'))
        .filter((el) => { const b = el.getBoundingClientRect(); return el.offsetParent !== null && b.width > 0 && b.height > 0; });
      if (!els.length) return { skip: true, why: 'কোনো ট্যাপযোগ্য এলিমেন্ট নেই' } as const;

      const low = els.reduce((a, b) => (a.getBoundingClientRect().bottom >= b.getBoundingClientRect().bottom ? a : b));
      const b = low.getBoundingClientRect();
      const cx = b.left + b.width / 2;
      const cy = b.top + b.height / 2;
      const inViewport = cy >= 0 && cy <= innerHeight && cx >= 0 && cx <= innerWidth;
      const top = inViewport ? document.elementFromPoint(cx, cy) : null;

      return {
        skip: false as const,
        text: (low.textContent || '').trim().slice(0, 24),
        clearance: Math.round(occl - b.bottom),
        inViewport,
        reached: !!top && (low.contains(top) || top.contains(low)),
        got: top ? `${top.tagName}.${String(top.className || '').slice(0, 24)}` : 'null',
      };
    });

    if (r.skip) { log(`${tag} ${p} সবচেয়ে নিচের এলিমেন্ট`, true, `skip — ${r.why}`); continue; }
    log(`${tag} ${p} সবচেয়ে নিচের এলিমেন্ট বারের উপরে`, r.clearance >= 0, `"${r.text}" ছাড়=${r.clearance}px`);
    log(`${tag} ${p} সেটিতে ট্যাপ পৌঁছায়`, r.inViewport && r.reached, `${r.got}`);
  }

  // ═══ হ্যামবার্গার মেনু — শেষ আইটেম (লগআউট) নাগালে? ═══
  await page.goto(`${BASE}/account`, { waitUntil: 'networkidle' });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.click('button[aria-label="মেনু খুলুন"]');
  await page.waitForTimeout(800);

  const m = await page.evaluate(() => {
    const n = document.querySelector('nav[aria-label="মোবাইল মেনু"]') as HTMLElement;
    const bar = document.querySelector('nav[aria-label="মোবাইল নেভিগেশন"]') as HTMLElement | null;
    const barRect = bar?.getBoundingClientRect();
    const hasBar = !!bar && !!barRect && barRect.height > 0;
    const fabRect = (bar?.querySelector('span.v-sheen') as HTMLElement | null)?.getBoundingClientRect();
    const occl = hasBar
      ? Math.min(barRect!.top, fabRect && fabRect.height > 0 ? fabRect.top : Infinity)
      : innerHeight;
    const r = n.getBoundingClientRect();
    n.scrollTop = n.scrollHeight; // মেনুর তলায় নামি
    return { hasBar, menuBottom: Math.round(r.bottom), occl: Math.round(occl), scrollable: n.scrollHeight > n.clientHeight };
  });
  log(`${tag} মেনু বারের উপরেই শেষ`, m.menuBottom <= m.occl,
    `menuBottom=${m.menuBottom} occl=${m.occl}${m.hasBar ? '' : ' (বার নেই — ভিউপোর্টের তলা)'}`);
  log(`${tag} মেনু নিজেই স্ক্রলযোগ্য`, m.scrollable);

  await page.waitForTimeout(400);
  const reach = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('nav[aria-label="মোবাইল মেনু"] button'))
      .find((e) => (e.textContent || '').includes('লগআউট')) as HTMLElement | undefined;
    if (!b) return { ok: false, why: 'পাওয়া যায়নি', y: -1 };
    const r = b.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { ok: !!top && (b.contains(top) || top === b), why: top?.tagName ?? 'null', y: Math.round(r.top) };
  });
  log(`${tag} মেনুর লগআউট নাগালে ও ট্যাপযোগ্য`, reach.ok, `${reach.why} y=${reach.y}`);

  // ★ শুধু "দেখা যাচ্ছে" নয় — সত্যিকারের ক্লিক ও তার ফল
  await page.locator('nav[aria-label="মোবাইল মেনু"] button', { hasText: 'লগআউট' })
    .click({ timeout: 8000 })
    .catch((e) => log(`${tag} মেনুর লগআউট ক্লিক`, false, String(e).slice(0, 60)));
  await page.waitForFunction(() => location.pathname === '/' || location.pathname === '/login', null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1200);
  log(`${tag} মেনুর লগআউট সত্যিই সেশন শেষ করে`, (await role(page)) === null, `path=${new URL(page.url()).pathname}`);

  await page.close();
}

(async () => {
  console.log('═══ মোবাইল ন্যাভ · ভূমিকা-গন্তব্য · লগআউট যাচাই ═══\n');
  console.log(`  DB: ${dbLabel()} · সার্ভার: ${BASE}\n`);

  if (!ADMIN.pass) {
    console.error('✗ ADMIN_PASSWORD env-এ নেই — অ্যাডমিন প্রবাহ চালানো যাবে না।');
    process.exit(1);
  }

  /**
   * ⚠️ **নিজের** ব্রাউজার, `ws.txt` এর শেয়ার্ডটি নয় — polling-load.ts
   *   এর সাথে একই কারণ: দীর্ঘ শেয়ার্ড CDP সংযোগ Windows-এ প্রস্থানের
   *   সময় libuv assertion দিয়ে exit code নষ্ট করে, ফলে পাস করেও
   *   ব্যর্থ দেখাত।
   */
  const exe = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ].find(existsSync);
  const browser = await chromium.launch({ headless: !HEADED, ...(exe ? { executablePath: exe } : {}) });

  for (const [w, h] of [[320, 844], [390, 844], [430, 932], [768, 1024], [1024, 800], [1366, 900]] as const) {
    console.log(`\n── ভিউপোর্ট ${w}x${h} ──`);
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    await roleFlow(ctx, w);
    if (w <= 430) await mobileFlow(ctx, w, h);
    await ctx.close();
  }

  // ★ Android ও ল্যান্ডস্কেপ — টাচ-ইমুলেশনসহ, কারণ বার ও FAB সেখানেই
  for (const [w, h, name] of [[412, 915, 'android-pixel'], [844, 390, 'landscape']] as const) {
    console.log(`\n── ${name} ${w}x${h} ──`);
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2.6 });
    await mobileFlow(ctx, w, h);
    await ctx.close();
  }

  await browser.close();
  await db.$disconnect();
  console.log(`\n${fail ? `✗ ${fail}টি ব্যর্থ` : '✓ সব দাবি পাস'}`);
  process.exit(fail ? 1 : 0);
})();
