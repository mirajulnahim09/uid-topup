/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ F2 (ডাইরেক্ট-পে মেয়াদ) ও F4 (ঝুলন্ত-ডিপোজিট সীমার লক)
 *
 *   F4 — `/api/deposit` ও `/api/order/direct` দুটোই "৫টির বেশি PENDING নয়"
 *   নিয়মটি **লক ছাড়া** গুনত, তারপর তৈরি করত। একসাথে ১০টি অনুরোধ এলে সবাই
 *   গণনায় ০–৪ দেখে পাস করত → সীমা অর্থহীন।
 *
 *   F2 — ডাইরেক্ট-পে অর্ডার তৈরিতেই স্টক কাটে (AWAITING_PAYMENT)। পেমেন্ট
 *   যাচাই না হলে সেই স্টক **চিরকাল** আটকে থাকত — ভুয়া TrxID দিয়ে সীমিত স্টক
 *   শেষ করে দেওয়া যেত। সমাধানের অপরিবর্তনীয় শর্ত: মেয়াদে অর্ডার বাতিল হয়,
 *   কিন্তু ডিপোজিট **PENDING-ই থাকে** — গ্রাহক সত্যিই টাকা পাঠিয়ে থাকলে পরে
 *   অনুমোদনে টাকা ওয়ালেটে যায়, হারায় না।
 * ═══════════════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { db } from '../vitest.setup';
import { baseUrl, signedInUser, signedInAdmin } from './helpers/app';
import { createVariant, createCoupon, balanceOf, ledgerSum } from './helpers/factories';
import { TEST_CRON_SECRET } from './helpers/testEnv';
import { expireDirectPayOrders } from '../src/lib/directPayExpiry';

let seq = 0;
const trx = (p: string) => `${p}${Date.now().toString(36).toUpperCase()}${seq++}`.slice(0, 30);
const HOUR = 60 * 60_000;

const runCron = async () => {
  const r = await fetch(`${baseUrl()}/api/cron/sla-breach`, {
    method: 'POST', headers: { authorization: `Bearer ${TEST_CRON_SECRET}` },
  });
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
};

async function drift(userId: string) {
  return Math.round((Number(await balanceOf(db, userId)) - Number(await ledgerSum(db, userId))) * 100);
}

describe('F4 — ঝুলন্ত-ডিপোজিট সীমা (৫) সমান্তরাল ঝাঁকেও অটুট', () => {
  it('/api/deposit — ১০টি একসাথে (ভিন্ন TrxID) → PENDING ≤ ৫', async () => {
    const { user, client: c } = await signedInUser(db, {});
    const res = await Promise.all(Array.from({ length: 10 }, () =>
      c.post('/api/deposit', { method: 'BKASH', amount: 100, senderNo: '01712345678', trxId: trx('CAP') })));
    const pending = await db.deposit.count({ where: { userId: user.id, status: 'PENDING' } });
    console.log(`[F4 deposit] 200=${res.filter((r) => r.status === 200).length} pending=${pending}`);
    expect(res.every((r) => r.status < 500)).toBe(true);
    expect(pending).toBeLessThanOrEqual(5);
  });

  it('/api/order/direct — ১০টি একসাথে → PENDING ≤ ৫, অতিরিক্ত অর্ডারের স্টক কাটে না', async () => {
    const variant = await createVariant(db, { price: 50, stock: 20 });
    const { user, client: c } = await signedInUser(db, {});
    const res = await Promise.all(Array.from({ length: 10 }, () =>
      c.post('/api/order/direct', {
        variantId: variant.id, playerUid: '123456789', method: 'BKASH', amount: 50,
        senderNo: '01712345678', trxId: trx('DCAP'),
      })));
    const pending = await db.deposit.count({ where: { userId: user.id, status: 'PENDING' } });
    const orders = await db.order.count({ where: { userId: user.id } });
    const stock = (await db.variant.findUniqueOrThrow({ where: { id: variant.id } })).stock;
    console.log(`[F4 direct] 200=${res.filter((r) => r.status === 200).length} pending=${pending} orders=${orders} stock=${stock}`);
    expect(res.every((r) => r.status < 500)).toBe(true);
    expect(pending).toBeLessThanOrEqual(5);
    expect(orders).toBe(pending);
    expect(stock).toBe(20 - orders);
  });
});

