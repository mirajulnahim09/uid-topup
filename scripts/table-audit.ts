/**
 * ★★★ টেবিল/গ্রিড কলাম-সারিবদ্ধতা অডিট — `npx tsx scripts/table-audit.ts [--headless]`
 *
 *   দাবি: "হেডার ও ডেটা একই উল্লম্ব অক্ষে থাকে" — এটি **রেন্ডার করা
 *   পিক্সেল** দেখে প্রমাণ করতে হয়, সোর্স পড়ে নয়। একটি সত্যিকারের
 *   `<table>` এ কলামের **বাক্স** কখনো সরতে পারে না (ব্রাউজারের টেবিল
 *   অ্যালগরিদম নিশ্চিত করে)। যা সরতে পারে তা হলো **বাক্সের ভেতরে
 *   লেখার অবস্থান** — অর্থাৎ `text-align`। ব্যবহারকারী যখন বলেন
 *   "হেডার আর ডেটা এক লাইনে নেই", তখন তিনি ঠিক সেটিই দেখছেন।
 *
 *   তাই এই অডিট প্রতিটি কলামের জন্য মেলায়:
 *     ১. th-এর সংখ্যা == প্রতিটি সারির td-সংখ্যা (colSpan হিসাবসহ)
 *     ২. th-এর কার্যকর `text-align` == সেই কলামের td-দের `text-align`
 *     ৩. লেখার প্রকৃত প্রান্ত (content box) একই দিকে ঘেঁষা কি না
 */
