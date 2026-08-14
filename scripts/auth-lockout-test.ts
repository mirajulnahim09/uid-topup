/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ ব্রুট-ফোর্স গার্ড এখনো কাজ করে — এবং বার্তা এখন সত্যি বলে
 *
 *   `npx tsx scripts/auth-lockout-test.ts`
 *
 *   ফিক্সে সফল লগইন আর কাউন্টারে যোগ হয় না। তাই **প্রমাণ করা দরকার**
 *   যে ব্যর্থ চেষ্টা এখনো ঠিকমতো গোনা হচ্ছে — নাহলে ফিক্সটি নিরাপত্তা
 *   দুর্বল করে ফেলত।
 *
 *   ধাপ:
 *     ১. বাকেট পরিষ্কার
 *     ২. **ভুল** পাসওয়ার্ডে ৭ বার — ৬ষ্ঠ থেকে সীমা পড়া উচিত
 *     ৩. এবার **সঠিক** পাসওয়ার্ডে UI দিয়ে লগইন — সেশন হবে না (সীমা
 *        সক্রিয়), কিন্তু বার্তা হতে হবে **সত্যি**: "অনেকবার চেষ্টা",
 *        "ইমেইল বা পাসওয়ার্ড ভুল" নয়।
 *     ৪. বাকেট পরিষ্কার করে নিশ্চিত করি সঠিক পাসওয়ার্ডে আবার ঢোকা যায়।
 * ═══════════════════════════════════════════════════════════
 */
/** ⚠️ লাইভ DB-তে লেখা আটকায় — প্রথম import হতে হবে। */
import './_guard-live-db';
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { chromium } from 'playwright-core';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

