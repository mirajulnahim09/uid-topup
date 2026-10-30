'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useToast, ConfirmDialog } from '@/components/Toast';
import CopyButton from '@/components/admin/CopyButton';

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
  // ★ এক ডায়ালগ = এক সমন্বয়: ডাবল-ক্লিক বা নেট-কাটা retry সার্ভারে একবারই গোনে
  const [adjustKey, setAdjustKey] = useState('');
  const [recoveryAsk, setRecoveryAsk] = useState(false);
  const [recovery, setRecovery] = useState<{ url: string; expiresAt: string } | null>(null);

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
        body: JSON.stringify({ userId, amount: amt, note: note.trim(), requestId: adjustKey || undefined }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      if (d.duplicate) toast.success(`এই সমন্বয় আগেই হয়ে গেছে — আবার যোগ করা হয়নি (ব্যালেন্স ৳${d.balance})`);
      else toast.success(`${name} — ${amt > 0 ? '+' : ''}৳${amt.toFixed(2)} (নতুন ব্যালেন্স ৳${d.balance})`);
      setAmount('');
      setNote('');
      setAdjustKey('');
      startTransition(() => router.refresh());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'সমন্বয় করা যায়নি');
    } finally {
      setBusy(false);
    }
  }

  /**
   * ★★★ জরুরি রিকভারি-লিংক — এক-বারের, ৩০ মিনিট মেয়াদি।
   *   লিংকটি কেবল এই dialog-এ **একবার** দেখানো হয়; কোথাও সংরক্ষিত হয় না।
   *   সার্ভার-পাশের সব শর্ত `api/admin/user/recovery/route.ts` এ।
   */
  async function runRecovery() {
    setRecoveryAsk(false);
    setBusy(true);
    try {
      const res = await fetch('/api/admin/user/recovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      setRecovery({ url: d.url, expiresAt: d.expiresAt });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'লিংক তৈরি করা যায়নি');
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
      <button disabled={busy} onClick={() => { if (!adjustKey) { setAmount(''); setNote(''); setAdjustKey(crypto.randomUUID()); } setAdjustOpen(true); }} className="btn-primary">
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
          {status === 'ACTIVE' && (
            <button disabled={busy} onClick={() => setRecoveryAsk(true)} className="btn-ghost">🔑 রিকভারি-লিংক</button>
          )}
        </>
      )}

      <ConfirmDialog
        open={recoveryAsk}
        title={`${name} — জরুরি রিকভারি-লিংক`}
        message={
          'গ্রাহক পাসওয়ার্ড ভুলে গেলে ও ইমেইল না পেলে এটি ব্যবহার করুন।\n\n' +
          '• আগে ফোনে গ্রাহকের পরিচয় নিশ্চিত করুন\n' +
          '• লিংকটি ৩০ মিনিট মেয়াদি, একবারই চলে\n' +
          '• গ্রাহক নিজে নতুন পাসওয়ার্ড দেবেন — আপনি কোনো পাসওয়ার্ড দেখবেন না\n' +
          '• এই কাজটি অ্যাক্টিভিটি লগে আপনার নামে থাকবে'
        }
        confirmLabel="লিংক তৈরি করুন"
        onConfirm={runRecovery}
        onCancel={() => setRecoveryAsk(false)}
      />

      <ConfirmDialog
        open={Boolean(recovery)}
        title="রিকভারি-লিংক তৈরি হয়েছে"
        message={
          recovery
            ? `মেয়াদ শেষ: ${new Date(recovery.expiresAt).toLocaleTimeString('bn-BD', { timeZone: 'Asia/Dhaka', hour: '2-digit', minute: '2-digit' })}\n\n` +
              'লিংকটি কেবল এখনই দেখানো হচ্ছে — কপি করে সরাসরি গ্রাহককে পাঠান। অন্য কাউকে দেবেন না।'
            : undefined
        }
        confirmLabel="হয়ে গেছে"
        cancelLabel="বন্ধ"
        onConfirm={() => setRecovery(null)}
        onCancel={() => setRecovery(null)}
      >
        {recovery && (
          <div className="flex items-center gap-2">
            <input
              aria-label="রিকভারি-লিংক"
              readOnly
              value={recovery.url}
              onFocus={(e) => e.currentTarget.select()}
              className="input min-w-0 flex-1 font-mono text-xs"
            />
            <CopyButton value={recovery.url} label="রিকভারি-লিংক" />
          </div>
        )}
      </ConfirmDialog>

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
              onChange={(e) => { setAmount(e.target.value); setAdjustKey(crypto.randomUUID()); }} placeholder="যেমন: 100 বা -50" />
          </div>
          <div>
            <label className="label">কারণ (বাধ্যতামূলক)</label>
            <input aria-label="কারণ (বাধ্যতামূলক)" className="input" value={note} onChange={(e) => { setNote(e.target.value); setAdjustKey(crypto.randomUUID()); }}
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
