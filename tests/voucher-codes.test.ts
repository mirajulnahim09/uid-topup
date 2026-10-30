/**
 * Voucher-code delivery ("My Codes") — audit 2026-10-31.
 *
 * Shipped in the 2026-10-31 upgrade with no tests. A code is money-adjacent:
 * the customer has already paid, and a code handed out twice (or to an
 * unpaid order) is value given away. Claims proven here, all over real HTTP:
 *
 *   - a paid CODE order completes instantly with exactly one code;
 *   - N customers racing for fewer codes: no code is ever assigned twice,
 *     every COMPLETED order holds exactly one code, the rest stay PENDING;
 *   - an unpaid direct-pay order never receives a code, even when the admin
 *     triggers delivery; it gets one only after the payment is approved;
 *   - an order an admin has claimed is not auto-delivered;
 *   - assigned codes cannot be voided; a voided code is never handed out;
 *   - a customer cannot read another customer's code through the order pages;
 *   - only admins can upload or deliver codes;
 *   - the wallet ledger still matches the balance after all of it.
 */
import { describe, it, expect } from 'vitest';
import { db } from '../vitest.setup';
import { signedInUser, signedInAdmin } from './helpers/app';
import { createVariant, balanceOf, ledgerSum } from './helpers/factories';

async function codeVariant(price = 100) {
  const v = await createVariant(db, { price, stock: -1 });
  await db.product.update({ where: { id: v.productId }, data: { deliveryType: 'CODE' } });
  return v;
}

async function addCodes(variantId: number, codes: string[]) {
  await db.voucherCode.createMany({ data: codes.map((code) => ({ variantId, code })) });
}

describe('voucher codes — wallet order', () => {
  it('a paid CODE order completes at once with exactly one code', async () => {
    const v = await codeVariant(100);
    await addCodes(v.id, ['GIFT-A', 'GIFT-B']);
    const { user, client } = await signedInUser(db, { balance: 500 });

    const r = await client.post('/api/order', { variantId: v.id, playerUid: '123456789' });
    expect(r.status).toBe(200);

    const order = await db.order.findUniqueOrThrow({ where: { id: r.body.orderId }, include: { voucherCode: true } });
    expect(order.status).toBe('COMPLETED');
    expect(order.voucherCode?.code).toBe('GIFT-A'); // oldest first
    expect(await db.voucherCode.count({ where: { status: 'ASSIGNED' } })).toBe(1);
    expect(await balanceOf(db, user.id)).toBe(400);
    expect(500 + (await ledgerSum(db, user.id))).toBe(400);
  });

  it('out of stock: order waits PENDING, admin upload then delivers it', async () => {
    const v = await codeVariant(50);
    const { client } = await signedInUser(db, { balance: 200 });
    const r = await client.post('/api/order', { variantId: v.id, playerUid: '123456789' });
    expect(r.status).toBe(200);
    expect((await db.order.findUniqueOrThrow({ where: { id: r.body.orderId } })).status).toBe('PENDING');

    const { client: admin } = await signedInAdmin(db);
    const up = await admin.post('/api/admin/codes', { variantId: v.id, codes: 'LATE-1\nLATE-2' });
    expect(up.status).toBe(200);
    expect(up.body.added).toBe(2);
    expect(up.body.delivered).toBe(1);

    const order = await db.order.findUniqueOrThrow({ where: { id: r.body.orderId }, include: { voucherCode: true } });
    expect(order.status).toBe('COMPLETED');
    expect(order.voucherCode?.code).toBe('LATE-1');
  });
});

describe('voucher codes — concurrency', () => {
  it('6 customers race for 2 codes: no double assignment, 2 COMPLETED, 4 PENDING', async () => {
    const v = await codeVariant(10);
    await addCodes(v.id, ['RACE-1', 'RACE-2']);
    const buyers = await Promise.all(Array.from({ length: 6 }, () => signedInUser(db, { balance: 100 })));

    const res = await Promise.all(
      buyers.map((b) => b.client.post('/api/order', { variantId: v.id, playerUid: '123456789' })),
    );
    expect(res.every((r) => r.status === 200)).toBe(true);

    const orders = await db.order.findMany({ where: { variantId: v.id }, include: { voucherCode: true } });
    expect(orders).toHaveLength(6);
    const done = orders.filter((o) => o.status === 'COMPLETED');
    expect(done).toHaveLength(2);
    expect(done.every((o) => o.voucherCode)).toBe(true);
    expect(new Set(done.map((o) => o.voucherCode!.code)).size).toBe(2);
    expect(orders.filter((o) => o.status === 'PENDING' && !o.voucherCode)).toHaveLength(4);
    expect(await db.voucherCode.count({ where: { status: 'AVAILABLE' } })).toBe(0);

    for (const b of buyers) {
      expect(100 + (await ledgerSum(db, b.user.id))).toBe(await balanceOf(db, b.user.id));
    }
  });

  it('five parallel admin DELIVER calls on one waiting order assign one code', async () => {
    const v = await codeVariant(10);
    const { client } = await signedInUser(db, { balance: 100 });
    const r = await client.post('/api/order', { variantId: v.id, playerUid: '123456789' });
    await addCodes(v.id, ['P-1', 'P-2', 'P-3', 'P-4', 'P-5']);

    const { client: admin } = await signedInAdmin(db);
    const out = await Promise.all(
      Array.from({ length: 5 }, () => admin.post('/api/admin/codes', { variantId: v.id, action: 'DELIVER' })),
    );
    expect(out.every((o) => o.status === 200)).toBe(true);
    expect(out.reduce((s, o) => s + o.body.delivered, 0)).toBe(1);
    expect(await db.voucherCode.count({ where: { orderId: r.body.orderId } })).toBe(1);
    expect(await db.voucherCode.count({ where: { status: 'ASSIGNED' } })).toBe(1);
  });
});

