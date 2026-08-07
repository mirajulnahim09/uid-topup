/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ C4 যাচাই — লিমিটার ব্যর্থ হলে অথ-পথ আটকায়, বাকিটা চলে
 *
 *   `npx tsx scripts/verify/ratelimit-failclosed.ts`
 *
 *   এটি "কোড ঠিক দেখাচ্ছে" বলে না। প্রকৃত DB ত্রুটি **সিমুলেট** করে:
 *   `prisma.$queryRaw` ও `$executeRaw` কে সাময়িকভাবে throw করানো হয়,
 *   তারপর দেখা হয় —
 *     · অথ-পথ (failClosed: true)  → ok:false, failed:true  (আটকায়)
 *     · সাধারণ পথ (ডিফল্ট)        → ok:true,  failed:true  (চলে)
 *     · retryAfter যুক্তিসঙ্গত
 *     · DB ফিরে এলে দুটোই আবার স্বাভাবিক
 *     · peekRateLimit ব্যর্থতা জানায় (`failed`) কিন্তু আটকায় না
 *     · প্রকৃত কল-সাইটগুলো সত্যিই `failClosed` পাঠাচ্ছে (সোর্স যাচাই)
 * ═══════════════════════════════════════════════════════════
 */
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { prisma } from '../../src/lib/prisma';
import { rateLimit, peekRateLimit, RATE_LIMIT_UNAVAILABLE_MSG } from '../../src/lib/rateLimit';

