/**
 * Reseller read API (/api/reseller/{balance,products,order-status}) — audit 2026-10-31.
 *
 * These three endpoints shipped in the 2026-10-31 upgrade with no tests.
 * They expose balances, order details and delivered voucher codes, so the
 * main claim to prove is ownership: a key only ever sees its own owner's data.
 */
import { describe, it, expect } from 'vitest';
import { db } from '../vitest.setup';
import { baseUrl, signedInUser } from './helpers/app';
import { createVariant } from './helpers/factories';
import { generateApiKey } from '../src/lib/apiKey';

async function call(method: 'GET' | 'POST', path: string, key: string | null, body?: unknown) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (key) headers.authorization = `Bearer ${key}`;
  const res = await fetch(`${baseUrl()}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function reseller(opts: { balance?: number; tier?: 'RESELLER' | 'NORMAL' } = {}) {
  const { user } = await signedInUser(db, { balance: opts.balance ?? 1000 });
  await db.user.update({ where: { id: user.id }, data: { tier: opts.tier ?? 'RESELLER' } });
  const { plain, hash, prefix } = generateApiKey();
  await db.apiKey.create({ data: { userId: user.id, label: 'test key', prefix, hash } });
  return { user, key: plain };
}

/** Place one order for `who` through the real bulk endpoint, then complete it with a code. */
async function completedCodeOrder(who: { key: string }, variantId: number, clientRef: string) {
  const r = await call('POST', '/api/reseller/orders', who.key, {
    items: [{ variantId, playerUid: '123456789', clientRef }],
  });
  expect(r.status).toBe(200);
  const orderId = r.body.results[0].orderId as string;
  await db.order.update({ where: { id: orderId }, data: { status: 'COMPLETED', completedAt: new Date() } });
  await db.voucherCode.create({
    data: { variantId, code: `SECRET-${clientRef}`, status: 'ASSIGNED', orderId, assignedAt: new Date() },
  });
  return db.order.findUniqueOrThrow({ where: { id: orderId } });
}

describe('reseller read API — authentication', () => {
  it('no key → 401, NORMAL-tier key → 403, on all three endpoints', async () => {
    const normal = await reseller({ tier: 'NORMAL' });
    for (const path of ['/api/reseller/balance', '/api/reseller/products', '/api/reseller/order-status?orderNo=1']) {
      expect((await call('GET', path, null)).status, path).toBe(401);
      expect((await call('GET', path, normal.key)).status, path).toBe(403);
    }
  });
});

describe('reseller read API — ownership (IDOR)', () => {
  it("a key never sees another reseller's order or voucher code, by any selector", async () => {
    const v = await createVariant(db, { price: 100 });
    const a = await reseller();
    const b = await reseller();
    const bOrder = await completedCodeOrder(b, v.id, 'B-REF-1');

    for (const q of [
      `orderIds=${bOrder.id}`,
      `orderNo=${bOrder.orderNo}`,
      'clientRef=B-REF-1',
    ]) {
      const r = await call('GET', `/api/reseller/order-status?${q}`, a.key);
      expect(r.status, q).toBe(200);
      expect(r.body.orders, q).toEqual([]);
    }

    const own = await call('GET', `/api/reseller/order-status?orderIds=${bOrder.id}`, b.key);
    expect(own.status).toBe(200);
    expect(own.body.orders).toHaveLength(1);
    expect(own.body.orders[0].code).toBe('SECRET-B-REF-1');
  });

  it('balance is the caller\'s own balance', async () => {
    const a = await reseller({ balance: 321.5 });
    await reseller({ balance: 9999 });
    const r = await call('GET', '/api/reseller/balance', a.key);
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body)).toContain('321.50');
    expect(JSON.stringify(r.body)).not.toContain('9999');
  });
});

describe('reseller read API — contract', () => {
  it('order-status without any selector is a 400, not an empty 200', async () => {
    const a = await reseller();
    const r = await call('GET', '/api/reseller/order-status', a.key);
    expect(r.status).toBe(400);
  });
});
