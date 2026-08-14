/**
 * ★★★ পূর্ণ পাতা-অডিট — দৃশ্যমান Chromium দিয়ে।
 * `npx tsx scripts/audit-pages.ts`
 *
 * প্রতিটি পাবলিক, গ্রাহক ও অ্যাডমিন পাতা খুলে যাচাই করে:
 * HTTP অবস্থা, কনসোল ত্রুটি, ব্যর্থ নেটওয়ার্ক অনুরোধ, অনুভূমিক ওভারফ্লো
 * (৩৯০/৭৬৮/১৪৪০), ব্র্যান্ড উপস্থিতি, ও স্ক্রিনশট।
 */
/** ⚠️ লাইভ DB-তে লেখা আটকায় — প্রথম import হতে হবে। */
import './_guard-live-db';
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { chromium, type Page } from 'playwright-core';
import { existsSync, mkdirSync } from 'fs';

const BASE = 'http://localhost:3000';
const HEADLESS = process.argv.includes('--headless');
const EMAIL = (process.env.ADMIN_EMAIL || '').trim().replace(/^["']|["']$/g, '');
const PASSWORD = (process.env.ADMIN_PASSWORD || '').trim().replace(/^["']|["']$/g, '');
const exe = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(existsSync);

const SHOTS = 'audit/screens';
mkdirSync(SHOTS, { recursive: true });

const PUBLIC_PAGES = [
  '/', '/track', '/faq', '/contact', '/privacy', '/refund', '/terms',
  '/login', '/register', '/forgot-password',
];
const ACCOUNT_PAGES = [
  '/account', '/account/orders', '/account/profile',
  '/account/notifications', '/account/wallet/deposit', '/account/smm-orders',
];
const ADMIN_PAGES = [
  '/admin', '/admin/deposits', '/admin/orders', '/admin/products',
  '/admin/homepage', '/admin/banners', '/admin/media', '/admin/coupons',
  '/admin/users', '/admin/reports', '/admin/logs', '/admin/payments',
  '/admin/integrations', '/admin/telegram', '/admin/tools', '/admin/site',
];

type Row = {
  path: string; status: number; ms: number;
  overflow390: number; overflow768: number; overflow1440: number;
  consoleErrors: string[]; failedRequests: string[];
  h1: string; textLen: number;
};
const rows: Row[] = [];
const issues: string[] = [];

async function auditPage(page: Page, path: string, shot = false): Promise<Row> {
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  const onConsole = (m: { type(): string; text(): string }) => {
    if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 160));
  };
  const onFailed = (r: { url(): string; failure(): { errorText: string } | null }) => {
    // ★ `?_rsc=` হলো Next-এর নিজস্ব prefetch। পাতা ছেড়ে গেলে ব্রাউজার
    //   সেটি বাতিল করে (ERR_ABORTED) — এটি স্বাভাবিক ও উদ্দেশ্যপ্রণোদিত,
    //   ত্রুটি নয়। না ছাঁকলে প্রতিটি নেভিগেশনেই ভুয়া "issue" আসত।
    const url = r.url();
    if (url.includes('_rsc=') && (r.failure()?.errorText ?? '').includes('ABORTED')) return;
    failedRequests.push(`${url.replace(BASE, '')} ${r.failure()?.errorText ?? ''}`.slice(0, 120));
  };
  const onResponse = (r: { status(): number; url(): string }) => {
    if (r.status() >= 400 && r.url().startsWith(BASE)) {
      failedRequests.push(`${r.status()} ${r.url().replace(BASE, '')}`.slice(0, 120));
    }
  };
  page.on('console', onConsole);
  page.on('requestfailed', onFailed);
  page.on('response', onResponse);

  const t0 = Date.now();
  let status = 0;
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    const res = await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 45000 });
    status = res?.status() ?? 0;
  } catch { status = -1; }
  const ms = Date.now() - t0;
  await page.waitForTimeout(300);

  /* ⚠️ পুরো অডিটটি এখানে **ক্র্যাশ** করত: রিসাইজের ঠিক পরে ক্লায়েন্ট-সাইড
       নেভিগেশন চললে `evaluate` এর execution context ধ্বংস হয়ে যেত
       ("Execution context was destroyed")। তখন প্রক্রিয়াটি মরে যেত ও
       **অ্যাডমিন পাতাগুলো কখনো পরীক্ষাই হতো না** — অথচ আউটপুট দেখে মনে
       হতো সব ঠিক আছে। তাই context হারালে থিতু হয়ে একবার পুনঃচেষ্টা। */
  const overflowAt = async (w: number, h: number) => {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(280);
    const measure = () =>
      page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    try {
      return await measure();
    } catch {
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await page.waitForTimeout(500);
      return await measure().catch(() => 0);
    }
  };
  const overflow1440 = await overflowAt(1440, 900);
  const overflow768 = await overflowAt(768, 1024);
  const overflow390 = await overflowAt(390, 844);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(220);

  const info = await page.evaluate(() => ({
    h1: (document.querySelector('h1')?.textContent ?? '').trim().slice(0, 60),
    textLen: (document.body.innerText || '').length,
  }));

  if (shot) {
    const name = path === '/' ? 'home' : path.replace(/\//g, '_').replace(/^_/, '');
    await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false }).catch(() => {});
  }

  page.off('console', onConsole);
  page.off('requestfailed', onFailed);
  page.off('response', onResponse);

  return { path, status, ms, overflow390, overflow768, overflow1440, consoleErrors, failedRequests, ...info };
}

