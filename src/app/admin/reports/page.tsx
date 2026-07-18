import { prisma } from '@/lib/prisma';
import { bdt } from '@/lib/money';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'রিপোর্ট' };

function rangeStart(days: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - days);
  return d;
}

export default async function ReportsPage() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d7 = rangeStart(7);
  const d30 = rangeStart(30);

  const [
    todayDep, todayOrd, todayRev,
    w7Dep, w7Rev, m30Dep, m30Rev, m30Users,
    topProducts, topCustomers,
  ] = await Promise.all([
    prisma.deposit.aggregate({ where: { status: 'APPROVED', reviewedAt: { gte: today } }, _sum: { amount: true } }),
    prisma.order.count({ where: { createdAt: { gte: today } } }),
    prisma.order.aggregate({ where: { status: 'COMPLETED', completedAt: { gte: today } }, _sum: { price: true } }),
    prisma.deposit.aggregate({ where: { status: 'APPROVED', reviewedAt: { gte: d7 } }, _sum: { amount: true } }),
    prisma.order.aggregate({ where: { status: 'COMPLETED', completedAt: { gte: d7 } }, _sum: { price: true } }),
    prisma.deposit.aggregate({ where: { status: 'APPROVED', reviewedAt: { gte: d30 } }, _sum: { amount: true } }),
    prisma.order.aggregate({ where: { status: 'COMPLETED', completedAt: { gte: d30 } }, _sum: { price: true } }),
    prisma.user.count({ where: { role: 'USER', createdAt: { gte: d30 } } }),
    // ★ Best selling — সম্পন্ন অর্ডার গুনে
    prisma.order.groupBy({
      by: ['productName'],
      where: { status: 'COMPLETED' },
      _count: { _all: true },
      _sum: { price: true },
      orderBy: { _count: { productName: 'desc' } },
      take: 5,
    }),
    // ★ Top customers — মোট খরচ অনুযায়ী
    prisma.order.groupBy({
      by: ['userId'],
      where: { status: 'COMPLETED' },
      _sum: { price: true },
      _count: { _all: true },
      orderBy: { _sum: { price: 'desc' } },
      take: 5,
    }),
  ]);

  const topCustomerIds = topCustomers.map((c: (typeof topCustomers)[number]) => c.userId);
  const customerMap = new Map<string, { name: string; phone: string }>();
  if (topCustomerIds.length) {
    const cs = await prisma.user.findMany({
      where: { id: { in: topCustomerIds } },
      select: { id: true, name: true, phone: true },
    });
    cs.forEach((c: (typeof cs)[number]) => customerMap.set(c.id, { name: c.name, phone: c.phone }));
  }

  const period = [
    { label: 'আজ', dep: todayDep._sum.amount, rev: todayRev._sum.price, extra: `${todayOrd} অর্ডার` },
    { label: '৭ দিন', dep: w7Dep._sum.amount, rev: w7Rev._sum.price, extra: '' },
    { label: '৩০ দিন', dep: m30Dep._sum.amount, rev: m30Rev._sum.price, extra: `${m30Users} নতুন ইউজার` },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="lux-text text-2xl font-medium sm:text-[27px]">রিপোর্ট</h1>
        <p className="mt-1.5 text-sm font-light text-slate-500">বিক্রি, রিচার্জ ও সেরা পণ্য/গ্রাহক — সাথে CSV ডাউনলোড।</p>
      </div>

      {/* ── সময়ভিত্তিক সারাংশ ── */}
      <section className="grid gap-4 sm:grid-cols-3">
        {period.map((p) => (
          <div key={p.label} className="card p-5">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{p.label}</p>
            <div className="mt-2 space-y-1">
              <p className="flex justify-between text-sm">
                <span className="text-slate-500">রিচার্জ</span>
                <span className="font-bold text-emerald-700">{bdt(p.dep ?? 0)}</span>
              </p>
              <p className="flex justify-between text-sm">
                <span className="text-slate-500">বিক্রি</span>
                <span className="font-bold text-rose-700">{bdt(p.rev ?? 0)}</span>
              </p>
              {p.extra && <p className="pt-1 text-xs text-slate-400">{p.extra}</p>}
            </div>
          </div>
        ))}
      </section>

      {/* ── CSV ডাউনলোড ── */}
      <section className="card p-5">
        <h2 className="mb-1 text-sm font-bold uppercase tracking-wide text-slate-500">CSV ডাউনলোড (শেষ ৩০ দিন)</h2>
        <p className="mb-3 text-xs text-slate-400">Excel / Google Sheets এ খুলবে। বাংলা ঠিক দেখাবে।</p>
        <div className="flex flex-wrap gap-3">
          <a href="/api/admin/reports?type=orders" className="btn-primary" download>📦 অর্ডার রিপোর্ট</a>
          <a href="/api/admin/reports?type=deposits" className="btn-ghost" download>💰 রিচার্জ রিপোর্ট</a>
          <a href="/api/admin/reports?type=users" className="btn-ghost" download>👤 ইউজার রিপোর্ট</a>
        </div>
      </section>

      {/* ── সেরা পণ্য ও গ্রাহক ── */}
      <section className="grid gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">সবচেয়ে বেশি বিক্রি</h2>
          {topProducts.length === 0 ? (
            <p className="text-sm text-slate-400">এখনো কোনো সম্পন্ন অর্ডার নেই</p>
          ) : (
            <ol className="space-y-2">
              {topProducts.map((p: (typeof topProducts)[number], i: number) => (
                <li key={p.productName} className="flex items-center justify-between text-sm">
                  <span className="text-slate-700"><span className="text-slate-400">{i + 1}.</span> {p.productName}</span>
                  <span className="font-semibold text-slate-900">{p._count._all} বার · {bdt(p._sum.price ?? 0)}</span>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="card p-5">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">সেরা গ্রাহক</h2>
          {topCustomers.length === 0 ? (
            <p className="text-sm text-slate-400">এখনো কোনো সম্পন্ন অর্ডার নেই</p>
          ) : (
            <ol className="space-y-2">
              {topCustomers.map((c: (typeof topCustomers)[number], i: number) => {
                const info = customerMap.get(c.userId);
                return (
                  <li key={c.userId} className="flex items-center justify-between text-sm">
                    <span className="text-slate-700">
                      <span className="text-slate-400">{i + 1}.</span> {info?.name ?? 'অজানা'}
                      <span className="ml-1 text-xs text-slate-400">{info?.phone}</span>
                    </span>
                    <span className="font-semibold text-slate-900">{bdt(c._sum.price ?? 0)} · {c._count._all} অর্ডার</span>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </section>
    </div>
  );
}
