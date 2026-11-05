'use client';

import { useRef, useState } from 'react';
import { useToast } from '@/components/Toast';
import CannedPicker from '@/components/admin/CannedPicker';

export default function AnnouncementForm() {
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  // ★ OPS-01 — প্রতি ঘোষণায় একটি অনুরোধ-চিহ্ন: ডাবল-ক্লিক বা নেট কেটে "আবার
  //   চাপা"-তে সবাই দুবার পায় না। লেখা বদলালে বা সফল হলে মুছে যায় (নতুন ঘোষণা)।
  const requestId = useRef('');

  async function send() {
    if (!title.trim() || !body.trim()) return toast.error('শিরোনাম ও বার্তা দুইটাই দিন');
    if (!requestId.current) requestId.current = crypto.randomUUID();
    setBusy(true);
    try {
      const res = await fetch('/api/admin/announce', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), body: body.trim(), link: link.trim() || undefined, requestId: requestId.current }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      toast.success(`ঘোষণা পাঠানো হয়েছে (${d.count} জন)`);
      setTitle('');
      setBody('');
      setLink('');
      requestId.current = '';
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'পাঠানো যায়নি');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-5">
      <h2 className="font-bold text-slate-900">📢 ঘোষণা (Announcement)</h2>
      <p className="mt-1 text-sm text-slate-500">সব ইউজারের নোটিফিকেশনে একসাথে একটি বার্তা পাঠান।</p>
      <div className="mt-4 space-y-3">
        <div>
          <label className="label">শিরোনাম</label>
          <input aria-label="শিরোনাম" className="input" value={title} onChange={(e) => { setTitle(e.target.value); requestId.current = ''; }} maxLength={100} placeholder="যেমন: ঈদ অফার!" />
        </div>
        <div>
          <div className="flex items-center justify-between gap-2">
            <label className="label">বার্তা</label>
            {/* ★ তৈরি বার্তা (3.15) — ঘোষণাতেও একই লাইব্রেরি */}
            <CannedPicker onPick={(t) => { setBody((b) => (b ? `${b} ${t}` : t)); requestId.current = ''; }} />
          </div>
          <textarea aria-label="বার্তা" className="input min-h-[70px]" value={body} onChange={(e) => { setBody(e.target.value); requestId.current = ''; }} maxLength={500} placeholder="বিস্তারিত লিখুন..." />
        </div>
        <div>
          <label className="label">লিংক (ঐচ্ছিক)</label>
          <input aria-label="লিংক (ঐচ্ছিক)" className="input" value={link} onChange={(e) => { setLink(e.target.value); requestId.current = ''; }} maxLength={200} placeholder="/faq বা https://..." />
        </div>
        <button onClick={send} disabled={busy} className="btn-primary">
          {busy ? 'পাঠানো হচ্ছে...' : 'সবাইকে পাঠান'}
        </button>
      </div>
    </div>
  );
}
