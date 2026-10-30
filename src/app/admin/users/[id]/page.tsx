import AnonymizeAccount from '@/components/admin/AnonymizeAccount';
import { deletionBlockers } from '@/lib/services/accountDeletion';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { bdt } from '@/lib/money';
import { fmtDate } from '@/lib/date';
import Badge from '@/components/Badge';
import CustomerActions from '@/components/admin/CustomerActions';
import CustomerTimeline from '@/components/admin/CustomerTimeline';
import ResellerPanel from '@/components/admin/ResellerPanel';
import { buildTimeline } from '@/lib/customerTimeline';
import { requireAdminPage } from '@/lib/pageGuard';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'কাস্টমার বিস্তারিত' };

export default async function CustomerDetail({ params }: { params: { id: string } }) {
  // ★ SEC-01 — পাতার নিজস্ব DB-গার্ড (সফট-নেভিগেশনে লেআউট চলে না)
  await requireAdminPage();
  const user = await prisma.user.findUnique({
    where: { id: params.id },
    // ★ password hash ইচ্ছাকৃতভাবে বাদ — কখনো এই পেজে আসবে না
    select: {
      id: true, name: true, email: true, phone: true, role: true,
      balance: true, isBanned: true, status: true, referralCode: true, createdAt: true,
      deletionRequestedAt: true, deletionReason: true,
      // ★ Group F — রিসেলার স্তর ও তার API কী।
      //   ⚠️ `hash` ইচ্ছাকৃতভাবে বাদ: এটি ক্লায়েন্ট কম্পোনেন্টে props
      //   হিসেবে যাবে, অর্থাৎ RSC পে-লোডে সিরিয়ালাইজ হয়ে ব্রাউজারে
      //   পৌঁছাত (Group E-তে ঠিক এই পথেই গেটওয়ে-কী ফাঁস হচ্ছিল)।
      tier: true,
      apiKeys: {
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, label: true, prefix: true, createdAt: true,
          lastUsedAt: true, revokedAt: true, createdByName: true,
        },
      },
      referredBy: { select: { name: true, referralCode: true } },
      _count: { select: { orders: true, deposits: true, referrals: true } },
      orders: { orderBy: { createdAt: 'desc' }, take: 25 },
      deposits: { orderBy: { createdAt: 'desc' }, take: 25 },
      ledger: { orderBy: { createdAt: 'desc' }, take: 40 },
    },
  });

  if (!user) notFound();

  // ★ এই গ্রাহকের উপর নেওয়া অ্যাডমিন পদক্ষেপ (3.13) — ব্যান,
  //   ব্যালেন্স সমন্বয় ইত্যাদি টাইমলাইনে মেশাতে
  const adminActions = await prisma.adminLog.findMany({
    where: { targetId: params.id },
    orderBy: { createdAt: 'desc' },
    take: 25,
    select: { action: true, adminName: true, detail: true, createdAt: true },
  });

  const timeline = buildTimeline({
    createdAt: user.createdAt,
    deposits: user.deposits,
    orders: user.orders,
    ledger: user.ledger,
    adminActions,
  });

  const isAdmin = user.role === 'ADMIN';
  /**
   * ★★★ COR-01 — "মোট খরচ" / "মোট রিচার্জ" **সম্পূর্ণ ইতিহাস** থেকে।
   *   আগে যোগ হতো কেবল উপরের `take: 25`-এর অর্ডার/ডিপোজিট থেকে, আর আংশিক
   *   রিফান্ড (`refundedAmount`) বাদ পড়ত না — ৮০ অর্ডারের গ্রাহকে অ্যাডমিন শেষ
   *   ২৫টির যোগফল দেখতেন, বিরোধ/জালিয়াতির সিদ্ধান্ত ভুল অঙ্কে। এখন DB-র
   *   aggregate: খরচ = সম্পন্ন অর্ডারের দাম − তাদের রিফান্ড; রিচার্জ = অনুমোদিত
   *   ডিপোজিট। হিসাব Decimal-এ (JS number নয় — CLAUDE.md §1)।
   */
  const [spentAgg, rechargeAgg] = await Promise.all([
    prisma.order.aggregate({
      where: { userId: user.id, status: 'COMPLETED' },
      _sum: { price: true, refundedAmount: true },
    }),
    prisma.deposit.aggregate({
      where: { userId: user.id, status: 'APPROVED' },
      _sum: { amount: true },
    }),
  ]);
  const zero = new Prisma.Decimal(0);
  const spent = (spentAgg._sum.price ?? zero).minus(spentAgg._sum.refundedAmount ?? zero);
  const recharged = rechargeAgg._sum.amount ?? zero;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm">
        {/* ★ `min-h-[40px]` — মাপা ২০px (২০২৬-০৮-২৬)। `inline-flex`
            ছাড়া min-height একটি inline `<a>` তে কাজ করে না। */}
        <Link href="/admin/users" className="inline-flex min-h-[40px] items-center text-slate-400 hover:text-white">← ইউজার তালিকা</Link>
      </div>

      {/* ── হেডার ── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="grid h-14 w-14 place-items-center rounded-2xl text-xl font-bold text-white"
            style={{ background: 'linear-gradient(135deg,#3d1f8c,var(--violet))', boxShadow: '0 0 24px rgba(167,139,255,.4)' }}>
            {user.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="lux-text text-2xl font-medium sm:text-[27px]">{user.name}</h1>
              {isAdmin && <span className="badge bg-purple-100 text-purple-700">ADMIN</span>}
              {user.status === 'ACTIVE'
                ? <span className="badge border border-emerald-200 bg-emerald-100 text-emerald-700">সক্রিয়</span>
                : user.status === 'SUSPENDED'
                ? <span className="badge border border-amber-200 bg-amber-100 text-amber-700">সাময়িক স্থগিত</span>
                : <span className="badge border border-red-200 bg-red-100 text-red-700">স্থায়ীভাবে বন্ধ</span>}
            </div>
            <p className="break-all text-sm text-slate-400">{user.email} · {user.phone}</p>
          </div>
        </div>
        <CustomerActions userId={user.id} name={user.name} balance={Number(user.balance)} isAdmin={isAdmin} status={user.status} />
      </div>

      {user.deletionRequestedAt && user.status !== 'BLOCKED' && (
        <AnonymizeAccount
          userId={user.id}
          requestedAt={user.deletionRequestedAt.toISOString()}
          reason={user.deletionReason}
          blockers={await deletionBlockers(user.id)}
        />
      )}

      {/* ── স্ট্যাট কার্ড ── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { l: 'বর্তমান ব্যালেন্স', v: bdt(user.balance), c: 'var(--v-ice)' },
          { l: 'মোট খরচ', v: bdt(spent), c: 'var(--v-mut)' },
          { l: 'মোট রিচার্জ', v: bdt(recharged), c: 'var(--v-volt)' },
          { l: 'মোট অর্ডার', v: String(user._count.orders), c: 'var(--v-ink)' },
        ].map((s) => (
          <div key={s.l} className="card p-4">
            <p className="text-xs text-slate-400">{s.l}</p>
            <p className="mt-1 text-xl font-bold" style={{ color: s.c }}>{s.v}</p>
          </div>
        ))}
      </div>

      {/* ── প্রোফাইল তথ্য ── */}
      <div className="card p-5">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-400">প্রোফাইল</h2>
        <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div><dt className="text-slate-400">রেফারেল কোড</dt><dd className="break-all font-mono text-slate-900">{user.referralCode}</dd></div>
          <div><dt className="text-slate-400">রেফার করেছেন</dt><dd className="text-slate-900">{user.referredBy ? `${user.referredBy.name} (${user.referredBy.referralCode})` : '—'}</dd></div>
          <div><dt className="text-slate-400">যাকে রেফার করেছে</dt><dd className="text-slate-900">{user._count.referrals} জন</dd></div>
          <div><dt className="text-slate-400">যোগদান</dt><dd className="text-slate-900">{fmtDate(user.createdAt.toISOString())}</dd></div>
          <div><dt className="text-slate-400">মোট ডিপোজিট</dt><dd className="text-slate-900">{user._count.deposits} টি</dd></div>
        </dl>
      </div>

      {/* ── রিসেলার স্তর ও API কী (Group F) ──
              ⚠️ অ্যাডমিনের নিজের অ্যাকাউন্টে দেখানো হয় না: অ্যাডমিন
              ইতিমধ্যেই সব পারেন, তাঁকে রিসেলার বানানোর কোনো অর্থ নেই। */}
      {!isAdmin && (
        <ResellerPanel
          userId={user.id}
          name={user.name}
          tier={user.tier}
          keys={user.apiKeys.map((k: (typeof user.apiKeys)[number]) => ({
            id: k.id,
            label: k.label,
            prefix: k.prefix,
            createdAt: k.createdAt.toISOString(),
            lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
            revokedAt: k.revokedAt?.toISOString() ?? null,
            createdByName: k.createdByName,
          }))}
        />
      )}

      {/* ★★★ ৩৬০ টাইমলাইন (3.13) — সব ঘটনা এক ক্রমে।
              নিচের বিস্তারিত তালিকাগুলো **রাখা হয়েছে**: টাইমলাইন
              বলে "কখন কী হলো", তালিকা দেয় পুরো বিবরণ (§18)। */}
      <section>
        <h2 className="mb-3 text-lg font-bold text-slate-900">পূর্ণ কার্যকলাপ (সময়ক্রম)</h2>
        <div className="card p-5">
          <CustomerTimeline events={timeline} />
        </div>
      </section>

      {/* ── অর্ডার ইতিহাস ── */}
      <section>
        <h2 className="mb-3 text-lg font-bold text-slate-900">অর্ডার ইতিহাস ({user._count.orders})</h2>
        {user.orders.length === 0 ? (
          <p className="card p-6 text-center text-slate-400">কোনো অর্ডার নেই</p>
        ) : (
          <div className="table-wrap">
            <table className="tbl tbl--stack">
              <thead><tr><th>অর্ডার</th><th>প্রোডাক্ট</th><th>UID</th><th className="num">মূল্য</th><th>স্ট্যাটাস</th><th>তারিখ</th></tr></thead>
              <tbody>
                {user.orders.map((o: (typeof user.orders)[number]) => (
                  <tr key={o.id}>
                    <td data-label="অর্ডার" className="font-mono font-semibold text-rose-600">#{o.orderNo}</td>
                    {/* ★ ফোনে মান-অংশটি লেবেলের ডানে বসে, তাই দুই লাইনের
                        প্রোডাক্ট-নামটি ডানে সারিবদ্ধ হওয়াই স্বাভাবিক দেখায় */}
                    <td data-label="প্রোডাক্ট"><div className="text-sm text-slate-900 max-md:text-right">{o.productName}</div><div className="text-xs text-slate-400 max-md:text-right">{o.variantName}</div></td>
                    <td data-label="UID" className="font-mono text-xs text-slate-400">{o.playerUid}</td>
                    <td data-label="মূল্য" className="num font-semibold text-slate-900">{bdt(o.price)}</td>
                    <td data-label="স্ট্যাটাস"><Badge status={o.status} /></td>
                    <td data-label="তারিখ" className="whitespace-nowrap text-xs text-slate-400">{fmtDate(o.createdAt.toISOString())}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── রিচার্জ ইতিহাস ── */}
      <section>
        <h2 className="mb-3 text-lg font-bold text-slate-900">রিচার্জ ইতিহাস ({user._count.deposits})</h2>
        {user.deposits.length === 0 ? (
          <p className="card p-6 text-center text-slate-400">কোনো রিচার্জ নেই</p>
        ) : (
          <div className="table-wrap">
            <table className="tbl tbl--stack">
              <thead><tr><th>রিচার্জ</th><th>মেথড</th><th className="num">পরিমাণ</th><th>TrxID</th><th>স্ট্যাটাস</th><th>তারিখ</th></tr></thead>
              <tbody>
                {user.deposits.map((d: (typeof user.deposits)[number]) => (
                  <tr key={d.id}>
                    <td data-label="রিচার্জ" className="font-mono font-semibold text-rose-600">#{d.depositNo}</td>
                    <td data-label="মেথড" className="text-sm text-slate-900">{d.method}</td>
                    <td data-label="পরিমাণ" className="num font-semibold text-emerald-600">{bdt(d.amount)}</td>
                    {/* ⚠️ `break-all` — TrxID-তে ফাঁকা জায়গা নেই, আর ফোনে
                        লেবেলের পর অবশিষ্ট প্রস্থ ছোট; নাহলে কার্ডের বাইরে
                        বেরিয়ে যেত */}
                    <td data-label="TrxID" className="break-all font-mono text-xs text-slate-400">{d.trxId}</td>
                    <td data-label="স্ট্যাটাস"><Badge status={d.status} /></td>
                    <td data-label="তারিখ" className="whitespace-nowrap text-xs text-slate-400">{fmtDate(d.createdAt.toISOString())}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── লেনদেন (ledger) ── */}
      <section>
        <h2 className="mb-3 text-lg font-bold text-slate-900">লেনদেন খতিয়ান</h2>
        {user.ledger.length === 0 ? (
          <p className="card p-6 text-center text-slate-400">কোনো লেনদেন নেই</p>
        ) : (
          <div className="table-wrap">
            <table className="tbl tbl--stack">
              <thead><tr><th>ধরন</th><th className="num">পরিমাণ</th><th className="num">ব্যালেন্স</th><th>নোট</th><th>তারিখ</th></tr></thead>
              <tbody>
                {user.ledger.map((l: (typeof user.ledger)[number]) => (
                  <tr key={l.id}>
                    <td data-label="ধরন" className="text-xs font-semibold text-slate-900">{l.type}</td>
                    <td data-label="পরিমাণ" className={`num font-semibold ${Number(l.amount) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {Number(l.amount) >= 0 ? '+' : ''}{bdt(l.amount)}
                    </td>
                    <td data-label="ব্যালেন্স" className="num text-slate-400">{bdt(l.balanceAfter)}</td>
                    <td data-label="নোট" className="text-xs text-slate-400 md:max-w-[220px]">{l.note || '—'}</td>
                    <td data-label="তারিখ" className="whitespace-nowrap text-xs text-slate-400">{fmtDate(l.createdAt.toISOString())}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
