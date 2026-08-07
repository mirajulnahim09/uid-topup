/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ লগইন-ব্যর্থতার মূল কারণ নির্ণয় — অনুমান নয়, প্রমাণ
 *
 *   `npx tsx scripts/auth-diagnose.ts`
 *   `npx tsx scripts/auth-diagnose.ts --clear-limits`  ← লগইন বাকেট মুছবে
 *
 *   "ইমেইল বা পাসওয়ার্ড ভুল" বার্তাটি **তিনটি ভিন্ন কারণে** আসতে পারে,
 *   কারণ NextAuth-এর CredentialsProvider সব `null` কে একটিমাত্র
 *   `CredentialsSignin` ত্রুটিতে মিলিয়ে ফেলে:
 *     ১. ইউজার নেই / পাসওয়ার্ড সত্যিই ভুল
 *     ২. অ্যাকাউন্ট ব্যান
 *     ৩. **রেট-লিমিট** (IP ১০/১০মিনিট · ইমেইল ৫/১৫মিনিট)
 *   এই স্ক্রিপ্ট তিনটিকে আলাদা করে দেখায়।
 * ═══════════════════════════════════════════════════════════
 */
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const db = new PrismaClient();
const CLEAR = process.argv.includes('--clear-limits');
const EMAIL = (process.env.ADMIN_EMAIL || '').trim().replace(/^["']|["']$/g, '').toLowerCase();
const PASSWORD = (process.env.ADMIN_PASSWORD || '').trim().replace(/^["']|["']$/g, '');

(async () => {
  console.log('═══ প্রমাণীকরণ নির্ণয় ═══\n');

  // ── ১. কোন ডাটাবেস? ──
  const url = process.env.DATABASE_URL || '';
  const host = url.match(/@([^/]+)\//)?.[1] ?? '(পার্স করা যায়নি)';
  const dbName = url.match(/\/([^/?]+)\?/)?.[1] ?? '(?)';
  console.log('── ১. ডাটাবেস ──');
  console.log(`  হোস্ট : ${host}`);
  console.log(`  DB    : ${dbName}`);
  const [{ now }] = await db.$queryRaw<{ now: Date }[]>`SELECT NOW() as now`;
  console.log(`  সংযোগ : ✓  (DB ঘড়ি ${new Date(now).toISOString()})`);
  console.log(`  অ্যাপ ঘড়ি : ${new Date().toISOString()}`);
  const skew = Math.abs(Date.now() - new Date(now).getTime()) / 1000;
  console.log(`  clock skew : ${skew.toFixed(1)}s ${skew > 60 ? '⚠️ বড় ব্যবধান' : '(ঠিক আছে)'}`);

  // ── ২. env ──
  console.log('\n── ২. পরিবেশ ──');
  console.log(`  ADMIN_EMAIL     : ${EMAIL || '⚠️ ফাঁকা'}`);
  console.log(`  ADMIN_PASSWORD  : ${PASSWORD ? `সেট (${PASSWORD.length} অক্ষর)` : '⚠️ ফাঁকা'}`);
  console.log(`  NEXTAUTH_SECRET : ${process.env.NEXTAUTH_SECRET ? `সেট (${process.env.NEXTAUTH_SECRET.length})` : '⚠️ নেই'}`);
  console.log(`  NEXTAUTH_URL    : ${process.env.NEXTAUTH_URL || '⚠️ নেই'}`);
  console.log(`  NODE_ENV        : ${process.env.NODE_ENV || '(unset → dev)'}`);
  console.log(`  কুকির নাম হবে   : ${process.env.NODE_ENV === 'production' ? '__Secure-next-auth.session-token (HTTPS লাগবে)' : 'next-auth.session-token'}`);

  // ── ৩. অ্যাকাউন্ট ──
  console.log('\n── ৩. অ্যাডমিন অ্যাকাউন্ট ──');
  const user = await db.user.findUnique({
    where: { email: EMAIL },
    select: {
      id: true, email: true, name: true, role: true, isBanned: true,
      password: true, twoFactorEnabled: true, twoFactorSecret: true,
      sessionEpoch: true, emailVerified: true, createdAt: true,
    },
  });

  if (!user) {
    console.log(`  ✗ ${EMAIL} — ডাটাবেসে **নেই**`);
    const all = await db.user.findMany({ where: { role: 'ADMIN' }, select: { email: true } });
    console.log(`  DB-তে ADMIN: ${all.map((a) => a.email).join(', ') || '(কেউ নেই)'}`);
  } else {
    console.log(`  ✓ পাওয়া গেছে — ${user.name} <${user.email}>`);
    console.log(`    role          : ${user.role}${user.role === 'ADMIN' ? '' : '  ⚠️ অ্যাডমিন নয়'}`);
    console.log(`    isBanned      : ${user.isBanned}${user.isBanned ? '  ⚠️ ব্যান — লগইন null দেবে' : ''}`);
    console.log(`    emailVerified : ${user.emailVerified}  (লগইনে দেখা হয় না)`);
    console.log(`    2FA           : ${user.twoFactorEnabled ? '⚠️ চালু — কোড ছাড়া লগইন হবে না' : 'বন্ধ'}`);
    console.log(`    sessionEpoch  : ${user.sessionEpoch}`);
    console.log(`    hash prefix   : ${user.password.slice(0, 7)}  (দৈর্ঘ্য ${user.password.length})`);

    // ── ৪. আসল bcrypt তুলনা ──
    console.log('\n── ৪. পাসওয়ার্ড যাচাই (authorize() যা করে, হুবহু) ──');
    const t0 = Date.now();
    const ok = await bcrypt.compare(PASSWORD, user.password);
    console.log(`  bcrypt.compare(ADMIN_PASSWORD, hash) → ${ok ? '✓ মেলে' : '✗ মেলে না'}  (${Date.now() - t0}ms)`);
    if (!ok) {
      console.log('  ⚠️ পাসওয়ার্ড হ্যাশ env-এর সাথে মেলে না — seed আবার চালাতে হবে।');
    }
  }

  // ── ৫. রেট-লিমিট বাকেট ──
  console.log('\n── ৫. রেট-লিমিট বাকেট (login:*) ──');
  const buckets = await db.$queryRaw<Array<{ key: string; count: number; resetAt: Date }>>`
    SELECT "key", "count", "resetAt" FROM "RateLimitBucket"
    WHERE "key" LIKE 'login:%' ORDER BY "key"`;

  if (!buckets.length) {
    console.log('  (কোনো লগইন-বাকেট নেই — সীমা পরিষ্কার)');
  }
  for (const b of buckets) {
    const limit = b.key.startsWith('login:ip:') ? 10 : 5;
    const secs = Math.ceil((new Date(b.resetAt).getTime() - Date.now()) / 1000);
    const active = secs > 0;
    const blocked = active && Number(b.count) > limit;
    console.log(
      `  ${blocked ? '🚫 আটকানো' : active ? '   সক্রিয় ' : '   মেয়াদোত্তীর্ণ'}  ${b.key}`,
    );
    console.log(
      `        count ${b.count}/${limit} · ${active ? `আর ${secs}s (${Math.ceil(secs / 60)} মিনিট)` : 'উইন্ডো শেষ'}`,
    );
  }

  const blocking = buckets.filter((b) => {
    const limit = b.key.startsWith('login:ip:') ? 10 : 5;
    return Number(b.count) > limit && new Date(b.resetAt).getTime() > Date.now();
  });

  console.log('\n═══ উপসংহার ═══');
  if (blocking.length) {
    console.log('  ⛔ লগইন **রেট-লিমিটে আটকানো** — পাসওয়ার্ড ভুল নয়।');
    for (const b of blocking) console.log(`     ${b.key}  (count ${b.count})`);
    console.log('\n  authorize() rate-limit-এ `return null` করে, আর NextAuth সব null-কে');
    console.log('  একই `CredentialsSignin` ত্রুটিতে মেলায় → UI "ইমেইল বা পাসওয়ার্ড ভুল"');
    console.log('  দেখায়। বার্তাটিই বিভ্রান্তিকর, লগইন-যুক্তি নয়।');
    if (CLEAR) {
      const n = await db.$executeRaw`DELETE FROM "RateLimitBucket" WHERE "key" LIKE 'login:%'`;
      console.log(`\n  ✓ --clear-limits: ${n} টি লগইন-বাকেট মুছে ফেলা হলো।`);
    } else {
      console.log('\n  → পরিষ্কার করতে: npx tsx scripts/auth-diagnose.ts --clear-limits');
    }
  } else if (user && !user.isBanned && await bcrypt.compare(PASSWORD, user.password)) {
    console.log('  ✓ শংসাপত্র বৈধ ও কোনো সীমা সক্রিয় নয় — লগইন কাজ করা উচিত।');
    if (CLEAR) {
      const n = await db.$executeRaw`DELETE FROM "RateLimitBucket" WHERE "key" LIKE 'login:%'`;
      console.log(`  (--clear-limits: ${n} টি বাকেট মুছে ফেলা হলো)`);
    }
  } else {
    console.log('  ⚠️ উপরের ৩/৪ নং দেখুন — শংসাপত্রেই সমস্যা।');
  }

  await db.$disconnect();
})();
