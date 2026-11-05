/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ ক্রস-অ্যাকশন কেয়স — "একই মিলিসেকেন্ডে দুই **ভিন্ন** সিদ্ধান্ত"
 *
 *   বিদ্যমান টেস্টগুলো (deposit/refund/withdrawal/admin-money-idempotency)
 *   **একই** অ্যাকশন N বার পাঠিয়ে দেখে — ৫টি approve, ৫টি refund। এখানে
 *   দেখা হয় **বিপরীত** সিদ্ধান্ত একসাথে এলে কী হয়: approve ‖ reject,
 *   FAIL(রিফান্ড) ‖ COMPLETE, অ্যাডমিনের কর্তন ‖ গ্রাহকের কেনা। এগুলো
 *   আলাদা কোডপথ, তাই "একই পথের" লক-প্রমাণ এখানে স্বয়ংক্রিয়ভাবে খাটে না।
 *
 *   প্রতিটি টেস্টের তিনটি অপরিবর্তনীয় দাবি:
 *   ১. ঠিক একটি সিদ্ধান্ত জেতে (বাকিগুলো 409/400, কখনো 500 নয়)
 *   ২. ব্যালেন্স কখনো ঋণাত্মক নয়
 *   ৩. `ব্যালেন্স − খতিয়ানের যোগফল` শুরু ও শেষে একই (টাকা তৈরি/হারায়নি)
 *
 * ═══════════════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { db } from '../vitest.setup';
import { client, signedInUser, signedInAdmin } from './helpers/app';
import { createUser, createVariant, createDeposit, balanceOf, ledgerSum } from './helpers/factories';
import { requestWithdrawal, WITHDRAWAL_KEYS } from '../src/lib/services/withdrawal';
import { creditWallet } from '../src/lib/services/wallet';
import { invalidateSettings } from '../src/lib/settings';

let seq = 0;
const rid = (p: string) => `${p}-${Date.now().toString(36)}-${seq++}`;

/** ★ টাকা তৈরি/হারানো হয়নি — ব্যালেন্স ও খতিয়ানের পার্থক্য অপরিবর্তিত */
async function drift(userId: string): Promise<number> {
  return Math.round((Number(await balanceOf(db, userId)) - Number(await ledgerSum(db, userId))) * 100);
}

/** ★ খতিয়ানসহ তহবিল — সরাসরি balance বসানো নয় */
async function fund(userId: string, amount: number) {
  await db.$transaction((tx) => creditWallet({ tx, userId, amount, type: 'DEPOSIT', note: 'কেয়স তহবিল' }));
}

const ROUNDS = 5;

describe('ডিপোজিট — approve ‖ reject একই মুহূর্তে', () => {
  it(`${ROUNDS} রাউন্ড: ঠিক একটি জেতে, টাকা শূন্য বা একবার`, async () => {
    const { client: a1 } = await signedInAdmin(db);
    const { client: a2 } = await signedInAdmin(db);

    for (let r = 0; r < ROUNDS; r++) {
      const u = await createUser(db, {});
      const before = await drift(u.id);
      const dep = await createDeposit(db, u.id, { amount: 500 });

      // ★ দুই অ্যাডমিন, দুই সিদ্ধান্ত, প্রতিটি দুবার (ডাবল-ক্লিক)
      const res = await Promise.all([
        a1.post('/api/admin/deposit', { depositId: dep.id, action: 'APPROVE' }),
        a2.post('/api/admin/deposit', { depositId: dep.id, action: 'REJECT', rejectReason: 'TRX_NOT_FOUND' }),
        a1.post('/api/admin/deposit', { depositId: dep.id, action: 'APPROVE' }),
        a2.post('/api/admin/deposit', { depositId: dep.id, action: 'REJECT', rejectReason: 'TRX_NOT_FOUND' }),
      ]);
      const codes = res.map((x) => x.status);
      expect(codes.filter((c) => c === 200)).toHaveLength(1);
      expect(codes.every((c) => c === 200 || c === 409)).toBe(true);

      const final = await db.deposit.findUniqueOrThrow({ where: { id: dep.id } });
      const bal = Number(await balanceOf(db, u.id));
      const credits = await db.ledgerEntry.count({ where: { userId: u.id, type: 'DEPOSIT', refId: dep.id } });
      if (final.status === 'APPROVED') {
        expect(bal).toBe(500);
        expect(credits).toBe(1);
      } else {
        expect(final.status).toBe('REJECTED');
        expect(bal).toBe(0);
        expect(credits).toBe(0);
      }
      expect(await drift(u.id)).toBe(before);
    }
  });
});

