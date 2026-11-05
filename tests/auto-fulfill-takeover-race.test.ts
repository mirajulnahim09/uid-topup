/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ D1-1 / F1 — অটো-ডেলিভারি চলাকালীন অ্যাডমিনের হস্তক্ষেপ ও মৃত ফাংশন
 *
 *   মূল দৃশ্য (সমাধানের আগে runtime-এ মাপা):
 *     [D1-1] provider calls=1 · FAIL=200 · status=REFUNDED · refunds=1 · balance=100
 *   ১. গ্রাহক অর্ডার দেন → টাকা কাটা → অটো-ডেলিভারি অর্ডার ধরে (PROCESSING,
 *      claimedById = system:auto-fulfill) ও ধীর প্রোভাইডারকে ডাকে
 *   ২. ফাঁকে অ্যাডমিন `takeover: true` দিয়ে FAIL → পুরো রিফান্ড
 *   ৩. প্রোভাইডার "delivered" → `completeOrder` অবস্থা বন্ধ দেখে **নীরবে** ফিরত
 *   ফল: ডায়মন্ড + টাকা দুটোই গ্রাহকের; খতিয়ান নিখুঁত মেলায় reconcile কখনো ধরে না।
 *
 *   এই ফাইল প্রতিটি পথ আলাদা করে বন্ধ প্রমাণ করে — সরাসরি FAIL, "PROCESSING তারপর
 *   FAIL" দুই-ধাপ, claim-রুটের টেক-ওভার — এবং দুটি নিরাপত্তা-জাল: বন্ধ অর্ডারে
 *   দেরিতে ডেলিভারি দৃশ্যমান হয়, আর মৃত ফাংশনের claim ক্রনে কিউতে ফেরে।
 * ═══════════════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import { db } from '../vitest.setup';
import { fulfillMockPort, signedInUser, signedInAdmin } from './helpers/app';
import { createVariant, balanceOf, ledgerSum } from './helpers/factories';
import type { Client } from './helpers/http';
import { creditWallet } from '../src/lib/services/wallet';
import { sweepStuckAutoFulfill } from '../src/lib/fulfillment/autoFulfill';
import { AUTO_FULFILL_ACTOR_ID } from '../src/lib/orderClaim';

/**
 * ★ গেট-করা ধীর প্রোভাইডার — উত্তর আটকে থাকে যতক্ষণ না টেস্ট `release()` ডাকে
 *   (সর্বোচ্চ ২.৭s, GAME_API_TIMEOUT_MS ৩s-এর নিচে — এটি ধীর, টাইমআউট নয়)।
 *   আগে স্থির ১.৫s দেরি ছিল: পুরো স্যুটের চাপে অ্যাডমিনের অনুরোধ তার পরে পৌঁছাত,
 *   অর্ডার ততক্ষণে COMPLETED — টাকা ঠিক থাকত কিন্তু পাহারাটি আদৌ পরীক্ষিত হতো না
 *   (মাপা: FAIL=409, code=undefined)। গেট "কল চলাকালীন" অবস্থাটি নিশ্চিত করে।
 */
