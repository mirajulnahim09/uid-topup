import type { Prisma } from '@prisma/client';
import { ApiError } from './guard';

/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ F4 — গ্রাহক-প্রতি ঝুলন্ত ডিপোজিটের সীমা, লকসহ
 *
 *   আগে `/api/deposit` ও `/api/order/direct` দুটোই লক ছাড়া গুনত, তারপর তৈরি
 *   করত। মাপা (tests/direct-pay-expiry-deposit-cap): ১০টি সমান্তরাল অনুরোধে
 *   ৯টি ও ১০টি PENDING বসেছিল — সীমা ৫। ডাইরেক্ট-পে-তে প্রতিটি অতিরিক্ত দাবি
 *   একটি স্টকও আটকে রাখত।
 *
 *   ── কেন advisory lock, row lock নয় ──
 *   গোনা হচ্ছে এমন সারি যা **এখনো নেই** (নতুন ডিপোজিট) — `FOR UPDATE` নেই এমন
 *   সারি লক করতে পারে না। User রো লক করা যেত, কিন্তু তাতে একই গ্রাহকের
 *   অর্ডার/প্রত্যাহারও অকারণে এই পথের পিছনে সারিতে দাঁড়াত। গ্রাহক-প্রতি একটি
 *   আলাদা advisory চাবি কেবল ডিপোজিট-তৈরিকেই ক্রমিক করে।
 *
 *   ⚠️ `pg_advisory_xact_lock` — transaction শেষে নিজে ছাড়ে, তাই Neon/PgBouncer-এর
 *   transaction-pooling-এও নিরাপদ (session-lock হলে অন্য ক্লায়েন্টে লেগে থাকত)।
 *   ⚠️ **transaction-এর প্রথম লক** হতে হবে (boundLockWait-এর ঠিক পরে) — ডাইরেক্ট-পে
 *   এরপর Variant/Coupon লক করে; এই চাবি আর কোনো পথ নেয় না, তাই চক্র অসম্ভব।
 * ═══════════════════════════════════════════════════════════
 */
export const MAX_PENDING_DEPOSITS = 5;

/**
 * ★ কেবল লক — গ্রাহক-প্রতি ডিপোজিট-তৈরি ক্রমিক করে।
 *   আলাদা করা হলো কারণ `/api/deposit` লকের **পরে** ও সীমা-পরীক্ষার **আগে** একই
 *   TrxID-এর পুনরাবৃত্তি (replay) দেখে: লকের আগে দেখলে একই গ্রাহকের দুটি সমান্তরাল
 *   অভিন্ন অনুরোধের দ্বিতীয়টি P2002 → ৪০৯ পেত, replay নয়; সীমার পরে দেখলে ৫টি
 *   ঝুলন্ত থাকা গ্রাহকের নিজের পুনরাবৃত্তি ৪২৯ পেত।
 */
export async function lockDepositSlot(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  // ★ `void` কলাম Prisma পড়তে পারে না, তাই `SELECT 1 … FROM` আকারে
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${`deposit-slot:${userId}`}))`;
}

/** ★ সীমা-পরীক্ষা — **অবশ্যই** `lockDepositSlot`-এর পরে, একই transaction-এ */
export async function assertDepositCap(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  const pending = await tx.deposit.count({ where: { userId, status: 'PENDING' } });
  if (pending >= MAX_PENDING_DEPOSITS) {
    throw new ApiError(
      `আপনার ${MAX_PENDING_DEPOSITS}টি রিকোয়েস্ট পেন্ডিং আছে। অনুমোদনের অপেক্ষা করুন।`,
      429,
    );
  }
}

/** ★ লক + সীমা একসাথে — `/api/order/direct` এটিই ব্যবহার করে (আচরণ অপরিবর্তিত) */
export async function claimDepositSlot(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await lockDepositSlot(tx, userId);
  await assertDepositCap(tx, userId);
}