describe('প্রত্যাহার — approve ‖ reject একই মুহূর্তে', () => {
  it(`${ROUNDS} রাউন্ড: approve জিতলে টাকা কাটা থাকে, reject জিতলে ঠিক একবার ফেরে`, async () => {
    const keys: Record<string, string> = {
      [WITHDRAWAL_KEYS.enabled]: '1', [WITHDRAWAL_KEYS.min]: '100',
      [WITHDRAWAL_KEYS.dailyCap]: '50000', [WITHDRAWAL_KEYS.holdHours]: '0',
    };
    for (const [key, value] of Object.entries(keys)) {
      await db.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
    }
    invalidateSettings();

    const { client: a1 } = await signedInAdmin(db);
    const { client: a2 } = await signedInAdmin(db);

    for (let r = 0; r < ROUNDS; r++) {
      const u = await createUser(db, {});
      await fund(u.id, 1000);
      const before = await drift(u.id);
      const w = await requestWithdrawal({ userId: u.id, amount: 400, method: 'BKASH', accountNumber: '01712345678' });

      const res = await Promise.all([
        a1.post('/api/admin/withdrawals', { id: w.id, action: 'approve', payoutRef: `PAY${r}X${seq}` }),
        a2.post('/api/admin/withdrawals', { id: w.id, action: 'reject', reason: 'কেয়স টেস্ট' }),
        a1.post('/api/admin/withdrawals', { id: w.id, action: 'approve', payoutRef: `PAY${r}Y${seq}` }),
        a2.post('/api/admin/withdrawals', { id: w.id, action: 'reject', reason: 'কেয়স টেস্ট' }),
      ]);
      const codes = res.map((x) => x.status);
      expect(codes.filter((c) => c === 200)).toHaveLength(1);
      expect(codes.every((c) => c === 200 || c === 409)).toBe(true);

      const final = await db.withdrawal.findUniqueOrThrow({ where: { id: w.id } });
      const reversals = await db.ledgerEntry.count({ where: { refId: w.id, type: 'WITHDRAWAL_REVERSAL' } });
      const bal = Number(await balanceOf(db, u.id));
      if (final.status === 'APPROVED') {
        expect(reversals).toBe(0);
        expect(bal).toBe(600);
      } else {
        expect(final.status).toBe('REJECTED');
        expect(reversals).toBe(1);
        expect(bal).toBe(1000);
      }
      expect(await drift(u.id)).toBe(before);
    }
  });

  it('১০টি অনুরোধ এক ঝাঁকে (৫ × ডাবল-ট্যাপ) — একটিই কাটে, ব্যালেন্স ঋণাত্মক নয়', async () => {
    const u = await createUser(db, {});
    await fund(u.id, 1000);
    const before = await drift(u.id);
    const out = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        requestWithdrawal({ userId: u.id, amount: 900, method: 'BKASH', accountNumber: '01712345678' })),
    );
    expect(out.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(Number(await balanceOf(db, u.id))).toBe(100);
    expect(await drift(u.id)).toBe(before);
  });
});