/** ⚠️ লাইভ DB-তে লেখা আটকায় — প্রথম import হতে হবে। */
import './_guard-live-db';
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { chromium, type Page, type Browser } from 'playwright-core';
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const BASE = process.env.AUDIT_BASE || 'http://localhost:3000';
const HEADLESS = process.argv.includes('--headless');
const EMAIL = (process.env.ADMIN_EMAIL || '').trim().replace(/^["']|["']$/g, '');
const PASSWORD = (process.env.ADMIN_PASSWORD || '').trim().replace(/^["']|["']$/g, '');
const exe = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(existsSync);

const SHOTS = 'audit/tables';
mkdirSync(SHOTS, { recursive: true });

/** টেবিলযুক্ত প্রতিটি পাতা */
/**
 * ⚠️ কিছু টেবিল কেবল নির্দিষ্ট ফিল্টারে দেখা যায় — যেমন
 * `/admin/deposits` ডিফল্টে কার্ড-ভিত্তিক **queue** দেখায়
 * (`isQueue = !status || status === 'PENDING'`), আর প্রকৃত
 * `DepositTable` আসে অন্য স্ট্যাটাসে। কোয়েরি-ভ্যারিয়েন্ট ছাড়া
 * অডিটটি ওই টেবিলটি কখনোই দেখত না এবং "সব ঠিক আছে" বলত।
 */
const PAGES = [
  '/account', '/account/orders', '/account/smm-orders', '/account/wallet/deposit',
  '/admin', '/admin/orders', '/admin/orders?status=COMPLETED',
  '/admin/deposits', '/admin/deposits?status=APPROVED', '/admin/deposits?status=REJECTED',
  '/admin/products', '/admin/coupons',
  '/admin/users', '/admin/logs', '/admin/reports', '/admin/media', '/admin/telegram',
  '/admin/integrations', '/admin/site', '/admin/banners', '/admin/homepage',
  '/admin/payments', '/admin/tools', '/admin/branding',
];

/** ভিউপোর্ট — ultra-wide থেকে ছোট ফোন */
const VIEWPORTS: [number, number, string][] = [
  [2560, 1200, 'ultrawide'],
  [1440, 900, 'desktop'],
  [1280, 800, 'laptop'],
  [820, 1180, 'tablet'],
  [390, 844, 'mobile'],
  [320, 640, 'small'],
];

type Issue = { page: string; vp: string; table: string; col: number; kind: string; detail: string };
const issues: Issue[] = [];
let tablesSeen = 0;
let colsChecked = 0;

/**
 * ⚠️ **স্ট্রিং হিসেবে** পাঠাতে হয় — tsx/esbuild ভেতরের নামযুক্ত ফাংশনে
 * `__name(...)` জুড়ে দেয়, যা ব্রাউজারে `__name is not defined` হয়ে
 * ক্র্যাশ করে। এই কোডবেসে সেটি আগে দুবার ঘটেছে।
 */
const PROBE = `(function () {
  var out = [];
  var tables = document.querySelectorAll('table');
  for (var t = 0; t < tables.length; t++) {
    var tbl = tables[t];
    if (!tbl.offsetParent && getComputedStyle(tbl).display === 'none') continue;
    var headRow = tbl.querySelector('thead tr');
    if (!headRow) continue;

    var ths = Array.prototype.slice.call(headRow.children);
    var headSpan = 0;
    for (var i = 0; i < ths.length; i++) headSpan += (ths[i].colSpan || 1);

    var bodyRows = Array.prototype.slice.call(tbl.querySelectorAll('tbody tr'));
    var cols = [];

    for (var c = 0; c < ths.length; c++) {
      var th = ths[c];
      var thCs = getComputedStyle(th);
      var thRect = th.getBoundingClientRect();
      // হেডার-লেখার প্রকৃত অবস্থান — Range দিয়ে টেক্সট নোডের বাক্স
      // ⚠️ sr-only হেডার (চেকবক্স-কলাম) বাদ: সেটি পর্দার বাইরে ১px
      //    বাক্সে থাকে, তাই তার "কোন প্রান্তে ঘেঁষা" অর্থহীন।
      var thInk = null;
      var srOnly = !!th.querySelector('.sr-only') || th.classList.contains('sr-only');
      try {
        var r = document.createRange(); r.selectNodeContents(th);
        var b = r.getBoundingClientRect();
        // বহু-লাইনে মোড়ানো লেখার Range পুরো কলাম জুড়ে থাকে — তখন
        // "ঘেঁষা" মাপাটি বিভ্রান্তিকর, তাই একলাইনের ক্ষেত্রেই মাপি।
        if (!srOnly && b.width > 0 && b.height < thRect.height * 1.6) {
          thInk = { l: b.left - thRect.left, r: thRect.right - b.right };
        }
      } catch (e) {}

      var cellAligns = {};
      var cellInk = [];
      for (var j = 0; j < bodyRows.length && j < 12; j++) {
        var row = bodyRows[j];
        if (row.children.length !== ths.length) continue;   // colSpan সারি (খালি বার্তা) বাদ
        var td = row.children[c];
        if (!td) continue;
        var a = getComputedStyle(td).textAlign;
        cellAligns[a] = (cellAligns[a] || 0) + 1;
        var tdRect = td.getBoundingClientRect();
        try {
          var r2 = document.createRange(); r2.selectNodeContents(td);
          var b2 = r2.getBoundingClientRect();
          if (b2.width > 0 && b2.height < tdRect.height * 1.6) {
            cellInk.push({ l: b2.left - tdRect.left, r: tdRect.right - b2.right });
          }
        } catch (e) {}
      }

      cols.push({
        index: c,
        label: (th.textContent || '').trim().slice(0, 22),
        thAlign: thCs.textAlign,
        thClass: th.className,
        cellAligns: cellAligns,
        thInk: thInk,
        cellInk: cellInk.slice(0, 6)
      });
    }

    // সারির সেল-সংখ্যা মেলে কি না (colSpan ধরে)
    var rowSpans = [];
    for (var k = 0; k < bodyRows.length && k < 40; k++) {
      var s = 0, kids = bodyRows[k].children;
      for (var m = 0; m < kids.length; m++) s += (kids[m].colSpan || 1);
      rowSpans.push(s);
    }

    out.push({
      caption: (tbl.className || '') + '#' + t,
      thCount: ths.length,
      headSpan: headSpan,
      rowSpans: rowSpans,
      rows: bodyRows.length,
      cols: cols
    });
  }
  return out;
})()`;

function analyse(page: string, vp: string, data: any[]) {
  for (const tbl of data) {
    tablesSeen++;
    // ── ১. কাঠামো: প্রতিটি সারিতে সমান সংখ্যক কলাম ──
    const bad = tbl.rowSpans.filter((s: number) => s !== tbl.headSpan);
    if (bad.length) {
      issues.push({
        page, vp, table: tbl.caption, col: -1, kind: 'cell-count',
        detail: `header spans ${tbl.headSpan}, ${bad.length} row(s) span ${[...new Set(bad)].join('/')}`,
      });
    }

    for (const col of tbl.cols) {
      colsChecked++;
      const aligns = Object.keys(col.cellAligns);
      if (!aligns.length) continue;

      // ── ২. হেডার ও ডেটার text-align এক কি না ──
      const norm = (a: string) => (a === 'start' ? 'left' : a === 'end' ? 'right' : a);
      const th = norm(col.thAlign);
      const mismatched = aligns.map(norm).filter((a) => a !== th);
      if (mismatched.length) {
        issues.push({
          page, vp, table: tbl.caption, col: col.index, kind: 'align-mismatch',
          detail: `"${col.label}" header=${th} data=${[...new Set(mismatched)].join('/')} (th class="${col.thClass}")`,
        });
      }

      // ── ৩. লেখা কোন প্রান্তে ঘেঁষা — পিক্সেলে ──
      // ⚠️ **সহনশীলতা অপরিহার্য।** বিষয়বস্তু যখন সেলের প্রায় পুরোটা
      //    ভরে ফেলে, দুই পাশের ফাঁক সমান (১৬/১৬px) — তখন "কোন প্রান্তে
      //    ঘেঁষা" প্রশ্নটিরই কোনো উত্তর নেই। প্রথম সংস্করণে `l <= r`
      //    দিয়ে টাই ভাঙা হচ্ছিল, ফলে ২৪টি মিথ্যা "drift" এসেছিল যেখানে
      //    হেডার ও ডেটা দুটোই আসলে নিখুঁতভাবে সারিবদ্ধ।
      const SIDE_TOL = 4;
      const side = (g: { l: number; r: number }) =>
        Math.abs(g.l - g.r) < SIDE_TOL ? 'fill' : g.l < g.r ? 'left' : 'right';
      if (col.thInk && col.cellInk.length) {
        const thSide = side(col.thInk);
        for (const ink of col.cellInk) {
          const cellSide = side(ink);
          if (thSide !== 'fill' && cellSide !== 'fill' && thSide !== cellSide) {
            issues.push({
              page, vp, table: tbl.caption, col: col.index, kind: 'ink-drift',
              detail: `"${col.label}" header hugs ${thSide} (${Math.round(col.thInk.l)}/${Math.round(col.thInk.r)}px), data hugs ${cellSide} (${Math.round(ink.l)}/${Math.round(ink.r)}px)`,
            });
            break;
          }
        }
      }
    }
  }
}

/**
 * ★ স্থায়ী পাহারা — সেলে alignment-ইউটিলিটি ফিরে এলে ধরা পড়বে।
 *
 *   ব্রাউজার-মাপ ভবিষ্যতের রিগ্রেশন ধরে **যদি সেই কলামে ডেটা থাকে**।
 *   খালি টেবিল বা নতুন কলামে সেটি নীরব থেকে যেত। তাই সোর্স-স্ক্যানও
 *   রাখা হলো: শব্দভাণ্ডার একটিই — `.num` / `.ctr`।
 */
function sourceGuard() {
  const bad: string[] = [];
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.tsx$/.test(f)) out.push(p);
    }
    return out;
  };
  for (const file of walk('src')) {
    // ⚠️ মন্তব্য বাদ — নাহলে "`<th className="text-right">` কেন ভুল"
    //    ব্যাখ্যা করা ডকুমেন্টেশনই লঙ্ঘন হিসেবে ধরা পড়ে। ঠিক সেটিই
    //    প্রথম রানে DataTable.tsx-এ ঘটেছিল।
    const src = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    const re = /<(th|td)\b[^>]*\btext-(right|center|left)\b[^>]*>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      const line = src.slice(0, m.index).split('\n').length;
      bad.push(`${file}:${line}  ${m[0].replace(/\s+/g, ' ').slice(0, 80)}`);
    }
  }
  console.log(`\n═══ source guard ═══`);
  if (bad.length) {
    console.log(`  FAIL  ${bad.length} cell(s) use a Tailwind alignment utility instead of .num/.ctr`);
    bad.slice(0, 20).forEach((b) => console.log(`   ${b}`));
    bad.forEach((b) => issues.push({ page: b.split(':')[0], vp: 'source', table: '(source)', col: -1, kind: 'align-utility-on-cell', detail: b }));
  } else {
    console.log('  PASS  every table cell uses the single alignment vocabulary (.num / .ctr)');
  }
}

