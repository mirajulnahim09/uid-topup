'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/Toast';
import { fmtDay } from '@/lib/date';

export type StockRow = {
  variantId: number;
  productName: string;
  variantLabel: string;
  available: number;
  assigned: number;
  waiting: number;
};

export type RecentCode = {
  id: string;
  masked: string;
  productName: string;
  variantLabel: string;
  status: 'AVAILABLE' | 'ASSIGNED' | 'VOID';
  orderNo: number | null;
  batch: string | null;
  createdAt: string;
};

const STATUS: Record<RecentCode['status'], { t: string; c: string }> = {
  AVAILABLE: { t: 'স্টকে', c: 'var(--sem-success)' },
  ASSIGNED: { t: 'ডেলিভার্ড', c: 'var(--v-ice)' },
  VOID: { t: 'বাতিল', c: 'var(--v-mut)' },
};

export default function CodeStockManager({ rows, recent }: { rows: StockRow[]; recent: RecentCode[] }) {
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = useTransition();
  const [variantId, setVariantId] = useState<string>(rows[0] ? String(rows[0].variantId) : '');
  const [codes, setCodes] = useState('');
  const [batch, setBatch] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const lineCount = codes.split(/\r?\n/).filter((l) => l.trim()).length;

  async function call(method: 'POST' | 'PATCH', body: unknown) {
    const res = await fetch('/api/admin/codes', {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || 'কাজটি করা যায়নি');
    return d;
  }

  async function upload() {
    if (!variantId) return toast.error('প্যাকেজ বেছে নিন');
    if (lineCount === 0) return toast.error('কোড দিন — প্রতি লাইনে একটি');
    setBusy('upload');
    try {
      const d = await call('POST', { variantId: Number(variantId), codes, batch });
      toast.success(
        `${d.added}টি কোড যোগ হয়েছে` +
          (d.duplicates ? ` · ${d.duplicates}টি ডুপ্লিকেট বাদ` : '') +
          (d.delivered ? ` · ${d.delivered}টি অপেক্ষমাণ অর্ডারে ডেলিভারি` : ''),
      );
      setCodes('');
      setBatch('');
      startTransition(() => router.refresh());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'যোগ করা যায়নি');
    } finally {
      setBusy(null);
    }
  }

  async function deliver(id: number) {
    setBusy(`d${id}`);
    try {
      const d = await call('POST', { variantId: id, action: 'DELIVER' });
      toast.success(d.delivered ? `${d.delivered}টি অর্ডারে কোড দেওয়া হয়েছে` : 'দেওয়ার মতো কোড বা অর্ডার নেই');
      startTransition(() => router.refresh());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ডেলিভারি করা যায়নি');
    } finally {
      setBusy(null);
    }
  }

  async function voidCode(id: string) {
    setBusy(id);
    try {
      await call('PATCH', { id, action: 'VOID' });
      toast.success('কোড বাতিল হয়েছে');
      startTransition(() => router.refresh());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'বাতিল করা যায়নি');
    } finally {
      setBusy(null);
    }
  }

  if (rows.length === 0) {
    return (
      <div className="card p-6 text-sm leading-relaxed" style={{ color: 'var(--v-mut)' }}>
        এখনো কোনো প্রোডাক্টের ডেলিভারির ধরন <b>কোড</b> নয়। অ্যাডমিন → প্রোডাক্ট ও দাম থেকে কোনো প্রোডাক্ট
        (যেমন Netflix, UniPin Voucher) এডিট করে &quot;ডেলিভারির ধরন: কোড&quot; বেছে নিন, তারপর এখানে কোড যোগ করুন।
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* stock overview */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((r) => {
          const low = r.available <= 3;
          return (
            <div key={r.variantId} className="card p-4">
              <p className="truncate text-[13px] font-bold" style={{ color: 'var(--v-ink)' }}>{r.productName}</p>
              <p className="truncate text-xs" style={{ color: 'var(--v-mut)' }}>{r.variantLabel}</p>
              <div className="mt-3 flex items-end justify-between gap-2">
                <div>
                  <p className="text-[26px] font-extrabold leading-none" style={{ color: low ? 'var(--sem-danger)' : 'var(--sem-success)' }}>
                    {r.available}
                  </p>
                  <p className="mt-1 text-[11px]" style={{ color: 'var(--v-mut)' }}>স্টকে · {r.assigned} ডেলিভার্ড</p>
                </div>
                {r.waiting > 0 && (
                  <button type="button" className="btn btn-primary min-h-[38px] px-3 text-xs"
                    disabled={busy === `d${r.variantId}`} onClick={() => deliver(r.variantId)}>
                    {r.waiting}টি অপেক্ষমাণ অর্ডারে দিন
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* upload */}
      <div className="card space-y-4 p-5">
        <h2 className="text-base font-bold" style={{ color: 'var(--v-ink)' }}>নতুন কোড যোগ করুন</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="code-variant">প্যাকেজ</label>
            <select id="code-variant" className="input" value={variantId} onChange={(e) => setVariantId(e.target.value)}>
              {rows.map((r) => (
                <option key={r.variantId} value={r.variantId}>{r.productName} — {r.variantLabel}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="code-batch">ব্যাচ / নোট (ঐচ্ছিক)</label>
            <input id="code-batch" className="input" value={batch} onChange={(e) => setBatch(e.target.value)} placeholder="যেমন: অক্টোবর ক্রয়" />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="code-block">কোড — প্রতি লাইনে একটি</label>
          <textarea id="code-block" className="input min-h-[160px] font-mono text-sm" value={codes}
            onChange={(e) => setCodes(e.target.value)} placeholder={'ABCD-1234-EFGH\nWXYZ-9876-QRST'} spellCheck={false} />
          <p className="mt-1 text-xs" style={{ color: 'var(--v-mut)' }}>
            {lineCount}টি লাইন · একই কোড দুবার যোগ হয় না · যোগ করার পর অপেক্ষমাণ অর্ডারগুলো আগে কোড পায়
          </p>
        </div>
        <button type="button" className="btn btn-primary" disabled={busy === 'upload'} onClick={upload}>
          {busy === 'upload' ? 'যোগ হচ্ছে…' : 'কোড যোগ করুন'}
        </button>
      </div>

      {/* recent */}
      <div className="table-wrap">
        <table className="tbl tbl--stack">
          <thead>
            <tr>
              <th scope="col">কোড</th>
              <th scope="col">প্যাকেজ</th>
              <th scope="col">অবস্থা</th>
              <th scope="col">যোগ</th>
              <th scope="col" className="ctr">অ্যাকশন</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((c) => (
              <tr key={c.id}>
                <td data-label="কোড"><code className="font-mono text-sm">{c.masked}</code></td>
                <td data-label="প্যাকেজ" className="text-sm">{c.productName} — {c.variantLabel}{c.batch ? ` · ${c.batch}` : ''}</td>
                <td data-label="অবস্থা">
                  <span className="text-xs font-bold" style={{ color: STATUS[c.status].c }}>
                    {STATUS[c.status].t}{c.orderNo ? ` · #${c.orderNo}` : ''}
                  </span>
                </td>
                <td data-label="যোগ" className="text-xs">{fmtDay(c.createdAt)}</td>
                <td data-label="অ্যাকশন" className="ctr">
                  {c.status === 'AVAILABLE' ? (
                    <button type="button" className="btn btn-ghost min-h-[34px] px-3 text-xs" disabled={busy === c.id} onClick={() => voidCode(c.id)}>
                      বাতিল
                    </button>
                  ) : '—'}
                </td>
              </tr>
            ))}
            {recent.length === 0 && (
              <tr><td colSpan={5} className="py-8 text-center text-sm" style={{ color: 'var(--v-mut)' }}>এখনো কোনো কোড যোগ হয়নি</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
