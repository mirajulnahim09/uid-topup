import { prisma } from '@/lib/prisma';
import { bdt } from '@/lib/money';
import { fmtDate } from '@/lib/date';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'অ্যাডমিন লগ' };

const LABEL: Record<string, { text: string; cls: string }> = {
  DEPOSIT_APPROVE:  { text: '✓ টাকা যোগ',      cls: 'bg-emerald-100 text-emerald-700' },
  DEPOSIT_REJECT:   { text: '✕ ডিপোজিট বাতিল', cls: 'bg-red-100 text-red-700' },
  ORDER_COMPLETE:   { text: '✓ অর্ডার সম্পন্ন', cls: 'bg-emerald-100 text-emerald-700' },
  ORDER_REFUND:     { text: '↩ টাকা ফেরত',     cls: 'bg-purple-100 text-purple-700' },
  ORDER_PROCESSING: { text: '⏳ প্রসেসিং',      cls: 'bg-blue-100 text-blue-700' },
  BALANCE_ADJUST:   { text: '৳ ব্যালেন্স সমন্বয়', cls: 'bg-amber-100 text-amber-700' },
  USER_BAN:         { text: '⛔ ব্যান',          cls: 'bg-red-100 text-red-700' },
  USER_UNBAN:       { text: '↺ আনব্যান',        cls: 'bg-slate-100 text-slate-700' },
  PRICE_CHANGE:     { text: '🏷 দাম বদল',       cls: 'bg-blue-100 text-blue-700' },
};

export default async function AdminLogs({
  searchParams,
}: {
  searchParams: { action?: string };
}) {
  const action = searchParams.action;

  const logs = await prisma.adminLog.findMany({
    where: action && LABEL[action] ? { action } : {},
    orderBy: { createdAt: 'desc' },
    take: 200,
  });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="lux-text text-2xl font-medium sm:text-[27px]">অ্যাডমিন লগ</h1>
        <p className="mt-1.5 text-sm font-light text-slate-500">
          কে কখন কী করেছে — সব রেকর্ড এখানে। টাকা নিয়ে ঝামেলা হলে এখানে দেখুন।
        </p>
      </div>

      <div className="table-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th scope="col">কখন</th>
              <th scope="col">কে</th>
              <th scope="col">কী করল</th>
              <th scope="col" className="text-right">টাকা</th>
              <th scope="col">বিস্তারিত</th>
              <th scope="col">IP</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l: (typeof logs)[number]) => {
              const m = LABEL[l.action] ?? {
                text: l.action,
                cls: 'bg-slate-100 text-slate-600',
              };
              return (
                <tr key={l.id}>
                  <td className="whitespace-nowrap text-xs text-slate-500">
                    {fmtDate(l.createdAt)}
                  </td>
                  <td className="whitespace-nowrap text-sm font-semibold text-slate-900">
                    {l.adminName}
                  </td>
                  <td>
                    <span className={`badge whitespace-nowrap ${m.cls}`}>{m.text}</span>
                  </td>
                  <td className="whitespace-nowrap text-right font-bold text-slate-700">
                    {l.amount !== null ? bdt(l.amount) : '—'}
                  </td>
                  <td className="max-w-[280px] text-xs text-slate-600">{l.detail || '—'}</td>
                  <td className="whitespace-nowrap font-mono text-[11px] text-slate-400">
                    {l.ip || '—'}
                  </td>
                </tr>
              );
            })}

            {logs.length === 0 && (
              <tr>
                <td colSpan={6} className="py-14 text-center text-slate-400">
                  এখনো কোনো লগ নেই
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-slate-400">
        সর্বশেষ ২০০টি দেখাচ্ছে। লগ কখনো মুছে ফেলা যায় না।
      </p>
    </div>
  );
}
