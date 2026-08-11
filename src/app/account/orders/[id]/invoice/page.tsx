import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { bdt, round2 } from '@/lib/money';
import { fmtDate } from '@/lib/date';
import { getSettings } from '@/lib/settings';
import InvoicePrintButton from '@/components/InvoicePrintButton';

/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ Group I (২) — চালান / রসিদ
 *
 *   `/account/orders/[id]/invoice`
 *
 *   ── কেন আলাদা পাতা, অর্ডার-বিস্তারিতই যথেষ্ট নয় কেন ──
 *   অর্ডার-বিস্তারিত একটি **অবস্থা** পাতা — টাইমলাইন, SLA কাউন্টডাউন,
 *   ডেলিভারি নিশ্চিতকরণ, রিভিউ। সেটি প্রিন্ট করলে যা কাগজে পড়ে তা
 *   চালান নয়, একটি স্ক্রিনশট। চালানে যা থাকতেই হয় — বিক্রেতার পরিচয়,
 *   চালান নং, ইস্যুর তারিখ, ক্রেতা, লাইন-আইটেম, মোট — তার কয়েকটি
 *   ওখানে নেই-ই।
 *
 *   ── কেন প্রকৃত PDF ফাইল নয় ──
 *   ⚠️ সৎ সীমাবদ্ধতা: এটি প্রিন্ট-অপ্টিমাইজড HTML; ব্রাউজারের
 *   "Save as PDF" দিয়ে গ্রাহক PDF পান। সার্ভার-সাইড PDF (pdfkit)
 *   বেছে নেওয়া হয়নি কারণ তাতে বাংলা গ্লিফের জন্য একটি সম্পূর্ণ
 *   OpenType ফন্ট বান্ডলে ঢোকাতে হতো ও যুক্তাক্ষরের shaping-এর উপর
 *   নির্ভর করতে হতো — প্রোডাক্টের নাম ও নোট বাংলায় লেখা, তাই ভুল
 *   রেন্ডার হলে সেটি চালানকে অপাঠ্য করত। ব্রাউজার এই কাজটি নিখুঁত
 *   করে, প্রতিটি ডিভাইসে।
 *
 *   ── টাকা ──
 *   ⚠️ প্রতিটি অঙ্ক `Order` সারির **snapshot** থেকে সরাসরি পড়া হয়
 *   (`subtotal`, `discount`, `price`, `refundedAmount`)। এখানে কোনো
 *   দাম নতুন করে **হিসাব করা হয় না** — ভ্যারিয়েন্টের দাম পরে বদলালেও
 *   পুরনো চালান অপরিবর্তিত থাকতে হবে। একমাত্র গণনা "নিট" (মোট −
 *   ফেরত), আর সেটিও `round2()` দিয়ে (CLAUDE.md §2.1)।
 * ═══════════════════════════════════════════════════════════
 */
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'চালান',
  // ★ চালানে ব্যক্তিগত তথ্য থাকে — সার্চ ইঞ্জিনে কখনো নয়
  robots: { index: false, follow: false },
};

/** ★ অবস্থার বাংলা নাম — চালানে ব্যাজ নয়, সাদামাটা লেখা */
const STATUS_BN: Record<string, string> = {
  PENDING: 'অপেক্ষমাণ',
  PROCESSING: 'প্রক্রিয়াধীন',
  COMPLETED: 'সম্পন্ন',
  REFUNDED: 'ফেরত দেওয়া হয়েছে',
  FAILED: 'সম্পন্ন হয়নি',
};

