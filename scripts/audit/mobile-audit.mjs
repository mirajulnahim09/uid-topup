/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ মোবাইল + অথ ইন্টিগ্রেশন অডিট (২০২৬-০৮-১৪)
 *
 *   একটি স্ক্রিপ্টে তিনটি প্রশ্নের উত্তর:
 *
 *   ১. **লগইনের পর ড্যাশবোর্ড সত্যিই খোলে?** কেবল "লগইন সফল"
 *      টোস্ট নয় — চূড়ান্ত URL, সেশন কুকি ও `/api/auth/session`
 *      তিনটিই মিলিয়ে দেখা হয়।
 *   ২. **কোনো ভিউপোর্টে অনুভূমিক ওভারফ্লো বা উল্লম্ব ক্লিপিং আছে?**
 *      থাকলে ঠিক কোন এলিমেন্ট — selector ও মাপ সহ।
 *   ৩. **fixed এলিমেন্ট (বটম-ন্যাভ/FAB) কি ইন্টারঅ্যাকটিভ কিছু
 *      ঢেকে দিচ্ছে?**
 *
 *   ⚠️ **রেট-লিমিট।** অ্যাপের নিজের ব্রুট-ফোর্স গার্ড এক IP থেকে
 *   ১০ মিনিটে ১০টি লগইন চেষ্টা মানে। প্রথম সংস্করণে প্রতি
 *   ভিউপোর্টে নতুন করে লগইন করা হতো — ১১তম চেষ্টা থেকে সব
 *   ব্যর্থ, আর রিপোর্টে সেটি "ড্যাশবোর্ড খোলে না" হয়ে দেখাত।
 *   অর্থাৎ **হারনেসের দোষ, অ্যাপের নয়**। এখন দুইভাবে ঠেকানো:
 *     · লগইনের আগে ডেভ DB-র `RateLimitBucket` খালি করা হয়
 *     · প্রতি পার্সোনায় **একবারই** লগইন, তারপর
 *       `setViewportSize()` দিয়ে ভিউপোর্ট বদলানো হয়
 *
 *   চালানো:  node scripts/audit/mobile-audit.mjs
 *   ফলাফল :  audit/mobile-audit.json + কনসোলে সারাংশ
 * ═══════════════════════════════════════════════════════════
 */
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

const BASE = process.env.AUDIT_BASE || 'http://localhost:3000';
/** ⚠️ স্পষ্ট ডেভ URL — `.env` (লাইভ Neon) ভুল করেও ছোঁয়া যাবে না */
const DEV_URL = 'postgresql://dev:dev@localhost:5434/uidtopup_dev';
const db = new PrismaClient({ datasources: { db: { url: DEV_URL } } });

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
].find(existsSync);
if (!CHROME) throw new Error('Chrome পাওয়া যায়নি');

const CUSTOMER = { email: 'customer@uidtopup.local', password: 'Customer@2026Secure' };
const ADMIN = { email: 'admin@uidtopup.local', password: 'Admin@2026Secure' };

const MOBILE_VPS = [
  { name: '320x568', width: 320, height: 568 },
  { name: '360x800', width: 360, height: 800 },
  { name: '375x812', width: 375, height: 812 },
  { name: '390x844', width: 390, height: 844 },
  { name: '412x915', width: 412, height: 915 },
  { name: '430x932', width: 430, height: 932 },
  { name: '480x900', width: 480, height: 900 },
];
const DESKTOP_VPS = [
  { name: '768x1024', width: 768, height: 1024 },
  { name: '1024x768', width: 1024, height: 768 },
  { name: '1280x800', width: 1280, height: 800 },
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '2560x1440', width: 2560, height: 1440 },
];

const PUBLIC_ROUTES = [
  '/', '/login', '/register', '/forgot-password', '/search?q=diamond',
  '/track', '/contact', '/faq', '/terms', '/privacy', '/refund',
];
const CUSTOMER_ROUTES = [
  '/account', '/account/orders', '/account/profile', '/account/notifications',
  '/account/wallet/deposit', '/account/wallet/withdraw', '/account/tickets',
  '/account/smm-orders',
];
const ADMIN_ROUTES = [
  '/admin', '/admin/orders', '/admin/deposits', '/admin/users', '/admin/products',
  '/admin/coupons', '/admin/banners', '/admin/tickets', '/admin/withdrawals',
  '/admin/reports', '/admin/site', '/admin/telegram', '/admin/media',
  '/admin/integrations', '/admin/payments', '/admin/otp', '/admin/logs',
  '/admin/branding', '/admin/homepage', '/admin/tools',
];

