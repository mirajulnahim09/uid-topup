/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ ধাপ ৪ — ডাবল-সাবমিট / রেস: প্রতিটি টাকা-নড়ানো কাজে
 *     ২ / ৫ / ১০ / ২৫ / ৫০ / ১০০ টি অনুরোধ **একই মুহূর্তে**
 *
 *   প্রত্যাশা সর্বত্র এক: ঠিক একটি বৈধ অবস্থা-পরিবর্তন, একটিই খতিয়ান-
 *   সারি, কোনো 5xx নয়। প্রতিটি পরীক্ষার গ্রাহক নতুন, আর তার টাকা ঢোকে
 *   আসল পথে (ডিপোজিট-দাবি → অ্যাডমিন অনুমোদন) — সরাসরি DB-তে নয়।
 *
 *   ফল: audit/sim/races.json
 * ═══════════════════════════════════════════════════════════
 */
import { db, call, mintCookie, saveJson, money } from './_lib';
import bcrypt from 'bcryptjs';

const LEVELS = (process.env.RACE_LEVELS || '2,5,10,25,50,100').split(',').map(Number);
const rows: Array<{ scenario: string; n: number; expected: string; actual: string; statuses: Record<string, number>; pass: boolean }> = [];
let seq = 0;
const RUN_BASE = (Date.now() % 90_000) * 1000;
let A = ''; let B = '';
let PW = '';

function tally(rs: { status: number }[]) {
  const t: Record<string, number> = {};
  for (const r of rs) t[r.status] = (t[r.status] ?? 0) + 1;
  return t;
}
function record(scenario: string, n: number, expected: string, actual: string, rs: { status: number }[], pass: boolean) {
  const no5xx = rs.every((r) => r.status > 0 && r.status < 500);
  const ok = pass && no5xx;
  rows.push({ scenario, n, expected, actual: actual + (no5xx ? '' : ' · 5xx/নেটওয়ার্ক!'), statuses: tally(rs), pass: ok });
  console.log(`  ${ok ? '✓' : '✗'} [${String(n).padStart(3)}] ${scenario}: ${actual} ${JSON.stringify(tally(rs))}`);
}

async function newUser(tag: string) {
  const k = seq++;
  const u = await db.user.create({
    data: {
      name: `Race ${tag} ${k}`, email: `race-${tag}-${k}-${Date.now()}@sim.invalid`,
      // ★ ০১৬ + ৮ অঙ্ক: প্রতি রানে আলাদা ভিত্তি + ক্রমিক → অনন্য
      phone: `016${String(RUN_BASE + k).padStart(8, '0')}`,
      password: PW, referralCode: `RC${Date.now().toString(36)}${k}`.toUpperCase(), emailVerified: true,
    },
  });
  return { ...u, cookie: await mintCookie(u) };
}

/** টাকা ঢোকানো — আসল পথে: দাবি + অ্যাডমিন অনুমোদন */
async function fund(u: { id: string; cookie: string }, amount: number) {
  const trxId = `RACE${Date.now().toString(36).toUpperCase()}${seq++}`;
  const r = await call('race fund deposit', u.cookie, 'POST', '/api/deposit', { method: 'BKASH', amount, trxId, senderNo: '01711111111' }, { record: false });
  if (r.status !== 200) throw new Error(`fund deposit ${r.status} ${r.text}`);
  const d = await db.deposit.findUniqueOrThrow({ where: { trxId } });
  const a = await call('race fund approve', A, 'POST', '/api/admin/deposit', { depositId: d.id, action: 'APPROVE' }, { record: false });
  if (a.status !== 200) throw new Error(`fund approve ${a.status} ${a.text}`);
  return d;
}

const ledgerCount = (where: object) => db.ledgerEntry.count({ where });
const balance = async (id: string) => Number((await db.user.findUniqueOrThrow({ where: { id }, select: { balance: true } })).balance);

