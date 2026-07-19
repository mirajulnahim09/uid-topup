import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import AdminNav from '@/components/admin/AdminNav';
import AdminSearch from '@/components/admin/AdminSearch';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // ★ middleware এ প্রথম guard আছে — এটা দ্বিতীয় স্তর (defense in depth)
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login?callbackUrl=/admin');
  if (session.user.role !== 'ADMIN') redirect('/');

  // ★ DB থেকেও role re-verify — পুরনো JWT ধরবে
  const me = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true, isBanned: true },
  });
  if (!me || me.role !== 'ADMIN' || me.isBanned) redirect('/');

  const [pendingDeposits, pendingOrders] = await Promise.all([
    prisma.deposit.count({ where: { status: 'PENDING' } }),
    prisma.order.count({ where: { status: { in: ['PENDING', 'PROCESSING'] } } }),
  ]);

  return (
    <div className="min-h-screen">
      <header className="border-b border-purple-200 bg-purple-50 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3.5">
          <div className="flex items-center gap-3">
            <span className="rounded-md bg-purple-600 px-2 py-1 text-xs font-bold text-white">ADMIN</span>
            <span className="hidden font-bold text-slate-900 sm:inline">কন্ট্রোল প্যানেল</span>
          </div>
          <Link href="/" className="whitespace-nowrap text-sm text-slate-400 transition hover:text-slate-900">
            ← সাইটে ফিরুন
          </Link>
        </div>
      </header>

      <AdminNav pendingDeposits={pendingDeposits} pendingOrders={pendingOrders} />

      {/* ★ সর্বজনীন সার্চ — প্রতিটি অ্যাডমিন পেজে (3.2)।
          গ্রাহকের মেসেজ থেকে যা-ই পেস্ট হোক, উত্তর এখানেই মেলে। */}
      <div className="mx-auto max-w-7xl page-x pt-5">
        <AdminSearch />
      </div>

      <main id="main" className="mx-auto max-w-7xl page-x py-6 sm:py-5">{children}</main>
    </div>
  );
}