/* ── পাতার ভেতরে চালানো পরিমাপক (বিশুদ্ধ DOM) ── */
const MEASURE = `(function () {
  var vw = document.documentElement.clientWidth;
  var res = { vw: vw, scrollWidth: document.documentElement.scrollWidth,
              overflow: [], covered: [], clipped: [] };

  function sel(el) {
    if (el.id) return el.tagName.toLowerCase() + '#' + el.id;
    var c = (el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className) || '';
    c = String(c).trim().split(/\\s+/).slice(0, 3).join('.');
    return el.tagName.toLowerCase() + (c ? '.' + c : '');
  }

  var all = document.querySelectorAll('body *');

  // ── ১. অনুভূমিক ওভারফ্লো (সবচেয়ে ভেতরের অপরাধী) ──
  for (var i = 0; i < all.length; i++) {
    var el = all[i], r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    var cs = getComputedStyle(el);
    if (cs.position === 'fixed' || cs.visibility === 'hidden' || cs.display === 'none') continue;
    if (r.right > vw + 1 || r.left < -1) {
      var childOver = false;
      for (var j = 0; j < el.children.length; j++) {
        var cr = el.children[j].getBoundingClientRect();
        if (cr.right > vw + 1 || cr.left < -1) { childOver = true; break; }
      }
      if (!childOver) res.overflow.push({
        selector: sel(el), right: Math.round(r.right),
        width: Math.round(r.width), overhang: Math.round(r.right - vw),
      });
    }
  }

  /**
   * ── ২. উল্লম্ব ক্লিপিং ──
   *
   * ⚠️ প্রথম সংস্করণে কেবল \`scrollHeight > clientHeight\` দেখা হতো।
   *    সেটি **মিথ্যা অভিযোগে ভরে যেত**: ফুটারের ভেতরের অলংকারিক
   *    radial-gradient (\`h-72\`, pointer-events:none) অভিভাবকের চেয়ে
   *    লম্বা হলেই "২৮px কাটা" দেখাত — অথচ ওটি কাটা পড়াই উদ্দেশ্য।
   *    \`<input>\` ও নিজের scrollHeight ৩px বেশি জানায়।
   *
   *    এখন প্রশ্নটা সঠিকভাবে করা হয়: **পাঠযোগ্য লেখা বা ব্যবহারযোগ্য
   *    কন্ট্রোল** কি সত্যিই কেটে যাচ্ছে? অলংকরণ (aria-hidden /
   *    pointer-events:none) গোনা হয় না।
   */
  for (var k = 0; k < all.length; k++) {
    var e2 = all[k], c2 = getComputedStyle(e2);
    if (c2.display === 'none' || c2.visibility === 'hidden') continue;
    var hid = c2.overflowY === 'hidden' || c2.overflowY === 'clip'
           || c2.overflowX === 'hidden' || c2.overflowX === 'clip';
    if (!hid) continue;
    /**
     * ⚠️ বন্ধ \`<details>\` বাদ — সেটি কন্টেন্ট **লুকিয়ে রাখার
     *   জন্যই** তৈরি। প্রথম রানে হোমপেজের FAQ অ্যাকর্ডিয়নগুলো
     *   "৮৩–১০৬px কাটা" হিসেবে দেখাত, যা সম্পূর্ণ ভুল অভিযোগ।
     *
     *   ⚠️⚠️ এই ব্লকটি একটি template literal এর **ভিতরে**, তাই
     *   এখানে প্রতিটি backtick অবশ্যই escape করতে হবে। না করলে
     *   literal ওখানেই বন্ধ হয়ে যায় আর ভিতরের লেখাটুকু expression
     *   হিসেবে evaluate হয় — স্ক্রিপ্ট চালু হওয়ার আগেই
     *   ReferenceError: details is not defined. ২০২৬-০৮-১৪ তারিখে
     *   ঠিক তাই ঘটেছিল, এবং কমিট হওয়া কপিটি চলতই না।
     */
    if (e2.tagName === 'DETAILS' && !e2.open) continue;
    if (e2.closest('details:not([open])')) continue;
    var box = e2.getBoundingClientRect();
    if (box.height < 24) continue;

    var victims = e2.querySelectorAll('p, h1, h2, h3, h4, span, li, a, button, label, td, th');
    for (var v = 0; v < victims.length; v++) {
      var vi = victims[v];
      if (vi.getAttribute('aria-hidden') === 'true') continue;
      if (vi.closest('[aria-hidden="true"]')) continue;
      var vcs = getComputedStyle(vi);
      if (vcs.pointerEvents === 'none' || vcs.visibility === 'hidden' || vcs.display === 'none') continue;
      // নিজের লেখা আছে এমন সবচেয়ে ভেতরের উপাদানই ধরি
      var own = (vi.textContent || '').trim();
      if (!own) continue;
      var vr = vi.getBoundingClientRect();
      if (vr.height < 6 || vr.width < 6) continue;
      var cutB = Math.round(vr.bottom - box.bottom);
      var cutR = Math.round(vr.right - box.right);
      if (cutB > 2 || cutR > 2) {
        res.clipped.push({
          selector: sel(e2), victim: sel(vi),
          cut: Math.max(cutB, cutR), dir: cutB > cutR ? 'নিচে' : 'ডানে',
          text: own.slice(0, 45).replace(/\\s+/g, ' '),
        });
        break; // একটি অভিভাবকের জন্য একটিই উদাহরণ যথেষ্ট
      }
    }
  }

  // ── ৩. fixed এলিমেন্ট ইন্টারঅ্যাকটিভ কিছু ঢেকেছে কি না ──
  var fixed = [];
  for (var m = 0; m < all.length; m++) {
    var fe = all[m], fcs = getComputedStyle(fe);
    if (fcs.position !== 'fixed') continue;
    if (fcs.visibility === 'hidden' || fcs.display === 'none' || fcs.opacity === '0') continue;
    if (fcs.pointerEvents === 'none') continue;
    var fr = fe.getBoundingClientRect();
    if (fr.width < 8 || fr.height < 8) continue;
    fixed.push({ el: fe, rect: fr, selector: sel(fe) });
  }
  var targets = document.querySelectorAll('button, a[href], input, select, textarea, [role="button"]');
  for (var t = 0; t < targets.length; t++) {
    var tg = targets[t], tr = tg.getBoundingClientRect();
    if (tr.width < 4 || tr.height < 4) continue;
    if (tr.bottom < 0 || tr.top > window.innerHeight) continue;
    for (var f = 0; f < fixed.length; f++) {
      if (fixed[f].el.contains(tg)) continue;
      var fr2 = fixed[f].rect;
      var ox = Math.min(tr.right, fr2.right) - Math.max(tr.left, fr2.left);
      var oy = Math.min(tr.bottom, fr2.bottom) - Math.max(tr.top, fr2.top);
      if (ox > 4 && oy > 4) {
        var cx = Math.max(tr.left, fr2.left) + ox / 2;
        var cy = Math.max(tr.top, fr2.top) + oy / 2;
        var top = document.elementFromPoint(cx, cy);
        if (top && !tg.contains(top) && top !== tg) res.covered.push({
          target: sel(tg), text: (tg.innerText || tg.value || '').slice(0, 40),
          by: fixed[f].selector, overlapY: Math.round(oy),
        });
      }
    }
  }
  return res;
})()`;

