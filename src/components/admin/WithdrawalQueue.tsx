'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/Toast';
import { bdt } from '@/lib/money';

/**
 * ★★★ Group I (৫) — অ্যাডমিনের প্রত্যাহার সারি
 *
 *   ⚠️ অনুমোদনে **লেনদেন নম্বর বাধ্যতামূলক** — অ্যাডমিন আগে হাতে টাকা
 *   পাঠাবেন, তারপর নম্বরটি এখানে লিখবেন। প্রমাণ ছাড়া "পাঠানো হয়েছে"
 *   লেখা মানে পরে কেউ মিলিয়ে দেখতে পারবে না।
 *
 *   ⚠️ `HELD` সারিগুলো আলাদা করে চিহ্নিত — ঝুঁকির কারণে আটকানো,
 *   তাই দেখে-শুনে সিদ্ধান্ত নিতে হবে।
 */
export type Row = {
  id: string;
  amount: string | number;
  method: string;
  accountNumber: string;
  status: string;
  riskLevel: string;
  riskNote: string | null;
  adminNote: string | null;
  payoutRef: string | null;
  createdAt: string;
  processedByName: string | null;
  user: { id: string; name: string; email: string; balance: string | number };
};

const STATUS_BN: Record<string, string> = {
  PENDING: 'অপেক্ষমাণ',
  HELD: 'যাচাইয়ে আটকানো',
  APPROVED: 'পাঠানো হয়েছে',
  REJECTED: 'প্রত্যাখ্যাত',
};

export default function WithdrawalQueue({ initial }: { initial: Row[] }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [refs, setRefs] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});

  async function act(id: string, action: 'approve' | 'reject') {
    setBusy(id);
    try {
      const res = await fetch('/api/admin/withdrawals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          action,
          payoutRef: refs[id] ?? '',
          reason: reasons[id] ?? '',
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      toast.success(action === 'approve' ? 'অনুমোদিত' : 'প্রত্যাখ্যাত — টাকা ফেরত গেছে');
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'কাজটি করা যায়নি');
    } finally {
      setBusy(null);
    }
  }

  if (initial.length === 0) {
    return (
      <div className="card p-8 text-center text-sm" style={{ color: 'var(--v-mut)' }}>
        কোনো অনুরোধ নেই।
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {initial.map((w) => {
        const open = w.status === 'PENDING' || w.status === 'HELD';
        return (
          <li key={w.id} className="card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-base font-bold">{bdt(Number(w.amount))}</p>
                <p className="mt-0.5 text-xs" style={{ color: 'var(--v-mut)' }}>
                  {w.user.name} · {w.user.email}
                  <br />
                  {w.method} · <span className="font-mono">{w.accountNumber}</span>
                  {' · '}বর্তমান ব্যালেন্স {bdt(Number(w.user.balance))}
                </p>
                {w.riskLevel === 'ELEVATED' && (
                  <p className="mt-1.5 text-xs font-bold" style={{ color: 'var(--sem-warning, var(--v-heat))' }}>
                    ⚠ ঝুঁকি: {w.riskNote || 'উচ্চ'}
                  </p>
                )}
              </div>
              <span className="shrink-0 text-xs font-bold" style={{ color: 'var(--v-mut)' }}>
                {STATUS_BN[w.status] ?? w.status}
              </span>
            </div>

            {open ? (
              <div className="mt-4 space-y-2 border-t pt-3" style={{ borderColor: 'var(--v-edge)' }}>
                <p className="text-xs" style={{ color: 'var(--v-mut)' }}>
                  ⚠️ আগে হাতে টাকা পাঠান, তারপর লেনদেন নম্বর লিখে অনুমোদন করুন।
                </p>
                <div className="flex flex-wrap gap-2">
                  <input
                    className="input max-w-[200px] font-mono text-sm"
                    placeholder="পরিশোধের TrxID"
                    value={refs[w.id] ?? ''}
                    onChange={(e) => setRefs({ ...refs, [w.id]: e.target.value })}
                  />
                  <button
                    className="btn-primary px-4 text-sm disabled:opacity-50"
                    disabled={busy === w.id || !(refs[w.id] ?? '').trim()}
                    onClick={() => act(w.id, 'approve')}
                  >
                    অনুমোদন
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  <input
                    className="input max-w-[260px] text-sm"
                    placeholder="প্রত্যাখ্যানের কারণ"
                    value={reasons[w.id] ?? ''}
                    onChange={(e) => setReasons({ ...reasons, [w.id]: e.target.value })}
                  />
                  <button
                    className="btn-ghost px-4 text-sm disabled:opacity-50"
                    disabled={busy === w.id || !(reasons[w.id] ?? '').trim()}
                    onClick={() => act(w.id, 'reject')}
                  >
                    প্রত্যাখ্যান (টাকা ফেরত)
                  </button>
                </div>
              </div>
            ) : (
              <p className="mt-3 border-t pt-3 text-xs" style={{ borderColor: 'var(--v-edge)', color: 'var(--v-mut)' }}>
                {w.processedByName ? `${w.processedByName} · ` : ''}
                {w.payoutRef ? `TrxID: ${w.payoutRef}` : w.adminNote}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
