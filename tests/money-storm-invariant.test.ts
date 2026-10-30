/**
 * Money storm — every money path at once, random order, then the books must
 * balance (audit 2026-10-31, categories 4/5/7).
 *
 * Existing tests prove each path and each pairwise race. This one mixes
 * them: wallet deposits, admin approve/reject, wallet orders (limited stock,
 * coupons), direct-pay orders, admin complete/fail, partial refunds (with
 * replayed requestIds), referral bonuses, withdrawals and direct-pay expiry,
 * fired in random concurrent bursts from a seeded PRNG (reproducible: the
 * failing seed is printed). Users start at 0 so the ledger is the whole truth.
 *
 * Invariants after each seed:
 *   I1 every user: balance == SUM(ledger.amount), balance >= 0
 *   I2 every order: 0 <= refundedAmount <= price; REFUNDED ⇒ refundedAmount == price
 *   I3 every order: SUM(REFUND ledger for it) == refundedAmount
 *   I4 every order: exactly one ORDER debit iff it was ever paid
 *      (wallet order, or direct-pay whose deposit was approved)
 *   I5 limited stock: stock == initial − live (non-FAILED, non-REFUNDED) orders, never < 0
 *   I6 coupon usageCount == number of CouponUse rows == live orders using it
 *   I7 no 5xx except 503 BUSY (a clean, retryable refusal)
 *   I8 no deposit APPROVED twice-credited: DEPOSIT ledger rows per deposit <= 1
 */
import { describe, it, expect } from 'vitest';
import { db } from '../vitest.setup';
import { signedInUser, signedInAdmin } from './helpers/app';
import { createVariant, createCoupon } from './helpers/factories';
import { requestWithdrawal, approveWithdrawal, rejectWithdrawal, WITHDRAWAL_KEYS } from '../src/lib/services/withdrawal';
import { expireDirectPayOrders } from '../src/lib/directPayExpiry';
import { invalidateSettings } from '../src/lib/settings';

function prng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEEDS = [1031, 7, 424242];
const OPS_PER_SEED = 90;

async function setSettings(pairs: Record<string, string>) {
  for (const [key, value] of Object.entries(pairs)) {
    await db.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
  }
  invalidateSettings();
}

