/**
 * ★★★ লোডিং অভিজ্ঞতা টেস্ট — NOVA
 * `npx tsx scripts/loading-test.ts [--headless]`
 *
 * পুরনো `mascot-test.ts` এর স্থলাভিষিক্ত। এটি কেবল ম্যাসকট নয়,
 * **পুরো লোডিং স্থাপত্য** যাচাই করে:
 *   ১. একটিই ব্যবস্থা — পুরনো লোডারের কোনো চিহ্ন নেই
 *   ২. লগইন / লগআউট / থিম / রেসপন্সিভ — চারটিতেই পর্দা ঠিকঠাক
 *   ৩. অ্যানিমেশন compositor-only, ৬০ FPS
 *   ৪. ব্লার+ম্লান সত্যিই ঘটছে (পিক্সেল মেপে, শুধু CSS পড়ে নয়)
 *   ৫. কোনো ঘূর্ণায়মান স্পিনার নেই
 *
 * ⚠️ FPS **প্রোডাকশন বিল্ডে** মাপতে হবে (`next start`)। dev-এ HMR,
 *    source-map ও রি-কম্পাইল চলে — সেই সংখ্যা বাস্তব নয়।
 */
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { chromium, type Page, type BrowserContext } from 'playwright-core';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const BASE = process.env.LOADING_BASE || 'http://localhost:3000';
const HEADLESS = process.argv.includes('--headless');
const EMAIL = (process.env.ADMIN_EMAIL || '').trim().replace(/^["']|["']$/g, '');
const PASSWORD = (process.env.ADMIN_PASSWORD || '').trim().replace(/^["']|["']$/g, '');
const exe = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(existsSync);

const SHOTS = 'audit/loading';
mkdirSync(SHOTS, { recursive: true });

/**
 * ⚠️ **স্ট্রিং হিসেবে** পাঠাতে হয়, ফাংশন হিসেবে নয়। tsx/esbuild
 * ভেতরের নামযুক্ত ফাংশনে `__name(...)` হেল্পার জুড়ে দেয়; সেই কোড
 * ব্রাউজারে গেলে `__name is not defined` হয়ে ক্র্যাশ করে।
 */
const FPS_PROBE = `new Promise((resolve) => {
  var frames = 0;
  var t0 = performance.now();
  requestAnimationFrame(function step() {
    frames++;
    if (performance.now() - t0 < 2000) requestAnimationFrame(step);
    else resolve(Math.round((frames * 1000) / (performance.now() - t0)));
  });
})`;

const results: { name: string; ok: boolean; note: string }[] = [];
const check = (name: string, ok: boolean, note = '') => {
  results.push({ name, ok, note });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${note ? ` — ${note}` : ''}`);
};
const section = (t: string) => console.log(`\n═══ ${t} ═══`);

/* ─────────────────────────────────────────────────────────────
   ধাপ ০ — উৎস-কোড স্ক্যান (ব্রাউজার লাগে না)
   "একটিই লোডিং স্থাপত্য" দাবিটি DOM দেখে প্রমাণ করা যায় না;
   পুরনো ফাইল রয়ে গেলে সেগুলো কেবল *এই* পথে আসে না — কিন্তু
   থেকে যায় ও পরে আবার ব্যবহৃত হয়। তাই ফাইল-স্তরেই যাচাই।
   ───────────────────────────────────────────────────────────── */
function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|css)$/.test(f)) out.push(p);
  }
  return out;
}

/**
 * ⚠️ মন্তব্য বাদ দিয়ে কোড — নাহলে "আগে এখানে `MascotLoader` ছিল"
 * জাতীয় ব্যাখ্যামূলক মন্তব্যই লিগ্যাসি-রেফারেন্স হিসেবে ধরা পড়ত।
 * অথচ ঠিক ওই মন্তব্যগুলোই বলে দেয় **কেন** পুরনো কোড আর নেই — সেগুলো
 * সরানো মানে ইতিহাস মুছে ফেলা। তাই স্ক্যানারকেই কোড-সচেতন করা হলো।
 */
const codeOnly = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function sourceScan() {
  section('0. Single loading architecture (source scan)');
  const files = walk('src');

  const legacyFiles = [
    'src/components/fx/BrandedLoader.tsx',
    'src/components/fx/EnergyCore.tsx',
    'src/components/mascot/MascotLoader.tsx',
    'src/components/mascot/CatMascot.tsx',
    'src/components/mascot',
  ].filter(existsSync);
  check('legacy loader files deleted', legacyFiles.length === 0, legacyFiles.join(', '));

  const legacyRefs: string[] = [];
  const legacyCss: string[] = [];
  const spinners: string[] = [];
  for (const f of files) {
    const src = codeOnly(readFileSync(f, 'utf8'));
    if (/BrandedLoader|EnergyCore|MascotLoader|CatMascot|data-mascot-active|mascot-busy/.test(src)) legacyRefs.push(f);
    if (f.endsWith('.css') && /\.v-core|\.mascot-/.test(src)) legacyCss.push(f);
    if (/animate-spin/.test(src)) spinners.push(f);
  }
  check('no imports/refs to legacy loaders', legacyRefs.length === 0, legacyRefs.join(', '));
  check('no legacy loader CSS left', legacyCss.length === 0, legacyCss.join(', '));
  check('no Tailwind animate-spin anywhere', spinners.length === 0, spinners.join(', '));

  // পূর্ণপর্দা লোডিং স্তর ঠিক একটিই জায়গায় রেন্ডার হয়
  const ovlOwners = files.filter((f) => /className=\{?`?v-ovl/.test(codeOnly(readFileSync(f, 'utf8'))));
  check('exactly one component renders the fullscreen overlay',
    ovlOwners.length === 1, ovlOwners.join(', ') || 'none');

  // ম্যাসকটটি একটিই ফাইলে সংজ্ঞায়িত
  check('NovaCat + LoadingStage + InlinePulse are the only loading components',
    existsSync('src/components/loading/NovaCat.tsx')
    && existsSync('src/components/loading/LoadingStage.tsx')
    && readdirSync('src/components/loading').length === 3,
    readdirSync('src/components/loading').join(', '));
}

/** লগইন ফর্ম ভরে সাবমিট — নেভিগেশনের জন্য অপেক্ষা নয় */
async function fillAndSubmit(page: Page, pw = PASSWORD) {
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', pw);
  await page.click('button[type="submit"]');
}

/** প্রমাণীকরণ ইচ্ছাকৃতভাবে ধীর করা — নাহলে পর্দা মাপার আগেই চলে যায় */
async function holdAuth(page: Page, pattern = '**/api/auth/callback/**') {
  let release: (() => void) | null = null;
  await page.route(pattern, async (route) => {
    await new Promise<void>((res) => { release = res; setTimeout(res, 9000); });
    // ★ try/catch জরুরি — টেস্ট শেষে route নিষ্পত্তি হয়ে গেলে
    //   `continue()` "Route is already handled" ছুড়ত, আর সেটি
    //   unhandled rejection হয়ে পুরো রান ফেলে দিত।
    try { await route.continue(); } catch { /* ইতিমধ্যেই নিষ্পত্তি */ }
  });
  return () => { if (release) (release as () => void)(); };
}

async function waitForOverlay(page: Page, ms = 15000) {
  return page.waitForSelector('.v-ovl', { timeout: ms }).then(() => true).catch(() => false);
}

/**
 * ★ একটি এলাকার **প্রকৃত পিক্সেল**-কনট্রাস্ট (luminance std-dev)।
 *
 *   কেন দরকার: "পটভূমি ঢাকা পড়েছে" দাবিটি CSS পড়ে প্রমাণ করা যায় না।
 *   দুবার এমন হয়েছে যে `backdrop-filter` ও scrim-এর সব অ্যাসারশন পাশ
 *   করেছে, অথচ স্ক্রিনশটে লগইন ফর্ম দিব্যি পড়া যাচ্ছিল — কারণ হালকা
 *   থিমে সাদা পর্দার নিচে **কালো লেখা** টিকে থাকে। কনট্রাস্ট মাপলে
 *   সেটি সংখ্যায় ধরা পড়ে: ঢাকা পড়লে std-dev ধসে যায়।
 *
 *   ⚠️ কোনো ইমেজ-লাইব্রেরি নেই (sharp/pngjs কিছুই ইনস্টল করা নেই)।
 *   তাই স্ক্রিনশটটি data-URL হিসেবে **ব্রাউজারেই ফেরত পাঠানো হয়** —
 *   ব্রাউজার PNG ডিকোড করে, canvas এ আঁকে, `getImageData` পিক্সেল দেয়।
 */
async function regionContrast(page: Page, clip: { x: number; y: number; width: number; height: number }) {
  const png = (await page.screenshot({ clip })).toString('base64');
  return page.evaluate(`new Promise(function (res, rej) {
    var img = new Image();
    img.onerror = function () { rej(new Error('decode failed')); };
    img.onload = function () {
      var c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      var g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      var d = g.getImageData(0, 0, c.width, c.height).data;
      var n = d.length / 4, s = 0, q = 0;
      for (var i = 0; i < d.length; i += 4) {
        var l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        s += l; q += l * l;
      }
      var m = s / n;
      res(Math.sqrt(Math.max(0, q / n - m * m)));
    };
    img.src = 'data:image/png;base64,${png}';
  })`) as Promise<number>;
}

/** ম্যাসকটের বাইরের একটি এলাকা — উপরের নেভিগেশন স্ট্রিপ */
const STRIP = { x: 0, y: 0, width: 1280, height: 96 };

/** ম্যাসকটের মূল অংশগুলো সত্যিই আঁকা হয়েছে কি না */
async function checkParts(page: Page, tag: string) {
  const parts = ['.nv-svg', '.nv-head', '.nv-eyes', '.nv-tail', '.nv-paw', '.nv-dia', '.nv-body', '.nv-mark', '.nv-collar'];
  const missing: string[] = [];
  for (const p of parts) if ((await page.locator(`.v-ovl ${p}`).count()) === 0) missing.push(p);
  check(`${tag}: all mascot parts drawn`, missing.length === 0, missing.join(', ') || parts.length + ' parts');
}

async function main() {
  if (!exe) { console.log('FATAL: no browser found'); process.exit(1); }

  sourceScan();

  const { PrismaClient } = await import('@prisma/client');
  const p0 = new PrismaClient();
  await p0.$executeRawUnsafe('DELETE FROM "RateLimitBucket"').catch(() => {});
  await p0.$disconnect();

  const browser = await chromium.launch({ headless: HEADLESS, executablePath: exe, args: ['--window-size=1440,960'] });
  const newCtx = (o: Parameters<typeof browser.newContext>[0] = {}) =>
    browser.newContext({ viewport: { width: 1280, height: 860 }, ...o });

  try {
    /* ══════════ ১. বুট-পর্দা — JS ছাড়াই ══════════ */
    section('1. Boot screen (server-rendered, no JS)');
    const noJsCtx = await newCtx({ javaScriptEnabled: false });
    const noJs = await noJsCtx.newPage();
    await noJs.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
    check('boot screen exists without JS', (await noJs.locator('#v-boot').count()) === 1);
    check('boot screen shows the same mascot', (await noJs.locator('#v-boot .nv-svg').count()) === 1);
    check('boot screen has rotating messages', (await noJs.locator('#v-boot .nv-msg > span').count()) === 3);
    check('boot screen has no spinner', (await noJs.locator('#v-boot [class*="spin"]').count()) === 0);

    // ⚠️ "মার্কআপে আছে" আর "পর্দায় দেখা যাচ্ছে" এক নয়। প্রথম সংস্করণে
    //    কেবল উপস্থিতি যাচাই হচ্ছিল, আর স্ক্রিনশট নেওয়া হচ্ছিল
    //    fade-in (grace .18s + .28s) শেষ হওয়ার আগেই — ফলে ছবিতে
    //    বুট-পর্দা ছিলই না, অথচ সব অ্যাসারশন সবুজ। এই স্তরটির
    //    গোটা উদ্দেশ্যই JS চালুর **আগে** কিছু দেখানো, তাই সেটিই মাপা হয়।
    //    ⚠️ অপেক্ষার শর্তে **`position === 'fixed'`** থাকা অপরিহার্য।
    //    `domcontentloaded` স্টাইলশিট প্রয়োগের আগেই ফায়ার করতে পারে,
    //    আর স্টাইলবিহীন উপাদানের ডিফল্ট opacity **১** — তাই কেবল
    //    opacity দেখে অপেক্ষা করলে শর্তটি সাথে সাথেই সত্য হয়ে যেত এবং
    //    মাপা হতো CSS আসার **আগের** অবস্থা (`static`, ২৪১px উঁচু)।
    //    স্ক্রিনশট ঠিকই দেখাচ্ছিল, কারণ সেটি ~৫০ms পরে নেওয়া হতো।
    await noJs.waitForFunction(
      () => {
        const cs = getComputedStyle(document.getElementById('v-boot')!);
        return cs.position === 'fixed' && Number(cs.opacity) > 0.95;
      },
      undefined, { timeout: 8000 },
    ).catch(() => {});
    const boot = await noJs.locator('#v-boot').evaluate((el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const svg = el.querySelector('svg')!.getBoundingClientRect();
      return {
        opacity: Number(cs.opacity), pos: cs.position, z: cs.zIndex,
        w: Math.round(svg.width), rw: Math.round(r.width), rh: Math.round(r.height),
        vw: window.innerWidth, vh: window.innerHeight,
      };
    });
    // ⚠️ `innerWidth` স্ক্রলবারসহ, কিন্তু `position:fixed; inset:0` উপাদান
    //    স্ক্রলবার **বাদ দিয়ে** ভিউপোর্ট ঢাকে। JS বন্ধ থাকায় পাতাটি লম্বা
    //    স্কেলিটন দেখায় → উল্লম্ব স্ক্রলবার থাকে → ঠিক ~১৫px পার্থক্য।
    //    কড়া সমতা দাবি করলে সঠিক আচরণই ফেল করত।
    const covers = boot.rw >= boot.vw - 20 && boot.rh >= boot.vh - 20;
    check('boot screen is actually painted, not just present in markup',
      boot.opacity > 0.95 && boot.w > 100 && covers && boot.pos === 'fixed',
      `opacity ${boot.opacity.toFixed(2)} · ${boot.pos} z=${boot.z} · ${boot.rw}×${boot.rh} of ${boot.vw}×${boot.vh} · mascot ${boot.w}px`);
    await noJs.screenshot({ path: `${SHOTS}/boot-no-js.png` });
    await noJsCtx.close();

    /* ══════════ ২. নিষ্ক্রিয় অবস্থা ══════════ */
    section('2. Idle login page');
    const ctx = await newCtx();
    const page = await ctx.newPage();
    const errs: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    page.on('pageerror', (e) => errs.push(String(e)));

    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    check('no overlay while idle', (await page.locator('.v-ovl').count()) === 0);
    check('boot screen removed after hydration', (await page.locator('#v-boot').count()) === 0);
    check('form is interactive', await page.locator('button[type="submit"]').isEnabled());

    const baselineFps = (await page.evaluate(FPS_PROBE)) as number;
    console.log(`        baseline FPS (no overlay): ${baselineFps}`);

    // ফর্মের অবস্থান — পরে layout shift মাপার জন্য
    const beforeBox = await page.locator('form').boundingBox();

    // ★ ওভারলে ওঠার **আগে** দুই থিমেই পটভূমির কনট্রাস্ট রেকর্ড করি;
    //   পরে ওভারলে অবস্থায় একই এলাকা মেপে তুলনা করা হবে।
    const bareContrast: Record<string, number> = {};
    for (const theme of ['dark', 'light'] as const) {
      await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
      await page.waitForTimeout(400);
      bareContrast[theme] = await regionContrast(page, STRIP);
    }
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await page.waitForTimeout(300);
    console.log(`        bare nav-strip contrast — dark ${bareContrast.dark.toFixed(1)}, light ${bareContrast.light.toFixed(1)}`);

    /* ══════════ ৩. লগইন — পর্দা ওঠে ══════════ */
    section('3. LOGIN — overlay appears');
    const release = await holdAuth(page);
    await fillAndSubmit(page, 'definitely-wrong-password');
    const appeared = await waitForOverlay(page);
    check('overlay appears while authenticating', appeared);

    if (appeared) {
      check('exactly ONE overlay on screen', (await page.locator('.v-ovl').count()) === 1);
      await checkParts(page, 'login');

      /* ── layout shift ── */
      const afterBox = await page.locator('form').boundingBox();
      const dx = Math.abs((afterBox?.x ?? 0) - (beforeBox?.x ?? 0));
      const dy = Math.abs((afterBox?.y ?? 0) - (beforeBox?.y ?? 0));
      check('no layout shift when the overlay mounts', dx < 1 && dy < 1, `Δx=${dx.toFixed(1)} Δy=${dy.toFixed(1)}`);
      check('page scroll locked', await page.evaluate(() => getComputedStyle(document.body).overflow === 'hidden'));

      /* ── ব্লার ও ম্লান: CSS পড়া **এবং** পিক্সেল মাপা ── */
      const style = await page.locator('.v-ovl').evaluate((el) => {
        const cs = getComputedStyle(el);
        return {
          blur: cs.backdropFilter || (cs as unknown as { webkitBackdropFilter: string }).webkitBackdropFilter,
          bg: cs.backgroundImage !== 'none' || cs.backgroundColor !== 'rgba(0, 0, 0, 0)',
          pos: cs.position, z: cs.zIndex,
        };
      });
      check('backdrop is blurred', /blur\((\d+)/.test(style.blur), style.blur);
      check('backdrop is dimmed/scrimmed', style.bg);
      check('overlay covers the viewport', style.pos === 'fixed' && Number(style.z) >= 120, `z=${style.z}`);

      const hitsOverlay = await page.evaluate(() => {
        const el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight * 0.85);
        return Boolean(el?.closest('.v-ovl'));
      });
      check('clicks hit the overlay, not the form beneath', hitsOverlay);

      /* ── পটভূমি স্থির — ৬০ FPS-এর মূল শর্ত ── */
      const frozen = await page.evaluate(() => ({
        canvas: Array.from(document.querySelectorAll('.site-bg canvas'))
          .every((c) => getComputedStyle(c).display === 'none'),
        count: document.querySelectorAll('.site-bg canvas').length,
      }));
      check('animated background frozen behind the blur',
        frozen.count > 0 && frozen.canvas, `${frozen.count} canvas, hidden=${frozen.canvas}`);

      /* ── বার্তা ──
         ⚠️ "একটি বার্তা দেখা যাচ্ছে" যথেষ্ট প্রমাণ নয়। প্রথম রানে
         লগইনের সময় একটি **স্থির** লেবেল দেখাচ্ছিল আর ঘূর্ণায়মান
         বার্তাগুলো কেবল বুট-পর্দায় চলছিল — অথচ চাহিদা ছিল ঠিক
         উল্টোটা। তাই এখানে স্পষ্টভাবে ঘূর্ণনই যাচাই করা হয়। */
      const msgs = await page.locator('.v-ovl .nv-msg > span').allTextContents();
      check('login overlay rotates premium status messages', msgs.length === 3,
        msgs.join(' / ').slice(0, 110));
      check('messages are not generic "Loading…"',
        msgs.every((m) => !/^লোড হচ্ছে…?$|^Loading…?\.*$/i.test(m.trim())));

      // ক্রস-ফেড: একই মুহূর্তে ঠিক একটি বার্তা দৃশ্যমান, এবং সময়ের
      // সাথে দৃশ্যমান বার্তাটি বদলায়
      // ⚠️ একবার নমুনা নেওয়া যথেষ্ট নয়: ক্রস-ফেডের ফাঁক এক পলকের,
      //    তাই একটি নমুনা সহজেই সেটি এড়িয়ে যেতে পারত। ৪.৫ সেকেন্ড
      //    ধরে বারবার দেখা হয় — কোনো নমুনাতেই পর্দা বার্তাশূন্য নয়,
      //    এবং সময়ের সাথে বার্তা বদলায়।
      const READ_VISIBLE = `Array.from(document.querySelectorAll('.v-ovl .nv-msg > span'))
        .filter(function (s) { return Number(getComputedStyle(s).opacity) > 0.06; })
        .map(function (s) { return s.textContent; })`;
      // ⚠️ ওভারলের নিজস্ব প্রবেশ-অ্যানিমেশন (.26s) শেষ হতে দিতে হয়।
      //    আগে সাথে সাথেই নমুনা নেওয়ায় প্রথম নমুনাটি প্রতিবার "ফাঁকা"
      //    আসত — কিন্তু ওই মুহূর্তে গোটা পর্দাই ফুটে উঠছে, বার্তা
      //    হারিয়ে যায়নি। টাইমলাইন মেপে দেখা গেছে ~২৬০ms এর পর আর
      //    কোথাও ফাঁক নেই; এই অ্যাসারশন স্থিতিশীল অবস্থার জন্য।
      await page.waitForTimeout(700);
      const samples: string[][] = [];
      for (let i = 0; i < 10; i++) {
        samples.push((await page.evaluate(READ_VISIBLE)) as string[]);
        await page.waitForTimeout(450);
      }
      const blankAt = samples.map((s, i) => (s.length === 0 ? i : -1)).filter((i) => i >= 0);
      check('a message is on screen at every moment (no blank gap)',
        blankAt.length === 0, `blank at sample ${blankAt.join(',') || 'none'} of ${samples.length}`);
      check('at most two messages overlap (a fade, not a pile-up)',
        samples.every((s) => s.length <= 2), `max ${Math.max(...samples.map((s) => s.length))}`);
      const seen = new Set(samples.flat());
      check('the message actually rotates over time', seen.size >= 2,
        `${seen.size} distinct messages seen in 4.5s`);

      check('no percentage counter', !/%/.test((await page.locator('.v-ovl').textContent()) ?? ''));

      /* ── a11y ── */
      const a11y = await page.locator('.v-ovl').evaluate((el) => ({
        role: el.getAttribute('role'), live: el.getAttribute('aria-live'), busy: el.getAttribute('aria-busy'),
        svgHidden: el.querySelector('svg')?.getAttribute('aria-hidden'),
      }));
      check('announces itself (role=status, aria-live, aria-busy)',
        a11y.role === 'status' && a11y.live === 'polite' && a11y.busy === 'true');
      check('decorative SVG hidden from screen readers', a11y.svgHidden === 'true');

      /* ══════════ ৪. অ্যানিমেশনের গুণমান ══════════ */
      section('4. Animation quality');
      const anims = await page.evaluate(() => {
        const out: { name: string; props: string[]; dur: number }[] = [];
        document.getAnimations().forEach((a) => {
          if (a.constructor.name !== 'CSSAnimation') return;
          const name = (a as unknown as { animationName?: string }).animationName ?? '';
          if (!name.startsWith('nv-')) return;
          const props = new Set<string>();
          for (const f of (a.effect as KeyframeEffect)?.getKeyframes?.() ?? []) {
            for (const k of Object.keys(f)) {
              if (!['offset', 'computedOffset', 'easing', 'composite'].includes(k)) props.add(k);
            }
          }
          out.push({ name, props: [...props], dur: Number(a.effect?.getTiming().duration ?? 0) });
        });
        return out;
      });
      const names = [...new Set(anims.map((a) => a.name))];
      check('rich animation loop running', anims.length >= 14, `${anims.length} animations, ${names.length} distinct`);

      const bad = [...new Set(anims.flatMap((a) => a.props))].filter((p) => !['transform', 'opacity'].includes(p));
      check('ALL animations are compositor-only (transform/opacity)', bad.length === 0, bad.join(', ') || 'transform, opacity');

      // চাহিদাপত্রের প্রতিটি গতি সত্যিই আছে কি না
      const required: [string, string][] = [
        ['nv-blink', 'eye blinking'], ['nv-ear-l', 'ear twitch'], ['nv-tail', 'tail movement'],
        ['nv-head', 'head movement'], ['nv-paw', 'paw movement'], ['nv-breathe', 'breathing'],
        ['nv-body', 'idle body motion'], ['nv-pupil', 'looking around'], ['nv-happy', 'happy reaction'],
        ['nv-dia', 'diamond travel'], ['nv-trail', 'particle trail'], ['nv-spark', 'spark effect'],
        ['nv-mote', 'floating particles'], ['nv-dia-bloom', 'soft glow'], ['nv-dia-streak', 'motion blur'],
        ['nv-shadow', 'ambient shadow'],
        // ★ ব্র্যান্ড-পরিশোধের বীটগুলো — এগুলোই দৃশ্যটিকে এই
        //   প্ল্যাটফর্মের করে তোলে, তাই আলাদা করে পাহারা দেওয়া হয়
        ['nv-mark', 'brand mark reacts'], ['nv-mark-lit', 'mark ignites'],
        ['nv-shock', 'shockwave'], ['nv-burst', 'impact rays'],
        ['nv-bolt', 'bolt flicker'], ['nv-tag', 'brand collar tag swings'],
        ['nv-grid', 'stage grid responds'], ['nv-hud', 'HUD frame'],
      ];
      const absent = required.filter(([k]) => !names.includes(k)).map(([, d]) => d);
      check('every requested behaviour is present', absent.length === 0, absent.join(', ') || `${required.length}/${required.length}`);

      // লুপ ধরা পড়ে না — সময়কালগুলো আলাদা
      const durations = [...new Set(anims.map((a) => Math.round(a.dur)))].sort((a, b) => a - b);
      check('loop lengths are deliberately unequal', durations.length >= 6, `${durations.join('ms, ')}ms`);

      // কোনো ঘূর্ণায়মান স্পিনার নয়
      const spin = await page.evaluate(() => {
        let found = '';
        document.querySelectorAll('.v-ovl *').forEach((el) => {
          el.getAnimations().forEach((a) => {
            const n = (a as unknown as { animationName?: string }).animationName ?? '';
            const kf = (a.effect as KeyframeEffect)?.getKeyframes?.() ?? [];
            const full = kf.some((f) => /rotate\(-?3[0-6]\d(\.\d+)?deg\)/.test(String(f.transform ?? '')));
            // গোলকের কক্ষপথ (বলয় ও কণা) গ্রহণযোগ্য — ওগুলো দৃশ্যের অংশ,
            // অগ্রগতির ইঙ্গিত নয়। নিষিদ্ধ কেবল "বৃত্তাকার লোডার"।
            if (full && n !== 'nv-ring' && n !== 'nv-sat') found = n;
          });
        });
        return found;
      });
      check('NO rotating spinner in the loading screen', spin === '', spin);

      /* ── গোলক কি চক্রের সবচেয়ে দূরের বিন্দুতেও ভেতরে থাকে? ──
         স্থির অবস্থায় সব ঠিক দেখায় — কাটা পড়া কেবল মাঝ-অ্যানিমেশনে
         ধরা পড়ে। তাই অ্যানিমেশন থামিয়ে ৫২% এ নিয়ে মাপি। */
      const orbExtreme = await page.locator('.v-ovl .nv-dia').evaluate((el) => {
        const anims = el.getAnimations();
        const prev = anims.map((a) => a.currentTime);
        anims.forEach((a) => { a.pause(); a.currentTime = Number(a.effect?.getTiming().duration ?? 5200) * 0.43; });
        const b = el.getBoundingClientRect();
        const svg = (el.closest('svg') as SVGElement).getBoundingClientRect();
        const out = { over: Math.round(b.right - svg.right), up: Math.round(svg.top - b.top) };
        anims.forEach((a, i) => { a.currentTime = prev[i]; a.play(); });
        return out;
      });
      check('diamond never clipped at its farthest point',
        orbExtreme.over <= 1 && orbExtreme.up <= 1, `right overhang ${orbExtreme.over}px, top ${orbExtreme.up}px`);

      /* ── FPS (প্রোডাকশন বিল্ড, headless = CPU raster = সবচেয়ে খারাপ) ── */
      const fps = (await page.evaluate(FPS_PROBE)) as number;
      check('sustains 60 FPS with the overlay up', fps >= 55, `${fps} FPS (baseline was ${baselineFps})`);

      /* ══════════ ৫. থিম ══════════
         ⚠️ থিম **স্পষ্টভাবে** সেট করতে হয়। প্রথম রানে ধরে নেওয়া
         হয়েছিল ডিফল্ট গাঢ়; কিন্তু headless Chromium এর
         `prefers-color-scheme` হালকা, তাই "dark" স্ক্রিনশটটি আসলে
         হালকা থিমের ছিল এবং তুলনাটি হালকা↔হালকা হয়ে যাচ্ছিল। */
      section('5. Theme switching');

      /**
       * টেক্সট ও পর্দার উজ্জ্বলতার পার্থক্য।
       * ⚠️ **স্ট্রিং হিসেবে** — ভেতরে নামযুক্ত ফাংশন (`parse`, `lum`)
       * থাকায় tsx/esbuild `__name(...)` জুড়ে দিত ও ব্রাউজারে
       * `__name is not defined` হয়ে ক্র্যাশ করত (এখানে ঠিক তাই ঘটেছিল)।
       */
      // ⚠️ Chrome `color-mix()` এর ফল ফেরত দেয় `color(srgb r g b / a)`
      //    ফরম্যাটে, যেখানে উপাদানগুলো **০–১**; সাধারণ রঙ ফেরত আসে
      //    `rgb(r g b)` হিসেবে, যেখানে **০–২৫৫**। প্রথম সংস্করণে সবসময়
      //    ২৫৫ দিয়ে ভাগ করা হচ্ছিল, ফলে scrim এর উজ্জ্বলতা ০.৯৫ এর
      //    বদলে ০.০০৪ আসত — এবং হালকা থিম মিথ্যাভাবে ফেল করছিল।
      const LEGIBILITY_PROBE = `(() => {
        var p = document.querySelector('.v-ovl .v-dsp');
        var ovl = document.querySelector('.v-ovl');
        var lum = function (s) {
          var n = (s.match(/[\\d.]+/g) || []).slice(0, 3).map(Number);
          var d = s.indexOf('color(') === 0 ? 1 : 255;
          return (0.2126 * n[0] + 0.7152 * n[1] + 0.0722 * n[2]) / d;
        };
        var bgc = getComputedStyle(ovl).backgroundColor;
        return { gap: Math.abs(lum(getComputedStyle(p).color) - lum(bgc)), bgc: bgc };
      })()`;

      const perTheme: Record<string, { gap: number; bgc: string }> = {};
      for (const theme of ['dark', 'light'] as const) {
        await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
        await page.waitForTimeout(450);
        await page.screenshot({ path: `${SHOTS}/login-${theme}.png` });
        perTheme[theme] = await page.evaluate(LEGIBILITY_PROBE) as { gap: number; bgc: string };
        check(`${theme} theme: message stays legible over the scrim`,
          perTheme[theme].gap > 0.35, `luminance gap ${perTheme[theme].gap.toFixed(2)}`);

        // ★ পিক্সেল-প্রমাণ: পটভূমি সত্যিই ঢাকা পড়েছে কি না
        const covered = await regionContrast(page, STRIP);
        const ratio = covered / bareContrast[theme];
        check(`${theme} theme: page behind is genuinely obscured`,
          ratio < 0.3,
          `nav-strip contrast ${bareContrast[theme].toFixed(1)} → ${covered.toFixed(1)} (${(ratio * 100).toFixed(0)}% left)`);
      }
      check('scrim actually changes with the theme', perTheme.dark.bgc !== perTheme.light.bgc,
        `${perTheme.dark.bgc} → ${perTheme.light.bgc}`);
      await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
      await page.waitForTimeout(300);
    }

    /* ══════════ ৬. ব্যর্থতার পর সরে যায় ══════════ */
    section('6. Fades out after failure');
    release();
    const gone = await page.waitForSelector('.v-ovl', { state: 'detached', timeout: 15000 })
      .then(() => true).catch(() => false);
    check('overlay removed after failed login', gone);
    check('scroll lock released', await page.evaluate(() => getComputedStyle(document.body).overflow !== 'hidden'));
    check('form usable again', await page.locator('button[type="submit"]').isEnabled());
    check('no console errors', errs.filter((e) => !/401|favicon|Failed to load resource/i.test(e)).length === 0,
      errs.slice(0, 1).join(' | '));
    await ctx.close();

    /* ══════════ ৭. সফল লগইন + লগআউট ══════════ */
    section('7. Successful login → logout');
    const ctx2 = await newCtx();
    const page2 = await ctx2.newPage();
    await page2.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    await page2.waitForTimeout(600);
    await fillAndSubmit(page2);
    const onLogin = await waitForOverlay(page2, 12000);
    check('overlay shows on successful login', onLogin);
    // ঝলকানি নয় — নেভিগেশন শেষ হওয়া পর্যন্ত থাকে
    await page2.waitForTimeout(1000);
    check('no flash-off before the redirect lands',
      (await page2.locator('.v-ovl').count()) > 0 || !page2.url().includes('/login'),
      page2.url().replace(BASE, ''));
    await page2.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 20000 }).catch(() => {});
    check('landed on an authenticated page', !page2.url().includes('/login'), page2.url().replace(BASE, ''));

    // ── লগআউট ──
    // ⚠️ লগআউট বোতামটি নেভিগেশন **ড্রয়ারের ভেতরে** — সরাসরি ক্লিক
    //    করতে গেলে "element is not visible" এ ৩০s টাইম-আউট হয়। তাই
    //    আগে ড্রয়ারটি খুলতে হয়, ঠিক যেভাবে ব্যবহারকারী খোলেন।
    await page2.goto(`${BASE}/account`, { waitUntil: 'networkidle' });
    const holdOut = await holdAuth(page2, '**/api/auth/signout**');
    await page2.locator('button[aria-label="মেনু খুলুন"]').first().click();
    const logoutBtn = page2.locator('button:has-text("লগআউট")').last();
    await logoutBtn.waitFor({ state: 'visible', timeout: 8000 });
    await logoutBtn.click();
    const onLogout = await waitForOverlay(page2, 12000);
    check('overlay shows on logout', onLogout, 'via the nav drawer logout button');
    if (onLogout) {
      await checkParts(page2, 'logout');
      await page2.screenshot({ path: `${SHOTS}/logout.png` });
    }
    holdOut();
    await ctx2.close();

    /* ══════════ ৮. কম-গতি পছন্দ ══════════ */
    section('8. Reduced motion');
    const rmCtx = await newCtx({ reducedMotion: 'reduce' });
    const rmPage = await rmCtx.newPage();
    await rmPage.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    await rmPage.waitForTimeout(600);
    const rmRelease = await holdAuth(rmPage);
    await fillAndSubmit(rmPage, 'definitely-wrong-password');
    const rmShown = await waitForOverlay(rmPage);
    check('overlay still shown under reduced motion', rmShown);
    if (rmShown) {
      await checkParts(rmPage, 'reduced-motion');
      const rm = await rmPage.evaluate(() => {
        const running: string[] = [];
        document.getAnimations().forEach((a) => {
          const n = (a as unknown as { animationName?: string }).animationName ?? '';
          if (!n.startsWith('nv-')) return;
          if (Number(a.effect?.getTiming().duration ?? 0) > 100) running.push(n);
        });
        return [...new Set(running)];
      });
      check('busy motion stopped (orb/paw/head/spark)',
        !rm.some((k) => ['nv-orb', 'nv-paw', 'nv-head', 'nv-spark', 'nv-trail'].includes(k)), rm.join(', ') || 'none');
      check('calm motion kept (breathing / blink / messages)',
        ['nv-breathe', 'nv-blink', 'nv-msg'].every((k) => rm.includes(k)), rm.join(', ') || 'none');
      await rmPage.screenshot({ path: `${SHOTS}/reduced-motion.png` });
    }
    rmRelease();
    await rmCtx.close();

    /* ══════════ ৯. রেসপন্সিভ ══════════ */
    section('9. Responsive');
    for (const [w, h, name] of [[390, 844, 'mobile'], [768, 1024, 'tablet'], [1440, 900, 'desktop']] as const) {
      const c: BrowserContext = await newCtx({ viewport: { width: w, height: h } });
      const p = await c.newPage();
      await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
      await p.waitForTimeout(500);
      const rel = await holdAuth(p);
      await fillAndSubmit(p, 'definitely-wrong-password');
      const ok = await waitForOverlay(p);
      check(`${name} ${w}px: overlay appears`, ok);
      if (ok) {
        const fit = await p.locator('.v-ovl .nv-svg').evaluate((el) => {
          const r = el.getBoundingClientRect();
          return { inX: r.left >= -1 && r.right <= window.innerWidth + 1, w: Math.round(r.width) };
        });
        const of = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        check(`${name} ${w}px: mascot fits, no horizontal overflow`, fit.inX && of <= 1, `svg ${fit.w}px, overflow ${of}px`);
        await p.screenshot({ path: `${SHOTS}/responsive-${name}.png` });
      }
      rel();
      await c.close();
    }
  } finally {
    await browser.close();
  }

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n═══ ${passed}/${results.length} passed ═══`);
  const failed = results.filter((r) => !r.ok);
  if (failed.length) { console.log('FAILURES:'); failed.forEach((r) => console.log(`   • ${r.name} — ${r.note}`)); }
  console.log(`screenshots → ${SHOTS}/`);
  process.exit(failed.length ? 1 : 0);
}

main();
