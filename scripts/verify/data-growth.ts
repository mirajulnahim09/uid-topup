/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ ডাটা বাড়লে কী হয় — বড় dataset-এ পাতা/API-র সময় ও আকার
 *     (চূড়ান্ত মাস্টার অডিট, ২০২৬-০৯-১৭)
 *
 *   dataset আলাদাভাবে বসানো হয় (`grw_` ট্যাগ-করা সারি, কেবল স্থানীয় DB);
 *   এই স্ক্রিপ্ট শুধু মাপে — কিছু লেখে না (RateLimitBucket সাফ ছাড়া)।
 *
 *   প্রতিটি পথ: ১টি ওয়ার্ম-আপ + ৩ বার, মধ্যমা। সার্ভার-সময় = পুরো body
 *   পাওয়া পর্যন্ত (streaming পাতায় TTFB একা বিভ্রান্তিকর)।
 *
 *   চালানো: VERIFY_BASE=https://localhost:3443 npx tsx scripts/verify/data-growth.ts
 *   ফল: audit/data-growth.json
 * ═══════════════════════════════════════════════════════════
 */
import { db, BASE } from './_db';
import { request, type APIRequestContext } from 'playwright-core';
import { writeFileSync, mkdirSync } from 'node:fs';

type Row = { who: string; path: string; status: number; ms: number; kb: number; runs: number[] };

async function signedIn(email: string, password: string): Promise<APIRequestContext> {
  const ctx = await request.newContext({ ignoreHTTPSErrors: true });
  await db.rateLimitBucket.deleteMany({});
  const { csrfToken } = await (await ctx.get(`${BASE}/api/auth/csrf`)).json();
  await ctx.post(`${BASE}/api/auth/callback/credentials`, {
    form: { csrfToken, email, password, json: 'true' }, maxRedirects: 0, failOnStatusCode: false,
  });
  const me = await (await ctx.get(`${BASE}/api/auth/session`)).json();
  if (me?.user?.email !== email) throw new Error(`লগইন হয়নি: ${email}`);
  return ctx;
}

async function time(ctx: APIRequestContext, path: string) {
  const t = performance.now();
  const res = await ctx.get(`${BASE}${path}`, { timeout: 120_000, maxRedirects: 0, failOnStatusCode: false });
  const body = await res.body();
  return { status: res.status(), ms: Math.round(performance.now() - t), kb: Math.round(body.length / 1024) };
}

async function main() {
  const counts = {
    users: await db.user.count(), orders: await db.order.count(), deposits: await db.deposit.count(),
    logs: await db.adminLog.count(), ledger: await db.ledgerEntry.count(), notifications: await db.notification.count(),
  };
  console.log('dataset:', counts);
  // ★ অর্ডার-বৃদ্ধি বা গ্রাহক-বৃদ্ধি — যেকোনো একটিতে বড় dataset হলেই মাপা অর্থবহ
  if (counts.orders < 10_000 && counts.users < 10_000) {
    throw new Error('বড় dataset নেই — আগে growth seed বসান');
  }

  const year = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
  const SETS: Array<{ who: string; email: string; password: string; paths: string[] }> = [
    {
      who: 'অ্যাডমিন', email: 'admin@uidtopup.local', password: 'Admin@2026Secure',
      paths: [
        '/admin', '/admin/orders', '/admin/orders?status=PENDING', '/admin/deposits', '/admin/users',
        '/admin/users?q=growth-49', '/admin/users/grw_heavy', '/admin/logs', '/admin/logs?q=গ্রোথ', '/admin/reports',
        '/api/admin/analytics?days=90',
        `/api/admin/reports?type=orders&from=${year}`, `/api/admin/reports?type=deposits&from=${year}`,
        '/api/admin/logs/export', '/api/admin/backup',
      ],
    },
    {
      who: 'ভারী গ্রাহক', email: 'growth-heavy@growth.local', password: 'Growth2026Pass',
      paths: ['/account', '/account/orders', '/account/notifications', '/account/wallet/withdraw', '/api/notifications', '/api/me'],
    },
  ];

  // ★ GROWTH_ONLY=/admin,/admin/orders — কেবল এই পথগুলো (স্কেল-তুলনার দ্বিতীয় দফায়)
  const only = process.env.GROWTH_ONLY?.split(',').filter(Boolean);
  const out: Row[] = [];
  console.log('\n  কে / পথ                                              অবস্থা   মধ্যমা ms    KB   (৩ বার)');
  for (const set of SETS) {
    const paths = only ? set.paths.filter((p) => only.includes(p)) : set.paths;
    if (!paths.length) continue;
    const ctx = await signedIn(set.email, set.password);
    for (const p of paths) {
      await time(ctx, p).catch(() => null);
      const runs = [];
      for (let i = 0; i < 3; i++) runs.push(await time(ctx, p));
      const sorted = [...runs].sort((a, b) => a.ms - b.ms);
      const mid = sorted[1];
      out.push({ who: set.who, path: p, status: mid.status, ms: mid.ms, kb: mid.kb, runs: runs.map((r) => r.ms) });
      console.log(`  ${`${set.who} ${p}`.slice(0, 52).padEnd(52)} ${String(mid.status).padStart(5)} ${String(mid.ms).padStart(9)} ${String(mid.kb).padStart(7)}   ${runs.map((r) => r.ms).join('/')}`);
    }
    await ctx.dispose();
  }

  mkdirSync('audit', { recursive: true });
  writeFileSync(only ? 'audit/data-growth-scaled.json' : 'audit/data-growth.json', JSON.stringify({ counts, rows: out }, null, 2));
  await db.rateLimitBucket.deleteMany({});
  await db.$disconnect();
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
