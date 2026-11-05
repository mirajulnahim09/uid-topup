/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ স্থানীয় লোড-টেস্ট — ১০ / ২৫ / ৫০ / ১০০ একসাথে ব্যবহারকারী
 *     (চূড়ান্ত মাস্টার অডিট, ২০২৬-০৯-১৭)
 *
 *   কেবল স্থানীয় প্রোডাকশন রিগে (`next start` + TLS প্রক্সি, ডেভ DB)।
 *   `_db` স্থানীয় নয় এমন DB-তে চলতেই দেয় না। কোনো নিরাপত্তা-সীমা বন্ধ
 *   করা হয় না — 429 আলাদা করে গোনা হয় (ত্রুটি নয়, সুরক্ষা)।
 *
 *   প্রতিটি স্তরে:
 *     ১. মিশ্র ট্রাফিক (নির্দিষ্ট সময়) — হোম, প্রোডাক্ট, সার্চ পাতা, সার্চ API,
 *        গ্রাহকের অর্ডার-তালিকা, বিজ্ঞপ্তি, /api/me; প্রতি ১০ জনে ১ জন
 *        অ্যাডমিন (অর্ডার-তালিকা ও ড্যাশবোর্ড)
 *     ২. অর্ডার-ঢেউ — N জন একই মুহূর্তে অর্ডার, সাথে **একই clientRef-এ
 *        দ্বিতীয় অনুরোধ** (ডাবল-ক্লিক) → অর্ডার ঠিক N টি হতে হবে
 *     ৩. লগইন-ঢেউ — N জন একসাথে (IP-সীমা ১০/১০ মিনিট; রিগে সবার IP এক)
 *   শেষে: সীমিত স্টক (সেশনের ৩০%) এ সবাই একসাথে → ঠিক ততটিই সফল।
 *
 *   অখণ্ডতা: প্রত্যেক লোড-গ্রাহকের ব্যালেন্স = ১০০০ − তার অর্ডারের দাম,
 *   ব্যালেন্স = খতিয়ানের শেষ balanceAfter, clientRef প্রতি একটি অর্ডার,
 *   স্টক ঋণাত্মক নয়।
 *
 *   চালানো: VERIFY_BASE=https://localhost:3443 npx tsx scripts/verify/load-test.ts
 *   ফল: audit/load-test.json
 * ═══════════════════════════════════════════════════════════
 */
import { db, BASE, dbLabel } from './_db';
import { request, type APIRequestContext } from 'playwright-core';
import { Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { creditWallet } from '../../src/lib/services/wallet';

const LEVELS = (process.env.LOAD_LEVELS || '10,25,50,100').split(',').map(Number);
const MIX_SECONDS = Number(process.env.LOAD_SECONDS || 20);
const PASSWORD = 'LoadTest2026Pass';
const TAG = 'load-';
const FUND = 1000;

type Sample = { name: string; status: number; ms: number };
const pct = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};

async function hit(ctx: APIRequestContext, name: string, path: string, opts: { method?: 'GET' | 'POST'; data?: unknown } = {}) {
  const t = performance.now();
  try {
    const res = opts.method === 'POST'
      ? await ctx.post(`${BASE}${path}`, { data: opts.data, timeout: 60_000, failOnStatusCode: false, maxRedirects: 0 })
      : await ctx.get(`${BASE}${path}`, { timeout: 60_000, failOnStatusCode: false, maxRedirects: 0 });
    const body = await res.body();
    return { sample: { name, status: res.status(), ms: Math.round(performance.now() - t) }, body };
  } catch {
    return { sample: { name, status: 0, ms: Math.round(performance.now() - t) }, body: Buffer.alloc(0) };
  }
}

async function login(email: string): Promise<{ ctx: APIRequestContext; ok: boolean; ms: number; status: number }> {
  const ctx = await request.newContext({ ignoreHTTPSErrors: true });
  const t = performance.now();
  const { csrfToken } = await (await ctx.get(`${BASE}/api/auth/csrf`)).json();
  const r = await ctx.post(`${BASE}/api/auth/callback/credentials`, {
    form: { csrfToken, email, password: email.startsWith('admin@') ? 'Admin@2026Secure' : PASSWORD, json: 'true' },
    maxRedirects: 0, failOnStatusCode: false,
  });
  const ms = Math.round(performance.now() - t);
  const me = await (await ctx.get(`${BASE}/api/auth/session`)).json().catch(() => null);
  return { ctx, ok: me?.user?.email === email, ms, status: r.status() };
}

