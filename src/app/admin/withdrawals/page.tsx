import Link from 'next/link';
import type { Metadata } from 'next';
import AdminPageHeader from '@/components/admin/AdminPageHeader';
import WithdrawalQueue, { type Row } from '@/components/admin/WithdrawalQueue';
import { listAdminWithdrawals, getWithdrawalConfig } from '@/lib/services/withdrawal';

export const metadata: Metadata = { title: 'টাকা তোলার অনুরোধ' };
export const dynamic = 'force-dynamic';

const FILTERS = [
  { key: '', label: 'সব' },
  { key: 'PENDING', label: 'অপেক্ষমাণ' },
  { key: 'HELD', label: 'আটকানো' },
  { key: 'APPROVED', label: 'পাঠানো' },
  { key: 'REJECTED', label: 'প্রত্যাখ্যাত' },
];

/**
 * ★ Group I (৫) — অ্যাডমিনের প্রত্যাহার সারি
 *
 *   ⚠️ ফিচারটি বন্ধ থাকলে পাতাটি সেটি স্পষ্ট করে বলে — কিন্তু সারি
 *   তবুও দেখায়, কারণ বন্ধ করার আগে জমা পড়া অনুরোধগুলোর নিষ্পত্তি
 *   করতেই হবে (নাহলে গ্রাহকের টাকা কাটা অবস্থায় আটকে থাকত)।
 */
export default async function AdminWithdrawalsPage({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  const raw = searchParams.status;
  const status =
    raw === 'PENDING' || raw === 'HELD' || raw === 'APPROVED' || raw === 'REJECTED' ? raw : undefined;

  const [cfg, rows] = await Promise.all([getWithdrawalConfig(), listAdminWithdrawals(status)]);

  // ★ Decimal → সরল মান, ক্লায়েন্ট কম্পোনেন্টে পাঠানোর জন্য
  const initial: Row[] = rows.map((w) => ({
    id: w.id,
    amount: Number(w.amount),
    method: w.method,
    accountNumber: w.accountNumber,
    status: w.status,
    riskLevel: w.riskLevel,
    riskNote: w.riskNote,
    adminNote: w.adminNote,
    payoutRef: w.payoutRef,
    createdAt: w.createdAt.toISOString(),
    processedByName: w.processedByName,
    user: {
      id: w.user.id,
      name: w.user.name,
      email: w.user.email,
      balance: Number(w.user.balance),
    },
  }));

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title="টাকা তোলার অনুরোধ"
        subtitle="হাতে টাকা পাঠিয়ে লেনদেন নম্বর লিখুন। প্রত্যাখ্যান করলে টাকা সাথে সাথেই গ্রাহকের ব্যালেন্সে ফিরে যায়।"
      />

      {!cfg.enabled && (
        <div className="card p-4 text-sm" style={{ color: 'var(--v-mut)' }}>
          ⚠️ টাকা তোলার সুবিধা এখন <b>বন্ধ</b> — নতুন অনুরোধ আসবে না।
          সেটিংসে <code>withdrawal_enabled</code> = <code>1</code> দিলে চালু হবে।
          {' '}জমা পড়া অনুরোধ থাকলে সেগুলো নিচে নিষ্পত্তি করা যাবে।
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={f.key ? `/admin/withdrawals?status=${f.key}` : '/admin/withdrawals'}
            className="btn-ghost px-3 py-1.5 text-xs"
            style={(raw ?? '') === f.key ? { borderColor: 'var(--accent-text)' } : undefined}
          >
            {f.label}
          </Link>
        ))}
      </div>

      <WithdrawalQueue initial={initial} />
    </div>
  );
}
