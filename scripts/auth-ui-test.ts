/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ আসল UI দিয়ে লগইন — সম্পূর্ণ পথ ট্রেস
 *
 *   `npx tsx scripts/auth-ui-test.ts`
 *
 *   ফর্ম → csrf → /api/auth/callback/credentials → কুকি → JWT →
 *   /api/me → middleware → রিডাইরেক্ট — প্রতিটি ধাপ রেকর্ড করে।
 *   কনসোল ত্রুটি ও ব্যর্থ নেটওয়ার্ক অনুরোধও ধরা হয়।
 * ═══════════════════════════════════════════════════════════
 */
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { chromium } from 'playwright-core';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const BASE = 'http://localhost:3000';
const EMAIL = (process.env.ADMIN_EMAIL || '').trim().replace(/^["']|["']$/g, '');
const PASSWORD = (process.env.ADMIN_PASSWORD || '').trim().replace(/^["']|["']$/g, '');
const SHOTS = path.join(process.cwd(), 'audit', 'screens');
mkdirSync(SHOTS, { recursive: true });
const TAG = process.argv.find((a) => a.startsWith('--tag='))?.slice(6) || 'after';

let fail = 0;
const check = (name: string, ok: boolean, note = '') => {
  if (!ok) fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${note ? ` — ${note}` : ''}`);
};

(async () => {
  console.log('═══ UI লগইন ট্রেস ═══\n');
  const ws = path.join(process.cwd(), 'ws.txt');
  const browser = existsSync(ws)
    ? await chromium.connect(readFileSync(ws, 'utf8').trim())
    : await chromium.launch({ headless: false });

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const netFails: string[] = [];
  const authCalls: string[] = [];

  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => pageErrors.push(e.message.slice(0, 200)));
  /**
   * ★ **বাতিল** অনুরোধ ≠ **ব্যর্থ** অনুরোধ।
   *   `router.push()` করলে Next চলমান RSC prefetch (`?_rsc=…`) বাতিল
   *   করে — ব্রাউজার সেটিকে `ERR_ABORTED` বলে। এটি স্বাভাবিক আচরণ,
   *   ত্রুটি নয়। তাই আলাদা করে গোনা হয়, কিন্তু **লুকানো হয় না** —
   *   নিচে ছাপা হয়, যাতে অন্য কিছু এর আড়ালে না পড়ে।
   */
  const aborted: string[] = [];
  page.on('requestfailed', (r) => {
    const err = r.failure()?.errorText || '';
    const line = `${r.method()} ${r.url().replace(BASE, '').slice(0, 90)} — ${err}`;
    if (err.includes('ERR_ABORTED') && r.url().includes('_rsc=')) aborted.push(line);
    else netFails.push(line);
  });
  page.on('response', (r) => {
    if (r.url().includes('/api/auth/') || r.url().includes('/api/me')) {
      authCalls.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE, '')}`);
    }
    if (r.status() >= 400 && !r.url().includes('favicon')) {
      netFails.push(`HTTP ${r.status()} ${r.url().replace(BASE, '').slice(0, 100)}`);
    }
  });

  try {
    // ── ১. লগইন পাতা ──
    const resp = await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    check('লগইন পাতা লোড', resp?.status() === 200, `HTTP ${resp?.status()}`);
    await page.waitForTimeout(1500);

    const hasEmail = await page.locator('input[type="email"]').count();
    const hasPass = await page.locator('input[type="password"]').count();
    check('ফর্ম ফিল্ড আছে', hasEmail > 0 && hasPass > 0, `email:${hasEmail} password:${hasPass}`);

    // ── ২. csrf টোকেন ──
    const csrf = await page.evaluate(async (b) => {
      const r = await fetch(`${b}/api/auth/csrf`);
      return { status: r.status, body: await r.json().catch(() => null) };
    }, BASE);
    check('csrf টোকেন পাওয়া গেল', csrf.status === 200 && Boolean(csrf.body?.csrfToken),
      `HTTP ${csrf.status}`);

    await page.screenshot({ path: path.join(SHOTS, `auth_${TAG}_1_form.png`) });

    // ── ৩. জমা ──
    await page.fill('input[type="email"]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await page.screenshot({ path: path.join(SHOTS, `auth_${TAG}_2_filled.png`) });
    await page.click('button[type="submit"]');

    // ── ৪. সেশন? ──
    //   ★ সফল লগইন **নেভিগেট করে**, ফলে চলন্ত `page.evaluate` এর execution
    //     context ধ্বংস হয় ও throw করে। সেটি ব্যর্থতা নয় — সাফল্যের লক্ষণ।
    //     তাই প্রতিটি চেষ্টা আলাদা করে ধরা হয়।
    //   ★ `/api/auth/session` দিয়ে পোল করি, `/api/me` দিয়ে নয়। `/api/me`
    //     লগইনের আগে **৪০১** দেয় — অর্থাৎ হারনেস নিজেই সেই "নেটওয়ার্ক
    //     ব্যর্থতা" তৈরি করত যা পরে নিজেই ত্রুটি বলে গুনত। session
    //     endpoint সবসময় ২০০ দেয়, শুধু ভেতরে user থাকে বা থাকে না।
    let authed = false;
    for (let i = 0; i < 15; i++) {
      await page.waitForTimeout(1000);
      try {
        authed = await page.evaluate(
          `(async () => { const r = await fetch('/api/auth/session'); const j = await r.json().catch(() => null); return Boolean(j && j.user && j.user.id); })()`,
        ) as boolean;
      } catch {
        continue; // নেভিগেশন চলছে — পরের চেষ্টায় দেখা যাবে
      }
      if (authed) break;
    }
    check('সেশন তৈরি (session-এ user.id আছে)', authed, authed ? 'user.id উপস্থিত' : 'সেশন খালি');

    // ── ৫. পাতার দৃশ্যমান ত্রুটি-বার্তা ──
    const bodyText = ((await page.textContent('body')) || '').replace(/\s+/g, ' ');
    const wrongCreds = bodyText.includes('ইমেইল বা পাসওয়ার্ড ভুল');
    check('"ইমেইল বা পাসওয়ার্ড ভুল" দেখাচ্ছে না', !wrongCreds,
      wrongCreds ? '⚠️ বার্তাটি দৃশ্যমান' : 'কোনো ত্রুটি-বার্তা নেই');

    // ── ৬. কুকি ──
    const cookies = await ctx.cookies();
    const sess = cookies.find((c) => c.name.includes('next-auth.session-token'));
    check('সেশন কুকি বসেছে', Boolean(sess),
      sess ? `${sess.name} · httpOnly=${sess.httpOnly} secure=${sess.secure} sameSite=${sess.sameSite}` : 'কোনো সেশন কুকি নেই');
    if (sess) {
      check('কুকি localhost-এ আটকাচ্ছে না (secure=false http-তে)', sess.secure === false,
        `secure=${sess.secure}`);
    }

    // ── ৭. রিডাইরেক্ট ও গার্ডেড পাতা ──
    console.log(`\n  লগইনের পর URL : ${page.url().replace(BASE, '') || '/'}`);
    const adminResp = await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    const onAdmin = page.url().includes('/admin') && !page.url().includes('/login');
    check('অ্যাডমিন পাতায় ঢুকতে পারে (middleware পাস)', onAdmin && adminResp!.status() < 400,
      `HTTP ${adminResp?.status()} → ${page.url().replace(BASE, '')}`);

    await page.screenshot({ path: path.join(SHOTS, `auth_${TAG}_3_admin.png`), fullPage: true });

    // ── ৮. ত্রুটি-সারাংশ ──
    console.log('\n── auth নেটওয়ার্ক কল ──');
    for (const c of authCalls) console.log(`  ${c}`);

    check('কনসোল ত্রুটি নেই', consoleErrors.length === 0,
      consoleErrors.length ? consoleErrors.slice(0, 3).join(' | ') : 'পরিষ্কার');
    check('রানটাইম (page) ত্রুটি নেই', pageErrors.length === 0,
      pageErrors.length ? pageErrors.slice(0, 3).join(' | ') : 'পরিষ্কার');
    check('নেটওয়ার্ক ব্যর্থতা নেই', netFails.length === 0,
      netFails.length ? netFails.slice(0, 4).join(' | ') : 'পরিষ্কার');
    if (aborted.length) {
      console.log(`  note  বাতিল হওয়া RSC prefetch (স্বাভাবিক, ত্রুটি নয়): ${aborted.length} টি`);
      for (const a of aborted) console.log(`          ${a}`);
    }
  } finally {
    await ctx.close();
  }

  console.log('\n════════════════════════════════════════');
  console.log(fail ? `  ${fail} ব্যর্থ` : '  সব পাস');
  process.exit(fail ? 1 : 0);
})();
