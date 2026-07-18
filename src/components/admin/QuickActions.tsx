'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useToast, ConfirmDialog } from '@/components/Toast';
import { fmtDate } from '@/lib/date';

type D = {
  id: string; depositNo: number; method: string; amount: number;
  trxId: string; senderNo: string; screenshot: string | null;
  createdAt: string; user: { name: string; phone: string };
};
type O = {
  id: string; orderNo: number; productName: string; variantName: string;
  playerUid: string; playerName: string | null; price: number;
  createdAt: string; user: { name: string; phone: string };
};

/**
 * ★ ড্যাশবোর্ড থেকেই কাজ শেষ করা যায় — অন্য পেজে যেতে হয় না।
 */
export default function QuickActions({
  deposits, orders,
}: {
  deposits: D[];
  orders: O[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  const [busy, setBusy] = useState<string | null>(null);
  const [zoom, setZoom] = useState<string | null>(null);
  const [dep, setDep] = useState<{ d: D; action: 'APPROVE' | 'REJECT' } | null>(null);
  const [ord, setOrd] = useState<{ o: O; action: 'COMPLETE' | 'FAIL' } | null>(null);
  const [note, setNote] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

  function copy(text: string) {
    navigator.clipboard.writeText(text)
      .then(() => {
        setCopied(text);
        toast.success('কপি হয়েছে');
        setTimeout(() => setCopied(null), 1500);
      })
      .catch(() => toast.error('কপি করা যায়নি'));
  }

  async function runDeposit() {
    if (!dep) return;
    const { d, action } = dep;
    setDep(null);
    setBusy(d.id);
    try {
      const res = await fetch('/api/admin/deposit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ depositId: d.id, action, adminNote: note.trim() || undefined }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error);
      toast.success(
        action === 'APPROVE'
          ? `৳${d.amount.toFixed(2)} যোগ হয়েছে — ${d.user.name}`
          : `#${d.depositNo} বাতিল`
      );
      startTransition(() => router.refresh());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'কাজটি করা যায়নি');
    } finally {
      setBusy(null);
    }
  }

  async function runOrder() {
    if (!ord) return;
    const { o, action } = ord;
    setOrd(null);
    setBusy(o.id);
    try {
      const res = await fetch('/api/admin/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: o.id, action, adminNote: note.trim() || undefined }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error);
      toast.success(
        action === 'COMPLETE'
          ? `অর্ডার #${o.orderNo} সম্পন্ন`
          : `অর্ডার #${o.orderNo} বাতিল — ৳${o.price.toFixed(2)} ফেরত`
      );
      startTransition(() => router.refresh());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'কাজটি করা যায়নি');
    } finally {
      setBusy(null);
    }
  }

  if (deposits.length === 0 && orders.length === 0) {
    return (
      <div className="card border-2 border-emerald-200 bg-emerald-50 p-8 text-center">
        <p className="text-4xl" aria-hidden="true">✅</p>
        <p className="mt-2 text-lg font-bold text-emerald-800">সব কাজ শেষ!</p>
        <p className="mt-1 text-sm text-emerald-600">
          কোনো পেন্ডিং ডিপোজিট বা অর্ডার নেই।
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="grid gap-5 lg:grid-cols-2">
        {/* ══ টাকা যোগ (ডিপোজিট) ══ */}
        <section className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-200 bg-amber-50 px-5 py-3.5">
            <h2 className="flex items-center gap-2 font-bold text-slate-900">
              <span aria-hidden="true">💰</span>
              টাকা যোগের অপেক্ষায়
              {deposits.length > 0 && (
                <span className="rounded-full bg-red-500 px-2 py-0.5 text-xs font-bold text-white">
                  {deposits.length}
                </span>
              )}
            </h2>
            <Link href="/admin/deposits" className="text-xs font-semibold text-purple-600 hover:underline">
              সব দেখুন →
            </Link>
          </div>

          <div className="divide-y divide-slate-100">
            {deposits.length === 0 ? (
              <p className="p-8 text-center text-sm text-slate-400">কোনো পেন্ডিং নেই ✓</p>
            ) : (
              deposits.map((d) => (
                <div key={d.id} className="p-4">
                  <div className="flex items-start gap-3">
                    {d.screenshot ? (
                      <button
                        onClick={() => setZoom(d.screenshot)}
                        aria-label="স্ক্রিনশট বড় করে দেখুন"
                        className="h-14 w-14 shrink-0 overflow-hidden rounded-lg border-2 border-slate-200 transition hover:border-purple-400"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={d.screenshot} alt="" className="h-full w-full object-cover" />
                      </button>
                    ) : (
                      <div className="grid h-14 w-14 shrink-0 place-items-center rounded-lg border-2 border-dashed border-slate-200 text-[10px] text-slate-400">
                        ছবি নেই
                      </div>
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="truncate text-sm font-bold text-slate-900">{d.user.name}</p>
                        <p className="shrink-0 text-lg font-extrabold text-emerald-600">
                          ৳{d.amount.toFixed(2)}
                        </p>
                      </div>

                      <p className="text-xs text-slate-500">{d.user.phone} · {d.method}</p>

                      <button
                        onClick={() => copy(d.trxId)}
                        title="TrxID কপি করুন"
                        className="mt-1 rounded bg-amber-50 px-2 py-1 font-mono text-xs font-bold text-amber-700 transition hover:bg-amber-100"
                      >
                        {copied === d.trxId ? '✓ কপি' : `TrxID: ${d.trxId}`}
                      </button>

                      <p className="mt-1 text-[11px] text-slate-400">
                        প্রেরক {d.senderNo} · {fmtDate(d.createdAt)}
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 flex gap-2">
                    <button
                      disabled={busy === d.id}
                      onClick={() => {
                        setNote('');
                        setDep({ d, action: 'APPROVE' });
                      }}
                      className="btn-success flex-1 py-2 text-xs"
                    >
                      ✓ টাকা যোগ করুন
                    </button>
                    <button
                      disabled={busy === d.id}
                      onClick={() => {
                        setNote('ট্রানজেকশন যাচাই করা যায়নি');
                        setDep({ d, action: 'REJECT' });
                      }}
                      className="btn-danger px-4 py-2 text-xs"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        {/* ══ অর্ডার ══ */}
        <section className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-200 bg-blue-50 px-5 py-3.5">
            <h2 className="flex items-center gap-2 font-bold text-slate-900">
              <span aria-hidden="true">📦</span>
              টপ আপ করা বাকি
              {orders.length > 0 && (
                <span className="rounded-full bg-red-500 px-2 py-0.5 text-xs font-bold text-white">
                  {orders.length}
                </span>
              )}
            </h2>
            <Link href="/admin/orders" className="text-xs font-semibold text-purple-600 hover:underline">
              সব দেখুন →
            </Link>
          </div>

          <div className="divide-y divide-slate-100">
            {orders.length === 0 ? (
              <p className="p-8 text-center text-sm text-slate-400">কোনো পেন্ডিং নেই ✓</p>
            ) : (
              orders.map((o) => (
                <div key={o.id} className="p-4">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="truncate text-sm font-bold text-slate-900">{o.productName}</p>
                    <p className="shrink-0 text-sm font-bold text-slate-700">
                      ৳{o.price.toFixed(2)}
                    </p>
                  </div>
                  <p className="text-xs font-semibold text-rose-600">{o.variantName}</p>

                  {/* ★ সবচেয়ে জরুরি — UID, বড় করে, এক ক্লিকে কপি */}
                  <button
                    onClick={() => copy(o.playerUid)}
                    title="UID কপি করুন — গেমে পেস্ট করুন"
                    className="mt-2 w-full rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-left transition hover:border-purple-400 hover:bg-purple-50"
                  >
                    <span className="block text-[10px] font-bold uppercase text-slate-400">
                      Player UID {copied === o.playerUid && '— ✓ কপি হয়েছে'}
                    </span>
                    <span className="block font-mono text-base font-bold text-slate-900">
                      {o.playerUid}
                    </span>
                  </button>

                  <p className="mt-1.5 text-[11px] text-slate-400">
                    {o.user.name} · {o.user.phone}
                    {o.playerName && ` · নাম: ${o.playerName}`}
                    {' · '}{fmtDate(o.createdAt)}
                  </p>

                  <div className="mt-3 flex gap-2">
                    <button
                      disabled={busy === o.id}
                      onClick={() => {
                        setNote('');
                        setOrd({ o, action: 'COMPLETE' });
                      }}
                      className="btn-success flex-1 py-2 text-xs"
                    >
                      ✓ টপ আপ দিয়েছি
                    </button>
                    <button
                      disabled={busy === o.id}
                      onClick={() => {
                        setNote('টপ আপ করা যায়নি');
                        setOrd({ o, action: 'FAIL' });
                      }}
                      className="btn-danger px-4 py-2 text-xs"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      {/* ── ডিপোজিট ডায়ালগ ── */}
      <ConfirmDialog
        open={Boolean(dep)}
        title={
          dep?.action === 'APPROVE'
            ? `৳${dep.d.amount.toFixed(2)} যোগ করবেন?`
            : `ডিপোজিট #${dep?.d.depositNo} বাতিল করবেন?`
        }
        message={
          dep?.action === 'APPROVE'
            ? `${dep.d.user.name} — ${dep.d.method}\nTrxID: ${dep.d.trxId}\nপ্রেরক: ${dep.d.senderNo}\n\n⚠️ bKash/Nagad অ্যাপে এই TrxID মিলিয়ে দেখেছেন তো?`
            : 'ইউজার নোটিফিকেশন পাবে।'
        }
        confirmLabel={dep?.action === 'APPROVE' ? 'হ্যাঁ, টাকা যোগ করুন' : 'হ্যাঁ, বাতিল করুন'}
        danger={dep?.action === 'REJECT'}
        onConfirm={runDeposit}
        onCancel={() => setDep(null)}
      >
        <label className="label">নোট {dep?.action === 'REJECT' && '(কারণ)'}</label>
        <input aria-label="নোট {dep?.action === 'REJECT' && '(কারণ)'}"
          className="input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={dep?.action === 'REJECT' ? 'বাতিলের কারণ' : 'ঐচ্ছিক'}
        />
      </ConfirmDialog>

      {/* ── অর্ডার ডায়ালগ ── */}
      <ConfirmDialog
        open={Boolean(ord)}
        title={
          ord?.action === 'COMPLETE'
            ? `অর্ডার #${ord.o.orderNo} সম্পন্ন?`
            : `অর্ডার #${ord?.o.orderNo} বাতিল করবেন?`
        }
        message={
          ord?.action === 'COMPLETE'
            ? `${ord.o.productName}\n${ord.o.variantName}\nUID: ${ord.o.playerUid}\n\n⚠️ গেমে টপ আপ দিয়ে দিয়েছেন তো?`
            : `৳${ord?.o.price.toFixed(2)} ইউজারের ওয়ালেটে ফেরত যাবে।`
        }
        confirmLabel={ord?.action === 'COMPLETE' ? 'হ্যাঁ, সম্পন্ন' : 'হ্যাঁ, বাতিল ও ফেরত'}
        danger={ord?.action === 'FAIL'}
        onConfirm={runOrder}
        onCancel={() => setOrd(null)}
      >
        <label className="label">নোট {ord?.action === 'FAIL' && '(কারণ)'}</label>
        <input aria-label="নোট {ord?.action === 'FAIL' && '(কারণ)'}"
          className="input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={ord?.action === 'FAIL' ? 'বাতিলের কারণ' : 'ঐচ্ছিক'}
        />
      </ConfirmDialog>

      {/* ── স্ক্রিনশট zoom ── */}
      {zoom && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="পেমেন্ট স্ক্রিনশট"
          className="fixed inset-0 z-[95] grid place-items-center bg-slate-900/85 p-4"
          onClick={() => setZoom(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoom} alt="পেমেন্ট স্ক্রিনশট" className="max-h-full max-w-full rounded-lg object-contain" />
          <button
            onClick={() => setZoom(null)}
            aria-label="বন্ধ করুন"
            className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-full bg-white/20 text-white backdrop-blur hover:bg-white/30"
          >
            ✕
          </button>
        </div>
      )}
    </>
  );
}