const MAX_HOLD_MS = 2700;
let server: http.Server;
let calls = 0;
let held: Array<() => void> = [];
function release() {
  const h = held;
  held = [];
  h.forEach((send) => send());
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      calls++;
      let done = false;
      const send = () => {
        if (done) return;
        done = true;
        clearTimeout(t);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'delivered', ref: 'slow-prov-1' }));
      };
      const t = setTimeout(send, MAX_HOLD_MS);
      held.push(send);
    });
  });
  await new Promise<void>((r) => server.listen(fulfillMockPort(), '127.0.0.1', r));
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(() => {
  calls = 0;
  held = [];
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function drift(userId: string): Promise<number> {
  return Math.round((Number(await balanceOf(db, userId)) - Number(await ledgerSum(db, userId))) * 100);
}

/** ★ অটো-ডেলিভারি চালু, গ্রাহকের ৳১০০, অর্ডার পাঠানো — system claim পর্যন্ত অপেক্ষা */
async function orderInFlight(): Promise<{
  admin: Client; orderId: string; userId: string; before: number;
  orderP: Promise<{ status: number }>;
}> {
  const { client: admin } = await signedInAdmin(db);
  const s = await admin.post('/api/admin/settings', {
    order_approval: 'automatic',
    integration_fulfillment_active: 'game-api',
    'integration_fulfillment_game-api_enabled': '1',
  });
  expect(s.status).toBe(200);

  const variant = await createVariant(db, { price: 100 });
  const { user, client: cust } = await signedInUser(db, { balance: 0 });
  await db.$transaction((tx) => creditWallet({ tx, userId: user.id, amount: 100, type: 'DEPOSIT', note: 'D1-1 তহবিল' }));
  const before = await drift(user.id);

  const orderP = cust.post('/api/order', { variantId: variant.id, playerUid: '123456789', clientRef: `d11-${Date.now()}` });

  let orderId = '';
  for (let i = 0; i < 60 && !orderId; i++) {
    const o = await db.order.findFirst({
      where: { userId: user.id, status: 'PROCESSING', claimedById: AUTO_FULFILL_ACTOR_ID },
      select: { id: true },
    });
    if (o) orderId = o.id;
    else await sleep(50);
  }
  expect(orderId, 'অটো-ডেলিভারি অর্ডারটি ধরেনি — সেটআপ ভুল').not.toBe('');
  return { admin, orderId, userId: user.id, before, orderP };
}

/** ★ সঠিক চূড়ান্ত অবস্থা: ডেলিভার হয়েছে, এক পয়সাও ফেরত যায়নি */
async function expectDeliveredNoRefund(orderId: string, userId: string, before: number) {
  const o = await db.order.findUniqueOrThrow({ where: { id: orderId } });
  expect(calls).toBe(1);
  expect(o.status).toBe('COMPLETED');
  expect(o.internalNote ?? '').not.toContain('⏳'); // F1 — সফলতায় "চলছে" নোট থেকে যায় না
  expect(await db.ledgerEntry.count({ where: { refId: orderId, type: 'REFUND' } })).toBe(0);
  expect(Number(await balanceOf(db, userId))).toBe(0);
  expect(await drift(userId)).toBe(before);
}

describe('D1-1 — প্রোভাইডার-কল চলাকালীন অ্যাডমিন চূড়ান্ত সিদ্ধান্ত নিতে পারেন না', () => {
  it('ক. সরাসরি FAIL + takeover → 409 AUTO_IN_FLIGHT; ডায়মন্ড + রিফান্ড একসাথে অসম্ভব', async () => {
    const { admin, orderId, userId, before, orderP } = await orderInFlight();
    const fail = await admin.post('/api/admin/order', { orderId, action: 'FAIL', failReason: 'OUT_OF_STOCK', takeover: true });
    release();
    expect((await orderP).status).toBe(200);
    await sleep(300);
    console.log(`[D1-1 ক] provider calls=${calls} · FAIL=${fail.status} ${fail.body.code ?? ''}`);
    expect(fail.status).toBe(409);
    expect(fail.body.code).toBe('AUTO_IN_FLIGHT');
    await expectDeliveredNoRefund(orderId, userId, before);
  });

  it('খ. দুই-ধাপ বাইপাস: PROCESSING(claim কেড়ে নেওয়া) → FAIL — দুটোই 409', async () => {
    const { admin, orderId, userId, before, orderP } = await orderInFlight();
    const proc = await admin.post('/api/admin/order', { orderId, action: 'PROCESSING', takeover: true });
    const fail = await admin.post('/api/admin/order', { orderId, action: 'FAIL', failReason: 'OUT_OF_STOCK', takeover: true });
    const complete = await admin.post('/api/admin/order', { orderId, action: 'COMPLETE', takeover: true });
    release();
    expect((await orderP).status).toBe(200);
    await sleep(300);
    expect([proc.status, fail.status, complete.status]).toEqual([409, 409, 409]);
    await expectDeliveredNoRefund(orderId, userId, before);
  });

  it('গ. claim-রুটে টেক-ওভার/ছাড়ানো → 409; তারপর FAIL-ও 409', async () => {
    const { admin, orderId, userId, before, orderP } = await orderInFlight();
    const take = await admin.post('/api/admin/order/claim', { orderId, action: 'CLAIM', takeover: true });
    const rel = await admin.post('/api/admin/order/claim', { orderId, action: 'RELEASE' });
    const fail = await admin.post('/api/admin/order', { orderId, action: 'FAIL', failReason: 'OUT_OF_STOCK', takeover: true });
    release();
    expect((await orderP).status).toBe(200);
    await sleep(300);
    expect([take.status, rel.status, fail.status]).toEqual([409, 409, 409]);
    await expectDeliveredNoRefund(orderId, userId, before);
  });

  it('ঘ. বাল্ক COMPLETE চলমান অর্ডার ছোঁয় না', async () => {
    const { admin, orderId, userId, before, orderP } = await orderInFlight();
    const bulk = await admin.post('/api/admin/order/bulk', { orderIds: [orderId], action: 'COMPLETE' });
    release();
    expect((await orderP).status).toBe(200);
    await sleep(300);
    expect(bulk.status).toBeLessThan(500);
    await expectDeliveredNoRefund(orderId, userId, before);
  });
});

describe('D1-1 (খ) নিরাপত্তা-জাল — বন্ধ অর্ডারে দেরিতে ডেলিভারি নীরব থাকে না', () => {
  it('মেয়াদোত্তীর্ণ claim-এ বাতিল-রিফান্ড, তারপর ডেলিভারি → 🚨 নোট + ঘটনাপঞ্জি', async () => {
    const { admin, orderId, orderP } = await orderInFlight();
    // ★ সময়-যন্ত্র: claim ৩ মিনিট পুরনো — চলমান-জানালা (২ মিনিট) পেরিয়ে গেছে,
    //   যেমনটা হয় যখন অ্যাডমিন বহুক্ষণ পর আসেন। তখন বাতিল বৈধ; কিন্তু
    //   তারপর ডেলিভারি এলে সেটি **অবশ্যই** দৃশ্যমান হতে হবে।
    await db.order.update({ where: { id: orderId }, data: { claimedAt: new Date(Date.now() - 3 * 60_000) } });
    const fail = await admin.post('/api/admin/order', { orderId, action: 'FAIL', failReason: 'OUT_OF_STOCK', takeover: true });
    expect(fail.status).toBe(200);
    release();
    expect((await orderP).status).toBe(200);
    await sleep(300);

    const o = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(calls).toBe(1);
    expect(o.status).toBe('REFUNDED'); // টাকা আবার স্বয়ংক্রিয়ভাবে কাটা হয় না — মানুষের সিদ্ধান্ত
    expect(o.internalNote ?? '').toMatch(/^🚨/);
    const ev = await db.orderEvent.findFirst({ where: { orderId, note: { contains: 'দেরিতে ডেলিভারি' } } });
    expect(ev).not.toBeNull();
  });
});

describe('F1 — মৃত ফাংশনের claim ঝাড়ু', () => {
  async function stuckOrder(ageMs: number) {
    const variant = await createVariant(db, { price: 50 });
    const { user } = await signedInUser(db, { balance: 0 });
    return db.order.create({
      data: {
        userId: user.id, variantId: variant.id, playerUid: '123456789',
        subtotal: 50, discount: 0, price: 50, productName: 'P', variantName: 'V',
        status: 'PROCESSING', claimedById: AUTO_FULFILL_ACTOR_ID, claimedByName: 'অটো-ডেলিভারি',
        claimedAt: new Date(Date.now() - ageMs),
        internalNote: '⏳ অটো-ডেলিভারি চলছে — (claim-এর সময়ে লেখা)',
      },
    });
  }

  it('২ মিনিটের বেশি পুরনো system-claim → PENDING, claim মুক্ত, "ফল অজানা" নোট; নতুনটি অস্পৃশ্য', async () => {
    const dead = await stuckOrder(5 * 60_000);
    const live = await stuckOrder(20_000);

    const n = await sweepStuckAutoFulfill();
    expect(n).toBeGreaterThanOrEqual(1);

    const d = await db.order.findUniqueOrThrow({ where: { id: dead.id } });
    expect(d.status).toBe('PENDING');
    expect(d.claimedById).toBeNull();
    expect(d.internalNote ?? '').toContain('ফল অজানা');

    const l = await db.order.findUniqueOrThrow({ where: { id: live.id } });
    expect(l.status).toBe('PROCESSING');
    expect(l.claimedById).toBe(AUTO_FULFILL_ACTOR_ID);
  });

  it('ঝাড়ু কখনো টাকা নড়ায় না (খতিয়ানে নতুন সারি নেই)', async () => {
    const dead = await stuckOrder(10 * 60_000);
    const beforeRows = await db.ledgerEntry.count();
    await sweepStuckAutoFulfill();
    expect(await db.ledgerEntry.count()).toBe(beforeRows);
    expect((await db.order.findUniqueOrThrow({ where: { id: dead.id } })).status).toBe('PENDING');
  });
});
