'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/Toast';

/**
 * ★ Group I (৪) — নতুন টিকিট
 *
 *   ⚠️ অর্ডার নির্বাচন ঐচ্ছিক, কিন্তু "বিরোধ" বাছলে **বাধ্যতামূলক** —
 *   নাহলে অ্যাডমিন কী নিয়ে বিরোধ তা-ই জানবেন না। সার্ভারও একই
 *   নিয়ম প্রয়োগ করে; এখানে আগে ধরলে একটি অকারণ রাউন্ড-ট্রিপ বাঁচে।
 */
export default function NewTicketForm({
  orders,
  presetOrderId,
}: {
  orders: { id: string; orderNo: number; productName: string }[];
  /** ★ অর্ডার পাতা থেকে "সমস্যা জানান" এলে সেটি আগেই বাছা থাকে */
  presetOrderId?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(Boolean(presetOrderId));
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    subject: '',
    body: '',
    kind: presetOrderId ? 'DISPUTE' : 'GENERAL',
    orderId: presetOrderId ?? '',
  });
  const [err, setErr] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (f.kind === 'DISPUTE' && !f.orderId) {
      setErr('বিরোধের জন্য অর্ডার বেছে নিন');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      const res = await fetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: f.subject,
          body: f.body,
          kind: f.kind,
          orderId: f.orderId || undefined,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      toast.success('টিকিট খোলা হয়েছে');
      router.push(`/account/tickets/${d.ticket.id}`);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'টিকিট খোলা যায়নি');
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-ghost px-4 text-sm">
        + নতুন টিকিট
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="card space-y-4 p-5">
      <div>
        <label htmlFor="kind" className="label">ধরন</label>
        <select
          id="kind"
          className="input mt-1"
          value={f.kind}
          onChange={(e) => setF({ ...f, kind: e.target.value })}
        >
          <option value="GENERAL">সাধারণ প্রশ্ন</option>
          <option value="DISPUTE">অর্ডার নিয়ে সমস্যা</option>
        </select>
      </div>

      {f.kind === 'DISPUTE' && (
        <div>
          <label htmlFor="order" className="label">কোন অর্ডার</label>
          <select
            id="order"
            className="input mt-1"
            value={f.orderId}
            onChange={(e) => setF({ ...f, orderId: e.target.value })}
          >
            <option value="">— বেছে নিন —</option>
            {orders.map((o) => (
              <option key={o.id} value={o.id}>
                #{o.orderNo} — {o.productName}
              </option>
            ))}
          </select>
          {orders.length === 0 && (
            <p className="mt-1 text-xs" style={{ color: 'var(--v-mut)' }}>
              আপনার কোনো অর্ডার নেই।
            </p>
          )}
        </div>
      )}

      <div>
        <label htmlFor="subject" className="label">বিষয়</label>
        <input
          id="subject"
          className="input mt-1"
          maxLength={120}
          value={f.subject}
          onChange={(e) => setF({ ...f, subject: e.target.value })}
          placeholder="সংক্ষেপে কী সমস্যা"
        />
      </div>

      <div>
        <label htmlFor="body" className="label">বিস্তারিত</label>
        <textarea
          id="body"
          className="input mt-1 min-h-[120px]"
          maxLength={4000}
          value={f.body}
          onChange={(e) => setF({ ...f, body: e.target.value })}
          placeholder="কী হয়েছে, কখন হয়েছে — যত স্পষ্ট লিখবেন তত দ্রুত সমাধান হবে"
        />
      </div>

      {err && <p role="alert" className="text-xs text-red-600">{err}</p>}

      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className="btn-primary px-5 text-sm disabled:opacity-50">
          {busy ? 'পাঠানো হচ্ছে…' : 'টিকিট খুলুন'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="btn-ghost px-4 text-sm">
          বাতিল
        </button>
      </div>
    </form>
  );
}
