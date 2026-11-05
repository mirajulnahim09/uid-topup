/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ EXTREME রেড-টিম (২০২৬-০৯-২১) — তিনটি পুনরুৎপাদিত ত্রুটির পাহারা
 *
 *   ১. পুরো-ছাড়ের কুপন: প্রিভিউ "৳0.00 দিতে হবে", অর্ডার ভেতরের বার্তা
 *      "অঙ্ক শূন্যের বেশি হতে হবে" — এখন দুটোই একই বোধগম্য ৪০০।
 *   ২. ডেলিভারি-নিশ্চিতকরণ: "পেয়েছি" + "পাইনি" একসাথে → দুটোই বসত।
 *   ৩. অ্যাডমিন FAIL (রিফান্ড) + একই গ্রাহকের নতুন অর্ডার একসাথে →
 *      Postgres deadlock (`40P01`) → ৭২টির ৫০টি ৫০০। কারণ: রিফান্ড আগে
 *      User পরে Variant লক করত, অর্ডার-পথ উল্টো।
 *
 *   সবখানে টাকার invariant: `ব্যালেন্স == শুরু + খতিয়ানের যোগফল`।
 *   (`scripts/verify/race-redteam.ts` একই দাবি আসল ডেভ সার্ভারে মাপে।)
 * ═══════════════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { db } from '../vitest.setup';
import { client, signedInUser, signedInAdmin } from './helpers/app';
import {
  createUser, createVariant, createCoupon, createCompletedOrder, balanceOf, ledgerSum,
} from './helpers/factories';
import { replyToTicket, closeTicket } from '../src/lib/services/tickets';

beforeAll(async () => {
  // ★ next dev প্রথম হিটে রুট compile করে — সমান্তরাল টেস্টের আগে সেরে রাখা
  await client().post('/api/order', { variantId: 1, playerUid: '123456789' });
  await client().post('/api/order/confirm', { orderId: 'x', arrived: true });
  await client().post('/api/admin/order', { orderId: 'x', action: 'COMPLETE' });
  await client().post('/api/coupon/check', { code: 'XXXX', variantId: 1 });
});

describe('পুরো-ছাড়ের কুপন', () => {
  it('ছাড় ≥ দাম: প্রিভিউ ও অর্ডার একই বোধগম্য ৪০০, টাকা কাটে না', async () => {
    const variant = await createVariant(db, { price: 10, stock: -1 });
    const coupon = await createCoupon(db, { type: 'FIXED', value: 50, perUserLimit: 5 });
    const { user, client: c } = await signedInUser(db, { balance: 100 });

    const prev = await c.post<{ error?: string }>('/api/coupon/check', { code: coupon.code, variantId: variant.id });
    const ord = await c.post<{ error?: string }>('/api/order', {
      variantId: variant.id, playerUid: '987654321', couponCode: coupon.code,
    });

    expect(prev.status).toBe(400);
    expect(ord.status).toBe(400);
    expect(ord.body.error).toBe(prev.body.error);
    expect(ord.body.error).not.toContain('অঙ্ক শূন্যের বেশি');

    expect(await balanceOf(db, user.id)).toBe(100);
    expect(await ledgerSum(db, user.id)).toBe(0);
    expect((await db.coupon.findUniqueOrThrow({ where: { id: coupon.id } })).usageCount).toBe(0);
  });

  it('আংশিক ছাড় আগের মতোই কাজ করে (রিগ্রেশন নয়)', async () => {
    const variant = await createVariant(db, { price: 10, stock: -1 });
    const coupon = await createCoupon(db, { type: 'FIXED', value: 4 });
    const { user, client: c } = await signedInUser(db, { balance: 100 });

    const ord = await c.post('/api/order', { variantId: variant.id, playerUid: '987654321', couponCode: coupon.code });
    expect(ord.status).toBe(200);
    expect(await balanceOf(db, user.id)).toBe(94);
    expect(await ledgerSum(db, user.id)).toBe(-6);
  });
});

