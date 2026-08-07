import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import OrderTable from '@/components/admin/OrderTable';
import { requireAdmin } from '@/lib/guard';
import { claimState } from '@/lib/orderClaim';
import { breachInfo, countBreaches, SLA_WARN_MIN } from '@/lib/slaBreach';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'অর্ডার' };

const VALID = [
  'AWAITING_PAYMENT', 'PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'REFUNDED',
] as const;
type S = (typeof VALID)[number];

export default async function AdminOrders({
  searchParams,
}: {
  searchParams: { status?: string; variant?: string };
}) {
  // ★ claim "আমার না অন্যের" — এটি বলতে হলে কে দেখছে জানা দরকার (3.7)
  const admin = await requireAdmin();

  const s = searchParams.status;
  const status = s && (VALID as readonly string[]).includes(s) ? (s as S) : undefined;

  // ★ প্রোডাক্ট অনুযায়ী ফিল্টার (3.12)
  const variantId = Number(searchParams.variant);
  const variantFilter = Number.isInteger(variantId) && variantId > 0 ? variantId : undefined;

  // ★★★ ডিফল্ট তালিকা থেকে AWAITING_PAYMENT বাদ — এগুলোর টাকা এখনো
  //     যাচাই হয়নি, তাই ফুলফিলমেন্ট কিউতে থাকা বিপজ্জনক ও বিভ্রান্তিকর।
  //     (API ও আলাদাভাবে এদের উপর অ্যাকশন আটকায় — দ্বিস্তর সুরক্ষা।)
  //     ইচ্ছা করলে ফিল্টার দিয়ে দেখা যাবে।
  const baseWhere = status ? { status } : { status: { not: 'AWAITING_PAYMENT' as const } };

  // ★★★ ফুলফিলমেন্ট গ্রুপিং (3.12)
  //     ১৫টা অর্ডার এলোমেলোভাবে করলে অ্যাডমিন প্রতিবার গেমে ঢুকে
  //     ভিন্ন প্যাকেজ খোঁজে। একই ভ্যারিয়েন্টের কটা বাকি তা এক নজরে
  //     দেখলে একই কাজ পরপর করা যায় — হাতের কাজ কমে, ভুলও কমে।
  //
  //     ⚠️ গণনা groupBy দিয়ে — প্রতি গ্রুপে আলাদা কোয়েরি করলে
  //     প্রোডাক্ট বাড়ার সাথে N+1 হতো।
  const [rows, groupCounts] = await Promise.all([
    prisma.order.findMany({
      where: variantFilter ? { ...baseWhere, variantId: variantFilter } : baseWhere,
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 100,
      include: { user: { select: { name: true, phone: true } } },
    }),
    // ★ চিপগুলো সবসময় **অসম্পূর্ণ** অর্ডারের ভিত্তিতে — ফিল্টার
    //   করা থাকলেও চিপ বদলায় না, নইলে ফিল্টার করার পর অন্য
    //   গ্রুপগুলো উধাও হয়ে ফিরে যাওয়ার পথ বন্ধ হয়ে যেত
    prisma.order.groupBy({
      by: ['variantId', 'productName', 'variantName'],
      where: { status: { in: ['PENDING', 'PROCESSING'] } },
      _count: { _all: true },
    }),
  ]);

  const groups = groupCounts
    .map((g) => ({
      variantId: g.variantId,
      productName: g.productName,
      variantName: g.variantName,
      count: g._count._all,
    }))
    .sort((a, b) => b.count - a.count);

  // ★★★ সময় পেরিয়ে যাওয়া অর্ডার আগে (3.9)
  //     সতর্কতা শুধু দেখালেই হয় না — যেটার সময় শেষ, সেটি চোখের
  //     সামনে থাকা চাই। ভঙ্গ → ঘনিয়ে আসা → বাকিরা; একই স্তরের
  //     ভেতরে সার্ভারের ক্রম অপরিবর্তিত।
  const RANK: Record<string, number> = { breached: 0, soon: 1, ok: 2 };
  const orders = rows
    .map((o) => ({ o, b: breachInfo(o) }))
    .sort((x, y) => RANK[x.b.level] - RANK[y.b.level])
    .map(({ o }) => o);

  const { breached, soon } = countBreaches(rows);

  return (
    <div className="space-y-5">
      <h1 className="lux-text text-2xl font-medium sm:text-[27px]">অর্ডার ম্যানেজমেন্ট</h1>

      {/* ★★★ SLA সতর্কতা (3.9) — সংখ্যা থাকলেই দেখা যায়।
              শূন্য হলে কিছুই দেখানো হয় না: "০ টি দেরি" প্রতিদিন
              দেখতে দেখতে চোখ সয়ে যায়, তখন আসল সতর্কতাও চোখে পড়ে না। */}
      {(breached > 0 || soon > 0) && (
        <div
          className="flex flex-wrap items-center gap-3 rounded-xl border p-3.5"
          style={{
            borderColor: breached > 0 ? 'rgba(224,120,120,.35)' : 'var(--hair)',
            background: breached > 0 ? 'rgba(224,120,120,.08)' : 'rgba(230,197,132,.06)',
          }}
        >
          <span className="text-lg">{breached > 0 ? '🚨' : '⏰'}</span>
          <div className="text-sm">
            {breached > 0 && (
              <div className="font-bold" style={{ color: '#e07878' }}>
                {breached} টি অর্ডারের সময় পেরিয়ে গেছে — এখনই দেখুন
              </div>
            )}
            {soon > 0 && (
              <div style={{ color: 'var(--mut)' }}>
                {soon} টির সময় ঘনিয়ে এসেছে ({SLA_WARN_MIN} মিনিটের কম বাকি)
              </div>
            )}
          </div>
        </div>
      )}
      {/* ★★★ প্রোডাক্ট গ্রুপ (3.12) — একাধিক গ্রুপ থাকলেই কেবল।
              একটাই গ্রুপ হলে চিপ দেখানো অর্থহীন, শুধু জায়গা নষ্ট। */}
      {groups.length > 1 && (
        <div className="space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--mut)' }}>
            একই প্যাকেজ একসাথে করুন
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href={status ? `/admin/orders?status=${status}` : '/admin/orders'}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold transition"
              style={
                variantFilter
                  ? { background: 'var(--v-void)', color: 'var(--mut)' }
                  : { background: 'var(--gold)', color: '#1a1408' }
              }
            >
              সব ({groups.reduce((s, g) => s + g.count, 0)})
            </Link>
            {groups.map((g) => {
              const qs = new URLSearchParams();
              if (status) qs.set('status', status);
              qs.set('variant', String(g.variantId));
              const active = variantFilter === g.variantId;
              return (
                <Link
                  key={g.variantId}
                  href={`/admin/orders?${qs.toString()}`}
                  className="rounded-lg px-3 py-1.5 text-xs font-semibold transition"
                  style={
                    active
                      ? { background: 'var(--gold)', color: '#1a1408' }
                      : { background: 'var(--v-void)', color: 'var(--ink)' }
                  }
                >
                  {g.variantName} <span className="opacity-70">×{g.count}</span>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      <OrderTable
        current={status ?? 'ALL'}
        orders={orders.map((o: (typeof orders)[number]) => ({
          id: o.id,
          orderNo: o.orderNo,
          productName: o.productName,
          variantName: o.variantName,
          playerUid: o.playerUid,
          playerName: o.playerName,
          discount: Number(o.discount),
          price: Number(o.price),
          status: o.status,
          adminNote: o.adminNote,
          internalNote: o.internalNote,
          createdAt: o.createdAt.toISOString(),
          user: o.user,
          // ★ সার্ভারেই হিসাব — মেয়াদ ফুরানো claim ক্লায়েন্টের ঘড়ির
          //   উপর নির্ভর করে না (3.7)
          claim: claimState(o, admin.id),
          refundedAmount: Number(o.refundedAmount), // ★ 3.14
          // ★ SLA ভঙ্গ — সার্ভারে হিসাব, কোনো ক্যাশড ফ্ল্যাগ নয় (3.9)
          breach: breachInfo(o),
        }))}
      />
    </div>
  );
}
