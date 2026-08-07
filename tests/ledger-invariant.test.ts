/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ খতিয়ান invariant (Group D — RUN.md যা স্পষ্ট চেয়েছে)
 *
 *   দাবি: **প্রতিটি** ব্যবহারকারীর জন্য
 *         `SUM(LedgerEntry.amount) === User.balance`
 *   ১০০টি এলোমেলো অপারেশনের পরেও।
 *
 *   ── কেন এটিই সবচেয়ে গুরুত্বপূর্ণ টেস্ট ──
 *   `LedgerEntry` হলো টাকার **একমাত্র সত্য**। ব্যালেন্স তার
 *   সারাংশ মাত্র। দুটি সরে গেলে কোনটি ঠিক তা আর বলা যায় না —
 *   গ্রাহকের টাকা নিয়ে বিতর্কে প্রমাণ থাকে না। তাই এটি
 *   একটিমাত্র সংখ্যা নয়, পুরো টাকার মডেলের স্বাস্থ্য-পরীক্ষা।
 * ═══════════════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import { db } from '../vitest.setup';
import { creditWallet, debitWallet } from '@/lib/services/wallet';

/** পুনরুৎপাদনযোগ্য এলোমেলো — ব্যর্থতা ধরা পড়লে হুবহু আবার চালানো যায় */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

async function mkUser(n: number, balance = 0) {
  return db.user.create({
    data: {
      email: `ledger${n}@test.local`,
      name: `Ledger User ${n}`,
      phone: `L${n}${Date.now().toString().slice(-8)}`,
      password: 'x'.repeat(60),
      referralCode: `LDG${n}${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
      balance,
    },
    select: { id: true },
  });
}

/** প্রতিটি ব্যবহারকারীর খতিয়ান-যোগফল ও ব্যালেন্স মেলে কিনা */
async function assertInvariant() {
  const users = await db.user.findMany({ select: { id: true, email: true, balance: true } });
  for (const u of users) {
    const agg = await db.ledgerEntry.aggregate({
      where: { userId: u.id },
      _sum: { amount: true },
    });
    const sum = Number(agg._sum.amount ?? 0);
    expect(
      Number(u.balance),
      `${u.email}: খতিয়ান ৳${sum} বনাম ব্যালেন্স ৳${Number(u.balance)}`,
    ).toBeCloseTo(sum, 2);
  }
  return users.length;
}

describe('খতিয়ান invariant', () => {
  it('একটি credit-এর পর যোগফল ও ব্যালেন্স মেলে', async () => {
    const u = await mkUser(1);
    await db.$transaction(async (tx) => {
      await creditWallet({ tx, userId: u.id, amount: 500, type: 'DEPOSIT', note: 'test' });
    });
    const after = await db.user.findUnique({ where: { id: u.id }, select: { balance: true } });
    expect(Number(after!.balance)).toBe(500);
    await assertInvariant();
  });

  it('debit ঋণাত্মক অঙ্ক লেখে, ব্যালেন্স কমে', async () => {
    const u = await mkUser(2, 1000);
    await db.$transaction(async (tx) => {
      await debitWallet({ tx, userId: u.id, amount: 250, type: 'ORDER', note: 'test' });
    });
    const rows = await db.ledgerEntry.findMany({ where: { userId: u.id } });
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].amount)).toBe(-250);
    // ★ ব্যালেন্স ১০০০ থেকে শুরু, কিন্তু খতিয়ানে কেবল −২৫০ আছে —
    //   তাই এখানে invariant প্রযোজ্য নয়; শুরুর ব্যালেন্স খতিয়ান-বহির্ভূত।
    const after = await db.user.findUnique({ where: { id: u.id }, select: { balance: true } });
    expect(Number(after!.balance)).toBe(750);
  });

  it('শূন্য ও ঋণাত্মক অঙ্ক প্রত্যাখ্যাত', async () => {
    const u = await mkUser(3, 100);
    await expect(
      db.$transaction((tx) => creditWallet({ tx, userId: u.id, amount: 0, type: 'DEPOSIT', note: 'zero' })),
    ).rejects.toThrow();
    await expect(
      db.$transaction((tx) => creditWallet({ tx, userId: u.id, amount: -5, type: 'DEPOSIT', note: 'neg' })),
    ).rejects.toThrow();
    expect(await db.ledgerEntry.count({ where: { userId: u.id } })).toBe(0);
  });

  it('★ ১০০টি এলোমেলো অপারেশনের পর প্রতিটি ইউজারে যোগফল = ব্যালেন্স', async () => {
    const users = await Promise.all([0, 1, 2, 3].map((i) => mkUser(10 + i, 0)));
    const rand = rng(20260808);
    let credits = 0, debits = 0, skipped = 0;

    for (let i = 0; i < 100; i++) {
      const u = users[Math.floor(rand() * users.length)];
      const amount = Math.round((rand() * 400 + 1) * 100) / 100;
      const isCredit = rand() < 0.55;

      if (isCredit) {
        await db.$transaction((tx) =>
          creditWallet({ tx, userId: u.id, amount, type: 'DEPOSIT', note: `r${i}` }));
        credits++;
      } else {
        // ★ ব্যালেন্সের বেশি কাটা যাবে না — অ্যাপেও লক-করা রো দেখে
        //   এই যাচাই হয়। এখানে সেটিই অনুকরণ করা হয়েছে।
        const cur = await db.user.findUnique({ where: { id: u.id }, select: { balance: true } });
        if (Number(cur!.balance) < amount) { skipped++; continue; }
        await db.$transaction((tx) =>
          debitWallet({ tx, userId: u.id, amount, type: 'ORDER', note: `r${i}` }));
        debits++;
      }
    }

    console.log(`    ${credits} credit · ${debits} debit · ${skipped} বাদ (অপর্যাপ্ত ব্যালেন্স)`);
    const n = await assertInvariant();
    expect(n).toBe(4);

    // কোনো ব্যালেন্স ঋণাত্মক হয়নি
    const all = await db.user.findMany({ select: { balance: true } });
    for (const u of all) expect(Number(u.balance)).toBeGreaterThanOrEqual(0);
  });

  it('★ প্রতিটি খতিয়ান সারির balanceAfter ক্রমসঙ্গত', async () => {
    const u = await mkUser(30, 0);
    for (const amt of [100, 50, 25]) {
      await db.$transaction((tx) =>
        creditWallet({ tx, userId: u.id, amount: amt, type: 'DEPOSIT', note: `+${amt}` }));
    }
    await db.$transaction((tx) =>
      debitWallet({ tx, userId: u.id, amount: 75, type: 'ORDER', note: '-75' }));

    const rows = await db.ledgerEntry.findMany({
      where: { userId: u.id }, orderBy: { createdAt: 'asc' },
    });
    let running = 0;
    for (const r of rows) {
      running = Math.round((running + Number(r.amount)) * 100) / 100;
      expect(Number(r.balanceAfter), `entry ${r.id}`).toBeCloseTo(running, 2);
    }
    const after = await db.user.findUnique({ where: { id: u.id }, select: { balance: true } });
    expect(Number(after!.balance)).toBeCloseTo(running, 2);
  });
});