describe('money storm — mixed concurrent money paths keep the books balanced', () => {
  for (const seed of SEEDS) {
    it(`seed ${seed}: ${OPS_PER_SEED} random ops in concurrent bursts`, async () => {
      const rnd = prng(seed);
      const pick = <T,>(xs: T[]): T | undefined => (xs.length ? xs[Math.floor(rnd() * xs.length)] : undefined);
      const money = (lo: number, hi: number) => Math.round((lo + rnd() * (hi - lo)) * 100) / 100;

      await setSettings({
        referral_bonus: '15', referral_min_deposit: '50', min_deposit: '20', max_deposit: '25000',
        [WITHDRAWAL_KEYS.enabled]: '1', [WITHDRAWAL_KEYS.min]: '10',
        [WITHDRAWAL_KEYS.dailyCap]: '100000', [WITHDRAWAL_KEYS.holdHours]: '0',
      });

      const { client: admin } = await signedInAdmin(db);
      const referrer = await signedInUser(db, { balance: 0 });
      const users = [referrer];
      for (let i = 0; i < 6; i++) {
        const u = await signedInUser(db, { balance: 0 });
        if (i % 2 === 0) await db.user.update({ where: { id: u.user.id }, data: { referredById: referrer.user.id } });
        users.push(u);
      }
      const variants = [
        await createVariant(db, { price: 30, stock: -1 }),
        await createVariant(db, { price: 75.5, stock: 4 }),
        await createVariant(db, { price: 120, stock: 2 }),
      ];
      const initialStock = new Map(variants.map((v) => [v.id, v.stock]));
      const coupon = await createCoupon(db, { type: 'FIXED', value: 5, usageLimit: 3, perUserLimit: 2 });

      const statuses: number[] = [];
      const note = (s: number) => statuses.push(s);
      let trx = 0;
      const nextTrx = () => `S${seed}X${String(++trx).padStart(5, '0')}`;
      const refundKeys: string[] = [];

      const ops: Array<() => Promise<void>> = [
        // wallet deposit request
        async () => {
          const u = pick(users)!;
          const r = await u.client.post('/api/deposit', {
            method: 'BKASH', amount: money(20, 400), trxId: nextTrx(), senderNo: '01712345678',
          });
          note(r.status);
        },
        // admin approve / reject a pending deposit
        async () => {
          const d = pick(await db.deposit.findMany({ where: { status: 'PENDING' }, select: { id: true } }));
          if (!d) return;
          const r = await admin.post('/api/admin/deposit', { depositId: d.id, action: rnd() < 0.75 ? 'APPROVE' : 'REJECT' });
          note(r.status);
        },
        // wallet order, sometimes with coupon
        async () => {
          const u = pick(users)!;
          const v = pick(variants)!;
          const r = await u.client.post('/api/order', {
            variantId: v.id, playerUid: '123456789',
            couponCode: rnd() < 0.3 ? coupon.code : undefined,
            clientRef: rnd() < 0.5 ? `cr-${seed}-${Math.floor(rnd() * 20)}` : undefined,
          });
          note(r.status);
        },
        // direct-pay order
        async () => {
          const u = pick(users)!;
          const v = pick(variants)!;
          const r = await u.client.post('/api/order/direct', {
            variantId: v.id, playerUid: '123456789', method: 'NAGAD',
            trxId: nextTrx(), senderNo: '01812345678', amount: Number(v.price),
          });
          note(r.status);
        },
        // admin complete / fail a running order
        async () => {
          const o = pick(await db.order.findMany({ where: { status: { in: ['PENDING', 'PROCESSING'] } }, select: { id: true } }));
          if (!o) return;
          const r = await admin.post('/api/admin/order', { orderId: o.id, action: rnd() < 0.5 ? 'COMPLETE' : 'FAIL' });
          note(r.status);
        },
        // partial refund on a completed order (sometimes replaying an old key)
        async () => {
          const o = pick(await db.order.findMany({ where: { status: 'COMPLETED' }, select: { id: true, price: true, refundedAmount: true } }));
          if (!o) return;
          const replay = refundKeys.length > 0 && rnd() < 0.3;
          const requestId = replay ? pick(refundKeys)! : `rq${seed}x${Math.floor(rnd() * 1e9)}`;
          if (!replay) refundKeys.push(requestId);
          const left = Number(o.price) - Number(o.refundedAmount);
          const amount = Math.max(0.01, Math.round(left * (0.2 + rnd() * 0.9) * 100) / 100);
          const r = await admin.post('/api/admin/order/refund', { orderId: o.id, amount, reason: 'storm refund', requestId });
          note(r.status);
        },
        // withdrawal request + settle
        async () => {
          const u = pick(users)!;
          try {
            const w = await requestWithdrawal({ userId: u.user.id, amount: money(10, 60), method: 'BKASH', accountNumber: '01712345678' });
            if (rnd() < 0.5) await approveWithdrawal({ id: w.id, payoutRef: `PAY${trx}`, adminId: 'a', adminName: 'a' });
            else await rejectWithdrawal({ id: w.id, reason: 'storm', adminId: 'a', adminName: 'a' });
          } catch (e) {
            if (!(e instanceof Error && e.name === 'ApiError')) throw e;
          }
        },
        // expire stale direct-pay orders
        async () => {
          const o = pick(await db.order.findMany({ where: { status: 'AWAITING_PAYMENT' }, select: { id: true } }));
          if (!o) return;
          await db.order.update({ where: { id: o.id }, data: { createdAt: new Date(Date.now() - 6 * 3600_000) } });
          await expireDirectPayOrders();
        },
      ];
      const weights = [3, 4, 4, 2, 3, 2, 1, 1];
      const weighted = ops.flatMap((op, i) => Array.from({ length: weights[i] }, () => op));

      let done = 0;
      while (done < OPS_PER_SEED) {
        const burst = 2 + Math.floor(rnd() * 5);
        const batch = Array.from({ length: Math.min(burst, OPS_PER_SEED - done) }, () => pick(weighted)!);
        await Promise.all(batch.map((op) => op()));
        done += batch.length;
      }

      const ctx = `seed ${seed}`;
      // I7
      const bad = statuses.filter((s) => s >= 500 && s !== 503);
      expect(bad, `${ctx}: unexpected 5xx`).toEqual([]);

      // I1
      for (const u of await db.user.findMany({ select: { id: true, balance: true } })) {
        const sum = await db.ledgerEntry.aggregate({ where: { userId: u.id }, _sum: { amount: true } });
        expect(Number(u.balance), `${ctx}: I1 balance == ledger for ${u.id}`).toBeCloseTo(Number(sum._sum.amount ?? 0), 2);
        expect(Number(u.balance), `${ctx}: I1 non-negative ${u.id}`).toBeGreaterThanOrEqual(0);
      }

      const orders = await db.order.findMany();
      const approvedLinked = new Set(
        (await db.deposit.findMany({ where: { intent: 'ORDER_PAYMENT', status: 'APPROVED' }, select: { linkedOrderId: true } }))
          .map((d) => d.linkedOrderId),
      );
      const directIds = new Set(
        (await db.deposit.findMany({ where: { intent: 'ORDER_PAYMENT' }, select: { linkedOrderId: true } })).map((d) => d.linkedOrderId),
      );
      for (const o of orders) {
        const price = Number(o.price);
        const refunded = Number(o.refundedAmount);
        // I2
        expect(refunded, `${ctx}: I2 ${o.orderNo}`).toBeGreaterThanOrEqual(0);
        expect(refunded, `${ctx}: I2 ${o.orderNo}`).toBeLessThanOrEqual(price + 1e-9);
        if (o.status === 'REFUNDED') expect(refunded, `${ctx}: I2 refunded full ${o.orderNo}`).toBeCloseTo(price, 2);
        // I3
        const ref = await db.ledgerEntry.aggregate({ where: { refId: o.id, type: 'REFUND' }, _sum: { amount: true } });
        expect(Number(ref._sum.amount ?? 0), `${ctx}: I3 ${o.orderNo}`).toBeCloseTo(refunded, 2);
        // I4
        const debits = await db.ledgerEntry.count({ where: { refId: o.id, type: 'ORDER' } });
        // A direct-pay order is paid only if its deposit was approved while it was
        // still awaiting payment. If it expired first (FAILED), the approval credits
        // the wallet and the order is never debited — by design (directPayExpiry.ts).
        const paid = directIds.has(o.id)
          ? approvedLinked.has(o.id) && o.status !== 'FAILED' && o.status !== 'AWAITING_PAYMENT'
          : true;
        expect(debits, `${ctx}: I4 ${o.orderNo} (${o.status}, direct=${directIds.has(o.id)})`).toBe(paid ? 1 : 0);
      }

      // I5
      for (const v of variants) {
        const init = initialStock.get(v.id)!;
        if (init < 0) continue;
        const live = await db.order.count({ where: { variantId: v.id, status: { notIn: ['FAILED', 'REFUNDED'] } } });
        const row = await db.variant.findUniqueOrThrow({ where: { id: v.id } });
        expect(row.stock, `${ctx}: I5 stock variant ${v.id}`).toBe(init - live);
        expect(row.stock, `${ctx}: I5 non-negative ${v.id}`).toBeGreaterThanOrEqual(0);
      }

      // I6
      const c = await db.coupon.findUniqueOrThrow({ where: { id: coupon.id } });
      const uses = await db.couponUse.count({ where: { couponId: coupon.id } });
      const liveWithCoupon = await db.order.count({ where: { couponId: coupon.id, status: { notIn: ['FAILED', 'REFUNDED'] } } });
      expect(c.usageCount, `${ctx}: I6 usageCount vs uses`).toBe(uses);
      expect(uses, `${ctx}: I6 uses vs live orders`).toBe(liveWithCoupon);
      expect(c.usageCount, `${ctx}: I6 limit`).toBeLessThanOrEqual(3);

      // I8
      const dupCredits = await db.$queryRaw<Array<{ n: bigint }>>`
        SELECT COUNT(*)::bigint AS n FROM (
          SELECT "refId" FROM "LedgerEntry" WHERE type = 'DEPOSIT' AND "refId" IS NOT NULL
          GROUP BY "refId" HAVING COUNT(*) > 1) x`;
      expect(Number(dupCredits[0].n), `${ctx}: I8 double-credited deposits`).toBe(0);

      const counts = statuses.reduce<Record<number, number>>((m, s) => ((m[s] = (m[s] ?? 0) + 1), m), {});
      console.log(`[storm ${seed}] http statuses ${JSON.stringify(counts)} orders=${orders.length}`);
    }, 300_000);
  }
});