/* ─────────────────────────── সহায়ক ─────────────────────────── */

/** ⚠️ অ্যাপের ব্রুট-ফোর্স গার্ড হারনেসকে যেন না আটকায় */
async function clearRateLimits() {
  await db.$executeRawUnsafe('DELETE FROM "RateLimitBucket"').catch(() => {});
}

/**
 * ⚠️ **দুটোরই** সরে যাওয়া পর্যন্ত অপেক্ষা করতে হয়:
 *   · `.v-ovl`  — রুট/mutation ওভারলে
 *   · `#v-boot` — পূর্ণ-পাতা লোডের বুট-পর্দা (`BootDismiss` সরায়)
 *   আগে কেবল প্রথমটির অপেক্ষা করা হতো, ফলে বুট-পর্দা তখনো পর্দায়
 *   থাকা অবস্থায় মাপা হতো আর রিপোর্টে "নেভবার ঢেকেছে div#v-boot"
 *   ধরনের **হারনেস-সৃষ্ট** অভিযোগ আসত।
 */
async function settle(page) {
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page
    .waitForFunction(
      /**
       * ⚠️⚠️ এখানে `offsetParent` **ব্যবহার করা যাবে না**।
       *
       *   `#v-boot` হলো `position:fixed`, আর fixed এলিমেন্টের
       *   `offsetParent` স্পেক অনুযায়ী **সবসময় null**। তাই আগের
       *   শর্তে `!b.offsetParent` প্রথম মুহূর্তেই সত্য হয়ে যেত এবং
       *   অপেক্ষাটি সাথে সাথেই শেষ হতো — অর্থাৎ প্রতিটি পাতা মাপা
       *   হতো **বুট-পর্দা ওঠা অবস্থায়**। ২০২৬-০৮-১৪ এর রানে ঠিক
       *   তাই হয়েছিল: ৪৭১টি "ঢাকা" অভিযোগের প্রায় সবগুলোই
       *   `div#v-boot` — একটিও আসল নয়।
       *
       *   `BootDismiss` পর্দাটি ৪২০ms পরে DOM থেকে **সরিয়ে** দেয়,
       *   তাই `!b` ই যথেষ্ট; opacity শর্তটি রাখা হলো নিরাপত্তার
       *   জন্য (JS ব্যর্থ হলে CSS-এর ৮s safety opacity 0 করে)।
       */
      `!document.querySelector('.v-ovl') && (function(){ var b=document.getElementById('v-boot'); return !b || getComputedStyle(b).opacity === '0' || getComputedStyle(b).visibility === 'hidden'; })()`,
      null,
      // ⚠️ `next dev` এ প্রতিটি রুট প্রথমবার on-demand কম্পাইল হয়;
      //    ১৫s এ কুলাত না, তখন বুট-পর্দা ওঠা অবস্থাতেই মাপা হতো।
      { timeout: 45000 },
    )
    .catch(() => {});
  await page.waitForTimeout(400);
}

