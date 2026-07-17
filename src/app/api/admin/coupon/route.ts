import { prisma } from '@/lib/prisma';
import { adminCouponSchema } from '@/lib/validation';
import { requireAdmin, apiError, ApiError } from '@/lib/guard';

export async function POST(req: Request) {
  try {
    await requireAdmin();

    const parsed = adminCouponSchema.safeParse(await req.json());
    if (!parsed.success) throw new ApiError(parsed.error.errors[0].message, 400);

    const d = parsed.data;

    if (d.type === 'PERCENT' && d.value > 100) {
      throw new ApiError('শতকরা ছাড় ১০০% এর বেশি হতে পারে না', 400);
    }

    const exists = await prisma.coupon.findUnique({
      where: { code: d.code },
      select: { id: true },
    });
    if (exists) throw new ApiError('এই কোড আগে থেকেই আছে', 409);

    const c = await prisma.coupon.create({
      data: {
        code: d.code,
        type: d.type,
        value: d.value,
        minOrder: d.minOrder,
        maxDiscount: d.type === 'PERCENT' ? d.maxDiscount ?? null : null,
        usageLimit: d.usageLimit ?? null,
        perUserLimit: d.perUserLimit,
        expiresAt: d.expiresAt ? new Date(d.expiresAt) : null,
        isActive: d.isActive,
      },
    });

    return Response.json({ success: true, id: c.id });
  } catch (e) {
    return apiError(e);
  }
}

export async function PATCH(req: Request) {
  try {
    await requireAdmin();
    const { id, isActive } = await req.json();
    if (!id) throw new ApiError('id প্রয়োজন', 400);

    await prisma.coupon.update({
      where: { id: Number(id) },
      data: { isActive: Boolean(isActive) },
    });
    return Response.json({ success: true });
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(req: Request) {
  try {
    await requireAdmin();
    const { id } = await req.json();
    if (!id) throw new ApiError('id প্রয়োজন', 400);

    // ★ ব্যবহৃত কুপন ডিলিট করলে অর্ডারের ইতিহাস নষ্ট হবে
    const used = await prisma.couponUse.count({ where: { couponId: Number(id) } });
    if (used > 0) {
      throw new ApiError(
        `এই কুপন ${used} বার ব্যবহার হয়েছে — ডিলিট করা যাবে না। বন্ধ করে দিন।`,
        400
      );
    }

    await prisma.coupon.delete({ where: { id: Number(id) } });
    return Response.json({ success: true });
  } catch (e) {
    return apiError(e);
  }
}
