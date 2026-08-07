import Link from 'next/link';
import AutoRefresh from '@/components/AutoRefresh';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { bdt } from '@/lib/money';
import { fmtDate } from '@/lib/date';
import Badge from '@/components/Badge';
import Icon from '@/components/fx/Icon';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'আমার অর্ডার' };

/**
 * ★ "আবার অর্ডার" লিংক — একই প্যাকেজ ও একই UID প্রি-ফিল করে (2.13)।
 *   প্রোডাক্ট বা ভ্যারিয়েন্ট নিষ্ক্রিয় হয়ে থাকলে null — ভাঙা লিংক
 *   দেখানোর চেয়ে সৎভাবে "আর নেই" বলা ভালো।
 */
function reorderHref(o: {
  playerUid: string;
  variant: { id: number; isActive: boolean; product: { id: number; slug: string; isActive: boolean } } | null;
}): string | null {
  const v = o.variant;
  if (!v || !v.isActive || !v.product.isActive) return null;
  const q = new URLSearchParams({ v: String(v.id), uid: o.playerUid });
  return `/product/${v.product.id}/${v.product.slug}?${q.toString()}`;
}

export default async function OrdersPage() {
  const session = await getServerSession(authOptions);
  if (!session) return null;

  const orders = await prisma.order.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
    // ★ এক-ট্যাপে আবার অর্ডারের লিংক বানাতে প্রোডাক্টের তথ্য দরকার (2.13)
    include: {
      variant: {
        select: {
          id: true,
          isActive: true,
          product: { select: { id: true, slug: true, isActive: true } },
        },
      },
    },
  });

  return (
    <div className="space-y-5">
      <AutoRefresh seconds={30} />
      <h1 className="lux-text text-2xl font-medium sm:text-[27px]">আমার অর্ডার</h1>

      {orders.length === 0 ? (
        <div className="card py-16 text-center">
          <span className="mx-auto grid h-14 w-14 place-items-center" style={{ border: '1px solid var(--v-edge)', color: 'var(--v-ice)' }}><Icon name="box" size={26} /></span>
          <p className="mt-3 text-slate-400">কোনো অর্ডার নেই</p>
          <Link href="/" className="btn-primary mt-5">টপ আপ করুন</Link>
        </div>
      ) : (
        <>
          {/* ── মোবাইল: কার্ড ── */}
          <div className="space-y-3 md:hidden">
            {orders.map((o: (typeof orders)[number]) => (
              // ★ কার্ডটি আর Link নয় — ভেতরে "আবার অর্ডার" লিংক বসাতে
              //   হলে nested <a> হয়ে যেত, যা অবৈধ HTML (2.13)
              <div key={o.id} className="card block p-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-mono text-sm font-bold text-rose-600">#{o.orderNo}</span>
                  <Badge status={o.status} />
                </div>
                <p className="text-sm font-medium text-slate-900">{o.productName}</p>
                <p className="text-xs text-slate-400">{o.variantName}</p>
                <dl className="mt-3 space-y-1 border-t border-slate-200 pt-3 text-xs">
                  <div className="flex justify-between">
                    <dt className="text-slate-400">UID</dt>
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

                <div className="mt-3 flex items-center justify-between gap-2">
                  {/* ★ এক ট্যাপে আবার অর্ডার — একই প্যাকেজ, একই UID (2.13) */}
                  {reorderHref(o) ? (
                    <Link href={reorderHref(o)!} className="btn-ghost px-3 py-2 text-xs">
                      ↻ আবার অর্ডার
                    </Link>
                  ) : (
                    <span className="text-[11px]" style={{ color: 'var(--mut)' }}>
                      এই প্যাকেজটি আর নেই
                    </span>
                  )}
                  <Link
                    href={`/account/orders/${o.id}`}
                    className="inline-flex min-h-[40px] items-center text-xs font-bold" style={{ color: 'var(--v-volt)' }}
                  >
                    বিস্তারিত →
                  </Link>
                </div>
              </div>
            ))}
          </div>

          {/* ── ডেস্কটপ ── */}
          <div className="table-wrap hidden md:block">
            <table className="tbl">
              <thead>
                <tr>
                  <th scope="col">অর্ডার</th>
                  <th scope="col">প্রোডাক্ট</th>
                  <th scope="col">UID</th>
                  <th scope="col" className="num">মূল্য</th>
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
                    <td className="whitespace-nowrap num">
                      <div className="font-semibold text-slate-900">{bdt(o.price)}</div>
                      {Number(o.discount) > 0 && (
                        <div className="text-[10px] text-emerald-600">−{bdt(o.discount)} ছাড়</div>
                      )}
                    </td>
                    <td><Badge status={o.status} /></td>
                    <td className="whitespace-nowrap text-xs text-slate-400">{fmtDate(o.createdAt)}</td>
                    <td className="max-w-[160px] text-xs text-slate-400">{o.adminNote || '—'}</td>
                    <td className="whitespace-nowrap num">
                      {/* ★ এক ক্লিকে আবার অর্ডার (2.13) */}
                      {reorderHref(o) && (
                        <Link
                          href={reorderHref(o)!}
                          className="mr-3 text-xs font-bold hover:underline"
                          style={{ color: 'var(--gold)' }}
                        >
                          ↻ আবার
                        </Link>
                      )}
                      <Link
                        href={`/account/orders/${o.id}`}
                        className="inline-flex min-h-[40px] items-center text-xs font-bold hover:underline" style={{ color: 'var(--v-volt)' }}
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