function report(title: string, list: Row[]) {
  console.log(`\n═══ ${title} ═══`);
  for (const r of list) {
    const ov = [r.overflow390 > 1 ? `390:${r.overflow390}px` : '', r.overflow768 > 1 ? `768:${r.overflow768}px` : '', r.overflow1440 > 1 ? `1440:${r.overflow1440}px` : ''].filter(Boolean).join(' ');
    const bad = r.status >= 400 || r.status < 0 || r.consoleErrors.length || r.failedRequests.length || ov;
    console.log(`  ${bad ? 'ISSUE' : ' ok  '} ${r.path.padEnd(30)} ${String(r.status).padStart(3)}  ${String(r.ms).padStart(5)}ms  ${String(r.textLen).padStart(6)}ch${ov ? `  OVERFLOW ${ov}` : ''}`);
    if (r.consoleErrors.length) { console.log(`        console: ${r.consoleErrors.slice(0, 2).join(' | ')}`); issues.push(`${r.path}: console error — ${r.consoleErrors[0]}`); }
    if (r.failedRequests.length) { console.log(`        network: ${[...new Set(r.failedRequests)].slice(0, 3).join(' | ')}`); issues.push(`${r.path}: failed request — ${[...new Set(r.failedRequests)][0]}`); }
    if (ov) issues.push(`${r.path}: horizontal overflow ${ov}`);
    if (r.status >= 400 || r.status < 0) issues.push(`${r.path}: HTTP ${r.status}`);
  }
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
    // ── পাবলিক ──
    const pub: Row[] = [];
    for (const p of PUBLIC_PAGES) pub.push(await auditPage(page, p, ['/', '/login', '/register', '/track'].includes(p)));
    report('PUBLIC PAGES (logged out)', pub);

    // ── অ্যাকাউন্ট পাতা লগ-আউট অবস্থায় → রিডাইরেক্ট হওয়া উচিত ──
    console.log('\n═══ AUTH GUARD (logged out) ═══');
    for (const p of ['/account', '/admin', '/admin/users']) {
      await page.goto(BASE + p, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(700);
      const url = page.url();
      const guarded = !url.includes(p) || url.includes('/login');
      console.log(`  ${guarded ? ' ok  ' : 'ISSUE'} ${p.padEnd(20)} → ${url.replace(BASE, '')}`);
      if (!guarded) issues.push(`${p}: reachable without login`);
    }

    // ── ৪০৪ ──
    console.log('\n═══ ERROR PAGES ═══');
    const r404 = await page.goto(`${BASE}/this-page-does-not-exist-xyz`, { waitUntil: 'domcontentloaded' });
    const t404 = (await page.textContent('body')) ?? '';
    console.log(`  ${r404?.status() === 404 ? ' ok  ' : 'ISSUE'} /404 → HTTP ${r404?.status()}  ${t404.trim().slice(0, 60).replace(/\s+/g, ' ')}`);
    if (r404?.status() !== 404) issues.push('404 page does not return HTTP 404');
    await page.screenshot({ path: `${SHOTS}/404.png` }).catch(() => {});

    // ── লগইন ──
    // ★ `networkidle` + হাইড্রেশনের জন্য অপেক্ষা — dev-এ প্রথম আঘাতে Next
    //   রুট কম্পাইল করে, আর হাইড্রেশনের আগে ক্লিক করলে ফর্ম সাবমিটই হয় না।
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    await page.fill('input[type="email"]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');

    let authed = 0;
    for (let i = 0; i < 15; i++) {
      await page.waitForTimeout(1000);
      authed = await page.evaluate(async (b) => (await fetch(`${b}/api/me`)).status, BASE);
      if (authed === 200) break;
    }
    console.log(`\n  login → /api/me HTTP ${authed}`);
    if (authed !== 200) {
      const err = (await page.textContent('body')) ?? '';
      console.log(`  login page says: ${err.replace(/\s+/g, ' ').slice(0, 200)}`);
    }
    if (authed !== 200) {
      console.log('FATAL: login failed (rate limit?) — cannot audit authenticated pages');
      await browser.close(); process.exit(1);
    }

    /* ★ একটি পাতার ব্যতিক্রম যেন পুরো অডিট থামিয়ে না দেয় — আগে একটিমাত্র
         "context destroyed" পুরো প্রক্রিয়া মেরে ফেলত এবং বাকি পাতাগুলো
         নিঃশব্দে অপরীক্ষিত থেকে যেত। এখন ব্যর্থতা **রেকর্ড** হয়। */
    const safeAudit = async (p: string, shot: boolean): Promise<Row> => {
      try {
        return await auditPage(page, p, shot);
      } catch (e) {
        console.log(`  ERR  ${p} — ${(e as Error).message.split('\n')[0].slice(0, 80)}`);
        return {
          path: p, status: -1, ms: 0, h1: '', textLen: 0,
          overflow1440: 0, overflow768: 0, overflow390: 0,
          consoleErrors: [`audit error: ${(e as Error).message.split('\n')[0]}`],
          failedRequests: [],
        } as Row;
      }
    };

    // ── গ্রাহক ──
    const acc: Row[] = [];
    for (const p of ACCOUNT_PAGES) acc.push(await safeAudit(p, p === '/account'));
    report('CUSTOMER PAGES', acc);

    // ── অ্যাডমিন ──
    const adm: Row[] = [];
    for (const p of ADMIN_PAGES) adm.push(await safeAudit(p, ['/admin', '/admin/orders', '/admin/users', '/admin/telegram'].includes(p)));
    report('ADMIN PAGES', adm);

    // ── সারাংশ ──
    const all = [...pub, ...acc, ...adm];
    const slow = all.filter((r) => r.ms > 6000).sort((a, b) => b.ms - a.ms);
    console.log(`\n═══ SUMMARY ═══`);
    console.log(`  pages audited      : ${all.length}`);
    console.log(`  HTTP failures      : ${all.filter((r) => r.status >= 400 || r.status < 0).length}`);
    console.log(`  console errors     : ${all.filter((r) => r.consoleErrors.length).length}`);
    console.log(`  failed requests    : ${all.filter((r) => r.failedRequests.length).length}`);
    console.log(`  overflow (any vp)  : ${all.filter((r) => r.overflow390 > 1 || r.overflow768 > 1 || r.overflow1440 > 1).length}`);
    console.log(`  slow (>6s, dev)    : ${slow.length}${slow.length ? ' — ' + slow.slice(0, 4).map((r) => `${r.path} ${r.ms}ms`).join(', ') : ''}`);
    console.log(`\n  TOTAL ISSUES: ${issues.length}`);
    issues.forEach((i) => console.log(`   • ${i}`));
  } finally {
    await browser.close();
  }
}

main();
