import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { bdt } from '@/lib/money';
import { fmtDate } from '@/lib/date';
import {
  getWithdrawalConfig, withdrawableAmount, listUserWithdrawals,
} from '@/lib/services/withdrawal';
import WithdrawForm from '@/components/wallet/WithdrawForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'টাকা তোলা', robots: { index: false, follow: false } };

/**
 * ★ Group I (৫) — গ্রাহকের প্রত্যাহার পাতা
 *
 *   ⚠️ ফিচারটি বন্ধ থাকলে পাতাটি স্পষ্টভাবে সেটাই বলে — ফর্ম দেখিয়ে
 *   পরে সার্ভারে ৪০৩ দেওয়ার চেয়ে সেটি অনেক ভালো।
 */
const STATUS_BN: Record<string, string> = {
  PENDING: 'অপেক্ষমাণ',
  HELD: 'যাচাইয়ে আটকানো',
  APPROVED: 'পাঠানো হয়েছে',
  REJECTED: 'প্রত্যাখ্যাত',
};

export default async function WithdrawPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return null;

  const cfg = await getWithdrawalConfig();
  const [me, history] = await Promise.all([
    prisma.user.findUnique({ where: { id: session.user.id }, select: { balance: true } }),
    listUserWithdrawals(session.user.id),
  ]);
  const usable = await withdrawableAmount(prisma, session.user.id, me?.balance ?? 0, cfg.holdHours);

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link href="/account/wallet" className="text-sm font-semibold" style={{ color: 'var(--v-mut)' }}>
        ← ওয়ালেট
      </Link>

      <div>
        <h1 className="lux-text text-2xl font-medium sm:text-[27px]">টাকা তোলা</h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--v-mut)' }}>
          ব্যালেন্স {bdt(Number(me?.balance ?? 0))}
        </p>
      </div>

      {!cfg.enabled ? (
        <div className="card p-6 text-sm" style={{ color: 'var(--v-mut)' }}>
          টাকা তোলার সুবিধা এখনো চালু হয়নি। চালু হলে এখানেই দেখতে পাবেন।
        </div>
      ) : (
        <WithdrawForm
          withdrawable={usable}
          min={cfg.min}
          methods={cfg.methods}
          holdHours={cfg.holdHours}
        />
      )}

      {history.length > 0 && (
        <section>
          <h2 className="text-sm font-bold">আগের অনুরোধ</h2>
          <ul className="mt-2 space-y-2">
            {history.map((w) => (
              <li key={w.id} className="card flex items-start justify-between gap-4 p-4">
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{bdt(Number(w.amount))}</span>
                  <span className="mt-0.5 block text-xs" style={{ color: 'var(--v-mut)' }}>
                    {w.method} · {w.accountNumber} · {fmtDate(w.createdAt)}
                  </span>
                  {w.adminNote && (
                    <span className="mt-1 block text-xs" style={{ color: 'var(--v-mut)' }}>
                      {w.adminNote}
                    </span>
                  )}
                  {w.payoutRef && (
                    <span className="mt-1 block font-mono text-xs" style={{ color: 'var(--v-mut)' }}>
                      TrxID: {w.payoutRef}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-xs font-bold" style={{ color: 'var(--v-mut)' }}>
                  {STATUS_BN[w.status] ?? w.status}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
