/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ ধাপ ৬ — ব্যর্থতা-ইনজেকশন ও পুনরুদ্ধার
 *
 *   ১. DB সম্পূর্ণ থেমে যাওয়া (`docker pause`, ৮s) — অর্ডার-ঢেউয়ের মাঝখানে
 *   ২. DB-র সব সংযোগ কেটে দেওয়া (`pg_terminate_backend`) — ঢেউয়ের মাঝখানে
 *   ৩. DB তোতলানো — ৫ বার ১.৫s pause (ধীর DB-র অনুকরণ)
 *   ৪. ক্লায়েন্ট অনুরোধ পাঠিয়ে উত্তর না পড়েই চলে যায়, তারপর retry —
 *      অর্ডার, ডিপোজিট-অনুমোদন, FAIL, আংশিক ফেরত, ব্যালেন্স-সমন্বয়
 *   ৫. মেয়াদোত্তীর্ণ / জাল সেশন
 *
 *   প্রত্যাশা: টাকা কখনো আংশিক নয়; retry কখনো দ্বিতীয় টাকা-নড়ানো নয়
 *   (যেখানে idempotency আছে); DB ফিরলে সার্ভার নিজে সেরে ওঠে।
 *
 *   ⚠️ `docker pause` পুরো ডেভ-DB কনটেইনার থামায় (ডেভ DB-ও সেখানে) —
 *   সর্বোচ্চ ৮ সেকেন্ড, কোনো ডেটা মোছে না।
 *   ফল: audit/sim/failure.json
 * ═══════════════════════════════════════════════════════════
 */
import { db, call, mintCookie, saveJson, sleep, money } from './_lib';
import { execFileSync } from 'node:child_process';
import { encode } from 'next-auth/jwt';
import { readFileSync } from 'node:fs';
import { SESSION_COOKIE_NAME } from '../../src/lib/authCookies';
import bcrypt from 'bcryptjs';

const rows: Array<{ test: string; expected: string; actual: string; pass: boolean; evidence?: unknown }> = [];
function rec(test: string, expected: string, actual: string, pass: boolean, evidence?: unknown) {
  rows.push({ test, expected, actual, pass, evidence });
  console.log(`  ${pass ? '✓' : '✗'} ${test}\n      প্রত্যাশিত: ${expected}\n      প্রকৃত: ${actual}`);
}
const docker = (...a: string[]) => execFileSync('docker', a, { encoding: 'utf8' });
let A = ''; let PW = ''; let seq = 0;
const RUN = (Date.now() % 90_000) * 1000;

async function newFunded(amount: number) {
  const k = seq++;
  const u = await db.user.create({ data: {
    name: `Fail ${k}`, email: `fail-${k}-${Date.now()}@sim.invalid`, phone: `015${String(RUN + k).padStart(8, '0')}`,
    password: PW, referralCode: `FL${Date.now().toString(36)}${k}`.toUpperCase(), emailVerified: true } });
  const c = await mintCookie(u);
  const trxId = `FAIL${Date.now().toString(36).toUpperCase()}${k}`;
  await call('f fund', c, 'POST', '/api/deposit', { method: 'BKASH', amount, trxId, senderNo: '01711111111' }, { record: false });
  const d = await db.deposit.findUniqueOrThrow({ where: { trxId } });
  const r = await call('f approve', A, 'POST', '/api/admin/deposit', { depositId: d.id, action: 'APPROVE' }, { record: false });
  if (r.status !== 200) throw new Error('fund ' + r.status);
  return { ...u, cookie: c };
}
async function userOk(id: string) {
  const u = await db.user.findUniqueOrThrow({ where: { id }, select: { balance: true } });
  const s = await db.ledgerEntry.aggregate({ where: { userId: id }, _sum: { amount: true } });
  return Number(u.balance) === Number(s._sum.amount ?? 0) && Number(u.balance) >= 0;
}
/** DB পিছনে আছে কিনা — প্রিজমা পুনঃসংযোগ হওয়া পর্যন্ত অপেক্ষা */
async function waitDb() { for (let i = 0; i < 60; i++) { try { await db.$queryRaw`SELECT 1`; return; } catch { await sleep(500); } } }

