/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ মোবাইল-ফার্স্ট UI/UX অডিট (২০২৬-০৮-১৫)
 *
 *   `mobile-audit.mjs` এর উত্তরসূরি। পুরনোটি তিনটি প্রশ্ন করত
 *   (লগইন · ওভারফ্লো · ঢাকা-পড়া)। এটি সেগুলো রেখে **আরও ছয়টি**
 *   যোগ করে, আর একটি **গুরুতর মাপজোখের ত্রুটি** সারায়:
 *
 *   ⚠️⚠️ **`document.documentElement.scrollWidth` একা বিশ্বাসযোগ্য নয়।**
 *      `globals.css:105` এ `body { overflow-x: hidden }` আছে। CSS স্পেক
 *      অনুযায়ী `html` এর overflow `visible` হলে viewport তার overflow
 *      **`body` থেকে** নেয় — অর্থাৎ পুরো ভিউপোর্টই `overflow-x:hidden`
 *      হয়ে যায় আর `scrollWidth` কখনোই `clientWidth` ছাড়ায় না।
 *      পুরনো হারনেসের `overflowing` পতাকাটি তাই **সবসময় false** —
 *      "ওভারফ্লো ০" একটি মুখোশ, প্রমাণ নয়।
 *
 *      এখানে তিনভাবে মাপা হয়:
 *        ১. `geomOverflow` — যেকোনো non-fixed এলিমেন্টের ডান কিনারা
 *           ভিউপোর্ট ছাড়ালো কি না (clip হোক বা না হোক, জ্যামিতি সত্য)
 *        ২. `rawScrollWidth` — clip সহ (পুরনো মাপ, তুলনার জন্য)
 *        ৩. `trueScrollWidth` — `html/body` এর overflow-x সাময়িকভাবে
 *           `visible` করে মাপা আসল নথি-প্রস্থ, তারপর পুনরুদ্ধার
 *
 *   নতুন যা মাপা হয়:
 *     ৪. ট্যাপ-টার্গেট < ৪৪px (দৃশ্যমান, ইন্টারঅ্যাকটিভ)
 *     ৫. ভাসমান উপাদানের পারস্পরিক সংঘর্ষ (z-index সহ)
 *     ৬. iOS ইনপুট-জুম (font-size < 16px এমন ফোকাসযোগ্য ইনপুট)
 *     ৭. কনসোল ত্রুটি ও ব্যর্থ নেটওয়ার্ক অনুরোধ
 *     ৮. নিচের নিরাপদ-এলাকা (বটম বার vs body padding)
 *     ৯. স্ক্রিনশট (ঐচ্ছিক, `AUDIT_SHOTS=1`)
 *
 *   চালানো:
 *     node scripts/audit/mobile-ux-audit.mjs
 *   পরিবেশ:
 *     AUDIT_BASE   — ডিফল্ট http://localhost:3000
 *     AUDIT_THEME  — light | dark | (খালি = সাইটের ডিফল্ট)
 *     AUDIT_OUT    — ফলাফল JSON
 *     AUDIT_SHOTS  — 1 হলে স্ক্রিনশট নেয়
 *     AUDIT_SCOPE  — mobile | desktop | all (ডিফল্ট all)
 * ═══════════════════════════════════════════════════════════
 */
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';

const BASE = process.env.AUDIT_BASE || 'http://localhost:3000';
const THEME = process.env.AUDIT_THEME || '';
const OUT = process.env.AUDIT_OUT || 'audit/mobile-ux-audit.json';
const SHOTS = process.env.AUDIT_SHOTS === '1';
const SHOT_DIR = process.env.AUDIT_SHOT_DIR || 'audit/shots';
const SCOPE = process.env.AUDIT_SCOPE || 'all';
/** ★ `AUDIT_ONLY=anon-mobile,customer-mobile` — দ্রুত পুনরাবৃত্তির জন্য */
const ONLY = (process.env.AUDIT_ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);
/** ★ `AUDIT_VPS=320x568,390x844` — কেবল এই ভিউপোর্টগুলো */
const VP_FILTER = (process.env.AUDIT_VPS || '').split(',').map((s) => s.trim()).filter(Boolean);

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

/** ★ ব্যবহারকারীর দেওয়া ম্যাট্রিক্স — সমালোচনামূলক ফোন-প্রস্থগুলো সবই আছে */
const MOBILE_VPS = [
  { name: '320x568', width: 320, height: 568 },   // iPhone SE 1 / পুরনো Android
  { name: '360x640', width: 360, height: 640 },   // সবচেয়ে সাধারণ Android
  { name: '375x667', width: 375, height: 667 },   // iPhone SE 2/3
  { name: '390x844', width: 390, height: 844 },   // iPhone 12–15
  { name: '393x852', width: 393, height: 852 },   // iPhone 15 Pro / Pixel
  { name: '412x915', width: 412, height: 915 },   // Android বড়
  { name: '430x932', width: 430, height: 932 },   // iPhone Pro Max
];
const DESKTOP_VPS = [
  { name: '768x1024', width: 768, height: 1024 },
  { name: '1024x768', width: 1024, height: 768 },
  { name: '1280x720', width: 1280, height: 720 },
  { name: '1366x768', width: 1366, height: 768 },   // সবচেয়ে সাধারণ ল্যাপটপ প্রস্থ
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1920x1080', width: 1920, height: 1080 },
];
/** ★ ল্যান্ডস্কেপ — কেবল কয়েকটি রুটে, নাহলে রান বিশাল হয়ে যায় */
const LANDSCAPE_VPS = [
  { name: '844x390L', width: 844, height: 390 },
  { name: '915x412L', width: 915, height: 412 },
];

/** ★ ইচ্ছাকৃত ৪০৪ — `not-found.tsx` মাপার একমাত্র পথ (নিচে ব্যাখ্যা) */
const NOT_FOUND_PROBE = '/__audit-404__';
/** ★ অ্যাডমিনের নিজস্ব ৪০৪ (`src/app/admin/not-found.tsx`) — আলাদা
 *  লেআউটে বসে, তাই আলাদা probe লাগে।
 *  ⚠️ নামটি ইচ্ছাকৃতভাবে উপরেরটিকে **ধারণ করে**, যাতে ৪০৪-ছাড়ের
 *  দুটি `includes(NOT_FOUND_PROBE)` পরীক্ষা এটিকেও ঢেকে ফেলে। */
const ADMIN_NOT_FOUND_PROBE = '/admin' + NOT_FOUND_PROBE;

const PUBLIC_ROUTES = [
  '/', '/login', '/register', '/forgot-password', '/search?q=diamond',
  '/track', '/contact', '/faq', '/terms', '/privacy', '/refund',
  /* ★ `/reset-password` এর **দুটি** অবস্থা, দুটিই আসল গ্রাহক দেখেন:
       token ছাড়া = "লিংকটি অবৈধ" কার্ড · token সহ = পাসওয়ার্ড ফর্ম।
       token যাচাই ক্লায়েন্টে হয় না (`params.get('token')` খালি কি না,
       এটুকুই), তাই ভুয়া token দিলেই ফর্মটি রেন্ডার হয় — API ডাকা হয়
       কেবল submit-এ, আর অডিট কিছু submit করে না। */
  '/reset-password', '/reset-password?token=audit-render-only',
  /* ★ `not-found.tsx` — একটি আসল গ্রাহক-পর্দা যা `page.tsx` নয়, তাই
       ক্রল-তালিকায় কখনো ছিল না। §১.১ প্রমাণ করেছে পর্দাটি বাস্তবে
       দেখা যায় (`/account/wallet` এর ভাঙা লিংক)। যেকোনো অস্তিত্বহীন
       পথই এটিকে আনে; নামটি ইচ্ছাকৃতভাবে স্পষ্ট, যাতে রিপোর্টে
       ৪০৪-টি দুর্ঘটনা নয় বোঝা যায়। */
  NOT_FOUND_PROBE,
];
const CUSTOMER_ROUTES = [
  '/account', '/account/orders', '/account/profile', '/account/notifications',
  /* ⚠️ `/account/wallet` **নেই** — কখনো ছিল না (কেবল `wallet/deposit` ও
     `wallet/withdraw`)। তালিকায় থাকায় প্রতিটি রানে ১৪টি মিথ্যা ৪০৪
     গোনা হতো। অ্যাপের একমাত্র লিংকটি (টাকা তোলার পাতার "← ওয়ালেট")
     ২০২৬-০৮-১৮ তারিখে `/account` এ সরানো হয়েছে। */
  '/account/wallet/deposit', '/account/wallet/withdraw',
  '/account/tickets', '/account/smm-orders',
];
const ADMIN_ROUTES = [
  '/admin', '/admin/orders', '/admin/deposits', '/admin/users', '/admin/products',
  '/admin/coupons', '/admin/banners', '/admin/tickets', '/admin/withdrawals',
  '/admin/reports', '/admin/site', '/admin/telegram', '/admin/media',
  '/admin/integrations', '/admin/payments', '/admin/otp', '/admin/logs',
  '/admin/branding', '/admin/homepage', '/admin/tools',
  /* ★ অ্যাডমিনের ৪০৪ — `/admin/users/<ভুল id>` যে পর্দায় নামে।
     এটি রুট-৪০৪ নয়; `src/app/admin/not-found.tsx` নিজের লেআউটে
     বসে, নাহলে অ্যাডমিন গ্রাহকের নেভবার ও বটম-বার দেখতেন। */
  ADMIN_NOT_FOUND_PROBE,
];
/** ★ পণ্যের পাতা — id সিডে বদলায়, তাই রানটাইমে খুঁজে নেওয়া হয় */
let PRODUCT_ROUTE = null;

