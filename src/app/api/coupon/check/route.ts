import { prisma } from '@/lib/prisma';
import { couponCheckSchema } from '@/lib/validation';
import { requireUser, apiError, ApiError, readJson } from '@/lib/guard';
import { rateLimit, LIMITS } from '@/lib/rateLimit';
import { validateCoupon } from '@/lib/coupon';
import { round2 } from '@/lib/money';

export async function POST(req: Request) {
  try {
    const user = await requireUser();

    // ★ কুপন কোড brute-force আটকানো
    const rl = await rateLimit(`cpn:${user.id}`, LIMITS.coupon.limit, LIMITS.coupon.window);
    if (!rl.ok) throw new ApiError(`অনেক বেশি চেষ্টা। ${rl.retryAfter} সেকেন্ড পর দেখুন।`, 429);

    const parsed = couponCheckSchema.safeParse(await readJson(req));
    if (!parsed.success) throw new ApiError(parsed.error.errors[0].message, 400);

    const { code, variantId } = parsed.data;

    const v = await prisma.variant.findUnique({
      where: { id: variantId },
      select: { price: true, isActive: true },
    });
    if (!v || !v.isActive) throw new ApiError('প্যাকেজটি পাওয়া যায়নি', 400);

    const subtotal = round2(Number(v.price));

    // ⚠️ এটা শুধু PREVIEW — আসল যাচাই অর্ডারের transaction এ আবার হবে
    const c = await validateCoupon(prisma, code, user.id, subtotal);

    return Response.json({
      success: true,
      code: c.code,
      label: c.label,
      discount: c.discount.toFixed(2),
      subtotal: subtotal.toFixed(2),
      finalPrice: round2(subtotal - c.discount).toFixed(2),
    });
  } catch (e) {
    return apiError(e);
  }
}
