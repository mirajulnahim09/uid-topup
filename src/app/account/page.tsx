import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getSettings } from '@/lib/settings';
import { bdt } from '@/lib/money';
import { fmtDate } from '@/lib/date';
import ReferralCard from '@/components/ReferralCard';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'প্রোফাইল' };

export default async function AccountPage() {
  const session = await getServerSession(authOptions);
  if (!session) return null;

  const [user, settings, refEarn] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.user.id },
      include: {
        ledger: { orderBy: { createdAt: 'desc' }, take: 20 },
        _count: { select: { orders: true, deposits: true, referrals: true } },
      },
    }),
    getSettings(),
    prisma.ledgerEntry.aggregate({
      where: { userId: session.user.id, type: 'REFERRAL_BONUS' },
      _sum: { amount: true },
    }),
  ]);

  if (!user) return null;

  return (
    <div className="space-y-6">
      <h1 className="lux-text text-2xl font-medium sm:text-[27px]">আমার প্রোফাইল</h1>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card border-emerald-200 bg-gradient-to-br from-emerald-50 to-emerald-100 p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700/80">ব্যালেন্স</p>
          <p className="mt-1 text-3xl font-bold text-emerald-700">{bdt(user.balance)}</p>
          <Link href="/account/wallet/deposit" className="btn-success mt-3 w-full">+ Add Money</Link>
        </div>

        <div className="card p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">মোট অর্ডার</p>
          <p className="mt-1 text-3xl font-bold text-slate-900">{user._count.orders}</p>
          <Link href="/account/orders" className="btn-ghost mt-3 w-full">অর্ডার দেখুন</Link>
        </div>

        <div className="card p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">ডিপোজিট</p>
          <p className="mt-1 text-3xl font-bold text-slate-900">{user._count.deposits}</p>
          <p className="mt-4 text-xs text-slate-400">
            সদস্য: {fmtDate(user.createdAt).split(',')[0]}
          </p>
        </div>

        <div className="card border-purple-200 bg-gradient-to-br from-purple-50 to-purple-100 p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-purple-700/80">রেফারেল আয়</p>
          <p className="mt-1 text-3xl font-bold text-purple-700">
            {bdt(refEarn._sum.amount ?? 0)}
          </p>
          <p className="mt-4 text-xs text-slate-400">{user._count.referrals} জন রেফার করেছেন</p>
        </div>
      </div>

      {/* দ্রুত লিংক */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { href: '/account/orders', icon: '📦', label: 'অর্ডার' },
          { href: '/account/wallet/deposit', icon: '💰', label: 'Add Money' },
          { href: '/account/notifications', icon: '🔔', label: 'নোটিফিকেশন' },
          { href: '/account/profile', icon: '⚙️', label: 'সেটিংস' },
        ].map((l) => (
          <a
            key={l.href}
            href={l.href}
            className="card p-4 text-center transition hover:-translate-y-1 hover:border-rose-300 hover:shadow-md"
          >
            <p className="text-2xl" aria-hidden="true">{l.icon}</p>
            <p className="mt-1 text-xs font-bold text-slate-700">{l.label}</p>
          </a>
        ))}
      </div>

      <ReferralCard
        code={user.referralCode}
        bonus={Number(settings.referral_bonus || 20)}
        minDeposit={Number(settings.referral_min_deposit || 100)}
        count={user._count.referrals}
      />

      <section className="card p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold text-slate-900">অ্যাকাউন্ট তথ্য</h2>
          <a href="/account/profile" className="text-sm font-bold text-rose-600 hover:underline">
            ✎ এডিট
          </a>
        </div>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-slate-400">নাম</dt>
            <dd className="font-medium text-slate-900">{user.name}</dd>
          </div>
          <div>
            <dt className="text-slate-400">ইমেইল</dt>
            <dd className="break-all font-medium text-slate-900">{user.email}</dd>
          </div>
          <div>
            <dt className="text-slate-400">মোবাইল</dt>
            <dd className="font-mono font-medium text-slate-900">{user.phone}</dd>
          </div>
          <div>
            <dt className="text-slate-400">যোগদান</dt>
            <dd className="font-medium text-slate-900">{fmtDate(user.createdAt)}</dd>
          </div>
        </dl>
      </section>

      <section>
        <h2 className="mb-3 font-semibold text-slate-900">লেনদেনের ইতিহাস</h2>
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th scope="col">তারিখ</th>
                <th scope="col">ধরন</th>
                <th scope="col">বিবরণ</th>
                <th scope="col" className="text-right">পরিমাণ</th>
                <th scope="col" className="text-right">ব্যালেন্স</th>
              </tr>
            </thead>
            <tbody>
              {user.ledger.map((l: (typeof user.ledger)[number]) => {
                const amt = Number(l.amount);
                return (
                  <tr key={l.id}>
                    <td className="whitespace-nowrap text-xs text-slate-400">{fmtDate(l.createdAt)}</td>
                    <td className="text-xs">{l.type}</td>
                    <td className="text-xs text-slate-400">{l.note}</td>
                    <td className={`whitespace-nowrap text-right font-semibold ${
                      amt >= 0 ? 'text-emerald-600' : 'text-red-600'
                    }`}>
                      {amt >= 0 ? '+' : ''}{bdt(l.amount)}
                    </td>
                    <td className="whitespace-nowrap text-right text-slate-400">
                      {bdt(l.balanceAfter)}
                    </td>
                  </tr>
                );
              })}
              {user.ledger.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-10 text-center text-slate-400">কোনো লেনদেন নেই</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
