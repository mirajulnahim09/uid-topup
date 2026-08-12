import type { Prisma } from '@prisma/client';
import { ApiError } from '../guard';

/**
 * ★★★ ওয়ালেট সার্ভিস (4.1) — টাকার একমাত্র প্রবেশপথ
 *
 *   ── কেন এটি বানানো হলো ──
 *   `CLAUDE.md` §8 এর নিয়ম: **প্রতিটি** ব্যালেন্স পরিবর্তনের সাথে
 *   একই transaction-এ একটি `LedgerEntry` লিখতে হবে, `balanceAfter`
 *   সহ। নিয়মটি ঠিক ছিল, কিন্তু ৭টি আলাদা জায়গায় হাতে লেখা হতো —
 *   অর্থাৎ নিয়মটি **মনে রাখার** উপর নির্ভরশীল ছিল। অষ্টম জায়গায়
 *   কেউ লেজার লিখতে ভুলে গেলে কোনো কিছুই সেটা ধরত না, আর খতিয়ান
 *   নীরবে ভুল হয়ে যেত।
 *
 *   এখন নিয়মটি **কাঠামোগত**: ব্যালেন্স বদলানোর একমাত্র উপায়
 *   এই ফাংশনগুলো, আর এগুলো লেজার না লিখে ফিরতেই পারে না।
 *
 *   ── যা ইচ্ছাকৃতভাবে এখানে **নেই** ──
 *   • **নিজস্ব transaction খোলে না।** `tx` বাইরে থেকে নিতে হয়,
 *     কারণ টাকার কাজ কখনো একা ঘটে না — অর্ডার তৈরি, স্টক, কুপন
 *     সবকিছু এক অবিভাজ্য ধাপে থাকতে হবে। এখানে transaction খুললে
 *     nested transaction হতো, আর আংশিক কমিটের পথ খুলে যেত।
 *   • **row lock নেয় না।** লক নিতে হয় *সিদ্ধান্তের আগে* (ব্যালেন্স
 *     যথেষ্ট কি না যাচাই করার আগে), যা কলারের প্রেক্ষাপট। এখানে
 *     লক নিলে সেটা দেরিতে হতো — যাচাই আর লেখার মাঝে ফাঁক থেকে যেত।
 *     কলারই `SELECT ... FOR UPDATE` করে, আগের মতোই।
 */

export type LedgerType =
  | 'DEPOSIT'
  | 'ORDER'
  | 'REFUND'
  | 'ADMIN_ADJUST'
  | 'REFERRAL_BONUS'
  /** ★ Group I (৫) — অনুরোধের সময় কাটা */
  | 'WITHDRAWAL'
  /** ★ প্রত্যাখ্যানে ফেরত — মূল সারি কখনো সম্পাদনা নয় */
  | 'WITHDRAWAL_REVERSAL';

type MoveArgs = {
  tx: Prisma.TransactionClient;
  userId: string;
  /** সবসময় ধনাত্মক — দিক ঠিক করে credit/debit, চিহ্ন নয় */
  amount: number | Prisma.Decimal;
  type: LedgerType;
  refId?: string;
  note: string;
};

function assertPositive(amount: number): void {
  if (!Number.isFinite(amount) || amount <= 0) {
    // ★ ঋণাত্মক অঙ্ক দিয়ে credit ডাকলে সেটি গোপনে debit হয়ে যেত —
    //   তাই দিক শুধু ফাংশনের নাম থেকেই আসে, অঙ্কের চিহ্ন থেকে নয়
    throw new ApiError('অঙ্ক শূন্যের বেশি হতে হবে', 400);
  }
}

/**
 * ব্যালেন্স বাড়ায় + লেজার লেখে (এক ধাপে, ভাগ করা যায় না)।
 * ব্যবহার: ডিপোজিট অনুমোদন, রিফান্ড, রেফারেল বোনাস, ধনাত্মক সমন্বয়।
 */
export async function creditWallet(args: MoveArgs): Promise<Prisma.Decimal> {
  const amt = Number(args.amount);
  assertPositive(amt);

  const updated = await args.tx.user.update({
    where: { id: args.userId },
    data: { balance: { increment: args.amount } },
    select: { balance: true },
  });

  await args.tx.ledgerEntry.create({
    data: {
      userId: args.userId,
      type: args.type,
      amount: args.amount,
      // ★ ডাটাবেস থেকে ফেরত আসা আসল মান — হাতে হিসাব করা নয়।
      //   হাতে হিসাব করলে সমান্তরাল লেনদেনে খতিয়ান বাস্তবতা থেকে সরে যেত।
      balanceAfter: updated.balance,
      refId: args.refId,
      note: args.note,
    },
  });

  return updated.balance;
}

/**
 * ব্যালেন্স কমায় + লেজার লেখে।
 *
 * ⚠️ লেজারে অঙ্ক **ঋণাত্মক** হিসেবে যায় (`-amount`) — আগের কোডের
 *    সাথে হুবহু মিল রাখতে, কারণ পুরনো সব `ORDER` এন্ট্রি ঋণাত্মক।
 *    এটি বদলালে ঐতিহাসিক খতিয়ানের যোগফল ভুল হয়ে যেত।
 *
 * ⚠️ যথেষ্ট ব্যালেন্স আছে কি না — সেই যাচাই **কলারের দায়িত্ব**,
 *    লক করা রো দেখে। এখানে যাচাই করলে সেটা লকের বাইরে হতো।
 */
export async function debitWallet(args: MoveArgs): Promise<Prisma.Decimal> {
  const amt = Number(args.amount);
  assertPositive(amt);

  const updated = await args.tx.user.update({
    where: { id: args.userId },
    data: { balance: { decrement: args.amount } },
    select: { balance: true },
  });

  await args.tx.ledgerEntry.create({
    data: {
      userId: args.userId,
      type: args.type,
      amount: -amt,
      balanceAfter: updated.balance,
      refId: args.refId,
      note: args.note,
    },
  });

  return updated.balance;
}
