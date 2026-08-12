/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ Group I (৫) — ওয়ালেট থেকে টাকা তোলা
 *
 *   এটিই প্রথম পথ যেখানে গ্রাহকের নির্দেশে টাকা **বাইরে** যায়।
 *   তাই এখানকার দাবিগুলো অন্য যেকোনো স্যুটের চেয়ে কড়া।
 *
 *   ⚠️ সবচেয়ে গুরুত্বপূর্ণ টেস্ট সবার শেষে: এলোমেলো ডিপোজিট /
 *   প্রত্যাহার / প্রত্যাখ্যান / রিফান্ডের পরেও
 *   `SUM(LedgerEntry.amount) === User.balance`।
 * ═══════════════════════════════════════════════════════════
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../vitest.setup';
import { createUser, balanceOf, ledgerSum } from './helpers/factories';
import { client, signedInUser } from './helpers/app';
import {
  requestWithdrawal, approveWithdrawal, rejectWithdrawal,
  withdrawableAmount, WITHDRAWAL_KEYS,
} from '../src/lib/services/withdrawal';
import { creditWallet } from '../src/lib/services/wallet';
import { invalidateSettings } from '../src/lib/settings';

/** ★ ফিচারটি ডিফল্টে বন্ধ — প্রতিটি টেস্টের আগে স্পষ্ট করে চালু করি */
async function enable(over: Record<string, string> = {}) {
  const pairs: Record<string, string> = {
    [WITHDRAWAL_KEYS.enabled]: '1',
    [WITHDRAWAL_KEYS.min]: '100',
    [WITHDRAWAL_KEYS.dailyCap]: '50000',
    // ★ বেশিরভাগ টেস্টে hold শূন্য — hold-এর নিজস্ব টেস্ট আলাদা
    [WITHDRAWAL_KEYS.holdHours]: '0',
    ...over,
  };
  for (const [key, value] of Object.entries(pairs)) {
    await db.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
  }
  invalidateSettings();
}

/** ★ ব্যালেন্স বসানো — খতিয়ানসহ, যাতে invariant অর্থবহ থাকে */
async function fund(userId: string, amount: number, type: 'DEPOSIT' | 'REFUND' = 'DEPOSIT') {
  await db.$transaction(async (tx) => {
    await creditWallet({ tx, userId, amount, type, note: 'টেস্ট তহবিল' });
  });
}

async function newFundedUser(amount: number) {
  const u = await createUser(db, {});
  await fund(u.id, amount);
  return u;
}

beforeEach(async () => {
  invalidateSettings();
});

describe('প্রত্যাহার — ডিফল্টে বন্ধ', () => {
  it('সেটিং চালু না করলে অনুরোধ প্রত্যাখ্যাত', async () => {
    const u = await newFundedUser(1000);
    // ★ enable() ডাকা হয়নি — ডিফল্ট অবস্থা
    await expect(
      requestWithdrawal({ userId: u.id, amount: 500, method: 'BKASH', accountNumber: '01712345678' }),
    ).rejects.toThrow();

    expect(await db.withdrawal.count()).toBe(0);
    expect(Number(await balanceOf(db, u.id))).toBe(1000);
  });
});

