/**
 * A clientRef replay must not re-announce the order (audit 2026-10-31, O-06).
 *
 * placeOrder() returns the existing order for a repeated clientRef and
 * afterOrderPlaced() skips its side effects, but /api/order still sent the
 * admins a fresh "নতুন অর্ডার" notification on every replay — a retried
 * mobile request looked like a second sale to the operator.
 */
import { describe, it, expect } from 'vitest';
import { db } from '../vitest.setup';
import { signedInUser, signedInAdmin } from './helpers/app';
import { createVariant } from './helpers/factories';

describe('order replay notifications', () => {
  it('three posts with one clientRef: one order, one admin notification', async () => {
    const { admin } = await signedInAdmin(db);
    const v = await createVariant(db, { price: 10 });
    const { client } = await signedInUser(db, { balance: 100 });
    const body = { variantId: v.id, playerUid: '123456789', clientRef: 'replay-notify-0001' };

    for (let i = 0; i < 3; i++) expect((await client.post('/api/order', body)).status).toBe(200);
    // notifyAdmins is fire-and-forget; give it a moment to land
    await new Promise((r) => setTimeout(r, 1500));

    expect(await db.order.count({ where: { clientRef: body.clientRef } })).toBe(1);
    const n = await db.notification.count({ where: { userId: admin.id, title: 'নতুন অর্ডার' } });
    expect(n).toBe(1);
  });
});
