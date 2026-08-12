'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/Toast';

/**
 * ★ Group I (৪) — অ্যাডমিনের উত্তর ও বন্ধ করা
 *
 *   ⚠️ এখানে টাকা ফেরত দেওয়ার কোনো বোতাম **নেই**, ইচ্ছাকৃতভাবে।
 *   রিফান্ড অর্ডার পাতা থেকেই হবে — টাকার দুটি দরজা মানে একদিন
 *   একটিতে লক ভুল। প্রয়োজনে অর্ডারের লিংক উপরে দেওয়া আছে।
 */
export default function AdminTicketThread({
  ticketId,
  closed,
}: {
  ticketId: string;
  closed: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    try {
      const res = await fetch('/api/admin/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: ticketId, body }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      setBody('');
      toast.success('উত্তর পাঠানো হয়েছে');
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'পাঠানো যায়নি');
    } finally {
      setBusy(false);
    }
  }

  async function close() {
    setBusy(true);
    try {
      const res = await fetch('/api/admin/tickets', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: ticketId }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      toast.success('টিকিট বন্ধ করা হয়েছে');
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'বন্ধ করা যায়নি');
    } finally {
      setBusy(false);
    }
  }

  if (closed) {
    return (
      <p className="card p-4 text-sm" style={{ color: 'var(--v-mut)' }}>
        টিকিটটি বন্ধ। গ্রাহক নতুন কিছু জানাতে চাইলে নতুন টিকিট খুলবেন।
      </p>
    );
  }

  return (
    <form onSubmit={send} className="card p-4">
      <label htmlFor="areply" className="label">উত্তর</label>
      <textarea
        id="areply"
        className="input mt-1 min-h-[110px]"
        maxLength={4000}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="গ্রাহককে কী জানাবেন…"
      />
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={busy || !body.trim()}
          className="btn-primary px-5 text-sm disabled:opacity-50"
        >
          {busy ? 'পাঠানো হচ্ছে…' : 'উত্তর পাঠান'}
        </button>
        <button type="button" onClick={close} disabled={busy} className="btn-ghost px-4 text-sm">
          সমাধান হয়েছে — বন্ধ করুন
        </button>
      </div>
    </form>
  );
}
