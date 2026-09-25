/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ রিফান্ড-পথ — HTTP দিয়ে (Group D / RUN.md)
 *
 *   কভারেজ: আংশিক · পূর্ণ · over-refund প্রত্যাখ্যান · সমান্তরাল race
 *
 *   ── একটাই অপরিবর্তনীয় নিয়ম ──
 *   `refundedAmount + নতুন অঙ্ক <= price` — সবসময়, লক করা রো থেকে।
 *   এই একটি নিয়মই আংশিক ও পূর্ণ — দুই রিফান্ডকেই বাঁধে। ভাঙলে
 *   গ্রাহক পণ্যও রাখত, দামের চেয়ে বেশি টাকাও ফেরত পেত।
 * ═══════════════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { db } from '../vitest.setup';
import { client, signedInUser, signedInAdmin } from './helpers/app';

// ★ আংশিক ফেরতে এখন idempotency key বাধ্যতামূলক — এখানে প্রতিটি অনুরোধ ইচ্ছাকৃত ও আলাদা,
//   তাই প্রতিবার নতুন চাবি (পুনরাবৃত্তি-আচরণ `admin-money-idempotency.test.ts`-এ)
let rq = 0;
const rid = () => `test-refund-${Date.now().toString(36)}-${rq++}`;
import {
  createVariant, createCompletedOrder, balanceOf, ledgerSum,
} from './helpers/factories';

beforeAll(async () => {
  await client().post('/api/admin/order/refund', { orderId: 'warmup', amount: 1, reason: 'warm', requestId: rid() });
});

/** ★ প্রতিটি টেস্টের সাধারণ শুরু: একজন গ্রাহক + একটি COMPLETED অর্ডার */
async function seedCompletedOrder(price = 100, refundedAmount = 0) {
  const variant = await createVariant(db, { price });
  const { user } = await signedInUser(db, { balance: 0 });
  const order = await createCompletedOrder(db, {
    userId: user.id, variantId: variant.id, price, refundedAmount,
  });
  const { client: adminClient } = await signedInAdmin(db);
  return { user, order, adminClient };
}

describe('রিফান্ড — আংশিক', () => {
  it('আংশিক ফেরত ব্যালেন্স বাড়ায় ও refundedAmount হালনাগাদ করে', async () => {
    const { user, order, adminClient } = await seedCompletedOrder(100);

    const res = await adminClient.post<{ success: boolean; totalRefunded: number }>(
      '/api/admin/order/refund',
      { orderId: order.id, requestId: rid(), amount: 30, reason: 'দেরির ক্ষতিপূরণ' },
    );

    expect(res.status).toBe(200);
    expect(res.body.totalRefunded).toBe(30);

    expect(await balanceOf(db, user.id)).toBe(30);
    expect(await ledgerSum(db, user.id)).toBe(30);

    const entries = await db.ledgerEntry.findMany({ where: { userId: user.id } });
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe('REFUND');
    expect(Number(entries[0].amount)).toBe(30);
    expect(entries[0].refId).toBe(order.id);

    const after = await db.order.findUnique({ where: { id: order.id } });
    expect(Number(after!.refundedAmount)).toBe(30);
    // ★ আংশিক ফেরতে অর্ডার বহাল থাকে
    expect(after!.status).toBe('COMPLETED');
  });

  it('পরপর কয়েকটি আংশিক ফেরত যোগ হয়, দাম পর্যন্ত', async () => {
    const { user, order, adminClient } = await seedCompletedOrder(100);

    for (const amount of [40, 35, 25]) {
      const res = await adminClient.post('/api/admin/order/refund', {
        orderId: order.id, requestId: rid(), amount, reason: `কিস্তি ${amount}`,
      });
      expect(res.status).toBe(200);
    }

    expect(await balanceOf(db, user.id)).toBe(100);
    expect(await ledgerSum(db, user.id)).toBe(100);
    expect(await db.ledgerEntry.count({ where: { userId: user.id } })).toBe(3);

    const after = await db.order.findUnique({ where: { id: order.id } });
    expect(Number(after!.refundedAmount)).toBe(100);
  });
});

