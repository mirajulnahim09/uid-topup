/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ ডিপোজিট-পথ — HTTP দিয়ে (Group D / RUN.md)
 *
 *   কভারেজ: approve · reject · ডুপ্লিকেট TrxID · double-approve
 *
 *   ── কেন double-approve সবচেয়ে বিপজ্জনক ──
 *   এটিই একমাত্র পথ যেখানে **টাকা তৈরি হয়** (creditWallet)। লক ছাড়া
 *   দুই অ্যাডমিন একসাথে approve চাপলে একই ৳৫০০ দুবার ঢুকত, অথচ
 *   গ্রাহক একবারই পাঠিয়েছে। ব্যবসার সরাসরি লোকসান, আর খতিয়ান
 *   দেখে বোঝাও কঠিন — কারণ দুটি এন্ট্রিই "বৈধ" দেখায়।
 * ═══════════════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { db } from '../vitest.setup';
import { client, signedInUser, signedInAdmin } from './helpers/app';
import { createDeposit, balanceOf, ledgerSum } from './helpers/factories';

beforeAll(async () => {
  // ★ রুট compile করিয়ে রাখি — সমান্তরালতা টেস্টের সময় যেন
  //   compile-এর দেরি রেসের সাথে মিশে না যায়
  await client().post('/api/admin/deposit', { depositId: 'warmup', action: 'APPROVE' });
  await client().post('/api/deposit', {});
});

