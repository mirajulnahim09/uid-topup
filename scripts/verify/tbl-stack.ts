/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ `.tbl--stack` — লক্ষ্যভিত্তিক ব্রাউজার যাচাই
 *
 *   কেবল সেই তিনটি পাতা যেগুলো এই কাজে বদলেছে:
 *     · /admin/logs                 (১টি টেবিল)
 *     · /admin/users/[id]           (৩টি টেবিল + রিসেলার-কী)
 *     · /account                    (খতিয়ান)
 *
 *   ⚠️ এটি একটি **অডিট নয়** — নতুন কিছু খোঁজে না। এটি কেবল প্রশ্ন
 *      করে: যে দাবিগুলো করা হয়েছে সেগুলো আসল ডেটায় সত্যি কি না।
 *
 *   কী মাপা হয় (প্রতি পাতা × প্রতি প্রস্থ):
 *     ১. অনুভূমিক ওভারফ্লো — `trueScrollWidth` (নিচে ব্যাখ্যা) +
 *        জ্যামিতিক ওভারহ্যাং, দুটোই
 *     ২. স্ট্যাক-মোড ঠিক জায়গায় চালু/বন্ধ (<৭৬৮px → কার্ড, ≥৭৬৮px →
 *        অপরিবর্তিত ডেস্কটপ টেবিল)
 *     ৩. প্রতিটি `<td data-label>` এর লেবেল আসলে রেন্ডার হচ্ছে
 *     ৪. লম্বা TrxID ও লম্বা নাম কার্ডের ভিতরে থাকছে
 *     ৫. খালি অবস্থা দৃশ্যমান, কেন্দ্রে, পর্দার ভিতরে
 *     ৬. সারি-সংখ্যা (পাতার নিজস্ব সীমা মানা হচ্ছে কি না)
 *     ৭. কনসোল ত্রুটি ও ব্যর্থ অনুরোধ
 *
 *   ⚠️⚠️ `document.documentElement.scrollWidth` **একা যথেষ্ট নয়**:
 *      `globals.css` এ `body { overflow-x:hidden }` আছে, তাই ভিউপোর্ট
 *      নিজেই overflow লুকায় আর scrollWidth কখনো clientWidth ছাড়ায় না।
 *      তাই মাপার সময় `html/body` এর overflow-x সাময়িকভাবে `visible`
 *      করে আসল নথি-প্রস্থ নেওয়া হয়, তারপর ফিরিয়ে দেওয়া হয়।
 *      (এই কৌশলটি `scripts/audit/mobile-ux-audit.mjs` থেকে নেওয়া।)
 *
 *   চালানো:
 *     npx tsx scripts/verify/_fixture-tbl-stack.ts   # আগে একবার
 *     npx tsx scripts/verify/tbl-stack.ts
 * ═══════════════════════════════════════════════════════════
 */
import { db, BASE, dbLabel } from './_db';
import { chromium, type Page } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';
import { writeFileSync } from 'node:fs';

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
].find(existsSync);
if (!CHROME) throw new Error('Chrome পাওয়া যায়নি');

const SHOT_DIR = 'audit/shots/tbl-stack';
mkdirSync(SHOT_DIR, { recursive: true });

/** ব্যবহারকারীর দেওয়া প্রস্থ-তালিকা — মোবাইল থেকে ল্যাপটপ */
const WIDTHS = [320, 390, 430, 768, 1024, 1366];
/** ★ যে সীমায় স্ট্যাক-মোড চালু (globals.css: max-width:767px) */
const STACK_MAX = 767;

const ADMIN = { email: 'admin@uidtopup.local', password: 'Admin@2026Secure' };
const HEAVY = { email: 'tblstack.heavy@dev.local', password: 'Customer@2026Secure' };

type Finding = { where: string; what: string; detail: unknown };
const findings: Finding[] = [];
const results: Record<string, unknown>[] = [];
function fail(where: string, what: string, detail: unknown) {
  findings.push({ where, what, detail });
}