async function login(page: Page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 25000 });
}

async function main() {
  if (!exe) { console.log('FATAL: no browser found'); process.exit(1); }

  const { PrismaClient } = await import('@prisma/client');
  const db = new PrismaClient();
  await db.$executeRawUnsafe('DELETE FROM "RateLimitBucket"').catch(() => {});
  await db.$disconnect();

  sourceGuard();

  const browser: Browser = await chromium.launch({ headless: HEADLESS, executablePath: exe });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  const consoleErrs: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrs.push(`${page.url()} :: ${m.text()}`); });
  page.on('pageerror', (e) => consoleErrs.push(`${page.url()} :: ${String(e)}`));

  await login(page);
  console.log('logged in\n');

  for (const path of PAGES) {
    await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' }).catch(() => {});
    await page.waitForTimeout(500);

    // ★ লুকানো টেবিল উন্মোচন — অ্যাকর্ডিয়ন/ট্যাব/`<details>`
    //   ⚠️ এটি ছাড়া অডিটটি মিথ্যা আশ্বাস দিত: `/admin/products` এর
    //   দামের টেবিলগুলো গোটানো অ্যাকর্ডিয়নের ভেতরে, তাই "০টি টেবিল"
    //   দেখাত — অথচ ওগুলোই সবচেয়ে জটিল টেবিল। ব্যবহারকারী স্পষ্ট
    //   বলেছেন "প্রতিটি টেবিল" — তাই ক্লিক করে খুলে তবেই মাপা হয়।
    await page.evaluate(`(function () {
      document.querySelectorAll('details:not([open])').forEach(function (d) { d.open = true; });
      var btns = document.querySelectorAll('[aria-expanded="false"]');
      for (var i = 0; i < btns.length && i < 25; i++) {
        var b = btns[i];
        // নেভিগেশন-ড্রয়ার/মেনু খুলে ফেললে টেবিল ঢেকে যেত
        var lbl = (b.getAttribute('aria-label') || '') + ' ' + (b.className || '');
        if (/মেনু|menu|drawer|নোটিফিকেশন/i.test(lbl)) continue;
        try { b.click(); } catch (e) {}
      }
    })()`).catch(() => {});
    await page.waitForTimeout(700);

    let found = 0;
    for (const [w, h, name] of VIEWPORTS) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(260);
      const data = (await page.evaluate(PROBE)) as any[];
      if (!data.length) continue;
      found = data.length;
      analyse(path, name, data);
    }
    // অনুভূমিক ওভারফ্লো — কলাম সরার আরেকটি উৎস
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(200);
    const of = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (of > 1) issues.push({ page: path, vp: 'desktop', table: '(page)', col: -1, kind: 'page-overflow', detail: `${of}px` });
    console.log(`  ${found ? String(found).padStart(2) : ' -'} table(s)  ${path}`);
  }

  await ctx.close();
  await browser.close();

  // ── রিপোর্ট ──
  console.log(`\n═══ ${tablesSeen} table-renders · ${colsChecked} column-checks ═══`);
  const byKind: Record<string, Issue[]> = {};
  for (const i of issues) (byKind[i.kind] ||= []).push(i);
  for (const [kind, list] of Object.entries(byKind)) {
    console.log(`\n▸ ${kind}: ${list.length}`);
    const seen = new Set<string>();
    for (const i of list) {
      const key = `${i.page}|${i.table}|${i.col}|${i.detail}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (seen.size <= 40) console.log(`   ${i.page} [${i.vp}] ${i.detail}`);
    }
    if (seen.size > 40) console.log(`   … ${seen.size - 40} more unique`);
  }
  if (consoleErrs.length) {
    console.log(`\n▸ console errors: ${consoleErrs.length}`);
    [...new Set(consoleErrs)].slice(0, 10).forEach((e) => console.log(`   ${e.slice(0, 160)}`));
  }
  writeFileSync(`${SHOTS}/_findings.json`, JSON.stringify({ tablesSeen, colsChecked, issues, consoleErrs }, null, 1));
  console.log(`\nTOTAL ISSUES: ${issues.length}   → ${SHOTS}/_findings.json`);
  process.exit(issues.length ? 1 : 0);
}

main();
