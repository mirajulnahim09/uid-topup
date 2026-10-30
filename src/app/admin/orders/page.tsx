import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import OrderTable from '@/components/admin/OrderTable';
import { requireAdminPage } from '@/lib/pageGuard';
import { claimState } from '@/lib/orderClaim';
import { breachInfo, SLA_WARN_MIN } from '@/lib/slaBreach';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'অর্ডার' };

const VALID = [
  'AWAITING_PAYMENT', 'PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'REFUNDED',
] as const;
type S = (typeof VALID)[number];

export default async function AdminOrders({
  searchParams,
}: {
  searchParams: { status?: string; variant?: string; order?: string };
}) {
  // ★ claim "আমার না অন্যের" — এটি বলতে হলে কে দেখছে জানা দরকার (3.7)
  // ★ SEC-01 — পাতার গার্ড: API-র `requireAdmin()` ব্যর্থতায় ApiError ছুড়ত
  //   (ত্রুটি-পর্দা); এটি একই DB-যাচাই (role + ban + epoch) করে লগইনে পাঠায়
  const admin = await requireAdminPage();

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
  const vWhere = variantFilter ? { variantId: variantFilter } : {};

  /**
   * ★★★ কাজের কিউতে **পুরনোটা আগে** — ডিপোজিট-কিউর মতোই।
   *
   *   ⚠️ আগে ক্রম ছিল `status asc, createdAt desc`, `take: 100`। সিমুলেশনে
   *   মাপা (২০২৬-০৯-২৫, ১০k গ্রাহক, দিনশেষে ~৫ হাজার খোলা অর্ডার): তালিকায়
   *   আসত কেবল **সবচেয়ে নতুন ১০০টি** — যে গ্রাহক সবচেয়ে বেশি সময় অপেক্ষা
   *   করছেন (SLA পেরোনো) তাঁর অর্ডার কখনো পর্দায় উঠত না, আর SLA-ব্যানার
   *   গুনত কেবল ওই ১০০টির মধ্যে। অ্যাডমিন নতুনগুলো সারতে থাকলে পুরনোগুলো
   *   চিরকাল পড়ে থাকত।
   *
   *   এখন: PENDING/PROCESSING ও ডিফল্ট তালিকায় খোলা অর্ডার পুরনো-আগে;
   *   ডিফল্টে জায়গা বাঁচলে বাকিটা সাম্প্রতিক সম্পন্ন/বাতিল দিয়ে ভরা। ইতিহাস-
   *   ফিল্টারে (COMPLETED ইত্যাদি) আগের মতোই নতুন-আগে।
   */
  const OPEN = ['PENDING', 'PROCESSING'] as const;
  const include = { user: { select: { name: true, phone: true } } } as const;
  /**
   * ★ একটি নির্দিষ্ট অর্ডার (`?order=<id>`) — অ্যাডমিন-সার্চ থেকে আসে।
   *   ⚠️ মাপা (REAL-USER অডিট, ২০২৬-০৯-২৫): ৫,০০০+ খোলা অর্ডারে নতুন অর্ডারটি
   *   পুরনো-আগে কিউর প্রথম ১০০-তে থাকে না, আর সার্চের ফল নিয়ে যেত গ্রাহকের পাতায়
   *   (সেখানে অর্ডারে কোনো বোতাম নেই)। ফলে অভিযোগ-করা গ্রাহকের অর্ডার সম্পন্ন/বাতিল
   *   করার পথই ছিল না। এখন একই টেবিলে কেবল সেই অর্ডার, সব অ্যাকশনসহ।
   */
  const onlyOrder = typeof searchParams.order === 'string' && /^[a-z0-9]{8,40}$/i.test(searchParams.order)
    ? searchParams.order : null;

  const loadRows = async () => {
    if (onlyOrder) {
      return prisma.order.findMany({ where: { id: onlyOrder }, include });
    }
    if (status === 'PENDING' || status === 'PROCESSING') {
      return prisma.order.findMany({ where: { status, ...vWhere }, orderBy: { createdAt: 'asc' }, take: 100, include });
    }
    if (status) {
      return prisma.order.findMany({ where: { status, ...vWhere }, orderBy: { createdAt: 'desc' }, take: 100, include });
    }
    const open = await prisma.order.findMany({
      where: { status: { in: [...OPEN] }, ...vWhere }, orderBy: { createdAt: 'asc' }, take: 100, include,
    });
    if (open.length >= 100) return open;
    const rest = await prisma.order.findMany({
      where: { status: { notIn: [...OPEN, 'AWAITING_PAYMENT'] }, ...vWhere },
      orderBy: { createdAt: 'desc' }, take: 100 - open.length, include,
    });
    return [...open, ...rest];
  };

  // ★ SLA-গণনা **ডাটাবেস থেকে, সব খোলা অর্ডারে** — পাতার ১০০টিতে নয়
  const now = new Date();
  const soonAt = new Date(now.getTime() + SLA_WARN_MIN * 60_000);

  // ★★★ ফুলফিলমেন্ট গ্রুপিং (3.12)
  //     ১৫টা অর্ডার এলোমেলোভাবে করলে অ্যাডমিন প্রতিবার গেমে ঢুকে
  //     ভিন্ন প্যাকেজ খোঁজে। একই ভ্যারিয়েন্টের কটা বাকি তা এক নজরে
  //     দেখলে একই কাজ পরপর করা যায় — হাতের কাজ কমে, ভুলও কমে।
  //
  //     ⚠️ গণনা groupBy দিয়ে — প্রতি গ্রুপে আলাদা কোয়েরি করলে
  //     প্রোডাক্ট বাড়ার সাথে N+1 হতো।
  const [rows, groupCounts, total, breached, soon] = await Promise.all([
    loadRows(),
    // ★ চিপগুলো সবসময় **অসম্পূর্ণ** অর্ডারের ভিত্তিতে — ফিল্টার
    //   করা থাকলেও চিপ বদলায় না, নইলে ফিল্টার করার পর অন্য
    //   গ্রুপগুলো উধাও হয়ে ফিরে যাওয়ার পথ বন্ধ হয়ে যেত
    prisma.order.groupBy({
      by: ['variantId', 'productName', 'variantName'],
      where: { status: { in: ['PENDING', 'PROCESSING'] } },
      _count: { _all: true },
    }),
    prisma.order.count({ where: { ...baseWhere, ...vWhere } }),
    prisma.order.count({ where: { status: { in: [...OPEN] }, slaDueAt: { lt: now } } }),
    prisma.order.count({ where: { status: { in: [...OPEN] }, slaDueAt: { gte: now, lte: soonAt } } }),
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

  // ★ সবচেয়ে বড় ৮টি গ্রুপ সামনে; বেছে নেওয়া গ্রুপটি সবসময় দৃশ্যমান
  const TOP = 8;
  const topGroups = groups.filter((g, i) => i < TOP || g.variantId === variantFilter);
  const restGroups = groups.filter((g, i) => i >= TOP && g.variantId !== variantFilter);
  const chip = (g: (typeof groups)[number]) => {
    const qs = new URLSearchParams();
    if (status) qs.set('status', status);
    qs.set('variant', String(g.variantId));
    const active = variantFilter === g.variantId;
    return (
      <Link
        key={g.variantId}
        href={`/admin/orders?${qs.toString()}`}
        className="inline-flex min-h-[40px] items-center rounded-lg px-3 text-xs font-semibold transition"
        style={
          active
            ? { background: 'var(--gold)', color: 'var(--gold-ink)' }
            : { background: 'var(--v-void)', color: 'var(--ink)' }
        }
      >
        {g.variantName} <span className="opacity-70">×{g.count}</span>
      </Link>
    );
  };

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
            // ★ ভঙ্গ শাখাটি আগে হার্ডকোড `rgba(224,120,120, α)` ছিল —
            //   থিম-অন্ধ, আর নিচের লেখাটিও (`#e07878`) আলাদা আরেকটি লাল।
            //   এখন তিনটিই `--sem-danger`, দুই থিমে আলাদা শেড।
            borderColor: breached > 0 ? 'color-mix(in srgb, var(--sem-danger) 35%, transparent)' : 'var(--hair)',
            // ★ শান্ত শাখাটি (কেবল `soon`, কিছু দেরি হয়নি) এখন নিরপেক্ষ
            //   `--v-steel` — আগে হার্ডকোড sand-gold ছিল, যা লাইট থিমে
            //   সাদা কার্ডের বিপরীতে ১.০৬:১, অর্থাৎ দেখাই যেত না। নিরপেক্ষ
            //   রাখলে 🚨 শাখাটির সাথে পার্থক্যও স্পষ্ট থাকে।
            background: breached > 0 ? 'color-mix(in srgb, var(--sem-danger) 8%, transparent)' : 'var(--v-steel)',
          }}
        >
          <span className="text-lg">{breached > 0 ? '🚨' : '⏰'}</span>
          <div className="text-sm">
            {breached > 0 && (
              <div className="font-bold" style={{ color: 'var(--sem-danger)' }}>
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
              className="inline-flex min-h-[40px] items-center rounded-lg px-3 text-xs font-semibold transition"
              style={
                variantFilter
                  ? { background: 'var(--v-void)', color: 'var(--mut)' }
                  : { background: 'var(--gold)', color: 'var(--gold-ink)' }
              }
            >
              সব ({groups.reduce((s, g) => s + g.count, 0)})
            </Link>
            {topGroups.map(chip)}
          </div>
          {/* ★ বাকি চিপ ভাঁজ করা — সিমুলেশনে (৪,৫৪৩ খোলা অর্ডার) ৪০টি চিপ ৩৯০px-এ
                পুরো প্রথম পর্দা নিত, অর্ডার-তালিকা দেখাই যেত না। JS ছাড়াই `<details>`। */}
          {restGroups.length > 0 && (
            <details className="group">
              <summary className="inline-flex min-h-[40px] cursor-pointer items-center rounded-lg px-3 text-xs font-semibold"
                style={{ background: 'var(--v-void)', color: 'var(--mut)' }}>
                আরও {restGroups.length}টি প্যাকেজ
              </summary>
              <div className="mt-2 flex flex-wrap gap-2">{restGroups.map(chip)}</div>
            </details>
          )}
        </div>
      )}

      {/* ★ তালিকা সীমিত হলে সেটি **বলা** — নাহলে অ্যাডমিন ধরে নেন সব দেখছেন */}
      {onlyOrder && (
        <p className="text-sm" style={{ color: 'var(--mut)' }}>
          সার্চ থেকে একটি অর্ডার খোলা হয়েছে।{' '}
          <Link href="/admin/orders" className="font-semibold underline">সব অর্ডারে ফিরুন</Link>
        </p>
      )}

      {!onlyOrder && total > orders.length && (
        <p className="text-xs" style={{ color: 'var(--mut)' }}>
          মোট {total.toLocaleString('bn-BD')}টির মধ্যে {orders.length}টি দেখানো হচ্ছে
          {status && status !== 'PENDING' && status !== 'PROCESSING' ? ' — সাম্প্রতিকটা আগে' : ' — যেটি সবচেয়ে বেশি অপেক্ষা করছে সেটি আগে'}।
          নির্দিষ্ট অর্ডারের জন্য উপরের সার্চ (অর্ডার নং / UID) ব্যবহার করুন।
        </p>
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
