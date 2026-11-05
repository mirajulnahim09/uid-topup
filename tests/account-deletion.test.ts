/**
 * Account deletion request + admin anonymise — audit 2026-10-31.
 *
 * Shipped in the 2026-10-31 upgrade with no tests. Anonymising wipes PII
 * but must never strand money or erase financial records, and must kill
 * every way back into the account.
 */
import { describe, it, expect } from 'vitest';
import { db } from '../vitest.setup';
import { client, signedInUser, signedInAdmin } from './helpers/app';
import { createVariant, createDeposit } from './helpers/factories';
import { generateApiKey } from '../src/lib/apiKey';

describe('customer deletion request', () => {
  it('needs the confirm word; can be cancelled; admins cannot use it', async () => {
    const { user, client: c } = await signedInUser(db);
    expect((await c.post('/api/account/delete-request', { confirm: 'nope' })).status).toBe(400);
    expect((await c.post('/api/account/delete-request', { confirm: 'delete', reason: 'bye' })).status).toBe(200);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).deletionRequestedAt).not.toBeNull();

    const del = await c.raw('/api/account/delete-request', { method: 'DELETE' });
    expect(del.status).toBe(200);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).deletionRequestedAt).toBeNull();

    const { client: admin } = await signedInAdmin(db);
    expect((await admin.post('/api/account/delete-request', { confirm: 'DELETE' })).status).toBe(400);
  });
});

describe('admin anonymise — refusals', () => {
  it('refuses while money or open work is attached', async () => {
    const { client: admin } = await signedInAdmin(db);

    const rich = await signedInUser(db, { balance: 5 });
    expect((await admin.post('/api/admin/user/anonymize', { userId: rich.user.id })).status).toBe(409);

    const v = await createVariant(db, { price: 10 });
    const buyer = await signedInUser(db, { balance: 10 });
    expect((await buyer.client.post('/api/order', { variantId: v.id, playerUid: '123456789' })).status).toBe(200);
    expect((await admin.post('/api/admin/user/anonymize', { userId: buyer.user.id })).status).toBe(409);

    const depositor = await signedInUser(db, { balance: 0 });
    await createDeposit(db, depositor.user.id);
    expect((await admin.post('/api/admin/user/anonymize', { userId: depositor.user.id })).status).toBe(409);

    for (const u of [rich, buyer, depositor]) {
      const row = await db.user.findUniqueOrThrow({ where: { id: u.user.id } });
      expect(row.email).toBe(u.user.email);
      expect(row.isBanned).toBe(false);
    }
  });

  it('only admins; never self or another admin', async () => {
    const { user, client: c } = await signedInUser(db);
    expect((await c.post('/api/admin/user/anonymize', { userId: user.id })).status).toBe(403);

    const a = await signedInAdmin(db);
    const b = await signedInAdmin(db);
    expect((await a.client.post('/api/admin/user/anonymize', { userId: a.admin.id })).status).toBe(400);
    expect((await a.client.post('/api/admin/user/anonymize', { userId: b.admin.id })).status).toBe(400);
  });
});

describe('admin anonymise — success', () => {
  it('wipes PII, keeps financial rows, kills session, password and API keys', async () => {
    const v = await createVariant(db, { price: 10 });
    const { user, client: c } = await signedInUser(db, { balance: 10 });
    const order = await c.post('/api/order', { variantId: v.id, playerUid: '123456789' });
    await db.order.update({ where: { id: order.body.orderId }, data: { status: 'COMPLETED', completedAt: new Date() } });
    const { plain, hash, prefix } = generateApiKey();
    await db.user.update({ where: { id: user.id }, data: { tier: 'RESELLER' } });
    await db.apiKey.create({ data: { userId: user.id, label: 'k', prefix, hash } });

    const ledgerBefore = await db.ledgerEntry.count({ where: { userId: user.id } });
    const { client: admin } = await signedInAdmin(db);
    const r = await admin.post('/api/admin/user/anonymize', { userId: user.id });
    expect(r.status, JSON.stringify(r.body)).toBe(200);

    const row = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.email).not.toBe(user.email);
    expect(row.name).not.toBe(user.name);
    expect(row.phone).not.toBe(user.phone);
    expect(row.isBanned).toBe(true);
    expect(await db.order.count({ where: { userId: user.id } })).toBe(1);
    expect(await db.ledgerEntry.count({ where: { userId: user.id } })).toBe(ledgerBefore);

    expect([401, 403], 'old session must be refused').toContain((await c.get('/api/me')).status);
    expect(await client().login(user.email, user.plainPassword)).toBe(false);
    const key = await fetch(`${(await import('./helpers/app')).baseUrl()}/api/reseller/balance`, {
      headers: { authorization: `Bearer ${plain}` },
    });
    expect([401, 403], 'revoked API key must be refused').toContain(key.status);
  });

  it('order placed in parallel with anonymise: never both succeed', async () => {
    const v = await createVariant(db, { price: 10 });
    for (let round = 0; round < 5; round++) {
      const { user, client: c } = await signedInUser(db, { balance: 0 });
      // balance must be 0 for anonymise to be possible; give credit via a ledgered path
      await db.$transaction(async (tx) => {
        await tx.user.update({ where: { id: user.id }, data: { balance: { increment: 10 } } });
        await tx.ledgerEntry.create({ data: { userId: user.id, type: 'ADMIN_ADJUST', amount: 10, balanceAfter: 10 } });
      });
      const { client: admin } = await signedInAdmin(db);
      const [o, a] = await Promise.all([
        c.post('/api/order', { variantId: v.id, playerUid: '123456789' }),
        admin.post('/api/admin/user/anonymize', { userId: user.id }),
      ]);
      // anonymise needs balance 0 and no open order; the order spends the 10.
      // Whichever wins, the end state must be consistent.
      const row = await db.user.findUniqueOrThrow({ where: { id: user.id } });
      const open = await db.order.count({ where: { userId: user.id, status: { in: ['PENDING', 'PROCESSING'] } } });
      if (a.status === 200) {
        expect(open, `round ${round}: anonymised with an open order`).toBe(0);
        expect(o.status).not.toBe(200);
      }
      expect(Number(row.balance) >= 0).toBe(true);
    }
  });
});
