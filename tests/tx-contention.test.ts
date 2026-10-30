/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ SCL-01 — ভিড়জনিত transaction-ত্রুটি → ৫০৩ + Retry-After
 *
 *   ১) ইউনিট: Prisma-র timeout/write-conflict/deadlock ত্রুটি `apiError`-এ
 *      ৫০৩ + Retry-After; সাধারণ ত্রুটি আগের মতোই ৫০০।
 *   ২) রানটাইম: টেস্ট-প্রসেস variant-রো `FOR UPDATE` ধরে রাখে অর্ডার-
 *      transaction-এর timeout (১৫ সে.) পেরিয়ে — আসল সার্ভার কী ফেরত দেয়,
 *      কত দ্রুত, আর টাকা/স্টক/অর্ডার অক্ষত থাকে কি না, মেপে দেখা।
 *      (lock_timeout ছাড়া এই অনুরোধ ~৫৪ সে. ঝুলে ছিল — মাপা।)
 * ═══════════════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
import { db } from '../vitest.setup';
import { signedInUser } from './helpers/app';
import { createVariant, balanceOf, ledgerSum } from './helpers/factories';
import { apiError, ApiError } from '../src/lib/guard';

const known = (code: string, message = 'x') =>
  new Prisma.PrismaClientKnownRequestError(message, { code, clientVersion: 'test' });

describe('SCL-01 — apiError ম্যাপিং', () => {
  it.each([
    ['P2028 (transaction timeout)', known('P2028', 'Transaction already closed: timeout')],
    ['P2034 (write conflict/deadlock)', known('P2034')],
    ['P2010 + 40P01 (raw deadlock)', known('P2010', 'Raw query failed. Code: `40P01`. Message: `deadlock detected`')],
    ['P2010 + 55P03 (lock not available)', known('P2010', 'Raw query failed. Code: `55P03`.')],
    ['Unknown + 40001', new Prisma.PrismaClientUnknownRequestError('could not serialize access (40001)', { clientVersion: 'test' })],
  ])('%s → ৫০৩ + Retry-After', async (_label, err) => {
    const r = apiError(err);
    expect(r.status).toBe(503);
    expect(r.headers.get('Retry-After')).toBe('5');
    const body = await r.json();
    expect(body.code).toBe('BUSY');
  });

  it('সাধারণ ত্রুটি ও অন্য raw-query ত্রুটি আগের মতোই ৫০০', () => {
    expect(apiError(new Error('boom')).status).toBe(500);
    expect(apiError(known('P2010', 'Raw query failed. Code: `42P01`.')).status).toBe(500);
    expect(apiError(new ApiError('x', 409)).status).toBe(409);
  });
});

describe('SCL-01 — রানটাইম: লক-অপেক্ষায় timeout', () => {
  it('ভিড়ে অর্ডার → ৫০৩ + Retry-After; কোনো টাকা/স্টক/অর্ডার বদলায় না', async () => {
    const variant = await createVariant(db, { price: 150, stock: 5 });
    const { user, client: c } = await signedInUser(db, { balance: 500 });

    let release!: () => void;
    const released = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const lockTaken = new Promise<void>((r) => (locked = r));

    // ★ অন্য এক "ক্রেতা" রো-টি ধরে রাখে, অর্ডার-transaction-এর timeout পেরিয়ে
    const holder = db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Variant" WHERE id = ${variant.id} FOR UPDATE`;
        locked();
        await released;
      },
      { timeout: 55_000, maxWait: 5_000 },
    );
    await lockTaken;

    let res;
    const t0 = Date.now();
    let elapsed = 0;
    try {
      res = await c.post<{ error: string; code?: string }>('/api/order', {
        variantId: variant.id,
        playerUid: '987654321',
      });
      elapsed = Date.now() - t0;
    } finally {
      release();
      await holder;
    }

    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('5');
    expect(res.body.code).toBe('BUSY');
    // ★ লক ছাড়ার অপেক্ষায় নয় — Postgres-এর lock_timeout (৮ সে.)-এই ফেরত
    expect(elapsed).toBeLessThan(14_000);

    expect(await balanceOf(db, user.id)).toBe(500);
    expect(await ledgerSum(db, user.id)).toBe(0);
    expect(await db.order.count({ where: { userId: user.id } })).toBe(0);
    expect((await db.variant.findUnique({ where: { id: variant.id } }))!.stock).toBe(5);
  }, 58_000);
});