/** পাতা স্থির হওয়া পর্যন্ত অপেক্ষা — বুট-স্ক্রিন সরা সহ */
async function settle(page: Page) {
  await page.waitForFunction(`!document.getElementById('v-boot')`, null, { timeout: 30000 }).catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(350);
}

async function login(page: Page, who: { email: string; password: string }) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await settle(page);
  // ★ id দিয়ে — ফর্মে `name` অ্যাট্রিবিউট নেই (নিয়ন্ত্রিত React ইনপুট)
  await page.fill('#email', who.email);
  await page.fill('#pw', who.password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 }),
    page.click('button[type="submit"]'),
  ]);
  await settle(page);
}

type Measurement = {
  vw: number; stackExpected: boolean;
  rawScrollWidth: number; trueScrollWidth: number;
  geomOverflow: { sel: string; over: number; text: string }[];
  tables: { i: number; display: string; minWidth: string; rows: number; theadClipped: boolean; deskUnchanged: boolean | null }[];
  labelsRendered: number; labelsMissing: string[];
  cellOverflow: { label: string; over: number; text: string }[];
  emptyStates: { text: string; align: string; display: string; left: number; right: number; insideViewport: boolean }[];
  longestCellText: string;
  scrollHeight: number; innerHeight: number;
};

/**
 * এক পাতা × এক প্রস্থে সব মাপ।
 *
 * ⚠️ পুরোটাই **একটি** probe — কারণ প্রতিটি মাপ একই লেআউট অবস্থার
 *    উপর হতে হবে; মাঝপথে Playwright-এ ফিরলে পাতা বদলে যেতে পারে
 *    (image load, font swap) আর মাপগুলো পরস্পরবিরোধী হতো।
 *
 * ⚠️⚠️ probe টি **স্ট্রিং**, ফাংশন নয়, আর ভিতরে ES5 (`var`/`function`)।
 *    tsx/esbuild এর `keepNames` নামযুক্ত ফাংশনে `__name(...)` হেল্পার
 *    জুড়ে দেয়, যা ব্রাউজারে নেই → `__name is not defined`। এই
 *    কোডবেসে সেটি আগে ঘটেছে (`scripts/table-audit.ts`,
 *    `scripts/loading-test.ts` দ্রষ্টব্য) — এবং এই ফাইলেও একবার ঘটল।
 */
