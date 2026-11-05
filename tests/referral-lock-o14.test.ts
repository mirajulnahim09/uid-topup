/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ O-14 — রেফারেল লক FK-এর `KEY SHARE`-কে আটকায় না
 *
 *   আগে `payReferralBonus` (src/lib/referral.ts) রেফার্ড ইউজারের রো
 *   `FOR UPDATE` লক করত। সেই মোড যেকোনো সমান্তরাল FK-ইনসার্টের
 *   (Notification/Order/LedgerEntry → User) `FOR KEY SHARE`-এর সাথে সংঘাত
 *   করে, তাই ডিপোজিট APPROVE আর একটি Notification ইনসার্ট মাঝেমধ্যে
 *   deadlock-এ পড়ত (D3 লক-ঝড়ে দুবার দেখা গেছে)।
 *   এখন `FOR NO KEY UPDATE`: `referralBonusPaid` পড়া→লেখা তবুও
 *   সিরিয়াল (দুটি NO KEY UPDATE পরস্পরকে আটকায়), কিন্তু KEY SHARE মুক্ত।
 *
 *   দাবি:
 *     ১) লক ধরে রাখা অবস্থায় একই ইউজারের Notification ইনসার্ট অপেক্ষা
 *        না করে শেষ হয় (আগের FOR UPDATE-এ এটি আটকে থাকত) — নির্ধারক
 *     ২) একই ইউজারে ১০টি সমান্তরাল payReferralBonus → বোনাস ঠিক একবার
 *     ৩) লক-ঝড়: APPROVE + FK-ইনসার্ট + অর্ডার একসাথে, বারবার →
 *        `pg_stat_database.deadlocks` Δ = ০, কোনো ৫xx নেই, বোনাস একবার
 *   ⚠️ কেবল টেস্ট DB-তে।
 * ═══════════════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { db } from '../vitest.setup';
import { signedInUser, signedInAdmin } from './helpers/app';
import { createUser, createDeposit, createVariant, balanceOf, ledgerSum } from './helpers/factories';
import { payReferralBonus } from '../src/lib/referral';

let seq = 0;
const rid = (p: string) => `${p}-${Date.now().toString(36)}-${seq++}`;

const deadlocks = async () =>
  Number((await db.$queryRaw<Array<{ n: bigint }>>`
    SELECT deadlocks AS n FROM pg_stat_database WHERE datname = current_database()`)[0].n);

const bonusEntries = (referrerId: string) =>
  db.ledgerEntry.count({ where: { userId: referrerId, type: 'REFERRAL_BONUS' } });

async function referredPair() {
  const referrer = await createUser(db, {});
  const friend = await createUser(db, {});
  await db.user.update({ where: { id: friend.id }, data: { referredById: referrer.id } });
  return { referrer, friend };
}

describe('O-14 — রেফারেল লক বনাম FK KEY SHARE', () => {
  it('লক ধরা অবস্থায় একই ইউজারের Notification ইনসার্ট আটকায় না', async () => {
    const { referrer, friend } = await referredPair();

    let locked!: () => void; const gotLock = new Promise<void>((r) => (locked = r));
    let release!: () => void; const done = new Promise<void>((r) => (release = r));

    const holder = db.$transaction(async (tx) => {
      const paid = await payReferralBonus(tx, friend.id, 500);
      locked();
      await done; // লক ও আপডেট-করা রো ধরে রাখি
      return paid;
    }, { timeout: 30_000, maxWait: 5_000 });
    await gotLock;

    const insert = db.notification
      .create({ data: { userId: friend.id, title: 'O-14', body: 'FK KEY SHARE probe' } })
      .then(() => 'inserted' as const);
    const timeout = new Promise<'blocked'>((r) => setTimeout(() => r('blocked'), 3_000));
    const outcome = await Promise.race([insert, timeout]);

    release();
    const paid = await holder;
    await insert; // আটকে থাকলেও এখন শেষ হবে — ঝুলন্ত প্রমিস রাখি না

    expect(outcome).toBe('inserted');
    expect(paid?.referrerId).toBe(referrer.id);
    expect(await bonusEntries(referrer.id)).toBe(1);
  }, 30_000);

  it('একই ইউজারে ১০টি সমান্তরাল payReferralBonus → বোনাস ঠিক একবার', async () => {
    const { referrer, friend } = await referredPair();

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        db.$transaction((tx) => payReferralBonus(tx, friend.id, 500), { timeout: 30_000, maxWait: 10_000 }),
      ),
    );

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await bonusEntries(referrer.id)).toBe(1);
    expect(Number(await balanceOf(db, referrer.id))).toBe(Number(await ledgerSum(db, referrer.id)));
    expect((await db.user.findUniqueOrThrow({ where: { id: friend.id } })).referralBonusPaid).toBe(true);
  }, 60_000);

  it('লক-ঝড়: APPROVE + FK-ইনসার্ট + অর্ডার × ১২ রাউন্ড → deadlocks Δ = ০, ৫xx নেই, বোনাস একবার', async () => {
    const { client: admin } = await signedInAdmin(db);
    const variant = await createVariant(db, { price: 50, stock: 1_000 });
    const d0 = await deadlocks();
    const codes: number[] = [];

    for (let r = 0; r < 12; r++) {
      const referrer = await createUser(db, {});
      const { user: friend, client: cust } = await signedInUser(db, { balance: 500 });
      await db.user.update({ where: { id: friend.id }, data: { referredById: referrer.id } });
      const deps = await Promise.all([createDeposit(db, friend.id, { amount: 500 }), createDeposit(db, friend.id, { amount: 500 })]);

      const probes = Array.from({ length: 6 }, (_, i) =>
        db.notification
          .create({ data: { userId: friend.id, title: `storm ${r}/${i}`, body: 'O-14' } })
          .then(() => ({ status: 201 }), () => ({ status: 599 })),
      );
      const res = await Promise.all([
        admin.post('/api/admin/deposit', { depositId: deps[0].id, action: 'APPROVE' }),
        admin.post('/api/admin/deposit', { depositId: deps[1].id, action: 'APPROVE' }),
        cust.post('/api/order', { variantId: variant.id, playerUid: '123456789', clientRef: rid('o') }),
        cust.post('/api/order', { variantId: variant.id, playerUid: '123456789', clientRef: rid('o') }),
        cust.get('/api/me'),
        ...probes,
      ]);
      res.forEach((x) => codes.push(x.status));

      expect(await bonusEntries(referrer.id)).toBeLessThanOrEqual(1);
      expect(Number(await balanceOf(db, friend.id))).toBe(Number(await ledgerSum(db, friend.id)) + 500);
    }

    const d1 = await deadlocks();
    const bad = codes.filter((c) => c >= 500);
    console.log(`[O-14] requests=${codes.length} 5xx=${bad.length} deadlocksΔ=${d1 - d0}`);
    expect(d1 - d0).toBe(0);
    expect(bad).toEqual([]);
  }, 180_000);
});