describe('প্রত্যাহার — অনুরোধে টাকা কাটে', () => {
  it('অনুরোধেই ব্যালেন্স কমে ও খতিয়ানে WITHDRAWAL লেখা হয়', async () => {
    await enable();
    const u = await newFundedUser(1000);

    const w = await requestWithdrawal({
      userId: u.id, amount: 400, method: 'BKASH', accountNumber: '01712345678',
    });

    expect(Number(await balanceOf(db, u.id))).toBe(600);
    const entry = await db.ledgerEntry.findFirst({ where: { refId: w.id, type: 'WITHDRAWAL' } });
    // ★ debit ঋণাত্মক লেখে — বাকি কোডবেসের সাথে মিল
    expect(Number(entry!.amount)).toBe(-400);
  });

  it('ব্যালেন্সের বেশি চাওয়া যায় না', async () => {
    await enable();
    const u = await newFundedUser(300);

    await expect(
      requestWithdrawal({ userId: u.id, amount: 500, method: 'BKASH', accountNumber: '01712345678' }),
    ).rejects.toThrow();
    expect(Number(await balanceOf(db, u.id))).toBe(300);
  });

  it('সর্বনিম্নের কম চাওয়া যায় না', async () => {
    await enable({ [WITHDRAWAL_KEYS.min]: '500' });
    const u = await newFundedUser(1000);

    await expect(
      requestWithdrawal({ userId: u.id, amount: 100, method: 'BKASH', accountNumber: '01712345678' }),
    ).rejects.toThrow();
  });

  it('দৈনিক সীমা মানা হয়', async () => {
    await enable({ [WITHDRAWAL_KEYS.dailyCap]: '1000' });
    const u = await newFundedUser(5000);

    await requestWithdrawal({ userId: u.id, amount: 900, method: 'BKASH', accountNumber: '01712345678' });
    await approveWithdrawal({
      id: (await db.withdrawal.findFirst({ where: { userId: u.id } }))!.id,
      payoutRef: 'TRX1', adminId: 'a', adminName: 'অ্যাডমিন',
    });

    // ★ আজ আর ২০০ তোলা যাবে না (৯০০ + ২০০ > ১০০০)
    await expect(
      requestWithdrawal({ userId: u.id, amount: 200, method: 'BKASH', accountNumber: '01712345678' }),
    ).rejects.toThrow();
  });

  /** ★★★ একই ব্যালেন্সে দুটি অনুরোধ — সমান্তরালে */
  it('সমান্তরাল দুটি অনুরোধে একটিই সফল হয়', async () => {
    await enable();
    const u = await newFundedUser(1000);

    const results = await Promise.allSettled([
      requestWithdrawal({ userId: u.id, amount: 800, method: 'BKASH', accountNumber: '01712345678' }),
      requestWithdrawal({ userId: u.id, amount: 800, method: 'BKASH', accountNumber: '01712345678' }),
    ]);

    const ok = results.filter((r) => r.status === 'fulfilled').length;
    expect(ok).toBe(1);
    expect(await db.withdrawal.count({ where: { userId: u.id } })).toBe(1);
    // ★★★ ব্যালেন্স কখনো ঋণাত্মক হয়নি
    expect(Number(await balanceOf(db, u.id))).toBe(200);
  });

  it('একটির বেশি ঝুলন্ত অনুরোধ থাকতে পারে না', async () => {
    await enable();
    const u = await newFundedUser(5000);

    await requestWithdrawal({ userId: u.id, amount: 500, method: 'BKASH', accountNumber: '01712345678' });
    await expect(
      requestWithdrawal({ userId: u.id, amount: 500, method: 'BKASH', accountNumber: '01712345678' }),
    ).rejects.toThrow();
  });
});