let fail = 0;
const check = (name: string, ok: boolean, note = '') => {
  if (!ok) fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${note ? ` — ${note}` : ''}`);
};

/** DB কলগুলো throw করানো — প্রকৃত আউটেজের অনুকরণ */
function breakDb() {
  const q = prisma.$queryRaw;
  const x = prisma.$executeRaw;
  (prisma as any).$queryRaw = () => Promise.reject(new Error('simulated: connection terminated'));
  (prisma as any).$executeRaw = () => Promise.reject(new Error('simulated: connection terminated'));
  return () => { (prisma as any).$queryRaw = q; (prisma as any).$executeRaw = x; };
}

const KEY_AUTH = `verify:login:ip:${Date.now()}`;
const KEY_PLAIN = `verify:order:${Date.now()}`;

(async () => {
  console.log('═══ C4 — rate limiter fail-closed যাচাই ═══\n');

  // ── ১. সুস্থ অবস্থায় দুটোই কাজ করে ──
  console.log('── DB সুস্থ ──');
  const okAuth = await rateLimit(KEY_AUTH, 5, 60, { failClosed: true });
  const okPlain = await rateLimit(KEY_PLAIN, 5, 60);
  check('অথ-পথ স্বাভাবিকভাবে অনুমোদন করে', okAuth.ok && !okAuth.failed, `ok=${okAuth.ok} failed=${okAuth.failed ?? false}`);
  check('সাধারণ পথ স্বাভাবিকভাবে অনুমোদন করে', okPlain.ok && !okPlain.failed, `ok=${okPlain.ok}`);

  // ── ২. DB ভেঙে দিয়ে ──
  console.log('\n── DB ব্যর্থ (সিমুলেটেড) ──');
  const restore = breakDb();
  try {
    const brokenAuth = await rateLimit(KEY_AUTH, 5, 60, { failClosed: true });
    const brokenPlain = await rateLimit(KEY_PLAIN, 5, 60);
    const brokenPeek = await peekRateLimit(KEY_AUTH, 5);

    check('অথ-পথ **আটকে যায়**', brokenAuth.ok === false,
      `ok=${brokenAuth.ok}`);
    check('অথ-পথ failed ফ্ল্যাগ দেয়', brokenAuth.failed === true,
      `failed=${brokenAuth.failed}`);
    check('অথ-পথে retryAfter > 0', brokenAuth.retryAfter > 0, `${brokenAuth.retryAfter}s`);
    check('অথ-পথে retryAfter অতিরিক্ত লম্বা নয় (≤ ৬০s)', brokenAuth.retryAfter <= 60,
      `${brokenAuth.retryAfter}s`);

    check('সাধারণ পথ **চলতে থাকে** (fail-open অপরিবর্তিত)', brokenPlain.ok === true,
      `ok=${brokenPlain.ok}`);
    check('সাধারণ পথও failed ফ্ল্যাগ দেয় (পর্যবেক্ষণযোগ্যতা)', brokenPlain.failed === true,
      `failed=${brokenPlain.failed}`);

    check('peek আটকায় না কিন্তু ব্যর্থতা জানায়',
      brokenPeek.limited === false && brokenPeek.failed === true,
      `limited=${brokenPeek.limited} failed=${brokenPeek.failed}`);
  } finally {
    restore();
  }

  // ── ৩. DB ফিরে এলে ──
  console.log('\n── DB আবার সুস্থ ──');
  const backAuth = await rateLimit(KEY_AUTH, 5, 60, { failClosed: true });
  check('অথ-পথ আবার চালু হয়', backAuth.ok === true && !backAuth.failed,
    `ok=${backAuth.ok}`);

  // ── ৪. সীমা ছাড়ালে আচরণ অপরিবর্তিত (failed নয়, সত্যিকারের 429) ──
  console.log('\n── সীমা সত্যিই ছাড়ালে ──');
  const K = `verify:login:burst:${Date.now()}`;
  let last = await rateLimit(K, 3, 60, { failClosed: true });
  for (let i = 0; i < 4; i++) last = await rateLimit(K, 3, 60, { failClosed: true });
  check('সীমা ছাড়ালে ok=false', last.ok === false, `ok=${last.ok}`);
  check('সীমা ছাড়ানো ≠ লিমিটার ব্যর্থতা (failed অনুপস্থিত)', !last.failed,
    `failed=${last.failed ?? false}`);

  // ── ৫. কল-সাইট সত্যিই failClosed পাঠাচ্ছে? (সোর্স যাচাই) ──
  console.log('\n── কল-সাইট যাচাই ──');
  const ROOT = process.cwd();
  const sites: { file: string; needle: string }[] = [
    { file: 'src/lib/auth.ts', needle: 'login:ip:' },
    { file: 'src/lib/auth.ts', needle: 'login:email:' },
    { file: 'src/app/api/auth/forgot/route.ts', needle: 'forgot:' },
    { file: 'src/app/api/auth/reset/route.ts', needle: 'reset:' },
    { file: 'src/app/api/account/2fa/route.ts', needle: '2fa:' },
    { file: 'src/app/api/auth/2fa-check/route.ts', needle: '2fa-precheck:ip:' },
    { file: 'src/app/api/auth/2fa-check/route.ts', needle: '2fa-precheck:email:' },
    { file: 'src/app/api/account/password/route.ts', needle: 'pw:' },
  ];
  for (const { file, needle } of sites) {
    const src = readFileSync(path.join(ROOT, file), 'utf8');
    // ★ কী-প্রিফিক্স মন্তব্যেও থাকতে পারে (ব্যাখ্যা লিখতে গিয়ে)। তাই
    //   **প্রতিটি** occurrence দেখা হয়, আর যেকোনো একটির পরের ৩০০
    //   অক্ষরে `failClosed: true` পেলেই পাস — সেটিই আসল কল-সাইট।
    //   একটিমাত্র indexOf নিলে মন্তব্যেই আটকে গিয়ে মিথ্যা ব্যর্থতা হতো।
    const windows: string[] = [];
    let from = 0;
    for (;;) {
      const i = src.indexOf(needle, from);
      if (i < 0) break;
      windows.push(src.slice(i, i + 300));
      from = i + 1;
    }
    const ok = windows.some((w) => /failClosed:\s*true/.test(w));
    check(`${file} · ${needle} → failClosed`, ok,
      windows.length === 0 ? 'কল-সাইট পাওয়া যায়নি' : `${windows.length} occurrence`);
  }

  // ── ৬. বার্তা লিমিটার-ব্যর্থতা ফাঁস করে না ──
  console.log('\n── বার্তা যাচাই ──');
  const leaky = /rate.?limit|limiter|ডাটাবেস|database|bucket|বাকেট/i.test(RATE_LIMIT_UNAVAILABLE_MSG);
  check('ব্যবহারকারীর বার্তা লিমিটারের কথা বলে না', !leaky, `"${RATE_LIMIT_UNAVAILABLE_MSG}"`);
  check('বার্তা বাংলা ও RUN.md-এর নির্দিষ্ট পাঠ',
    RATE_LIMIT_UNAVAILABLE_MSG === 'সার্ভারে সাময়িক সমস্যা হচ্ছে, একটু পরে আবার চেষ্টা করুন');

  // পরিষ্কার
  await prisma.$executeRaw`DELETE FROM "RateLimitBucket" WHERE "key" LIKE 'verify:%'`;
  await prisma.$disconnect();

  console.log('\n════════════════════════════════════════');
  console.log(fail ? `  ${fail} ব্যর্থ` : '  সব পাস');
  process.exit(fail ? 1 : 0);
})();
