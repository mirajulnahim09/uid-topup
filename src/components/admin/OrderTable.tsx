'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Badge from '@/components/Badge';
import { useToast, ConfirmDialog } from '@/components/Toast';
import { fmtDate } from '@/lib/date';

type O = {
  id: string; orderNo: number; productName: string; variantName: string;
  playerUid: string; playerName: string | null;
  discount: number; price: number;
  status: string; adminNote: string | null; internalNote: string | null; createdAt: string;
  user: { name: string; phone: string };
};

const FILTERS = ['ALL', 'PENDING', 'PROCESSING', 'COMPLETED', 'REFUNDED'];
type Act = 'PROCESSING' | 'COMPLETE' | 'FAIL';

export default function OrderTable({ orders, current }: { orders: O[]; current: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [dlg, setDlg] = useState<{ o: O; action: Act } | null>(null);
  const [note, setNote] = useState('');
  const [pname, setPname] = useState('');
  const [inote, setInote] = useState('');

  function copyUid(uid: string) {
    navigator.clipboard
      .writeText(uid)
      .then(() => {
        setCopied(uid);
        toast.success('UID কপি হয়েছে');
        setTimeout(() => setCopied(null), 1800);
      })
      .catch(() => toast.error('কপি করা যায়নি'));
  }

  function open(o: O, action: Act) {
    setNote(action === 'FAIL' ? 'ভুল UID / টপ আপ করা যায়নি' : '');
    setPname(o.playerName ?? '');
    setInote(o.internalNote ?? '');
    setDlg({ o, action });
  }

  async function run() {
    if (!dlg) return;
    const { o, action } = dlg;
    setDlg(null);
    setBusy(o.id);

    try {
      const res = await fetch('/api/admin/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: o.id,
          action,
          adminNote: note.trim() || undefined,
          playerName: pname.trim() || undefined,
          internalNote: inote.trim() || undefined,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error);

      toast.success(
        action === 'COMPLETE'
          ? `অর্ডার #${o.orderNo} সম্পন্ন`
          : action === 'FAIL'
          ? `অর্ডার #${o.orderNo} বাতিল — ৳${o.price.toFixed(2)} ফেরত`
          : `অর্ডার #${o.orderNo} প্রসেসিং`
      );
      startTransition(() => router.refresh());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'কাজটি করা যায়নি');
    } finally {
      setBusy(null);
    }
  }

  const title =
    dlg?.action === 'COMPLETE'
      ? `অর্ডার #${dlg.o.orderNo} সম্পন্ন করবেন?`
      : dlg?.action === 'FAIL'
      ? `অর্ডার #${dlg?.o.orderNo} বাতিল করবেন?`
      : `অর্ডার #${dlg?.o.orderNo} প্রসেসিং শুরু?`;

  const msg =
    dlg?.action === 'COMPLETE'
      ? `${dlg.o.productName}\n${dlg.o.variantName}\nUID: ${dlg.o.playerUid}\n\n⚠️ গেমে টপ আপ দিয়েছেন তো?`
      : dlg?.action === 'FAIL'
      ? `৳${dlg.o.price.toFixed(2)} ইউজারের ওয়ালেটে ফেরত যাবে।${
          dlg.o.discount > 0 ? '\nকুপনটিও ফেরত যাবে।' : ''
        }`
      : undefined;

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f: (typeof FILTERS)[number]) => (
          <Link
            key={f}
            href={f === 'ALL' ? '/admin/orders' : `/admin/orders?status=${f}`}
            className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition ${
              current === f ? 'bg-purple-600 text-white shadow-sm' : 'bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-900'
            }`}
          >
            {f}
          </Link>
        ))}
      </div>

      <div className="table-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">ইউজার</th>
              <th scope="col">প্রোডাক্ট</th>
              <th scope="col">UID</th>
              <th scope="col" className="text-right">মূল্য</th>
              <th scope="col">স্ট্যাটাস</th>
              <th scope="col">সময়</th>
              <th scope="col" className="text-right">অ্যাকশন</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o: (typeof orders)[number]) => {
              const live = o.status === 'PENDING' || o.status === 'PROCESSING';
              return (
                <tr key={o.id} className={live ? 'bg-blue-50' : ''}>
                  <td className="font-mono font-semibold text-rose-600">#{o.orderNo}</td>
                  <td>
                    <div className="text-sm font-medium text-slate-900">{o.user.name}</div>
                    <div className="text-xs text-slate-400">{o.user.phone}</div>
                  </td>
                  <td>
                    <div className="text-sm font-medium text-slate-900">{o.productName}</div>
                    <div className="text-xs text-rose-600">{o.variantName}</div>
                  </td>
                  <td>
                    <button
                      onClick={() => copyUid(o.playerUid)}
                      title="কপি করুন"
                      className="rounded bg-slate-100 px-2 py-1 font-mono text-xs text-amber-700 transition hover:bg-slate-100"
                    >
                      {copied === o.playerUid ? '✓ কপি' : o.playerUid}
                    </button>
                    {o.playerName && (
                      <div className="mt-1 text-[11px] text-slate-400">{o.playerName}</div>
                    )}
                  </td>
                  <td className="whitespace-nowrap text-right">
                    <div className="font-bold text-slate-900">৳{o.price.toFixed(2)}</div>
                    {o.discount > 0 && (
                      <div className="text-[10px] text-emerald-600">−৳{o.discount.toFixed(2)}</div>
                    )}
                  </td>
                  <td>
                    <Badge status={o.status} />
                    {o.adminNote && (
                      <div className="mt-1 max-w-[130px] text-[11px] text-slate-400">{o.adminNote}</div>
                    )}
                    {o.internalNote && (
                      <div className="mt-1 max-w-[130px] text-[11px] text-amber-400">🔒 {o.internalNote}</div>
                    )}
                  </td>
                  <td className="whitespace-nowrap text-xs text-slate-400">{fmtDate(o.createdAt)}</td>
                  <td className="text-right">
                    {live ? (
                      <div className="flex justify-end gap-1.5">
                        {o.status === 'PENDING' && (
                          <button
                            disabled={busy === o.id}
                            onClick={() => open(o, 'PROCESSING')}
                            title="প্রসেসিং"
                            className="btn-ghost px-2.5 py-1.5 text-xs"
                          >
                            ⏳
                          </button>
                        )}
                        <button
                          disabled={busy === o.id}
                          onClick={() => open(o, 'COMPLETE')}
                          className="btn-success px-3 py-1.5 text-xs"
                        >
                          ✓ সম্পন্ন
                        </button>
                        <button
                          disabled={busy === o.id}
                          onClick={() => open(o, 'FAIL')}
                          className="btn-danger px-3 py-1.5 text-xs"
                        >
                          ✕ বাতিল
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400">ক্লোজড</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {orders.length === 0 && (
              <tr>
                <td colSpan={8} className="py-14 text-center text-slate-400">কোনো অর্ডার নেই</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={Boolean(dlg)}
        title={title}
        message={msg}
        confirmLabel="নিশ্চিত"
        danger={dlg?.action === 'FAIL'}
        onConfirm={run}
        onCancel={() => setDlg(null)}
      >
        {dlg?.action === 'COMPLETE' && (
          <div className="mb-3">
            <label className="label">প্লেয়ার নাম (ঐচ্ছিক)</label>
            <input aria-label="প্লেয়ার নাম (ঐচ্ছিক)"
              className="input"
              value={pname}
              onChange={(e) => setPname(e.target.value)}
              placeholder="গেমে দেখা নাম"
            />
          </div>
        )}
        <div>
          <label className="label">নোট (কাস্টমার দেখবে) {dlg?.action === 'FAIL' && '(কারণ)'}</label>
          <input aria-label="নোট (কাস্টমার দেখবে) {dlg?.action === 'FAIL' && '(কারণ)'}"
            className="input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={dlg?.action === 'FAIL' ? 'বাতিলের কারণ' : 'ঐচ্ছিক'}
          />
        </div>
        <div className="mt-3">
          <label className="label">🔒 ইনটারনাল নোট (শুধু অ্যাডমিন — কাস্টমার দেখবে না)</label>
          <input aria-label="🔒 ইনটারনাল নোট (শুধু অ্যাডমিন — কাস্টমার দেখবে না)"
            className="input"
            value={inote}
            onChange={(e) => setInote(e.target.value)}
            placeholder="গোপন নোট, ঐচ্ছিক"
          />
        </div>
      </ConfirmDialog>
    </>
  );
}
