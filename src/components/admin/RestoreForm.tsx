'use client';

import { useState } from 'react';
import { useToast } from '@/components/Toast';

export default function RestoreForm() {
  const toast = useToast();
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [fileName, setFileName] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (!parsed?._meta) throw new Error('অবৈধ ব্যাকআপ');
        setData(parsed);
        setFileName(f.name);
        toast.success('ব্যাকআপ ফাইল পড়া হয়েছে');
      } catch {
        setData(null);
        setFileName('');
        toast.error('ফাইলটি সঠিক ব্যাকআপ নয়');
      }
    };
    reader.readAsText(f);
  }

  async function restore() {
    if (!data) return toast.error('আগে ব্যাকআপ ফাইল নির্বাচন করুন');
    if (confirmText !== 'RESTORE') return toast.error('নিশ্চিত করতে বড় হাতে RESTORE লিখুন');
    setBusy(true);
    try {
      const res = await fetch('/api/admin/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: 'RESTORE', data }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      toast.success('Restore সম্পন্ন হয়েছে');
      setData(null);
      setFileName('');
      setConfirmText('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Restore করা যায়নি');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-5">
      <h2 className="font-bold text-slate-900">♻️ ব্যাকআপ থেকে Restore</h2>
      <p className="mt-1 text-sm text-slate-500">
        আগের ব্যাকআপ JSON থেকে <strong>শপ কনফিগ ও ক্যাটালগ</strong> (প্রোডাক্ট, দাম, ক্যাটাগরি, ব্যানার, সেটিংস, কুপন) ফিরিয়ে আনে।
      </p>

      <div className="mt-4 space-y-3">
        <input type="file" aria-label="ব্যাকআপ JSON ফাইল বাছুন" accept="application/json,.json" onChange={onFile}
          /* ★ `text-sm` (১৪px) ছিল — টাচ-পর্দায় iOS ফাইল-ইনপুটে ফোকাস
             করলেই পাতা জুম করত (শেষ অবশিষ্ট জুম-ইনপুট, ৭টি হিট)।
             ১৬px-এ তুললে জুম হয় না; দেখতে প্রায় একই। */
          className="flex min-h-[40px] w-full items-center text-base text-slate-400 file:mr-3 file:min-h-[40px] file:rounded-lg file:border-0 file:bg-[rgba(139,92,246,0.2)] file:px-4 file:text-sm file:font-semibold file:text-white" />
        {fileName && <p className="text-xs text-emerald-400">✓ {fileName}</p>}

        <div>
          <label htmlFor="restore-confirm" className="label">নিশ্চিতকরণ — বড় হাতে <code>RESTORE</code> লিখুন</label>
          <input id="restore-confirm" className="input" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="RESTORE" />
        </div>

        <button onClick={restore} disabled={busy || !data} className="btn-danger">
          {busy ? 'Restore হচ্ছে...' : '♻️ Restore করুন'}
        </button>
      </div>

      <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-700">
        ⚠️ নিরাপত্তার জন্য ইউজার / অর্ডার / রিচার্জ / লেনদেন Restore করা হয় না — শুধু শপ কনফিগ ও ক্যাটালগ। বিদ্যমান প্রোডাক্ট/দাম ব্যাকআপের মান দিয়ে আপডেট হবে।
      </p>
    </div>
  );
}