describe('রিফান্ড — পূর্ণ ও সীমা', () => {
  it('পুরো দাম একবারে ফেরত দেওয়া যায়', async () => {
    const { user, order, adminClient } = await seedCompletedOrder(250);

    const res = await adminClient.post('/api/admin/order/refund', {
      orderId: order.id, requestId: rid(), amount: 250, reason: 'সম্পূর্ণ ব্যর্থ ডেলিভারি',
    });

    expect(res.status).toBe(200);
    expect(await balanceOf(db, user.id)).toBe(250);
    expect(Number((await db.order.findUnique({ where: { id: order.id } }))!.refundedAmount)).toBe(250);
  });

  it('দামের চেয়ে বেশি ফেরত প্রত্যাখ্যাত — এক পয়সাও যায় না', async () => {
    const { user, order, adminClient } = await seedCompletedOrder(100);

    const res = await adminClient.post<{ error: string }>('/api/admin/order/refund', {
      orderId: order.id, requestId: rid(), amount: 100.01, reason: 'অতিরিক্ত',
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('সর্বোচ্চ');

    expect(await balanceOf(db, user.id)).toBe(0);
    expect(await db.ledgerEntry.count()).toBe(0);
    expect(Number((await db.order.findUnique({ where: { id: order.id } }))!.refundedAmount)).toBe(0);
  });

  it('আংশিক ফেরতের পর অবশিষ্টের বেশি চাইলে প্রত্যাখ্যাত', async () => {
    const { user, order, adminClient } = await seedCompletedOrder(100, 70);

    const res = await adminClient.post<{ error: string }>('/api/admin/order/refund', {
      orderId: order.id, requestId: rid(), amount: 40, reason: 'বাকিটার বেশি',
    });

    expect(res.status).toBe(400);
    // ★ বার্তায় অবশিষ্ট ৩০ বলা থাকতে হবে — অ্যাডমিন যেন অনুমান না করে
    expect(res.body.error).toContain('৳30.00');
    expect(await balanceOf(db, user.id)).toBe(0);

    // ★ ঠিক ৩০ চাইলে যায়
    const ok = await adminClient.post('/api/admin/order/refund', {
      orderId: order.id, requestId: rid(), amount: 30, reason: 'অবশিষ্ট',
    });
    expect(ok.status).toBe(200);
    expect(await balanceOf(db, user.id)).toBe(30);
  });

  it('পুরো ফেরত হয়ে যাওয়া অর্ডারে আর ফেরত নেই (409)', async () => {
    const { user, order, adminClient } = await seedCompletedOrder(100, 100);

    const res = await adminClient.post<{ error: string }>('/api/admin/order/refund', {
      orderId: order.id, requestId: rid(), amount: 1, reason: 'আরেকবার',
    });

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('ইতিমধ্যে ফেরত');
    expect(await balanceOf(db, user.id)).toBe(0);
    expect(await db.ledgerEntry.count()).toBe(0);
  });

  it('চলমান (PENDING) অর্ডারে আংশিক ফেরত দেওয়া যায় না', async () => {
    const variant = await createVariant(db, { price: 100 });
    const { user } = await signedInUser(db, { balance: 0 });
    const order = await db.order.create({
      data: {
        userId: user.id, variantId: variant.id, playerUid: '123456789',
        subtotal: 100, discount: 0, price: 100,
        productName: 'P', variantName: 'V', status: 'PENDING',
      },
    });
    const { client: adminClient } = await signedInAdmin(db);

    const res = await adminClient.post('/api/admin/order/refund', {
      orderId: order.id, requestId: rid(), amount: 50, reason: 'চলমান অর্ডারে',
    });

    expect(res.status).toBe(409);
    expect(await balanceOf(db, user.id)).toBe(0);
  });
});

describe('রিফান্ড — সমান্তরালতা', () => {
  /**
   * ★★★ দুটি ৳৬০ ফেরত একসাথে, অর্ডারের দাম ৳১০০।
   *   লক ছাড়া দুজনেই `refundedAmount = 0` দেখত, দুজনেই পাস করত,
   *   মোট ৳১২০ ফেরত যেত — দামের চেয়ে ২০ টাকা বেশি।
   */
  it('দুটি সমান্তরাল ফেরত মিলে দাম ছাড়াতে পারে না', async () => {
    const { user, order, adminClient } = await seedCompletedOrder(100);

    const results = await Promise.all([
      adminClient.post<{ error?: string }>('/api/admin/order/refund', {
        orderId: order.id, requestId: rid(), amount: 60, reason: 'সমান্তরাল ক',
      }),
      adminClient.post<{ error?: string }>('/api/admin/order/refund', {
        orderId: order.id, requestId: rid(), amount: 60, reason: 'সমান্তরাল খ',
      }),
    ]);

    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 400)).toHaveLength(1);

    // ★★★ মূল দাবি — কখনো ১২০ নয়
    expect(await balanceOf(db, user.id)).toBe(60);
    expect(await ledgerSum(db, user.id)).toBe(60);
    expect(Number((await db.order.findUnique({ where: { id: order.id } }))!.refundedAmount)).toBe(60);
  });

  it('৫টি সমান্তরাল পূর্ণ-ফেরত — একটিই সফল', async () => {
    const { user, order, adminClient } = await seedCompletedOrder(200);

    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        adminClient.post('/api/admin/order/refund', {
          orderId: order.id, requestId: rid(), amount: 200, reason: `চেষ্টা ${i}`,
        }),
      ),
    );

    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await balanceOf(db, user.id)).toBe(200);
    expect(await db.ledgerEntry.count({ where: { userId: user.id } })).toBe(1);
    expect(Number((await db.order.findUnique({ where: { id: order.id } }))!.refundedAmount)).toBe(200);
  });
});