describe('প্রত্যাহার — অনুমোদন ও প্রত্যাখ্যান', () => {
  it('অনুমোদনে ব্যালেন্স আর নড়ে না (আগেই কাটা)', async () => {
    await enable();
    const u = await newFundedUser(1000);
    const w = await requestWithdrawal({ userId: u.id, amount: 400, method: 'BKASH', accountNumber: '01712345678' });

    await approveWithdrawal({ id: w.id, payoutRef: 'TRX-9', adminId: 'a', adminName: 'অ্যাডমিন' });

    expect(Number(await balanceOf(db, u.id))).toBe(600);
    expect(await db.ledgerEntry.count({ where: { refId: w.id } })).toBe(1);
  });

  it('দুবার অনুমোদন করা যায় না', async () => {
    await enable();
    const u = await newFundedUser(1000);
    const w = await requestWithdrawal({ userId: u.id, amount: 400, method: 'BKASH', accountNumber: '01712345678' });

    await approveWithdrawal({ id: w.id, payoutRef: 'TRX-1', adminId: 'a', adminName: 'অ্যাডমিন' });
    await expect(
      approveWithdrawal({ id: w.id, payoutRef: 'TRX-2', adminId: 'a', adminName: 'অ্যাডমিন' }),
    ).rejects.toThrow();

    expect(Number(await balanceOf(db, u.id))).toBe(600);
  });

  it('লেনদেন নম্বর ছাড়া অনুমোদন করা যায় না', async () => {
    await enable();
    const u = await newFundedUser(1000);
    const w = await requestWithdrawal({ userId: u.id, amount: 400, method: 'BKASH', accountNumber: '01712345678' });

    await expect(
      approveWithdrawal({ id: w.id, payoutRef: '  ', adminId: 'a', adminName: 'অ্যাডমিন' }),
    ).rejects.toThrow();
  });

  it('প্রত্যাখ্যানে টাকা ফেরে — নতুন সারিতে, পুরনোটি অক্ষত', async () => {
    await enable();
    const u = await newFundedUser(1000);
    const w = await requestWithdrawal({ userId: u.id, amount: 400, method: 'BKASH', accountNumber: '01712345678' });

    await rejectWithdrawal({ id: w.id, reason: 'নাম্বার ভুল', adminId: 'a', adminName: 'অ্যাডমিন' });

    expect(Number(await balanceOf(db, u.id))).toBe(1000);

    const entries = await db.ledgerEntry.findMany({ where: { refId: w.id }, orderBy: { createdAt: 'asc' } });
    expect(entries).toHaveLength(2);
    // ★★★ মূল debit **অক্ষত** — সম্পাদনা বা মোছা হয়নি
    expect(entries[0].type).toBe('WITHDRAWAL');
    expect(Number(entries[0].amount)).toBe(-400);
    expect(entries[1].type).toBe('WITHDRAWAL_REVERSAL');
    expect(Number(entries[1].amount)).toBe(400);
  });

  it('প্রত্যাখ্যানের পর আবার অনুরোধ করা যায়', async () => {
    await enable();
    const u = await newFundedUser(1000);
    const w = await requestWithdrawal({ userId: u.id, amount: 400, method: 'BKASH', accountNumber: '01712345678' });
    await rejectWithdrawal({ id: w.id, reason: 'ভুল', adminId: 'a', adminName: 'অ্যাডমিন' });

    const again = await requestWithdrawal({
      userId: u.id, amount: 400, method: 'BKASH', accountNumber: '01712345678',
    });
    expect(again.id).not.toBe(w.id);
    expect(Number(await balanceOf(db, u.id))).toBe(600);
  });

  it('প্রত্যাখ্যাত অনুরোধ দৈনিক সীমায় গোনা হয় না', async () => {
    await enable({ [WITHDRAWAL_KEYS.dailyCap]: '1000' });
    const u = await newFundedUser(5000);

    const w = await requestWithdrawal({ userId: u.id, amount: 900, method: 'BKASH', accountNumber: '01712345678' });
    await rejectWithdrawal({ id: w.id, reason: 'ভুল', adminId: 'a', adminName: 'অ্যাডমিন' });

    // ★ ৯০০ ফেরত গেছে, তাই আজ আবার ৯০০ তোলা যাবে
    await expect(
      requestWithdrawal({ userId: u.id, amount: 900, method: 'BKASH', accountNumber: '01712345678' }),
    ).resolves.toBeTruthy();
  });
});

describe('প্রত্যাহার — সাম্প্রতিক জমা আটকে থাকে (পাচার-প্রতিরোধ)', () => {
  it('৭২ ঘণ্টার মধ্যে জমা দেওয়া টাকা তোলা যায় না', async () => {
    await enable({ [WITHDRAWAL_KEYS.holdHours]: '72' });
    const u = await newFundedUser(1000); // ★ এইমাত্র জমা

    const usable = await withdrawableAmount(db, u.id, 1000, 72);
    expect(usable).toBe(0);

    await expect(
      requestWithdrawal({ userId: u.id, amount: 500, method: 'BKASH', accountNumber: '01712345678' }),
    ).rejects.toThrow();
  });

  it('পুরনো জমা তোলা যায়', async () => {
    await enable({ [WITHDRAWAL_KEYS.holdHours]: '72' });
    const u = await newFundedUser(1000);
    // ★ খতিয়ানের সারিটি ৪ দিন পিছিয়ে দিই
    await db.ledgerEntry.updateMany({
      where: { userId: u.id },
      data: { createdAt: new Date(Date.now() - 96 * 3600_000) },
    });

    expect(await withdrawableAmount(db, u.id, 1000, 72)).toBe(1000);
    await expect(
      requestWithdrawal({ userId: u.id, amount: 500, method: 'BKASH', accountNumber: '01712345678' }),
    ).resolves.toBeTruthy();
  });

  /** ★ রিফান্ডের টাকাও একই নিয়মে আটকে থাকে */
  it('রিফান্ডের টাকাও hold-এর আওতায়', async () => {
    await enable({ [WITHDRAWAL_KEYS.holdHours]: '72' });
    const u = await createUser(db, {});
    await fund(u.id, 800, 'REFUND');

    expect(await withdrawableAmount(db, u.id, 800, 72)).toBe(0);
  });
});

