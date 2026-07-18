import { prisma } from '@/lib/prisma';
import UserTable from '@/components/admin/UserTable';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'ইউজার' };

export default async function AdminUsers({ searchParams }: { searchParams: { q?: string } }) {
  const q = searchParams.q?.trim().slice(0, 60);

  const users = await prisma.user.findMany({
    where: q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { email: { contains: q, mode: 'insensitive' } },
            { phone: { contains: q } },
            { referralCode: { contains: q.toUpperCase() } },
          ],
        }
      : {},
    orderBy: { createdAt: 'desc' },
    take: 100,
    // ★ শুধু প্রয়োজনীয় ফিল্ড — password hash কখনো DB ছেড়ে বের হয় না
    select: {
      id: true, name: true, email: true, phone: true, role: true,
      balance: true, isBanned: true, status: true, referralCode: true, createdAt: true,
      _count: { select: { orders: true, deposits: true, referrals: true } },
    },
  });

  return (
    <div className="space-y-5">
      <h1 className="lux-text text-2xl font-medium sm:text-[27px]">ইউজার ম্যানেজমেন্ট</h1>
      <UserTable
        q={q ?? ''}
        users={users.map((u: (typeof users)[number]) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          phone: u.phone,
          role: u.role,
          balance: Number(u.balance),
          isBanned: u.isBanned,
          status: u.status,
          referralCode: u.referralCode,
          createdAt: u.createdAt.toISOString(),
          orders: u._count.orders,
          deposits: u._count.deposits,
          referrals: u._count.referrals,
        }))}
      />
    </div>
  );
}