describe('ডিপোজিট — তৈরি', () => {
  it('বৈধ রিকোয়েস্ট PENDING হয়ে জমা হয়, টাকা এখনো ঢোকে না', async () => {
    const { user, client: c } = await signedInUser(db, { balance: 0 });

    const res = await c.post<{ success: boolean; depositNo: number }>('/api/deposit', {
      method: 'BKASH',
      amount: 500,
      trxId: 'ABC123XYZ',
      senderNo: '01712345678',
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const dep = await db.deposit.findFirst({ where: { userId: user.id } });
    expect(dep!.status).toBe('PENDING');
    expect(Number(dep!.amount)).toBe(500);

    // ★★★ অনুমোদনের আগে এক পয়সাও নয়
    expect(await balanceOf(db, user.id)).toBe(0);
    expect(await db.ledgerEntry.count()).toBe(0);
  });

  it('একই TrxID দ্বিতীয়বার দিলে 409, দ্বিতীয় সারি তৈরি হয় না', async () => {
    const { client: c } = await signedInUser(db, {});

    const first = await c.post('/api/deposit', {
      method: 'BKASH', amount: 500, trxId: 'DUPE12345', senderNo: '01712345678',
    });
    expect(first.status).toBe(200);

    const second = await c.post<{ error: string }>('/api/deposit', {
      method: 'BKASH', amount: 500, trxId: 'DUPE12345', senderNo: '01712345678',
    });

    expect(second.status).toBe(409);
    expect(second.body.error).toContain('আগে ব্যবহার করা হয়েছে');
    expect(await db.deposit.count()).toBe(1);
  });

  it('ভিন্ন ইউজারও একই TrxID দাবি করতে পারে না', async () => {
    const a = await signedInUser(db, {});
    const b = await signedInUser(db, {});

    const r1 = await a.client.post('/api/deposit', {
      method: 'BKASH', amount: 300, trxId: 'SHARED999', senderNo: '01712345678',
    });
    const r2 = await b.client.post('/api/deposit', {
      method: 'NAGAD', amount: 300, trxId: 'SHARED999', senderNo: '01812345678',
    });

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(409);
    expect(await db.deposit.count()).toBe(1);
  });

  it('একই TrxID দুটি সমান্তরাল অনুরোধেও একবারই বসে', async () => {
    const { client: c } = await signedInUser(db, {});

    const results = await Promise.all([
      c.post('/api/deposit', {
        method: 'BKASH', amount: 400, trxId: 'RACETRX01', senderNo: '01712345678',
      }),
      c.post('/api/deposit', {
        method: 'BKASH', amount: 400, trxId: 'RACETRX01', senderNo: '01712345678',
      }),
    ]);

    // ★ unique constraint (P2002) ধরা পড়ে 409 হয় — 500 নয়
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(1);
    expect(await db.deposit.count()).toBe(1);
  });
});

describe('ডিপোজিট — অনুমোদন', () => {
  it('approve করলে ব্যালেন্স বাড়ে ও খতিয়ান লেখা হয়', async () => {
    const { user } = await signedInUser(db, { balance: 100 });
    const dep = await createDeposit(db, user.id, { amount: 750, trxId: 'APPROVE001' });
    const { client: adminClient } = await signedInAdmin(db);

    const res = await adminClient.post('/api/admin/deposit', {
      depositId: dep.id,
      action: 'APPROVE',
    });

    expect(res.status).toBe(200);
    expect(await balanceOf(db, user.id)).toBe(850);
    expect(await ledgerSum(db, user.id)).toBe(750);

    const entries = await db.ledgerEntry.findMany({ where: { userId: user.id } });
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe('DEPOSIT');
    expect(Number(entries[0].amount)).toBe(750);
    expect(Number(entries[0].balanceAfter)).toBe(850);
    expect(entries[0].refId).toBe(dep.id);

    const after = await db.deposit.findUnique({ where: { id: dep.id } });
    expect(after!.status).toBe('APPROVED');
    expect(after!.reviewedAt).toBeTruthy();
  });

  it('reject করলে টাকা ঢোকে না', async () => {
    const { user } = await signedInUser(db, { balance: 100 });
    const dep = await createDeposit(db, user.id, { amount: 750, trxId: 'REJECT001' });
    const { client: adminClient } = await signedInAdmin(db);

    const res = await adminClient.post('/api/admin/deposit', {
      depositId: dep.id,
      action: 'REJECT',
      rejectReason: 'TRX_NOT_FOUND',
    });

    expect(res.status).toBe(200);
    expect(await balanceOf(db, user.id)).toBe(100);
    expect(await db.ledgerEntry.count({ where: { userId: user.id } })).toBe(0);

    const after = await db.deposit.findUnique({ where: { id: dep.id } });
    expect(after!.status).toBe('REJECTED');
    // ★ গ্রাহক যেন কেবল "বাতিল" না দেখে — কারণ লেখা থাকতেই হবে
    expect(after!.adminNote).toBeTruthy();
  });

  it('একবার approve হয়ে গেলে দ্বিতীয়বার 409 — টাকা দুবার ঢোকে না', async () => {
    const { user } = await signedInUser(db, { balance: 0 });
    const dep = await createDeposit(db, user.id, { amount: 500, trxId: 'TWICE0001' });
    const { client: adminClient } = await signedInAdmin(db);

    const first = await adminClient.post('/api/admin/deposit', {
      depositId: dep.id, action: 'APPROVE',
    });
    const second = await adminClient.post<{ error: string }>('/api/admin/deposit', {
      depositId: dep.id, action: 'APPROVE',
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(second.body.error).toContain('আগেই প্রসেস করা হয়েছে');

    expect(await balanceOf(db, user.id)).toBe(500);
    expect(await ledgerSum(db, user.id)).toBe(500);
    expect(await db.ledgerEntry.count({ where: { userId: user.id } })).toBe(1);
  });

  it('approve হওয়া ডিপোজিট আর reject করা যায় না', async () => {
    const { user } = await signedInUser(db, { balance: 0 });
    const dep = await createDeposit(db, user.id, { amount: 500, trxId: 'APRJ0001' });
    const { client: adminClient } = await signedInAdmin(db);

    await adminClient.post('/api/admin/deposit', { depositId: dep.id, action: 'APPROVE' });
    const res = await adminClient.post('/api/admin/deposit', {
      depositId: dep.id, action: 'REJECT', rejectReason: 'TRX_NOT_FOUND',
    });

    expect(res.status).toBe(409);
    // ★ টাকা ফেরত নেওয়ার কোনো নীরব পথ নেই
    expect(await balanceOf(db, user.id)).toBe(500);
    expect((await db.deposit.findUnique({ where: { id: dep.id } }))!.status).toBe('APPROVED');
  });

  /**
   * ★★★ সবচেয়ে গুরুত্বপূর্ণ ডিপোজিট টেস্ট — দুই অ্যাডমিন, একই মুহূর্ত।
   *   `SELECT ... FOR UPDATE` না থাকলে দুটোই `status='PENDING'` দেখত
   *   এবং ৳৫০০ দুবার ঢুকত।
   */
  it('দুই অ্যাডমিন একসাথে approve চাপলে টাকা একবারই ঢোকে', async () => {
    const { user } = await signedInUser(db, { balance: 0 });
    const dep = await createDeposit(db, user.id, { amount: 500, trxId: 'CONCUR001' });

    const [adminA, adminB] = await Promise.all([signedInAdmin(db), signedInAdmin(db)]);

    const results = await Promise.all([
      adminA.client.post('/api/admin/deposit', { depositId: dep.id, action: 'APPROVE' }),
      adminB.client.post('/api/admin/deposit', { depositId: dep.id, action: 'APPROVE' }),
    ]);

    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(1);

    // ★★★ মূল দাবি
    expect(await balanceOf(db, user.id)).toBe(500);
    expect(await ledgerSum(db, user.id)).toBe(500);
    expect(await db.ledgerEntry.count({ where: { userId: user.id } })).toBe(1);
  });

  it('৫টি সমান্তরাল approve — তবুও একবার', async () => {
    const { user } = await signedInUser(db, { balance: 0 });
    const dep = await createDeposit(db, user.id, { amount: 1000, trxId: 'CONCUR005' });
    const { client: adminClient } = await signedInAdmin(db);

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        adminClient.post('/api/admin/deposit', { depositId: dep.id, action: 'APPROVE' }),
      ),
    );

    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await balanceOf(db, user.id)).toBe(1000);
    expect(await db.ledgerEntry.count({ where: { userId: user.id } })).toBe(1);
  });
});
