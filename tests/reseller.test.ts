/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ রিসেলার স্তর ও রিসেলার দাম (Group F)
 *
 *   ── সবচেয়ে গুরুত্বপূর্ণ দাবি ──
 *   সাধারণ গ্রাহক **কখনোই** রিসেলার দাম পান না। এটি ভাঙলে সরাসরি
 *   রাজস্ব ক্ষতি, আর খতিয়ান দেখে ধরাও কঠিন — কারণ প্রতিটি অর্ডার
 *   আলাদাভাবে "বৈধ" দেখাবে, শুধু দামটাই ভুল।
 *
 *   ── দ্বিতীয় দাবি ──
 *   রিসেলারও কেবল সেই প্যাকেজে ছাড় পান যেখানে `resellerPrice`
 *   **স্পষ্টভাবে বসানো**। `null` = ছাড় নেই → সাধারণ দাম।
 * ═══════════════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { db } from '../vitest.setup';
import { client, signedInUser } from './helpers/app';
import { createVariant, createCoupon, balanceOf, ledgerSum } from './helpers/factories';

beforeAll(async () => {
  await client().post('/api/order', { variantId: 1, playerUid: '123456789' });
});

/** ★ tier সরাসরি বসাই — অ্যাডমিন UI-র নিজস্ব টেস্ট আলাদা */
async function makeReseller(userId: string) {
  await db.user.update({ where: { id: userId }, data: { tier: 'RESELLER' } });
}

