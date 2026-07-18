import Link from 'next/link';
import AutoRefresh from '@/components/AutoRefresh';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { bdt } from '@/lib/money';
import { fmtDate } from '@/lib/date';
import Badge from '@/components/Badge';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'SMM অর্ডার' };

// ★ SMM / সাবস্ক্রিপশন অর্ডার = "LIKE - FOLLOW - SUBSCRIBE" ক্যাটাগরির অর্ডার
//   (YouTube Premium, Netflix, Amazon Prime ইত্যাদি)।
//   Free Fire টপ-আপ থেকে আলাদা করে এখানে দেখানো হয়।
//   কোনো schema বদল লাগে না — category slug দিয়ে filter।
const SMM_CATEGORY_SLUG = 'like-follow-subscribe';

export default async function SmmOrdersPage() {
  const session = await getServerSession(authOptions);
  if (!session) return null;

  const orders = await prisma.order.findMany({
    where: {
      userId: session.user.id,
      variant: { product: { category: { slug: SMM_CATEGORY_SLUG } } },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  return (
    <div className="space-y-5">
      <AutoRefresh seconds={30} />
      <div>
        <h1 className="lux-text text-2xl font-medium sm:text-[27px]">SMM অর্ডার</h1>
        <p className="mt-1.5 text-sm font-light text-slate-500">
          YouTube / Netflix / Prime সহ সাবস্ক্রিপশন সার্ভিসের অর্ডার
        </p>
      </div>

      {orders.length === 0 ? (
        <div className="card py-16 text-center">
          <p className="text-4xl" aria-hidden="true">🎬</p>
          <p className="mt-3 text-slate-400">কোনো সাবস্ক্রিপশন অর্ডার নেই</p>
          <Link href="/" className="btn-primary mt-5">সার্ভিস দেখুন</Link>
        </div>
      ) : (
        <>
          {/* ── মোবাইল: কার্ড ── */}
          <div className="space-y-3 md:hidden">
            {orders.map((o: (typeof orders)[number]) => (
              <Link key={o.id} href={`/account/orders/${o.id}`} className="card block p-4 transition hover:-translate-y-0.5 hover:shadow-md">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-mono text-sm font-bold text-rose-600">#{o.orderNo}</span>
                  <Badge status={o.status} />
                </div>
                <p className="text-sm font-medium text-slate-900">{o.productName}</p>
                <p className="text-xs text-slate-400">{o.variantName}</p>
                <dl className="mt-3 space-y-1 border-t border-slate-200 pt-3 text-xs">
                  <div className="flex justify-between">
                    <dt className="text-slate-400">অ্যাকাউন্ট / তথ্য</dt>
                    <dd className="font-mono text-slate-400">{o.playerUid}</dd>
                  </div>
                  {Number(o.discount) > 0 && (
                    <div className="flex justify-between">
                      <dt className="text-slate-400">ছাড়</dt>
                      <dd className="text-emerald-600">−{bdt(o.discount)}</dd>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <dt className="text-slate-400">মূল্য</dt>
                    <dd className="font-bold text-slate-900">{bdt(o.price)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-400">সময়</dt>
                    <dd className="text-slate-400">{fmtDate(o.createdAt)}</dd>
                  </div>
                </dl>
                {o.adminNote && (
                  <p className="mt-2 rounded bg-slate-50 p-2 text-xs text-slate-400">{o.adminNote}</p>
                )}
                <p className="mt-2 text-right text-xs font-bold text-rose-600">বিস্তারিত →</p>
              </Link>
            ))}
          </div>

          {/* ── ডেস্কটপ ── */}
          <div className="table-wrap hidden md:block">
            <table className="tbl">
              <thead>
                <tr>
                  <th scope="col">অর্ডার</th>
                  <th scope="col">সার্ভিস</th>
                  <th scope="col">অ্যাকাউন্ট / তথ্য</th>
                  <th scope="col" className="text-right">মূল্য</th>
                  <th scope="col">স্ট্যাটাস</th>
                  <th scope="col">তারিখ</th>
                  <th scope="col">নোট</th>
                  <th scope="col"></th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o: (typeof orders)[number]) => (
                  <tr key={o.id}>
                    <td className="font-mono font-semibold text-rose-600">#{o.orderNo}</td>
                    <td>
                      <div className="text-sm font-medium text-slate-900">{o.productName}</div>
                      <div className="text-xs text-slate-400">{o.variantName}</div>
                    </td>
                    <td className="font-mono text-xs text-slate-400">{o.playerUid}</td>
                    <td className="whitespace-nowrap text-right">
                      <div className="font-semibold text-slate-900">{bdt(o.price)}</div>
                      {Number(o.discount) > 0 && (
                        <div className="text-[10px] text-emerald-600">−{bdt(o.discount)} ছাড়</div>
                      )}
                    </td>
                    <td><Badge status={o.status} /></td>
                    <td className="whitespace-nowrap text-xs text-slate-400">{fmtDate(o.createdAt)}</td>
                    <td className="max-w-[160px] text-xs text-slate-400">{o.adminNote || '—'}</td>
                    <td className="text-right">
                      <Link
                        href={`/account/orders/${o.id}`}
                        className="text-xs font-bold text-rose-600 hover:underline"
                      >
                        দেখুন →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
