import { prisma } from '@/lib/prisma';
import { adminCouponSchema } from '@/lib/validation';
import { requireAdmin, apiError, ApiError } from '@/lib/guard';
import { adminLog } from '@/lib/adminLog';
import { getIp } from '@/lib/rateLimit';

/**
 * ★ কুপন — দামের উপর সরাসরি প্রভাব ফেলে, তাই অডিট লগ জরুরি (3.3)।
 *   ৯০% ছাড়ের কুপন বানিয়ে ফেললে সেটি টাকার ঘটনা — কে বানাল
 *   তা জানা না গেলে জবাবদিহি থাকে না (AUDIT_REPORT.md M2)।
 */
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();

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

    adminLog({
      adminId: admin.id,
      adminName: admin.name,
      action: 'COUPON_CREATE',
      targetId: String(c.id),
      amount: d.value,
      detail:
        `${d.code} — ${d.type === 'PERCENT' ? `${d.value}%` : `৳${d.value}`} ছাড়` +
        (d.minOrder ? `, সর্বনিম্ন ৳${d.minOrder}` : '') +
        (d.usageLimit ? `, সীমা ${d.usageLimit}` : ''),
      ip: getIp(req),
    }).catch(() => {});

    return Response.json({ success: true, id: c.id });
  } catch (e) {
    return apiError(e);
  }
}

export async function PATCH(req: Request) {
  try {
    const admin = await requireAdmin();
    const { id, isActive } = await req.json();
    if (!id) throw new ApiError('id প্রয়োজন', 400);

    const before = await prisma.coupon.findUnique({
      where: { id: Number(id) },
      select: { code: true },
    });

    await prisma.coupon.update({
      where: { id: Number(id) },
      data: { isActive: Boolean(isActive) },
    });

    adminLog({
      adminId: admin.id,
      adminName: admin.name,
      action: 'COUPON_UPDATE',
      targetId: String(id),
      detail: `${before?.code ?? `#${id}`} — ${isActive ? 'চালু' : 'বন্ধ'} করা হয়েছে`,
      ip: getIp(req),
    }).catch(() => {});

    return Response.json({ success: true });
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(req: Request) {
  try {
    const admin = await requireAdmin();
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

    const before = await prisma.coupon.findUnique({
      where: { id: Number(id) },
      select: { code: true },
    });

    await prisma.coupon.delete({ where: { id: Number(id) } });

    adminLog({
      adminId: admin.id,
      adminName: admin.name,
      action: 'COUPON_DELETE',
      targetId: String(id),
      detail: `${before?.code ?? `#${id}`} মুছে ফেলা হয়েছে`,
      ip: getIp(req),
    }).catch(() => {});

    return Response.json({ success: true });
  } catch (e) {
    return apiError(e);
  }
}
