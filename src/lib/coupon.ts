import type { Prisma, PrismaClient } from '@prisma/client';
import { ApiError } from './guard';

type Tx = Prisma.TransactionClient | PrismaClient;

export type CouponResult = {
  couponId: number;
  code: string;
  discount: number;
  label: string;
};

/**
 * ★ কুপন যাচাই + ডিসকাউন্ট হিসাব।
 *   অর্ডারের transaction এর ভেতর থেকে ডাকতে হবে —
 *   নাহলে দুইজন একসাথে শেষ কুপনটা ব্যবহার করে ফেলতে পারে।
 */
export async function validateCoupon(
  tx: Tx,
  code: string,
  userId: string,
  subtotal: number
): Promise<CouponResult> {
  const clean = code.trim().toUpperCase();
  const coupon = await tx.coupon.findUnique({ where: { code: clean } });

  if (!coupon || !coupon.isActive) throw new ApiError('কুপন কোডটি সঠিক নয়', 400);

  const now = new Date();
  if (coupon.startsAt > now) throw new ApiError('এই কুপন এখনো চালু হয়নি', 400);
  if (coupon.expiresAt && coupon.expiresAt < now) {
    throw new ApiError('কুপনের মেয়াদ শেষ হয়ে গেছে', 400);
  }

  if (coupon.usageLimit !== null && coupon.usageCount >= coupon.usageLimit) {
    throw new ApiError('কুপনটির ব্যবহার সীমা শেষ', 400);
  }

  const myUses = await tx.couponUse.count({ where: { couponId: coupon.id, userId } });
  if (myUses >= coupon.perUserLimit) {
    throw new ApiError(
      coupon.perUserLimit === 1
        ? 'আপনি এই কুপন আগেই ব্যবহার করেছেন'
        : `আপনি এই কুপন সর্বোচ্চ ${coupon.perUserLimit} বার ব্যবহার করতে পারবেন`,
      400
    );
  }

  const minOrder = Number(coupon.minOrder);
  if (subtotal < minOrder) {
    throw new ApiError(`এই কুপন ব্যবহারে সর্বনিম্ন অর্ডার ৳${minOrder.toFixed(2)}`, 400);
  }

  let discount: number;
  let label: string;

  if (coupon.type === 'PERCENT') {
    const pct = Number(coupon.value);
    discount = (subtotal * pct) / 100;
    const cap = coupon.maxDiscount ? Number(coupon.maxDiscount) : null;
    if (cap !== null && discount > cap) discount = cap;
    label = `${pct}% ছাড়${cap ? ` (সর্বোচ্চ ৳${cap})` : ''}`;
  } else {
    discount = Number(coupon.value);
    label = `৳${discount.toFixed(2)} ছাড়`;
  }

  // ★ ডিসকাউন্ট কখনো subtotal ছাড়াবে না — নাহলে negative price
  discount = Math.min(discount, subtotal);
  discount = Math.round((discount + Number.EPSILON) * 100) / 100;

  if (discount <= 0) throw new ApiError('এই অর্ডারে কুপনটি প্রযোজ্য নয়', 400);

  // ★★★ ছাড় পুরো দামের সমান — এই সিস্টেমে ৳০-এর অর্ডার বসতে পারে না
  //   (`debitWallet` শূন্য অঙ্ক প্রত্যাখ্যান করে; খতিয়ানের নিয়ম)।
  //   মাপা (EXTREME অডিট, ২০২৬-০৯-২১): ৳১০-এর প্যাকেজে ৳৫০-ছাড়ের কুপন —
  //   প্রিভিউ দেখাত "দিতে হবে ৳0.00", আর অর্ডারে গ্রাহক পেতেন ভেতরের বার্তা
  //   "অঙ্ক শূন্যের বেশি হতে হবে"। ফল আগের মতোই (অর্ডার হয় না, টাকা কাটে না),
  //   কেবল এখন প্রিভিউ ও অর্ডার একই, বোধগম্য কথা বলে।
  //   ⚠️ ফ্রি/পুরো-ছাড়ের অর্ডার চালু করা একটি ব্যবসায়িক সিদ্ধান্ত — এখানে নয়।
  if (discount >= subtotal) {
    throw new ApiError('এই কুপনের ছাড় প্যাকেজের দামের সমান — এই প্যাকেজে কুপনটি ব্যবহার করা যাবে না', 400);
  }

  return { couponId: coupon.id, code: clean, discount, label };
}

export async function consumeCoupon(
  tx: Prisma.TransactionClient,
  couponId: number,
  userId: string,
  orderId: string,
  discount: number
) {
  await tx.coupon.update({
    where: { id: couponId },
    data: { usageCount: { increment: 1 } },
  });
  await tx.couponUse.create({ data: { couponId, userId, orderId, discount } });
}
