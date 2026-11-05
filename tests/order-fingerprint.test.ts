/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ SCL-02 — অর্ডার-পাতার ছাপ: কেবল বদলালে তবেই পুরো রিফ্রেশ
 *
 *   `AutoRefresh` আগে প্রতি ৩০s পুরো সার্ভার-রেন্ডার চাইত। এখন ছোট ছাপ চায়।
 *   এই টেস্টগুলো নিশ্চিত করে যে ছাপ কোনো দৃশ্যমান বদল **হারায় না** (স্ট্যাটাস
 *   বাসি থাকলে তা সঠিকতার রিগ্রেশন হতো) আর অকারণে বদলায় না:
 *     · কিছু না বদলালে ছাপ একই
 *     · status / অ্যাডমিন-নোট / রিফান্ড / নতুন অর্ডার / নতুন ঘটনা → ছাপ বদলায়
 *     · অন্যের অর্ডার-id → কোনো তথ্য নয়, আর সেই অর্ডার বদলালেও ছাপ একই
 *     · পাতার শুরুর ছাপ (`initial`) = endpoint-এর ছাপ (রেন্ডারের সাথে মিল)
 * ═══════════════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { db } from '../vitest.setup';
import { client, signedInUser } from './helpers/app';
import { createCompletedOrder, createVariant } from './helpers/factories';
import type { Client } from './helpers/http';

const fp = async (c: Client, q: string) => {
  const r = await c.get<{ v: string }>(`/api/account/orders/fingerprint?${q}`);
  expect(r.status).toBe(200);
  return r.body.v;
};

describe('SCL-02 — অর্ডার-ছাপ', () => {
  it('তালিকা: অপরিবর্তিত → একই; status/নোট/রিফান্ড/নতুন অর্ডার → বদলায়', async () => {
    const { user, client: c } = await signedInUser(db);
    const v = await createVariant(db);
    const o = await createCompletedOrder(db, { userId: user.id, variantId: v.id });
    await db.order.update({ where: { id: o.id }, data: { status: 'PENDING', completedAt: null } });

    const a = await fp(c, 'scope=recent');
    expect(await fp(c, 'scope=recent')).toBe(a);

    await db.order.update({ where: { id: o.id }, data: { status: 'PROCESSING' } });
    const b = await fp(c, 'scope=recent');
    expect(b).not.toBe(a);

    await db.order.update({ where: { id: o.id }, data: { adminNote: 'ডেলিভারি হচ্ছে' } });
    const c2 = await fp(c, 'scope=recent');
    expect(c2).not.toBe(b);

    await db.order.update({ where: { id: o.id }, data: { refundedAmount: 10 } });
    const d = await fp(c, 'scope=recent');
    expect(d).not.toBe(c2);

    await createCompletedOrder(db, { userId: user.id, variantId: v.id });
    expect(await fp(c, 'scope=recent')).not.toBe(d);
  });

  it('একক অর্ডার: নতুন ঘটনা (OrderEvent) → বদলায়; অন্যের অর্ডার → খালির ছাপ, বদলালেও একই', async () => {
    const { user, client: c } = await signedInUser(db);
    const other = await signedInUser(db);
    const v = await createVariant(db);
    const mine = await createCompletedOrder(db, { userId: user.id, variantId: v.id });
    const theirs = await createCompletedOrder(db, { userId: other.user.id, variantId: v.id });

    const a = await fp(c, `scope=one&id=${mine.id}`);
    await db.orderEvent.create({ data: { orderId: mine.id, status: 'COMPLETED', note: 'x' } });
    expect(await fp(c, `scope=one&id=${mine.id}`)).not.toBe(a);

    const t1 = await fp(c, `scope=one&id=${theirs.id}`);
    await db.order.update({ where: { id: theirs.id }, data: { adminNote: 'গোপন' } });
    const t2 = await fp(c, `scope=one&id=${theirs.id}`);
    expect(t2).toBe(t1); // অন্যের অর্ডার কখনো ছাপে ঢোকে না
    expect(t1).toBe(await fp(c, 'scope=one&id=nonexistentorderid123'));
  });

  it('পাতার শুরুর ছাপ = endpoint-এর ছাপ (তালিকা ও একক)', async () => {
    const { user, client: c } = await signedInUser(db);
    const v = await createVariant(db);
    const o = await createCompletedOrder(db, { userId: user.id, variantId: v.id });
    const list = await (await c.raw('/account/orders')).text();
    expect(list).toContain(await fp(c, 'scope=recent'));
    const one = await (await c.raw(`/account/orders/${o.id}`)).text();
    expect(one).toContain(await fp(c, `scope=one&id=${o.id}`));
  });

  it('অননুমোদিত → ৪০১; অবৈধ scope/id → ৪০০', async () => {
    expect((await client().get('/api/account/orders/fingerprint?scope=recent')).status).toBe(401);
    const { client: c } = await signedInUser(db);
    expect((await c.get('/api/account/orders/fingerprint?scope=all')).status).toBe(400);
    expect((await c.get('/api/account/orders/fingerprint?scope=one&id=../x')).status).toBe(400);
  });
});