/** ★ আসল পথে একটি ডাইরেক্ট-পে অর্ডার (স্টক ও কুপনসহ) */
async function directOrder(opts: { stock?: number; coupon?: boolean } = {}) {
  const variant = await createVariant(db, { price: 100, stock: opts.stock ?? 3 });
  const coupon = opts.coupon ? await createCoupon(db, { type: 'FIXED', value: 10 }) : null;
  const { user, client: c } = await signedInUser(db, {});
  const r = await c.post('/api/order/direct', {
    variantId: variant.id, playerUid: '123456789', method: 'BKASH',
    amount: coupon ? 90 : 100, senderNo: '01712345678', trxId: trx('EXP'),
    ...(coupon ? { couponCode: coupon.code } : {}),
  });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  const order = await db.order.findFirstOrThrow({ where: { userId: user.id } });
  const deposit = await db.deposit.findFirstOrThrow({ where: { linkedOrderId: order.id } });
  return { variant, coupon, user, order, deposit };
}

const age = (orderId: string, ms: number) =>
  db.order.update({ where: { id: orderId }, data: { createdAt: new Date(Date.now() - ms) } });


/**
 * ★★★ নির্ধারিত রেস — এলোমেলো দেরিতে নয়, Postgres-এর নিজের লক-সারিতে।
 *
 *   এলোমেলো দেরি অবিশ্বস্ত প্রমাণিত (০–২৫ms: অনুমোদন ১২/১২; ০–৪০০ms: উল্টো ১২/১২)।
 *   এখানে: টেস্ট নিজে Deposit রো লক করে ধরে রাখে (বাধা) → প্রথম প্রতিযোগী ছাড়ে ও
 *   `pg_stat_activity`-তে **লকে আটকে আছে** নিশ্চিত হয় → দ্বিতীয়টি ছাড়ে, **দুজনই একসাথে
 *   আটকে** নিশ্চিত হয় → বাধা খোলে। Postgres সারির অপেক্ষমাণদের আগমন-ক্রমে লক দেয়,
 *   তাই কে জিতবে তা নির্ধারিত — আর প্রতিটি রাউন্ড একটি **সত্যিকারের** সমান্তরাল সংঘাত।
 */
async function lockWaiters(): Promise<number> {
  const r = await db.$queryRaw<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM pg_stat_activity
    WHERE datname = current_database() AND wait_event_type = 'Lock'`;
  return r[0].n;
}
async function waitForWaiters(n: number) {
  for (let i = 0; i < 200; i++) {
    if ((await lockWaiters()) >= n) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`${n}টি লক-অপেক্ষমাণ পাওয়া যায়নি — রেস তৈরি হয়নি, প্রমাণ অবৈধ`);
}
async function forcedRace<A, B>(
  depositId: string,
  first: () => Promise<A>,
  second: () => Promise<B>,
): Promise<[A, B]> {
  let locked!: () => void;
  let open!: () => void;
  const lockedP = new Promise<void>((r) => { locked = r; });
  const gate = new Promise<void>((r) => { open = r; });
  const barrier = db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Deposit" WHERE id = ${depositId} FOR UPDATE`;
    locked();
    await gate;
  }, { timeout: 30_000 });
  await lockedP;
  const base = await lockWaiters();
  const p1 = first();
  await waitForWaiters(base + 1);
  const p2 = second();
  await waitForWaiters(base + 2);
  open();
  await barrier;
  return Promise.all([p1, p2]);
}

