/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ ১০k-গ্রাহক সিমুলেশনে (২০২৬-০৯-২৫) পাওয়া দুটি অ্যাডমিন-টাকার পুনরাবৃত্তি
 *     — মালিকের রিভিউয়ের পরের সংস্করণ
 *
 *   ১. ব্যালেন্স-সমন্বয়: `requestId` → খতিয়ান `refId = adj:<adminId>:<requestId>`।
 *      একই চাবি+একই অঙ্ক = পুনরাবৃত্তি (টাকা নড়ে না); একই চাবি+ভিন্ন অঙ্ক = 409।
 *   ২. আংশিক ফেরত: `requestId` **বাধ্যতামূলক**; চাবিটি ফেরতের অডিট-সারিতে, টাকার
 *      সাথে একই ট্রানজেকশনে। কোনো সময়-জানালা নেই — চাবিই পরিচয়।
 *
 *   সবখানে invariant: ব্যালেন্স = খতিয়ানের যোগফল।
 *   (`scripts/sim/04-races.ts` / `06-failure.ts` একই দাবি ২–১০০ সমান্তরালে মাপে।)
 * ═══════════════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { db } from '../vitest.setup';
import { signedInAdmin } from './helpers/app';
import { createUser, createVariant, createCompletedOrder, balanceOf, ledgerSum } from './helpers/factories';

const adjust = (userId: string, amount: number, requestId?: string) =>
  ({ userId, amount, note: 'ক্ষতিপূরণ', ...(requestId ? { requestId } : {}) });

describe('অ্যাডমিন ব্যালেন্স-সমন্বয় — idempotency', () => {
  it('ক) একই requestId + একই অঙ্ক (১০টি সমান্তরাল) → ঠিক একটি ক্রেডিট, বাকিগুলো duplicate', async () => {
    const { admin, client: a } = await signedInAdmin(db);
    const user = await createUser(db, {});
    const rs = await Promise.all(Array.from({ length: 10 }, () =>
      a.post<{ duplicate?: boolean }>('/api/admin/user', adjust(user.id, 100, 'test-adj-same-0001'))));

    expect(rs.every((r) => r.status === 200)).toBe(true);
    expect(rs.filter((r) => r.body.duplicate === true)).toHaveLength(9);
    expect(await balanceOf(db, user.id)).toBe(100);
    expect(await ledgerSum(db, user.id)).toBe(100);
    // ★ অ্যাডমিনের পরিচয় খতিয়ানেই
    const row = await db.ledgerEntry.findFirstOrThrow({ where: { userId: user.id, type: 'ADMIN_ADJUST' } });
    expect(row.refId).toBe(`adj:${admin.id}:test-adj-same-0001`);
  });

  it('খ) একই requestId + ভিন্ন অঙ্ক → 409 REQUEST_ID_REUSED, ব্যালেন্স অপরিবর্তিত', async () => {
    const { client: a } = await signedInAdmin(db);
    const user = await createUser(db, {});
    expect((await a.post('/api/admin/user', adjust(user.id, 100, 'test-adj-diff-0001'))).status).toBe(200);

    const again = await a.post<{ code?: string }>('/api/admin/user', adjust(user.id, 250, 'test-adj-diff-0001'));
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('REQUEST_ID_REUSED');
    // চিহ্ন বদলানো (ক্রেডিট → ডেবিট) একই অঙ্কের মানে নয়
    const neg = await a.post<{ code?: string }>('/api/admin/user', adjust(user.id, -100, 'test-adj-diff-0001'));
    expect(neg.status).toBe(409);

    expect(await balanceOf(db, user.id)).toBe(100);
    expect(await db.ledgerEntry.count({ where: { userId: user.id } })).toBe(1);
  });

  it('গ) ভিন্ন requestId → আলাদা, স্বাধীন সমন্বয়', async () => {
    const { client: a } = await signedInAdmin(db);
    const user = await createUser(db, {});
    expect((await a.post('/api/admin/user', adjust(user.id, 50, 'test-adj-ind-a001'))).status).toBe(200);
    expect((await a.post('/api/admin/user', adjust(user.id, 50, 'test-adj-ind-b001'))).status).toBe(200);
    expect((await a.post('/api/admin/user', adjust(user.id, -30, 'test-adj-ind-c001'))).status).toBe(200);
    expect(await balanceOf(db, user.id)).toBe(70);
    expect(await ledgerSum(db, user.id)).toBe(70);
  });

  it('requestId ছাড়া আগের আচরণ অপরিবর্তিত', async () => {
    const { admin, client: a } = await signedInAdmin(db);
    const user = await createUser(db, {});
    expect((await a.post('/api/admin/user', adjust(user.id, 30))).status).toBe(200);
    expect(await balanceOf(db, user.id)).toBe(30);
    const row = await db.ledgerEntry.findFirstOrThrow({ where: { userId: user.id } });
    expect(row.refId).toBe(admin.id);
  });
});