/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ খতিয়ান invariant — এই ফাইলের সবচেয়ে গুরুত্বপূর্ণ টেস্ট
 *
 *   এলোমেলো ক্রমে ডিপোজিট · প্রত্যাহার · প্রত্যাখ্যান · রিফান্ড
 *   চালিয়ে শেষে প্রতিটি ইউজারে `SUM(ledger) === balance` হতেই হবে।
 *   এটি ভাঙা মানে টাকার হিসাব ভুল — অন্য সব টেস্ট সবুজ হলেও।
 * ═══════════════════════════════════════════════════════════
 */
describe('খতিয়ান invariant — প্রত্যাহারসহ', () => {
  it('এলোমেলো ৬০টি অপারেশনের পরেও যোগফল = ব্যালেন্স', async () => {
    await enable({ [WITHDRAWAL_KEYS.min]: '50', [WITHDRAWAL_KEYS.dailyCap]: '1000000' });

    const users = await Promise.all([1, 2, 3, 4].map(() => createUser(db, {})));
    let deposits = 0, withdrawals = 0, rejects = 0, refunds = 0, skipped = 0;

    for (let i = 0; i < 60; i++) {
      const u = users[Math.floor(Math.random() * users.length)];
      const roll = Math.random();

      if (roll < 0.35) {
        await fund(u.id, Math.floor(Math.random() * 900) + 100, 'DEPOSIT');
        deposits++;
        continue;
      }

      if (roll < 0.5) {
        await fund(u.id, Math.floor(Math.random() * 300) + 50, 'REFUND');
        refunds++;
        continue;
      }

      // ★ প্রত্যাহার — ব্যর্থ হলে সেটিও বৈধ ফল (সীমা/ঝুলন্ত/ব্যালেন্স)
      const amount = Math.floor(Math.random() * 400) + 50;
      try {
        const w = await requestWithdrawal({
          userId: u.id, amount, method: 'BKASH', accountNumber: '01712345678',
        });
        withdrawals++;

        // ★ অর্ধেক প্রত্যাখ্যান, অর্ধেক অনুমোদন
        if (Math.random() < 0.5) {
          await rejectWithdrawal({ id: w.id, reason: 'এলোমেলো', adminId: 'a', adminName: 'অ্যাডমিন' });
          rejects++;
        } else {
          await approveWithdrawal({ id: w.id, payoutRef: `TRX${i}`, adminId: 'a', adminName: 'অ্যাডমিন' });
        }
      } catch {
        skipped++;
      }
    }

    console.log(
      `    ${deposits} জমা · ${refunds} রিফান্ড · ${withdrawals} প্রত্যাহার ` +
      `(${rejects} প্রত্যাখ্যাত) · ${skipped} বাদ`,
    );

    for (const u of users) {
      const bal = Number(await balanceOf(db, u.id));
      const sum = Number(await ledgerSum(db, u.id));
      expect(bal, `ইউজার ${u.id}: ব্যালেন্স ${bal} ≠ খতিয়ান ${sum}`).toBe(sum);
      // ★★★ কোনো অবস্থাতেই ঋণাত্মক নয়
      expect(bal).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('প্রত্যাহার — পাতা ও গার্ড', () => {
  it('সাধারণ ইউজার অ্যাডমিন সারিতে ঢুকতে পারে না', async () => {
    const { client: c } = await signedInUser(db, {});
    expect((await c.get('/api/admin/withdrawals')).status).toBe(403);
  });

  it('লগইন ছাড়া প্রত্যাহার API ছোঁয়া যায় না', async () => {
    expect((await client().get('/api/account/withdraw')).status).toBe(401);
    expect(
      (await client().post('/api/account/withdraw', {
        amount: 100, method: 'BKASH', accountNumber: '01712345678', code: '123456',
      })).status,
    ).toBe(401);
  });

  /** ★★★ কোড ছাড়া টাকা বেরোতে পারবে না */
  it('OTP ছাড়া অনুরোধ প্রত্যাখ্যাত ও ব্যালেন্স অক্ষত', async () => {
    await enable();
    const { user, client: c } = await signedInUser(db, {});
    await fund(user.id, 2000);

    const res = await c.post('/api/account/withdraw', {
      amount: 500, method: 'BKASH', accountNumber: '01712345678', code: '000000',
    });

    expect(res.status).toBe(400);
    expect(Number(await balanceOf(db, user.id))).toBe(2000);
    expect(await db.withdrawal.count()).toBe(0);
  });

  it('ফিচার বন্ধ থাকলে গ্রাহকের পাতা সেটিই বলে', async () => {
    const { client: c } = await signedInUser(db, {});
    const html = await (await c.raw('/account/wallet/withdraw')).text();
    expect(html).toContain('এখনো চালু হয়নি');
  });
});
