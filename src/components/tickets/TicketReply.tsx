'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/Toast';

/**
 * ★ Group I (৪) — থ্রেডে উত্তর ও টিকিট বন্ধ করা
 *
 *   ⚠️ বন্ধ করা **ফেরানো যায় না** (বন্ধ থ্রেডে আর লেখা যায় না,
 *   নতুন টিকিট খুলতে হয়) — তাই একবার নিশ্চিত করা হয়।
 */
export default function TicketReply({
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
  const [confirmClose, setConfirmClose] = useState(false);

  if (closed) {
    return (
      <p className="card p-4 text-sm" style={{ color: 'var(--v-mut)' }}>
        টিকিটটি বন্ধ। নতুন কিছু জানানোর থাকলে{' '}
        <Link href="/account/tickets" className="underline" style={{ color: 'var(--v-ice)' }}>
          নতুন টিকিট
        </Link>{' '}
        খুলুন।
      </p>
    );
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/tickets/${ticketId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      setBody('');
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
      const res = await fetch(`/api/tickets/${ticketId}`, { method: 'PATCH' });
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

  return (
    <div className="space-y-3">
      <form onSubmit={send} className="card p-4">
        <label htmlFor="reply" className="label">উত্তর</label>
        <textarea
          id="reply"
          className="input mt-1 min-h-[100px]"
          maxLength={4000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="আপনার বার্তা…"
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={busy || !body.trim()}
            className="btn-primary px-5 text-sm disabled:opacity-50"
          >
            {busy ? 'পাঠানো হচ্ছে…' : 'পাঠান'}
          </button>

          {confirmClose ? (
            <>
              <button type="button" onClick={close} disabled={busy} className="btn-ghost px-4 text-sm">
                নিশ্চিত — বন্ধ করুন
              </button>
              <button type="button" onClick={() => setConfirmClose(false)} className="btn-ghost px-4 text-sm">
                না
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmClose(true)}
              className="btn-ghost px-4 text-sm"
            >
              সমাধান হয়েছে — বন্ধ করুন
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