async function login(ctx, page, creds, wantPath) {
  await clearRateLimits();
  const trace = { chain: [], cookies: [], session: null, finalUrl: '' };
  const onResp = (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith('/api/auth') || u.pathname === wantPath)
      trace.chain.push(`${r.status()} ${u.pathname}${r.headers()['location'] ? ' → ' + r.headers()['location'] : ''}`);
  };
  page.on('response', onResp);

  /**
   * ★ একবার ব্যর্থ হলে বাকেট পরিষ্কার করে **আর একবার** চেষ্টা।
   *
   *   ⚠️ কেন দরকার: রান শুরুর সময় বাকেট খালি করা হয়, কিন্তু anon
   *   পর্বটি ১০ মিনিটের বেশি চলে। ইতিমধ্যে অন্য কিছু (ডেভেলপারের
   *   নিজের ব্রাউজার, আরেকটি স্ক্রিপ্ট) ঐ IP থেকে লগইন করলে
   *   `login:ip` সীমা (১০/১০মিনিট) ভরে যায় এবং
   *   `/api/auth/callback/credentials` **401** দেয়। ২০২৬-০৮-১৪ এর
   *   রানে ঠিক তাই হয়েছিল — রিপোর্টে "৮টি পাতা বাউন্স" দেখাচ্ছিল,
   *   অথচ দোষ অ্যাপের নয়, হারনেসের পাশে চলা আরেকটি লগইনের।
   */
  const attempt = async () => {
    await page.goto(`${BASE}/login?callbackUrl=${encodeURIComponent(wantPath)}`, { waitUntil: 'domcontentloaded' });
    await settle(page);
    await page.fill('input[type="email"]', creds.email);
    await page.fill('input[type="password"]', creds.password);
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 }).catch(() => {});
    await settle(page);
    return !new URL(page.url()).pathname.startsWith('/login');
  };

  if (!(await attempt())) {
    console.log(`  ↻ লগইন ব্যর্থ (${creds.email}) — বাকেট খালি করে আবার চেষ্টা`);
    await clearRateLimits();
    await attempt();
  }

  trace.finalUrl = page.url();
  trace.cookies = (await ctx.cookies()).map((c) => ({ name: c.name, secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite }));
  trace.session = await page.evaluate(`fetch('/api/auth/session').then(r=>r.json()).catch(()=>null)`);
  page.off('response', onResp);
  return trace;
}

