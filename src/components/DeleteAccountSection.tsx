'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useToast } from './Toast';

/** Profile section: request (or cancel) account deletion. */
export default function DeleteAccountSection({ requestedAt }: { requestedAt: string | null }) {
  const toast = useToast();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function send(method: 'POST' | 'DELETE') {
    setBusy(true);
    try {
      const r = await fetch('/api/account/delete-request', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: method === 'POST' ? JSON.stringify({ confirm, reason }) : undefined,
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'সমস্যা হয়েছে');
      toast.success(method === 'POST' ? 'অনুরোধ পাঠানো হয়েছে' : 'অনুরোধ বাতিল হয়েছে');
      setOpen(false);
      setConfirm('');
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'সমস্যা হয়েছে');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card p-5 sm:p-6" style={{ borderColor: 'color-mix(in srgb, var(--sem-danger) 30%, var(--v-edge))' }}>
      <h2 className="text-lg font-bold" style={{ color: 'var(--v-ink)' }}>অ্যাকাউন্ট মুছে ফেলুন</h2>
      {requestedAt ? (
        <>
          <p className="mt-1 text-sm" style={{ color: 'var(--v-mut)' }}>
            আপনার অনুরোধ পেয়েছি ({new Date(requestedAt).toLocaleDateString('bn-BD')})। যাচাই শেষে ৭ দিনের মধ্যে অ্যাকাউন্ট মুছে ফেলা হবে।
          </p>
          <button type="button" onClick={() => send('DELETE')} disabled={busy} className="btn-secondary mt-3 w-full py-2.5">
            {busy ? '...' : 'অনুরোধ বাতিল করুন'}
          </button>
        </>
      ) : !open ? (
        <>
          <p className="mt-1 text-sm" style={{ color: 'var(--v-mut)' }}>
            নাম, ইমেইল, ফোন ও লগইন মুছে যাবে। লেনদেনের রেকর্ড নাম-পরিচয়হীনভাবে থাকবে।{' '}
            <Link href="/delete-account" className="underline">বিস্তারিত নীতি</Link>
          </p>
          <button type="button" onClick={() => setOpen(true)} className="btn-secondary mt-3 w-full py-2.5" style={{ color: 'var(--sem-danger)' }}>
            অ্যাকাউন্ট মোছার অনুরোধ
          </button>
        </>
      ) : (
        <div className="mt-3 space-y-3">
          <p className="text-sm font-bold" style={{ color: 'var(--sem-warning)' }}>
            ওয়ালেটে টাকা থাকলে আগে উইথড্র করুন। &quot;আমার কোড&quot;-এর কোডগুলো সংরক্ষণ করে নিন।
          </p>
          <div>
            <label className="label" htmlFor="del-reason">কারণ (ঐচ্ছিক)</label>
            <input id="del-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
          </div>
          <div>
            <label className="label" htmlFor="del-confirm">নিশ্চিত করতে DELETE লিখুন</label>
            <input id="del-confirm" className="input font-mono" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => send('POST')} disabled={busy || confirm.trim().toUpperCase() !== 'DELETE'}
              className="btn-secondary flex-1 py-2.5" style={{ color: 'var(--sem-danger)' }}>
              {busy ? '...' : 'অনুরোধ পাঠান'}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="btn-secondary px-4 py-2.5">বাতিল</button>
          </div>
        </div>
      )}
    </section>
  );
}
