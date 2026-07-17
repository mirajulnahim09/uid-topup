import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { getSettings } from '@/lib/settings';
import { bdt } from '@/lib/money';
import QuickActions from '@/components/admin/QuickActions';
import SetupChecklist from '@/components/admin/SetupChecklist';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'ড্যাশবোর্ড' };

// seed এর ডিফল্ট — এগুলো থাকলে অ্যাডমিন এখনো বদলায়নি
const SEED_BKASH = '01700000001';
const SEED_NAGAD = '01700000002';
const SEED_SOCIAL = ['https://facebook.com', 'https://m.me', 'https://wa.me/8801700000000'];

export default async function AdminDashboard() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [
    pendingDeposits, pendingOrders, users, todayOrders, completedOrders,
    depositSum, revenue, walletSum, completedWithCost,
    payments, socials, bannerCount, productImgCount, settings,
  ] = await Promise.all([
    prisma.deposit.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      take: 5,
      include: { user: { select: { name: true, phone: true } } },
    }),
    prisma.order.findMany({
      where: { status: { in: ['PENDING', 'PROCESSING'] } },
      orderBy: { createdAt: 'asc' },
      take: 5,
      include: { user: { select: { name: true, phone: true } } },
    }),
    prisma.user.count({ where: { role: 'USER' } }),
    prisma.order.count({ where: { createdAt: { gte: today } } }),
    prisma.order.count({ where: { status: 'COMPLETED' } }),
    prisma.deposit.aggregate({ where: { status: 'APPROVED' }, _sum: { amount: true } }),
    prisma.order.aggregate({ where: { status: 'COMPLETED' }, _sum: { price: true } }),
    prisma.user.aggregate({ _sum: { balance: true } }),
    prisma.order.findMany({
      where: { status: 'COMPLETED' },
      select: { price: true, variant: { select: { costPrice: true } } },
    }),
    prisma.paymentChannel.findMany({ select: { accountNo: true } }),
    prisma.socialLink.findMany({ select: { url: true } }),
    prisma.banner.count({ where: { isActive: true } }),
    prisma.product.count({ where: { image: { not: null } } }),
    getSettings(),
  ]);

  const profit = completedWithCost.reduce(
    (sum: number, o: (typeof completedWithCost)[number]) =>
      sum + Number(o.price) - Number(o.variant.costPrice),
    0
  );

  // ── সেটআপ চেকলিস্ট ──
  const payChanged = payments.length > 0 && !payments.some(
    (p: (typeof payments)[number]) => p.accountNo === SEED_BKASH || p.accountNo === SEED_NAGAD
  );
  const socialChanged = socials.length > 0 && !socials.some(
    (s: (typeof socials)[number]) => SEED_SOCIAL.includes(s.url)
  );

  const checklist = [
    {
      done: payChanged,
      label: 'পেমেন্ট নাম্বার বদলান',
      href: '/admin/site',
      hint: 'এখনো ডিফল্ট নাম্বার (01700000001) আছে — নিজের bKash/Nagad নাম্বার বসান, নাহলে টাকা আপনার কাছে আসবে না!',
    },
    {
      done: bannerCount > 0,
      label: 'ব্যানার ছবি দিন',
      href: '/admin/banners',
      hint: 'হোমপেজের উপরে যে বড় ছবি দেখাবে — ছবি টেনে এনে ছেড়ে দিন',
    },
    {
      done: productImgCount > 0,
      label: 'প্রোডাক্টের ছবি দিন',
      href: '/admin/products',
      hint: 'প্রোডাক্টের ছবিতে ক্লিক করে নতুন ছবি আপলোড করুন',
    },
    {
      done: socialChanged,
      label: 'সোশ্যাল লিংক বদলান',
      href: '/admin/site',
      hint: 'আপনার Facebook / WhatsApp লিংক দিন — কাস্টমার যোগাযোগ করতে পারবে',
    },
    {
      done: Boolean(settings.support_phone && settings.support_phone !== '01700000000'),
      label: 'সাপোর্ট নাম্বার দিন',
      href: '/admin/site',
      hint: 'সমস্যা হলে কাস্টমার কোথায় ফোন করবে',
    },
  ];

  const stats = [
    { label: 'মোট ইউজার', value: users, color: 'text-blue-700' },
    { label: 'আজকের অর্ডার', value: todayOrders, color: 'text-purple-700' },
    { label: 'সম্পন্ন অর্ডার', value: completedOrders, color: 'text-emerald-700' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">অ্যাডমিন হোম</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          এখান থেকেই সব কাজ শেষ করতে পারবেন — অন্য পেজে যেতে হবে না।
        </p>
      </div>

      {/* ★ সেটআপ বাকি থাকলে সবার আগে দেখাবে */}
      <SetupChecklist items={checklist} />

      {/* ★ পেন্ডিং কাজ — সরাসরি এখান থেকেই approve/complete */}
      <QuickActions
        deposits={pendingDeposits.map((d: (typeof pendingDeposits)[number]) => ({
          id: d.id,
          depositNo: d.depositNo,
          method: d.method,
          amount: Number(d.amount),
          trxId: d.trxId,
          senderNo: d.senderNo,
          screenshot: d.screenshot,
          createdAt: d.createdAt.toISOString(),
          user: d.user,
        }))}
        orders={pendingOrders.map((o: (typeof pendingOrders)[number]) => ({
          id: o.id,
          orderNo: o.orderNo,
          productName: o.productName,
          variantName: o.variantName,
          playerUid: o.playerUid,
          playerName: o.playerName,
          price: Number(o.price),
          createdAt: o.createdAt.toISOString(),
          user: o.user,
        }))}
      />

      {/* ── হিসাব ── */}
      <section>
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">
          হিসাব
        </h2>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="card border-2 border-emerald-200 bg-emerald-50 p-5">
            <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">
              মোট টাকা এসেছে
            </p>
            <p className="mt-1 text-2xl font-extrabold text-emerald-700">
              {bdt(depositSum._sum.amount ?? 0)}
            </p>
          </div>

          <div className="card border-2 border-rose-200 bg-rose-50 p-5">
            <p className="text-xs font-bold uppercase tracking-wide text-rose-700">মোট বিক্রি</p>
            <p className="mt-1 text-2xl font-extrabold text-rose-700">
              {bdt(revenue._sum.price ?? 0)}
            </p>
          </div>

          <div className="card border-2 border-purple-200 bg-purple-50 p-5">
            <p className="text-xs font-bold uppercase tracking-wide text-purple-700">
              আনুমানিক লাভ
            </p>
            <p className="mt-1 text-2xl font-extrabold text-purple-700">{bdt(profit)}</p>
            <p className="mt-0.5 text-[10px] text-slate-500">বিক্রি − ক্রয়মূল্য</p>
          </div>

          <div className="card border-2 border-amber-200 bg-amber-50 p-5">
            <p className="text-xs font-bold uppercase tracking-wide text-amber-700">
              ইউজারদের ওয়ালেটে
            </p>
            <p className="mt-1 text-2xl font-extrabold text-amber-700">
              {bdt(walletSum._sum.balance ?? 0)}
            </p>
            <p className="mt-0.5 text-[10px] text-slate-500">এই টাকা আপনার দেনা</p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-4">
          {stats.map((s) => (
            <div key={s.label} className="card p-4 text-center">
              <p className={`text-2xl font-extrabold ${s.color}`}>{s.value}</p>
              <p className="mt-0.5 text-[11px] font-semibold text-slate-500">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── দ্রুত লিংক ── */}
      <section>
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">
          দ্রুত যান
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {[
            { href: '/admin/banners', icon: '🖼️', label: 'ব্যানার ছবি' },
            { href: '/admin/products', icon: '🏷️', label: 'দাম বদলান' },
            { href: '/admin/coupons', icon: '🎟️', label: 'কুপন' },
            { href: '/admin/users', icon: '👤', label: 'ইউজার' },
            { href: '/admin/site', icon: '⚙️', label: 'সেটিংস' },
          ].map((l) => (
            <Link
              key={l.href}
              href={l.href}
              prefetch
              className="card p-4 text-center transition hover:-translate-y-1 hover:border-purple-300 hover:shadow-md"
            >
              <p className="text-2xl" aria-hidden="true">{l.icon}</p>
              <p className="mt-1 text-xs font-bold text-slate-700">{l.label}</p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