async function visit(page, route) {
  const resp = await page.goto(BASE + route, { waitUntil: 'domcontentloaded' }).catch(() => null);
  await settle(page);
  let m;
  try { m = await page.evaluate(MEASURE); } catch (e) { m = { error: String(e.message) }; }

  /**
   * ⚠️⚠️ "ঢাকা পড়েছে" প্রশ্নটি **পাতার একদম নিচে গিয়ে** করতে হয়।
   *
   *   উপরে (scrollY = 0) মাপলে ফুটারের যেকোনো লিংক—যেটি ঠিক তখন
   *   পর্দার নিচের অংশে পড়েছে—বটম-বারের সাথে ওভারল্যাপ দেখায়।
   *   কিন্তু ব্যবহারকারী স্ক্রল করলেই সেটি বেরিয়ে আসে, অর্থাৎ কিছুই
   *   হারায়নি। ২০২৬-০৮-১৪ এর রানে এমন ১৪টি "ঢাকা" ছিল — নিচে
   *   স্ক্রল করে মাপতেই **শূন্য**।
   *
   *   আসল প্রশ্ন: `body` এর padding-reserve কি বারের উচ্চতার সমান?
   *   না হলে max-scroll অবস্থাতেও কনটেন্ট বারের নিচে আটকে থাকে —
   *   সেটিই একমাত্র অবস্থা যেখানে কনটেন্ট **পৌঁছানো যায় না**।
   *   (fixed/sticky ভিতরের এলিমেন্টও এখানেই ধরা পড়ে, কারণ তারা
   *   স্ক্রলেও সরে না।)
   */
  await page.evaluate(`window.scrollTo(0, document.documentElement.scrollHeight)`).catch(() => {});
  await page.waitForTimeout(350);
  let mb;
  try { mb = await page.evaluate(MEASURE); } catch { mb = null; }
  await page.evaluate(`window.scrollTo(0, 0)`).catch(() => {});

  const here = new URL(page.url());
  return {
    route, status: resp ? resp.status() : null,
    landedOn: here.pathname,
    // ★ `/login` নিজে গন্তব্য হলে সেটি "বাউন্স" নয় — আগে প্রতিটি
    //   anon রানে একটি করে মিথ্যা বাউন্স গোনা হতো।
    bouncedToLogin: here.pathname.startsWith('/login') && !route.startsWith('/login'),
    vw: m.vw, scrollWidth: m.scrollWidth,
    overflowing: m.scrollWidth > m.vw + 1,
    offenders: (m.overflow || []).slice(0, 5),
    clipped: (m.clipped || []).slice(0, 5),
    covered: ((mb || m).covered || []).slice(0, 5),
  };
}

/* ─────────────────────────── মূল রান ─────────────────────────── */

const report = { base: BASE, at: new Date().toISOString(), auth: {}, viewports: {},
                 summary: { bounced: 0, overflowPages: 0, clippedPages: 0, coveredPages: 0 } };

const browser = await chromium.launch({ headless: true, executablePath: CHROME });

/**
 * ★ পার্সোনা-প্রতি **একটি** কনটেক্সট ও **একটি** লগইন।
 *   এরপর `setViewportSize()` দিয়ে সব প্রস্থ ঘোরানো হয় — তাই
 *   রেট-লিমিটে ধাক্কা লাগে না ও রান অনেক দ্রুত।
 */