describe('অর্ডার — FAIL(রিফান্ড) ‖ COMPLETE ‖ গ্রাহকের নিশ্চিতকরণ', () => {
  it(`${ROUNDS} রাউন্ড: একটিই চূড়ান্ত অবস্থা, রিফান্ড ০ বা ঠিক ১ বার`, async () => {
    const variant = await createVariant(db, { price: 100, stock: 5 });
    const { client: a1 } = await signedInAdmin(db);
    const { client: a2 } = await signedInAdmin(db);

    for (let r = 0; r < ROUNDS; r++) {
      const { user, client: cust } = await signedInUser(db, {});
      await fund(user.id, 100);
      const before = await drift(user.id);
      const placed = await cust.post('/api/order', { variantId: variant.id, playerUid: '123456789', clientRef: rid('cx') });
      expect(placed.status).toBe(200);
      const orderId: string = placed.body.orderId;
      expect(orderId).toBeTruthy();
      const stockBefore = (await db.variant.findUniqueOrThrow({ where: { id: variant.id } })).stock;

      // ★ takeover: true — claim-পাহারা পেরিয়ে আসল লক-প্রতিযোগিতা মাপা
      await Promise.all([
        a1.post('/api/admin/order', { orderId, action: 'FAIL', failReason: 'OUT_OF_STOCK', takeover: true }),
        a2.post('/api/admin/order', { orderId, action: 'COMPLETE', takeover: true }),
        a1.post('/api/admin/order', { orderId, action: 'FAIL', failReason: 'OUT_OF_STOCK', takeover: true }),
        cust.post('/api/order/confirm', { orderId, arrived: true }),
      ]).then((rs) => rs.forEach((x) => expect(x.status).toBeLessThan(500)));

      const o = await db.order.findUniqueOrThrow({ where: { id: orderId } });
      const refunds = await db.ledgerEntry.count({ where: { refId: orderId, type: 'REFUND' } });
      const stockAfter = (await db.variant.findUniqueOrThrow({ where: { id: variant.id } })).stock;
      if (o.status === 'REFUNDED') {
        expect(refunds).toBe(1);
        expect(Number(await balanceOf(db, user.id))).toBe(100);
        expect(stockAfter).toBe(stockBefore + 1);
      } else {
        expect(o.status).toBe('COMPLETED');
        expect(refunds).toBe(0);
        expect(Number(await balanceOf(db, user.id))).toBe(0);
        expect(stockAfter).toBe(stockBefore);
      }
      expect(await drift(user.id)).toBe(before);
    }
  });

  it('FAIL-রিফান্ড ‖ আংশিক ফেরত — মোট ফেরত কখনো দাম ছাড়ায় না', async () => {
    const variant = await createVariant(db, { price: 100 });
    const { client: a1 } = await signedInAdmin(db);
    const { user, client: cust } = await signedInUser(db, {});
    await fund(user.id, 100);
    const before = await drift(user.id);
    const placed = await cust.post('/api/order', { variantId: variant.id, playerUid: '123456789', clientRef: rid('pr') });
    const orderId: string = placed.body.orderId;

    await Promise.all([
      a1.post('/api/admin/order', { orderId, action: 'COMPLETE', takeover: true }),
      a1.post('/api/admin/order/refund', { orderId, amount: 60, reason: 'কেয়স আংশিক', requestId: rid('rq') }),
      a1.post('/api/admin/order', { orderId, action: 'FAIL', failReason: 'OTHER', adminNote: 'কেয়স', takeover: true }),
      a1.post('/api/admin/order/refund', { orderId, amount: 60, reason: 'কেয়স আংশিক', requestId: rid('rq') }),
    ]);

    const credited = await db.ledgerEntry.aggregate({ where: { refId: orderId, type: 'REFUND' }, _sum: { amount: true } });
    expect(Number(credited._sum.amount ?? 0)).toBeLessThanOrEqual(100);
    expect(Number(await balanceOf(db, user.id))).toBeLessThanOrEqual(100);
    expect(await drift(user.id)).toBe(before);
  });
});

describe('অ্যাডমিনের কর্তন ‖ গ্রাহকের কেনা — একই ৳১০০', () => {
  it(`${ROUNDS} রাউন্ড: দুটির একটিই সফল, ব্যালেন্স কখনো ঋণাত্মক নয়`, async () => {
    const variant = await createVariant(db, { price: 100 });
    const { client: admin } = await signedInAdmin(db);

    for (let r = 0; r < ROUNDS; r++) {
      const { user, client: cust } = await signedInUser(db, {});
      await fund(user.id, 100);
      const before = await drift(user.id);

      const [buy, cut] = await Promise.all([
        cust.post('/api/order', { variantId: variant.id, playerUid: '123456789', clientRef: rid('buy') }),
        admin.post('/api/admin/user', { userId: user.id, amount: -100, note: 'কেয়স কর্তন', requestId: rid('adj') }),
      ]);
      expect([buy.status, cut.status].filter((s) => s === 200)).toHaveLength(1);
      expect(buy.status).toBeLessThan(500);
      expect(cut.status).toBeLessThan(500);
      expect(Number(await balanceOf(db, user.id))).toBe(0);
      expect(await drift(user.id)).toBe(before);
    }
  });
});

describe('ডাবল-স্পেন্ড — একজন গ্রাহক, এক অর্ডারের টাকা, ২০টি ট্যাব', () => {
  it('ভিন্ন clientRef: ঠিক ১টি অর্ডার, বাকিগুলো "পর্যাপ্ত ব্যালেন্স নেই"', async () => {
    const variant = await createVariant(db, { price: 100 });
    const { user, client: cust } = await signedInUser(db, {});
    await fund(user.id, 150);
    const before = await drift(user.id);
    const res = await Promise.all(Array.from({ length: 20 }, () =>
      cust.post('/api/order', { variantId: variant.id, playerUid: '123456789', clientRef: rid('ds') })));
    expect(res.filter((x) => x.status === 200)).toHaveLength(1);
    expect(res.every((x) => x.status < 500)).toBe(true);
    expect(await db.order.count({ where: { userId: user.id } })).toBe(1);
    expect(Number(await balanceOf(db, user.id))).toBe(50);
    expect(await drift(user.id)).toBe(before);
  });

  it('একই clientRef ২০ বার: একটিই অর্ডার, সবাই একই orderId পায়', async () => {
    const variant = await createVariant(db, { price: 100 });
    const { user, client: cust } = await signedInUser(db, {});
    await fund(user.id, 1000);
    const ref = rid('same');
    const res = await Promise.all(Array.from({ length: 20 }, () =>
      cust.post('/api/order', { variantId: variant.id, playerUid: '123456789', clientRef: ref })));
    const ok = res.filter((x) => x.status === 200);
    const ids = new Set(ok.map((x) => x.body.orderId));
    expect(ids.size).toBe(1);
    expect(await db.order.count({ where: { userId: user.id } })).toBe(1);
    expect(Number(await balanceOf(db, user.id))).toBe(900);
  });
});

