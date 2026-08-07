/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ পুনরুৎপাদন: **সঠিক** পাসওয়ার্ড দিয়েও "ইমেইল বা পাসওয়ার্ড ভুল"
 *
 *   `npx tsx scripts/auth-ratelimit-repro.ts`
 *
 *   অনুমান নয় — একই সঠিক শংসাপত্র বারবার পাঠিয়ে দেখানো হয় যে
 *   একটি নির্দিষ্ট চেষ্টার পর সার্ভার ঠিক সেই বার্তাটিই দেয়, যা
 *   ব্যবহারকারী দেখেছেন। ব্রাউজার লাগে না — সরাসরি NextAuth
 *   credentials callback-এ POST করা হয় (login পাতা যা করে)।
 * ═══════════════════════════════════════════════════════════
 */
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { PrismaClient } from '@prisma/client';

const BASE = 'http://localhost:3000';
const EMAIL = (process.env.ADMIN_EMAIL || '').trim().replace(/^["']|["']$/g, '').toLowerCase();
const PASSWORD = (process.env.ADMIN_PASSWORD || '').trim().replace(/^["']|["']$/g, '');
const ATTEMPTS = Number(process.argv.find((a) => a.startsWith('--n='))?.slice(4) || 8);
const db = new PrismaClient();

/** csrf টোকেন + কুকি নিয়ে একটি প্রকৃত credentials লগইন */
async function attempt(i: number) {
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  const setCookie = csrfRes.headers.get('set-cookie') || '';
  const { csrfToken } = await csrfRes.json();
  const cookie = setCookie.split(',').map((c) => c.split(';')[0].trim()).join('; ');

  const body = new URLSearchParams({
    email: EMAIL, password: PASSWORD, totp: '', csrfToken, json: 'true',
  });

  const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie },
    body,
    redirect: 'manual',
  });

  const text = await res.text();
  let url = '';
  try { url = JSON.parse(text).url || ''; } catch { url = res.headers.get('location') || ''; }

  const gotSession = (res.headers.get('set-cookie') || '').includes('next-auth.session-token');
  const errParam = decodeURIComponent(url.match(/[?&]error=([^&]+)/)?.[1] || '');
  const ok = gotSession && !errParam;

  console.log(
    `  চেষ্টা ${String(i).padStart(2)} : ${ok ? '✓ সফল' : '✗ ব্যর্থ'}` +
    `${errParam ? `  error=${errParam}` : ''}` +
    `${ok ? '  (সেশন কুকি বসেছে)' : '  (সেশন কুকি নেই)'}`,
  );
  return { ok, errParam };
}

(async () => {
  console.log('═══ রেট-লিমিট পুনরুৎপাদন ═══');
  console.log(`  ইমেইল    : ${EMAIL}`);
  console.log(`  পাসওয়ার্ড : সঠিক (env থেকে, ${PASSWORD.length} অক্ষর)`);
  console.log(`  সীমা     : ইমেইল ৫/১৫মিনিট · IP ১০/১০মিনিট\n`);

  // পরিষ্কার শুরু — নাহলে আগের চেষ্টার হিসাব মিশে যেত
  const cleared = await db.$executeRaw`DELETE FROM "RateLimitBucket" WHERE "key" LIKE 'login:%'`;
  console.log(`  (শুরুর আগে ${cleared} টি পুরনো login-বাকেট মুছে নেওয়া হলো)\n`);

  const results: { ok: boolean; errParam: string }[] = [];
  for (let i = 1; i <= ATTEMPTS; i++) results.push(await attempt(i));

  const firstFail = results.findIndex((r) => !r.ok);
  const okCount = results.filter((r) => r.ok).length;

  console.log('\n═══ ফলাফল ═══');
  console.log(`  সফল : ${okCount}/${ATTEMPTS}`);
  if (firstFail >= 0) {
    console.log(`  প্রথম ব্যর্থতা : চেষ্টা ${firstFail + 1}`);
    console.log(`  ত্রুটি-কোড     : "${results[firstFail].errParam}"`);
    console.log('\n  ⛔ **সঠিক পাসওয়ার্ড দিয়েও ব্যর্থ** — শংসাপত্র বদলায়নি,');
    console.log('     শুধু চেষ্টার সংখ্যা বেড়েছে। এটিই মূল কারণ।');
    console.log(`     UI এই কোডটিকে "ইমেইল বা পাসওয়ার্ড ভুল" হিসেবে দেখায়।`);
  } else {
    console.log('  (সব চেষ্টা সফল — সীমায় পৌঁছায়নি)');
  }

  const buckets = await db.$queryRaw<Array<{ key: string; count: number }>>`
    SELECT "key", "count" FROM "RateLimitBucket" WHERE "key" LIKE 'login:%' ORDER BY "key"`;
  console.log('\n  বাকেট অবস্থা:');
  for (const b of buckets) console.log(`    ${b.key} → count ${b.count}`);

  await db.$executeRaw`DELETE FROM "RateLimitBucket" WHERE "key" LIKE 'login:%'`;
  console.log('\n  (পরীক্ষার বাকেট পরিষ্কার করা হলো — লগইন আবার স্বাভাবিক)');
  await db.$disconnect();
})();
