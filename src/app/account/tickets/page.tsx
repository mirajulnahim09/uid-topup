import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { requireUserPage } from '@/lib/pageGuard';
import { fmtDate } from '@/lib/date';
import { listUserTickets } from '@/lib/services/tickets';
import NewTicketForm from '@/components/tickets/NewTicketForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'সাপোর্ট টিকিট' };

/**
 * ★ Group I (৪) — গ্রাহকের টিকিট তালিকা
 *
 *   ⚠️ `?order=<id>` দিলে সরাসরি বিরোধের ফর্ম খোলে — অর্ডার পাতার
 *   "সমস্যা জানান" এখান থেকেই আসবে। আইডি যাচাই সার্ভিস-স্তরে হয়
 *   (অন্যের অর্ডার নীরবে বাদ), তাই এখানে আলাদা যাচাই লাগে না।
 */
const STATUS_BN: Record<string, string> = {
  OPEN: 'খোলা',
  ANSWERED: 'উত্তর এসেছে',
  CLOSED: 'বন্ধ',
};

export default async function TicketsPage(props: {
  searchParams: Promise<{ order?: string }>;
}) {
  const searchParams = await props.searchParams;
  // ★ SEC-01 — DB-যাচাই (ban + sessionEpoch), ব্যর্থ হলে লগইনে (আগে ফাঁকা পাতা)
  const me = await requireUserPage();

  const [tickets, orders] = await Promise.all([
    listUserTickets(me.id),
    // ★ বিরোধের ড্রপডাউনের জন্য — শুধু নিজের অর্ডার, সাম্প্রতিক ২০টি
    prisma.order.findMany({
      where: { userId: me.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, orderNo: true, productName: true },
    }),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="lux-text text-2xl font-medium sm:text-[27px]">সাপোর্ট টিকিট</h1>
        <NewTicketForm orders={orders} presetOrderId={searchParams.order} />
      </div>

      {tickets.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-base font-semibold">কোনো টিকিট নেই</p>
          <p className="mt-2 text-sm" style={{ color: 'var(--v-mut)' }}>
            অর্ডার বা পেমেন্ট নিয়ে সমস্যা হলে এখানে জানান — পুরো কথোপকথন
            সংরক্ষিত থাকবে।
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {tickets.map((t) => (
            <li key={t.id}>
              <Link
                href={`/account/tickets/${t.id}`}
                className="card flex items-start justify-between gap-4 p-4 transition hover:-translate-y-0.5"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{t.subject}</span>
                  <span className="mt-0.5 block text-xs" style={{ color: 'var(--v-mut)' }}>
                    {t.kind === 'DISPUTE' ? '⚠ বিরোধ' : 'সাধারণ'}
                    {t.order ? ` · অর্ডার #${t.order.orderNo}` : ''}
                    {` · ${t._count.messages}টি বার্তা`}
                    {` · ${fmtDate(t.lastMessageAt)}`}
                  </span>
                </span>
                <span
                  className="shrink-0 rounded-full px-2.5 py-1 text-xs font-bold"
                  style={{
                    background: 'var(--v-steel)',
                    color: t.status === 'CLOSED' ? 'var(--v-mut)' : 'var(--accent-text)',
                  }}
                >
                  {STATUS_BN[t.status] ?? t.status}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