describe('ফাজিং — ডিপোজিটের অঙ্ক', () => {
  const trx = () => `FZ${Date.now().toString(36).toUpperCase()}${seq++}`;
  const base = { method: 'BKASH', senderNo: '01712345678' };

  it.each([
    ['0.000001'], ['-50'], ['0'], ['NaN'], ['Infinity'], ['1e309'], [''], ['৫০'], [null],
  ])('অবৈধ অঙ্ক %s → 400, কোনো সারি নয়', async (amount) => {
    const { user, client: c } = await signedInUser(db, {});
    const r = await c.post('/api/deposit', { ...base, amount, trxId: trx() });
    expect(r.status).toBe(400);
    expect(await db.deposit.count({ where: { userId: user.id } })).toBe(0);
  });

  // ★ F3 — আগে 200 আসত এবং Postgres numeric(12,2) নীরবে 20.01 বানাত
  it('দুইয়ের বেশি দশমিক (20.005) → 400 [F3]', async () => {
    const { user, client: c } = await signedInUser(db, {});
    const r = await c.post('/api/deposit', { ...base, amount: 20.005, trxId: trx() });
    expect(r.status).toBe(400);
    expect(await db.deposit.count({ where: { userId: user.id } })).toBe(0);
  });
});

describe('ফাজিং — TrxID ডুপ্লিকেট-বাইপাস', () => {
  it('ফাঁকা/ছোট হাত/null-byte/zero-width/full-width — কোনোটিতেই দ্বিতীয় সারি নয়', async () => {
    const { user, client: c } = await signedInUser(db, {});
    const id = `DUP${Date.now().toString(36).toUpperCase()}`;
    const first = await c.post('/api/deposit', { method: 'BKASH', senderNo: '01712345678', amount: 100, trxId: id });
    expect(first.status).toBe(200);

    const variants = [
      ` ${id} `, id.toLowerCase(), `${id}\u0000`, `${id}​`, `​${id}`,
      `${id}\t`, `${id}\n`, id.replace(/[A-Z0-9]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0xfee0)),
      `${id.slice(0, 3)} ${id.slice(3)}`, `${id}%00`,
    ];
    for (const v of variants) {
      const r = await c.post('/api/deposit', { method: 'BKASH', senderNo: '01712345678', amount: 100, trxId: v });
      // ★ trim/ছোট হাত স্বাভাবিকীকরণের পরে হুবহু একই দাবি → replay (২০০, duplicate) — কখনো নতুন সারি নয়
      if (r.status === 200) expect(r.body.duplicate).toBe(true);
      else expect([400, 409, 429]).toContain(r.status);
    }
    expect(await db.deposit.count({ where: { userId: user.id } })).toBe(1);
  });
});

describe('IDOR — গ্রাহক অ্যাডমিন টাকার রুটে', () => {
  it('প্রতিটি অ্যাডমিন money-রুট 401/403, কিছুই বদলায় না', async () => {
    const { user, client: c } = await signedInUser(db, {});
    await fund(user.id, 100);
    const dep = await createDeposit(db, user.id, { amount: 999 });
    const before = Number(await balanceOf(db, user.id));
    const hits = await Promise.all([
      c.post('/api/admin/deposit', { depositId: dep.id, action: 'APPROVE' }),
      c.post('/api/admin/user', { userId: user.id, amount: 5000, note: 'self-credit', requestId: rid('idor') }),
      c.post('/api/admin/order/refund', { orderId: 'x', amount: 1, reason: 'idor', requestId: rid('idor') }),
      c.post('/api/admin/withdrawals', { id: 'x', action: 'approve', payoutRef: 'X' }),
      c.get('/api/admin/order'),
    ]);
    for (const h of hits) expect([401, 403, 405]).toContain(h.status);
    expect(Number(await balanceOf(db, user.id))).toBe(before);
    expect((await db.deposit.findUniqueOrThrow({ where: { id: dep.id } })).status).toBe('PENDING');
  });

  it('লগইন ছাড়া (কুকি নেই) — একই ফল', async () => {
    const anon = client();
    const r = await anon.post('/api/admin/user', { userId: 'x', amount: 1, note: 'anon' });
    expect([401, 403]).toContain(r.status);
  });
});
