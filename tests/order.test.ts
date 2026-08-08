/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ অর্ডার-পথ — HTTP দিয়ে, আসল সেশনে (Group D / RUN.md)
 *
 *   কভারেজ: happy path · অপর্যাপ্ত ব্যালেন্স · স্টক শেষ ·
 *           সমান্তরাল double-spend · কুপন over-limit race
 *
 *   ── এখানে বারবার যে invariant যাচাই হয় ──
 *   `ব্যালেন্স == শুরুর ব্যালেন্স + খতিয়ানের যোগফল`
 *   শুরুর ব্যালেন্স ফ্যাক্টরি সরাসরি বসায় (খতিয়ান ছাড়া), তাই খাঁটি
 *   `SUM == balance` এখানে প্রযোজ্য নয় — কিন্তু অ্যাপের লেখা প্রতিটি
 *   এন্ট্রি ব্যালেন্সের পরিবর্তনের সাথে হুবহু মিলতে **বাধ্য**।
 *   এটিই ধরবে যদি কেউ কখনো ব্যালেন্স বদলে খতিয়ান লিখতে ভুলে যায়।
 * ═══════════════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { db } from '../vitest.setup';
import { client, signedInUser } from './helpers/app';
import {
  createUser, createVariant, createCoupon,
  balanceOf, ledgerSum, DEFAULT_PASSWORD,
} from './helpers/factories';

/**
 * ★ `next dev` রুট চাহিদামতো compile করে — প্রথম হিট কয়েক সেকেন্ড।
 *   সমান্তরালতা টেস্টের আগে সেটি সেরে না রাখলে ৫টি অনুরোধ একসাথে
 *   compile-এর অপেক্ষায় বসত এবং মাপা সময় অর্থহীন হতো।
 */
beforeAll(async () => {
  await client().post('/api/order', { variantId: 1, playerUid: '123456789' });
});

describe('অর্ডার — happy path', () => {
  it('ব্যালেন্স কাটে, খতিয়ান লেখে, স্টক কমায়', async () => {
    const variant = await createVariant(db, { price: 150, stock: 3, costPrice: 90 });
    const { user, client: c } = await signedInUser(db, { balance: 500 });

    const res = await c.post<{ success: boolean; orderNo: number; balance: string }>(
      '/api/order',
      { variantId: variant.id, playerUid: '987654321', playerName: 'Tester' },
    );

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // ── টাকা ──
    expect(await balanceOf(db, user.id)).toBe(350);
    expect(await ledgerSum(db, user.id)).toBe(-150);

    const entries = await db.ledgerEntry.findMany({ where: { userId: user.id } });
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe('ORDER');
    expect(Number(entries[0].amount)).toBe(-150);
    // ★ balanceAfter অ্যাপের হিসাব নয়, DB থেকে ফেরত আসা আসল মান
    expect(Number(entries[0].balanceAfter)).toBe(350);

    // ── অর্ডার ও স্টক ──
    const order = await db.order.findFirst({ where: { userId: user.id } });
    expect(order).toBeTruthy();
    expect(Number(order!.price)).toBe(150);
    expect(Number(order!.subtotal)).toBe(150);
    expect(Number(order!.discount)).toBe(0);
    // ★ H1 — costPrice snapshot লক করা রো থেকে
    expect(Number(order!.costPrice)).toBe(90);
    expect(order!.status).toBe('PENDING');
    expect(entries[0].refId).toBe(order!.id);

    const v = await db.variant.findUnique({ where: { id: variant.id } });
    expect(v!.stock).toBe(2);
  });

  it('ক্লায়েন্টের পাঠানো দাম উপেক্ষিত — DB-র দামই কাটা হয়', async () => {
    const variant = await createVariant(db, { price: 200 });
    const { user, client: c } = await signedInUser(db, { balance: 1000 });

    // ★ CLAUDE.md §2.1(৪) — ক্লায়েন্টের দাম/ছাড় কখনো বিশ্বাস নয়
    const res = await c.post('/api/order', {
      variantId: variant.id,
      playerUid: '123456789',
      price: 1,
      subtotal: 1,
      discount: 199,
    });

    expect(res.status).toBe(200);
    expect(await balanceOf(db, user.id)).toBe(800);
    const order = await db.order.findFirst({ where: { userId: user.id } });
    expect(Number(order!.price)).toBe(200);
    expect(Number(order!.discount)).toBe(0);
  });
});

