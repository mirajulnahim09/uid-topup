/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ H2 যাচাই — জাল `x-forwarded-for` উপেক্ষিত হয়
 *
 *   `npx tsx scripts/verify/ip-spoofing.ts`
 *
 *   `pickIp()` সরাসরি ডেকে দুটি কনফিগেই আচরণ মাপা হয়:
 *     · TRUSTED_PROXY নেই  → XFF উপেক্ষিত, প্ল্যাটফর্ম হেডার ব্যবহৃত
 *     · TRUSTED_PROXY=1    → XFF এর বাঁ-দিকের মান ব্যবহৃত
 *
 *   তারপর **প্রকৃত HTTP**: একই ক্লায়েন্ট থেকে প্রতিবার ভিন্ন জাল
 *   `X-Forwarded-For` পাঠিয়ে দেখা হয় rate-limit বাকেট আলাদা হয় কিনা।
 *   আলাদা হলে সীমা বাইপাসযোগ্য — সেটিই ছিল বাগ।
 * ═══════════════════════════════════════════════════════════
 */
/** ⚠️ `./_db` সবার আগে — env লোড ও লাইভ-DB সুরক্ষা (ওই ফাইলে ব্যাখ্যা) */
import { db as prisma, BASE, dbLabel } from './_db';

import { pickIp } from '../../src/lib/rateLimit';

let fail = 0;
const check = (name: string, ok: boolean, note = '') => {
  if (!ok) fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${note ? ` — ${note}` : ''}`);
};

const headers = (o: Record<string, string>) => (n: string) => o[n];

(async () => {
  console.log('═══ H2 — IP স্পুফিং যাচাই ═══\n');
  console.log(`  DB: ${dbLabel()} · সার্ভার: ${BASE}\n`);

  const original = process.env.TRUSTED_PROXY;

  // ── TRUSTED_PROXY নেই ──
  console.log('── TRUSTED_PROXY সেট নেই ──');
  delete process.env.TRUSTED_PROXY;

  check('জাল XFF উপেক্ষিত, x-real-ip ব্যবহৃত',
    pickIp(headers({ 'x-forwarded-for': '6.6.6.6', 'x-real-ip': '10.0.0.1' })) === '10.0.0.1',
    pickIp(headers({ 'x-forwarded-for': '6.6.6.6', 'x-real-ip': '10.0.0.1' })));

  check('শুধু জাল XFF থাকলে → unknown (গ্রহণ করা হয় না)',
    pickIp(headers({ 'x-forwarded-for': '6.6.6.6' })) === 'unknown',
    pickIp(headers({ 'x-forwarded-for': '6.6.6.6' })));

  check('cf-connecting-ip fallback কাজ করে',
    pickIp(headers({ 'cf-connecting-ip': '9.9.9.9' })) === '9.9.9.9');

  check('কোনো হেডার না থাকলে unknown',
    pickIp(headers({})) === 'unknown');

  // ── TRUSTED_PROXY=1 ──
  console.log('\n── TRUSTED_PROXY=1 ──');
  process.env.TRUSTED_PROXY = '1';

  check('XFF এর বাঁ-দিকের মান ব্যবহৃত',
    pickIp(headers({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8', 'x-real-ip': '10.0.0.1' })) === '1.2.3.4',
    pickIp(headers({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8', 'x-real-ip': '10.0.0.1' })));

  check('XFF খালি হলে x-real-ip তে ফিরে যায়',
    pickIp(headers({ 'x-forwarded-for': '', 'x-real-ip': '10.0.0.1' })) === '10.0.0.1');

  if (original === undefined) delete process.env.TRUSTED_PROXY;
  else process.env.TRUSTED_PROXY = original;

  // ── প্রকৃত HTTP: জাল XFF দিয়ে সীমা বাইপাস হয় কিনা ──
  console.log('\n── প্রকৃত HTTP (/api/auth/forgot, সীমা ৫/১৫মিনিট) ──');
  await prisma.$executeRaw`DELETE FROM "RateLimitBucket" WHERE "key" LIKE 'forgot:%'`;

  const codes: number[] = [];
  for (let i = 0; i < 8; i++) {
    const r = await fetch(`${BASE}/api/auth/forgot`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // প্রতিবার আলাদা জাল IP — সার্ভার এটি বিশ্বাস করলে
        // প্রতিটি অনুরোধ আলাদা বাকেটে যেত ও কখনো ৪২৯ হতো না
        'x-forwarded-for': `203.0.113.${i + 1}`,
      },
      body: JSON.stringify({ email: `spoof${i}@example.com` }),
    });
    codes.push(r.status);
  }
  console.log(`  স্ট্যাটাস: ${codes.join(' ')}`);
  const got429 = codes.includes(429);
  check('★ জাল XFF দিয়ে সীমা বাইপাস করা যায় না (৪২৯ আসে)', got429,
    got429 ? 'সীমা কার্যকর' : '⚠️ ৮টি অনুরোধেই পাস — বাকেট আলাদা হয়ে গেছে');

  const buckets = await prisma.$queryRaw<Array<{ key: string; count: number }>>`
    SELECT "key", "count" FROM "RateLimitBucket" WHERE "key" LIKE 'forgot:%'`;
  console.log(`  বাকেট সংখ্যা: ${buckets.length} — ${buckets.map((b) => `${b.key}=${b.count}`).join(', ')}`);
  check('একটিমাত্র বাকেট তৈরি হয়েছে (IP আলাদা হয়নি)', buckets.length === 1,
    `${buckets.length} টি`);

  await prisma.$executeRaw`DELETE FROM "RateLimitBucket" WHERE "key" LIKE 'forgot:%'`;
  await prisma.$disconnect();

  console.log('\n════════════════════════════════════════');
  console.log(fail ? `  ${fail} ব্যর্থ` : '  সব পাস');
  process.exit(fail ? 1 : 0);
})();
