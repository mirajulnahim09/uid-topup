import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { fmtDate } from '@/lib/date';
import { getThread } from '@/lib/services/tickets';
import TicketReply from '@/components/tickets/TicketReply';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'টিকিট',
  // ★ থ্রেডে ব্যক্তিগত অভিযোগ ও অর্ডার তথ্য — সার্চ ইঞ্জিনে কখনো নয়
  robots: { index: false, follow: false },
};

/**
 * ★ Group I (৪) — একটি থ্রেড
 *
 *   ⚠️ মালিকানা যাচাই `getThread(id, userId)` করে — অন্যের থ্রেড
 *   চাইলে `null` ফেরে ও ৪০৪। "নেই" আর "আপনার নয়" আলাদা করা হয় না।
 */
export default async function TicketThreadPage({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return null;

  const t = await getThread(params.id, session.user.id);
  if (!t) notFound();

  const closed = t.status === 'CLOSED';

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link
        href="/account/tickets"
        className="inline-flex items-center gap-1.5 text-sm font-semibold"
        style={{ color: 'var(--v-mut)' }}
      >
        ← সব টিকিট
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="lux-text text-xl font-medium sm:text-2xl">{t.subject}</h1>
          <p className="mt-1 text-xs" style={{ color: 'var(--v-mut)' }}>
            {t.kind === 'DISPUTE' ? '⚠ বিরোধ' : 'সাধারণ'}
            {t.order ? (
              <>
                {' · '}
                <Link href={`/account/orders/${t.order.id}`} className="underline">
                  অর্ডার #{t.order.orderNo}
                </Link>
              </>
            ) : null}
            {` · ${fmtDate(t.createdAt)}`}
          </p>
        </div>
      </div>

      {/* ── থ্রেড ── */}
      <ul className="space-y-3">
        {t.messages.map((m) => (
          <li
            key={m.id}
            className="card p-4"
            style={
              m.isStaff
                ? { borderColor: 'var(--v-edge2)', background: 'var(--v-steel)' }
                : undefined
            }
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-xs font-bold">
                {m.authorName}
                {m.isStaff && (
                  <span className="ml-1.5 font-normal" style={{ color: 'var(--accent-text)' }}>
                    · সাপোর্ট
                  </span>
                )}
              </span>
              <span className="text-xs" style={{ color: 'var(--v-mut)' }}>
                {fmtDate(m.createdAt)}
              </span>
            </div>
            {/* ★ `whitespace-pre-line` — গ্রাহকের লাইনভাঙা অক্ষত থাকে */}
            <p className="mt-2 whitespace-pre-line text-sm leading-relaxed">{m.body}</p>
          </li>
        ))}
      </ul>

      <TicketReply ticketId={t.id} closed={closed} />
    </div>
  );
}
