import Link from 'next/link';
import type { Metadata } from 'next';
import AdminPageHeader from '@/components/admin/AdminPageHeader';
import AdminTicketThread from '@/components/admin/AdminTicketThread';
import { fmtDate } from '@/lib/date';
import { listAdminTickets, getThread } from '@/lib/services/tickets';
import type { TicketStatus } from '@prisma/client';

export const metadata: Metadata = { title: 'সাপোর্ট টিকিট' };
export const dynamic = 'force-dynamic';

/**
 * ★ Group I (৪) — অ্যাডমিনের টিকিট সারি
 *
 *   ⚠️ একটিই পাতা, দুটি অবস্থা: `?id=` না থাকলে সারি, থাকলে থ্রেড।
 *   আলাদা রুট বানালে "ফিরে যান" ও ফিল্টার-অবস্থা ধরে রাখা জটিল হতো।
 *
 *   ⚠️ ডিফল্ট ফিল্টার নেই — `listAdminTickets` স্ট্যাটাস অনুসারে সাজায়
 *   (OPEN আগে), তাই কারও অপেক্ষা চোখ এড়ায় না।
 */
const STATUS_BN: Record<string, string> = {
  OPEN: 'খোলা',
  ANSWERED: 'উত্তর দেওয়া',
  CLOSED: 'বন্ধ',
};

const FILTERS: { key: string; label: string }[] = [
  { key: '', label: 'সব' },
  { key: 'OPEN', label: 'খোলা' },
  { key: 'ANSWERED', label: 'উত্তর দেওয়া' },
  { key: 'CLOSED', label: 'বন্ধ' },
];

export default async function AdminTicketsPage({
  searchParams,
}: {
  searchParams: { id?: string; status?: string };
}) {
  // ── থ্রেড ──
  if (searchParams.id) {
    const t = await getThread(searchParams.id, null);
    if (!t) {
      return (
        <div className="space-y-4">
          <AdminPageHeader title="সাপোর্ট টিকিট" subtitle="টিকিটটি পাওয়া যায়নি।" />
          <Link href="/admin/tickets" className="btn-ghost px-4 text-sm">← সারিতে ফিরুন</Link>
        </div>
      );
    }

    return (
      <div className="mx-auto max-w-3xl space-y-5">
        <Link href="/admin/tickets" className="text-sm font-semibold" style={{ color: 'var(--v-mut)' }}>
          ← সারিতে ফিরুন
        </Link>

        <div>
          <h1 className="lux-text text-xl font-medium sm:text-2xl">{t.subject}</h1>
          <p className="mt-1 text-xs" style={{ color: 'var(--v-mut)' }}>
            {t.kind === 'DISPUTE' ? '⚠ বিরোধ' : 'সাধারণ'}
            {` · ${t.user.name} (${t.user.email})`}
            {t.order ? (
              <>
                {' · '}
                {/* ★ রিফান্ড এখান থেকে নয় — অর্ডার পাতা থেকেই */}
                <Link href={`/admin/orders?q=${t.order.orderNo}`} className="underline">
                  অর্ডার #{t.order.orderNo} ({t.order.status})
                </Link>
              </>
            ) : null}
            {` · ${STATUS_BN[t.status]}`}
          </p>
        </div>

        <ul className="space-y-3">
          {t.messages.map((m) => (
            <li
              key={m.id}
              className="card p-4"
              style={m.isStaff ? { background: 'var(--v-steel)' } : undefined}
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
              <p className="mt-2 whitespace-pre-line text-sm leading-relaxed">{m.body}</p>
            </li>
          ))}
        </ul>

        <AdminTicketThread ticketId={t.id} closed={t.status === 'CLOSED'} />
      </div>
    );
  }

  // ── সারি ──
  const raw = searchParams.status;
  const status =
    raw === 'OPEN' || raw === 'ANSWERED' || raw === 'CLOSED' ? (raw as TicketStatus) : undefined;
  const tickets = await listAdminTickets(status);

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title="সাপোর্ট টিকিট"
        subtitle="গ্রাহকের অভিযোগ ও বিরোধ — পুরো কথোপকথন এখানে সংরক্ষিত। রিফান্ড আগের মতোই অর্ডার পাতা থেকে।"
      />

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={f.key ? `/admin/tickets?status=${f.key}` : '/admin/tickets'}
            className="btn-ghost px-3 py-1.5 text-xs"
            style={(raw ?? '') === f.key ? { borderColor: 'var(--accent-text)' } : undefined}
          >
            {f.label}
          </Link>
        ))}
      </div>

      {tickets.length === 0 ? (
        <div className="card p-8 text-center text-sm" style={{ color: 'var(--v-mut)' }}>
          কোনো টিকিট নেই।
        </div>
      ) : (
        <ul className="space-y-2">
          {tickets.map((t) => (
            <li key={t.id}>
              <Link
                href={`/admin/tickets?id=${t.id}`}
                className="card flex items-start justify-between gap-4 p-4 transition hover:-translate-y-0.5"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">
                    {t.kind === 'DISPUTE' ? '⚠ ' : ''}{t.subject}
                  </span>
                  <span className="mt-0.5 block truncate text-xs" style={{ color: 'var(--v-mut)' }}>
                    {t.user.name} · {t.user.email}
                    {t.order ? ` · #${t.order.orderNo}` : ''}
                    {` · ${t._count.messages}টি বার্তা · ${fmtDate(t.lastMessageAt)}`}
                  </span>
                </span>
                <span
                  className="shrink-0 rounded-full px-2.5 py-1 text-xs font-bold"
                  style={{
                    background: 'var(--v-steel)',
                    color: t.status === 'OPEN' ? 'var(--accent-text)' : 'var(--v-mut)',
                  }}
                >
                  {STATUS_BN[t.status]}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
