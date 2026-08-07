'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useToast, ConfirmDialog } from '@/components/Toast';

/**
 * ★ Admin customer detail পেজের অ্যাকশন — ব্যালেন্স যোগ/কাটা ও ব্যান/আনব্যান।
 *   existing /api/admin/user ব্যবহার করে (row-lock + ledger + audit সহ)।
 */
export default function CustomerActions({
  userId,
  name,
  balance,
  isAdmin,
  status = 'ACTIVE',
}: {
  userId: string;
  name: string;
  balance: number;
  isBanned?: boolean;
  isAdmin: boolean;
  status?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = useTransition();

  const [adjustOpen, setAdjustOpen] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const STATUS_LABEL: Record<string, string> = { ACTIVE: 'সক্রিয়', SUSPENDED: 'সাময়িক স্থগিত', BLOCKED: 'স্থায়ীভাবে বন্ধ' };

  async function runAdjust() {
    const amt = Number(amount);
    if (isNaN(amt) || amt === 0) return toast.error('সঠিক পরিমাণ দিন (+ যোগ, − বিয়োগ)');
    if (!note.trim()) return toast.error('কারণ লিখুন');
    setAdjustOpen(false);
    setBusy(true);
    try {
      const res = await fetch('/api/admin/user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, amount: amt, note: note.trim() }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      toast.success(`${name} — ${amt > 0 ? '+' : ''}৳${amt.toFixed(2)} (নতুন ব্যালেন্স ৳${d.balance})`);
      setAmount('');
      setNote('');
      startTransition(() => router.refresh());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'সমন্বয় করা যায়নি');
    } finally {
      setBusy(false);
    }
  }

  async function runStatus() {
    if (!pendingStatus) return;
    const target = pendingStatus;
    setPendingStatus(null);
    setBusy(true);
    try {
      const res = await fetch('/api/admin/user', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, status: target }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      toast.success(`${name} — স্ট্যাটাস: ${STATUS_LABEL[target]}`);
      startTransition(() => router.refresh());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'কাজটি করা যায়নি');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <button disabled={busy} onClick={() => { setAmount(''); setNote(''); setAdjustOpen(true); }} className="btn-primary">
        ৳ ব্যালেন্স যোগ / কাটা
      </button>
      {!isAdmin && (
        <>
          {status !== 'ACTIVE' && (
            <button disabled={busy} onClick={() => setPendingStatus('ACTIVE')} className="btn-success">↺ সক্রিয় করুন</button>
          )}
          {status !== 'SUSPENDED' && (
            <button disabled={busy} onClick={() => setPendingStatus('SUSPENDED')} className="btn-ghost">⏸ সাময়িক স্থগিত</button>
          )}
          {status !== 'BLOCKED' && (
            <button disabled={busy} onClick={() => setPendingStatus('BLOCKED')} className="btn-danger">⛔ স্থায়ীভাবে বন্ধ</button>
          )}
        </>
      )}

      <ConfirmDialog
        open={adjustOpen}
        title={`${name} — ব্যালেন্স সমন্বয়`}
        message={`বর্তমান ব্যালেন্স: ৳${balance.toFixed(2)}\n\nধনাত্মক = যোগ, ঋণাত্মক = বিয়োগ। প্রতিটি সমন্বয় লেজারে রেকর্ড হবে।`}
        confirmLabel="সমন্বয় করুন"
        onConfirm={runAdjust}
        onCancel={() => setAdjustOpen(false)}
      >
        <div className="space-y-3">
          <div>
            <label className="label">পরিমাণ (+ / −)</label>
            <input aria-label="পরিমাণ (+ / −)" className="input" type="number" step="0.01" value={amount}
              onChange={(e) => setAmount(e.target.value)} placeholder="যেমন: 100 বা -50" />
          </div>
          <div>
            <label className="label">কারণ (বাধ্যতামূলক)</label>
            <input aria-label="কারণ (বাধ্যতামূলক)" className="input" value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="যেমন: ম্যানুয়াল রিফান্ড" />
          </div>
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(pendingStatus)}
        title={`${name} — স্ট্যাটাস: ${pendingStatus ? STATUS_LABEL[pendingStatus] : ''}`}
        message={
          pendingStatus === 'ACTIVE'
            ? 'ইউজার আবার স্বাভাবিকভাবে লগইন ও অর্ডার করতে পারবে।'
            : pendingStatus === 'SUSPENDED'
            ? `সাময়িকভাবে লগইন বন্ধ থাকবে (পরে আবার সক্রিয় করা যাবে)।\nব্যালেন্স ৳${balance.toFixed(2)} অক্ষত থাকবে।`
            : `স্থায়ীভাবে লগইন বন্ধ।\nব্যালেন্স ৳${balance.toFixed(2)} অক্ষত থাকবে।`
        }
        confirmLabel="নিশ্চিত করুন"
        danger={pendingStatus !== 'ACTIVE'}
        onConfirm={runStatus}
        onCancel={() => setPendingStatus(null)}
      />
    </div>
  );
}
