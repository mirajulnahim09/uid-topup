import { prisma } from '@/lib/prisma';
import DepositTable from '@/components/admin/DepositTable';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'ডিপোজিট' };

const VALID = ['PENDING', 'APPROVED', 'REJECTED'] as const;
type S = (typeof VALID)[number];

export default async function AdminDeposits({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  const s = searchParams.status;
  const status = s && (VALID as readonly string[]).includes(s) ? (s as S) : undefined;

  const deposits = await prisma.deposit.findMany({
    where: status ? { status } : {},
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    take: 100,
    include: { user: { select: { name: true, phone: true, balance: true } } },
  });

  return (
    <div className="space-y-5">
      <h1 className="lux-text text-2xl font-medium sm:text-[27px]">ডিপোজিট রিকোয়েস্ট</h1>
      <DepositTable
        current={status ?? 'ALL'}
        deposits={deposits.map((d: (typeof deposits)[number]) => ({
          id: d.id,
          depositNo: d.depositNo,
          method: d.method,
          amount: Number(d.amount),
          trxId: d.trxId,
          senderNo: d.senderNo,
          screenshot: d.screenshot,
          status: d.status,
          adminNote: d.adminNote,
          createdAt: d.createdAt.toISOString(),
          user: {
            name: d.user.name,
            phone: d.user.phone,
            balance: Number(d.user.balance),
          },
        }))}
      />
    </div>
  );
}
