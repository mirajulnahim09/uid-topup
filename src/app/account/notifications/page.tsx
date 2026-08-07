import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { fmtDate } from '@/lib/date';
import Icon from '@/components/fx/Icon';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'নোটিফিকেশন' };

export default async function NotificationsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return null;

  const items = await prisma.notification.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  // দেখার সাথে সাথেই পড়া হিসেবে চিহ্নিত
  await prisma.notification.updateMany({
    where: { userId: session.user.id, isRead: false },
    data: { isRead: true },
  });

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <h1 className="lux-text text-2xl font-medium sm:text-[27px]">নোটিফিকেশন</h1>
        <p className="mt-1.5 text-sm font-light text-slate-500">সব খবর এক জায়গায়।</p>
      </div>

      {items.length === 0 ? (
        <div className="card py-16 text-center">
          <span className="mx-auto grid h-14 w-14 place-items-center" style={{ border: '1px solid var(--v-edge)', color: 'var(--v-ice)' }}><Icon name="bell" size={26} /></span>
          <p className="mt-3 font-semibold text-slate-500">কোনো নোটিফিকেশন নেই</p>
          <Link href="/" className="btn-primary mt-5">টপ আপ করুন</Link>
        </div>
      ) : (
        <div className="space-y-2.5">
          {items.map((n: (typeof items)[number]) => {
            const body = (
              <>
                <div className="flex items-start justify-between gap-3">
                  <p className="font-bold text-slate-900">{n.title}</p>
                  {!n.isRead && (
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[color:var(--violet)]" />
                  )}
                </div>
                <p className="mt-0.5 text-sm leading-relaxed text-slate-600">{n.body}</p>
                <p className="mt-1.5 text-xs text-slate-400">{fmtDate(n.createdAt)}</p>
              </>
            );

            return n.link ? (
              <Link
                key={n.id}
                href={n.link}
                className={`card block p-4 transition hover:-translate-y-0.5 hover:shadow-md ${
                  !n.isRead ? 'border-l-4 border-l-rose-500' : ''
                }`}
              >
                {body}
              </Link>
            ) : (
              <div
                key={n.id}
                className={`card p-4 ${!n.isRead ? 'border-l-4 border-l-rose-500' : ''}`}
              >
                {body}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
