import { prisma } from '@/lib/prisma';
import { bdt } from '@/lib/money';
import { fmtDate } from '@/lib/date';
import { buildAuditWhere } from '@/lib/auditFilter';
import { requireAdminPage } from '@/lib/pageGuard';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'অ্যাক্টিভিটি টাইমলাইন' };

const LABEL: Record<string, { text: string; cls: string }> = {
  LOGIN:            { text: '→ লগইন',          cls: 'bg-slate-100 text-slate-700' },
  LOGOUT:           { text: '← লগআউট',         cls: 'bg-slate-100 text-slate-600' },
  REGISTER:         { text: '＋ রেজিস্টার',     cls: 'bg-blue-100 text-blue-700' },
  DEPOSIT_CREATE:   { text: '↑ ডিপোজিট জমা',   cls: 'bg-blue-100 text-blue-700' },
  DEPOSIT_APPROVE:  { text: '✓ টাকা যোগ',      cls: 'bg-emerald-100 text-emerald-700' },
  DEPOSIT_REJECT:   { text: '✕ ডিপোজিট বাতিল', cls: 'bg-red-100 text-red-700' },
  ORDER_CREATE:     { text: '＋ অর্ডার',        cls: 'bg-blue-100 text-blue-700' },
  ORDER_COMPLETE:   { text: '✓ অর্ডার সম্পন্ন', cls: 'bg-emerald-100 text-emerald-700' },
  ORDER_REFUND:     { text: '↩ টাকা ফেরত',     cls: 'bg-purple-100 text-purple-700' },
  ORDER_PARTIAL_REFUND: { text: '↩ আংশিক ফেরত', cls: 'bg-purple-100 text-purple-700' },
  ORDER_PROCESSING: { text: '⏳ প্রসেসিং',      cls: 'bg-blue-100 text-blue-700' },
  BALANCE_ADJUST:   { text: '৳ ব্যালেন্স সমন্বয়', cls: 'bg-amber-100 text-amber-700' },
  USER_BAN:         { text: '⛔ ব্যান',          cls: 'bg-red-100 text-red-700' },
  USER_UNBAN:       { text: '↺ আনব্যান',        cls: 'bg-slate-100 text-slate-700' },
  PRICE_CHANGE:     { text: '🏷 দাম বদল',       cls: 'bg-blue-100 text-blue-700' },
  SETTINGS_CHANGE:  { text: '⚙ সেটিংস',        cls: 'bg-slate-100 text-slate-700' },
  MEDIA_UPLOAD:     { text: '🖼 মিডিয়া আপলোড',  cls: 'bg-blue-100 text-blue-700' },
  MEDIA_DELETE:     { text: '🗑 মিডিয়া মুছল',   cls: 'bg-red-100 text-red-700' },
  // ★ জরুরি রিকভারি — নিরাপত্তা-সংবেদনশীল, তাই আলাদা করে চোখে পড়ে
  ACCOUNT_RECOVERY_LINK: { text: '🔑 রিকভারি-লিংক', cls: 'bg-amber-100 text-amber-700' },
  PASSWORD_RESET:   { text: '🔑 পাসওয়ার্ড রিসেট', cls: 'bg-amber-100 text-amber-700' },
  PASSWORD_CHANGE:  { text: '🔑 পাসওয়ার্ড বদল', cls: 'bg-amber-100 text-amber-700' },
};

const ACTOR_LABEL: Record<string, string> = { ADMIN: 'অ্যাডমিন', CUSTOMER: 'গ্রাহক', SYSTEM: 'সিস্টেম' };