async function main() {
  PW = await bcrypt.hash('RaceUser#2026', 4);
  A = await mintCookie(await db.user.findUniqueOrThrow({ where: { email: 'admin@uidtopup.local' } }));
  B = await mintCookie(await db.user.findUniqueOrThrow({ where: { email: 'admin2@sim.invalid' } }));
  const v = await db.variant.findFirstOrThrow({ where: { isActive: true, stock: -1, product: { isActive: true } }, orderBy: { price: 'asc' }, skip: 3 });
  const price = Number(v.price);
  console.log(`প্যাকেজ #${v.id} দাম ৳${price}`);
  await db.rateLimitBucket.deleteMany({});

  for (const N of LEVELS) {
    console.log(`\n═══ N = ${N} ═══`);
    await db.rateLimitBucket.deleteMany({});

    // ১. একই clientRef-এ N অর্ডার
    {
      const u = await newUser('ref'); await fund(u, price * 3);
      const body = { variantId: v.id, playerUid: '1234567890', clientRef: `race-same-${N}`, expectedPrice: price };
      const rs = await Promise.all(Array.from({ length: N }, () => call('race order same-ref', u.cookie, 'POST', '/api/order', body)));
      const orders = await db.order.count({ where: { userId: u.id } });
      const debits = await ledgerCount({ userId: u.id, type: 'ORDER' });
      const bal = await balance(u.id);
      const ids = new Set(rs.filter((r) => r.status === 200).map((r) => r.json?.orderId));
      record('অর্ডার: একই clientRef', N, '১ অর্ডার, ১ কাটা, সব 200-এ একই id', `অর্ডার ${orders} · কাটা ${debits} · id ${ids.size} · ব্যালেন্স ${bal}`, rs,
        orders === 1 && debits === 1 && ids.size === 1 && bal === money(price * 2));
    }
    // ২. ভিন্ন clientRef, ব্যালেন্স ঠিক ১টির — (rate-limit ২০/৫মি, তাই N ≤ ২০ হলে সব পৌঁছায়)
    {
      const u = await newUser('bal1'); await fund(u, price);
      const rs = await Promise.all(Array.from({ length: N }, (_, k) => call('race order one-balance', u.cookie, 'POST', '/api/order', { variantId: v.id, playerUid: '1234567890', clientRef: `race-b1-${N}-${k}` })));
      const orders = await db.order.count({ where: { userId: u.id } });
      const bal = await balance(u.id);
      record('অর্ডার: ব্যালেন্স কেবল ১টির, ভিন্ন ref', N, 'ঠিক ১টি, ব্যালেন্স ০', `অর্ডার ${orders} · ব্যালেন্স ${bal}`, rs, orders === 1 && bal === 0);
    }
    // ৩. ডিপোজিট অনুমোদন N বার (দুই অ্যাডমিন মিলিয়ে)
    {
      const u = await newUser('dep');
      const trxId = `RACED${N}${Date.now().toString(36).toUpperCase()}`;
      await call('race dep claim', u.cookie, 'POST', '/api/deposit', { method: 'NAGAD', amount: 500, trxId, senderNo: '01711111111' }, { record: false });
      const d = await db.deposit.findUniqueOrThrow({ where: { trxId } });
      const rs = await Promise.all(Array.from({ length: N }, (_, k) => call('race deposit approve', k % 2 ? B : A, 'POST', '/api/admin/deposit', { depositId: d.id, action: 'APPROVE' })));
      const credits = await ledgerCount({ refId: d.id, type: 'DEPOSIT' });
      record('ডিপোজিট অনুমোদন N বার', N, '১ ক্রেডিট, বাকি 409', `ক্রেডিট ${credits} · ব্যালেন্স ${await balance(u.id)}`, rs, credits === 1 && (await balance(u.id)) === 500 && rs.filter((r) => r.status === 200).length === 1);
    }
    // ৪. অনুমোদন বনাম প্রত্যাখ্যান মিশ্র
    {
      const u = await newUser('depmix');
      const trxId = `RACEM${N}${Date.now().toString(36).toUpperCase()}`;
      await call('race dep claim', u.cookie, 'POST', '/api/deposit', { method: 'NAGAD', amount: 700, trxId, senderNo: '01711111111' }, { record: false });
      const d = await db.deposit.findUniqueOrThrow({ where: { trxId } });
      const rs = await Promise.all(Array.from({ length: N }, (_, k) => call('race deposit mix', k % 2 ? B : A, 'POST', '/api/admin/deposit',
        k % 2 ? { depositId: d.id, action: 'REJECT', rejectReason: 'TRX_NOT_FOUND' } : { depositId: d.id, action: 'APPROVE' })));
      const after = await db.deposit.findUniqueOrThrow({ where: { id: d.id } });
      const credits = await ledgerCount({ refId: d.id, type: 'DEPOSIT' });
      const coherent = (after.status === 'APPROVED' && credits === 1) || (after.status === 'REJECTED' && credits === 0);
      record('ডিপোজিট অনুমোদন⇄প্রত্যাখ্যান মিশ্র', N, 'একটিই সিদ্ধান্ত, ক্রেডিট অবস্থার সাথে সঙ্গত', `${after.status} · ক্রেডিট ${credits}`, rs, coherent && rs.filter((r) => r.status === 200).length === 1);
    }
    // ৫. একই TrxID, N ভিন্ন গ্রাহক একসাথে দাবি
    {
      const us = await Promise.all(Array.from({ length: N }, () => newUser('trx')));
      const trxId = `RACET${N}${Date.now().toString(36).toUpperCase()}`;
      const rs = await Promise.all(us.map((u) => call('race same trx claim', u.cookie, 'POST', '/api/deposit', { method: 'BKASH', amount: 300, trxId, senderNo: '01711111111' })));
      const n = await db.deposit.count({ where: { trxId } });
      record('একই TrxID, ভিন্ন গ্রাহক একসাথে', N, '১টি দাবি, বাকি 409', `দাবি ${n}`, rs, n === 1 && rs.filter((r) => r.status === 200).length === 1);
    }
    // ৬. FAIL (পূর্ণ রিফান্ড) N বার
    {
      const u = await newUser('fail'); await fund(u, price);
      const o = await call('race setup order', u.cookie, 'POST', '/api/order', { variantId: v.id, playerUid: '1234567890', clientRef: `race-fail-${N}` }, { record: false });
      const rs = await Promise.all(Array.from({ length: N }, (_, k) => call('race order fail', k % 2 ? B : A, 'POST', '/api/admin/order', { orderId: o.json.orderId, action: 'FAIL', failReason: 'INVALID_UID', takeover: true })));
      const refunds = await ledgerCount({ refId: o.json.orderId, type: 'REFUND' });
      record('অর্ডার FAIL (রিফান্ড) N বার', N, '১ রিফান্ড, ব্যালেন্স = দাম', `রিফান্ড ${refunds} · ব্যালেন্স ${await balance(u.id)}`, rs, refunds === 1 && (await balance(u.id)) === price);
    }
    // ৭. COMPLETE বনাম FAIL মিশ্র
    {
      const u = await newUser('cf'); await fund(u, price);
      const o = await call('race setup order', u.cookie, 'POST', '/api/order', { variantId: v.id, playerUid: '1234567890', clientRef: `race-cf-${N}` }, { record: false });
      const rs = await Promise.all(Array.from({ length: N }, (_, k) => call('race complete/fail', k % 2 ? B : A, 'POST', '/api/admin/order',
        k % 2 ? { orderId: o.json.orderId, action: 'FAIL', failReason: 'INVALID_UID', takeover: true } : { orderId: o.json.orderId, action: 'COMPLETE', takeover: true })));
      const ord = await db.order.findUniqueOrThrow({ where: { id: o.json.orderId } });
      const refunds = await ledgerCount({ refId: ord.id, type: 'REFUND' });
      const finals = await db.orderEvent.count({ where: { orderId: ord.id, status: { in: ['COMPLETED', 'REFUNDED'] } } });
      const coherent = (ord.status === 'COMPLETED' && refunds === 0) || (ord.status === 'REFUNDED' && refunds === 1);
      record('সম্পন্ন⇄বাতিল একসাথে', N, 'একটিই চূড়ান্ত অবস্থা, রিফান্ড সঙ্গত, একটি চূড়ান্ত ঘটনা', `${ord.status} · রিফান্ড ${refunds} · চূড়ান্ত-ঘটনা ${finals}`, rs, coherent && finals === 1);
    }
    // ৮. আংশিক ফেরত — প্রতিটি অনুরোধ দামের ৪০%; সর্বোচ্চ ২টি সফল হওয়ার কথা
    {
      const u = await newUser('pr'); await fund(u, price);
      const o = await call('race setup order', u.cookie, 'POST', '/api/order', { variantId: v.id, playerUid: '1234567890', clientRef: `race-pr-${N}` }, { record: false });
      await call('race setup complete', A, 'POST', '/api/admin/order', { orderId: o.json.orderId, action: 'COMPLETE', takeover: true }, { record: false });
      const part = money(price * 0.4);
      // ★ প্রতিটি অনুরোধের কারণ আলাদা — ভিন্ন অ্যাডমিনের ভিন্ন উদ্দেশ্য; এখানে কেবল সীমা পরীক্ষা
      const rs = await Promise.all(Array.from({ length: N }, (_, k) => call('race partial refund', k % 2 ? B : A, 'POST', '/api/admin/order/refund', { orderId: o.json.orderId, amount: part, reason: `রেস পরীক্ষা ${k}`, requestId: `race-pr-${N}-${k}-${Date.now()}` })));
      const ord = await db.order.findUniqueOrThrow({ where: { id: o.json.orderId } });
      const okN = rs.filter((r) => r.status === 200).length;
      const exp = Math.min(N, Math.floor(price / part));
      record('আংশিক ফেরত (৪০% করে) N বার', N, `ঠিক ${exp}টি সফল, মোট ≤ দাম`, `সফল ${okN} · ফেরত ${ord.refundedAmount}/${price}`, rs, okN === exp && Number(ord.refundedAmount) <= price && Number(ord.refundedAmount) === money(part * exp));
    }
    // ৮খ. হুবহু একই আংশিক ফেরত N বার (ডাবল-ক্লিক / নেট-কাটা retry) → ঠিক ১টি
    {
      const u = await newUser('prd'); await fund(u, price);
      const o = await call('race setup order', u.cookie, 'POST', '/api/order', { variantId: v.id, playerUid: '1234567890', clientRef: `race-prd-${N}` }, { record: false });
      await call('race setup complete', A, 'POST', '/api/admin/order', { orderId: o.json.orderId, action: 'COMPLETE', takeover: true }, { record: false });
      const part = money(price * 0.1);
      const rk = `race-prd-${N}-${Date.now()}`; // ★ একই ডায়ালগ = একই চাবি
      const rs = await Promise.all(Array.from({ length: N }, (_, k) => call('race partial refund identical', k % 2 ? B : A, 'POST', '/api/admin/order/refund', { orderId: o.json.orderId, amount: part, reason: 'একই কারণ', requestId: rk })));
      const n = await ledgerCount({ refId: o.json.orderId, type: 'REFUND' });
      const dup = rs.filter((r) => r.status === 200 && r.json?.duplicate === true).length;
      record('হুবহু একই আংশিক ফেরত N বার (একই চাবি)', N, '১ ফেরত, বাকিগুলো 200 duplicate', `ফেরত-সারি ${n} · duplicate ${dup}`, rs, n === 1 && dup === N - 1);
    }
    // ৯. প্রত্যাহার — একই OTP-তে N অনুরোধ
    {
      const u = await newUser('wd'); await fund(u, 2000);
      const code = '482913';
      await db.otp.create({ data: { channel: 'EMAIL', purpose: 'WITHDRAW', destination: u.email, codeHash: await bcrypt.hash(code, 8), expiresAt: new Date(Date.now() + 600_000) } });
      const rs = await Promise.all(Array.from({ length: N }, () => call('race withdraw request', u.cookie, 'POST', '/api/account/withdraw', { amount: 500, method: 'BKASH', accountNumber: '01811111111', code })));
      const ws = await db.withdrawal.count({ where: { userId: u.id } });
      record('প্রত্যাহার-অনুরোধ একই OTP-তে', N, '১টি অনুরোধ, ১ কাটা', `অনুরোধ ${ws} · ব্যালেন্স ${await balance(u.id)}`, rs, ws === 1 && (await balance(u.id)) === 1500);
      // ১০. সেই প্রত্যাহারে অনুমোদন⇄প্রত্যাখ্যান N বার
      const w = await db.withdrawal.findFirstOrThrow({ where: { userId: u.id } });
      const rs2 = await Promise.all(Array.from({ length: N }, (_, k) => call('race withdraw decide', k % 2 ? B : A, 'POST', '/api/admin/withdrawals',
        k % 2 ? { id: w.id, action: 'reject', reason: 'রেস' } : { id: w.id, action: 'approve', payoutRef: `RACEPAY${N}` })));
      const wa = await db.withdrawal.findUniqueOrThrow({ where: { id: w.id } });
      const rev = await ledgerCount({ refId: w.id, type: 'WITHDRAWAL_REVERSAL' });
      const bal = await balance(u.id);
      const coherent = (wa.status === 'APPROVED' && rev === 0 && bal === 1500) || (wa.status === 'REJECTED' && rev === 1 && bal === 2000);
      record('প্রত্যাহার অনুমোদন⇄প্রত্যাখ্যান', N, 'একটিই সিদ্ধান্ত, উল্টানো সঙ্গত', `${wa.status} · উল্টানো ${rev} · ব্যালেন্স ${bal}`, rs2, coherent && rs2.filter((r) => r.status === 200).length === 1);
    }
    // ১১. কুপন — সীমা ৫, N জন একসাথে
    {
      const code = `RACECP${N}X${Date.now().toString(36).toUpperCase()}`.slice(0, 24);
      await call('race coupon create', A, 'POST', '/api/admin/coupon', { code, type: 'FIXED', value: 5, minOrder: 0, usageLimit: 5, perUserLimit: 1 }, { record: false });
      const us = await Promise.all(Array.from({ length: N }, () => newUser('cp')));
      await Promise.all(us.map((u) => fund(u, price)));
      const rs = await Promise.all(us.map((u, k) => call('race coupon order', u.cookie, 'POST', '/api/order', { variantId: v.id, playerUid: '1234567890', clientRef: `race-cp-${N}-${k}`, couponCode: code })));
      const c = await db.coupon.findUniqueOrThrow({ where: { code } });
      const uses = await db.couponUse.count({ where: { couponId: c.id } });
      const discounted = await db.order.count({ where: { couponId: c.id } });
      record('কুপন সীমা ৫, একসাথে N জন', N, `ব্যবহার ${Math.min(5, N)}`, `usageCount ${c.usageCount} · ব্যবহার ${uses} · ছাড়ের অর্ডার ${discounted}`, rs,
        c.usageCount === Math.min(5, N) && uses === Math.min(5, N) && discounted === Math.min(5, N));
    }
    // ১২. গ্রাহকের "পেয়েছি" নিশ্চিতকরণ N বার
    {
      const u = await newUser('cfm'); await fund(u, price);
      const o = await call('race setup order', u.cookie, 'POST', '/api/order', { variantId: v.id, playerUid: '1234567890', clientRef: `race-cfm-${N}` }, { record: false });
      await call('race setup complete', A, 'POST', '/api/admin/order', { orderId: o.json.orderId, action: 'COMPLETE', takeover: true }, { record: false });
      const rs = await Promise.all(Array.from({ length: N }, () => call('race confirm', u.cookie, 'POST', '/api/order/confirm', { orderId: o.json.orderId, arrived: true })));
      const ev = await db.orderEvent.count({ where: { orderId: o.json.orderId, actorType: 'CUSTOMER', status: 'COMPLETED' } });
      record('ডেলিভারি নিশ্চিতকরণ N বার', N, 'টাকা নড়ে না; নিশ্চিতকরণ-ঘটনা ১টি', `গ্রাহক-ঘটনা ${ev} · ব্যালেন্স ${await balance(u.id)}`, rs, ev <= 1 && (await balance(u.id)) === 0);
    }
    // ১৩. অ্যাডমিনের ব্যালেন্স-সমন্বয় — একই অনুরোধ N বার (ডাবল-ক্লিক)
    {
      const u = await newUser('adj');
      // ★ UI যেভাবে পাঠায় — এক ডায়ালগ = এক requestId
      const requestId = `race-adj-${N}-${Date.now()}`;
      const rs = await Promise.all(Array.from({ length: N }, () => call('race admin adjust', A, 'POST', '/api/admin/user', { userId: u.id, amount: 100, note: 'ক্ষতিপূরণ ১০০', requestId })));
      const n = await ledgerCount({ userId: u.id, type: 'ADMIN_ADJUST' });
      const dups = rs.filter((r) => r.json?.duplicate === true).length;
      record('অ্যাডমিন ব্যালেন্স-সমন্বয়: একই অনুরোধ N বার (requestId সহ)', N, '১ ক্রেডিট, বাকিগুলো duplicate:true', `ক্রেডিট ${n} · duplicate ${dups} · ব্যালেন্স ${await balance(u.id)}`, rs, n === 1 && dups === N - 1 && (await balance(u.id)) === 100);
    }
  }

  // ১৪. লক-ক্রম: একই গ্রাহকের অর্ডার + অ্যাডমিন FAIL + ডিপোজিট অনুমোদন একসাথে (deadlock হলে 5xx)
  {
    console.log('\n═══ লক-ক্রম মিশ্রণ ═══');
    await db.rateLimitBucket.deleteMany({});
    const us = await Promise.all(Array.from({ length: 12 }, () => newUser('lock')));
    await Promise.all(us.map((u) => fund(u, price * 6)));
    const first = await Promise.all(us.map((u, k) => call('lock setup', u.cookie, 'POST', '/api/order', { variantId: v.id, playerUid: '1234567890', clientRef: `lock-a-${k}` }, { record: false })));
    const deps = await Promise.all(us.map(async (u, k) => {
      const trxId = `LOCK${k}${Date.now().toString(36).toUpperCase()}`;
      await call('lock dep', u.cookie, 'POST', '/api/deposit', { method: 'BKASH', amount: 100, trxId, senderNo: '01711111111' }, { record: false });
      return db.deposit.findUniqueOrThrow({ where: { trxId } });
    }));
    const rs = await Promise.all(us.flatMap((u, k) => [
      call('lock order', u.cookie, 'POST', '/api/order', { variantId: v.id, playerUid: '1234567890', clientRef: `lock-b-${k}` }),
      call('lock order', u.cookie, 'POST', '/api/order', { variantId: v.id, playerUid: '1234567890', clientRef: `lock-c-${k}` }),
      call('lock fail', A, 'POST', '/api/admin/order', { orderId: first[k].json.orderId, action: 'FAIL', failReason: 'INVALID_UID', takeover: true }),
      call('lock approve', B, 'POST', '/api/admin/deposit', { depositId: deps[k].id, action: 'APPROVE' }),
      call('lock adjust', A, 'POST', '/api/admin/user', { userId: u.id, amount: -1, note: 'লক পরীক্ষা' }),
    ]));
    record('অর্ডার+FAIL+অনুমোদন+সমন্বয় একই গ্রাহকে একসাথে (১২×৫)', 60, 'সব 200, deadlock/5xx নেই', `200: ${rs.filter((r) => r.status === 200).length}/60`, rs, rs.every((r) => r.status === 200));
  }

  // ১৫. প্রত্যাহারের hold — ৭২ ঘণ্টা চালু করে নতুন জমা তোলার চেষ্টা
  {
    console.log('\n═══ প্রত্যাহার-hold ═══');
    await call('hold on', A, 'POST', '/api/admin/settings', { withdrawal_hold_hours: '72' }, { record: false });
    const u = await newUser('hold'); await fund(u, 1000);
    await db.otp.create({ data: { channel: 'EMAIL', purpose: 'WITHDRAW', destination: u.email, codeHash: await bcrypt.hash('111222', 8), expiresAt: new Date(Date.now() + 600_000) } });
    const r = await call('hold withdraw', u.cookie, 'POST', '/api/account/withdraw', { amount: 500, method: 'BKASH', accountNumber: '01811111111', code: '111222' });
    record('৭২ঘ hold: সদ্য জমা টাকা তোলা', 1, '400, টাকা কাটা নয়', `HTTP ${r.status} · ব্যালেন্স ${await balance(u.id)} · "${r.json?.error ?? ''}"`, [r], r.status === 400 && (await balance(u.id)) === 1000);
    await call('hold off', A, 'POST', '/api/admin/settings', { withdrawal_hold_hours: '0' }, { record: false });
  }

  saveJson('races.json', { at: new Date().toISOString(), levels: LEVELS, rows });
  const bad = rows.filter((r) => !r.pass);
  console.log(`\n${bad.length ? '✗' : '✓'} ${rows.length - bad.length}/${rows.length} রেস-দৃশ্য পাস`);
  for (const b of bad) console.log(`  ✗ [${b.n}] ${b.scenario}: ${b.actual}`);
  if (bad.length) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());