function probeSrc(vw: number, stackMax: number): string {
  return `(function () {
  var vw = ${vw}, stack = ${vw} <= ${stackMax};
  var out = {
    vw: vw, stackExpected: stack,
    rawScrollWidth: document.documentElement.scrollWidth,
    trueScrollWidth: 0, geomOverflow: [], tables: [],
    labelsRendered: 0, labelsMissing: [], cellOverflow: [],
    emptyStates: [], longestCellText: '',
    /* উল্লম্ব স্ক্রল আছে কি না — লম্বা তালিকা ফোনে গড়াতেই হবে */
    scrollHeight: document.documentElement.scrollHeight,
    innerHeight: window.innerHeight
  };

  /* ── ১. আসল নথি-প্রস্থ (overflow-x সাময়িকভাবে খুলে, তারপর ফেরত) ── */
  var h = document.documentElement, b = document.body;
  var hx = h.style.overflowX, bx = b.style.overflowX;
  h.style.overflowX = 'visible'; b.style.overflowX = 'visible';
  void h.offsetWidth;
  out.trueScrollWidth = h.scrollWidth;
  h.style.overflowX = hx; b.style.overflowX = bx;

  /* ── জ্যামিতিক ওভারহ্যাং ──
     thead বাদ: স্ট্যাক-মোডে সেটি sr-only (1px বাক্স + overflow:hidden
     + clip)। সন্তানেরা স্বাভাবিক মাপ রিপোর্ট করে, কিন্তু বাক্সটি ক্লিপ
     করে বলে পাতায় স্ক্রল তৈরি হয় না — trueScrollWidth সেটাই প্রমাণ
     করে। বাদ না দিলে প্রতিটি স্ট্যাক-টেবিল মিথ্যা ওভারফ্লো দেখাত। */
  var all = document.querySelectorAll('body *');
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    var cs = getComputedStyle(el);
    if (cs.position === 'fixed' || cs.display === 'none' || cs.visibility === 'hidden') continue;
    if (el.closest('thead')) continue;
    var r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right <= vw + 1) continue;
    /* নিজের স্ক্রল-কন্টেইনারে ঢাকা পড়া জিনিস ওভারফ্লো নয় */
    var p = el.parentElement, clipped = false;
    while (p) {
      var pcs = getComputedStyle(p);
      if (pcs.overflowX === 'auto' || pcs.overflowX === 'scroll' || pcs.overflowX === 'hidden') { clipped = true; break; }
      p = p.parentElement;
    }
    if (clipped) continue;
    var cls = (typeof el.className === 'string' && el.className) ? '.' + el.className.trim().split(/\\s+/).slice(0, 3).join('.') : '';
    out.geomOverflow.push({ sel: el.tagName.toLowerCase() + cls, over: Math.round(r.right - vw), text: (el.textContent || '').trim().slice(0, 40) });
  }

  /* ── ২. প্রতিটি .tbl--stack টেবিল ── */
  var tbls = document.querySelectorAll('table.tbl--stack');
  for (var t = 0; t < tbls.length; t++) {
    var tc = getComputedStyle(tbls[t]);
    var th = tbls[t].querySelector('thead');
    var thc = th ? getComputedStyle(th) : null;
    var clippedHead = !!thc && thc.position === 'absolute';
    out.tables.push({
      i: t, display: tc.display, minWidth: tc.minWidth,
      rows: tbls[t].querySelectorAll('tbody tr').length,
      theadClipped: clippedHead,
      /* ডেস্কটপে টেবিলটি হুবহু আগের মতোই থাকতে হবে */
      deskUnchanged: stack ? null : (tc.display === 'table' && !clippedHead)
    });
  }

  /* ── ৩. প্রতিটি লেবেল-যুক্ত সেল ── */
  var tds = document.querySelectorAll('td[data-label]');
  for (var d = 0; d < tds.length; d++) {
    var td = tds[d];
    var label = td.getAttribute('data-label') || '';
    var content = getComputedStyle(td, '::before').content;
    var has = !!content && content !== 'none' && content !== 'normal';
    if (stack) { if (has) out.labelsRendered++; else out.labelsMissing.push(label); }
    /* ডেস্কটপে লেবেল থাকা যাবে না — থাকলে টেবিল বদলে গেছে */
    else if (has) out.labelsMissing.push('DESKTOP-LEAK:' + label);

    var tr = td.closest('tr');
    var rowRight = tr ? tr.getBoundingClientRect().right : vw;
    var tr2 = td.getBoundingClientRect();
    if (tr2.right > rowRight + 1) out.cellOverflow.push({ label: label, over: Math.round(tr2.right - rowRight), text: (td.textContent || '').trim().slice(0, 30) });
    var txt = (td.textContent || '').trim();
    if (txt.length > out.longestCellText.length) out.longestCellText = txt;
  }

  /* ── ৪. খালি অবস্থা ── */
  var empties = document.querySelectorAll('table.tbl--stack tbody td[colspan]');
  for (var e = 0; e < empties.length; e++) {
    var ec = getComputedStyle(empties[e]);
    var er = empties[e].getBoundingClientRect();
    out.emptyStates.push({
      text: (empties[e].textContent || '').trim().slice(0, 40),
      align: ec.textAlign, display: ec.display,
      left: Math.round(er.left), right: Math.round(er.right),
      insideViewport: er.left >= -1 && er.right <= vw + 1
    });
  }

  return out;
})()`;
}