describe('voucher codes — never to an unpaid or claimed order', () => {
  it('direct-pay order gets no code until the payment is approved', async () => {
    const v = await codeVariant(100);
    await addCodes(v.id, ['DP-1']);
    await db.paymentChannel.create({ data: { method: 'BKASH', accountNo: '01700000000', accountType: 'Personal' } });
    const { user, client } = await signedInUser(db, { balance: 0 });

    const r = await client.post('/api/order/direct', {
      variantId: v.id, playerUid: '123456789', method: 'BKASH',
      trxId: 'DPTRX0001', senderNo: '01712345678', amount: 100,
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);

    const { client: admin } = await signedInAdmin(db);
    const del = await admin.post('/api/admin/codes', { variantId: v.id, action: 'DELIVER' });
    expect(del.body.delivered).toBe(0);
    let order = await db.order.findUniqueOrThrow({ where: { id: r.body.orderId }, include: { voucherCode: true } });
    expect(order.status).toBe('AWAITING_PAYMENT');
    expect(order.voucherCode).toBeNull();

    const dep = await db.deposit.findFirstOrThrow({ where: { linkedOrderId: order.id } });
    const ok = await admin.post('/api/admin/deposit', { depositId: dep.id, action: 'APPROVE' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);

    order = await db.order.findUniqueOrThrow({ where: { id: order.id }, include: { voucherCode: true } });
    expect(order.status).toBe('COMPLETED');
    expect(order.voucherCode?.code).toBe('DP-1');
    expect(await balanceOf(db, user.id)).toBe(0);
    expect(await ledgerSum(db, user.id)).toBe(0); // +100 deposit, -100 order
  });

  it('an admin-claimed PROCESSING order is not auto-delivered', async () => {
    const v = await codeVariant(10);
    const { client } = await signedInUser(db, { balance: 100 });
    const r = await client.post('/api/order', { variantId: v.id, playerUid: '123456789' });
    const { client: admin } = await signedInAdmin(db);
    const claim = await admin.post('/api/admin/order', { orderId: r.body.orderId, action: 'PROCESSING' });
    expect(claim.status).toBe(200);

    await addCodes(v.id, ['CL-1']);
    const del = await admin.post('/api/admin/codes', { variantId: v.id, action: 'DELIVER' });
    expect(del.body.delivered).toBe(0);
    expect(await db.voucherCode.count({ where: { status: 'ASSIGNED' } })).toBe(0);
  });
});

describe('voucher codes — admin controls and access', () => {
  it('assigned code cannot be voided; voided code is never handed out', async () => {
    const v = await codeVariant(10);
    await addCodes(v.id, ['V-1', 'V-2']);
    const { client } = await signedInUser(db, { balance: 100 });
    const r = await client.post('/api/order', { variantId: v.id, playerUid: '123456789' });
    const assigned = await db.voucherCode.findFirstOrThrow({ where: { orderId: r.body.orderId } });
    const free = await db.voucherCode.findFirstOrThrow({ where: { status: 'AVAILABLE' } });

    const { client: admin } = await signedInAdmin(db);
    expect((await admin.patch('/api/admin/codes', { id: assigned.id, action: 'VOID' })).status).toBe(409);
    expect((await admin.patch('/api/admin/codes', { id: free.id, action: 'VOID' })).status).toBe(200);

    const r2 = await client.post('/api/order', { variantId: v.id, playerUid: '123456789' });
    const o2 = await db.order.findUniqueOrThrow({ where: { id: r2.body.orderId }, include: { voucherCode: true } });
    expect(o2.status).toBe('PENDING');
    expect(o2.voucherCode).toBeNull();
  });

  it("a customer cannot read another customer's code via the order pages", async () => {
    const v = await codeVariant(10);
    await addCodes(v.id, ['PRIVATE-CODE-XYZ']);
    const owner = await signedInUser(db, { balance: 100 });
    const r = await owner.client.post('/api/order', { variantId: v.id, playerUid: '123456789' });
    const other = await signedInUser(db, { balance: 100 });

    for (const path of [`/account/orders/${r.body.orderId}`, `/account/orders/${r.body.orderId}/invoice`, '/account/codes']) {
      const res = await other.client.raw(path);
      const html = await res.text();
      expect(html, path).not.toContain('PRIVATE-CODE-XYZ');
    }
    const mine = await (await owner.client.raw('/account/codes')).text();
    expect(mine).toContain('PRIVATE-CODE-XYZ');
  });

  it('only admins can upload or deliver codes', async () => {
    const v = await codeVariant(10);
    const { client } = await signedInUser(db, { balance: 0 });
    expect((await client.post('/api/admin/codes', { variantId: v.id, codes: 'X-1' })).status).toBe(403);
    expect((await client.post('/api/admin/codes', { variantId: v.id, action: 'DELIVER' })).status).toBe(403);
    expect(await db.voucherCode.count()).toBe(0);
  });
});