describe('রিসেলার দাম', () => {
  it('রিসেলার ছাড়ের দাম পান, খতিয়ানে চিহ্ন থাকে', async () => {
    const variant = await createVariant(db, { price: 100, resellerPrice: 70 });
    const { user, client: c } = await signedInUser(db, { balance: 500 });
    await makeReseller(user.id);

    const res = await c.post('/api/order', { variantId: variant.id, playerUid: '123456789' });
    expect(res.status).toBe(200);

    expect(await balanceOf(db, user.id)).toBe(430);   // 500 − 70
    expect(await ledgerSum(db, user.id)).toBe(-70);

    const order = await db.order.findFirst({ where: { userId: user.id } });
    expect(Number(order!.price)).toBe(70);
    expect(Number(order!.subtotal)).toBe(70);

    // ★ খতিয়ানে রিসেলার অর্ডার আলাদাভাবে চেনা যায়
    const entry = await db.ledgerEntry.findFirst({ where: { userId: user.id } });
    expect(entry!.note).toContain('[রিসেলার]');
  });

  /** ★★★ এই স্যুটের মূল টেস্ট */
  it('সাধারণ গ্রাহক একই প্যাকেজে পুরো দাম দেন', async () => {
    const variant = await createVariant(db, { price: 100, resellerPrice: 70 });
    const { user, client: c } = await signedInUser(db, { balance: 500 });
    // ★ tier বদলাইনি — ডিফল্ট NORMAL

    const res = await c.post('/api/order', { variantId: variant.id, playerUid: '123456789' });
    expect(res.status).toBe(200);

    expect(await balanceOf(db, user.id)).toBe(400);   // 500 − 100, ছাড় নয়
    expect(await ledgerSum(db, user.id)).toBe(-100);

    const order = await db.order.findFirst({ where: { userId: user.id } });
    expect(Number(order!.price)).toBe(100);

    const entry = await db.ledgerEntry.findFirst({ where: { userId: user.id } });
    expect(entry!.note).not.toContain('[রিসেলার]');
  });

  it('resellerPrice না থাকলে রিসেলারও সাধারণ দাম দেন', async () => {
    // ★ resellerPrice = null (ডিফল্ট)
    const variant = await createVariant(db, { price: 100 });
    const { user, client: c } = await signedInUser(db, { balance: 500 });
    await makeReseller(user.id);

    const res = await c.post('/api/order', { variantId: variant.id, playerUid: '123456789' });
    expect(res.status).toBe(200);

    expect(await balanceOf(db, user.id)).toBe(400);
    const entry = await db.ledgerEntry.findFirst({ where: { userId: user.id } });
    expect(entry!.note).not.toContain('[রিসেলার]');
  });

  /**
   * ★ মাপা সীমাবদ্ধতা: "ফ্রি অর্ডার" এই সিস্টেমে সম্ভব নয়, কারণ
   *   প্রতিটি অর্ডার একটি **ধনাত্মক** খতিয়ান-এন্ট্রি লেখে।
   *
   *   প্রথমে ধরে নিয়েছিলাম `0` মানে "ফ্রি" — টেস্ট চালিয়ে দেখা গেল
   *   অর্ডার ৪০০ দিয়ে ব্যর্থ হয় ("অঙ্ক শূন্যের বেশি হতে হবে"), যা
   *   অ্যাডমিনের কাছে দুর্বোধ্য। তাই `0` এখন **অবৈধ** ধরা হয় ও
   *   ঋণাত্মকের মতোই উপেক্ষিত — গ্রাহকের অর্ডার আটকায় না।
   */
  it('resellerPrice = 0 অবৈধ — উপেক্ষিত, সাধারণ দাম প্রযোজ্য', async () => {
    const variant = await createVariant(db, { price: 100, resellerPrice: 0 });
    const { user, client: c } = await signedInUser(db, { balance: 500 });
    await makeReseller(user.id);

    const res = await c.post('/api/order', { variantId: variant.id, playerUid: '123456789' });

    // ★ অর্ডার সফল — দুর্বোধ্য ত্রুটিতে আটকে যায় না
    expect(res.status).toBe(200);
    expect(await balanceOf(db, user.id)).toBe(400);   // সাধারণ দাম ১০০
    expect(await ledgerSum(db, user.id)).toBe(-100);
  });

  it('রিসেলার দামের উপরেই কুপন বসে, সাধারণ দামের উপর নয়', async () => {
    const variant = await createVariant(db, { price: 200, resellerPrice: 100 });
    await createCoupon(db, { code: 'RSL10', type: 'FIXED', value: 10, perUserLimit: 1 });
    const { user, client: c } = await signedInUser(db, { balance: 500 });
    await makeReseller(user.id);

    const res = await c.post('/api/order', {
      variantId: variant.id, playerUid: '123456789', couponCode: 'RSL10',
    });
    expect(res.status).toBe(200);

    // ★★★ ১০০ − ১০ = ৯০ (২০০ − ১০ = ১৯০ **নয়**)
    expect(await balanceOf(db, user.id)).toBe(410);
    const order = await db.order.findFirst({ where: { userId: user.id } });
    expect(Number(order!.subtotal)).toBe(100);
    expect(Number(order!.discount)).toBe(10);
    expect(Number(order!.price)).toBe(90);
  });

  /**
   * ★ শতাংশ-কুপন — এখানেই ভুল হলে সবচেয়ে বেশি টাকা বেরিয়ে যেত।
   *   কুপন যদি সাধারণ দামের উপর হিসাব হতো, রিসেলার ২০% পেতেন ২০০-র
   *   উপর (৳৪০) অথচ দিতেন ১০০ — অর্থাৎ ৳৬০, প্রাপ্যের চেয়ে ২০ কম।
   */
  it('শতাংশ কুপনও রিসেলার দামের উপর হিসাব হয়', async () => {
    const variant = await createVariant(db, { price: 200, resellerPrice: 100 });
    await createCoupon(db, { code: 'PCT20', type: 'PERCENT', value: 20, perUserLimit: 1 });
    const { user, client: c } = await signedInUser(db, { balance: 500 });
    await makeReseller(user.id);

    const res = await c.post('/api/order', {
      variantId: variant.id, playerUid: '123456789', couponCode: 'PCT20',
    });
    expect(res.status).toBe(200);

    // ★ ১০০ এর ২০% = ২০ → ৮০ (২০০ এর ২০% = ৪০ → ৬০ **নয়**)
    expect(await balanceOf(db, user.id)).toBe(420);
    const order = await db.order.findFirst({ where: { userId: user.id } });
    expect(Number(order!.discount)).toBe(20);
    expect(Number(order!.price)).toBe(80);
  });

  it('কুপনের minOrder রিসেলার দামের বিপরীতে যাচাই হয়', async () => {
    // ★ minOrder 150; রিসেলার দাম 100 → কুপন প্রযোজ্য নয়
    const variant = await createVariant(db, { price: 200, resellerPrice: 100 });
    await createCoupon(db, { code: 'MIN150', type: 'FIXED', value: 10, minOrder: 150 });
    const { user, client: c } = await signedInUser(db, { balance: 500 });
    await makeReseller(user.id);

    const res = await c.post<{ error?: string }>('/api/order', {
      variantId: variant.id, playerUid: '123456789', couponCode: 'MIN150',
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('সর্বনিম্ন অর্ডার');
    // ★ কোনো টাকা কাটেনি
    expect(await balanceOf(db, user.id)).toBe(500);
    expect(await db.order.count()).toBe(0);
  });

  it('ঋণাত্মক resellerPrice উপেক্ষিত — সাধারণ দামে ফিরে যায়', async () => {
    const variant = await createVariant(db, { price: 100 });
    // ★ ম্যানুয়াল SQL/বাগে ঢুকে যাওয়া অসম্ভব মান অনুকরণ করি
    await db.$executeRaw`UPDATE "Variant" SET "resellerPrice" = -50 WHERE id = ${variant.id}`;

    const { user, client: c } = await signedInUser(db, { balance: 500 });
    await makeReseller(user.id);

    const res = await c.post('/api/order', { variantId: variant.id, playerUid: '123456789' });
    expect(res.status).toBe(200);

    // ★★★ ব্যালেন্স কখনো **বাড়েনি** — ঋণাত্মক দামে টাকা তৈরি হয়নি
    expect(await balanceOf(db, user.id)).toBe(400);
    expect(await ledgerSum(db, user.id)).toBe(-100);
  });

  it('tier বদলালে পরের অর্ডার থেকেই নতুন দাম', async () => {
    const variant = await createVariant(db, { price: 100, resellerPrice: 60 });
    const { user, client: c } = await signedInUser(db, { balance: 1000 });

    await c.post('/api/order', { variantId: variant.id, playerUid: '111111111' });
    expect(await balanceOf(db, user.id)).toBe(900);   // সাধারণ

    await makeReseller(user.id);
    await c.post('/api/order', { variantId: variant.id, playerUid: '222222222' });
    expect(await balanceOf(db, user.id)).toBe(840);   // রিসেলার

    expect(await ledgerSum(db, user.id)).toBe(-160);
    expect(await db.order.count()).toBe(2);
  });
});