/** রিগের Node প্রক্রিয়াগুলোর মোট working set (MB) */
function serverMemMB(): number {
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-Command',
      "(Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'next\\\\dist|start-server' } | Measure-Object WorkingSetSize -Sum).Sum"],
    { encoding: 'utf8', timeout: 15_000 });
    return Math.round(Number(out.trim()) / 1024 / 1024);
  } catch { return -1; }
}

async function dbConnections(): Promise<number> {
  const r = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM pg_stat_activity WHERE datname = current_database()`;
  return Number(r[0].n);
}

function summarize(samples: Sample[], seconds: number) {
  const names = [...new Set(samples.map((s) => s.name))];
  const per = names.map((name) => {
    const xs = samples.filter((s) => s.name === name);
    const ms = xs.map((s) => s.ms);
    return {
      name, n: xs.length,
      ok: xs.filter((s) => s.status >= 200 && s.status < 400).length,
      limited429: xs.filter((s) => s.status === 429).length,
      clientErr: xs.filter((s) => s.status >= 400 && s.status < 500 && s.status !== 429).length,
      serverErr: xs.filter((s) => s.status >= 500 || s.status === 0).length,
      p50: pct(ms, 50), p95: pct(ms, 95), p99: pct(ms, 99), max: Math.max(...ms),
    };
  });
  const all = samples.map((s) => s.ms);
  return {
    total: samples.length, rps: Math.round((samples.length / seconds) * 10) / 10,
    serverErr: samples.filter((s) => s.status >= 500 || s.status === 0).length,
    limited429: samples.filter((s) => s.status === 429).length,
    p50: pct(all, 50), p95: pct(all, 95), p99: pct(all, 99), per,
  };
}

async function main() {
  console.log(`ডাটাবেস: ${dbLabel()} · সার্ভার: ${BASE} · স্তর: ${LEVELS.join('/')} · মিশ্র ট্রাফিক ${MIX_SECONDS}s/স্তর`);
  const MAXN = Math.max(...LEVELS);

  // ── প্রস্তুতি ──
  await cleanup();
  const variant = await db.variant.findFirst({
    where: { isActive: true, stock: -1, product: { isActive: true, needsUid: true } },
    orderBy: { price: 'asc' }, include: { product: true },
  });
  const limited = await db.variant.findFirst({
    where: { isActive: true, stock: -1, product: { isActive: true, needsUid: true }, id: { not: variant?.id } },
    orderBy: { price: 'asc' },
  });
  if (!variant || !limited) throw new Error('সক্রিয় সীমাহীন-স্টক ভ্যারিয়েন্ট নেই');
  const productPath = `/product/${variant.product.id}/${encodeURIComponent(variant.product.slug)}`;
  const hash = await bcrypt.hash(PASSWORD, 12);

  const users: Array<{ id: string; email: string }> = [];
  for (let i = 0; i < MAXN; i++) {
    const u = await db.user.create({
      data: {
        name: `লোড গ্রাহক ${i}`, email: `${TAG}${i}@load.local`, phone: `0188${String(i).padStart(7, '0')}`,
        password: hash, referralCode: `LOADT${i}`, emailVerified: true,
      },
    });
    await db.$transaction((tx) => creditWallet({ tx, userId: u.id, amount: new Prisma.Decimal(FUND), type: 'ADMIN_ADJUST', note: 'লোড-টেস্ট তহবিল' }));
    users.push(u);
  }
  console.log(`  ✓ ${users.length} লোড-গ্রাহক, প্রত্যেকে ৳${FUND} (creditWallet)`);

  // ★ সেশন — IP-সীমা (১০/১০ মিনিট) রিগে সবার জন্য এক, তাই প্রতি লগইনের আগে
  //   **স্থানীয়** গণনা মোছা হয় (সুরক্ষা বন্ধ নয়; নিচের লগইন-ঢেউ সীমাটি মাপে)
  const sessions: APIRequestContext[] = [];
  for (const u of users) {
    await db.rateLimitBucket.deleteMany({});
    const s = await login(u.email);
    if (!s.ok) throw new Error(`লগইন হয়নি: ${u.email}`);
    sessions.push(s.ctx);
  }
  await db.rateLimitBucket.deleteMany({});
  const admin = await login('admin@uidtopup.local');
  if (!admin.ok) throw new Error('অ্যাডমিন লগইন হয়নি');
  console.log('  ✓ সব সেশন প্রস্তুত');

  // ওয়ার্ম-আপ
  for (const p of ['/', productPath, '/search?q=free', '/account/orders']) await hit(sessions[0], 'warm', p);
  await hit(admin.ctx, 'warm', '/admin/orders');

  const report: Record<string, unknown>[] = [];
  const placed = new Map<string, { userId: string; price: number }>();
  let expectedOrders = 0;

  for (const N of LEVELS) {
    console.log(`\n═══ স্তর ${N} একসাথে ═══`);
    await db.rateLimitBucket.deleteMany({});

    // ── ১. মিশ্র ট্রাফিক ──
    const samples: Sample[] = [];
    const memBefore = serverMemMB();
    let peakConn = 0;
    const until = Date.now() + MIX_SECONDS * 1000;
    const probe = setInterval(async () => { peakConn = Math.max(peakConn, await dbConnections().catch(() => 0)); }, 1000);
    const memSamples: number[] = [];
    const memProbe = setInterval(() => { memSamples.push(serverMemMB()); }, 4000);

    await Promise.all(Array.from({ length: N }, async (_, vu) => {
      const isAdmin = vu % 10 === 9;
      let k = vu;
      while (Date.now() < until) {
        k++;
        if (isAdmin) {
          const r = k % 3 === 0 ? await hit(admin.ctx, 'admin /admin', '/admin') : await hit(admin.ctx, 'admin /admin/orders', '/admin/orders');
          samples.push(r.sample);
          continue;
        }
        const ctx = sessions[vu];
        const pick = k % 10;
        const r =
          pick <= 2 ? await hit(ctx, 'GET /', '/')
          : pick <= 4 ? await hit(ctx, 'GET product', productPath)
          : pick === 5 ? await hit(ctx, 'GET /search page', '/search?q=free')
          : pick === 6 ? await hit(ctx, 'GET /api/search', '/api/search?q=free')
          : pick === 7 ? await hit(ctx, 'GET /account/orders', '/account/orders')
          : pick === 8 ? await hit(ctx, 'GET /api/notifications', '/api/notifications')
          : await hit(ctx, 'GET /api/me', '/api/me');
        samples.push(r.sample);
      }
    }));
    clearInterval(probe); clearInterval(memProbe);
    const mix = summarize(samples, MIX_SECONDS);
    const memPeak = Math.max(memBefore, ...memSamples);

    // ── ২. অর্ডার-ঢেউ + একই clientRef এ দ্বিতীয় অনুরোধ ──
    await db.rateLimitBucket.deleteMany({});
    const wave: Sample[] = [];
    const dupMismatch: string[] = [];
    await Promise.all(Array.from({ length: N }, async (_, i) => {
      const ref = `load-${N}-${i}`;
      const data = { variantId: variant.id, playerUid: `9${String(N).padStart(3, '0')}${String(i).padStart(5, '0')}`, clientRef: ref, expectedPrice: Number(variant.price) };
      const [a, b] = await Promise.all([
        hit(sessions[i], 'POST /api/order', '/api/order', { method: 'POST', data }),
        hit(sessions[i], 'POST /api/order (dup)', '/api/order', { method: 'POST', data }),
      ]);
      wave.push(a.sample, b.sample);
      const ja = JSON.parse(a.body.toString() || '{}');
      const jb = JSON.parse(b.body.toString() || '{}');
      const ida = ja.order?.id ?? ja.orderId ?? ja.id;
      const idb = jb.order?.id ?? jb.orderId ?? jb.id;
      if (a.sample.status === 200 && b.sample.status === 200 && ida !== idb) dupMismatch.push(ref);
      if (a.sample.status === 200 || b.sample.status === 200) placed.set(ref, { userId: users[i].id, price: Number(variant.price) });
    }));
    expectedOrders += N;
    const ow = summarize(wave, 1);

    // ── ৩. লগইন-ঢেউ ──
    await db.rateLimitBucket.deleteMany({});
    const logins = await Promise.all(users.slice(0, N).map((u) => login(u.email)));
    const loginOk = logins.filter((l) => l.ok).length;
    const loginMs = logins.map((l) => l.ms);
    await Promise.all(logins.map((l) => l.ctx.dispose()));

    const row = {
      level: N, mix, memBeforeMB: memBefore, memPeakMB: memPeak, peakDbConnections: peakConn,
      orderWave: ow, duplicateMismatch: dupMismatch.length,
      loginWave: { attempted: N, succeeded: loginOk, p50: pct(loginMs, 50), p95: pct(loginMs, 95), max: Math.max(...loginMs) },
    };
    report.push(row);

    console.log(`  মিশ্র: ${mix.total} অনুরোধ · ${mix.rps} req/s · p50 ${mix.p50}ms · p95 ${mix.p95}ms · p99 ${mix.p99}ms · 5xx/নেটওয়ার্ক ${mix.serverErr} · 429 ${mix.limited429}`);
    for (const p of mix.per) console.log(`    ${p.name.padEnd(24)} n=${String(p.n).padStart(5)} ok=${String(p.ok).padStart(5)} 429=${String(p.limited429).padStart(4)} 4xx=${String(p.clientErr).padStart(3)} 5xx=${String(p.serverErr).padStart(3)}  p50 ${p.p50} · p95 ${p.p95} · p99 ${p.p99} · max ${p.max}`);
    console.log(`  সার্ভার মেমরি: ${memBefore}MB → শীর্ষ ${memPeak}MB · DB সংযোগ শীর্ষ: ${peakConn}`);
    for (const p of ow.per) console.log(`  অর্ডার-ঢেউ ${p.name.padEnd(22)} n=${p.n} ok=${p.ok} 429=${p.limited429} 4xx=${p.clientErr} 5xx=${p.serverErr} · p50 ${p.p50} · p95 ${p.p95} · max ${p.max}`);
    console.log(`  ডাবল-ক্লিক আলাদা অর্ডার-আইডি: ${dupMismatch.length}`);
    console.log(`  লগইন-ঢেউ: ${loginOk}/${N} সফল · p50 ${row.loginWave.p50}ms · p95 ${row.loginWave.p95}ms`);
  }

  // ── ৪. সীমিত স্টকে ভিড় ──
  await db.rateLimitBucket.deleteMany({});
  // ★ স্টক = সেশনের ৩০% — ভিড় সবসময় স্টকের চেয়ে বড় (১০০ জনে ৩০)
  const STOCK = Math.max(1, Math.floor(sessions.length * 0.3));
  await db.variant.update({ where: { id: limited.id }, data: { stock: STOCK } });
  const rush = await Promise.all(sessions.map((ctx, i) =>
    hit(ctx, 'POST /api/order (limited)', '/api/order', { method: 'POST', data: { variantId: limited.id, playerUid: `8000${String(i).padStart(5, '0')}`, clientRef: `load-stock-${i}` } })));
  const rushOk = rush.filter((r) => r.sample.status === 200).length;
  const rush5xx = rush.filter((r) => r.sample.status >= 500 || r.sample.status === 0).length;
  rush.forEach((r, i) => { if (r.sample.status === 200) placed.set(`load-stock-${i}`, { userId: users[i].id, price: Number(limited.price) }); });
  const stockAfter = (await db.variant.findUnique({ where: { id: limited.id } }))!.stock;
  console.log(`\n═══ সীমিত স্টক ${STOCK}, ${sessions.length} জন একসাথে ═══`);
  console.log(`  সফল ${rushOk} · 5xx ${rush5xx} · অবশিষ্ট স্টক ${stockAfter}`);

  // ── ৫. অখণ্ডতা ──
  const ids = users.map((u) => u.id);
  const orders = await db.order.findMany({ where: { userId: { in: ids } }, select: { userId: true, price: true, clientRef: true, variantId: true } });
  const refs = orders.map((o) => o.clientRef);
  const dupRefs = refs.length - new Set(refs).size;
  const problems: string[] = [];
  if (orders.length !== placed.size) problems.push(`অর্ডার DB-তে ${orders.length}, সফল উত্তর ${placed.size}`);
  if (dupRefs) problems.push(`একই clientRef-এ একাধিক অর্ডার: ${dupRefs}`);
  if (rushOk !== STOCK) problems.push(`সীমিত স্টকে সফল ${rushOk} (হওয়া উচিত ${STOCK})`);
  if (stockAfter !== 0) problems.push(`অবশিষ্ট স্টক ${stockAfter}`);
  if (orders.filter((o) => o.variantId === limited.id).length !== STOCK) problems.push('সীমিত ভ্যারিয়েন্টে অর্ডার-সংখ্যা স্টকের সমান নয়');
  for (const u of users) {
    const row = await db.user.findUnique({ where: { id: u.id }, select: { balance: true } });
    const spent = orders.filter((o) => o.userId === u.id).reduce((s, o) => s + Number(o.price), 0);
    const last = await db.ledgerEntry.findFirst({ where: { userId: u.id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    const sum = await db.ledgerEntry.aggregate({ where: { userId: u.id }, _sum: { amount: true } });
    const bal = Number(row!.balance);
    if (Math.abs(bal - (FUND - spent)) > 0.001) problems.push(`${u.email}: ব্যালেন্স ${bal} ≠ ${FUND - spent}`);
    if (Math.abs(bal - Number(sum._sum.amount ?? 0)) > 0.001) problems.push(`${u.email}: ব্যালেন্স ${bal} ≠ খতিয়ান-যোগফল ${sum._sum.amount}`);
    if (last && Math.abs(bal - Number(last.balanceAfter)) > 0.001) problems.push(`${u.email}: শেষ balanceAfter ${last.balanceAfter} ≠ ${bal}`);
    if (bal < 0) problems.push(`${u.email}: ঋণাত্মক ব্যালেন্স`);
  }
  console.log(`\n═══ অখণ্ডতা ═══`);
  console.log(`  অর্ডার ${orders.length} (প্রত্যাশিত ঢেউ ${expectedOrders} + স্টক ${STOCK}) · clientRef ডুপ্লিকেট ${dupRefs}`);
  console.log(problems.length ? `  ✗ ${problems.length} সমস্যা:\n    ${problems.slice(0, 20).join('\n    ')}` : '  ✓ ব্যালেন্স = ১০০০ − খরচ = খতিয়ান-যোগফল = শেষ balanceAfter · স্টক ০ · কোনো ডুপ্লিকেট নেই');

  mkdirSync('audit', { recursive: true });
  writeFileSync('audit/load-test.json', JSON.stringify({ base: BASE, mixSeconds: MIX_SECONDS, levels: report, stockRush: { stock: STOCK, attempted: sessions.length, succeeded: rushOk, serverErr: rush5xx, stockAfter }, integrity: { orders: orders.length, duplicateRefs: dupRefs, problems } }, null, 2));

  await Promise.all(sessions.map((s) => s.dispose()));
  await admin.ctx.dispose();
  await db.variant.update({ where: { id: limited.id }, data: { stock: -1 } });
  await cleanup();
  await db.rateLimitBucket.deleteMany({});
  if (problems.length) process.exitCode = 1;
}

/** লোড-গ্রাহকদের সব সারি মোছা (কেবল স্থানীয় DB — `_db` নিশ্চিত করে) */
async function cleanup() {
  const us = await db.user.findMany({ where: { email: { startsWith: TAG, endsWith: '@load.local' } }, select: { id: true } });
  const ids = us.map((u) => u.id);
  if (!ids.length) return;
  await db.notification.deleteMany({ where: { userId: { in: ids } } });
  await db.adminLog.deleteMany({ where: { OR: [{ adminId: { in: ids } }, { targetId: { in: ids } }] } });
  await db.ledgerEntry.deleteMany({ where: { userId: { in: ids } } });
  await db.order.deleteMany({ where: { userId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
}

main()
  .catch(async (e) => { console.error(e); process.exitCode = 1; })
  .finally(() => db.$disconnect());
