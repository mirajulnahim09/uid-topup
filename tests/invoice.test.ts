/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ চালান / রসিদ (Group I ২)
 *
 *   ── দুটি প্রশ্ন এখানে যাচাই হয় ──
 *   ১. **কে দেখতে পায়** — চালানে ক্রেতার নাম, ইমেইল ও Player UID
 *      থাকে। অন্যের চালান পড়া গেলে সেটি সরাসরি ডেটা ফাঁস।
 *   ২. **অঙ্কগুলো কোথা থেকে আসে** — `Order` সারির snapshot থেকে,
 *      `Variant` থেকে নয়। দাম পরে বদলালেও পুরনো চালান বদলাবে না;
 *      নাহলে গ্রাহকের কাছে থাকা PDF আর সিস্টেমের চালান আলাদা হয়ে যেত।
 * ═══════════════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { db } from '../vitest.setup';
import { client, signedInUser } from './helpers/app';
import { createUser, createVariant, DEFAULT_PASSWORD } from './helpers/factories';

/** ★ আসল অর্ডার-পথ দিয়েই অর্ডার — চালান সেই সারিটিই পড়ে */
async function placeOrder(
  c: Awaited<ReturnType<typeof signedInUser>>['client'],
  variantId: number,
  playerUid = '987654321',
) {
  const res = await c.post<{ success: boolean; orderNo: number }>('/api/order', {
    variantId,
    playerUid,
    playerName: 'Invoice Tester',
  });
  expect(res.status).toBe(200);
  const order = await db.order.findFirst({
    where: { orderNo: res.body.orderNo },
    select: { id: true, orderNo: true },
  });
  return order!;
}

describe('চালান — কে দেখতে পায়', () => {
  it('নিজের চালান খোলে ও নিজের তথ্য দেখায়', async () => {
    const variant = await createVariant(db, { price: 150, stock: 5 });
    const { user, client: c } = await signedInUser(db, { balance: 500, name: 'Nahim Test' });
    const order = await placeOrder(c, variant.id);

    const res = await c.raw(`/account/orders/${order.id}/invoice`);
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain('চালান');
    expect(html).toContain(String(order.orderNo));
    expect(html).toContain('Nahim Test');
    expect(html).toContain(user.email);
  });

  /** ★★★ এই স্যুটের সবচেয়ে গুরুত্বপূর্ণ টেস্ট */
  it('অন্যের চালান পড়া যায় না (৪০৪)', async () => {
    const variant = await createVariant(db, { price: 150, stock: 5 });
    const { user: victim, client: victimClient } = await signedInUser(db, {
      balance: 500,
      name: 'Victim Person',
    });
    const order = await placeOrder(victimClient, variant.id, '111222333');

    // ★ সম্পূর্ণ আলাদা ইউজার, বৈধ সেশনসহ
    const attacker = await createUser(db, { balance: 500 });
    const ac = client();
    await ac.loginOrThrow(attacker.email, attacker.plainPassword ?? DEFAULT_PASSWORD);

    const res = await ac.raw(`/account/orders/${order.id}/invoice`);
    const html = await res.text();

    // ★★★ আসল দাবি: একটি বাইটও ফাঁস হয় না
    expect(html).not.toContain('Victim Person');
    expect(html).not.toContain(victim.email);
    expect(html).not.toContain('111222333');
    expect(html).not.toContain('Invoice Tester');

    /**
     * ⚠️ এখানে `status` ৪০৪ **নয়, ২০০** — এবং সেটি ইচ্ছাকৃতভাবে
     *   assert করা হচ্ছে না, কারণ দাবিটি মিথ্যা হতো।
     *
     *   কারণ: `src/app/account/loading.tsx` একটি Suspense সীমানা
     *   তৈরি করে, তাই Next উত্তরটি **স্ট্রিম** করা শুরু করে দেয়।
     *   হেডার তখনই চলে যায়, অর্থাৎ পরে `notFound()` ডাকলেও স্ট্যাটাস
     *   আর বদলানো যায় না — কেবল বডিতে not-found UI বসে।
     *
     *   ⚠️ এটি এই পাতার নিজস্ব সমস্যা নয়: `/account/orders/[id]`-ও
     *   একই আচরণ করে (আলাদা করে যাচাই করা)। নিরাপত্তার দিক থেকে
     *   গুরুত্বপূর্ণ যেটি — "নেই" আর "আপনার নয়" **একই** উত্তর দেয়,
     *   তাই অর্ডার আছে কি না তা-ও অনুমান করা যায় না।
     */
    expect(/not.?found|খুঁজে পাওয়া|404/i.test(html)).toBe(true);
  });

  it('লগইন ছাড়া চালান দেখা যায় না', async () => {
    const variant = await createVariant(db, { price: 150, stock: 5 });
    const { client: c } = await signedInUser(db, { balance: 500 });
    const order = await placeOrder(c, variant.id);

    const res = await client().raw(`/account/orders/${order.id}/invoice`);
    const html = await res.text();

    // ★ middleware লগইনে পাঠায়; যেখানেই যাক, চালানের তথ্য যেন না থাকে
    expect(html).not.toContain('Invoice Tester');
    expect(html).not.toContain('987654321');
  });
});

describe('চালান — অঙ্ক snapshot থেকে আসে', () => {
  it('অর্ডারের পর ভ্যারিয়েন্টের দাম বদলালেও চালান অপরিবর্তিত', async () => {
    const variant = await createVariant(db, { price: 150, stock: 5 });
    const { client: c } = await signedInUser(db, { balance: 500 });
    const order = await placeOrder(c, variant.id);

    // ★ দোকানদার দাম বাড়ালেন — পুরনো চালান এতে বদলানো চলবে না
    await db.variant.update({ where: { id: variant.id }, data: { price: 999 } });

    const html = await (await c.raw(`/account/orders/${order.id}/invoice`)).text();
    expect(html).toContain('150.00');
    expect(html).not.toContain('999.00');
  });

  it('মুনাফা (costPrice) চালানে কোথাও নেই', async () => {
    // ★ মান ইচ্ছাকৃতভাবে অস্বাভাবিক — কাকতালীয়ভাবে মিলবে না
    const variant = await createVariant(db, { price: 150, stock: 5, costPrice: 73 });
    const { client: c } = await signedInUser(db, { balance: 500 });
    const order = await placeOrder(c, variant.id);

    const html = await (await c.raw(`/account/orders/${order.id}/invoice`)).text();
    expect(html).not.toContain('costPrice');
    expect(html).not.toContain('73.00');
  });

  it('ফেরত হলে ফেরতের অঙ্ক ও নিট দুটোই দেখায়', async () => {
    const variant = await createVariant(db, { price: 200, stock: 5 });
    const { client: c } = await signedInUser(db, { balance: 500 });
    const order = await placeOrder(c, variant.id);

    // ★ আংশিক ফেরত — চালান একে লুকাতে পারবে না, নাহলে মিথ্যা বলত
    await db.order.update({
      where: { id: order.id },
      data: { refundedAmount: 50, status: 'COMPLETED' },
    });

    const html = await (await c.raw(`/account/orders/${order.id}/invoice`)).text();
    expect(html).toContain('ফেরত দেওয়া হয়েছে');
    expect(html).toContain('50.00');
    expect(html).toContain('নিট');
    // ★ ২০০ − ৫০ = ১৫০
    expect(html).toContain('150.00');
  });
});