describe('অর্ডার — প্রত্যাখ্যান', () => {
  it('অপর্যাপ্ত ব্যালেন্সে অর্ডার হয় না, টাকা অক্ষত', async () => {
    const variant = await createVariant(db, { price: 500, stock: 5 });
    const { user, client: c } = await signedInUser(db, { balance: 100 });

    const res = await c.post<{ error: string }>('/api/order', {
      variantId: variant.id,
      playerUid: '123456789',
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('পর্যাপ্ত ব্যালেন্স নেই');

    expect(await balanceOf(db, user.id)).toBe(100);
    expect(await db.ledgerEntry.count({ where: { userId: user.id } })).toBe(0);
    expect(await db.order.count()).toBe(0);
    // ★ ব্যর্থ অর্ডারে স্টকও ফেরত থাকতে হবে
    expect((await db.variant.findUnique({ where: { id: variant.id } }))!.stock).toBe(5);
  });

  it('স্টক শূন্য হলে অর্ডার হয় না', async () => {
    const variant = await createVariant(db, { price: 50, stock: 0 });
    const { user, client: c } = await signedInUser(db, { balance: 1000 });

    const res = await c.post<{ error: string }>('/api/order', {
      variantId: variant.id,
      playerUid: '123456789',
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('স্টক শেষ');
    expect(await balanceOf(db, user.id)).toBe(1000);
    expect(await db.ledgerEntry.count()).toBe(0);
    expect(await db.order.count()).toBe(0);
  });

  it('নিষ্ক্রিয় ভ্যারিয়েন্টে অর্ডার হয় না', async () => {
    const variant = await createVariant(db, { price: 50, isActive: false });
    const { user, client: c } = await signedInUser(db, { balance: 1000 });

    const res = await c.post('/api/order', { variantId: variant.id, playerUid: '123456789' });

    expect(res.status).toBe(400);
    expect(await balanceOf(db, user.id)).toBe(1000);
    expect(await db.order.count()).toBe(0);
  });
});

describe('অর্ডার — সমান্তরালতা', () => {
  /**
   * ★★★ double-spend — এই স্যুটের সবচেয়ে গুরুত্বপূর্ণ টেস্ট।
   *
   *   একই সেশন থেকে ৫টি অনুরোধ **একসাথে**। ব্যালেন্সে ঠিক একটি
   *   অর্ডারের টাকা আছে। row-lock ছাড়া পাঁচটিই ব্যালেন্স ১০০ দেখত,
   *   পাঁচটিই পাস করত, ব্যালেন্স হতো −৪০০।
   */
  it('একই ব্যালেন্সে ৫টি সমান্তরাল অর্ডার — ঠিক একটি সফল', async () => {
    const variant = await createVariant(db, { price: 100, stock: -1 });
    const { user, client: c } = await signedInUser(db, { balance: 100 });

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        c.post<{ success?: boolean; error?: string }>('/api/order', {
          variantId: variant.id,
          playerUid: '123456789',
        }),
      ),
    );

    const ok = results.filter((r) => r.status === 200);
    const failed = results.filter((r) => r.status !== 200);

    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(4);
    // ★ ব্যর্থগুলো সবই ব্যালেন্সের কারণে — অন্য কোনো ত্রুটি নয়
    for (const f of failed) {
      expect(f.status).toBe(400);
      expect(f.body.error).toContain('পর্যাপ্ত ব্যালেন্স নেই');
    }

    expect(await db.order.count()).toBe(1);
    expect(await balanceOf(db, user.id)).toBe(0);
    expect(await ledgerSum(db, user.id)).toBe(-100);
    expect(await db.ledgerEntry.count({ where: { userId: user.id } })).toBe(1);
  });

  /**
   * ★★★ স্টক race — ৩ স্টকে ৬ জন একসাথে।
   *   ⚠️ ইচ্ছাকৃতভাবে **আলাদা ইউজার**, প্রত্যেকের যথেষ্ট ব্যালেন্স —
   *   তাই ব্যালেন্স-লক এদের ক্রমিক করে না, একমাত্র ভ্যারিয়েন্ট-লকই করে।
   */
  it('স্টক ৩, ৬ জন একসাথে — ঠিক ৩টি সফল, স্টক ০', async () => {
    const variant = await createVariant(db, { price: 50, stock: 3 });

    const users = await Promise.all(
      Array.from({ length: 6 }, () => createUser(db, { balance: 1000 })),
    );
    const clients = await Promise.all(
      users.map(async (u) => {
        const c = client();
        await c.loginOrThrow(u.email, DEFAULT_PASSWORD);
        return c;
      }),
    );

    const results = await Promise.all(
      clients.map((c) =>
        c.post<{ error?: string }>('/api/order', {
          variantId: variant.id,
          playerUid: '123456789',
        }),
      ),
    );

    expect(results.filter((r) => r.status === 200)).toHaveLength(3);
    expect(await db.order.count()).toBe(3);

    const v = await db.variant.findUnique({ where: { id: variant.id } });
    expect(v!.stock).toBe(0);
    // ★ স্টক কখনো ঋণাত্মক হয়নি
    expect(v!.stock).toBeGreaterThanOrEqual(0);

    // ★ ঠিক ৩ জনের টাকা কাটা, বাকিদের অক্ষত
    let charged = 0;
    for (const u of users) {
      const bal = await balanceOf(db, u.id);
      const sum = await ledgerSum(db, u.id);
      expect(bal).toBe(1000 + sum);          // invariant
      if (bal === 950) charged++;
      else expect(bal).toBe(1000);
    }
    expect(charged).toBe(3);
  });

  /**
   * ★★★ কুপন over-limit race।
   *
   *   ⚠️ সেটআপটি সূক্ষ্ম ও ইচ্ছাকৃত: **আলাদা ইউজার** ও **আলাদা
   *   ভ্যারিয়েন্ট**। ফলে user-lock ও variant-lock কোনোটিই দুটি
   *   অনুরোধকে ক্রমিক করে না — একমাত্র কুপন-রো লকই পারে।
   *   কুপন লক না থাকলে দুজনেই `usageCount = 0 < 1` দেখত এবং
   *   usageLimit=1 কুপন দুবার ব্যবহৃত হতো।
   */
  it('usageLimit=1 কুপনে দুই ইউজার একসাথে — ঠিক একজন পায়', async () => {
    const [v1, v2] = await Promise.all([
      createVariant(db, { price: 100 }),
      createVariant(db, { price: 100 }),
    ]);
    const coupon = await createCoupon(db, {
      code: 'RACE1', type: 'FIXED', value: 10, usageLimit: 1, perUserLimit: 1,
    });

    const [a, b] = await Promise.all([
      signedInUser(db, { balance: 500 }),
      signedInUser(db, { balance: 500 }),
    ]);

    const [ra, rb] = await Promise.all([
      a.client.post<{ error?: string }>('/api/order', {
        variantId: v1.id, playerUid: '111111111', couponCode: 'RACE1',
      }),
      b.client.post<{ error?: string }>('/api/order', {
        variantId: v2.id, playerUid: '222222222', couponCode: 'RACE1',
      }),
    ]);

    const statuses = [ra.status, rb.status].sort();
    expect(statuses).toEqual([200, 400]);

    const loser = ra.status === 400 ? ra : rb;
    expect(loser.body.error).toContain('সীমা শেষ');

    // ★ কুপন ঠিক একবারই গোনা হয়েছে
    const after = await db.coupon.findUnique({ where: { id: coupon.id } });
    expect(after!.usageCount).toBe(1);
    expect(await db.couponUse.count({ where: { couponId: coupon.id } })).toBe(1);
    expect(await db.order.count()).toBe(1);

    // ★ বিজয়ী ছাড় পেয়েছে, পরাজিতের এক পয়সাও কাটেনি
    const winner = ra.status === 200 ? a.user : b.user;
    const lost = ra.status === 200 ? b.user : a.user;
    expect(await balanceOf(db, winner.id)).toBe(410);   // 500 − (100 − 10)
    expect(await balanceOf(db, lost.id)).toBe(500);
    expect(await db.ledgerEntry.count({ where: { userId: lost.id } })).toBe(0);
  });

  /**
   * ★★★ H1 — লকটি **সত্যিই** নেওয়া হয় তার প্রত্যক্ষ প্রমাণ।
   *
   *   ── কেন এই টেস্ট আলাদা করে দরকার ──
   *   উপরের race-টেস্টগুলো "ঠিক একটি সফল" দেখায়, কিন্তু সেগুলো
   *   দুর্বল লকিং-এও কখনো কখনো পাস করে ফেলতে পারত (টাইমিং ভাগ্য)।
   *   একটি টেস্ট ভুল কারণে পাস করলে সেটি টেস্ট না থাকার চেয়েও খারাপ —
   *   মিথ্যা আশ্বাস দেয়। তাই এখানে ভাগ্যের কোনো ভূমিকা নেই:
   *
   *     ১. টেস্ট নিজে ভ্যারিয়েন্ট রো `FOR UPDATE` লক করে ধরে রাখে
   *     ২. লকের ভেতরে দাম ১০০ → ৯৯৯ বদলায় (এখনো commit হয়নি)
   *     ৩. তারপর অর্ডার অনুরোধ পাঠায় — রুটকে **অবশ্যই** লকে আটকাতে হবে
   *     ৪. টেস্ট commit করলে রুট এগোয়
   *
   *   লক না নিলে রুট সাথে সাথে এগোত এবং পুরনো দাম ১০০ কাটত।
   *   ৯৯৯ কাটা মানে দামটি **লক করা রো থেকেই** পড়া হয়েছে — H1 এর
   *   দাবি ঠিক এটাই।
   */
  it('H1 — রুট ভ্যারিয়েন্ট রো লকে অপেক্ষা করে ও লক-করা দাম ব্যবহার করে', async () => {
    const variant = await createVariant(db, { price: 100 });
    const { user, client: c } = await signedInUser(db, { balance: 2000 });

    let orderPromise!: Promise<{ status: number; body: { error?: string } }>;
    let releasedAt = 0;

    await db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Variant" WHERE id = ${variant.id} FOR UPDATE`;
        await tx.variant.update({ where: { id: variant.id }, data: { price: 999 } });

        // ★ লক ধরে রেখেই অনুরোধ পাঠাই — await করি না, নাহলে deadlock
        orderPromise = c.post('/api/order', {
          variantId: variant.id,
          playerUid: '444444444',
        });

        // ★ যথেষ্ট সময় দিই যাতে অনুরোধটি নিশ্চিতভাবে লকে গিয়ে বসে
        await new Promise((r) => setTimeout(r, 1500));

        // ★ এখনো কিছুই কাটেনি — রুট আটকে আছে
        expect(await balanceOf(db, user.id)).toBe(2000);
        releasedAt = Date.now();
      },
      { timeout: 20_000, maxWait: 10_000 },
    );

    const res = await orderPromise;
    expect(res.status).toBe(200);

    // ★ লক ছাড়ার পরেই কেবল সম্পন্ন হয়েছে
    expect(Date.now()).toBeGreaterThanOrEqual(releasedAt);

    // ★★★ মূল দাবি — পুরনো ১০০ নয়, লক-করা ৯৯৯
    expect(await balanceOf(db, user.id)).toBe(1001);
    expect(await ledgerSum(db, user.id)).toBe(-999);
    const order = await db.order.findFirst({ where: { userId: user.id } });
    expect(Number(order!.price)).toBe(999);
    expect(Number(order!.subtotal)).toBe(999);
  });

  /**
   * ★ perUserLimit race — একই ইউজার, একই কুপন, দুটি ট্যাব।
   *   usageLimit অসীম, তাই কেবল per-user সীমাই আটকাতে পারে।
   */
  it('perUserLimit=1 কুপনে একই ইউজারের দুটি সমান্তরাল অর্ডার — একটিই পায়', async () => {
    const variant = await createVariant(db, { price: 100 });
    await createCoupon(db, {
      code: 'PERUSR1', type: 'FIXED', value: 20, usageLimit: null, perUserLimit: 1,
    });
    const { user, client: c } = await signedInUser(db, { balance: 1000 });

    const results = await Promise.all([
      c.post<{ error?: string }>('/api/order', {
        variantId: variant.id, playerUid: '333333333', couponCode: 'PERUSR1',
      }),
      c.post<{ error?: string }>('/api/order', {
        variantId: variant.id, playerUid: '333333333', couponCode: 'PERUSR1',
      }),
    ]);

    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await db.couponUse.count()).toBe(1);

    // ★ একটিই অর্ডার, ছাড় সহ ৮০ কাটা
    expect(await db.order.count()).toBe(1);
    expect(await balanceOf(db, user.id)).toBe(920);
    expect(await ledgerSum(db, user.id)).toBe(-80);
  });
});
