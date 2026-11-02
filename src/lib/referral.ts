import { creditWallet } from './services/wallet';
import type { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { getSetting } from './settings';
import { emailReferralBonus } from './email';
import { notify } from './notify';

// I, O, 0, 1 বাদ — পড়তে ভুল হয় না
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function makeCode(len = 8): string {
  let s = '';
  for (let i = 0; i < len; i++) s += CHARS[Math.floor(Math.random() * CHARS.length)];
  return s;
}

export async function uniqueReferralCode(): Promise<string> {
  for (let i = 0; i < 12; i++) {
    const code = makeCode();
    const exists = await prisma.user.findUnique({
      where: { referralCode: code },
      select: { id: true },
    });
    if (!exists) return code;
  }
  return makeCode(12); // অত্যন্ত অসম্ভব fallback
}

/**
 * ★ রেফারেল বোনাস — প্রথম যোগ্য ডিপোজিট APPROVE হলে।
 *   `referralBonusPaid` flag দিয়ে double-payout impossible.
 */
export async function payReferralBonus(
  tx: Prisma.TransactionClient,
  userId: string,
  depositAmount: number
): Promise<{ referrerId: string; bonus: number } | null> {
  // ★ L6 — রেফার্ড ইউজারের রো explicit lock। double-payout ঠেকানো পুরোটাই
  //   `referralBonusPaid` flag এর উপর নির্ভর করে, তাই flag পড়া→লেখা একই রো
  //   লকের ভেতরে হওয়া চাই। আগে এটি নির্ভর করত creditWallet এর implicit
  //   UPDATE-lock এর উপর (§8 এর "সুস্পষ্ট FOR UPDATE" রীতির নিঃশব্দ ব্যতিক্রম);
  //   এখন সুস্পষ্ট — Variant/User/Coupon এর মতোই। রো ইতিমধ্যে লক থাকলেও
  //   পুনরায় লক নিরাপদ, আর lock-ক্রম অপরিবর্তিত (depositor → referrer)।
  // ★ O-14 — `FOR NO KEY UPDATE`, `FOR UPDATE` নয়। দুটি NO KEY UPDATE
  //   পরস্পরকে আটকায়, তাই flag পড়া→লেখা আগের মতোই সিরিয়াল; কিন্তু এটি
  //   সমান্তরাল FK-ইনসার্টের (Notification/Order/LedgerEntry → User)
  //   `FOR KEY SHARE`-এর সাথে সংঘাত করে না — FOR UPDATE করত, আর তাতে
  //   deposit APPROVE বনাম notification-ইনসার্টে deadlock হতো।
  //   flag-আপডেট নিজেও non-key কলাম, তাই এর চেয়ে শক্ত লক লাগে না।
  //   টেস্ট: tests/referral-lock-o14.test.ts
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR NO KEY UPDATE`;

  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, referredById: true, referralBonusPaid: true },
  });

  if (!user) return null;
  if (!user.referredById) return null;
  if (user.referralBonusPaid) return null; // ★ আগেই দেওয়া হয়েছে

  const bonus = Number(await getSetting('referral_bonus', '20'));
  const minDep = Number(await getSetting('referral_min_deposit', '100'));

  if (bonus <= 0) return null;

  // ডিপোজিট ছোট হলে বোনাস নেই — কিন্তু flag সেট করব না (পরের বড় ডিপোজিটে পাবে)
  if (depositAmount < minDep) return null;

  const referrer = await tx.user.findUnique({
    where: { id: user.referredById },
    select: { id: true, isBanned: true },
  });
  if (!referrer || referrer.isBanned) return null;

  // ★ Flag আগে সেট — double-payout impossible
  await tx.user.update({ where: { id: userId }, data: { referralBonusPaid: true } });

  // ★ ব্যালেন্স + খতিয়ান একসাথে (4.1)
  await creditWallet({
    tx,
    userId: referrer.id,
    amount: bonus,
    type: 'REFERRAL_BONUS',
    refId: userId,
    note: `রেফারেল বোনাস — ${user.name} এর প্রথম ডিপোজিট`,
  });

  return { referrerId: referrer.id, bonus };
}

/** transaction এর বাইরে — email + in-app notification */
export async function notifyReferralBonus(
  referrerId: string,
  friendName: string,
  bonus: number
) {
  const r = await prisma.user.findUnique({
    where: { id: referrerId },
    select: { email: true, name: true, balance: true },
  });
  if (!r) return;

  await notify(
    referrerId,
    'রেফারেল বোনাস পেয়েছেন! 🎁',
    `${friendName} আপনার কোড ব্যবহার করেছে। ৳${bonus.toFixed(2)} বোনাস যোগ হয়েছে।`,
    '/account'
  );

  await emailReferralBonus(
    r.email, r.name, friendName,
    bonus.toFixed(2), Number(r.balance).toFixed(2)
  );
}