describe('আংশিক ফেরত — idempotency key', () => {
  async function completed(price = 100) {
    const { client: a } = await signedInAdmin(db);
    const user = await createUser(db, {});
    const variant = await createVariant(db, { price, stock: -1 });
    const order = await createCompletedOrder(db, { userId: user.id, variantId: variant.id, price });
    return { a, user, order };
  }
  const refunds = (orderId: string) => db.ledgerEntry.count({ where: { refId: orderId, type: 'REFUND' } });

  it('ক) একই চাবিতে ১০টি সমান্তরাল অনুরোধ → ঠিক একটি ফেরত', async () => {
    const { a, user, order } = await completed();
    const body = { orderId: order.id, amount: 20, reason: 'আংশিক ডেলিভারি', requestId: 'test-ref-conc-0001' };
    const rs = await Promise.all(Array.from({ length: 10 }, () => a.post<{ duplicate?: boolean }>('/api/admin/order/refund', body)));

    expect(rs.every((r) => r.status === 200)).toBe(true);
    expect(rs.filter((r) => r.body.duplicate === true)).toHaveLength(9);
    expect(await refunds(order.id)).toBe(1);
    expect(Number((await db.order.findUniqueOrThrow({ where: { id: order.id } })).refundedAmount)).toBe(20);
    expect(await balanceOf(db, user.id)).toBe(await ledgerSum(db, user.id));
    // ★ অডিট-সারিও ঠিক একটি, চাবিসহ, টাকার সাথে একই ট্রানজেকশনে
    expect(await db.adminLog.count({ where: { action: 'ORDER_PARTIAL_REFUND', targetId: order.id } })).toBe(1);
  });

  it('খ) অনুরোধ মাঝপথে বাতিল (উত্তর হারানো) → একই চাবিতে retry → ঠিক একটি ফেরত', async () => {
    const { a, user, order } = await completed();
    const body = { orderId: order.id, amount: 25, reason: 'নেট কেটে গেল', requestId: 'test-ref-abort-0001' };
    // প্রথম অনুরোধ — উত্তরের অপেক্ষা না করে ছেড়ে দেওয়া
    await a.raw('/api/admin/order/refund', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      signal: AbortSignal.timeout(30),
    }).catch(() => null);
    // সার্ভার সেটি শেষ করুক বা না করুক — retry-র ফল একই হতে হবে
    await new Promise((r) => setTimeout(r, 1500));
    const retry = await a.post('/api/admin/order/refund', body);
    expect(retry.status).toBe(200);
    expect(await refunds(order.id)).toBe(1);
    expect(await balanceOf(db, user.id)).toBe(25);
  });

  it('গ) ইচ্ছাকৃত দ্বিতীয় ফেরত — একই কারণ ও অঙ্ক, নতুন চাবি → সাথে সাথেই চলে (কোনো সময়-জানালা নেই); পুরনো চাবি পরে আবার → এখনো পুনরাবৃত্তি', async () => {
    const { a, user, order } = await completed();
    const same = { orderId: order.id, amount: 20, reason: 'একই কারণ' };
    expect((await a.post('/api/admin/order/refund', { ...same, requestId: 'test-ref-int-a001' })).status).toBe(200);
    expect((await a.post('/api/admin/order/refund', { ...same, requestId: 'test-ref-int-b001' })).status).toBe(200);
    expect(await refunds(order.id)).toBe(2);
    expect(await balanceOf(db, user.id)).toBe(40);

    const late = await a.post<{ duplicate?: boolean }>('/api/admin/order/refund', { ...same, requestId: 'test-ref-int-a001' });
    expect(late.status).toBe(200);
    expect(late.body.duplicate).toBe(true);
    expect(await refunds(order.id)).toBe(2);
  });

  it('একই চাবি ভিন্ন অঙ্কে → 409, কিছু ফেরত নয়', async () => {
    const { a, order } = await completed();
    expect((await a.post('/api/admin/order/refund', { orderId: order.id, amount: 10, reason: 'প্রথম', requestId: 'test-ref-mis-0001' })).status).toBe(200);
    const r = await a.post<{ code?: string }>('/api/admin/order/refund', { orderId: order.id, amount: 15, reason: 'প্রথম', requestId: 'test-ref-mis-0001' });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('REQUEST_ID_REUSED');
    expect(await refunds(order.id)).toBe(1);
  });

  it('চাবি ছাড়া → 400 (পুরনো খোলা ট্যাব), কিছু ফেরত নয়', async () => {
    const { a, order } = await completed();
    const r = await a.post<{ error?: string }>('/api/admin/order/refund', { orderId: order.id, amount: 10, reason: 'চাবি নেই' });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('রিফ্রেশ');
    expect(await refunds(order.id)).toBe(0);
  });

  it('সীমা অক্ষত: ভিন্ন চাবিতেও দামের বেশি নয়', async () => {
    const { a, order } = await completed(100);
    expect((await a.post('/api/admin/order/refund', { orderId: order.id, amount: 60, reason: 'প্রথম ফেরত', requestId: 'test-ref-cap-a001' })).status).toBe(200);
    expect((await a.post('/api/admin/order/refund', { orderId: order.id, amount: 60, reason: 'দ্বিতীয় ফেরত', requestId: 'test-ref-cap-b001' })).status).toBe(400);
    expect(Number((await db.order.findUniqueOrThrow({ where: { id: order.id } })).refundedAmount)).toBe(60);
  });
});
