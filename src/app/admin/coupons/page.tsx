import { prisma } from '@/lib/prisma';
import CouponManager from '@/components/admin/CouponManager';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'কুপন' };

export default async function AdminCoupons() {
  const coupons = await prisma.coupon.findMany({
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { uses: true } } },
  });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">কুপন ও ডিসকাউন্ট</h1>
        <p className="mt-1 text-sm text-slate-400">
          ব্যবহৃত কুপন ডিলিট করা যায় না — শুধু বন্ধ করা যায় (অর্ডারের ইতিহাস রক্ষার জন্য)।
        </p>
      </div>

      <CouponManager
        coupons={coupons.map((c: (typeof coupons)[number]) => ({
          id: c.id,
          code: c.code,
          type: c.type,
          value: Number(c.value),
          minOrder: Number(c.minOrder),
          maxDiscount: c.maxDiscount ? Number(c.maxDiscount) : null,
          usageLimit: c.usageLimit,
          usageCount: c.usageCount,
          perUserLimit: c.perUserLimit,
          expiresAt: c.expiresAt?.toISOString() ?? null,
          isActive: c.isActive,
          uses: c._count.uses,
        }))}
      />
    </div>
  );
}
