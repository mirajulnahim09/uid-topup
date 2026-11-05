'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Badge from '@/components/Badge';
import { useToast, ConfirmDialog } from '@/components/Toast';
import { fmtDate } from '@/lib/date';
import { depositRejectOptions, DEPOSIT_REJECT_COPY } from '@/lib/rejectReasons';
import CopyButton from '@/components/admin/CopyButton';

type D = {
  id: string; depositNo: number; method: string; amount: number;
  trxId: string; senderNo: string; screenshot: string | null;
  status: string; adminNote: string | null; createdAt: string;
  user: { name: string; phone: string; balance: number };
};

const FILTERS = ['ALL', 'PENDING', 'APPROVED', 'REJECTED'];

export default function DepositTable({ deposits, current }: { deposits: D[]; current: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  const [busy, setBusy] = useState<string | null>(null);
  const [dlg, setDlg] = useState<{ d: D; action: 'APPROVE' | 'REJECT' } | null>(null);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState<string>('TRX_NOT_FOUND');
  const [zoom, setZoom] = useState<string | null>(null);
  const reasonOpts = depositRejectOptions();
  const noteRequired = reasonOpts.find((o) => o.value === reason)?.requiresNote ?? false;

  function open(d: D, action: 'APPROVE' | 'REJECT') {
    // ★ নোট আর প্রি-ফিল করা হয় না — কাঠামোবদ্ধ কারণ বাছলে সিস্টেম
    //   নিজেই সুনির্দিষ্ট বার্তা বানায়। আগে প্রি-ফিল করা "ট্রানজেকশন
    //   যাচাই করা যায়নি" ই বেশিরভাগ সময় গ্রাহকের কাছে যেত।
    setNote('');
    setReason('TRX_NOT_FOUND');
    setDlg({ d, action });
  }

  async function run() {
    if (!dlg) return;
    const { d, action } = dlg;
    setDlg(null);
    setBusy(d.id);

    try {
      const res = await fetch('/api/admin/deposit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          depositId: d.id,
          action,
          adminNote: note.trim() || undefined,
          ...(action === 'REJECT' ? { rejectReason: reason } : {}),
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error);

      toast.success(
        action === 'APPROVE'
          ? `#${d.depositNo} অনুমোদিত — ৳${d.amount.toFixed(2)} যোগ হয়েছে`
          : `#${d.depositNo} বাতিল করা হয়েছে`
      );
      startTransition(() => router.refresh());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'কাজটি করা যায়নি');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f: (typeof FILTERS)[number]) => (
          <Link
            key={f}
            href={f === 'ALL' ? '/admin/deposits' : `/admin/deposits?status=${f}`}
            className={`inline-flex min-h-[40px] items-center rounded-lg px-3.5 text-xs font-semibold transition ${
              current === f ? 'bg-purple-600 text-white shadow-sm' : 'bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-900'
            }`}
          >
            {f}
          </Link>
        ))}
      </div>

      <div className="table-wrap">
        <table className="tbl tbl--stack">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">ইউজার</th>
              <th scope="col">মাধ্যম</th>
              <th scope="col" className="num">পরিমাণ</th>
              <th scope="col">TrxID</th>
              <th scope="col">প্রেরক</th>
              <th scope="col">প্রমাণ</th>
              <th scope="col" className="ctr">স্ট্যাটাস</th>
              <th scope="col">সময়</th>
              <th scope="col" className="ctr">অ্যাকশন</th>
            </tr>
          </thead>
          <tbody>
            {deposits.map((d: (typeof deposits)[number]) => (
              <tr key={d.id} className={d.status === 'PENDING' ? 'bg-amber-50' : ''}>
                <td data-label="ডিপোজিট" className="font-mono font-semibold text-rose-600">#{d.depositNo}</td>
                <td data-label="ইউজার">
                  <div className="text-sm font-medium text-slate-900">{d.user.name}</div>
                  <div className="text-xs text-slate-400">{d.user.phone}</div>
                  <div className="text-[11px] text-emerald-600/70">
                    ব্যালেন্স ৳{d.user.balance.toFixed(2)}
                  </div>
                </td>
                <td data-label="মাধ্যম" className="text-xs font-bold">{d.method}</td>
                <td data-label="পরিমাণ" className="whitespace-nowrap num text-base font-bold text-emerald-600">
                  ৳{d.amount.toFixed(2)}
                </td>
                <td data-label="TrxID">
                  {/* ★ ইতিহাসেও কপি দরকার — পুরনো লেনদেন যাচাই করতে (3.4) */}
                  <span className="inline-flex items-center gap-1.5">
                    <code className="rounded bg-slate-100 px-2 py-1 font-mono text-xs text-amber-700">
                      <span className="break-all">{d.trxId}</span>
                    </code>
                    <CopyButton value={d.trxId} label="TrxID" />
                  </span>
                </td>
                <td data-label="প্রেরক" className="font-mono text-xs">{d.senderNo}</td>
                <td data-label="প্রমাণ">
                  {d.screenshot ? (
                    <button
                      onClick={() => setZoom(d.screenshot)}
                      aria-label="স্ক্রিনশট দেখুন"
                      className="overflow-hidden rounded border border-slate-200 transition hover:border-[color:var(--violet)]"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={d.screenshot} alt="" className="h-10 w-10 object-cover" />
                    </button>
                  ) : (
                    <span className="text-xs text-slate-400">—</span>
                  )}
                </td>
                <td data-label="স্ট্যাটাস" className="ctr">
                  <Badge status={d.status} />
                  {d.adminNote && (
                    <div className="mt-1 max-w-[130px] text-[11px] text-slate-400">{d.adminNote}</div>
                  )}
                </td>
                <td data-label="সময়" className="whitespace-nowrap text-xs text-slate-400">{fmtDate(d.createdAt)}</td>
                <td className="ctr">
                  {d.status === 'PENDING' ? (
                    <div className="tbl-actions">
                      <button
                        disabled={busy === d.id}
                        onClick={() => open(d, 'APPROVE')}
                        className="btn-success px-3 py-1.5 text-xs"
                      >
                        ✓ অনুমোদন
                      </button>
                      <button
                        disabled={busy === d.id}
                        onClick={() => open(d, 'REJECT')}
                        className="btn-danger px-3 py-1.5 text-xs"
                      >
                        ✕ বাতিল
                      </button>
                    </div>
                  ) : (
                    <span className="text-xs text-slate-400">প্রসেসড</span>
                  )}
                </td>
              </tr>
            ))}
            {deposits.length === 0 && (
              <tr>
                <td colSpan={10} className="py-14 ctr text-slate-400">
                  কোনো ডিপোজিট রিকোয়েস্ট নেই
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={Boolean(dlg)}
        title={
          dlg?.action === 'APPROVE'
            ? `ডিপোজিট #${dlg.d.depositNo} অনুমোদন করবেন?`
            : `ডিপোজিট #${dlg?.d.depositNo} বাতিল করবেন?`
        }
        message={
          dlg?.action === 'APPROVE'
            ? `৳${dlg.d.amount.toFixed(2)} — ${dlg.d.user.name}\nTrxID: ${dlg.d.trxId}\nপ্রেরক: ${dlg.d.senderNo}\n\n⚠️ bKash/Nagad অ্যাপে TrxID যাচাই করেছেন তো?`
            : undefined
        }
        confirmLabel={dlg?.action === 'APPROVE' ? 'হ্যাঁ, অনুমোদন করুন' : 'হ্যাঁ, বাতিল করুন'}
        danger={dlg?.action === 'REJECT'}
        onConfirm={run}
        onCancel={() => setDlg(null)}
      >
        {/* ★ বাতিলের কারণ — বাছাই করলেই গ্রাহক সুনির্দিষ্ট ও কাজের
            বার্তা পায়, অ্যাডমিনকে হাতে কিছু লিখতে হয় না */}
        {dlg?.action === 'REJECT' && (
          <>
            <label htmlFor="dep-reason" className="label">বাতিলের কারণ</label>
            <select
              id="dep-reason"
              className="input mb-3"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            >
              {reasonOpts.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <p className="mb-3 rounded-lg border border-[var(--hair)] p-2.5 text-[11px] leading-relaxed"
              style={{ background: 'var(--v-steel)', color: 'var(--mut)' }}>
              গ্রাহক যা দেখবে:{' '}
              <span style={{ color: 'var(--ink)' }}>
                {DEPOSIT_REJECT_COPY[reason as keyof typeof DEPOSIT_REJECT_COPY]?.customerMessage
                  || '(আপনার নোটই বার্তা হিসেবে যাবে)'}
              </span>
            </p>
          </>
        )}

        <label htmlFor="dep-note" className="label">
          নোট {dlg?.action === 'REJECT' && (noteRequired ? '(বাধ্যতামূলক)' : '(ঐচ্ছিক)')}
        </label>
        <input
          id="dep-note"
          className="input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={
            dlg?.action === 'REJECT'
              ? noteRequired ? 'কারণ লিখুন — গ্রাহক এটাই দেখবে' : 'অতিরিক্ত তথ্য (ঐচ্ছিক)'
              : 'ঐচ্ছিক নোট'
          }
        />
      </ConfirmDialog>

      {zoom && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="স্ক্রিনশট"
          className="fixed inset-0 z-[95] grid place-items-center bg-slate-900/80 p-4"
          onClick={() => setZoom(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoom} alt="পেমেন্ট স্ক্রিনশট" className="max-h-full max-w-full rounded-lg object-contain" />
          <button
            onClick={() => setZoom(null)}
            aria-label="বন্ধ করুন"
            className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-full bg-white/20 text-slate-900 backdrop-blur hover:bg-white/20"
          >
            ✕
          </button>
        </div>
      )}
    </>
  );
}
