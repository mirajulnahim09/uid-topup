import { prisma } from '@/lib/prisma';
import OrderTable from '@/components/admin/OrderTable';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'অর্ডার' };

const VALID = ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'REFUNDED'] as const;
type S = (typeof VALID)[number];

export default async function AdminOrders({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  const s = searchParams.status;
  const status = s && (VALID as readonly string[]).includes(s) ? (s as S) : undefined;

  const orders = await prisma.order.findMany({
    where: status ? { status } : {},
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    take: 100,
    include: { user: { select: { name: true, phone: true } } },
  });

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-slate-900">অর্ডার ম্যানেজমেন্ট</h1>
      <OrderTable
        current={status ?? 'ALL'}
        orders={orders.map((o: (typeof orders)[number]) => ({
          id: o.id,
          orderNo: o.orderNo,
          productName: o.productName,
          variantName: o.variantName,
          playerUid: o.playerUid,
          playerName: o.playerName,
          discount: Number(o.discount),
          price: Number(o.price),
          status: o.status,
          adminNote: o.adminNote,
          internalNote: o.internalNote,
          createdAt: o.createdAt.toISOString(),
          user: o.user,
        }))}
      />
    </div>
  );
}
