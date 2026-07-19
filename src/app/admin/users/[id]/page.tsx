import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { bdt } from '@/lib/money';
import { fmtDate } from '@/lib/date';
import Badge from '@/components/Badge';
import CustomerActions from '@/components/admin/CustomerActions';
import CustomerTimeline from '@/components/admin/CustomerTimeline';
import { buildTimeline } from '@/lib/customerTimeline';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'কাস্টমার বিস্তারিত' };

export default async function CustomerDetail({ params }: { params: { id: string } }) {
  const user = await prisma.user.findUnique({
    where: { id: params.id },
    // ★ password hash ইচ্ছাকৃতভাবে বাদ — কখনো এই পেজে আসবে না
    select: {
      id: true, name: true, email: true, phone: true, role: true,
      balance: true, isBanned: true, status: true, referralCode: true, createdAt: true,
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
  const spent = user.orders
    .filter((o: (typeof user.orders)[number]) => o.status === 'COMPLETED')
    .reduce((n: number, o: (typeof user.orders)[number]) => n + Number(o.price), 0);
  const recharged = user.deposits
    .filter((d: (typeof user.deposits)[number]) => d.status === 'APPROVED')
    .reduce((n: number, d: (typeof user.deposits)[number]) => n + Number(d.amount), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm">
        <Link href="/admin/users" className="text-slate-400 hover:text-white">← ইউজার তালিকা</Link>
      </div>

      {/* ── হেডার ── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="grid h-14 w-14 place-items-center rounded-2xl text-xl font-bold text-white"
            style={{ background: 'linear-gradient(135deg,#5b4fe0,#9a8cf7)', boxShadow: '0 0 24px rgba(154,140,247,.45)' }}>
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

      {/* ── স্ট্যাট কার্ড ── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { l: 'বর্তমান ব্যালেন্স', v: bdt(user.balance), c: '#a7dbff' },
          { l: 'মোট খরচ', v: bdt(spent), c: '#e6c584' },
          { l: 'মোট রিচার্জ', v: bdt(recharged), c: '#7fe0bb' },
          { l: 'মোট অর্ডার', v: String(user._count.orders), c: '#e6c584' },
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
            <table className="tbl">
              <thead><tr><th>অর্ডার</th><th>প্রোডাক্ট</th><th>UID</th><th className="text-right">মূল্য</th><th>স্ট্যাটাস</th><th>তারিখ</th></tr></thead>
              <tbody>
                {user.orders.map((o: (typeof user.orders)[number]) => (
                  <tr key={o.id}>
                    <td className="font-mono font-semibold text-rose-600">#{o.orderNo}</td>
                    <td><div className="text-sm text-slate-900">{o.productName}</div><div className="text-xs text-slate-400">{o.variantName}</div></td>
                    <td className="font-mono text-xs text-slate-400">{o.playerUid}</td>
                    <td className="text-right font-semibold text-slate-900">{bdt(o.price)}</td>
                    <td><Badge status={o.status} /></td>
                    <td className="whitespace-nowrap text-xs text-slate-400">{fmtDate(o.createdAt.toISOString())}</td>
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
            <table className="tbl">
              <thead><tr><th>রিচার্জ</th><th>মেথড</th><th className="text-right">পরিমাণ</th><th>TrxID</th><th>স্ট্যাটাস</th><th>তারিখ</th></tr></thead>
              <tbody>
                {user.deposits.map((d: (typeof user.deposits)[number]) => (
                  <tr key={d.id}>
                    <td className="font-mono font-semibold text-rose-600">#{d.depositNo}</td>
                    <td className="text-sm text-slate-900">{d.method}</td>
                    <td className="text-right font-semibold text-emerald-600">{bdt(d.amount)}</td>
                    <td className="font-mono text-xs text-slate-400">{d.trxId}</td>
                    <td><Badge status={d.status} /></td>
                    <td className="whitespace-nowrap text-xs text-slate-400">{fmtDate(d.createdAt.toISOString())}</td>
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
            <table className="tbl">
              <thead><tr><th>ধরন</th><th className="text-right">পরিমাণ</th><th className="text-right">ব্যালেন্স</th><th>নোট</th><th>তারিখ</th></tr></thead>
              <tbody>
                {user.ledger.map((l: (typeof user.ledger)[number]) => (
                  <tr key={l.id}>
                    <td className="text-xs font-semibold text-slate-900">{l.type}</td>
                    <td className={`text-right font-semibold ${Number(l.amount) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {Number(l.amount) >= 0 ? '+' : ''}{bdt(l.amount)}
                    </td>
                    <td className="text-right text-slate-400">{bdt(l.balanceAfter)}</td>
                    <td className="max-w-[220px] text-xs text-slate-400">{l.note || '—'}</td>
                    <td className="whitespace-nowrap text-xs text-slate-400">{fmtDate(l.createdAt.toISOString())}</td>
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