async function measure(page: Page, vw: number): Promise<Measurement> {
  return page.evaluate(probeSrc(vw, STACK_MAX)) as Promise<Measurement>;
}

async function main() {
  console.log(`সার্ভার: ${BASE}   ডাটাবেস: ${dbLabel()}\n`);

  const heavy = await db.user.findUnique({ where: { email: HEAVY.email }, select: { id: true, name: true } });
  const empty = await db.user.findUnique({ where: { email: 'tblstack.empty@dev.local' }, select: { id: true } });
  if (!heavy || !empty) throw new Error('ফিক্সচার নেই — আগে `npx tsx scripts/verify/_fixture-tbl-stack.ts` চালান');

  const browser = await chromium.launch({ headless: true, executablePath: CHROME });

  /** যে পাতাগুলো যাচাই হবে — কে দেখবে, আর সেখানে কী প্রমাণ করতে হবে */
  /**
   * ★ `rows` = পাতার নিজস্ব সীমা, কোডে যা লেখা আছে ঠিক তাই:
   *     /admin/logs             take: 300
   *     /admin/users/[id]       apiKeys(সব) · orders 25 · deposits 25 · ledger 40
   *     /account                ledger take: 20
   *   ⚠️ এই তিনটি পাতার **কোনোটিতেই pagination নেই** — সীমা পেরোলে
   *      পুরনো সারি কেবল দেখানো হয় না (লগে ফিল্টার-ফর্ম, বাকিতে কিছুই)।
   *      ডাটাবেসে ইচ্ছাকৃতভাবে সীমার **বেশি** সারি রাখা আছে (৩২৩ লগ,
   *      ৩০ অর্ডার, ৩০ ডিপোজিট, ৪৭ খতিয়ান), তাই সীমাটি সত্যিই
   *      পরীক্ষিত হয় — নাহলে "৩০০ সারি ঠিক আছে" কথাটার প্রমাণ থাকত না।
   */
  const PAGES = [
    { name: 'admin/logs', as: 'admin', url: '/admin/logs', expect: 'many', rows: [300] },
    { name: 'admin/logs?empty', as: 'admin', url: '/admin/logs?q=__কোনোমতেই_মিলবে_না__', expect: 'empty', rows: [1] },
    { name: 'admin/users/heavy', as: 'admin', url: `/admin/users/${heavy.id}`, expect: 'many', rows: [2, 25, 25, 40] },
    { name: 'admin/users/empty', as: 'admin', url: `/admin/users/${empty.id}`, expect: 'empty', rows: [] },
    { name: 'account/ledger', as: 'customer', url: '/account', expect: 'many', rows: [20] },
  ];

  for (const who of ['admin', 'customer'] as const) {
    const creds = who === 'admin' ? ADMIN : HEAVY;
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, ignoreHTTPSErrors: true,
    });
    const page = await ctx.newPage();
    const consoleErrors: string[] = [];
    const failedReqs: string[] = [];
    const mutations: string[] = [];
    /** ★ কনসোলের "404" বার্তা কোন সম্পদের, তা নাম ধরে ধরা */
    const badResponses: string[] = [];
    page.on('response', (r) => { if (r.status() >= 400) badResponses.push(`${r.status()} ${r.url().slice(0, 150)}`); });
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const t = m.text();
      /**
       * ⚠️ **যাচাই-পরিবেশের একমাত্র উপেক্ষিত কনসোল-ত্রুটি**: service
       *   worker নিবন্ধন। স্ব-স্বাক্ষরিত সার্টিফিকেটে Chrome SW
       *   নিবন্ধন করতে অস্বীকার করে (`ignoreHTTPSErrors` নেভিগেশনে
       *   কাজ করে, SW-এ নয়) — বার্তাটি হুবহু এটিই। `PWA.tsx` এই
       *   নিবন্ধন `.catch(() => {})` দিয়ে ঘিরে রেখেছে, তাই ব্যর্থ
       *   হলেও অ্যাপ স্বাভাবিক চলে; আসল ডোমেইনে বৈধ সার্টিফিকেট
       *   থাকায় সেখানে ঘটেই না।
       *   ★ নিয়ম ও যুক্তি হুবহু `scripts/verify/prod-auth-e2e.ts`
       *     থেকে — একই রিগ, একই কোলাহল, একই সিদ্ধান্ত।
       */
      if (/SSL certificate error occurred when fetching the script/i.test(t)) return;
      /**
       * ⚠️ **বাতিল-হওয়া RSC prefetch এর কনসোল-প্রতিরূপ।**
       *
       *   নিচের `requestfailed` হ্যান্ডলার `ERR_ABORTED` কে ইতিমধ্যেই
       *   ছাড় দেয় (হারনেস দ্রুত নেভিগেট করায় prefetch বাতিল হয়)।
       *   কিন্তু ঠিক সেই একই ঘটনার **কনসোল** বার্তাটি ছাড় পেত না —
       *   অর্থাৎ একই ফাইলে নেটওয়ার্ক-দিক নিরীহ, কনসোল-দিক ত্রুটি।
       *   ফল: মাপা ফ্লেকি — ৩ রানে ২ বার মিথ্যা লাল (২০২৬-০৮-৩১)।
       *
       *   বার্তাটি নিজেই বলে দেয় Next **নিজে সেরে উঠেছে**
       *   ("Falling back to browser navigation"), আর পাতার প্রতিটি
       *   টেবিল-দাবি ঐ রানগুলোতেও পাস করেছে।
       *
       *   ছাড়টি **সংকীর্ণ** — হুবহু এই দুটি বাক্য একসাথে থাকতে হবে।
       *   সার্ভার সত্যিই ভাঙলে fallback নেভিগেশনও ব্যর্থ হতো এবং
       *   টেবিল-দাবিগুলোই লাল হতো। নিয়ম ও যুক্তি হুবহু
       *   `scripts/audit/mobile-ux-audit.mjs` থেকে — একই ঘটনা, একই সিদ্ধান্ত।
       */
      if (/Failed to fetch RSC payload[\s\S]*Falling back to browser navigation/.test(t)) return;
      consoleErrors.push(t.slice(0, 200));
    });
    page.on('requestfailed', (r) => {
      /**
       * ⚠️ ব্রাউজারের **নিজের বাতিল করা** অনুরোধ ত্রুটি নয়। App Router
       *   `<Link>` দেখা মাত্র RSC পে-লোড ও রুট-চাঙ্ক prefetch করে;
       *   হারনেস পরের পাতায় গেলে সেগুলো abort হয় → `net::ERR_ABORTED`।
       *   এটিকে ব্যর্থতা ধরলে প্রতিটি রানই মিথ্যা লাল হতো (কমিট
       *   b7533fc-এ ঠিক এই বিভ্রান্তিই একবার হয়েছিল)।
       *   ★ `prod-auth-e2e.ts` এর সাথে একই নিয়ম — ERR_ABORTED বাদ,
       *     বাকি প্রতিটি নেটওয়ার্ক ব্যর্থতা রিপোর্ট হয়।
       */
      const e = r.failure()?.errorText || '';
      if (!/ERR_ABORTED|NS_BINDING_ABORTED/.test(e)) failedReqs.push(`${r.url().slice(0, 120)} :: ${e}`);
    });
    /**
     * ★★★ "কোনো ব্যবসায়িক যুক্তি বা মিউটেশন প্রভাবিত হয়নি" — এটি
     *   দাবি নয়, মাপা হয়। পাতা কেবল **দেখা** হচ্ছে, তাই লগইন ছাড়া
     *   একটিও অ-GET অনুরোধ যাওয়ার কথা নয়।
     */
    page.on('request', (r) => {
      const m = r.method();
      if (m === 'GET' || m === 'HEAD') return;
      if (r.url().includes('/api/auth/')) return;   // ★ কেবল লগইন
      mutations.push(`${m} ${r.url().slice(0, 120)}`);
    });

    await login(page, creds);

    /**
     * ★★★ সেশন সত্যিই আছে কি না — এবং কোন **মোডে**।
     *
     *   ⚠️ কেবল "পাতা খুলেছে" যথেষ্ট প্রমাণ নয়। প্রোডাকশন বিল্ডে কুকির
     *      নাম `__Secure-next-auth.session-token` ও তাতে `Secure` থাকে;
     *      ব্রাউজার সেটি **শুধু https** এ রাখে। তাই এই দাবিটি একই সাথে
     *      দুটো জিনিস প্রমাণ করে: (ক) লগইন/সেশন কাজ করছে, আর (খ)
     *      যাচাইটি সত্যিই প্রোডাকশন রানটাইমের বিরুদ্ধে চলছে, ভুল করে
     *      `next dev` এ নয়।
     */
    const cookies = await ctx.cookies();
    const sess = cookies.find((c) => /next-auth\.session-token$/.test(c.name));
    const isHttps = BASE.startsWith('https://');
    if (!sess) fail(who, 'সেশন কুকি পাওয়া যায়নি', cookies.map((c) => c.name));
    else {
      const wantSecure = isHttps;
      if (wantSecure && (!sess.name.startsWith('__Secure-') || !sess.secure)) {
        fail(who, 'প্রোডাকশন সেশন কুকি নিরাপদ নয়', { name: sess.name, secure: sess.secure });
      }
      if (!sess.httpOnly) fail(who, 'সেশন কুকি httpOnly নয়', { name: sess.name });
      console.log(`✓ লগইন: ${who} — কুকি ${sess.name} (secure=${sess.secure}, httpOnly=${sess.httpOnly})`);
    }

    for (const P of PAGES.filter((p) => p.as === who)) {
      for (const vw of WIDTHS) {
        await page.setViewportSize({ width: vw, height: 900 });
        await page.goto(BASE + P.url, { waitUntil: 'domcontentloaded' });
        await settle(page);
        const m = await measure(page, vw);
        const key = `${P.name} @${vw}`;

        // ── অনুভূমিক ওভারফ্লো ──
        if (m.trueScrollWidth > vw + 1) fail(key, 'অনুভূমিক ওভারফ্লো', { true: m.trueScrollWidth, vw });
        if (m.geomOverflow.length) fail(key, 'এলিমেন্ট ভিউপোর্ট ছাড়িয়েছে', m.geomOverflow.slice(0, 4));

        // ── স্ট্যাক-মোড ──
        for (const t of m.tables) {
          if (m.vw <= STACK_MAX) {
            if (t.display !== 'block') fail(key, `টেবিল ${t.i} স্ট্যাক হয়নি`, t);
            if (!t.theadClipped) fail(key, `টেবিল ${t.i} এর thead লুকায়নি`, t);
          } else {
            if (t.deskUnchanged !== true) fail(key, `টেবিল ${t.i} ডেস্কটপে বদলে গেছে`, t);
          }
        }

        // ── লেবেল ──
        if (m.labelsMissing.length) fail(key, 'লেবেল সমস্যা', m.labelsMissing.slice(0, 6));

        // ── সেল কার্ড ছাড়ালো? ──
        if (m.cellOverflow.length) fail(key, 'সেল কার্ডের বাইরে', m.cellOverflow.slice(0, 4));

        // ── সারি-সংখ্যা: পাতার সীমা মানা হচ্ছে, আর প্রস্থভেদে বদলায় না ──
        const got = m.tables.map((t) => t.rows);
        if (JSON.stringify(got) !== JSON.stringify(P.rows)) {
          fail(key, 'সারি-সংখ্যা প্রত্যাশার সাথে মেলেনি', { got, want: P.rows });
        }

        // ── স্ক্রল: উল্লম্ব চলে, অনুভূমিক নয় ──
        //   ⚠️ লম্বা তালিকা ভিউপোর্টের চেয়ে উঁচু না হলে বুঝতে হবে
        //      সারিগুলো রেন্ডারই হয়নি — অর্থাৎ যাচাইটাই ফাঁপা।
        if (P.expect === 'many' && m.scrollHeight <= m.innerHeight) {
          fail(key, 'পাতা ভিউপোর্টের চেয়ে উঁচু নয় — সারি রেন্ডার হয়েছে তো?', { scrollHeight: m.scrollHeight, innerHeight: m.innerHeight });
        }

        // ── খালি অবস্থা ──
        if (P.expect === 'empty') {
          const bad = m.emptyStates.filter((e) => !e.insideViewport || (m.vw <= STACK_MAX && e.align !== 'center'));
          if (m.emptyStates.length === 0 && P.name.includes('logs')) fail(key, 'খালি অবস্থার সারি পাওয়া যায়নি', m.emptyStates);
          if (bad.length) fail(key, 'খালি অবস্থা ভুল জায়গায়', bad);
        }

        // ⚠️ `vw` আলাদা করে দেওয়া হয় না — `m` এর ভিতরেই আছে, আর
        //    দুবার লিখলে TS2783 (একটি আরেকটিকে ঢেকে দিত)।
        results.push({ page: P.name, ...m, geomOverflow: m.geomOverflow.slice(0, 3) });
        const flag = m.trueScrollWidth <= vw + 1 ? '✓' : '✗';
        console.log(
          `  ${flag} ${P.name.padEnd(22)} ${String(vw).padStart(5)}px  ` +
          `true=${m.trueScrollWidth}  টেবিল=${m.tables.length}  লেবেল=${m.labelsRendered}  খালি=${m.emptyStates.length}`,
        );

        if ([320, 390, 768, 1366].includes(vw)) {
          await page.screenshot({ path: `${SHOT_DIR}/${P.name.replace(/[^\w]/g, '_')}-${vw}.png`, fullPage: true });
        }
      }
    }

    if (badResponses.length) fail(who, '4xx/5xx উত্তর', [...new Set(badResponses)].slice(0, 6));
    if (consoleErrors.length) fail(who, 'কনসোল ত্রুটি', [...new Set(consoleErrors)].slice(0, 4));
    if (failedReqs.length) fail(who, 'ব্যর্থ অনুরোধ', [...new Set(failedReqs)].slice(0, 4));
    if (mutations.length) fail(who, 'পাতা দেখার সময় মিউটেশন গেছে', [...new Set(mutations)].slice(0, 4));
    console.log(`  · ${who}: মিউটেশন=${mutations.length} · কনসোল ত্রুটি=${consoleErrors.length}`);
    await ctx.close();
  }

  await browser.close();

  // ── স্ক্রল যাচাই: লম্বা তালিকায় উল্লম্ব স্ক্রল কাজ করে, অনুভূমিক নয় ──
  writeFileSync('audit/tbl-stack.json', JSON.stringify({ at: new Date().toISOString(), base: BASE, results, findings }, null, 1));

  console.log('\n═══════════════════════════════════');
  if (findings.length === 0) {
    console.log('✓ সব যাচাই পাস — কোনো সমস্যা পাওয়া যায়নি');
  } else {
    console.log(`✗ ${findings.length}টি সমস্যা:\n`);
    for (const f of findings) console.log(`  · [${f.where}] ${f.what}\n    ${JSON.stringify(f.detail)}`);
  }
  console.log('\nবিস্তারিত: audit/tbl-stack.json   স্ক্রিনশট: ' + SHOT_DIR);
  process.exitCode = findings.length ? 1 : 0;
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
