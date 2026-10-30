import { prisma } from '@/lib/prisma';
import { requireAdminPage } from '@/lib/pageGuard';
import { maskCode } from '@/lib/services/voucherCodes';
import CodeStockManager, { type StockRow, type RecentCode } from '@/components/admin/CodeStockManager';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'কোড স্টক' };

export default async function AdminCodes() {
  await requireAdminPage();

  const variants = await prisma.variant.findMany({
    where: { product: { deliveryType: 'CODE' } },
    orderBy: [{ product: { sortOrder: 'asc' } }, { sortOrder: 'asc' }],
    select: { id: true, label: true, product: { select: { name: true } } },
  });
  const ids = variants.map((v) => v.id);

  const [counts, waiting, recent] = await Promise.all([
    ids.length
      ? prisma.voucherCode.groupBy({ by: ['variantId', 'status'], where: { variantId: { in: ids } }, _count: { _all: true } })
      : Promise.resolve([]),
    ids.length
      ? prisma.order.groupBy({ by: ['variantId'], where: { variantId: { in: ids }, status: 'PENDING', claimedById: null }, _count: { _all: true } })
      : Promise.resolve([]),
    prisma.voucherCode.findMany({
      orderBy: { createdAt: 'desc' },
      take: 60,
      select: {
        id: true, code: true, status: true, batch: true, createdAt: true,
        order: { select: { orderNo: true } },
        variant: { select: { label: true, product: { select: { name: true } } } },
      },
    }),
  ]);

  const count = (vid: number, st: string) =>
    counts.find((c) => c.variantId === vid && c.status === st)?._count._all ?? 0;

  const rows: StockRow[] = variants.map((v) => ({
    variantId: v.id,
    productName: v.product.name,
    variantLabel: v.label,
    available: count(v.id, 'AVAILABLE'),
    assigned: count(v.id, 'ASSIGNED'),
    waiting: waiting.find((w) => w.variantId === v.id)?._count._all ?? 0,
  }));

  const recentRows: RecentCode[] = recent.map((c) => ({
    id: c.id,
    masked: maskCode(c.code),
    productName: c.variant.product.name,
    variantLabel: c.variant.label,
    status: c.status,
    orderNo: c.order?.orderNo ?? null,
    batch: c.batch,
    createdAt: c.createdAt.toISOString(),
  }));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="lux-text text-2xl font-medium sm:text-[27px]">কোড স্টক</h1>
        <p className="mt-1 text-sm text-slate-400">
          গিফট কার্ড, সাবস্ক্রিপশন ও ভাউচার কোড। স্টকে কোড থাকলে অর্ডার হওয়ামাত্র গ্রাহক &quot;আমার কোড&quot; পাতায় কোড পায়।
          ডেলিভার্ড কোড বাতিল বা বদলানো যায় না।
        </p>
      </div>
      <CodeStockManager rows={rows} recent={recentRows} />
    </div>
  );
}
