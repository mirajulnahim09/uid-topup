import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getSettings } from '@/lib/settings';
import { bdt } from '@/lib/money';
import { fmtDate } from '@/lib/date';
import Badge from '@/components/Badge';
import DepositForm from '@/components/DepositForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Add Money' };

export default async function DepositPage() {
  const session = await getServerSession(authOptions);
  if (!session) return null;

  const [channels, deposits, settings, user] = await Promise.all([
    prisma.paymentChannel.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    }),
    prisma.deposit.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    getSettings(),
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { balance: true },
    }),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900">Add Money</h1>
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2">
          <span className="text-xs text-emerald-700/70">বর্তমান ব্যালেন্স </span>
          <span className="font-bold text-emerald-700">{bdt(user?.balance ?? 0)}</span>
        </div>
      </div>

      {/* ★ পেন্ডিং রিকোয়েস্ট থাকলে উপরেই দেখাও */}
      {deposits.some((d: (typeof deposits)[number]) => d.status === 'PENDING') && (
        <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-4">
          <p className="flex items-center gap-2 text-sm font-bold text-amber-900">
            <span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" aria-hidden="true" />
            আপনার রিকোয়েস্ট যাচাই করা হচ্ছে
          </p>
          <p className="mt-1 text-xs leading-relaxed text-amber-700">
            অ্যাডমিন TrxID মিলিয়ে দেখছে। ঠিক থাকলে ৫–৩০ মিনিটের মধ্যে ব্যালেন্স যোগ হবে —
            নোটিফিকেশন পাবেন। আবার রিকোয়েস্ট পাঠানোর দরকার নেই।
          </p>
        </div>
      )}

      <DepositForm
        channels={channels.map((c: (typeof channels)[number]) => ({
          id: c.id,
          method: c.method,
          accountNo: c.accountNo,
          accountType: c.accountType,
          instruction: c.instruction ?? '',
        }))}
        min={Number(settings.min_deposit || 20)}
        max={Number(settings.max_deposit || 25000)}
      />

      <section>
        <h2 className="mb-3 font-semibold text-slate-900">ডিপোজিট ইতিহাস</h2>

        {deposits.length === 0 ? (
          <div className="card py-12 text-center text-slate-400">কোনো ডিপোজিট নেই</div>
        ) : (
          <>
            <div className="space-y-3 md:hidden">
              {deposits.map((d: (typeof deposits)[number]) => (
                <div key={d.id} className="card p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="font-mono text-sm font-bold text-rose-600">#{d.depositNo}</span>
                    <Badge status={d.status} />
                  </div>
                  <div className="flex items-baseline justify-between">
                    <span className="text-xs font-bold text-slate-400">{d.method}</span>
                    <span className="text-lg font-bold text-slate-900">{bdt(d.amount)}</span>
                  </div>
                  <dl className="mt-3 space-y-1 border-t border-slate-200 pt-3 text-xs">
                    <div className="flex justify-between">
                      <dt className="text-slate-400">TrxID</dt>
                      <dd className="font-mono text-amber-700">{d.trxId}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-slate-400">সময়</dt>
                      <dd className="text-slate-400">{fmtDate(d.createdAt)}</dd>
                    </div>
                  </dl>
                  {d.adminNote && (
                    <p className="mt-2 rounded bg-slate-50 p-2 text-xs text-slate-400">{d.adminNote}</p>
                  )}
                </div>
              ))}
            </div>

            <div className="table-wrap hidden md:block">
              <table className="tbl">
                <thead>
                  <tr>
                    <th scope="col">#</th>
                    <th scope="col">মাধ্যম</th>
                    <th scope="col" className="text-right">পরিমাণ</th>
                    <th scope="col">TrxID</th>
                    <th scope="col">স্ট্যাটাস</th>
                    <th scope="col">তারিখ</th>
                    <th scope="col">নোট</th>
                  </tr>
                </thead>
                <tbody>
                  {deposits.map((d: (typeof deposits)[number]) => (
                    <tr key={d.id}>
                      <td className="font-mono text-rose-600">#{d.depositNo}</td>
                      <td className="text-xs font-semibold">{d.method}</td>
                      <td className="whitespace-nowrap text-right font-semibold text-slate-900">
                        {bdt(d.amount)}
                      </td>
                      <td className="font-mono text-xs text-slate-400">{d.trxId}</td>
                      <td><Badge status={d.status} /></td>
                      <td className="whitespace-nowrap text-xs text-slate-400">{fmtDate(d.createdAt)}</td>
                      <td className="max-w-[150px] text-xs text-slate-400">{d.adminNote || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