export default async function AdminLogs({
  searchParams,
}: {
  searchParams: { q?: string; actor?: string; action?: string; from?: string; to?: string };
}) {
  // ★ SEC-01 — পাতার নিজস্ব DB-গার্ড (সফট-নেভিগেশনে লেআউট চলে না)
  await requireAdminPage();
  const where = buildAuditWhere(searchParams);
  const logs = await prisma.adminLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: 300 });
  const qs = new URLSearchParams(Object.entries(searchParams).filter(([, v]) => v) as [string, string][]).toString();

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="lux-text text-2xl font-medium sm:text-[27px]">অ্যাক্টিভিটি টাইমলাইন</h1>
          <p className="mt-1.5 text-sm font-light" style={{ color: 'var(--v-mut)' }}>
            অ্যাডমিন · গ্রাহক · সিস্টেম — কে কখন কী করেছে, সব রেকর্ড। লগ কখনো মুছে ফেলা যায় না।
          </p>
        </div>
        <a href={`/api/admin/logs/export${qs ? `?${qs}` : ''}`} className="btn-ghost text-sm">⬇ CSV এক্সপোর্ট</a>
      </div>

      {/* ── ফিল্টার বার ── */}
      <form method="get" className="card flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-[180px] flex-1">
          <label className="label" htmlFor="q">খুঁজুন</label>
          <input id="q" name="q" defaultValue={searchParams.q || ''} className="input h-10" placeholder="নাম, বিস্তারিত, IP…" />
        </div>
        <div>
          <label className="label" htmlFor="actor">অভিনেতা</label>
          <select id="actor" name="actor" defaultValue={searchParams.actor || ''} className="input h-10 w-auto">
            <option value="">সব</option>
            <option value="ADMIN">অ্যাডমিন</option>
            <option value="CUSTOMER">গ্রাহক</option>
            <option value="SYSTEM">সিস্টেম</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="action">অ্যাকশন</label>
          <select id="action" name="action" defaultValue={searchParams.action || ''} className="input h-10 w-auto">
            <option value="">সব</option>
            {Object.keys(LABEL).map((a) => <option key={a} value={a}>{LABEL[a].text}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="from">থেকে</label>
          <input id="from" name="from" type="date" defaultValue={searchParams.from || ''} className="input h-10 w-auto" />
        </div>
        <div>
          <label className="label" htmlFor="to">পর্যন্ত</label>
          <input id="to" name="to" type="date" defaultValue={searchParams.to || ''} className="input h-10 w-auto" />
        </div>
        <button type="submit" className="btn-primary h-10">ফিল্টার</button>
        {qs && <a href="/admin/logs" className="btn-ghost h-10">রিসেট</a>}
      </form>

      <div className="table-wrap">
        <table className="tbl tbl--stack">
          <thead>
            <tr>
              <th scope="col">কখন</th>
              <th scope="col">অভিনেতা</th>
              <th scope="col">কে</th>
              <th scope="col">কী করল</th>
              <th scope="col" className="num">টাকা</th>
              <th scope="col">বিস্তারিত</th>
              <th scope="col">IP · ডিভাইস</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l: (typeof logs)[number]) => {
              const m = LABEL[l.action] ?? { text: l.action, cls: 'bg-slate-100 text-slate-600' };
              const device = (l.userAgent || '').match(/(Chrome|Firefox|Safari|Edg|Mobile|Android|iPhone)/i)?.[0] || '';
              return (
                <tr key={l.id}>
                  <td data-label="কখন" className="whitespace-nowrap text-xs" style={{ color: 'var(--v-mut)' }}>{fmtDate(l.createdAt)}</td>
                  <td data-label="অভিনেতা" className="whitespace-nowrap">
                    <span className="badge" style={{ background: 'var(--v-fill2)', color: 'var(--v-mut)' }}>{ACTOR_LABEL[l.actorType] || l.actorType}</span>
                  </td>
                  <td data-label="কে" className="whitespace-nowrap text-sm font-semibold" style={{ color: 'var(--v-ink)' }}>{l.adminName}</td>
                  <td data-label="কী করল"><span className={`badge whitespace-nowrap ${m.cls}`}>{m.text}</span></td>
                  <td data-label="টাকা" className="whitespace-nowrap num font-bold" style={{ color: 'var(--v-ink)' }}>{l.amount !== null ? bdt(l.amount) : '—'}</td>
                  {/* ⚠️ ফোনে `max-w-[260px]` উঠে যায় — কার্ডের ভিতরে সেলটি
                      নিজেই flex, তাই লেবেলের পাশে বাকি জায়গাটুকুই সীমা।
                      ডেস্কটপে সীমাটি বহাল, নাহলে একটি লম্বা `detail`
                      বাকি কলামগুলোকে চেপে ধরত। */}
                  <td data-label="বিস্তারিত" className="text-xs md:max-w-[260px]" style={{ color: 'var(--v-mut)' }}>{l.detail || '—'}</td>
                  <td data-label="IP · ডিভাইস" className="whitespace-nowrap font-mono text-[11px]" style={{ color: 'var(--v-dim)' }}>
                    {l.ip || '—'}{device ? ` · ${device}` : ''}
                  </td>
                </tr>
              );
            })}
            {logs.length === 0 && (
              <tr><td colSpan={7} className="py-14 ctr" style={{ color: 'var(--v-mut)' }}>এই ফিল্টারে কোনো লগ নেই</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs" style={{ color: 'var(--v-dim)' }}>সর্বশেষ ৩০০টি দেখাচ্ছে (ফিল্টার অনুযায়ী)। সম্পূর্ণ রেকর্ড CSV-তে এক্সপোর্ট করুন।</p>
    </div>
  );
}