async function main() {
  PW = await bcrypt.hash('Fail#2026', 4);
  A = await mintCookie(await db.user.findUniqueOrThrow({ where: { email: 'admin@uidtopup.local' } }));
  const v = await db.variant.findFirstOrThrow({ where: { isActive: true, stock: -1, product: { isActive: true } }, orderBy: { price: 'asc' }, skip: 2 });
  const price = Number(v.price);
  await db.rateLimitBucket.deleteMany({});

  // ── ১. DB সম্পূর্ণ বন্ধ ৮ সেকেন্ড, ৪০টি অর্ডার চলমান ──
  {
    console.log('\n═══ ১. DB pause ৮s ═══');
    const us = await Promise.all(Array.from({ length: 40 }, () => newFunded(price * 2)));
    const bodies = us.map((u, k) => ({ variantId: v.id, playerUid: '1234567890', clientRef: `fi-pause-${k}` }));
    const wave = Promise.all(us.map((u, k) => call('fi order during pause', u.cookie, 'POST', '/api/order', bodies[k], { timeoutMs: 40_000 })));
    await sleep(150);
    docker('pause', 'uidtopup-dev-db');
    const t = Date.now();
    await sleep(8000);
    docker('unpause', 'uidtopup-dev-db');
    const rs = await wave;
    const pausedFor = Date.now() - t;
    await waitDb();
    // গ্রাহক retry করেন একই clientRef-এ
    const retry = await Promise.all(us.map((u, k) => call('fi order retry', u.cookie, 'POST', '/api/order', bodies[k])));
    const counts = await Promise.all(us.map((u) => db.order.count({ where: { userId: u.id } })));
    const ok = await Promise.all(us.map((u) => userOk(u.id)));
    const st: Record<number, number> = {}; rs.forEach((r) => (st[r.status] = (st[r.status] ?? 0) + 1));
    rec('DB ৮s থামলে চলমান অর্ডার + retry', 'প্রতি গ্রাহকে ঠিক ১ অর্ডার, ব্যালেন্স = খতিয়ান, retry সফল',
      `চলাকালীন ${JSON.stringify(st)} · retry-200 ${retry.filter((r) => r.status === 200).length}/40 · অর্ডার-সংখ্যা {${[...new Set(counts)].join(',')}} · খতিয়ান-সঙ্গত ${ok.filter(Boolean).length}/40 · pause ${pausedFor}ms`,
      counts.every((c) => c === 1) && ok.every(Boolean) && retry.every((r) => r.status === 200), { during: st });
    const after = await call('fi health after pause', null, 'GET', '/api/health');
    rec('DB ফেরার পর সার্ভার নিজে সেরে ওঠে', '/api/health 200', `HTTP ${after.status}`, after.status === 200);
  }

  // ── ২. সব DB-সংযোগ কেটে দেওয়া ──
  {
    console.log('\n═══ ২. pg_terminate_backend ═══');
    await db.rateLimitBucket.deleteMany({});
    const us = await Promise.all(Array.from({ length: 30 }, () => newFunded(price * 2)));
    const bodies = us.map((u, k) => ({ variantId: v.id, playerUid: '1234567890', clientRef: `fi-kill-${k}` }));
    const wave = Promise.all(us.map((u, k) => call('fi order during kill', u.cookie, 'POST', '/api/order', bodies[k])));
    await sleep(60);
    docker('exec', 'uidtopup-dev-db', 'psql', '-U', 'dev', '-d', 'uidtopup_dev', '-Atc',
      "SELECT count(pg_terminate_backend(pid)) FROM pg_stat_activity WHERE datname='uidtopup_sim' AND pid<>pg_backend_pid()");
    const rs = await wave;
    await waitDb();
    await sleep(1000);
    const retry = await Promise.all(us.map((u, k) => call('fi order retry kill', u.cookie, 'POST', '/api/order', bodies[k])));
    const counts = await Promise.all(us.map((u) => db.order.count({ where: { userId: u.id } })));
    const ok = await Promise.all(us.map((u) => userOk(u.id)));
    const st: Record<number, number> = {}; rs.forEach((r) => (st[r.status] = (st[r.status] ?? 0) + 1));
    rec('সংযোগ কেটে দিলে চলমান অর্ডার + retry', 'প্রতি গ্রাহকে ঠিক ১ অর্ডার, খতিয়ান-সঙ্গত',
      `চলাকালীন ${JSON.stringify(st)} · retry-200 ${retry.filter((r) => r.status === 200).length}/30 · অর্ডার {${[...new Set(counts)].join(',')}} · সঙ্গত ${ok.filter(Boolean).length}/30`,
      counts.every((c) => c === 1) && ok.every(Boolean));
  }

  // ── ৩. তোতলানো DB ──
  {
    console.log('\n═══ ৩. DB তোতলানো (৫×১.৫s) ═══');
    await db.rateLimitBucket.deleteMany({});
    const us = await Promise.all(Array.from({ length: 20 }, () => newFunded(price * 6)));
    const stutter = (async () => { for (let i = 0; i < 5; i++) { docker('pause', 'uidtopup-dev-db'); await sleep(1500); docker('unpause', 'uidtopup-dev-db'); await sleep(700); } })();
    const t = Date.now();
    const rs = await Promise.all(us.flatMap((u, k) => [0, 1, 2, 3].map((j) => call('fi order stutter', u.cookie, 'POST', '/api/order', { variantId: v.id, playerUid: '1234567890', clientRef: `fi-st-${k}-${j}` }, { timeoutMs: 30_000 }))));
    await stutter; await waitDb();
    const lat = rs.map((r) => r.ms).sort((a, b) => a - b);
    const okN = rs.filter((r) => r.status === 200).length;
    const orders = await db.order.count({ where: { userId: { in: us.map((u) => u.id) } } });
    const ok = await Promise.all(us.map((u) => userOk(u.id)));
    rec('ধীর/তোতলানো DB-তে ৮০ অর্ডার', 'সফল উত্তর = DB-র অর্ডার, খতিয়ান-সঙ্গত, 5xx ≤ কিছু (পুল-টাইমআউট)',
      `200 ${okN}/80 · DB-তে ${orders} · 5xx ${rs.filter((r) => r.status >= 500).length} · p50 ${lat[40]}ms · max ${lat[79]}ms · ${Date.now() - t}ms · সঙ্গত ${ok.filter(Boolean).length}/20`,
      okN === orders && ok.every(Boolean));
  }

  // ── ৪. উত্তর না পড়ে চলে যাওয়া, তারপর retry ──
  {
    console.log('\n═══ ৪. abort-after-send + retry ═══');
    await db.rateLimitBucket.deleteMany({});
    // ৪ক. অর্ডার
    const u = await newFunded(price * 3);
    const body = { variantId: v.id, playerUid: '1234567890', clientRef: 'fi-abort-order' };
    await call('fi abort order', u.cookie, 'POST', '/api/order', body, { timeoutMs: 15 });
    await sleep(1500);
    const r2 = await call('fi abort order retry', u.cookie, 'POST', '/api/order', body);
    const n = await db.order.count({ where: { userId: u.id } });
    rec('অর্ডার: abort + একই clientRef-এ retry', '১ অর্ডার', `অর্ডার ${n} · retry HTTP ${r2.status}`, n === 1 && r2.status === 200);

    // ৪খ. আংশিক ফেরত — idempotency key নেই
    const o = await db.order.findFirstOrThrow({ where: { userId: u.id } });
    await call('fi setup complete', A, 'POST', '/api/admin/order', { orderId: o.id, action: 'COMPLETE', takeover: true }, { record: false });
    const part = money(price * 0.25);
    const rk = `fi-refund-${Date.now()}`;
    await call('fi abort refund', A, 'POST', '/api/admin/order/refund', { orderId: o.id, amount: part, reason: 'আংশিক — নেট কেটে গেল', requestId: rk }, { timeoutMs: 15 });
    await sleep(1500);
    const rr = await call('fi abort refund retry', A, 'POST', '/api/admin/order/refund', { orderId: o.id, amount: part, reason: 'আংশিক — নেট কেটে গেল', requestId: rk });
    const refunds = await db.ledgerEntry.count({ where: { refId: o.id, type: 'REFUND' } });
    rec('আংশিক ফেরত: উত্তর হারানোর পর অ্যাডমিন আবার চাপলেন', '১ ফেরত-সারি; একই চাবির retry 200 (প্রথমটি পৌঁছালে duplicate:true)',
      `ফেরত-সারি ${refunds} · retry HTTP ${rr.status} duplicate=${rr.json?.duplicate ?? false}`, refunds === 1 && rr.status === 200);

    // ৪গ. ব্যালেন্স-সমন্বয় — idempotency key নেই
    const u2 = await newFunded(100);
    const requestId = `fi-adj-${Date.now()}`;
    await call('fi abort adjust', A, 'POST', '/api/admin/user', { userId: u2.id, amount: 50, note: 'ক্ষতিপূরণ', requestId }, { timeoutMs: 15 });
    await sleep(1500);
    const ra = await call('fi abort adjust retry', A, 'POST', '/api/admin/user', { userId: u2.id, amount: 50, note: 'ক্ষতিপূরণ', requestId });
    const adj = await db.ledgerEntry.count({ where: { userId: u2.id, type: 'ADMIN_ADJUST' } });
    rec('ব্যালেন্স-সমন্বয়: উত্তর হারানোর পর আবার', '১ সমন্বয় (idempotency থাকলে)', `সমন্বয়-সারি ${adj} · retry HTTP ${ra.status}`, adj === 1);

    // ৪ঘ. ডিপোজিট-অনুমোদন ও FAIL — লক করা অবস্থা-যাচাই আছে, তাই retry = 409
    const u3 = await db.user.create({ data: { name: 'Fail dep', email: `fail-dep-${Date.now()}@sim.invalid`, phone: `015${String(RUN + 900 + seq++).padStart(8, '0')}`, password: PW, referralCode: `FLD${Date.now().toString(36)}`.toUpperCase(), emailVerified: true } });
    const c3 = await mintCookie(u3);
    const trx = `FAILDEP${Date.now().toString(36).toUpperCase()}`;
    await call('f dep', c3, 'POST', '/api/deposit', { method: 'BKASH', amount: 400, trxId: trx, senderNo: '01711111111' }, { record: false });
    const d = await db.deposit.findUniqueOrThrow({ where: { trxId: trx } });
    await call('fi abort approve', A, 'POST', '/api/admin/deposit', { depositId: d.id, action: 'APPROVE' }, { timeoutMs: 15 });
    await sleep(1500);
    const rd = await call('fi abort approve retry', A, 'POST', '/api/admin/deposit', { depositId: d.id, action: 'APPROVE' });
    const cr = await db.ledgerEntry.count({ where: { refId: d.id, type: 'DEPOSIT' } });
    rec('ডিপোজিট-অনুমোদন: উত্তর হারানোর পর আবার', '১ ক্রেডিট, retry 409 (স্পষ্ট বার্তা)', `ক্রেডিট ${cr} · retry HTTP ${rd.status} "${rd.json?.error ?? ''}"`, cr === 1 && rd.status === 409);
  }

  // ── ৫. মেয়াদোত্তীর্ণ ও জাল সেশন ──
  {
    console.log('\n═══ ৫. সেশন ═══');
    const u = await newFunded(price * 2);
    const secret = readFileSync('.sim/nextauth-secret', 'utf8').trim();
    const expired = await encode({ token: { id: u.id, role: 'USER', epoch: 0, lastChecked: Date.now() }, secret, maxAge: -60 });
    const forged = await encode({ token: { id: u.id, role: 'ADMIN', epoch: 0, lastChecked: Date.now() }, secret: 'not-the-secret-' + 'x'.repeat(20) });
    const r1 = await call('fi expired session', `${SESSION_COOKIE_NAME}=${expired}`, 'POST', '/api/order', { variantId: v.id, playerUid: '1234567890', clientRef: 'fi-exp' });
    const r2 = await call('fi forged session', `${SESSION_COOKIE_NAME}=${forged}`, 'POST', '/api/admin/user', { userId: u.id, amount: 1000, note: 'জাল' });
    const n = await db.order.count({ where: { userId: u.id } });
    const adj = await db.ledgerEntry.count({ where: { userId: u.id, type: 'ADMIN_ADJUST' } });
    rec('মেয়াদোত্তীর্ণ সেশনে অর্ডার', '401, অর্ডার নয়', `HTTP ${r1.status} · অর্ডার ${n}`, r1.status === 401 && n === 0);
    rec('ভিন্ন সিক্রেটে জাল ADMIN সেশনে টাকা যোগ', '401/403, টাকা নয়', `HTTP ${r2.status} · সমন্বয় ${adj}`, (r2.status === 401 || r2.status === 403) && adj === 0);
    // ব্যান মাঝপথে
    await db.user.update({ where: { id: u.id }, data: { isBanned: true } });
    const r3 = await call('fi banned order', u.cookie, 'POST', '/api/order', { variantId: v.id, playerUid: '1234567890', clientRef: 'fi-ban' });
    rec('চালু সেশনে ব্যান হওয়া গ্রাহক অর্ডার দেন', '403, অর্ডার নয়', `HTTP ${r3.status} · অর্ডার ${await db.order.count({ where: { userId: u.id } })}`, r3.status === 403);
  }

  saveJson('failure.json', { at: new Date().toISOString(), rows });
  const bad = rows.filter((r) => !r.pass);
  console.log(`\n${bad.length ? '✗' : '✓'} ${rows.length - bad.length}/${rows.length} পাস`);
  if (bad.length) process.exitCode = 1;
}

main().catch(async (e) => {
  console.error(e);
  try { docker('unpause', 'uidtopup-dev-db'); } catch { /* ইতিমধ্যে চালু */ }
  process.exitCode = 1;
}).finally(() => db.$disconnect());
