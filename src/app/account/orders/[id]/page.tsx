import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { bdt } from '@/lib/money';
import { fmtDate } from '@/lib/date';
import Badge from '@/components/Badge';
import OrderTimeline from '@/components/OrderTimeline';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'অর্ডার বিস্তারিত' };

export default async function OrderDetail({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return null;

  const order = await prisma.order.findUnique({
    where: { id: params.id },
    include: { coupon: { select: { code: true } } },
  });

  // ★ শুধু নিজের অর্ডার দেখা যাবে — অন্যের ID দিলেও নয়
  if (!order || order.userId !== session.user.id) notFound();

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link
        href="/account/orders"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 transition hover:text-rose-600"
      >
        ← সব অর্ডার
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900">
          অর্ডার <span className="font-mono text-rose-600">#{order.orderNo}</span>
        </h1>
        <Badge status={order.status} />
      </div>

      {/* ★ টাইমলাইন — কোথায় আছে দেখায় */}
      <OrderTimeline
        status={order.status}
        createdAt={order.createdAt.toISOString()}
        completedAt={order.completedAt?.toISOString() ?? null}
      />

      <section className="card p-5">
        <h2 className="mb-4 font-bold text-slate-900">বিস্তারিত</h2>

        <dl className="space-y-3 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="shrink-0 text-slate-500">প্রোডাক্ট</dt>
            <dd className="text-right font-semibold text-slate-900">{order.productName}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="shrink-0 text-slate-500">প্যাকেজ</dt>
            <dd className="text-right font-semibold text-rose-600">{order.variantName}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="shrink-0 text-slate-500">Player UID</dt>
            <dd className="text-right font-mono font-semibold text-slate-900">
              {order.playerUid}
            </dd>
          </div>
          {order.playerName && (
            <div className="flex justify-between gap-3">
              <dt className="shrink-0 text-slate-500">প্লেয়ার নাম</dt>
              <dd className="text-right text-slate-700">{order.playerName}</dd>
            </div>
          )}
          <div className="flex justify-between gap-3">
            <dt className="shrink-0 text-slate-500">অর্ডারের সময়</dt>
            <dd className="text-right text-slate-700">{fmtDate(order.createdAt)}</dd>
          </div>
          {order.completedAt && (
            <div className="flex justify-between gap-3">
              <dt className="shrink-0 text-slate-500">
                {order.status === 'REFUNDED' ? 'বাতিলের সময়' : 'সম্পন্নের সময়'}
              </dt>
              <dd className="text-right text-slate-700">{fmtDate(order.completedAt)}</dd>
            </div>
          )}
        </dl>

        {/* ── টাকার হিসাব ── */}
        <dl className="mt-5 space-y-2 rounded-xl bg-slate-50 p-4 text-sm">
          <div className="flex justify-between">
            <dt className="text-slate-500">দাম</dt>
            <dd className="text-slate-700">{bdt(order.subtotal)}</dd>
          </div>

          {Number(order.discount) > 0 && (
            <div className="flex justify-between">
              <dt className="text-emerald-600">
                ছাড় {order.coupon && `(${order.coupon.code})`}
              </dt>
              <dd className="font-semibold text-emerald-600">−{bdt(order.discount)}</dd>
            </div>
          )}

          <div className="flex justify-between border-t border-slate-200 pt-2">
            <dt className="font-bold text-slate-700">
              {order.status === 'REFUNDED' ? 'ফেরত দেওয়া হয়েছে' : 'মোট কাটা হয়েছে'}
            </dt>
            <dd className="text-lg font-extrabold text-rose-600">{bdt(order.price)}</dd>
          </div>
        </dl>

        {order.adminNote && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="text-xs font-bold text-amber-800">অ্যাডমিনের নোট</p>
            <p className="mt-0.5 text-sm text-amber-700">{order.adminNote}</p>
          </div>
        )}
      </section>

      {order.status === 'REFUNDED' && (
        <div className="rounded-xl border-2 border-purple-200 bg-purple-50 p-4">
          <p className="text-sm leading-relaxed text-purple-800">
            ↩ এই অর্ডারটি সম্পন্ন করা যায়নি। <strong>{bdt(order.price)}</strong> আপনার
            ওয়ালেটে ফেরত দেওয়া হয়েছে।
          </p>
        </div>
      )}

      {(order.status === 'PENDING' || order.status === 'PROCESSING') && (
        <div className="rounded-xl border-2 border-blue-200 bg-blue-50 p-4">
          <p className="text-sm leading-relaxed text-blue-800">
            ⏳ আপনার অর্ডার প্রসেস করা হচ্ছে। সাধারণত ৫–৩০ মিনিট লাগে।
            সম্পন্ন হলে নোটিফিকেশন পাবেন।
          </p>
        </div>
      )}
    </div>
  );
}