async function persona(label, creds, wantPath, routes, vps, isMobile) {
  const ctx = await browser.newContext({
    viewport: { width: vps[0].width, height: vps[0].height },
    isMobile, hasTouch: isMobile, deviceScaleFactor: isMobile ? 3 : 1,
    ...(isMobile ? { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' } : {}),
  });
  const page = await ctx.newPage();

  if (creds) {
    const t = await login(ctx, page, creds, wantPath);
    const landed = new URL(t.finalUrl).pathname;
    const ok = landed.startsWith(wantPath);
    report.auth[label] = { ...t, landedOn: landed, expected: wantPath, PASS: ok,
      sessionUserId: t.session?.user?.id ?? null, sessionRole: t.session?.user?.role ?? null };
    if (!ok) report.summary.bounced++;
    console.log(`  ${ok ? '✓' : '✗'} লগইন ${label.padEnd(20)} → ${landed}  role=${t.session?.user?.role ?? '—'}`);
    if (!ok) console.log(`      চেইন: ${t.chain.join(' | ')}`);
  }

  for (const vp of vps) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    const rows = [];
    for (const r of routes) rows.push(await visit(page, r));

    const bad = rows.filter((r) => r.overflowing);
    const clip = rows.filter((r) => r.clipped.length);
    const cov = rows.filter((r) => r.covered.length);
    const bounce = rows.filter((r) => r.bouncedToLogin);
    report.viewports[`${label}@${vp.name}`] = rows;
    report.summary.overflowPages += bad.length;
    report.summary.clippedPages += clip.length;
    report.summary.coveredPages += cov.length;

    console.log(`  ${label}@${vp.name.padEnd(10)} ওভারফ্লো ${String(bad.length).padStart(2)} · ক্লিপ ${String(clip.length).padStart(2)} · ঢাকা ${String(cov.length).padStart(2)} · বাউন্স ${String(bounce.length).padStart(2)}  (${rows.length})`);
    for (const b of bad.slice(0, 3))
      console.log(`      ↔ ${b.route} ${b.scrollWidth}>${b.vw} :: ${b.offenders.map((o) => `${o.selector}(+${o.overhang})`).join(' , ')}`);
    for (const c of clip.slice(0, 3))
      console.log(`      ↧ ${c.route} :: ${c.clipped.map((o) => `${o.selector}(কাটা ${o.cut}px)`).join(' , ')}`);
    for (const c of cov.slice(0, 3))
      console.log(`      ⊘ ${c.route} :: "${c.covered[0].text}" ঢেকেছে ${c.covered[0].by}`);
  }
  await ctx.close();
}

console.log('\n━━━ মোবাইল ━━━');
await persona('anon-mobile', null, '/', PUBLIC_ROUTES, MOBILE_VPS, true);
await persona('customer-mobile', CUSTOMER, '/account', CUSTOMER_ROUTES, MOBILE_VPS, true);
await persona('admin-mobile', ADMIN, '/admin', ADMIN_ROUTES, MOBILE_VPS, true);

console.log('\n━━━ ডেস্কটপ ━━━');
await persona('anon-desktop', null, '/', PUBLIC_ROUTES, DESKTOP_VPS, false);
await persona('customer-desktop', CUSTOMER, '/account', CUSTOMER_ROUTES, DESKTOP_VPS, false);
await persona('admin-desktop', ADMIN, '/admin', ADMIN_ROUTES, DESKTOP_VPS, false);

await browser.close();
await db.$disconnect();

mkdirSync('audit', { recursive: true });
writeFileSync('audit/mobile-audit.json', JSON.stringify(report, null, 2));

console.log('\n━━━ সারাংশ ━━━');
console.log(`  লগইন বাউন্স        : ${report.summary.bounced}`);
console.log(`  ওভারফ্লো (পাতা×ভিউ) : ${report.summary.overflowPages}`);
console.log(`  উল্লম্ব ক্লিপিং     : ${report.summary.clippedPages}`);
console.log(`  ঢাকা-পড়া কন্ট্রোল  : ${report.summary.coveredPages}`);
console.log('  → audit/mobile-audit.json');