/* ═════════════ রুট-কভারেজ — অন্ধ কোণ আর হাতে খুঁজতে হবে না ═════════════
 *
 *   ⚠️ এই হারনেসের অন্ধ কোণ **দুবার হাতে** ধরা পড়েছে: ২০২৬-০৮-২৬ এ
 *      চারটি ডাইনামিক ডিটেইল পাতা (§৮), আর ২০২৬-০৮-২৮ এ লগইনের
 *      পিছনের পাঁচটি পাতা (§৯)। দুবারই কারণ এক — ক্রল-তালিকাটি **হাতে
 *      লেখা**, আর `src/app` এ নতুন পাতা যোগ হলে তালিকাটি নিজে থেকে
 *      জানে না। তৃতীয়বার হাতে খোঁজার বদলে হারনেসই গুনে দেখুক।
 *
 *   নীতিটি §১১ এর মতোই — **লুকানো নয়, আলাদা করা**। যে রুট ইচ্ছাকৃতভাবে
 *   বাদ, সেটি `COVERAGE_EXEMPT` এ কারণ সহ লেখা থাকে; বাকি যেকোনো
 *   অ-মাপা রুট রিপোর্টে **উঠবে**।
 */
const APP_DIR = 'src/app';

/** ইচ্ছাকৃত বাদ — কারণ সহ, নাহলে এটিও একটি নীরব ফাঁক */
const COVERAGE_EXEMPT = {
  '/product/[id]': 'নিজের কোনো UI নেই — `/product/[id]/[slug]` এ redirect (page.tsx:17), আর সেটি মাপা হয়',
};

/**
 * ★ `page.tsx` নয়, তবু গ্রাহক দেখেন — এই তিনটি পর্দা রুট-গণনায় পড়ত না।
 *
 *   ⚠️ `error.tsx` ও `global-error.tsx` রেন্ডার হয় কেবল একটি **প্রকৃত
 *   রানটাইম ত্রুটিতে**। ক্রলে ইচ্ছাকৃত ত্রুটি ঘটানোর মানে হতো
 *   প্রোডাক্টে একটি "শুধু-অডিটের" পথ রাখা — সেটি নিজেই একটি ঝুঁকি।
 *   তাই দুটিই ইচ্ছাকৃতভাবে অ-মাপা, আর সেটি এখানে **লেখা থাকে**,
 *   নীরবে বাদ পড়ে না।
 */
const SPECIAL_SCREENS = [
  { file: 'src/app/not-found.tsx', probe: NOT_FOUND_PROBE, why: null },
  { file: 'src/app/admin/not-found.tsx', probe: ADMIN_NOT_FOUND_PROBE, why: null },
  { file: 'src/app/error.tsx', probe: null, why: 'রানটাইম ত্রুটি ছাড়া রেন্ডার হয় না — ক্রলে ইচ্ছাকৃত ত্রুটি ঘটানো হয় না' },
  { file: 'src/app/global-error.tsx', probe: null, why: 'একই কারণ; উপরন্তু এটি root layout ভাঙলে তবেই ওঠে' },
];

/** `src/app` এর প্রতিটি `page.tsx` → রুট-পথ (route group `(x)` বাদ যায়) */
function discoverRoutes(dir = APP_DIR, prefix = '') {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      // @-স্লট ও _প্রাইভেট ফোল্ডার রুট নয়
      if (e.name.startsWith('@') || e.name.startsWith('_')) continue;
      const seg = /^\(.*\)$/.test(e.name) ? '' : `/${e.name}`;
      out.push(...discoverRoutes(join(dir, e.name), prefix + seg));
    } else if (e.name === 'page.tsx') {
      out.push(prefix || '/');
    }
  }
  return out;
}

