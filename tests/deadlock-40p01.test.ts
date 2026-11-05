/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ SCL-01 / NV-F — আসল Postgres deadlock (40P01) রানটাইমে
 *
 *   নির্ধারক চক্র: টেস্ট-প্রসেস আগে User-সারি লক করে; অর্ডার-transaction
 *   variant → (user-এর জন্য অপেক্ষা); তারপর টেস্ট variant চায় → চক্র। অর্ডার-
 *   transaction আগে অপেক্ষা শুরু করায় deadlock_timeout (১s) পেরিয়ে সে-ই চক্র ধরে
 *   ও Postgres তাকেই বাতিল করে (40P01)। দাবি:
 *     · গ্রাহক পান ৫০৩ + Retry-After (সাধারণ ৫০০ নয়)
 *     · টাকা/স্টক/অর্ডার/খতিয়ান কিছুই বদলায় না; অন্য transaction অক্ষত শেষ হয়
 *   ⚠️ কেবল টেস্ট DB-তে; প্রোডাকশনে deadlock চালানো হয় না।
 * ═══════════════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { db } from '../vitest.setup';
import { signedInUser } from './helpers/app';
import { createVariant, balanceOf, ledgerSum } from './helpers/factories';

describe('40P01 — আসল deadlock', () => {
  it('অর্ডার-transaction deadlock-এর শিকার → ৫০৩ BUSY; কিছুই বদলায় না', async () => {
    const variant = await createVariant(db, { price: 150, stock: 5 });
    const { user, client: c } = await signedInUser(db, { balance: 500 });
    // ★ ধাপ-নিয়ন্ত্রণ — নির্ধারক ক্রম
    let userLocked!: () => void; const gotUser = new Promise<void>((r) => (userLocked = r));
    let proceed!: () => void; const goOn = new Promise<void>((r) => (proceed = r));

    let holderError: unknown = null;
    const holder = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${user.id} FOR UPDATE`;
      userLocked();
      await goOn; // অর্ডার-transaction variant নিয়ে user-এর জন্য অপেক্ষা শুরু করুক
      await tx.$queryRaw`SELECT id FROM "Variant" WHERE id = ${variant.id} FOR UPDATE`;
    }, { timeout: 30_000, maxWait: 5_000 }).catch((e) => { holderError = e; });
    await gotUser;

    const orderP = c.post<{ code?: string; error?: string }>('/api/order', { variantId: variant.id, playerUid: '123456789' });
    // অর্ডার-রুট variant লক করে user-এ আটকেছে কি না — pg_locks দেখে নিশ্চিত হই
    for (let i = 0; i < 60; i++) {
      const w = await db.$queryRaw<Array<{ n: bigint }>>`
        SELECT count(*)::bigint AS n FROM pg_locks WHERE NOT granted AND locktype = 'transactionid'`;
      if (Number(w[0].n) > 0) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    proceed();

    const res = await orderP;
    await holder;

    expect(holderError).toBeNull();              // অন্য transaction ঠিকঠাক শেষ
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('5');
    expect(res.body.code).toBe('BUSY');
    expect(await balanceOf(db, user.id)).toBe(500);
    expect(await ledgerSum(db, user.id)).toBe(0);
    expect(await db.order.count({ where: { userId: user.id } })).toBe(0);
    expect((await db.variant.findUniqueOrThrow({ where: { id: variant.id } })).stock).toBe(5);
  }, 60_000);
});