const BASE = 'http://localhost:3000';
const EMAIL = (process.env.ADMIN_EMAIL || '').trim().replace(/^["']|["']$/g, '').toLowerCase();
const PASSWORD = (process.env.ADMIN_PASSWORD || '').trim().replace(/^["']|["']$/g, '');
const SHOTS = path.join(process.cwd(), 'audit', 'screens');
mkdirSync(SHOTS, { recursive: true });
const db = new PrismaClient();

let fail = 0;
const check = (name: string, ok: boolean, note = '') => {
  if (!ok) fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${note ? ` — ${note}` : ''}`);
};

async function rawAttempt(password: string) {
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  const cookie = (csrfRes.headers.get('set-cookie') || '')
    .split(',').map((c) => c.split(';')[0].trim()).join('; ');
  const { csrfToken } = await csrfRes.json();
  const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie },
    body: new URLSearchParams({ email: EMAIL, password, totp: '', csrfToken, json: 'true' }),
    redirect: 'manual',
  });
  return (res.headers.get('set-cookie') || '').includes('next-auth.session-token');
}

const READ_TOAST = `(function () {
  var t = document.querySelector('.v-toast');
  var a = document.querySelector('.alert-error');
  return {
    toast: t ? (t.textContent || '').trim() : null,
    inline: a ? (a.textContent || '').trim() : null
  };
})()`;

(async () => {
  console.log('═══ লক-আউট ও বার্তা যাচাই ═══\n');

  await db.$executeRaw`DELETE FROM "RateLimitBucket" WHERE "key" LIKE 'login:%'`;
  console.log('  (বাকেট পরিষ্কার)\n');

  // ── ধাপ ২: ভুল পাসওয়ার্ড ──
  console.log('── ভুল পাসওয়ার্ডে চেষ্টা ──');
  const wrongResults: boolean[] = [];
  for (let i = 1; i <= 7; i++) {
    const ok = await rawAttempt('this-is-not-the-password');
    wrongResults.push(ok);
    console.log(`  চেষ্টা ${i} : ${ok ? '⚠️ সেশন হলো (অপ্রত্যাশিত)' : '✗ ব্যর্থ (প্রত্যাশিত)'}`);
  }
  check('ভুল পাসওয়ার্ডে কখনো সেশন হয় না', wrongResults.every((r) => !r));

  const buckets = await db.$queryRaw<Array<{ key: string; count: number }>>`
    SELECT "key", "count" FROM "RateLimitBucket" WHERE "key" LIKE 'login:%' ORDER BY "key"`;
  console.log('\n  বাকেট:');
  for (const b of buckets) console.log(`    ${b.key} → ${b.count}`);
  const emailBucket = buckets.find((b) => b.key === `login:email:${EMAIL}`);
  check('ব্যর্থ চেষ্টা গোনা হচ্ছে (গার্ড সক্রিয়)', Number(emailBucket?.count || 0) >= 6,
    `count ${emailBucket?.count ?? 0} — সীমা ৫`);

  // ── ধাপ ৩: সঠিক পাসওয়ার্ড, কিন্তু সীমা সক্রিয় ──
  console.log('\n── এখন সঠিক পাসওয়ার্ড (সীমা সক্রিয় অবস্থায়) ──');
  const okWhileLimited = await rawAttempt(PASSWORD);
  check('সীমা সক্রিয় থাকলে সঠিক পাসওয়ার্ডেও ঢোকা যায় না (গার্ড অটুট)', !okWhileLimited);

  // UI বার্তা — এটিই আসল ফিক্স
  const ws = path.join(process.cwd(), 'ws.txt');
  const browser = existsSync(ws)
    ? await chromium.connect(readFileSync(ws, 'utf8').trim())
    : await chromium.launch({ headless: false });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  try {
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    await page.fill('input[type="email"]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');

    type Msg = { toast: string | null; inline: string | null };
    let msg: Msg = { toast: null, inline: null };
    for (let i = 0; i < 24; i++) {
      await page.waitForTimeout(500);
      msg = await page.evaluate(READ_TOAST) as Msg;
      if (msg.toast || msg.inline) break;
    }
    console.log(`\n  টোস্ট  : ${msg.toast ?? '(নেই)'}`);
    console.log(`  ইনলাইন : ${msg.inline ?? '(নেই)'}`);

    const text = `${msg.toast ?? ''} ${msg.inline ?? ''}`;
    check('বার্তা "ইমেইল বা পাসওয়ার্ড ভুল" **নয়**',
      !text.includes('ইমেইল বা পাসওয়ার্ড ভুল'),
      text.includes('ইমেইল বা পাসওয়ার্ড ভুল') ? '⚠️ এখনো বিভ্রান্তিকর বার্তা' : 'ঠিক আছে');
    check('বার্তা সীমার কথা বলছে', /অনেকবার চেষ্টা|সাময়িকভাবে বন্ধ/.test(text), text.slice(0, 90));
    check('বার্তা অপেক্ষার সময় জানাচ্ছে', /মিনিট/.test(text));
    check('বার্তা বলছে পাসওয়ার্ড বদলাতে হবে না', /পাসওয়ার্ড বদলানোর দরকার নেই/.test(text));

    await page.screenshot({ path: path.join(SHOTS, 'auth_lockout_message.png'), clip: { x: 860, y: 0, width: 580, height: 320 } });
    console.log('  → audit/screens/auth_lockout_message.png');

    // ── ধাপ ৪: পরিষ্কার করলে আবার ঢোকা যায় ──
    console.log('\n── বাকেট পরিষ্কার করে আবার ──');
    await db.$executeRaw`DELETE FROM "RateLimitBucket" WHERE "key" LIKE 'login:%'`;
    const recovered = await rawAttempt(PASSWORD);
    check('সীমা কাটলে সঠিক পাসওয়ার্ডে লগইন হয়', recovered);
  } finally {
    await ctx.close();
    await db.$executeRaw`DELETE FROM "RateLimitBucket" WHERE "key" LIKE 'login:%'`;
    await db.$disconnect();
  }

  console.log('\n════════════════════════════════════════');
  console.log(fail ? `  ${fail} ব্যর্থ` : '  সব পাস');
  process.exit(fail ? 1 : 0);
})();
