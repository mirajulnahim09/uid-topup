'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/Toast';

export default function MaintenanceToggle({
  initialOn,
  initialMsg,
}: {
  initialOn: boolean;
  initialMsg: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [on, setOn] = useState(initialOn);
  const [msg, setMsg] = useState(initialMsg);
  const [saving, setSaving] = useState(false);

  async function save(nextOn: boolean) {
    setSaving(true);
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          maintenance_mode: nextOn ? '1' : '0',
          maintenance_message: msg,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'সমস্যা হয়েছে');
        return;
      }
      setOn(nextOn);
      toast.success(nextOn ? 'সাইট এখন রক্ষণাবেক্ষণ মোডে' : 'সাইট আবার চালু');
      router.refresh();
    } catch {
      toast.error('চেষ্টা করা যায়নি');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-bold text-slate-900">রক্ষণাবেক্ষণ মোড (Maintenance)</h2>
          <p className="mt-1 text-sm text-slate-500">
            চালু করলে অ্যাডমিন ছাড়া কেউ সাইট দেখতে পারবে না। আপনি স্বাভাবিকভাবে দেখতে পারবেন।
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${
            on ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
          }`}
        >
          {on ? '🛠️ বন্ধ আছে' : '🟢 চালু আছে'}
        </span>
      </div>

      <div className="mt-4">
        <label htmlFor="mmsg" className="label">কাস্টমার কে যে বার্তা দেখাবে</label>
        <textarea
          id="mmsg"
          className="input min-h-[70px]"
          value={msg}
          onChange={(e) => setMsg(e.target.value)}
          placeholder="সাইটটি সাময়িকভাবে বন্ধ আছে। শীঘ্রই ফিরে আসছি।"
          maxLength={300}
        />
      </div>

      <div className="mt-4 flex gap-3">
        {on ? (
          <button onClick={() => save(false)} disabled={saving} className="btn-success">
            {saving ? '...' : 'সাইট আবার চালু করুন'}
          </button>
        ) : (
          <button onClick={() => save(true)} disabled={saving} className="btn-danger">
            {saving ? '...' : 'রক্ষণাবেক্ষণ মোড চালু করুন'}
          </button>
        )}
        {on && (
          <button onClick={() => save(true)} disabled={saving} className="btn-ghost">
            শুধু বার্তা সেভ করুন
          </button>
        )}
      </div>
    </div>
  );
}
