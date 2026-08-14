/**
 * ★★★ টেবিল ও UI-সামঞ্জস্য অডিট — দৃশ্যমান Chromium দিয়ে।
 * `npx tsx scripts/audit-tables.ts`
 *
 * প্রতিটি টেবিলে হেডার ও বডির কলাম **প্রকৃত পিক্সেল অবস্থান** মিলিয়ে
 * দেখে (getBoundingClientRect), শুধু CSS পড়ে নয়। এছাড়া ওভারফ্লো,
 * ফোকাস-রিং, ও খালি/লোডিং অবস্থা যাচাই করে।
 */
/** ⚠️ লাইভ DB-তে লেখা আটকায় — প্রথম import হতে হবে। */
import './_guard-live-db';
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { chromium, type Page } from 'playwright-core';
import { existsSync } from 'fs';

const BASE = 'http://localhost:3000';
const HEADLESS = process.argv.includes('--headless');
const EMAIL = (process.env.ADMIN_EMAIL || '').trim().replace(/^["']|["']$/g, '');
const PASSWORD = (process.env.ADMIN_PASSWORD || '').trim().replace(/^["']|["']$/g, '');
const exe = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(existsSync);

const TABLE_PAGES = [
  '/admin/deposits', '/admin/orders', '/admin/products', '/admin/coupons',
  '/admin/users', '/admin/logs', '/admin/payments', '/admin/reports',
  '/admin/telegram', '/account/orders', '/account/notifications',
];

const issues: string[] = [];
const note = (s: string) => { issues.push(s); };

type TableReport = {
  index: number; rows: number; headerCells: number; bodyCells: number;
  misaligned: { col: number; headerLeft: number; bodyLeft: number; delta: number }[];
  overflowsParent: boolean;
  hasScrollWrapper: boolean;
  colWidthDrift: number;
};

async function auditTables(page: Page, path: string) {
  await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(700);

  const reports = await page.evaluate(() => {
    const out: {
      index: number; rows: number; headerCells: number; bodyCells: number;
      misaligned: { col: number; headerLeft: number; bodyLeft: number; delta: number }[];
      overflowsParent: boolean; hasScrollWrapper: boolean; colWidthDrift: number;
    }[] = [];

    document.querySelectorAll('table').forEach((tbl, index) => {
      const headRow = tbl.querySelector('thead tr');
      const bodyRows = Array.from(tbl.querySelectorAll('tbody tr'));
      const heads = headRow ? Array.from(headRow.children) : [];
      const firstBody = bodyRows[0] ? Array.from(bodyRows[0].children) : [];

      const misaligned: { col: number; headerLeft: number; bodyLeft: number; delta: number }[] = [];
      // ★ প্রকৃত পিক্সেল অবস্থান মিলিয়ে দেখি — CSS ক্লাস এক হলেও
      //   colspan/padding/border-collapse ভিন্নতায় বাস্তবে সরে যেতে পারে।
      if (heads.length && firstBody.length && heads.length === firstBody.length) {
        for (let i = 0; i < heads.length; i++) {
          const h = heads[i].getBoundingClientRect();
          const b = firstBody[i].getBoundingClientRect();
          const delta = Math.abs(h.left - b.left);
          if (delta > 1.5) {
            misaligned.push({ col: i, headerLeft: Math.round(h.left), bodyLeft: Math.round(b.left), delta: Math.round(delta) });
          }
        }
      }

      // একই কলাম বিভিন্ন সারিতে সরে যায় কি না (shifting columns)
      let colWidthDrift = 0;
      if (bodyRows.length > 1 && firstBody.length) {
        for (let i = 0; i < firstBody.length; i++) {
          const widths = bodyRows.slice(0, 8).map((r) => {
            const c = r.children[i];
            return c ? Math.round(c.getBoundingClientRect().width) : -1;
          }).filter((w) => w >= 0);
          if (widths.length > 1) {
            colWidthDrift = Math.max(colWidthDrift, Math.max(...widths) - Math.min(...widths));
          }
        }
      }

      // টেবিল কি প্যারেন্ট ছাপিয়ে যাচ্ছে, আর কোনো scroll-wrapper আছে কি
      const parent = tbl.parentElement;
      const overflowsParent = parent ? tbl.scrollWidth - parent.clientWidth > 2 : false;
      let hasScrollWrapper = false;
      let el: HTMLElement | null = parent;
      for (let d = 0; d < 3 && el; d++) {
        const ox = getComputedStyle(el).overflowX;
        if (ox === 'auto' || ox === 'scroll') { hasScrollWrapper = true; break; }
        el = el.parentElement;
      }

      out.push({
        index, rows: bodyRows.length, headerCells: heads.length, bodyCells: firstBody.length,
        misaligned, overflowsParent, hasScrollWrapper, colWidthDrift,
      });
    });
    return out;
  });

  return reports as TableReport[];
}


// ★ অডিট পুনরাবৃত্তিযোগ্য হতে হবে — আগের রানের রেট-লিমিট অবশিষ্টাংশ
//   পরের রানে লগইন ব্যর্থ করে দিত (মিথ্যা "সব ব্যর্থ" রিপোর্ট)।
async function clearRateLimits() {
  const { PrismaClient } = await import('@prisma/client');
  const p = new PrismaClient();
  await p.$executeRawUnsafe('DELETE FROM "RateLimitBucket"').catch(() => {});
  await p.$disconnect();
}
async function main() {
  await clearRateLimits();
  if (!exe) { console.log('FATAL: no Chrome/Edge'); process.exit(1); }
  const browser = await chromium.launch({ headless: HEADLESS, executablePath: exe, args: ['--window-size=1460,980'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  try {
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    await page.fill('input[type="email"]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    let authed = 0;
    for (let i = 0; i < 15; i++) {
      await page.waitForTimeout(1000);
      authed = await page.evaluate(async (b) => (await fetch(`${b}/api/me`)).status, BASE);
      if (authed === 200) break;
    }
    if (authed !== 200) { console.log('FATAL: login failed (rate limit?)'); await browser.close(); process.exit(1); }

    console.log('\n═══ TABLE ALIGNMENT (desktop 1440) ═══');
    let totalTables = 0;
    for (const p of TABLE_PAGES) {
      const reps = await auditTables(page, p);
      totalTables += reps.length;
      if (reps.length === 0) { console.log(`   --   ${p.padEnd(28)} (no <table>)`); continue; }
      for (const r of reps) {
        const problems: string[] = [];
        if (r.headerCells !== r.bodyCells && r.rows > 0) problems.push(`header ${r.headerCells} vs body ${r.bodyCells} cells`);
        if (r.misaligned.length) problems.push(`misaligned cols: ${r.misaligned.map((m) => `#${m.col}(${m.delta}px)`).join(',')}`);
        if (r.colWidthDrift > 2) problems.push(`column width drift ${r.colWidthDrift}px`);
        if (r.overflowsParent && !r.hasScrollWrapper) problems.push('overflows parent with NO scroll wrapper');
        const ok = problems.length === 0;
        console.log(`  ${ok ? ' ok  ' : 'ISSUE'} ${p.padEnd(28)} table#${r.index} rows=${String(r.rows).padStart(3)} cols=${r.headerCells}${ok ? '' : '  ' + problems.join(' | ')}`);
        if (!ok) note(`${p} table#${r.index}: ${problems.join('; ')}`);
      }
    }

    // ── মোবাইলে টেবিল ──
    console.log('\n═══ TABLE BEHAVIOUR (mobile 390) ═══');
    await page.setViewportSize({ width: 390, height: 844 });
    for (const p of ['/admin/orders', '/admin/deposits', '/admin/users', '/account/orders']) {
      const reps = await auditTables(page, p);
      const bodyOverflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth);
      const unwrapped = reps.filter((r) => r.overflowsParent && !r.hasScrollWrapper);
      const ok = bodyOverflow <= 1 && unwrapped.length === 0;
      console.log(`  ${ok ? ' ok  ' : 'ISSUE'} ${p.padEnd(28)} pageOverflow=${bodyOverflow}px  tables=${reps.length}  unwrapped=${unwrapped.length}`);
      if (!ok) note(`${p} (390px): page overflow ${bodyOverflow}px, ${unwrapped.length} table(s) without scroll wrapper`);
    }
    await page.setViewportSize({ width: 1440, height: 900 });

    // ── ফোকাস দৃশ্যমানতা ──
    console.log('\n═══ FOCUS VISIBILITY ═══');
    await page.goto(`${BASE}/admin/orders`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    const focus = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('button:not([disabled]), a[href], input, select'))
        .slice(0, 12) as HTMLElement[];
      let invisible = 0;
      for (const el of els) {
        el.focus();
        const cs = getComputedStyle(el);
        const hasRing = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0)
          || cs.boxShadow !== 'none';
        if (!hasRing) invisible++;
      }
      return { checked: els.length, invisible };
    });
    console.log(`  ${focus.invisible === 0 ? ' ok  ' : 'ISSUE'} focus ring on ${focus.checked - focus.invisible}/${focus.checked} controls`);
    if (focus.invisible > 0) note(`focus ring missing on ${focus.invisible}/${focus.checked} sampled controls`);

    // ── খালি অবস্থা ──
    console.log('\n═══ EMPTY STATES ═══');
    for (const p of ['/admin/coupons', '/admin/banners', '/account/smm-orders']) {
      await page.goto(BASE + p, { waitUntil: 'networkidle' });
      await page.waitForTimeout(500);
      const t = (await page.textContent('body')) ?? '';
      const hasEmpty = /নেই|খালি|কিছু পাওয়া যায়নি|এখনো/.test(t);
      const hasTable = (await page.locator('table tbody tr').count()) > 0;
      console.log(`  ${hasEmpty || hasTable ? ' ok  ' : 'ISSUE'} ${p.padEnd(28)} ${hasTable ? 'has rows' : hasEmpty ? 'shows empty-state text' : 'NEITHER rows nor empty state'}`);
      if (!hasEmpty && !hasTable) note(`${p}: neither data rows nor an empty state`);
    }

    console.log(`\n═══ ${totalTables} tables inspected · ${issues.length} issues ═══`);
    issues.forEach((i) => console.log(`   • ${i}`));
  } finally {
    await browser.close();
  }
}

main();
