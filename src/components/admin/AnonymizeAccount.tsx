'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast, ConfirmDialog } from '@/components/Toast';
import { fmtDate } from '@/lib/date';

/** Admin: complete a customer's deletion request (anonymise). */
export default function AnonymizeAccount({
  userId, requestedAt, reason, blockers,
}: {
  userId: string;
  requestedAt: string;
  reason: string | null;
  blockers: { balance: number; openOrders: number; openDeposits: number; openWithdrawals: number };
}) {
  const toast = useToast();
  const router = useRouter();
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const blocked = blockers.balance !== 0 || blockers.openOrders + blockers.openDeposits + blockers.openWithdrawals > 0;

  async function run() {
    setBusy(true);
    try {
      const r = await fetch('/api/admin/user/anonymize', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'করা যায়নি');
      toast.success('অ্যাকাউন্টের ব্যক্তিগত তথ্য মুছে ফেলা হয়েছে');
      setAsk(false);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'করা যায়নি');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-4 sm:p-5" style={{ borderColor: 'color-mix(in srgb, var(--sem-danger) 40%, var(--v-edge))' }}>
      <p className="text-sm font-bold" style={{ color: 'var(--sem-danger)' }}>
        🗑️ গ্রাহক অ্যাকাউন্ট মোছার অনুরোধ করেছেন — {fmtDate(requestedAt)}
      </p>
      {reason && <p className="mt-1 text-sm" style={{ color: 'var(--v-mut)' }}>কারণ: {reason}</p>}
      {blocked ? (
        <p className="mt-2 text-sm" style={{ color: 'var(--v-ink)' }}>
          এখনো মোছা যাবে না:
          {blockers.balance !== 0 && <> ওয়ালেটে ৳{blockers.balance.toFixed(2)} ·</>}
          {blockers.openOrders > 0 && <> {blockers.openOrders}টি চলমান অর্ডার ·</>}
          {blockers.openDeposits > 0 && <> {blockers.openDeposits}টি অপেক্ষমাণ ডিপোজিট ·</>}
          {blockers.openWithdrawals > 0 && <> {blockers.openWithdrawals}টি অপেক্ষমাণ উইথড্র</>}
        </p>
      ) : (
        <button type="button" className="btn-secondary mt-3 py-2.5 px-4" style={{ color: 'var(--sem-danger)' }} onClick={() => setAsk(true)}>
          ব্যক্তিগত তথ্য মুছে অ্যাকাউন্ট বন্ধ করুন
        </button>
      )}
      <ConfirmDialog
        open={ask}
        title="অ্যাকাউন্ট মুছবেন?"
        confirmLabel={busy ? '...' : 'হ্যাঁ, মুছুন'}
        danger
        onConfirm={run}
        onCancel={() => setAsk(false)}
      >
        <p className="text-sm">নাম, ইমেইল, ফোন ও লগইন স্থায়ীভাবে মুছে যাবে। অর্ডার ও লেনদেনের রেকর্ড নাম-পরিচয়হীনভাবে থাকবে। এটি ফেরানো যায় না।</p>
      </ConfirmDialog>
    </div>
  );
}
