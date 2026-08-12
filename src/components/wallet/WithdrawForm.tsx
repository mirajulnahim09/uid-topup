'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/Toast';
import { bdt } from '@/lib/money';

/**
 * ★★★ Group I (৫) — প্রত্যাহারের ফর্ম
 *
 *   ⚠️ দুই ধাপ: আগে কোড চাই, তারপর অনুরোধ। কোড ছাড়া সার্ভার
 *   অনুরোধ নেয় না — সেশন চুরি হলে যেন কেবল কুকি দিয়ে ওয়ালেট
 *   খালি করা না যায়।
 *
 *   ⚠️ "তোলার যোগ্য" ব্যালেন্সের চেয়ে কম হতে পারে (সাম্প্রতিক জমা
 *   আটকে থাকে)। কারণটা পর্দাতেই লেখা — নাহলে গ্রাহক ভাববেন সিস্টেম
 *   ভুল বলছে।
 */
export default function WithdrawForm({
  withdrawable,
  min,
  methods,
  holdHours,
}: {
  withdrawable: number;
  min: number;
  methods: string[];
  holdHours: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const [f, setF] = useState({ amount: '', method: methods[0] ?? 'BKASH', accountNumber: '', code: '' });
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function sendCode() {
    setBusy(true);
    setErr('');
    try {
      const res = await fetch('/api/account/withdraw', { method: 'PUT' });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      setSent(true);
      toast.success('ইমেইলে কোড পাঠানো হয়েছে');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'কোড পাঠানো যায়নি');
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const res = await fetch('/api/account/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: Number(f.amount),
          method: f.method,
          accountNumber: f.accountNumber.trim(),
          code: f.code.trim(),
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      toast.success('অনুরোধ জমা হয়েছে — অ্যাডমিন দেখে পাঠাবেন');
      setF({ ...f, amount: '', code: '' });
      setSent(false);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'অনুরোধ করা যায়নি');
    } finally {
      setBusy(false);
    }
  }

  if (withdrawable <= 0) {
    return (
      <div className="card p-5 text-sm" style={{ color: 'var(--v-mut)' }}>
        এখন তোলার মতো টাকা নেই।
        <br />
        ⚠️ সাম্প্রতিক জমা ও ফেরত <b>{holdHours} ঘণ্টা</b> পর তোলা যায় — এটি
        নিরাপত্তার নিয়ম, সবার জন্য এক।
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="card space-y-4 p-5">
      <p className="text-sm">
        তোলার যোগ্য: <b style={{ color: 'var(--accent-text)' }}>{bdt(withdrawable)}</b>
      </p>

      <div>
        <label htmlFor="amt" className="label">পরিমাণ (সর্বনিম্ন ৳{min})</label>
        <input
          id="amt" className="input mt-1" inputMode="numeric"
          value={f.amount}
          onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^\d.]/g, '') })}
          placeholder={String(min)}
        />
      </div>

      <div>
        <label htmlFor="mtd" className="label">মাধ্যম</label>
        <select
          id="mtd" className="input mt-1" value={f.method}
          onChange={(e) => setF({ ...f, method: e.target.value })}
        >
          {methods.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>

      <div>
        <label htmlFor="acc" className="label">যে নাম্বারে পাঠানো হবে</label>
        <input
          id="acc" className="input mt-1" inputMode="numeric" maxLength={11}
          value={f.accountNumber}
          onChange={(e) => setF({ ...f, accountNumber: e.target.value.replace(/\D/g, '') })}
          placeholder="01712345678"
        />
      </div>

      <div>
        <div className="flex items-end justify-between gap-3">
          <label htmlFor="wcode" className="label mb-0">ইমেইল যাচাই কোড</label>
          <button
            type="button" onClick={sendCode} disabled={busy}
            className="btn-ghost px-3 py-1.5 text-xs disabled:opacity-50"
          >
            {sent ? 'আবার পাঠান' : 'কোড পাঠান'}
          </button>
        </div>
        <input
          id="wcode" className="input mt-1.5 font-mono tracking-[0.4em]"
          inputMode="numeric" maxLength={6}
          value={f.code}
          onChange={(e) => setF({ ...f, code: e.target.value.replace(/\D/g, '').slice(0, 6) })}
          placeholder="৬ অঙ্ক"
        />
      </div>

      {err && <p role="alert" className="text-xs text-red-600">{err}</p>}

      <button type="submit" disabled={busy || !f.code} className="btn-primary px-5 text-sm disabled:opacity-50">
        {busy ? 'পাঠানো হচ্ছে…' : 'অনুরোধ পাঠান'}
      </button>

      <p className="text-xs" style={{ color: 'var(--v-mut)' }}>
        ⚠️ অনুরোধ পাঠানোমাত্র টাকা ব্যালেন্স থেকে সরে যাবে। প্রত্যাখ্যাত হলে
        সম্পূর্ণ ফেরত আসবে।
      </p>
    </form>
  );
}