describe('F2 — ডাইরেক্ট-পে অর্ডারের মেয়াদ', () => {
  it('মেয়াদোত্তীর্ণ (৩ঘ) → অর্ডার FAILED, স্টক ও কুপন ফেরত, ডিপোজিট PENDING-ই', async () => {
    const { variant, coupon, order, deposit } = await directOrder({ stock: 3, coupon: true });
    expect((await db.variant.findUniqueOrThrow({ where: { id: variant.id } })).stock).toBe(2);
    await age(order.id, 3 * HOUR);

    const r = await runCron();
    expect(r.status).toBe(200);

    const o = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    console.log(`[F2] status=${o.status} stock=${(await db.variant.findUniqueOrThrow({ where: { id: variant.id } })).stock}`);
    expect(o.status).toBe('FAILED');
    expect((await db.variant.findUniqueOrThrow({ where: { id: variant.id } })).stock).toBe(3);
    expect((await db.coupon.findUniqueOrThrow({ where: { id: coupon!.id } })).usageCount).toBe(0);
    expect(await db.couponUse.count({ where: { orderId: order.id } })).toBe(0);
    expect((await db.deposit.findUniqueOrThrow({ where: { id: deposit.id } })).status).toBe('PENDING');
  });

  it('মেয়াদের ভেতরে (৩০ মিনিট) অস্পৃশ্য', async () => {
    const { variant, order } = await directOrder({ stock: 3 });
    await age(order.id, 30 * 60_000);
    await runCron();
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('AWAITING_PAYMENT');
    expect((await db.variant.findUniqueOrThrow({ where: { id: variant.id } })).stock).toBe(2);
  });

  it('মেয়াদের পরে অনুমোদন → টাকা ওয়ালেটে, অর্ডার FAILED-ই, কোনো ORDER কর্তন নেই', async () => {
    const { order, deposit, user } = await directOrder();
    await age(order.id, 3 * HOUR);
    await runCron();
    const before = await drift(user.id);
    const { client: admin } = await signedInAdmin(db);
    const ap = await admin.post('/api/admin/deposit', { depositId: deposit.id, action: 'APPROVE' });
    expect(ap.status).toBe(200);
    expect(Number(await balanceOf(db, user.id))).toBe(100);
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('FAILED');
    expect(await db.ledgerEntry.count({ where: { refId: order.id, type: 'ORDER' } })).toBe(0);
    expect(await drift(user.id)).toBe(before);
  });

  it('মেয়াদ-ক্রন ‖ অ্যাডমিন-অনুমোদন একই মুহূর্তে (১২ রাউন্ড) — ৫০০ নেই, দুই বৈধ ফলের একটি', async () => {
    const { client: admin } = await signedInAdmin(db);
    const outcomes = { approveFirst: 0, expiryFirst: 0 };
    for (let r = 0; r < 12; r++) {
      const { variant, order, deposit, user } = await directOrder({ stock: 3 });
      await age(order.id, 3 * HOUR);
      // ★ জোড় রাউন্ডে অনুমোদন আগে, বিজোড়ে মেয়াদ আগে — দুজনই একসাথে লকে আটকে (নির্ধারিত রেস)
      const approve = () => admin.post('/api/admin/deposit', { depositId: deposit.id, action: 'APPROVE' });
      const expire = () => expireDirectPayOrders();
      const expiryLeads = r % 2 === 1;
      const ap = expiryLeads
        ? (await forcedRace(deposit.id, expire, approve))[1]
        : (await forcedRace(deposit.id, approve, expire))[0];
      expect(ap.status).toBe(200); // অনুমোদন সবসময় সফল — টাকা কখনো হারায় না

      const o = await db.order.findUniqueOrThrow({ where: { id: order.id } });
      const stock = (await db.variant.findUniqueOrThrow({ where: { id: variant.id } })).stock;
      const bal = Number(await balanceOf(db, user.id));
      if (o.status === 'PENDING') {
        // অনুমোদন আগে জিতেছে: টাকা ঢুকে অর্ডারে কেটেছে, স্টক অর্ডারের কাছেই
        expect(bal).toBe(0);
        expect(stock).toBe(2);
        outcomes.approveFirst++;
        expect(expiryLeads, 'অনুমোদন জিতেছে অথচ মেয়াদ আগে লক পেয়েছিল').toBe(false);
      } else {
        // ক্রন আগে জিতেছে: অর্ডার বাতিল, স্টক ফেরত, টাকা ওয়ালেটে
        expect(o.status).toBe('FAILED');
        expect(bal).toBe(100);
        expect(stock).toBe(3);
        outcomes.expiryFirst++;
        expect(expiryLeads, 'মেয়াদ জিতেছে অথচ অনুমোদন আগে লক পেয়েছিল').toBe(true);
      }
      expect(await drift(user.id)).toBe(0);
    }
    // ★ কোন শাখা আসলে চলেছে — এক শাখাই সবসময় জিতলে অন্যটি অপ্রমাণিত থাকে
    console.log(`[F2 race] approveFirst=${outcomes.approveFirst} expiryFirst=${outcomes.expiryFirst}`);
    // ★ দুটি শাখাই অন্তত একবার — নাহলে "দুই বৈধ ফল" দাবিটি অর্ধেক প্রমাণিত
    expect(outcomes.approveFirst).toBeGreaterThan(0);
    expect(outcomes.expiryFirst).toBeGreaterThan(0);
  });
});