export default async function InvoicePage({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return null;

  const [order, settings, me] = await Promise.all([
    prisma.order.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        orderNo: true,
        userId: true,
        productName: true,
        variantName: true,
        playerUid: true,
        playerName: true,
        subtotal: true,
        discount: true,
        price: true,
        refundedAmount: true,
        status: true,
        createdAt: true,
        completedAt: true,
        coupon: { select: { code: true } },
      },
    }),
    getSettings(),
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { name: true, email: true },
    }),
  ]);

  // ★ শুধু নিজের চালান — অন্যের ID দিলে ৪০৪ (enumeration বন্ধ)
  if (!order || order.userId !== session.user.id) notFound();

  const refunded = Number(order.refundedAmount);
  // ★ একমাত্র গণনা, এবং round2() দিয়ে — বাকি সব snapshot
  const net = round2(Number(order.price) - refunded);

  const seller = {
    name: settings.site_name || 'SS UID TOPUP',
    email: settings.support_email || '',
    phone: settings.support_phone || '',
  };

  return (
    <div className="mx-auto max-w-3xl">
      {/* ── পর্দার নিয়ন্ত্রণ (কাগজে যায় না) ── */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link
          href={`/account/orders/${order.id}`}
          className="inline-flex items-center gap-1.5 text-sm font-semibold"
          style={{ color: 'var(--v-mut)' }}
        >
          ← অর্ডারে ফিরুন
        </Link>
        <InvoicePrintButton />
      </div>

      {/* ★★★ চালানের কাগজ। `invoice-sheet` এর প্রিন্ট-নিয়ম globals.css এ */}
      <article className="invoice-sheet card p-6 sm:p-8">
        {/* ── শিরোনাম: বিক্রেতা | চালান ── */}
        <header className="flex flex-wrap items-start justify-between gap-4 border-b pb-5" style={{ borderColor: 'var(--v-edge)' }}>
          <div className="min-w-0">
            <p className="dsp text-lg font-bold">{seller.name}</p>
            {seller.email && (
              <p className="mt-0.5 text-xs" style={{ color: 'var(--v-mut)' }}>{seller.email}</p>
            )}
            {seller.phone && (
              <p className="text-xs" style={{ color: 'var(--v-mut)' }}>{seller.phone}</p>
            )}
          </div>
          <div className="text-right">
            <p className="dsp text-xl font-bold tracking-wide">চালান</p>
            <p className="mt-1 font-mono text-sm font-semibold">#{order.orderNo}</p>
            <p className="mt-0.5 text-xs" style={{ color: 'var(--v-mut)' }}>
              {fmtDate(order.createdAt)}
            </p>
          </div>
        </header>

        {/* ── ক্রেতা ও অবস্থা ── */}
        <section className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--v-mut)' }}>
              ক্রেতা
            </p>
            <p className="mt-1 text-sm font-semibold">{me?.name || '—'}</p>
            {me?.email && <p className="text-sm" style={{ color: 'var(--v-mut)' }}>{me.email}</p>}
          </div>
          <div className="sm:text-right">
            <p className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--v-mut)' }}>
              অবস্থা
            </p>
            <p className="mt-1 text-sm font-semibold">{STATUS_BN[order.status] ?? order.status}</p>
            {order.completedAt && (
              <p className="text-xs" style={{ color: 'var(--v-mut)' }}>
                {fmtDate(order.completedAt)}
              </p>
            )}
          </div>
        </section>

        {/* ── লাইন-আইটেম ── */}
        <section className="mt-6 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--v-edge2)' }}>
                <th className="pb-2 text-left font-bold">বিবরণ</th>
                <th className="pb-2 text-right font-bold">পরিমাণ</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="py-3 align-top">
                  <p className="font-semibold">{order.productName}</p>
                  <p style={{ color: 'var(--v-mut)' }}>{order.variantName}</p>
                  <p className="mt-1 text-xs" style={{ color: 'var(--v-mut)' }}>
                    Player UID: <span className="font-mono">{order.playerUid}</span>
                    {order.playerName ? ` · ${order.playerName}` : ''}
                  </p>
                </td>
                <td className="py-3 text-right align-top font-semibold">{bdt(order.subtotal)}</td>
              </tr>
            </tbody>
          </table>
        </section>

        {/* ── হিসাব ── */}
        <section className="mt-2 flex justify-end">
          <dl className="w-full max-w-xs space-y-2 text-sm">
            <div className="flex justify-between">
              <dt style={{ color: 'var(--v-mut)' }}>উপমোট</dt>
              <dd>{bdt(order.subtotal)}</dd>
            </div>

            {Number(order.discount) > 0 && (
              <div className="flex justify-between">
                <dt style={{ color: 'var(--v-mut)' }}>
                  ছাড়{order.coupon ? ` (${order.coupon.code})` : ''}
                </dt>
                <dd>−{bdt(order.discount)}</dd>
              </div>
            )}

            <div
              className="flex justify-between pt-2 text-base font-bold"
              style={{ borderTop: '1px solid var(--v-edge2)' }}
            >
              <dt>মোট</dt>
              <dd>{bdt(order.price)}</dd>
            </div>

            {/* ★ ফেরত হয়ে থাকলে সেটি লুকানো যাবে না — চালান তখন
                মিথ্যা বলত। CLAUDE.md §2.1(৫): রেকর্ড মুছি না, উল্টো লিখি। */}
            {refunded > 0 && (
              <>
                <div className="flex justify-between">
                  <dt style={{ color: 'var(--v-mut)' }}>ফেরত দেওয়া হয়েছে</dt>
                  <dd>−{bdt(order.refundedAmount)}</dd>
                </div>
                <div
                  className="flex justify-between pt-2 font-bold"
                  style={{ borderTop: '1px solid var(--v-edge2)' }}
                >
                  <dt>নিট</dt>
                  <dd>{bdt(net)}</dd>
                </div>
              </>
            )}
          </dl>
        </section>

        {/* ── পাদটীকা ── */}
        <footer className="mt-8 border-t pt-4 text-xs leading-relaxed" style={{ borderColor: 'var(--v-edge)', color: 'var(--v-mut)' }}>
          <p>
            পেমেন্ট ওয়ালেট ব্যালেন্স থেকে কাটা হয়েছে। এটি কম্পিউটারে তৈরি চালান,
            স্বাক্ষরের প্রয়োজন নেই।
          </p>
          {seller.email && (
            <p className="mt-1">
              কোনো অসঙ্গতি থাকলে চালান নং <span className="font-mono">#{order.orderNo}</span>{' '}
              উল্লেখ করে {seller.email} এ জানান।
            </p>
          )}
        </footer>
      </article>
    </div>
  );
}
