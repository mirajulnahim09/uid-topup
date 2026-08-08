/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ অথ-সীমানা — HTTP দিয়ে, আসল লগইন পথে (Group D)
 *
 *   এই ফাইলটি একই সাথে দুটি কাজ করে:
 *     ১. হারনেস নিজে কাজ করছে কিনা তার প্রমাণ (লগইন → সেশন কুকি)
 *     ২. প্রকৃত সুরক্ষা-দাবির যাচাই — লগইন ছাড়া টাকার রুট ছোঁয়া যায় না,
 *        সাধারণ ইউজার অ্যাডমিন-রুট ছুঁতে পারে না, ব্যান কার্যকর হয়।
 * ═══════════════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { db } from '../vitest.setup';
import { client, signedInUser, signedInAdmin } from './helpers/app';
import { createUser, createVariant, DEFAULT_PASSWORD } from './helpers/factories';

describe('অথ-সীমানা', () => {
  it('লগইন ছাড়া অর্ডার করা যায় না (401)', async () => {
    const variant = await createVariant(db, { price: 100 });
    const res = await client().post('/api/order', {
      variantId: variant.id,
      playerUid: '123456789',
    });

    expect(res.status).toBe(401);
    // ★ কোনো অর্ডার/খতিয়ান তৈরি হয়নি
    expect(await db.order.count()).toBe(0);
    expect(await db.ledgerEntry.count()).toBe(0);
  });

  it('আসল credentials লগইন সেশন কুকি দেয়', async () => {
    const user = await createUser(db, { balance: 0 });
    const c = client();

    expect(await c.login(user.email, DEFAULT_PASSWORD)).toBe(true);
    expect(c.hasSession).toBe(true);

    // ★ সেশনটি সত্যিই এই ইউজারের — সার্ভার নিজে বলছে
    const me = await c.get<{ user?: { id?: string } }>('/api/auth/session');
    expect(me.body?.user?.id).toBe(user.id);
  });

  it('ভুল পাসওয়ার্ডে সেশন হয় না', async () => {
    const user = await createUser(db);
    const c = client();

    expect(await c.login(user.email, 'WrongPassword!999')).toBe(false);
    expect(c.hasSession).toBe(false);
  });

  it('সাধারণ ইউজার অ্যাডমিন-রুট ছুঁতে পারে না (403)', async () => {
    const { user } = await signedInUser(db, { balance: 500 });
    const deposit = await db.deposit.create({
      data: {
        userId: user.id, method: 'BKASH', amount: 500,
        trxId: 'TRXNOTADMIN01', senderNo: '01712345678', status: 'PENDING',
      },
    });

    const { client: userClient } = await signedInUser(db, {});
    const res = await userClient.post('/api/admin/deposit', {
      depositId: deposit.id,
      action: 'APPROVE',
    });

    expect(res.status).toBe(403);
    // ★ সবচেয়ে গুরুত্বপূর্ণ: কোনো টাকা ঢোকেনি
    const after = await db.deposit.findUnique({ where: { id: deposit.id } });
    expect(after!.status).toBe('PENDING');
    expect(await db.ledgerEntry.count()).toBe(0);
  });

  it('অ্যাডমিন অ্যাডমিন-রুট ছুঁতে পারে', async () => {
    const { client: adminClient } = await signedInAdmin(db);
    // ★ অস্তিত্বহীন ডিপোজিট → 404, অর্থাৎ অনুমতির স্তর পার হয়েছে
    const res = await adminClient.post('/api/admin/deposit', {
      depositId: 'does-not-exist',
      action: 'APPROVE',
    });
    expect(res.status).toBe(404);
  });

  it('ব্যান করা ইউজার অর্ডার করতে পারে না (403)', async () => {
    const variant = await createVariant(db, { price: 50 });
    const { user, client: c } = await signedInUser(db, { balance: 1000 });

    // ★ লগইনের **পরে** ব্যান — টোকেন তখনো বৈধ, কিন্তু
    //   `requireUser()` প্রতি অনুরোধে DB দেখে, তাই সাথে সাথেই আটকায়
    await db.user.update({ where: { id: user.id }, data: { isBanned: true } });

    const res = await c.post('/api/order', {
      variantId: variant.id,
      playerUid: '123456789',
    });

    expect(res.status).toBe(403);
    expect(await db.order.count()).toBe(0);
    expect(Number((await db.user.findUnique({ where: { id: user.id } }))!.balance)).toBe(1000);
  });
});
