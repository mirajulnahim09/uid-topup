'use client';

import { useState } from 'react';
import { signOut } from 'next-auth/react';
import { useToast } from './Toast';

/**
 * ★ সব ডিভাইস থেকে সাইন-আউট — sessionEpoch বাড়ায় (সার্ভার), তারপর
 *   বর্তমান ব্রাউজারও সাইন-আউট করে। ফোন হারানো/compromise সন্দেহে কাজে লাগে।
 */
export default function SignOutAllButton() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const r = await fetch('/api/account/sessions/revoke-all', { method: 'POST' });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || 'সাইন-আউট করা যায়নি');
      }
      toast.success('সব ডিভাইস সাইন-আউট হয়েছে');
      // ★ বর্তমান সেশনও শেষ — লগইন পেজে পাঠাই
      await signOut({ callbackUrl: '/login' });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'সমস্যা হয়েছে');
      setBusy(false);
    }
  }

  return (
    <section className="card p-5 sm:p-6">
      <h2 className="text-lg font-bold text-slate-900">সেশন নিরাপত্তা</h2>
      <p className="mt-0.5 text-sm text-slate-500">
        অন্য ডিভাইসে লগইন আছে সন্দেহ হলে, সব জায়গা থেকে সাইন-আউট করুন।
      </p>
      {!confirm ? (
        <button onClick={() => setConfirm(true)} className="btn-secondary mt-3 w-full py-2.5">
          সব ডিভাইস থেকে সাইন-আউট
        </button>
      ) : (
        <div className="mt-3 space-y-2">
          <p className="text-sm font-bold text-amber-800">
            এই ব্রাউজারসহ সব জায়গা থেকে সাইন-আউট হবে। আবার লগইন করতে হবে।
          </p>
          <div className="flex gap-2">
            <button onClick={run} disabled={busy} className="btn-secondary flex-1 py-2.5 text-red-600">
              {busy ? '...' : 'হ্যাঁ, সাইন-আউট করুন'}
            </button>
            <button onClick={() => setConfirm(false)} className="btn-secondary px-4 py-2.5">বাতিল</button>
          </div>
        </div>
      )}
    </section>
  );
}