describe('F2 — মেয়াদ ‖ অ্যাডমিন-বাতিল: স্টক কখনো দুবার ফেরে না', () => {
  it('১২ রাউন্ড: দুই পথই স্টক ফেরায় — একসাথে এলে ঠিক একবার (লক করা রো-র status পাহারা)', async () => {
    const { client: admin } = await signedInAdmin(db);
    const outcomes = { rejectFirst: 0, expiryFirst: 0 };
    for (let r = 0; r < 12; r++) {
      const { variant, order, deposit } = await directOrder({ stock: 3, coupon: true });
      await age(order.id, 3 * HOUR);
      const reject = () => admin.post('/api/admin/deposit', {
        depositId: deposit.id, action: 'REJECT', rejectReason: 'TRX_NOT_FOUND',
      });
      const expire = () => expireDirectPayOrders();
      const rj = r % 2 === 1
        ? (await forcedRace(deposit.id, expire, reject))[1]
        : (await forcedRace(deposit.id, reject, expire))[0];
      expect(rj.status).toBe(200);

      // ★ অপরিবর্তনীয়: স্টক ঠিক ৩-এ ফেরে (৪ নয়), কুপন-ব্যবহার ঠিক ০ (−১ নয়)
      expect((await db.variant.findUniqueOrThrow({ where: { id: variant.id } })).stock).toBe(3);
      const { couponId } = await db.order.findUniqueOrThrow({ where: { id: order.id } });
      expect((await db.coupon.findUniqueOrThrow({ where: { id: couponId! } })).usageCount).toBe(0);
      expect(await db.couponUse.count({ where: { orderId: order.id } })).toBe(0);
      expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('FAILED');
      expect((await db.deposit.findUniqueOrThrow({ where: { id: deposit.id } })).status).toBe('REJECTED');

      const ev = await db.orderEvent.findMany({ where: { orderId: order.id, status: 'FAILED' } });
      if (ev.some((e) => e.actorType === 'SYSTEM')) outcomes.expiryFirst++;
      else outcomes.rejectFirst++;
      expect(ev).toHaveLength(1); // ঠিক একটি পথ অর্ডারটি বন্ধ করেছে
    }
    console.log(`[F2 reject-race] rejectFirst=${outcomes.rejectFirst} expiryFirst=${outcomes.expiryFirst}`);
    expect(outcomes.rejectFirst).toBeGreaterThan(0);
    expect(outcomes.expiryFirst).toBeGreaterThan(0);
  });
});
