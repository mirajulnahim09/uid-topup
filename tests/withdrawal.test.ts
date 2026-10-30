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
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '../vitest.setup';
import { createUser, balanceOf, ledgerSum } from './helpers/factories';
import { client, signedInUser, signedInAdmin } from './helpers/app';
import {
  requestWithdrawal, approveWithdrawal, rejectWithdrawal,
  withdrawableAmount, WITHDRAWAL_KEYS,
} from '../src/lib/services/withdrawal';
import { creditWallet, debitWallet } from '../src/lib/services/wallet';
import { payReferralBonus } from '../src/lib/referral';
import { invalidateSettings } from '../src/lib/settings';
import { issueOtp } from '../src/lib/otp/core';

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
async function fund(
  userId: string,
  amount: number,
  type: 'DEPOSIT' | 'REFUND' | 'REFERRAL_BONUS' | 'ADMIN_ADJUST' = 'DEPOSIT',
) {
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

  /**
   * ★★★ দৈনিক সীমা **ঢাকার** মধ্যরাতে নতুন হয় — সার্ভার UTC হলেও (মালিকের
   *   সিদ্ধান্ত, চূড়ান্ত মাস্টার অডিট ২০২৬-০৯-১৭)। আগে `setHours` সার্ভারের ঘড়ি
   *   ধরত: Vercel-এ দিন বদলাত ঢাকার সকাল ৬টায়, তাই রাত ১১:৩০-এর তোলা টাকা
   *   পরদিন রাত ১২:৩০-এও "আজকের" হিসেবে গোনা হতো।
   */
  it('দৈনিক সীমা ঢাকার মধ্যরাতে নতুন হয় (সার্ভার UTC)', async () => {
    const prevTz = process.env.TZ;
    process.env.TZ = 'UTC';
    try {
      await enable({ [WITHDRAWAL_KEYS.dailyCap]: '1000' });
      const yesterdayUser = await newFundedUser(5000);
      const todayUser = await newFundedUser(5000);
      const past = { amount: 900, method: 'BKASH', accountNumber: '01712345678', status: 'APPROVED' as const };
      // ঢাকা ১৭ তারিখ ২৩:৩০ (= ১৭:৩০Z) — "গতকাল"
      await db.withdrawal.create({ data: { ...past, userId: yesterdayUser.id, createdAt: new Date('2026-09-17T17:30:00Z') } });
      // ঢাকা ১৮ তারিখ ০০:১০ (= ১৮:১০Z) — "আজ"
      await db.withdrawal.create({ data: { ...past, userId: todayUser.id, createdAt: new Date('2026-09-17T18:10:00Z') } });

      // এখন: ঢাকা ১৮ তারিখ ০০:৩০ (= ১৮:৩০Z) — UTC-তে এখনো ১৭ তারিখ
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-09-17T18:30:00Z'));

      await expect(
        requestWithdrawal({ userId: yesterdayUser.id, amount: 200, method: 'BKASH', accountNumber: '01712345678' }),
      ).resolves.toBeTruthy();
      await expect(
        requestWithdrawal({ userId: todayUser.id, amount: 200, method: 'BKASH', accountNumber: '01712345678' }),
      ).rejects.toThrow(/দৈনিক সর্বোচ্চ/);
    } finally {
      vi.useRealTimers();
      process.env.TZ = prevTz;
    }
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

/** ★ খতিয়ানের সারি পিছিয়ে দেওয়া — "N ঘণ্টা আগের" ক্রেডিট বানাতে */
async function ageLedger(userId: string, type: 'DEPOSIT' | 'REFERRAL_BONUS' | 'ADMIN_ADJUST', hours: number) {
  await db.ledgerEntry.updateMany({
    where: { userId, type },
    data: { createdAt: new Date(Date.now() - hours * 3600_000) },
  });
}

/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ FIN-01 (মালিকের সিদ্ধান্ত, ২০২৬-০৯-২৭)
 *
 *   ১. রেফারেল বোনাস ৭২ ঘণ্টা তোলা যায় না — ডিপোজিট-hold সেটিং ০ হলেও।
 *   ২. অ্যাডমিনের ধনাত্মক সমন্বয় কখনো নিজে থেকে তোলার যোগ্য নয়।
 *
 *   আগে দুটোই সাথে সাথে পুরোপুরি তোলা যেত (hold শুধু DEPOSIT/REFUND ধরত)।
 * ═══════════════════════════════════════════════════════════
 */
describe('FIN-01 — রেফারেল বোনাস ৭২ ঘণ্টা আটকে', () => {
  it('সদ্য পাওয়া বোনাস তোলা যায় না — ডিপোজিট-hold ০ হলেও', async () => {
    await enable(); // holdHours = 0
    const u = await createUser(db, {});
    await fund(u.id, 1000);
    await ageLedger(u.id, 'DEPOSIT', 96);
    await fund(u.id, 200, 'REFERRAL_BONUS');

    expect(await withdrawableAmount(db, u.id, 1200, 0)).toBe(1000);
    await expect(
      requestWithdrawal({ userId: u.id, amount: 1100, method: 'BKASH', accountNumber: '01712345678' }),
    ).rejects.toThrow();
    expect(Number(await balanceOf(db, u.id))).toBe(1200);
    expect(await db.withdrawal.count({ where: { userId: u.id } })).toBe(0);
  });

  /**
   * ★★★ সীমানা — নকল ঘড়িতে, ঘুমিয়ে নয়। সার্ভারের ঘড়ি `T0`-এ স্থির, বোনাস-সারির
   *   `createdAt` ঠিক কতটা পিছনে তা হাতে বসানো। তাই ফল মিলিসেকেন্ডে নির্ধারিত।
   */
  const T0 = new Date('2026-10-01T06:00:00.000Z');
  const H = 3600_000;

  async function withClock<T>(fn: () => Promise<T>): Promise<T> {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    try { return await fn(); } finally { vi.useRealTimers(); }
  }

  // ★ প্রতিটি সারি নিজের অনন্য note দিয়ে ধরা — "সর্বশেষ সারি" ধরলে আগে পিছিয়ে
  //   দেওয়া সারিটিই আবার ধরা পড়তে পারে (T0 আসল সময়ের পরে বলে)
  let seq = 0;
  async function bonusAged(userId: string, amount: number, ageMs: number) {
    const note = `টেস্ট বোনাস #${++seq}`;
    await db.$transaction((tx) => creditWallet({ tx, userId, amount, type: 'REFERRAL_BONUS', note }));
    const e = await db.ledgerEntry.findFirstOrThrow({ where: { userId, type: 'REFERRAL_BONUS', note } });
    await db.ledgerEntry.update({ where: { id: e.id }, data: { createdAt: new Date(T0.getTime() - ageMs) } });
  }

  it('সীমানা: ৭১ঘ ৫৯মি → আটকে · ঠিক ৭২ঘ → মুক্ত · ৭২ঘ − ১ms → আটকে', async () => {
    await enable();
    const a = await createUser(db, {});
    const b = await createUser(db, {});
    const c = await createUser(db, {});
    await withClock(async () => {
      await bonusAged(a.id, 150, 71 * H + 59 * 60_000);
      await bonusAged(b.id, 150, 72 * H);
      await bonusAged(c.id, 150, 72 * H - 1);
      expect(await withdrawableAmount(db, a.id, 150, 0)).toBe(0);
      expect(await withdrawableAmount(db, b.id, 150, 0)).toBe(150);
      expect(await withdrawableAmount(db, c.id, 150, 0)).toBe(0);
    });
  });

  it('ঠিক ৭২ ঘণ্টায় আসল অনুরোধ সফল, খতিয়ান অটুট', async () => {
    await enable();
    const u = await createUser(db, {});
    await withClock(async () => {
      await bonusAged(u.id, 150, 72 * H);
      await expect(
        requestWithdrawal({ userId: u.id, amount: 150, method: 'BKASH', accountNumber: '01712345678' }),
      ).resolves.toBeTruthy();
    });
    expect(Number(await balanceOf(db, u.id))).toBe(0);
    expect(await ledgerSum(db, u.id)).toBe(0);
  });

  it('একাধিক বোনাস — প্রতিটির hold আলাদা হিসাব হয়', async () => {
    await enable();
    const u = await createUser(db, {});
    await withClock(async () => {
      await bonusAged(u.id, 100, 80 * H); // মুক্ত
      await bonusAged(u.id, 40, 50 * H);  // আটকে (আরও ২২ঘ)
      await bonusAged(u.id, 25, 1 * H);   // আটকে (আরও ৭১ঘ)
      expect(await withdrawableAmount(db, u.id, 165, 0)).toBe(100);
    });
    // ★ ২৩ ঘণ্টা পরে: মাঝেরটিও মুক্ত, সবশেষটি নয়
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(T0.getTime() + 23 * H));
    try {
      expect(await withdrawableAmount(db, u.id, 165, 0)).toBe(140);
    } finally { vi.useRealTimers(); }
  });

  it('ডিপোজিটের টাকা বোনাসের hold পায় না (holdHours ০-তে সদ্য জমাও পুরো তোলা যায়)', async () => {
    await enable();
    const u = await createUser(db, {});
    await fund(u.id, 700);          // সদ্য জমা — ডিপোজিট-hold ০
    await fund(u.id, 50, 'REFERRAL_BONUS');
    expect(await withdrawableAmount(db, u.id, 750, 0)).toBe(700);
  });

  it('সমান্তরাল অনুরোধ: আটকে থাকা বোনাস খরচ হয় না, দ্বিগুণ কাটা নেই', async () => {
    await enable();
    const u = await createUser(db, {});
    await fund(u.id, 1000);
    await ageLedger(u.id, 'DEPOSIT', 96);
    await fund(u.id, 200, 'REFERRAL_BONUS'); // ব্যালেন্স ১২০০, তোলার যোগ্য ১০০০

    // ★ বোনাসসহ অঙ্ক — দুটোই প্রত্যাখ্যাত
    const over = await Promise.allSettled([1100, 1100].map((amount) =>
      requestWithdrawal({ userId: u.id, amount, method: 'BKASH', accountNumber: '01712345678' })));
    expect(over.every((r) => r.status === 'rejected')).toBe(true);
    expect(Number(await balanceOf(db, u.id))).toBe(1200);

    // ★ বৈধ অঙ্কে দুটি একসাথে — ঠিক একটি
    const rs = await Promise.allSettled([600, 600].map((amount) =>
      requestWithdrawal({ userId: u.id, amount, method: 'BKASH', accountNumber: '01712345678' })));
    expect(rs.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const w = await db.withdrawal.findFirstOrThrow({ where: { userId: u.id } });
    await approveWithdrawal({ id: w.id, payoutRef: 'FIN01-C1', adminId: 'a', adminName: 'অ্যাডমিন' });

    // ★ বাকি ৬০০-র মধ্যে ২০০ বোনাস — তাই এখন সর্বোচ্চ ৪০০
    expect(await withdrawableAmount(db, u.id, 600, 0)).toBe(400);
    await expect(
      requestWithdrawal({ userId: u.id, amount: 500, method: 'BKASH', accountNumber: '01712345678' }),
    ).rejects.toThrow();
    expect(Number(await balanceOf(db, u.id))).toBe(600);
    expect(await ledgerSum(db, u.id)).toBe(600);
  });

  it('বোনাস অর্ডারে খরচ → রিফান্ড: ৭২ ঘণ্টার আগে তবুও তোলা যায় না, খতিয়ান অটুট', async () => {
    await enable(); // রিফান্ড-hold ০ — তবু বোনাসের hold বহাল
    const u = await createUser(db, {});
    await fund(u.id, 200, 'REFERRAL_BONUS');
    await db.$transaction((tx) => debitWallet({ tx, userId: u.id, amount: 200, type: 'ORDER', note: 'টেস্ট অর্ডার' }));
    await fund(u.id, 200, 'REFUND');

    expect(Number(await balanceOf(db, u.id))).toBe(200);
    expect(await withdrawableAmount(db, u.id, 200, 0)).toBe(0);
    await expect(
      requestWithdrawal({ userId: u.id, amount: 200, method: 'BKASH', accountNumber: '01712345678' }),
    ).rejects.toThrow();
    expect(await ledgerSum(db, u.id)).toBe(200);
  });

  it('আসল পথ: payReferralBonus-এর বোনাস রেফারারের তোলার যোগ্য অঙ্কে পড়ে না', async () => {
    await enable();
    const referrer = await createUser(db, {});
    const friend = await createUser(db, {});
    await db.user.update({ where: { id: friend.id }, data: { referredById: referrer.id } });

    const paid = await db.$transaction((tx) => payReferralBonus(tx, friend.id, 500));
    expect(paid?.referrerId).toBe(referrer.id);

    const bal = Number(await balanceOf(db, referrer.id));
    expect(bal).toBeGreaterThan(0);
    expect(await withdrawableAmount(db, referrer.id, bal, 0)).toBe(0);
    expect(await ledgerSum(db, referrer.id)).toBe(bal);
  });
});

describe('FIN-01 — অ্যাডমিনের ধনাত্মক সমন্বয় তোলা যায় না', () => {
  it('অ্যাডমিন রুটে দেওয়া ক্রেডিট — এক বছর পরেও তোলার যোগ্য নয়', async () => {
    await enable(); // holdHours = 0
    const u = await createUser(db, {});
    await fund(u.id, 1000);
    await ageLedger(u.id, 'DEPOSIT', 96);

    const { client: a } = await signedInAdmin(db);
    const res = await a.post('/api/admin/user', {
      userId: u.id, amount: 300, note: 'ক্ষতিপূরণ', requestId: 'fin01-adj-0001',
    });
    expect(res.status).toBe(200);
    await ageLedger(u.id, 'ADMIN_ADJUST', 24 * 365);

    expect(Number(await balanceOf(db, u.id))).toBe(1300);
    expect(await withdrawableAmount(db, u.id, 1300, 0)).toBe(1000);
    await expect(
      requestWithdrawal({ userId: u.id, amount: 1100, method: 'BKASH', accountNumber: '01712345678' }),
    ).rejects.toThrow();
    // ★ নিজের জমা টাকা আগের মতোই তোলা যায়
    await expect(
      requestWithdrawal({ userId: u.id, amount: 1000, method: 'BKASH', accountNumber: '01712345678' }),
    ).resolves.toBeTruthy();
    expect(Number(await balanceOf(db, u.id))).toBe(300);
    expect(await ledgerSum(db, u.id)).toBe(300);
  });

  it('খরচ করে রিফান্ড হয়ে এলেও অ্যাডমিনের অংশটুকু আটকে থাকে', async () => {
    await enable();
    const u = await createUser(db, {});
    await fund(u.id, 500, 'ADMIN_ADJUST');
    // অর্ডারে খরচ → পুরো রিফান্ড (hold ০, তাই রিফান্ড নিজে আটকায় না)
    await db.$transaction((tx) => debitWallet({ tx, userId: u.id, amount: 500, type: 'ORDER', note: 'টেস্ট অর্ডার' }));
    await fund(u.id, 500, 'REFUND');

    expect(await withdrawableAmount(db, u.id, 500, 0)).toBe(0);
  });

  it('ভুল ক্রেডিট ডেবিটে শুধরে দিলে গ্রাহকের নিজের টাকা আটকায় না (নিট)', async () => {
    await enable();
    const u = await createUser(db, {});
    await fund(u.id, 1000);
    await fund(u.id, 400, 'ADMIN_ADJUST');
    await db.$transaction((tx) => debitWallet({ tx, userId: u.id, amount: 400, type: 'ADMIN_ADJUST', note: 'ভুল শুধরানো' }));

    expect(Number(await balanceOf(db, u.id))).toBe(1000);
    expect(await withdrawableAmount(db, u.id, 1000, 0)).toBe(1000);
  });

  it('শুধু ডেবিট-সমন্বয় (জরিমানা) তোলার যোগ্য অঙ্ক ব্যালেন্সের বেশি বানায় না', async () => {
    await enable();
    const u = await createUser(db, {});
    await fund(u.id, 1000);
    await db.$transaction((tx) => debitWallet({ tx, userId: u.id, amount: 200, type: 'ADMIN_ADJUST', note: 'জরিমানা' }));

    expect(await withdrawableAmount(db, u.id, 800, 0)).toBe(800);
  });

  it('অপরিবর্তিত: ধনাত্মক সমন্বয় কেনাকাটায় খরচ করা যায় (ব্যালেন্স কমে না)', async () => {
    await enable();
    const u = await createUser(db, {});
    await fund(u.id, 300, 'ADMIN_ADJUST');
    await db.$transaction((tx) => debitWallet({ tx, userId: u.id, amount: 250, type: 'ORDER', note: 'টেস্ট অর্ডার' }));
    expect(Number(await balanceOf(db, u.id))).toBe(50);
    expect(await ledgerSum(db, u.id)).toBe(50);
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

  /**
   * ★★★ চূড়ান্ত অডিট (২০২৬-০৯-১৭) — আগে OTP আগে খরচ হতো, তারপর অঙ্ক/
   *   নাম্বার যাচাই। ভুল অঙ্ক দিলেই কোড নষ্ট, গ্রাহককে নতুন কোড চাইতে হতো।
   */
  it('ভুল অঙ্ক বা নাম্বারে OTP খরচ হয় না — একই কোডে পরে সঠিক অনুরোধ চলে', async () => {
    await enable();
    const { user, client: c } = await signedInUser(db, {});
    await fund(user.id, 2000);
    const { code } = await issueOtp({ channel: 'EMAIL', purpose: 'WITHDRAW', destination: user.email });

    const low = await c.post('/api/account/withdraw', {
      amount: 50, method: 'BKASH', accountNumber: '01712345678', code,
    });
    expect(low.status).toBe(400);
    const badNo = await c.post('/api/account/withdraw', {
      amount: 500, method: 'BKASH', accountNumber: '01112345678', code,
    });
    expect(badNo.status).toBe(400);
    expect(Number(await balanceOf(db, user.id))).toBe(2000);

    const ok = await c.post('/api/account/withdraw', {
      amount: 500, method: 'BKASH', accountNumber: '01712345678', code,
    });
    expect(ok.status).toBe(200);
    expect(Number(await balanceOf(db, user.id))).toBe(1500);
    expect(await ledgerSum(db, user.id)).toBe(1500);
  });

  it('ফিচার বন্ধ থাকলে গ্রাহকের পাতা সেটিই বলে', async () => {
    const { client: c } = await signedInUser(db, {});
    const html = await (await c.raw('/account/wallet/withdraw')).text();
    expect(html).toContain('এখনো চালু হয়নি');
  });
});