describe('ডেলিভারি-নিশ্চিতকরণ — দুই উত্তর একসাথে', () => {
  it('প্রতিবার ঠিক একটি গৃহীত, অর্ডারে একটিই তারিখ', async () => {
    const variant = await createVariant(db, { price: 10, stock: -1 });
    const { user, client: c } = await signedInUser(db, {});

    for (let i = 0; i < 5; i++) {
      const order = await createCompletedOrder(db, { userId: user.id, variantId: variant.id, price: 10 });
      const [a, b] = await Promise.all([
        c.post('/api/order/confirm', { orderId: order.id, arrived: true }),
        c.post('/api/order/confirm', { orderId: order.id, arrived: false }),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);

      const row = await db.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(Boolean(row.deliveryConfirmedAt) !== Boolean(row.deliveryDisputedAt)).toBe(true);
      expect(await db.orderEvent.count({ where: { orderId: order.id, actorType: 'CUSTOMER' } })).toBe(1);
    }
  });
});

/**
 * ★ ৪. টিকিট: গ্রাহক বন্ধ করছেন ঠিক যখন অ্যাডমিন উত্তর দিচ্ছেন।
 *   HTTP-তে জানালাটি সরু (২০ বারে ধরা পড়েনি), তাই সার্ভিস সরাসরি ডেকে মাপা —
 *   in-process ২০০ বারে ১১৮ বার বন্ধ টিকিট আবার `ANSWERED` হতো।
 */
describe('টিকিট — বন্ধ ও উত্তর একসাথে', () => {
  it('বন্ধ টিকিট আবার খোলে না, বন্ধ-বার্তার পরে উত্তর জমা হয় না', async () => {
    const user = await createUser(db, {});
    let inconsistent = 0; let replyAfterClose = 0;
    for (let i = 0; i < 40; i++) {
      const t = await db.ticket.create({
        data: {
          userId: user.id, subject: 'রেস', status: 'OPEN', lastMessageAt: new Date(),
          messages: { create: { authorId: user.id, authorName: 'গ্রাহক', isStaff: false, body: 'প্রশ্ন' } },
        },
      });
      await Promise.allSettled([
        replyToTicket({ ticketId: t.id, authorId: 'staff', authorName: 'অ্যাডমিন', isStaff: true, body: 'উত্তর', ownerId: null }),
        closeTicket({ ticketId: t.id, byName: 'গ্রাহক', ownerId: user.id }),
      ]);
      const row = await db.ticket.findUniqueOrThrow({ where: { id: t.id } });
      if (row.closedAt && row.status !== 'CLOSED') inconsistent++;
      const msgs = await db.ticketMessage.findMany({ where: { ticketId: t.id }, orderBy: { createdAt: 'asc' } });
      const ci = msgs.findIndex((m) => m.body.startsWith('— টিকিটটি বন্ধ'));
      if (ci >= 0 && msgs.slice(ci + 1).some((m) => m.isStaff)) replyAfterClose++;
    }
    expect(inconsistent).toBe(0);
    expect(replyAfterClose).toBe(0);
  });
});

describe('রিফান্ড ও নতুন অর্ডার একসাথে — লক-ক্রম', () => {
  it('একই গ্রাহক, একই প্যাকেজ: কোনো ৫০০ নেই, টাকা ও স্টক মেলে', async () => {
    const STOCK = 1000;
    const variant = await createVariant(db, { price: 10, stock: STOCK });
    const { user, client: c } = await signedInUser(db, { balance: 1000 });
    const { client: adm } = await signedInAdmin(db);

    const pending: string[] = [];
    for (let i = 0; i < 8; i++) {
      const r = await c.post<{ orderId: string }>('/api/order', { variantId: variant.id, playerUid: `9${i}0000000` });
      expect(r.status).toBe(200);
      pending.push(r.body.orderId);
    }

    const results = await Promise.all([
      ...pending.map((orderId) =>
        adm.post('/api/admin/order', { orderId, action: 'FAIL', failReason: 'OTHER', adminNote: 'লক-ক্রম পরীক্ষা' })),
      ...pending.map((_, i) =>
        c.post('/api/order', { variantId: variant.id, playerUid: `8${i}0000000` })),
    ]);

    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s >= 500)).toEqual([]);
    expect(statuses.every((s) => s === 200)).toBe(true);

    // ★ টাকা: শুরু ১০০০ − ১৬টি অর্ডার × ১০ + ৮টি রিফান্ড × ১০ = ৯২০
    expect(await balanceOf(db, user.id)).toBe(920);
    expect(await ledgerSum(db, user.id)).toBe(-80);

    const live = await db.order.count({ where: { variantId: variant.id, status: { not: 'REFUNDED' } } });
    expect(live).toBe(8);
    expect((await db.variant.findUniqueOrThrow({ where: { id: variant.id } })).stock).toBe(STOCK - live);
  });
});
