/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ বাসি দাম — গ্রাহক যা দেখে নিশ্চিত করেছেন তার বেশি কাটা নয়
 *
 *   ── কোন বাগটি এই ফাইল আটকায় (ব্রাউজারে মাপা, ২০২৬-০৯-১৭) ──
 *   পাতা খোলার পর অ্যাডমিন দাম ৳৫০ → ৳৬০ করলেন। নিশ্চিতকরণ ডায়ালগে
 *   ৳৫০ দেখানো অবস্থায় গ্রাহক "হ্যাঁ" চাপলেন, আর কোনো সতর্কতা ছাড়াই
 *   ৳৬০ কাটা হলো (`scripts/verify/customer-journey.ts` §৮)।
 *
 *   এখন ক্লায়েন্ট `expectedPrice` পাঠায়। দাবিগুলো:
 *     · আসল দাম বেশি → ৪০৯ PRICE_CHANGED, **কিছুই** বদলায় না
 *     · সমান → আগের মতো
 *     · কম → চলে, এবং কাটা হয় আসল (কম) দাম — ক্লায়েন্টের সংখ্যা নয়
 *     · না পাঠালে → আগের আচরণ (রিসেলার API, পুরনো ক্লায়েন্ট)
 *     · কুপনসহ মোটের সাথে তুলনা
 *     · রিসেলার ওয়েবে খুচরা দাম দেখে কম দামে কিনতে পারেন
 * ═══════════════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { db } from '../vitest.setup';
import { signedInUser } from './helpers/app';
import { createVariant, createCoupon, balanceOf, ledgerSum } from './helpers/factories';

describe('বাসি দাম — expectedPrice', () => {
  it('আসল দাম বেশি হলে ৪০৯, আর অর্ডার/টাকা/স্টক কিছুই বদলায় না', async () => {
    const variant = await createVariant(db, { price: 60, stock: 4 });
    const { user, client: c } = await signedInUser(db, { balance: 500 });

    const res = await c.post<{ error: string; code: string }>('/api/order', {
      variantId: variant.id, playerUid: '123456789', expectedPrice: 50,
    });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PRICE_CHANGED');
    expect(res.body.error).toContain('৳60.00');
    expect(await balanceOf(db, user.id)).toBe(500);
    expect(await ledgerSum(db, user.id)).toBe(0);
    expect(await db.order.count({ where: { userId: user.id } })).toBe(0);
    expect((await db.variant.findUnique({ where: { id: variant.id } }))!.stock).toBe(4);
  });

  it('সমান দামে অর্ডার হয়', async () => {
    const variant = await createVariant(db, { price: 60 });
    const { user, client: c } = await signedInUser(db, { balance: 500 });
    const res = await c.post('/api/order', { variantId: variant.id, playerUid: '123456789', expectedPrice: 60 });
    expect(res.status).toBe(200);
    expect(await balanceOf(db, user.id)).toBe(440);
  });

  it('দাম কমে গেলে অর্ডার হয়, আর কাটা হয় আসল (কম) দাম', async () => {
    const variant = await createVariant(db, { price: 40 });
    const { user, client: c } = await signedInUser(db, { balance: 500 });
    const res = await c.post('/api/order', { variantId: variant.id, playerUid: '123456789', expectedPrice: 50 });
    expect(res.status).toBe(200);
    // ★ ক্লায়েন্টের ৫০ কখনো কাটা হয় না — DB-র ৪০
    expect(await balanceOf(db, user.id)).toBe(460);
    expect(await ledgerSum(db, user.id)).toBe(-40);
  });

  it('expectedPrice না পাঠালে আগের আচরণ', async () => {
    const variant = await createVariant(db, { price: 75 });
    const { user, client: c } = await signedInUser(db, { balance: 500 });
    const res = await c.post('/api/order', { variantId: variant.id, playerUid: '123456789' });
    expect(res.status).toBe(200);
    expect(await balanceOf(db, user.id)).toBe(425);
  });

  it('কুপনসহ মোটের সাথে তুলনা হয়', async () => {
    const variant = await createVariant(db, { price: 100 });
    const coupon = await createCoupon(db, { type: 'FIXED', value: 10 });
    const { user, client: c } = await signedInUser(db, { balance: 500 });

    const stale = await c.post('/api/order', {
      variantId: variant.id, playerUid: '123456789', couponCode: coupon.code, expectedPrice: 85,
    });
    expect(stale.status).toBe(409);
    expect((await db.coupon.findUnique({ where: { id: coupon.id } }))!.usageCount).toBe(0);

    const ok = await c.post('/api/order', {
      variantId: variant.id, playerUid: '123456789', couponCode: coupon.code, expectedPrice: 90,
    });
    expect(ok.status).toBe(200);
    expect(await balanceOf(db, user.id)).toBe(410);
  });

  it('রিসেলার ওয়েবে খুচরা দাম দেখে কম (রিসেলার) দামে কিনতে পারেন', async () => {
    const variant = await createVariant(db, { price: 100, resellerPrice: 80 });
    const { user, client: c } = await signedInUser(db, { balance: 500 });
    await db.user.update({ where: { id: user.id }, data: { tier: 'RESELLER' } });

    const res = await c.post('/api/order', { variantId: variant.id, playerUid: '123456789', expectedPrice: 100 });
    expect(res.status).toBe(200);
    expect(await balanceOf(db, user.id)).toBe(420);
  });

  it('অবৈধ expectedPrice (ঋণাত্মক, লেখা) → ৪০০ বাংলা বার্তায়; null = পাঠানো হয়নি', async () => {
    const variant = await createVariant(db, { price: 60 });
    const { user, client: c } = await signedInUser(db, { balance: 500 });
    for (const bad of [-1, 'abc']) {
      const r = await c.post<{ error: string }>('/api/order', { variantId: variant.id, playerUid: '123456789', expectedPrice: bad });
      expect(r.status).toBe(400);
      expect(r.body.error).toBe('দামের মান সঠিক নয়');
    }
    expect(await balanceOf(db, user.id)).toBe(500);

    // ★ `null` কে ০ ধরে ৪০৯ দেওয়া হয় না — আগের আচরণ
    const n = await c.post('/api/order', { variantId: variant.id, playerUid: '123456789', expectedPrice: null });
    expect(n.status).toBe(200);
    expect(await balanceOf(db, user.id)).toBe(440);
  });
});
