/**
 * ═══════════════════════════════════════════════════════════
 * ★ রিসেলার ব্যবস্থাপনা — অ্যাডমিন API (Group F)
 *
 *   এটি ছাড়া ফিচারটি মালিকের কাছে **অব্যবহার্য** — tier ও
 *   resellerPrice কেবল কাঁচা SQL দিয়ে বসানো যেত।
 * ═══════════════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { db } from '../vitest.setup';
import { signedInUser, signedInAdmin } from './helpers/app';
import { createVariant, balanceOf } from './helpers/factories';

describe('অ্যাডমিন — গ্রাহক-স্তর', () => {
  it('অ্যাডমিন কাউকে রিসেলার বানাতে ও ফেরাতে পারে', async () => {
    const { user } = await signedInUser(db, {});
    const { client: adminClient } = await signedInAdmin(db);

    const up = await adminClient.raw('/api/admin/user/tier', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: user.id, tier: 'RESELLER' }),
    });
    expect(up.status).toBe(200);
    expect((await db.user.findUnique({ where: { id: user.id } }))!.tier).toBe('RESELLER');

    const down = await adminClient.raw('/api/admin/user/tier', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: user.id, tier: 'NORMAL' }),
    });
    expect(down.status).toBe(200);
    expect((await db.user.findUnique({ where: { id: user.id } }))!.tier).toBe('NORMAL');
  });

  it('অবৈধ স্তর প্রত্যাখ্যাত', async () => {
    const { user } = await signedInUser(db, {});
    const { client: adminClient } = await signedInAdmin(db);

    const res = await adminClient.raw('/api/admin/user/tier', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: user.id, tier: 'PLATINUM' }),
    });

    expect(res.status).toBe(400);
    expect((await db.user.findUnique({ where: { id: user.id } }))!.tier).toBe('NORMAL');
  });

  it('সাধারণ ইউজার নিজেকে রিসেলার বানাতে পারে না (403)', async () => {
    const { user, client: c } = await signedInUser(db, {});

    const res = await c.raw('/api/admin/user/tier', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: user.id, tier: 'RESELLER' }),
    });

    expect(res.status).toBe(403);
    // ★★★ সবচেয়ে গুরুত্বপূর্ণ — নিজে নিজে ছাড় নিতে পারে না
    expect((await db.user.findUnique({ where: { id: user.id } }))!.tier).toBe('NORMAL');
  });

  it('স্তর বদলালে পুরনো অর্ডার ও খতিয়ান অপরিবর্তিত থাকে', async () => {
    const variant = await createVariant(db, { price: 100, resellerPrice: 60 });
    const { user, client: c } = await signedInUser(db, { balance: 500 });

    await c.post('/api/order', { variantId: variant.id, playerUid: '123456789' });
    const before = await db.order.findFirst({ where: { userId: user.id } });
    expect(Number(before!.price)).toBe(100);

    const { client: adminClient } = await signedInAdmin(db);
    await adminClient.raw('/api/admin/user/tier', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: user.id, tier: 'RESELLER' }),
    });

    // ★ পুরনো অর্ডারের snapshot বদলায়নি — ইতিহাস পুনর্লিখিত হয় না
    const after = await db.order.findUnique({ where: { id: before!.id } });
    expect(Number(after!.price)).toBe(100);
    expect(await balanceOf(db, user.id)).toBe(400);
  });
});

describe('অ্যাডমিন — রিসেলার দাম', () => {
  it('অ্যাডমিন resellerPrice বসাতে ও তুলে নিতে পারে', async () => {
    const variant = await createVariant(db, { price: 100 });
    const { client: adminClient } = await signedInAdmin(db);

    const set = await adminClient.raw('/api/admin/variant', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: variant.id, resellerPrice: 65 }),
    });
    expect(set.status).toBe(200);
    expect(
      Number((await db.variant.findUnique({ where: { id: variant.id } }))!.resellerPrice),
    ).toBe(65);

    // ★ খালি পাঠালে ছাড় তুলে নেওয়া হয় (oldPrice এর মতোই)
    const clear = await adminClient.raw('/api/admin/variant', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: variant.id, resellerPrice: '' }),
    });
    expect(clear.status).toBe(200);
    expect(
      (await db.variant.findUnique({ where: { id: variant.id } }))!.resellerPrice,
    ).toBeNull();
  });

  /**
   * ★★★ ০ প্রত্যাখ্যাত — অ্যাডমিন যেন ভুল করে "ফ্রি" ভেবে না বসান।
   *   অর্ডার-পথ ০ উপেক্ষা করে পুরো দাম নিত, অর্থাৎ অ্যাডমিন ভাবতেন
   *   ছাড় দিয়েছেন অথচ গ্রাহক পুরো দাম দিতেন — নীরব বিভ্রান্তি।
   */
  it('resellerPrice = 0 প্রত্যাখ্যাত, পরিষ্কার বার্তাসহ', async () => {
    const variant = await createVariant(db, { price: 100 });
    const { client: adminClient } = await signedInAdmin(db);

    const res = await adminClient.raw('/api/admin/variant', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: variant.id, resellerPrice: 0 }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('০ এর বেশি');
    expect(
      (await db.variant.findUnique({ where: { id: variant.id } }))!.resellerPrice,
    ).toBeNull();
  });

  it('ঋণাত্মক resellerPrice প্রত্যাখ্যাত', async () => {
    const variant = await createVariant(db, { price: 100 });
    const { client: adminClient } = await signedInAdmin(db);

    const res = await adminClient.raw('/api/admin/variant', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: variant.id, resellerPrice: -10 }),
    });
    expect(res.status).toBe(400);
  });

  it('সাধারণ ইউজার resellerPrice বদলাতে পারে না (403)', async () => {
    const variant = await createVariant(db, { price: 100, resellerPrice: 70 });
    const { client: c } = await signedInUser(db, {});

    const res = await c.raw('/api/admin/variant', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: variant.id, resellerPrice: 1 }),
    });

    expect(res.status).toBe(403);
    expect(
      Number((await db.variant.findUnique({ where: { id: variant.id } }))!.resellerPrice),
    ).toBe(70);
  });

  it('অ্যাডমিন দাম বসানোর পর রিসেলার সাথে সাথেই সেটি পান', async () => {
    const variant = await createVariant(db, { price: 200 });
    const { user, client: c } = await signedInUser(db, { balance: 500 });
    const { client: adminClient } = await signedInAdmin(db);

    // ★ দুটোই API দিয়ে — end-to-end, কাঁচা SQL নয়
    await adminClient.raw('/api/admin/user/tier', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: user.id, tier: 'RESELLER' }),
    });
    await adminClient.raw('/api/admin/variant', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: variant.id, resellerPrice: 120 }),
    });

    const res = await c.post('/api/order', { variantId: variant.id, playerUid: '123456789' });
    expect(res.status).toBe(200);
    expect(await balanceOf(db, user.id)).toBe(380);   // 500 − 120
  });
});