/** `/account/orders/[id]` ← `/account/orders/12` মেলাতে হবে */
function routeMatcher(fileRoute) {
  const src = fileRoute
    .split('/')
    .map((s) => (/^\[.*\]$/.test(s) ? '[^/]+' : s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('/');
  return new RegExp(`^${src}$`);
}

/** ক্রল-তালিকার সব রুট মিলিয়ে কোনটি মাপা হচ্ছে না, তা ফেরত দেয় */
function coverageGap(crawled) {
  const paths = crawled.map((r) => r.split('?')[0]);
  const discovered = discoverRoutes().sort();
  const missed = discovered.filter((f) => !paths.some((p) => routeMatcher(f).test(p)));

  const uncovered = missed.filter((r) => !(r in COVERAGE_EXEMPT));
  const exempt = missed.filter((r) => r in COVERAGE_EXEMPT)
    .map((r) => ({ route: r, why: COVERAGE_EXEMPT[r] }));

  /* ★ বিশেষ পর্দাগুলোও একই হিসাবে — নাহলে "৪৬/৪৬" বলে তিনটি পর্দা
       হিসাবের বাইরে থেকে যেত, আর সেটিই আগের ফাঁকটির চেহারা ছিল। */
  for (const s of SPECIAL_SCREENS) {
    if (!existsSync(s.file)) continue;
    if (s.probe && paths.includes(s.probe)) continue;
    (s.why ? exempt : uncovered).push(s.why ? { route: s.file, why: s.why } : s.file);
  }

  const total = discovered.length + SPECIAL_SCREENS.filter((s) => existsSync(s.file)).length;
  return { discovered: total, covered: total - uncovered.length - exempt.length, uncovered, exempt };
}

/* ═══════════ পাতার ভেতরে চালানো পরিমাপক (বিশুদ্ধ DOM) ═══════════ */
const MEASURE = String.raw`(function () {
  var de = document.documentElement;
  var vw = de.clientWidth;
  var res = {
    vw: vw,
    rawScrollWidth: de.scrollWidth,
    trueScrollWidth: null,
    geomOverflow: [],
    clipped: [],
    covered: [],
    smallTaps: [],
    nearTaps: [],
    aaTaps: [],
    zoomInputs: [],
    floatOverlap: [],
    bottomGap: null,
  };

  function sel(el) {
    if (el.id) return el.tagName.toLowerCase() + '#' + el.id;
    var c = (el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className) || '';
    c = String(c).trim().split(/\s+/).slice(0, 3).join('.');
    return el.tagName.toLowerCase() + (c ? '.' + c : '');
  }
  function path(el) {
    var out = [], n = el, hops = 0;
    while (n && n !== document.body && hops < 4) { out.unshift(sel(n)); n = n.parentElement; hops++; }
    return out.join(' > ');
  }

  var all = document.querySelectorAll('body *');

  /* ── ১. জ্যামিতিক অনুভূমিক ওভারফ্লো ──
     ⚠️⚠️ এই ব্লকটি একটি template literal এর **ভিতরে** — এখানে
     backtick লেখা নিষেধ, নাহলে literal ওখানেই বন্ধ হয়ে যায় আর
     স্ক্রিপ্ট চালুই হয় না (পুরনো হারনেসে ঠিক এই ভুলটিই হয়েছিল)।

     ⚠️ overflow-x:hidden এটি লুকাতে পারে না: getBoundingClientRect
     ক্লিপিং নয়, **লেআউট** জানায়। কিন্তু ক্লিপ-করা অভিভাবকের ভিতরে
     ইচ্ছাকৃতভাবে চওড়া কনটেন্ট (অনুভূমিক স্ক্রলার, টেবিল-র‍্যাপ,
     ক্যারোজেল ট্র্যাক) অপরাধী নয় — সেটি নকশা। তাই কোনো পূর্বপুরুষ
     সত্যিই স্ক্রল/ক্লিপ করলে বাদ দেওয়া হয়। */
  function insideScroller(el) {
    var n = el.parentElement;
    while (n && n !== document.documentElement) {
      var cs = getComputedStyle(n);
      /* ⚠️⚠️ **fixed অভিভাবক = কখনোই পাতার ওভারফ্লো নয়।**
         position:fixed উপাদান viewport-এর সাপেক্ষে বসে ও নথির
         scrollable এলাকায় **কোনো অবদান রাখে না** (CSS Overflow §3)।
         তাই তার ভিতরের absolute সন্তান ভিউপোর্ট ছাড়ালেও পাতা
         অনুভূমিকভাবে স্ক্রল করে না। প্রথম রানে এটি ধরা না থাকায়
         SiteBackground-এর অলংকারিক আভা-বৃত্তগুলো (pointer-events:
         none) প্রতিটি পাতায় ২টি করে **মিথ্যা** অপরাধী দেখাত —
         অথচ trueScrollWidth ঠিক vw এর সমানই ছিল, যা প্রমাণ করে
         কিছুই উপচায়নি। */
      if (cs.position === 'fixed') return true;
      var ox = cs.overflowX;
      if (n !== document.body && (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip')) {
        var nr = n.getBoundingClientRect();
        /* অভিভাবক নিজে ভিউপোর্টের ভিতরে থাকলে তার ভিতরের চওড়া
           কনটেন্ট পাতাকে ঠেলতে পারে না — সেটি নিরাপদ */
        if (nr.right <= vw + 1) return true;
      }
      n = n.parentElement;
    }
    return false;
  }

  for (var i = 0; i < all.length; i++) {
    var el = all[i], r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    var cs = getComputedStyle(el);
    if (cs.position === 'fixed' || cs.visibility === 'hidden' || cs.display === 'none') continue;
    if (r.right <= vw + 1 && r.left >= -1) continue;
    if (insideScroller(el)) continue;
    /* সবচেয়ে ভেতরের অপরাধীটিই রিপোর্ট করি */
    var childOver = false;
    for (var j = 0; j < el.children.length; j++) {
      var ce = el.children[j];
      var ccs = getComputedStyle(ce);
      if (ccs.position === 'fixed' || ccs.display === 'none') continue;
      var cr = ce.getBoundingClientRect();
      if ((cr.right > vw + 1 || cr.left < -1) && !insideScroller(ce)) { childOver = true; break; }
    }
    if (!childOver) res.geomOverflow.push({
      selector: sel(el), path: path(el),
      left: Math.round(r.left), right: Math.round(r.right),
      width: Math.round(r.width),
      overhang: Math.round(Math.max(r.right - vw, -r.left)),
    });
  }

  /* ── ২. উল্লম্ব/অনুভূমিক ক্লিপিং (পাঠযোগ্য কনটেন্ট) ── */
  for (var k = 0; k < all.length; k++) {
    var e2 = all[k], c2 = getComputedStyle(e2);
    if (c2.display === 'none' || c2.visibility === 'hidden') continue;
    var hid = c2.overflowY === 'hidden' || c2.overflowY === 'clip'
           || c2.overflowX === 'hidden' || c2.overflowX === 'clip';
    if (!hid) continue;
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
      /* line-clamp ইচ্ছাকৃত — অভিযোগ নয় */
      if (vcs.webkitLineClamp && vcs.webkitLineClamp !== 'none') continue;
      if (vcs.textOverflow === 'ellipsis') continue;
      var own = (vi.textContent || '').trim();
      if (!own) continue;
      var vr = vi.getBoundingClientRect();
      if (vr.height < 6 || vr.width < 6) continue;
      var cutB = Math.round(vr.bottom - box.bottom);
      var cutR = Math.round(vr.right - box.right);
      /* ★★★ স্ক্রলযোগ্য ঘেরাটোপে "কাটা পড়া" মানে **হারিয়ে যাওয়া নয়**।
         হোমপেজের লাইভ-ফিড একটি max-h-[440px] overflow-y-auto তালিকা,
         যা বসে আছে .card.overflow-hidden এর ভিতরে। তালিকার শেষ সারিটি
         কার্ডের নিচের কিনারা ছাড়িয়ে যায় — কিন্তু স্ক্রল করলেই দেখা যায়।
         এতদিন সেটিই "৩টি ক্লিপ" হয়ে রিপোর্টে উঠত (২০২৬-০৮-২৩ এ মাপা),
         অর্থাৎ প্রতিটি স্ক্রলযোগ্য তালিকা চিরকাল মিথ্যা অভিযোগ তুলত।
         ⚠️ এই ব্লকটি ব্রাউজারে ইনজেক্ট হওয়া **স্ট্রিং** — ভিতরে
         ব্যাক-টিক লিখলে template literal ভেঙে স্ক্রিপ্টটাই চলে না। */
      var scrollable = false;
      for (var an = vi.parentElement; an && an !== e2; an = an.parentElement) {
        var acs = getComputedStyle(an);
        if (cutB > 2 && (acs.overflowY === 'auto' || acs.overflowY === 'scroll')) { scrollable = true; break; }
        if (cutR > 2 && (acs.overflowX === 'auto' || acs.overflowX === 'scroll')) { scrollable = true; break; }
      }
      if (scrollable) continue;
      if (cutB > 2 || cutR > 2) {
        res.clipped.push({
          selector: sel(e2), victim: sel(vi),
          cut: Math.max(cutB, cutR), dir: cutB > cutR ? 'নিচে' : 'ডানে',
          text: own.slice(0, 45).replace(/\s+/g, ' '),
        });
        break;
      }
    }
  }

  /* ── ৩. fixed এলিমেন্ট ইন্টারঅ্যাকটিভ কিছু ঢেকেছে কি না ── */
  var fixed = [];
  for (var m = 0; m < all.length; m++) {
    var fe = all[m], fcs = getComputedStyle(fe);
    if (fcs.position !== 'fixed') continue;
    if (fcs.visibility === 'hidden' || fcs.display === 'none' || fcs.opacity === '0') continue;
    if (fcs.pointerEvents === 'none') continue;
    /* ⚠️ aria-hidden স্তর "ভাসমান উইজেট" নয় — বুট-পর্দা (#v-boot)
       হাইড্রেশনের পরপরই DOM থেকে সরে যায়, কিন্তু মাপার মুহূর্তে
       ধরা পড়লে প্রতিটি পাতায় একটি মিথ্যা "সংঘর্ষ" গোনা হতো। */
    if (fe.getAttribute('aria-hidden') === 'true') continue;
    var fr = fe.getBoundingClientRect();
    if (fr.width < 8 || fr.height < 8) continue;
    /* কেবল সবচেয়ে বাইরের fixed স্তরটি — ভিতরের সন্তানরা নয় */
    var nested = false;
    for (var q = 0; q < fixed.length; q++) if (fixed[q].el.contains(fe)) { nested = true; break; }
    if (nested) continue;
    fixed.push({ el: fe, rect: fr, selector: sel(fe), z: fcs.zIndex });
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

  /* ── ৪. ভাসমান উপাদানের পারস্পরিক সংঘর্ষ ── */
  for (var a = 0; a < fixed.length; a++) {
    for (var b = a + 1; b < fixed.length; b++) {
      var ra = fixed[a].rect, rb = fixed[b].rect;
      var oX = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
      var oY = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (oX > 8 && oY > 8) res.floatOverlap.push({
        a: fixed[a].selector, az: fixed[a].z,
        b: fixed[b].selector, bz: fixed[b].z,
        area: Math.round(oX * oY),
      });
    }
  }

  /* ── ৫. ট্যাপ-টার্গেট < ৪৪px ──
     ⚠️ ইনলাইন টেক্সট-লিংক (অনুচ্ছেদের ভিতরে) বাদ — সেগুলোর জন্য
     WCAG 2.5.8 নিজেই ছাড় দেয় ("inline exception")। */
  for (var s = 0; s < targets.length; s++) {
    var tt = targets[s];
    var tcs = getComputedStyle(tt);
    if (tcs.display === 'none' || tcs.visibility === 'hidden' || tcs.pointerEvents === 'none') continue;
    if (tt.hasAttribute('disabled')) continue;
    if (tt.type === 'hidden') continue;
    var trr = tt.getBoundingClientRect();
    if (trr.width < 2 || trr.height < 2) continue;
    /* ⚠️ বাক্যের ভিতরের লিংক বাদ — WCAG 2.5.8 নিজেই এর ছাড় দেয়
       ("inline exception"): অনুচ্ছেদের মাঝের একটি শব্দকে ৪৪px উঁচু
       করা মানে লাইন-উচ্চতা ভেঙে দেওয়া, যা পড়াকেই কঠিন করে।
       ⚠️ শর্তটি আগে 'display === inline' ও ছিল, কিন্তু সাইটের
       reset কিছু <a>-কে inline-flex করে দেয়, তাই বাক্যের ভিতরের
       লিংকও ধরা পড়ত। অবস্থান (<p>/<li> এর ভিতরে) বেশি নির্ভরযোগ্য।

       ⚠️⚠️ এই মন্তব্যে **কখনো backtick লিখবেন না** — পুরো ব্লকটি
       একটি String.raw টেমপ্লেটের ভিতরে, তাই একটি backtick-ই
       স্ট্রিংটিকে এখানেই শেষ করে দেয় এবং গোটা ফাইল
       "SyntaxError: Unexpected identifier" নিয়ে চলতেই পারে না।
       ২০২৬-০৮-১৮ তারিখে ঠিক তাই ঘটেছিল — অডিট স্ক্রিপ্টটি
       কমিট করা অবস্থাতেই অচল ছিল। */
    if (tt.closest('p, li') && !tt.className) continue;
    if (tt.closest('p') && tcs.display.indexOf('inline') === 0) continue;

    /* ⚠️⚠️ চেকবক্স/রেডিও যদি একটি <label> এর ভিতরে থাকে, তবে
       ছোঁয়ার প্রকৃত লক্ষ্য **লেবেলটি** — লেবেলের যেকোনো জায়গায়
       ট্যাপ করলেই টগল হয়। বাক্সটির নিজের ২৪px তখন কেবল আঁকার
       মাপ, ছোঁয়ার নয়। আগে এটি ধরা হতো না, ফলে অ্যাডমিনের
       সেটিংস-সারিগুলো (যেগুলো পুরো সারিজুড়ে লেবেল-মোড়ানো)
       ১২২টি মিথ্যা অভিযোগ তৈরি করত এবং আসল ছোট লক্ষ্যগুলো
       তালিকায় চাপা পড়ে যেত। লেবেলটি নিজেই ৪০px না হলে
       অভিযোগটি বহাল থাকে। */
    /* ⚠️⚠️ টেবিল-ঘরের ভেতরের **লেখা-লিংক** — ২৪px মেঝেটি ইচ্ছাকৃত।
       globals.css এর নিয়মটি (td a, .card a.underline → min-height:24px)
       ঠিক এই সিদ্ধান্তটিই লিখে রেখেছে: বোতাম ও স্বতন্ত্র নিয়ন্ত্রণ
       ৪০px, কিন্তু টেবিলের ঘরের ভেতরের নামের লিংককে ৪০px করলে প্রতিটি
       সারি ফুলে ওঠে আর ঘনত্ব — যা অ্যাডমিন টেবিলের গোটা কাজ — নষ্ট হয়।
       WCAG 2.5.8 (AA) যা দাবি করে তা ২৪×২৪, এরা তা পূরণ করে।

       এতদিন হারনেস ৪০px-এর একটিই মেঝে ধরত, তাই /admin/users এর নাম-
       লিংকগুলো (২৪×৪০–২৬৭) প্রতি ভিউপোর্টে অভিযোগ তুলত — ২০২৬-০৮-২৫
       এর রানে **৩৭ হিট**, অর্থাৎ অবশিষ্ট তালিকার এক-চতুর্থাংশ। নীরবে
       ফেলে দিলে মাপটি হারিয়ে যেত, তাই এগুলো aaTaps-এ **আলাদা করে
       গোনা** হয় — ত্রুটি নয়, কিন্তু অদৃশ্যও নয়।

       ⚠️ CSS নিয়মটি বদলালে এই ছাড়টিও বদলাতে হবে — একটির সত্যতা
       অন্যটির উপর দাঁড়িয়ে আছে (চেকবক্সের ছাড়টির মতোই)।
       ⚠️⚠️ এই মন্তব্যে backtick লেখা যাবে না — ব্লকটি String.raw এর
       ভিতরে (ফাইলের মাথার সতর্কতা দ্রষ্টব্য)। */
    var lab = (tt.type === 'checkbox' || tt.type === 'radio') ? tt.closest('label') : null;
    if (lab) {
      var lr = lab.getBoundingClientRect();
      if (lr.height >= 40 && lr.width >= 40) continue;
    }

    /* ⚠️ লেবেল ছাড়া দাঁড়ানো চেকবক্স/রেডিওও আসলে ২৪px নয়।
       globals.css এর নিয়মটি **প্রতিটি** চেকবক্স/রেডিওতে একটি
       ছদ্ম-উপাদান বসায় (::after with inset:-9px), অর্থাৎ প্রকৃত
       ক্লিক-এলাকা ২৪+৯+৯ = **৪২px** — আঁকা বাক্সটি ছোট, ছোঁয়ার
       লক্ষ্য নয়। getBoundingClientRect() ছদ্ম-উপাদান দেখে না,
       তাই হারনেস ঐ ২৪px-কেই সত্য ধরে নিত (/admin/homepage এ
       ১৬টি অভিযোগ)। নিয়মটি বিশ্বজনীন বলে ছাড়টিও বিশ্বজনীন।
       ⚠️ CSS নিয়মটি বদলালে এই ছাড়টিও বদলাতে হবে — একটির সত্যতা
       অন্যটির উপর দাঁড়িয়ে আছে।
       ⚠️⚠️ এই মন্তব্যে backtick লেখা যাবে না — পুরো ব্লকটি একটি
       String.raw টেমপ্লেটের ভিতরে (ফাইলের মাথার সতর্কতা দ্রষ্টব্য)। */
    if (tt.type === 'checkbox' || tt.type === 'radio') {
      if (trr.height >= 24 && trr.width >= 24) continue;
    }
    var h = Math.round(trr.height), w = Math.round(trr.width);

    /* ⚠️ ছাড়ের শর্তটি **গোল-করা** মাপ দেখে, কাঁচা ভগ্নাংশ নয়।
       আগে কাঁচা trr.height তুলনা করা হতো, অথচ রিপোর্টে যেত তার
       গোল-করা রূপ — ফলে ২৩.৯৮px উঁচু একটি লিংক রিপোর্টে "২৪px"
       ছাপা হয়েও ছাড় পেত না। ২০২৬-০৮-২৬ এ ঠিক তাই ঘটেছিল:
       /account/orders এর "↻ আবার" লিংকটি ডার্ক রানে aaTaps-এ আর
       লাইট রানে smallTaps-এ পড়ে — একই উপাদান, একই মাপ, ভিন্ন শ্রেণি,
       কেবল ফন্ট-রেন্ডারিংয়ের সাব-পিক্সেল পার্থক্যে। যে হারনেস থিম
       বদলালে রায় বদলায়, তার সংখ্যায় ভরসা করা যায় না।

       ⚠️⚠️ এই ব্লকে **ব্যাক-টিক লেখা নিষেধ** — পুরোটা String.raw এর
       ভিতরে (ফাইলের মাথার সতর্কতা)। এই মন্তব্যটি লিখতে গিয়েই আমি
       সেটি ভুলে গিয়েছিলাম আর স্ক্রিপ্ট চলতেই পারেনি। */
    var aaLink = tt.tagName === 'A' && h >= 24 && w >= 24 &&
      (tt.closest('td') || (tt.classList.contains('underline') && tt.closest('.card')));
    /* ⚠️ দুই ধাপ, কারণ দুটি ভিন্ন মানদণ্ড:
         · < ৪০px = এই প্রকল্পের নিজস্ব নিয়ম ভাঙে (§17) → আসল ত্রুটি
         · ৪০–৪৩px = WCAG 2.5.5 (AAA, ৪৪px) পার করে না, কিন্তু
           2.5.8 (AA, ২৪px) পার করে → তথ্য হিসেবে রাখা, ত্রুটি নয়
       একটিমাত্র সীমা রাখলে ফুটারের ৪০px লিংকগুলো প্রতিটি পাতায়
       "ত্রুটি" হয়ে আসল ছোট টার্গেটগুলো (২২px) চাপা দিয়ে দিত। */
    if (h < 40 || w < 24) {
      /* ⚠️ ছাড়টি **ঠিক এখানেই** প্রয়োগ হয়, আগে নয় — নাহলে ৪০px পার
         করা টেবিল-লিংকগুলোও (যারা কোনোদিন অভিযোগ তুলত না) aaTaps-এ
         ঢুকে পড়ত আর nearTaps এর হিসাব বদলে যেত। aaTaps তাই কেবল
         "অভিযোগ হতে পারত, কিন্তু ইচ্ছাকৃত" লিংকগুলোই গোনে। */
      (aaLink ? res.aaTaps : res.smallTaps).push({ selector: sel(tt), path: path(tt), w: w, h: h,
        text: (tt.innerText || tt.getAttribute('aria-label') || '').slice(0, 30).replace(/\s+/g, ' ') });
    } else if (h < 44) res.nearTaps.push({ selector: sel(tt), w: w, h: h });
  }

  /* ── ৬. iOS ইনপুট-জুম (font-size < 16px) ──
     ⚠️ কেবল **টাচ-পর্দায়** অর্থবহ। iOS-এর অটো-জুম নিয়মটি
     মাউস-চালিত ব্রাউজারে নেই, তাই ডেস্কটপ কনটেক্সটে ১৪px ইনপুট
     কোনো ত্রুটি নয় — ওটি ইচ্ছাকৃত ঘনত্ব। আগে এই পার্থক্য করা হতো
     না, ফলে ১৯৫টি হিটের বড় অংশ ছিল ডেস্কটপ সারির মিথ্যা অভিযোগ,
     আর তাতে ল্যান্ডস্কেপের **আসল** ঘটনাগুলো চাপা পড়ে যেত।
     (matchMedia হলো একই শর্ত যা CSS-এ ব্যবহার করা হয়েছে।) */
  var coarse = window.matchMedia('(pointer: coarse)').matches;
  var fields = coarse
    ? document.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea, select')
    : [];
  for (var g = 0; g < fields.length; g++) {
    var fi = fields[g], fics = getComputedStyle(fi);
    if (fics.display === 'none' || fics.visibility === 'hidden') continue;
    /* ⚠️ অভিভাবক display:none হলে ইনপুটের নিজের computed display
       তবু 'block' থাকে — তাই জ্যামিতি দেখে বাদ দিতে হয়। নাহলে
       ন্যাভবারের ডেস্কটপ সার্চ-বক্স (মোবাইলে লুকানো, ১৩px) প্রতিটি
       মোবাইল পাতায় একটি মিথ্যা "iOS জুম" অভিযোগ তৈরি করত।
       (⚠️ template literal এর ভিতরে — backtick লেখা নিষেধ।) */
    var fir = fi.getBoundingClientRect();
    if (fir.width < 2 || fir.height < 2) continue;
    var fs = parseFloat(fics.fontSize);
    if (fs < 15.99) res.zoomInputs.push({ selector: sel(fi), path: path(fi), fontSize: fs });
  }

  /* ── ৭. নিচের বার vs body reserve ── */
  var bar = document.querySelector('nav[aria-label="মোবাইল নেভিগেশন"]');
  if (bar) {
    var br = bar.getBoundingClientRect();
    var reserve = parseFloat(getComputedStyle(document.body).paddingBottom) || 0;
    res.bottomGap = { barHeight: Math.round(br.height), reserve: Math.round(reserve),
                      short: Math.round(br.height - reserve) };
  }

  return res;
})()`;

/** ★ overflow-x সাময়িকভাবে খুলে **আসল** নথি-প্রস্থ মাপা, তারপর ফেরত */
const TRUE_WIDTH = String.raw`(function(){
  var h = document.documentElement, b = document.body;
  var ho = h.style.overflowX, bo = b.style.overflowX;
  h.style.overflowX = 'visible'; b.style.overflowX = 'visible';
  var w = Math.max(h.scrollWidth, b.scrollWidth);
  h.style.overflowX = ho; b.style.overflowX = bo;
  return { trueScrollWidth: w, clientWidth: h.clientWidth };
})()`;

/* ─────────────────────────── সহায়ক ─────────────────────────── */

async function clearRateLimits() {
  await db.$executeRawUnsafe('DELETE FROM "RateLimitBucket"').catch(() => {});
}

async function settle(page) {
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  /**
   * ⚠️⚠️ **ফাংশন-রূপ ইচ্ছাকৃত, স্ট্রিং নয়** (মাপা ২০২৬-০৮-৩০)।
   *
   *   Playwright-কে `waitForFunction` এ **স্ট্রিং** দিলে সে পাতার ভেতরে
   *   সেটিকে `new Function` দিয়ে কম্পাইল করে। অ্যাপের CSP কড়া
   *   (`script-src 'self' 'nonce-…' 'strict-dynamic'`, `unsafe-eval` নেই),
   *   তাই ব্রাউজার সেটি **ঠিকভাবেই** আটকায় এবং পাতায় একটি
   *   `EvalError` ছোড়ে — যা হারনেস নিজের কনসোল-কাউন্টারে গুনত।
   *
   *   অর্থাৎ কাউন্টারটি অ্যাপের ত্রুটি নয়, **নিজের পরিমাপ-যন্ত্রের**
   *   ত্রুটি দেখাত — §১১ এর সেই একই ফাঁদ। নিয়ন্ত্রিত পরীক্ষায় মাপা:
   *   স্ট্রিং-রূপে ১২টি পাতায় `EvalError`, ফাংশন-রূপে **০**।
   *   (উল্টো দিকে এটি একটি সুসংবাদও — CSP সত্যিই কাজ করছে।)
   */
  await page
    .waitForFunction(
      () => {
        if (document.querySelector('.v-ovl')) return false;
        const b = document.getElementById('v-boot');
        if (!b) return true;
        const cs = getComputedStyle(b);
        return cs.opacity === '0' || cs.visibility === 'hidden';
      },
      null,
      { timeout: 45000 },
    )
    .catch(() => {});
  await page.waitForTimeout(400);
}

async function login(ctx, page, creds, wantPath) {
  await clearRateLimits();
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
  const session = await page.evaluate(`fetch('/api/auth/session').then(r=>r.json()).catch(()=>null)`);
  return { finalUrl: page.url(), session };
}

async function visit(page, route, label, vpName, console_, net, aborted) {
  console_.length = 0;
  net.length = 0;
  aborted.length = 0;
  const resp = await page.goto(BASE + route, { waitUntil: 'domcontentloaded' }).catch(() => null);
  await settle(page);

  let m;
  try { m = await page.evaluate(MEASURE); } catch (e) { m = { error: String(e.message) }; }
  let tw = null;
  try { tw = await page.evaluate(TRUE_WIDTH); } catch { /* */ }
  if (m && tw) m.trueScrollWidth = tw.trueScrollWidth;

  // ⚠️ "ঢাকা পড়েছে" প্রশ্নটি পাতার একদম নিচে গিয়ে করতে হয়
  await page.evaluate(`window.scrollTo(0, document.documentElement.scrollHeight)`).catch(() => {});
  await page.waitForTimeout(300);
  let mb = null;
  try { mb = await page.evaluate(MEASURE); } catch { /* */ }
  await page.evaluate(`window.scrollTo(0, 0)`).catch(() => {});

  const bootStillUp = await page.evaluate(`!!document.getElementById('v-boot')`).catch(() => false);

  if (SHOTS) {
    const safe = `${label}@${vpName}${route.replace(/[^\w]+/g, '_')}`;
    mkdirSync(SHOT_DIR, { recursive: true });
    await page.screenshot({ path: `${SHOT_DIR}/${safe}.png`, fullPage: false }).catch(() => {});
  }

  const here = new URL(page.url());

  /**
   * ★★★ ব্রাউজারের **নিজের** এরর-পাতা — আমাদের UI নয়।
   *
   *   সার্ভার মাঝপথে মরে গেলে (রিগের লিপিবদ্ধ ফ্লেকি) Chrome
   *   "This site can't be reached" আঁকে। তার ভেতরে Chrome-এর নিজের
   *   `#reload-button` ও `#details-button` আছে — ৭৪×৩১px, অর্থাৎ
   *   আমাদের ট্যাপ-টার্গেট সীমার নিচে। ফলে হারনেস ঐ পাতাগুলোকে
   *   **আমাদের** ত্রুটি হিসেবে গুনত: ২০২৬-০৮-৩০ এর রানে ৭টি
   *   "ছোট ট্যাপ-টার্গেট" পাতার প্রতিটিই আসলে এটিই ছিল।
   *
   *   এটি §১১-এর সেই সমস্যারই আরেক রূপ (*কাউন্টার যা ভুল জিনিস
   *   গোনে*)। তাই পাতাটি লোডই না হলে UI-কাউন্টারগুলো **খালি** যায়,
   *   আর `didNotLoad` আলাদা করে গোনা হয় — তথ্যটি হারায় না, কেবল
   *   ভুল কলামে বসে না।
   */
  const didNotLoad = await page.evaluate(
    '!!document.querySelector("#main-frame-error")',
  ).catch(() => false);

  return {
    route,
    didNotLoad,
    status: resp ? resp.status() : null,
    landedOn: here.pathname,
    bouncedToLogin: here.pathname.startsWith('/login') && !route.startsWith('/login'),
    vw: m.vw,
    rawScrollWidth: m.rawScrollWidth,
    trueScrollWidth: m.trueScrollWidth,
    /** ★ আসল প্রশ্ন — মুখোশ ছাড়া */
    overflowing: !didNotLoad && ((m.trueScrollWidth != null && m.trueScrollWidth > m.vw + 1) || (m.geomOverflow || []).length > 0),
    offenders: (m.geomOverflow || []).slice(0, 6),
    clipped: didNotLoad ? [] : (m.clipped || []).slice(0, 5),
    covered: (bootStillUp || didNotLoad) ? [] : ((mb || m).covered || []).slice(0, 5),
    floatOverlap: didNotLoad ? [] : (m.floatOverlap || []).slice(0, 5),
    smallTaps: didNotLoad ? [] : (m.smallTaps || []).slice(0, 8),
    nearTaps: didNotLoad ? [] : (m.nearTaps || []).slice(0, 4),
    aaTaps: didNotLoad ? [] : (m.aaTaps || []).slice(0, 4),
    zoomInputs: didNotLoad ? [] : (m.zoomInputs || []).slice(0, 5),
    bottomGap: m.bottomGap,
    consoleErrors: console_.slice(0, 5),
    failedRequests: net.slice(0, 5),
    /** ★ নিরীহ বাতিল-prefetch — আলাদা, যাতে উপরের সংখ্যাটি অর্থবহ থাকে */
    abortedRequests: aborted.slice(0, 5),
    notSettled: bootStillUp,
  };
}

/* ─────────────────────────── মূল রান ─────────────────────────── */

const report = {
  base: BASE, at: new Date().toISOString(), theme: THEME || 'default',
  auth: {}, viewports: {},
  summary: {
    pages: 0, bounced: 0, overflowPages: 0, clippedPages: 0, coveredPages: 0,
    floatOverlapPages: 0, smallTapPages: 0, zoomInputPages: 0,
    consoleErrorPages: 0, failedRequestPages: 0, abortedRequestPages: 0,
    notSettled: 0, bottomShortPages: 0, didNotLoadPages: 0,
  },
};

/**
 * ★★★ `--ignore-certificate-errors` — **কনটেক্সটের ছাড় যথেষ্ট নয়**।
 *
 *   প্রোডাকশন রিগের সার্ট self-signed। `ignoreHTTPSErrors` পাতা লোডে
 *   কাজ করে, কিন্তু Chrome সার্ভিস-ওয়ার্কার রেজিস্ট্রেশনে সার্ট
 *   আলাদাভাবে যাচাই করে — তাই `public/sw.js` নিবন্ধিত হতো না এবং
 *   প্রতিটি রানে "An SSL certificate error occurred when fetching the
 *   script" কনসোল-ত্রুটি উঠত (২০২৬-০৮-২৫ এর রানে ৭টি, রিপোর্টের
 *   একমাত্র অবশিষ্ট কনসোল-ত্রুটি — পুরোটাই হারনেসের)।
 *
 *   ছাড়টি দিলে SW সত্যিই নিবন্ধিত হয়, অর্থাৎ PWA পথটিও এখন **মাপা**
 *   হয়, অনুমান নয়। নিরাপদ, কারণ `sw.js` কিছুই ক্যাশ করে না (কেবল
 *   network-first নেভিগেশন + অফলাইন ফলব্যাক) — বাসি পাতা মাপার ঝুঁকি নেই।
 */
const browser = await chromium.launch({
  headless: true, executablePath: CHROME,
  args: ['--ignore-certificate-errors'],
});

async function persona(label, creds, wantPath, routes, allVps, isMobile) {
  if (ONLY.length && !ONLY.includes(label)) return;
  const vps = VP_FILTER.length ? allVps.filter((v) => VP_FILTER.includes(v.name)) : allVps;
  if (!vps.length) return;
  const ctx = await browser.newContext({
    viewport: { width: vps[0].width, height: vps[0].height },
    isMobile, hasTouch: isMobile, deviceScaleFactor: isMobile ? 3 : 1,
    ignoreHTTPSErrors: true,
    ...(isMobile ? { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' } : {}),
  });
  if (THEME) {
    await ctx.addInitScript(`try { localStorage.setItem('theme', ${JSON.stringify(THEME)}); } catch {}`);
  }

  const page = await ctx.newPage();
  const consoleErrors = [];
  const failedRequests = [];
  /** ★ বাতিল-হওয়া অনুরোধ (prefetch/ফন্ট) — নিচের `requestfailed` এ ব্যাখ্যা */
  const abortedRequests = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const txt = msg.text();
    // ⚠️ dev-এর নিজস্ব কোলাহল বাদ — এগুলো প্রোডাক্ট-ত্রুটি নয়
    if (/Download the React DevTools|Fast Refresh|webpack-hmr|favicon/i.test(txt)) return;
    /**
     * ⚠️ বাতিল-হওয়া prefetch — Next এর **নিজের সেরে ওঠার** বার্তা।
     *
     *   ক্রলার আগের পাতার prefetch শেষ হওয়ার আগেই পরের পাতায় চলে যায়;
     *   অনুরোধটি বাতিল হয়, `fetch` reject করে, আর Next লেখে
     *   "Falling back to browser navigation" — অর্থাৎ সে নিজেই সাধারণ
     *   নেভিগেশনে ফিরে যায় এবং ব্যবহারকারী কিছুই টের পান না।
     *   ২০২৬-০৮-২৬ এর লাইট রানে এটিই একমাত্র কনসোল-ত্রুটি ছিল
     *   (১টি, `/admin/withdrawals`), অথচ ডার্ক রানে ছিল না — খাঁটি
     *   সময়-নির্ভর হারনেস-শব্দ।
     *
     *   ⚠️ ছাড়টি **সংকীর্ণ**: কেবল এই বাক্যটি, আর নিচের অংশটুকুই
     *   ছাড় পায় যেখানে Next নিজে fallback করার কথা বলে। বাতিল
     *   অনুরোধটি এখনো `failedRequests`-এ গোনা হয়, আর সার্ভার সত্যিই
     *   ভাঙলে fallback নেভিগেশনও ব্যর্থ হতো — যা status/bounce
     *   কাউন্টারে ধরা পড়ে। অর্থাৎ আসল ভাঙন লুকানোর পথ খোলা থাকছে না।
     */
    if (/Failed to fetch RSC payload.*Falling back to browser navigation/s.test(txt)) return;
    /**
     * ⚠️ ইচ্ছাকৃত ৪০৪ — নেটওয়ার্ক-কাউন্টারে ছাড় দিয়ে **কনসোলে ভুলে
     *   গিয়েছিলাম**, আর প্রথম রানেই "কনসোল ত্রুটি ৩" হয়ে ফিরে এল
     *   (তিন ভিউপোর্টে তিনবার একই বার্তা)। §১১ যে ভুলটির কথা বলে —
     *   কাউন্টার যা কখনো শূন্য হয় না — সেটি আমি নিজেই তৈরি করেছিলাম।
     *
     *   ছাড়টি সংকীর্ণ: বার্তাটি ৪০৪ হতে হবে **এবং** উৎস-URL ঐ একটিমাত্র
     *   probe পথ হতে হবে। অন্য যেকোনো পাতার ৪০৪ আগের মতোই ত্রুটি।
     */
    if (/status of 404/.test(txt) && (msg.location()?.url || '').includes(NOT_FOUND_PROBE)) return;
    /**
     * ★ উৎস-URL সহ রাখা হয় — নাহলে "Failed to load resource" বার্তাটি
     *   কোন সম্পদ নিয়ে, তা জানার কোনো উপায় থাকে না। ২০২৬-০৮-৩০ এ
     *   ঠিক এই কারণে একটি ত্রুটি নির্ণয় করতে আলাদা প্রোব লিখতে হয়েছিল।
     */
    const src = msg.location()?.url || '';
    consoleErrors.push((txt + (src ? `  ← ${src.slice(0, 120)}` : '')).slice(0, 300));
  });
  page.on('requestfailed', (r) => {
    const u = r.url();
    if (/_next\/static\/webpack|hot-update|__nextjs/.test(u)) return;
    const err = r.failure()?.errorText || 'failed';
    /**
     * ★★★ বাতিল-হওয়া RSC prefetch **আলাদা বালতিতে** — লুকানো নয়।
     *
     *   উপরের কনসোল-ছাড়টি ইচ্ছাকৃতভাবে লিখেছিল: "বাতিল অনুরোধটি
     *   এখনো `failedRequests`-এ গোনা হয়" — যাতে আসল ভাঙন লুকানোর
     *   পথ না থাকে। উদ্দেশ্যটি ঠিক, কিন্তু **রিপোর্টটি বিভ্রান্তিকর
     *   হয়ে গিয়েছিল**: ২০২৬-০৮-২৮ এর রানে ৫৫০টির মধ্যে **৪৯৯টি**
     *   পাতায় "ব্যর্থ অনুরোধ" দেখাত, অথচ ২০৪৫টি ব্যর্থতার
     *   **প্রতিটিই** ছিল `net::ERR_ABORTED …?_rsc=` — ক্রলার দ্রুত
     *   নেভিগেট করায় বাতিল হওয়া prefetch, যা থেকে Next নিজেই
     *   সেরে ওঠে। একটিও প্রকৃত 4xx/5xx বা সংযোগ-ব্যর্থতা ছিল না।
     *   (আগের রানগুলোতেও: ৪৬০ ও ৪৫৩ — কখনো শূন্য হয়নি, আর
     *   রিপোর্টে "প্রতিটি কাউন্টার ০" লেখার সময় এটি উল্লেখই হতো না।)
     *
     *   একটি সংখ্যা যা কখনো শূন্য হয় না, সেটিকে মানুষ পড়া বন্ধ করে
     *   দেয় — তখন ৫০০তম পাতার আসল ৫০০-ও চোখ এড়িয়ে যেত। তাই দুটি
     *   কাউন্টার: `failedRequestPages` (আসল) ও
     *   `abortedRequestPages` (নিরীহ)। কিছুই ফেলে দেওয়া হয় না —
     *   কেবল আলাদা করে গোনা হয়, ঠিক যেমন `aaTaps` করা হয়েছিল।
     */
    /**
     * ⚠️ **আসল বিভাজনটি `_rsc=` নয় — "বাতিল" বনাম "ব্যর্থ"।**
     *
     *   প্রথমে কেবল `?_rsc=` URL-কে নিরীহ ধরেছিলাম। প্রথম লাইট-রানেই
     *   সেটি ভুল প্রমাণিত হলো: "ব্যর্থ অনুরোধ ১" দেখাল, আর সেটি ছিল
     *   `net::ERR_ABORTED https://fonts.gstatic.com/…woff2` — ক্রলার
     *   পরের পাতায় চলে যাওয়ায় ব্রাউজারের বাতিল করা **ফন্ট** ডাউনলোড।
     *   prefetch নয়, কিন্তু সমান নিরীহ।
     *
     *   `ERR_ABORTED` মানেই **বাতিল** — সার্ভার ব্যর্থ হয়নি, কেউ
     *   অনুরোধটি ছেড়ে দিয়েছে। প্রকৃত ভাঙন অন্য চেহারায় আসে:
     *   4xx/5xx উত্তর (নিচের `response` হ্যান্ডলার), বা
     *   `ERR_CONNECTION_*` / `ERR_TIMED_OUT` / `ERR_FAILED` ধরনের
     *   ত্রুটি — সেগুলো `failedRequests` এই থাকে।
     */
    if (err.startsWith('net::ERR_ABORTED')) {
      abortedRequests.push(`${err} ${u.slice(0, 140)}`);
      return;
    }
    failedRequests.push(`${err} ${u.slice(0, 140)}`);
  });
  page.on('response', (r) => {
    if (r.status() < 400) return;
    const u = r.url();
    if (/favicon|__nextjs|hot-update/.test(u)) return;
    /**
     * ⚠️ ইচ্ছাকৃত ৪০৪ — গোনা হলে কাউন্টারটি **কখনো শূন্য হতো না**।
     *
     *   §১১ এর শিক্ষাটি ঠিক এটিই: যে সংখ্যা প্রতি রানে অশূন্য, মানুষ
     *   তা পড়া বন্ধ করে — তখন আসল ৪০৪-ও চোখ এড়ায়। `not-found.tsx`
     *   মাপতে হলে একটি ৪০৪ **আনতেই হবে**, তাই সেই একটিমাত্র পথের
     *   ৪০৪ ছাড় পায়; অন্য যেকোনো ৪০৪ আগের মতোই ত্রুটি।
     */
    if (r.status() === 404 && u.includes(NOT_FOUND_PROBE)) return;
    failedRequests.push(`${r.status()} ${u.slice(0, 140)}`);
  });

  if (creds) {
    const t = await login(ctx, page, creds, wantPath);
    const landed = new URL(t.finalUrl).pathname;
    const ok = landed.startsWith(wantPath);
    report.auth[label] = { landedOn: landed, expected: wantPath, PASS: ok,
      sessionRole: t.session?.user?.role ?? null };
    if (!ok) report.summary.bounced++;
    console.log(`  ${ok ? '✓' : '✗'} লগইন ${label.padEnd(20)} → ${landed}  role=${t.session?.user?.role ?? '—'}`);
  }

  for (const vp of vps) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    const rows = [];
    for (const r of routes) rows.push(await visit(page, r, label, vp.name, consoleErrors, failedRequests, abortedRequests));

    const count = (fn) => rows.filter(fn).length;
    report.viewports[`${label}@${vp.name}`] = rows;
    report.summary.pages += rows.length;
    report.summary.overflowPages += count((r) => r.overflowing);
    report.summary.clippedPages += count((r) => r.clipped.length);
    report.summary.coveredPages += count((r) => r.covered.length);
    report.summary.floatOverlapPages += count((r) => r.floatOverlap.length);
    report.summary.smallTapPages += count((r) => r.smallTaps.length);
    report.summary.zoomInputPages += count((r) => r.zoomInputs.length);
    report.summary.consoleErrorPages += count((r) => r.consoleErrors.length);
    report.summary.failedRequestPages += count((r) => r.failedRequests.length);
    report.summary.abortedRequestPages += count((r) => r.abortedRequests.length);
    report.summary.didNotLoadPages += count((r) => r.didNotLoad);
    report.summary.notSettled += count((r) => r.notSettled);
    report.summary.bottomShortPages += count((r) => r.bottomGap && r.bottomGap.short > 1);

    console.log(
      `  ${label}@${vp.name.padEnd(9)} ` +
      `ওভার ${String(count((r) => r.overflowing)).padStart(2)} · ` +
      `ক্লিপ ${String(count((r) => r.clipped.length)).padStart(2)} · ` +
      `ঢাকা ${String(count((r) => r.covered.length)).padStart(2)} · ` +
      `ট্যাপ ${String(count((r) => r.smallTaps.length)).padStart(2)} · ` +
      `জুম ${String(count((r) => r.zoomInputs.length)).padStart(2)} · ` +
      `সংঘর্ষ ${String(count((r) => r.floatOverlap.length)).padStart(2)} · ` +
      `err ${String(count((r) => r.consoleErrors.length)).padStart(2)}  (${rows.length})`,
    );
    for (const b of rows.filter((r) => r.overflowing).slice(0, 4))
      console.log(`      ↔ ${b.route}  true=${b.trueScrollWidth} raw=${b.rawScrollWidth} vw=${b.vw} :: ${b.offenders.map((o) => `${o.selector}(+${o.overhang})`).join(' , ')}`);
    for (const c of rows.filter((r) => r.clipped.length).slice(0, 3))
      console.log(`      ↧ ${c.route} :: ${c.clipped.map((o) => `${o.selector}→${o.victim}(${o.cut}px)`).join(' , ')}`);
    for (const c of rows.filter((r) => r.covered.length).slice(0, 3))
      console.log(`      ⊘ ${c.route} :: "${c.covered[0].text}" ঢেকেছে ${c.covered[0].by}`);
    for (const c of rows.filter((r) => r.floatOverlap.length).slice(0, 2))
      console.log(`      ✚ ${c.route} :: ${c.floatOverlap[0].a}(z${c.floatOverlap[0].az}) ⨯ ${c.floatOverlap[0].b}(z${c.floatOverlap[0].bz})`);
    for (const c of rows.filter((r) => r.consoleErrors.length).slice(0, 2))
      console.log(`      ⚠ ${c.route} :: ${c.consoleErrors[0]}`);
  }
  await ctx.close();
}

/** ★ প্রোডাক্ট পাতার আসল URL খুঁজে নিই (সিডে id বদলায়) */
try {
  const p = await db.product.findFirst({ where: { isActive: true }, select: { id: true, slug: true } });
  if (p) PRODUCT_ROUTE = `/product/${p.id}/${p.slug}`;
} catch { /* */ }
if (PRODUCT_ROUTE) PUBLIC_ROUTES.push(PRODUCT_ROUTE);

/**
 * ★★★ ডিটেইল-পাতা — অডিটের অন্ধ কোণ (২০২৬-০৮-২৬ এ যোগ)।
 *
 *   ৪১টি রুটের সবই স্ট্যাটিক পথ ছিল, তাই যে চারটি পাতা ডাইনামিক
 *   id-তে বসে সেগুলো **একবারও মাপা হয়নি** — অথচ বিরোধ ঠিক ওখানেই
 *   নিষ্পত্তি হয় (অর্ডার-বিস্তারিত · চালান · টিকিট-থ্রেড · অ্যাডমিনের
 *   গ্রাহক-প্রোফাইল)। HANDOFF §৪ এগুলোকে "ব্রাউজারে কখনো দেখা হয়নি"
 *   বলে চিহ্নিত করেছিল।
 *
 *   ⚠️ id **না পেলে রুটটি যোগই করা হয় না**। নেই-রুট তালিকায় রাখলে
 *   প্রতি রানে মিথ্যা ৪০৪ গোনা হয় — `/account/wallet` ঠিক সেটিই
 *   করত (§১.১)। ডেটা বসাতে: `npx tsx scripts/audit/_fixture-detail.ts`
 */
try {
  const cu = await db.user.findUnique({ where: { email: CUSTOMER.email }, select: { id: true } });
  if (cu) {
    const o = await db.order.findFirst({
      where: { userId: cu.id }, orderBy: { createdAt: 'desc' }, select: { id: true },
    });
    if (o) CUSTOMER_ROUTES.push(`/account/orders/${o.id}`, `/account/orders/${o.id}/invoice`);
    const t = await db.ticket.findFirst({
      where: { userId: cu.id }, orderBy: { lastMessageAt: 'desc' }, select: { id: true },
    });
    if (t) CUSTOMER_ROUTES.push(`/account/tickets/${t.id}`);
  }
  // ★ অ্যাডমিনের চোখে একজন সাধারণ গ্রাহক — নিজের প্রোফাইল নয়
  const su = await db.user.findFirst({
    where: { role: 'USER' }, orderBy: { createdAt: 'asc' }, select: { id: true },
  });
  if (su) ADMIN_ROUTES.push(`/admin/users/${su.id}`);
} catch { /* DB না পেলে অডিট আগের মতোই স্ট্যাটিক রুটে চলে */ }

/* ★ ক্রল শুরুর আগেই কভারেজ মাপা — রুট-তালিকা এখন চূড়ান্ত।
     ⚠️ DB না পেলে ডাইনামিক রুট যোগই হয় না, তাই তখন ফাঁক দেখানো
     স্বাভাবিক; বার্তাটি সেটিও বলে দেয়। */
report.coverage = coverageGap([...PUBLIC_ROUTES, ...CUSTOMER_ROUTES, ...ADMIN_ROUTES]);
{
  const c = report.coverage;
  console.log(`\n━━━ রুট-কভারেজ ━━━  ${c.covered}/${c.discovered} মাপা হচ্ছে`);
  for (const e of c.exempt) console.log(`  ○ ${e.route}  — ${e.why}`);
  for (const u of c.uncovered) console.log(`  ✗ ${u}  — ক্রল-তালিকায় নেই, কখনো মাপা হয় না`);
  if (c.uncovered.length && !PRODUCT_ROUTE) console.log('  ⚠️ DB পাওয়া যায়নি — ডাইনামিক রুটগুলো যোগ হয়নি, ফাঁকের একাংশ তারই ফল');
}

if (SCOPE === 'all' || SCOPE === 'mobile') {
  console.log('\n━━━ মোবাইল ━━━');
  await persona('anon-mobile', null, '/', PUBLIC_ROUTES, MOBILE_VPS, true);
  await persona('customer-mobile', CUSTOMER, '/account', CUSTOMER_ROUTES, MOBILE_VPS, true);
  await persona('admin-mobile', ADMIN, '/admin', ADMIN_ROUTES, MOBILE_VPS, true);

  console.log('\n━━━ ল্যান্ডস্কেপ ━━━');
  await persona('anon-land', null, '/', PUBLIC_ROUTES.slice(0, 6), LANDSCAPE_VPS, true);
  await persona('customer-land', CUSTOMER, '/account', CUSTOMER_ROUTES.slice(0, 5), LANDSCAPE_VPS, true);
}

if (SCOPE === 'all' || SCOPE === 'desktop') {
  console.log('\n━━━ ডেস্কটপ / ট্যাবলেট ━━━');
  await persona('anon-desktop', null, '/', PUBLIC_ROUTES, DESKTOP_VPS, false);
  await persona('customer-desktop', CUSTOMER, '/account', CUSTOMER_ROUTES, DESKTOP_VPS, false);
  await persona('admin-desktop', ADMIN, '/admin', ADMIN_ROUTES, DESKTOP_VPS, false);
}

await browser.close();
await db.$disconnect();

mkdirSync('audit', { recursive: true });
writeFileSync(OUT, JSON.stringify(report, null, 2));

const s = report.summary;
console.log('\n━━━ সারাংশ ━━━');
console.log(`  মোট পাতা-মাপ        : ${s.pages}`);
console.log(`  লগইন বাউন্স         : ${s.bounced}`);
console.log(`  অনুভূমিক ওভারফ্লো   : ${s.overflowPages}`);
console.log(`  ক্লিপ-হওয়া কনটেন্ট  : ${s.clippedPages}`);
console.log(`  ঢাকা-পড়া কন্ট্রোল   : ${s.coveredPages}`);
console.log(`  ভাসমান সংঘর্ষ       : ${s.floatOverlapPages}`);
console.log(`  ছোট ট্যাপ-টার্গেট   : ${s.smallTapPages}`);
console.log(`  iOS জুম ইনপুট       : ${s.zoomInputPages}`);
console.log(`  বটম-বার reserve কম  : ${s.bottomShortPages}`);
console.log(`  কনসোল ত্রুটি        : ${s.consoleErrorPages}`);
console.log(`  ব্যর্থ অনুরোধ        : ${s.failedRequestPages}`);
console.log(`  পাতা লোডই হয়নি      : ${s.didNotLoadPages}  (সার্ভার/নেটওয়ার্ক — UI-কাউন্টার থেকে বাদ)`);
console.log(`  বাতিল অনুরোধ        : ${s.abortedRequestPages}  (নিরীহ — prefetch/ফন্ট, ব্রাউজারই ছেড়ে দেয়)`);
console.log(`  অমীমাংসিত মাপ       : ${s.notSettled}`);
console.log(`  রুট-কভারেজ          : ${report.coverage.covered}/${report.coverage.discovered}` +
  (report.coverage.uncovered.length ? `  ✗ অ-মাপা: ${report.coverage.uncovered.join(', ')}` : ''));
console.log(`  → ${OUT}`);
