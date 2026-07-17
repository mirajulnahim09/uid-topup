'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useToast, ConfirmDialog } from '@/components/Toast';

type C = {
  id: number; code: string; type: string; value: number;
  minOrder: number; maxDiscount: number | null;
  usageLimit: number | null; usageCount: number; perUserLimit: number;
  expiresAt: string | null; isActive: boolean; uses: number;
};

const BLANK = {
  code: '', type: 'PERCENT' as 'PERCENT' | 'FIXED', value: '',
  minOrder: '0', maxDiscount: '', usageLimit: '', perUserLimit: '1', expiresAt: '',
};

export default function CouponManager({ coupons }: { coupons: C[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  const [busy, setBusy] = useState<number | 'new' | null>(null);
  const [form, setForm] = useState(BLANK);
  const [showForm, setShowForm] = useState(false);
  const [del, setDel] = useState<C | null>(null);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [k]: e.target.value });

  async function create() {
    if (!form.code.trim()) return toast.error('কুপন কোড দিন');
    const val = Number(form.value);
    if (isNaN(val) || val <= 0) return toast.error('সঠিক মান দিন');
    if (form.type === 'PERCENT' && val > 100) return toast.error('শতকরা ১০০% এর বেশি হতে পারে না');

    setBusy('new');
    try {
      const res = await fetch('/api/admin/coupon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: form.code.trim().toUpperCase(),
          type: form.type,
          value: val,
          minOrder: Number(form.minOrder || 0),
          maxDiscount: form.maxDiscount ? Number(form.maxDiscount) : null,
          usageLimit: form.usageLimit ? Number(form.usageLimit) : null,
          perUserLimit: Number(form.perUserLimit || 1),
          expiresAt: form.expiresAt || null,
          isActive: true,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);

      setForm(BLANK);
      setShowForm(false);
      toast.success('কুপন তৈরি হয়েছে');
      startTransition(() => router.refresh());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'তৈরি করা যায়নি');
    } finally {
      setBusy(null);
    }
  }

  async function toggle(c: C) {
    setBusy(c.id);
    try {
      const res = await fetch('/api/admin/coupon', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: c.id, isActive: !c.isActive }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      toast.success(c.isActive ? 'কুপন বন্ধ' : 'কুপন চালু');
      startTransition(() => router.refresh());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'কাজটি করা যায়নি');
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!del) return;
    const c = del;
    setDel(null);
    setBusy(c.id);
    try {
      const res = await fetch('/api/admin/coupon', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: c.id }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      toast.success(`কুপন ${c.code} মুছে ফেলা হয়েছে`);
      startTransition(() => router.refresh());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'মুছতে পারিনি');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      {/* ── নতুন কুপন ── */}
      {showForm ? (
        <div className="card space-y-4 p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">নতুন কুপন</h2>
            <button onClick={() => setShowForm(false)} className="btn-ghost px-3 py-1 text-xs">
              ✕ বন্ধ
            </button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="label">কুপন কোড</label>
              <input
                className="input font-mono uppercase"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                placeholder="EID2026"
              />
            </div>

            <div>
              <label className="label">ধরন</label>
              <select className="input" value={form.type} onChange={set('type')}>
                <option value="PERCENT">শতকরা (%)</option>
                <option value="FIXED">নির্দিষ্ট (৳)</option>
              </select>
            </div>

            <div>
              <label className="label">
                মান {form.type === 'PERCENT' ? '(%)' : '(৳)'}
              </label>
              <input
                className="input" type="number" step="0.01"
                value={form.value} onChange={set('value')}
                placeholder={form.type === 'PERCENT' ? '10' : '50'}
              />
            </div>

            <div>
              <label className="label">সর্বনিম্ন অর্ডার (৳)</label>
              <input
                className="input" type="number" step="0.01"
                value={form.minOrder} onChange={set('minOrder')}
                placeholder="0"
              />
            </div>

            {form.type === 'PERCENT' && (
              <div>
                <label className="label">সর্বোচ্চ ছাড় (৳)</label>
                <input
                  className="input" type="number" step="0.01"
                  value={form.maxDiscount} onChange={set('maxDiscount')}
                  placeholder="সীমা নেই"
                />
              </div>
            )}

            <div>
              <label className="label">মোট ব্যবহার সীমা</label>
              <input
                className="input" type="number"
                value={form.usageLimit} onChange={set('usageLimit')}
                placeholder="আনলিমিটেড"
              />
            </div>

            <div>
              <label className="label">প্রতি ইউজার সীমা</label>
              <input
                className="input" type="number"
                value={form.perUserLimit} onChange={set('perUserLimit')}
              />
            </div>

            <div>
              <label className="label">মেয়াদ শেষ</label>
              <input
                className="input" type="date"
                value={form.expiresAt} onChange={set('expiresAt')}
              />
            </div>
          </div>

          <button onClick={create} disabled={busy === 'new'} className="btn-primary">
            {busy === 'new' ? 'তৈরি হচ্ছে...' : 'কুপন তৈরি করুন'}
          </button>
        </div>
      ) : (
        <button onClick={() => setShowForm(true)} className="btn-primary">
          + নতুন কুপন তৈরি করুন
        </button>
      )}

      {/* ── কুপন তালিকা ── */}
      <div className="table-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th scope="col">কোড</th>
              <th scope="col">ছাড়</th>
              <th scope="col" className="text-right">সর্বনিম্ন অর্ডার</th>
              <th scope="col" className="text-right">ব্যবহার</th>
              <th scope="col">প্রতি ইউজার</th>
              <th scope="col">মেয়াদ</th>
              <th scope="col">স্ট্যাটাস</th>
              <th scope="col" className="text-right">অ্যাকশন</th>
            </tr>
          </thead>
          <tbody>
            {coupons.map((c: (typeof coupons)[number]) => {
              const expired = c.expiresAt && new Date(c.expiresAt) < new Date();
              const exhausted = c.usageLimit !== null && c.usageCount >= c.usageLimit;

              return (
                <tr key={c.id}>
                  <td>
                    <code className="rounded bg-slate-100 px-2 py-1 font-mono text-sm font-bold text-purple-700">
                      {c.code}
                    </code>
                  </td>
                  <td className="text-sm font-semibold text-emerald-600">
                    {c.type === 'PERCENT' ? (
                      <>
                        {c.value}%
                        {c.maxDiscount && (
                          <span className="ml-1 text-[10px] font-normal text-slate-400">
                            (সর্বোচ্চ ৳{c.maxDiscount})
                          </span>
                        )}
                      </>
                    ) : (
                      `৳${c.value.toFixed(2)}`
                    )}
                  </td>
                  <td className="whitespace-nowrap text-right text-slate-400">
                    {c.minOrder > 0 ? `৳${c.minOrder.toFixed(2)}` : '—'}
                  </td>
                  <td className="whitespace-nowrap text-right">
                    <span className={exhausted ? 'text-red-600' : 'text-slate-900'}>
                      {c.usageCount}
                    </span>
                    <span className="text-slate-400"> / {c.usageLimit ?? '∞'}</span>
                  </td>
                  <td className="text-center text-slate-400">{c.perUserLimit}</td>
                  <td className="whitespace-nowrap text-xs">
                    {c.expiresAt ? (
                      <span className={expired ? 'text-red-600' : 'text-slate-400'}>
                        {new Date(c.expiresAt).toLocaleDateString('en-GB', {
                          day: '2-digit', month: 'short', year: 'numeric',
                        })}
                        {expired && ' (শেষ)'}
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td>
                    <button
                      disabled={busy === c.id}
                      onClick={() => toggle(c)}
                      className={`badge ${
                        c.isActive
                          ? 'border border-emerald-200 bg-emerald-100 text-emerald-700'
                          : 'border border-slate-200 bg-slate-100 text-slate-400'
                      }`}
                    >
                      {c.isActive ? '● চালু' : '○ বন্ধ'}
                    </button>
                  </td>
                  <td className="text-right">
                    <button
                      disabled={busy === c.id || c.uses > 0}
                      onClick={() => setDel(c)}
                      title={c.uses > 0 ? 'ব্যবহৃত কুপন মুছা যায় না' : 'ডিলিট'}
                      className="btn-danger px-3 py-1 text-xs disabled:opacity-30"
                    >
                      🗑
                    </button>
                  </td>
                </tr>
              );
            })}
            {coupons.length === 0 && (
              <tr>
                <td colSpan={8} className="py-14 text-center text-slate-400">
                  কোনো কুপন নেই — উপরে থেকে তৈরি করুন
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={Boolean(del)}
        title={`কুপন ${del?.code} মুছে ফেলবেন?`}
        message="এটি স্থায়ীভাবে মুছে যাবে।"
        confirmLabel="হ্যাঁ, মুছুন"
        danger
        onConfirm={remove}
        onCancel={() => setDel(null)}
      />
    </div>
  );
}
