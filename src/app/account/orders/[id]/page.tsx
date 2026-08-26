import Link from 'next/link';
import AutoRefresh from '@/components/AutoRefresh';
import { notFound } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { bdt } from '@/lib/money';
import { fmtDate } from '@/lib/date';
import Badge from '@/components/Badge';
import OrderTimeline from '@/components/OrderTimeline';
import SlaCountdown from '@/components/SlaCountdown';
import DeliveryConfirm from '@/components/DeliveryConfirm';
import ReceiptActions from '@/components/ReceiptActions';
import { getSettings } from '@/lib/settings';
import { slaFromSettings, slaExplanationForOrder } from '@/lib/sla';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'অর্ডার বিস্তারিত' };

export default async function OrderDetail({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { placed?: string };
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return null;

  const [order, settings, me] = await Promise.all([
    prisma.order.findUnique({
      where: { id: params.id },
      include: {
        coupon: { select: { code: true } },
        // ★ প্রকৃত ঘটনাপঞ্জি — সময়ক্রম অনুসারে
        events: {
          orderBy: { createdAt: 'asc' },
          select: { status: true, note: true, createdAt: true },
        },
        review: { select: { id: true } },
      },
    }),
    getSettings(),
    // ★ রেফারেল কোড (5.4) — শুধু এই একটি ফিল্ড, পুরো User সারি নয়
    //   (CLAUDE.md §8: User এ সবসময় `select`)
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { referralCode: true },
    }),
  ]);

  // ★ শুধু নিজের অর্ডার দেখা যাবে — অন্যের ID দিলেও নয়
  if (!order || order.userId !== session.user.id) notFound();

  const sla = slaFromSettings(settings);
  const isCancelled = order.status === 'REFUNDED' || order.status === 'FAILED';

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <AutoRefresh seconds={30} />
      {/* ★ `min-h-[40px]` — অডিটে মাপা উচ্চতা ছিল **২০px** (২০২৬-০৮-২৬,
          প্রতিটি ভিউপোর্টে)। একই ত্রুটি `wallet/withdraw` এ আগেই সারানো
          হয়েছিল, কিন্তু ডিটেইল-পাতাগুলো তখন অডিটের রুট-তালিকায় ছিল না
          বলে ধরা পড়েনি। ২০px WCAG 2.5.8 (AA) এর ২৪px-ও পার করে না। */}
      <Link
        href="/account/orders"
        className="inline-flex min-h-[40px] items-center gap-1.5 text-sm font-semibold text-slate-500 transition hover:text-rose-600"
      >
        ← সব অর্ডার
      </Link>

      {/* ★ সদ্য অর্ডার করা হয়েছে — স্থায়ী রসিদের নিশ্চয়তা (2.11)।
          "টাকা শূন্যে পাঠিয়ে দিলাম" অনুভূতিকে "এটা হাতে নেওয়া
          হয়েছে" তে বদলানোই এখানকার কাজ (MANUAL_WORKFLOW.md A6)। */}
      {searchParams.placed === '1' && (
        <div
          className="card p-5"
          style={{ borderColor: 'rgba(127,224,187,.35)', background: 'rgba(127,224,187,.06)' }}
        >
          <h2 className="dsp text-base font-semibold" style={{ color: 'var(--ink)' }}>
            ✓ অর্ডার #{order.orderNo} গ্রহণ করা হয়েছে
          </h2>
          <p className="mt-1.5 text-sm leading-relaxed" style={{ color: 'var(--mut)' }}>
            এই পাতাটিই আপনার রসিদ — লিংকটি সংরক্ষণ করে রাখতে পারেন।
            অবস্থা বদলালে নোটিফিকেশন পাবেন।
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="lux-text text-2xl font-medium sm:text-[27px]">
          অর্ডার <span className="font-mono text-rose-600">#{order.orderNo}</span>
        </h1>
        <Badge status={order.status} />
      </div>

      {/* ★ টাইমলাইন — কোথায় আছে দেখায় */}
      <OrderTimeline
        status={order.status}
        createdAt={order.createdAt.toISOString()}
        completedAt={order.completedAt?.toISOString() ?? null}
        events={order.events.map((e) => ({
          status: e.status,
          note: e.note,
          at: e.createdAt.toISOString(),
        }))}
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

        {/* সফল অর্ডারের নোট — সাধারণ তথ্য হিসেবে */}
        {order.adminNote && !isCancelled && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="text-xs font-bold text-amber-800">অ্যাডমিনের নোট</p>
            <p className="mt-0.5 text-sm text-amber-700">{order.adminNote}</p>
          </div>
        )}

        {/* ★ রসিদ সংরক্ষণ ও ট্র্যাকিং লিংক */}
        <div className="mt-5 border-t pt-4" style={{ borderColor: 'var(--hair)' }}>
          <ReceiptActions trackToken={order.trackToken} orderId={order.id} />
        </div>
      </section>

      {/* ★★★ সম্পন্ন হলে — "পৌঁছেছে তো?" প্রশ্ন ও রিভিউ (2.9)।
          অ্যাডমিনের "সম্পন্ন" চাপা মানেই ডেলিভারি হয়েছে নয় —
          গ্রাহকই একমাত্র সাক্ষী। */}
      {order.status === 'COMPLETED' && (
        <DeliveryConfirm
          orderId={order.id}
          orderNo={order.orderNo}
          confirmed={Boolean(order.deliveryConfirmedAt)}
          disputed={Boolean(order.deliveryDisputedAt)}
          hasReview={Boolean(order.review)}
          disputeWindowDays={Number(settings.dispute_window_days || 3)}
          referralCode={me?.referralCode}
        />
      )}

      {/* ★★★ বাতিল/ব্যর্থ — কারণটাই এখানে প্রধান বিষয়, লুকানো নয়।
          গ্রাহকের প্রথম প্রশ্ন "কেন?" — উত্তরটা সবচেয়ে উপরে থাকতে হবে
          (MANUAL_WORKFLOW.md A7) */}
      {isCancelled && (
        <div className="card p-5">
          <div className="flex items-start gap-3">
            <span
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-lg"
              style={{ background: 'rgba(242,168,196,.12)', border: '1px solid rgba(242,168,196,.3)' }}
              aria-hidden="true"
            >
              ↩
            </span>
            <div className="min-w-0">
              <h2 className="dsp text-base font-semibold" style={{ color: 'var(--ink)' }}>
                {order.status === 'REFUNDED'
                  ? `অর্ডারটি বাতিল — ${bdt(order.price)} ফেরত দেওয়া হয়েছে`
                  : 'অর্ডারটি সম্পন্ন করা যায়নি'}
              </h2>

              {/* কারণ — সুনির্দিষ্ট ও কাজের */}
              {order.adminNote && (
                <p
                  className="mt-2 whitespace-pre-line text-sm leading-relaxed"
                  style={{ color: 'var(--mut)' }}
                >
                  {order.adminNote}
                </p>
              )}

              {order.status === 'REFUNDED' && (
                <p className="mt-3 text-xs" style={{ color: 'var(--mut)' }}>
                  ফেরতের টাকা এখনই ব্যবহার করা যাবে —{' '}
                  <Link href="/account" className="underline" style={{ color: 'var(--gold)' }}>
                    ব্যালেন্স দেখুন
                  </Link>
                </p>
              )}

              <div className="mt-4 flex flex-wrap gap-2">
                <Link href={`/product/${order.variantId}`} className="btn-ghost px-4 text-sm">
                  আবার অর্ডার করুন
                </Link>
                <Link href="/contact" className="btn-ghost px-4 text-sm">
                  সাপোর্টে যোগাযোগ
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}

      {(order.status === 'PENDING' || order.status === 'PROCESSING') && (
        <div className="card p-5">
          <p className="text-sm leading-relaxed" style={{ color: 'var(--ink)' }}>
            ⏳ আপনার অর্ডার প্রসেস করা হচ্ছে।{' '}
            {slaExplanationForOrder(sla, order.createdAt, order.slaDueAt)} সম্পন্ন হলে
            নোটিফিকেশন পাবেন।
          </p>

          {/* ★ জীবন্ত কাউন্টডাউন — অনির্দিষ্ট অপেক্ষার বদলে নির্দিষ্ট সময় */}
          {order.slaDueAt && (
            <div className="mt-3">
              <SlaCountdown dueAt={order.slaDueAt.toISOString()} />
            </div>
          )}

          <p className="mt-3 text-xs leading-relaxed" style={{ color: 'var(--mut)' }}>
            প্রতিশ্রুত সময় পেরিয়ে গেলে{' '}
            <Link href="/contact" className="underline" style={{ color: 'var(--gold)' }}>
              সাপোর্টে জানান
            </Link>{' '}
            — অর্ডার নাম্বার <span className="font-mono">#{order.orderNo}</span> উল্লেখ করুন।
          </p>
        </div>
      )}
    </div>
  );
}
