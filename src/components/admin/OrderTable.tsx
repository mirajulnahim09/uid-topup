'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Badge from '@/components/Badge';
import { useToast, ConfirmDialog } from '@/components/Toast';
import { fmtDate } from '@/lib/date';
import { round2 } from '@/lib/money';
import CannedPicker from '@/components/admin/CannedPicker';
import CopyButton from '@/components/admin/CopyButton';
import { orderFailOptions, ORDER_FAIL_COPY } from '@/lib/rejectReasons';
import { type ClaimState, claimLabel, claimBlockMessage } from '@/lib/orderClaim';
import { type BreachInfo, breachLabel } from '@/lib/slaBreach';

type O = {
  id: string; orderNo: number; productName: string; variantName: string;
  playerUid: string; playerName: string | null;
  discount: number; price: number;
  status: string; adminNote: string | null; internalNote: string | null; createdAt: string;
  user: { name: string; phone: string };
  claim: ClaimState;
  breach: BreachInfo;
  refundedAmount: number;
};

/** ★ claim অবস্থার রঙ (3.7) */
const CLAIM_STYLE: Record<ClaimState['state'], { bg: string; color: string } | null> = {
  free: null,
  mine: { bg: 'rgba(120,200,160,.12)', color: '#6ec49a' },
  held: { bg: 'rgba(230,160,90,.14)', color: '#e0a05a' },
  stale: { bg: 'rgba(150,150,150,.12)', color: 'var(--mut)' },
};

const FILTERS = ['ALL', 'PENDING', 'PROCESSING', 'COMPLETED', 'REFUNDED'];
type Act = 'PROCESSING' | 'COMPLETE' | 'FAIL';

export default function OrderTable({ orders, current }: { orders: O[]; current: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  const [busy, setBusy] = useState<string | null>(null);
  // ★ copied state সরানো হয়েছে — CopyButton নিজের অবস্থা নিজে রাখে
  const [dlg, setDlg] = useState<{ o: O; action: Act } | null>(null);
  const [note, setNote] = useState('');
  const [failReason, setFailReason] = useState<string>('INVALID_UID');
  const [pname, setPname] = useState('');
  const [inote, setInote] = useState('');
  /**
   * ★ টেক-ওভার সম্মতি (3.7)
   *
   *   অন্যের সক্রিয় claim থাকলে সার্ভার 409 + code `CLAIM_HELD` দেয়।
   *   সেটি ব্যর্থতা নয় — সম্মতি চাওয়া। মূল কাজটি (claim না টাকার
   *   অ্যাকশন) হুবহু ধরে রাখা হয়, যাতে "হ্যাঁ" চাপলে ব্যবহারকারীকে
   *   পুরো ফর্ম আবার পূরণ করতে না হয়।
   */
  const [takeoverFor, setTakeoverFor] = useState<
    | { o: O; kind: 'CLAIM' }
    | { o: O; kind: 'ACTION'; action: Act; payload: Record<string, unknown> }
    | null
  >(null);
  /** ★ বাল্ক নির্বাচন (3.8) — শুধু চলমান অর্ডার বাছা যায় */
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [bulkAct, setBulkAct] = useState<'CLAIM' | 'PROCESSING' | 'COMPLETE' | null>(null);
  /** ★ আংশিক ফেরত ডায়ালগের অবস্থা (3.14) */
  const [partial, setPartial] = useState<{ o: O; amount: string; reason: string } | null>(null);
  const [bulkResult, setBulkResult] = useState<
    { okCount: number; failCount: number; results: { orderNo: number | null; ok: boolean; error?: string }[] } | null
  >(null);
  const failOpts = orderFailOptions();
  const failNoteRequired = failOpts.find((o) => o.value === failReason)?.requiresNote ?? false;

  // ★ copyUid() সরানো হয়েছে — এখন শেয়ার্ড <CopyButton /> ব্যবহার হয়,
  //   যেটিতে clipboard API ব্লক থাকলে fallback ও aria-label আছে (3.4)

  function open(o: O, action: Act) {
    // ★ প্রি-ফিল করা নোট সরানো হলো — কাঠামোবদ্ধ কারণ বাছলে
    //   সিস্টেম নিজেই সুনির্দিষ্ট বার্তা বানায় (2.5)
    setNote('');
    setFailReason('INVALID_UID');
    setPname(o.playerName ?? '');
    setInote(o.internalNote ?? '');
    setDlg({ o, action });
  }

  /**
   * ★ অর্ডার ধরা / ছাড়া (3.7) — এখানে কোনো টাকা নড়ে না,
   *   তাই নিশ্চিতকরণ ডায়ালগ লাগে না। কিন্তু **টেক-ওভার** আলাদা:
   *   সেখানে অন্যের কাজের উপর হাত পড়ছে, তাই সম্মতি নেওয়া হয়।
   */
  async function claim(o: O, takeover = false) {
    setBusy(o.id);
    try {
      const res = await fetch('/api/admin/order/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: o.id,
          action: o.claim.state === 'mine' ? 'RELEASE' : 'CLAIM',
          ...(takeover ? { takeover: true } : {}),
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        // ★ code দেখে পার্থক্য — 409 আরও কারণে আসতে পারে
        //   (যেমন অর্ডার ইতিমধ্যে ক্লোজড), সেগুলোতে টেক-ওভার অর্থহীন
        if (j.code === 'CLAIM_HELD' && !takeover) {
          setTakeoverFor({ o, kind: 'CLAIM' });
          return;
        }
        throw new Error(j.error);
      }
      toast.success(
        j.kind === 'RELEASE' ? `#${o.orderNo} ছেড়ে দেওয়া হয়েছে`
        : j.kind === 'TAKEOVER' ? `#${o.orderNo} টেক ওভার করা হয়েছে`
        : `#${o.orderNo} আপনি ধরেছেন`
      );
      startTransition(() => router.refresh());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'কাজটি করা যায়নি');
    } finally {
      setBusy(null);
    }
  }

  /**
   * ★ টাকার অ্যাকশন পাঠানো। payload আলাদা করে নেওয়া হয়েছে যাতে
   *   টেক-ওভারের পর **হুবহু একই** অনুরোধ আবার পাঠানো যায় — নোট,
   *   কারণ, প্লেয়ার নাম কিছুই হারায় না।
   */
  async function postAction(o: O, action: Act, payload: Record<string, unknown>) {
    setBusy(o.id);
    try {
      const res = await fetch('/api/admin/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const j = await res.json();
      if (!res.ok) {
        // ★ অন্য অ্যাডমিন ধরে আছে — থামা নয়, সম্মতি চাওয়া (3.7)
        if (j.code === 'CLAIM_HELD' && !payload.takeover) {
          setTakeoverFor({ o, kind: 'ACTION', action, payload });
          return;
        }
        throw new Error(j.error);
      }

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

  async function run() {
    if (!dlg) return;
    const { o, action } = dlg;
    setDlg(null);
    await postAction(o, action, {
      orderId: o.id,
      action,
      adminNote: note.trim() || undefined,
      playerName: pname.trim() || undefined,
      internalNote: inote.trim() || undefined,
      ...(action === 'FAIL' ? { failReason } : {}),
    });
  }

  /**
   * ★ বাল্ক চালানো (3.8)
   *
   *   ফলাফল আইটেম-ভিত্তিক দেখানো হয়। "১৮টি হয়েছে" বলে থেমে গেলে
   *   বাকি ২টি চুপচাপ হারিয়ে যেত — অ্যাডমিন ভাবত সব হয়ে গেছে,
   *   অথচ দুজন গ্রাহক অপেক্ষাতেই থাকত।
   */
  async function runBulk() {
    const act = bulkAct;
    const ids = [...sel];
    setBulkAct(null);
    if (!act || ids.length === 0) return;
    setBusy('bulk');
    try {
      const res = await fetch('/api/admin/order/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderIds: ids, action: act }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error);

      setSel(new Set());
      if (j.failCount > 0) {
        // ★ আংশিক সফলতা — বিস্তারিত ডায়ালগে, টোস্টে চাপা নয়
        setBulkResult(j);
      } else {
        toast.success(`${j.okCount} টি অর্ডার হয়ে গেছে`);
      }
      startTransition(() => router.refresh());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'কাজটি করা যায়নি');
    } finally {
      setBusy(null);
    }
  }

  /**
   * ★ আংশিক ফেরত (3.14) — উপরের সীমা সার্ভারেই আসল পাহারা;
   *   এখানকার যাচাই শুধু ব্যবহারকারীকে দ্রুত জানানোর জন্য
   */
  async function runPartialRefund() {
    const p = partial;
    if (!p) return;
    const amt = Number(p.amount);
    const remaining = round2(p.o.price - p.o.refundedAmount);
    if (!Number.isFinite(amt) || amt <= 0) return toast.error('সঠিক অঙ্ক লিখুন');
    if (amt > remaining) return toast.error(`সর্বোচ্চ ৳${remaining.toFixed(2)} ফেরত দেওয়া যাবে`);
    if (p.reason.trim().length < 3) return toast.error('কারণ লিখুন');

    setPartial(null);
    setBusy(p.o.id);
    try {
      const res = await fetch('/api/admin/order/refund', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: p.o.id, amount: amt, reason: p.reason.trim() }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error);
      toast.success(`৳${amt.toFixed(2)} ফেরত দেওয়া হয়েছে`);
      startTransition(() => router.refresh());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'কাজটি করা যায়নি');
    } finally {
      setBusy(null);
    }
  }

  /** ★ সম্মতি পাওয়া গেল — মূল কাজটাই takeover পতাকা সহ আবার */
  async function confirmTakeover() {
    const t = takeoverFor;
    setTakeoverFor(null);
    if (!t) return;
    if (t.kind === 'CLAIM') await claim(t.o, true);
    else await postAction(t.o, t.action, { ...t.payload, takeover: true });
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
            className={`inline-flex min-h-[40px] items-center rounded-lg px-3.5 text-xs font-semibold transition ${
              current === f ? 'bg-purple-600 text-white shadow-sm' : 'bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-900'
            }`}
          >
            {f}
          </Link>
        ))}
      </div>

      {/* ★★★ বাল্ক বার (3.8) — নির্বাচন থাকলেই দেখা যায়।
              মোট মূল্য সবসময় দেখানো হয়: "৩টি অর্ডার" আর
              "৳৪,২০০ মূল্যের ৩টি অর্ডার" এক জিনিস নয়। */}
      {sel.size > 0 && (
        <div
          className="flex flex-wrap items-center gap-2 rounded-xl border p-3"
          style={{ borderColor: 'var(--hair)', background: 'rgba(230,197,132,.06)' }}
        >
          <span className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
            {sel.size} টি নির্বাচিত — ৳
            {orders.filter((o) => sel.has(o.id)).reduce((s, o) => s + o.price, 0).toFixed(2)}
          </span>
          <div className="ml-auto flex flex-wrap gap-1.5">
            <button onClick={() => setBulkAct('CLAIM')} disabled={busy === 'bulk'}
              className="btn-ghost px-3 py-1.5 text-xs">🙋 ধরুন</button>
            <button onClick={() => setBulkAct('PROCESSING')} disabled={busy === 'bulk'}
              className="btn-ghost px-3 py-1.5 text-xs">⏳ প্রসেসিং</button>
            <button onClick={() => setBulkAct('COMPLETE')} disabled={busy === 'bulk'}
              className="btn-success px-3 py-1.5 text-xs">✓ সম্পন্ন</button>
            <button onClick={() => setSel(new Set())} disabled={busy === 'bulk'}
              className="btn-ghost px-3 py-1.5 text-xs">বাদ</button>
          </div>
          {/* ★ বাতিল বাল্কে নেই — সেটি রিফান্ড চালায় (টাকা নড়ে) */}
          <p className="w-full text-[11px]" style={{ color: 'var(--mut)' }}>
            বাতিল/রিফান্ড একসাথে করা যায় না — টাকা ফেরত যায় বলে প্রতিটি আলাদা করে দেখতে হয়।
          </p>
        </div>
      )}

      <div className="table-wrap">
        <table className="tbl tbl--stack">
          <thead>
            <tr>
              <th scope="col" className="w-8">
                <span className="sr-only">নির্বাচন</span>
              </th>
              <th scope="col">#</th>
              <th scope="col">ইউজার</th>
              <th scope="col">প্রোডাক্ট</th>
              <th scope="col">UID</th>
              <th scope="col" className="num">মূল্য</th>
              <th scope="col" className="ctr">স্ট্যাটাস</th>
              <th scope="col">সময়</th>
              <th scope="col" className="ctr">অ্যাকশন</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o: (typeof orders)[number]) => {
              const live = o.status === 'PENDING' || o.status === 'PROCESSING';
              return (
                <tr key={o.id} className={live ? 'bg-blue-50' : ''}>
                  <td>
                    {/* ★ শুধু চলমান অর্ডার বাছা যায় — ক্লোজড অর্ডারে
                        চেকবক্স থাকলে ভুল প্রত্যাশা তৈরি হতো (3.8) */}
                    {/* ★ চেকবক্সটি ছিল খালি ১৬px — অ্যাডমিনের অন্য
                        চেকবক্সগুলো `<label>` এর ভিতরে থাকায় পুরো সারিই
                        ছোঁয়ার লক্ষ্য হয়, কিন্তু এটির কোনো মোড়ক ছিল না।
                        এখন ৪০×৪০ লেবেল-মোড়ক ছোঁয়ার লক্ষ্য দেয়, বাক্সটি
                        নিজে ১৮px — দৃশ্য প্রায় একই, আঙুলের জন্য আড়াই গুণ।
                        ⚠️ নির্বাচনের যুক্তি (`sel`) হুবহু অপরিবর্তিত। */}
                    {live && (
                      <label className="grid h-10 w-10 cursor-pointer place-items-center">
                        <input
                          type="checkbox"
                          aria-label={`অর্ডার ${o.orderNo} নির্বাচন করুন`}
                          checked={sel.has(o.id)}
                          onChange={(e) => {
                            setSel((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(o.id);
                              else next.delete(o.id);
                              return next;
                            });
                          }}
                          className="h-[18px] w-[18px] cursor-pointer accent-emerald-500"
                        />
                      </label>
                    )}
                  </td>
                  <td data-label="অর্ডার" className="font-mono font-semibold text-rose-600">#{o.orderNo}</td>
                  <td data-label="ইউজার">
                    <div className="text-sm font-medium text-slate-900">{o.user.name}</div>
                    <div className="text-xs text-slate-400">{o.user.phone}</div>
                  </td>
                  <td data-label="প্রোডাক্ট">
                    <div className="text-sm font-medium text-slate-900">{o.productName}</div>
                    <div className="text-xs text-rose-600">{o.variantName}</div>
                  </td>
                  <td data-label="UID">
                    {/* ★ একই CopyButton — আগে এখানে আলাদা বাস্তবায়ন ছিল,
                        এখন পুরো অ্যাডমিনে একই আচরণ ও একই a11y (3.4) */}
                    <span className="inline-flex items-center gap-1.5">
                      <code className="rounded bg-slate-100 px-2 py-1 font-mono text-xs text-amber-700">
                        {o.playerUid}
                      </code>
                      <CopyButton value={o.playerUid} label="Player UID" />
                    </span>
                    {o.playerName && (
                      <div className="mt-1 text-[11px] text-slate-400">{o.playerName}</div>
                    )}
                  </td>
                  <td data-label="মূল্য" className="whitespace-nowrap num">
                    <div className="font-bold text-slate-900">৳{o.price.toFixed(2)}</div>
                    {o.discount > 0 && (
                      <div className="text-[10px] text-emerald-600">−৳{o.discount.toFixed(2)}</div>
                    )}
                  </td>
                  <td data-label="স্ট্যাটাস" className="ctr">
                    <Badge status={o.status} />
                    {/* ★ কে কাজ করছে (3.7) — স্ট্যাটাসের ঠিক পাশে,
                        কারণ সিদ্ধান্তের মুহূর্তে দুটোই একসাথে লাগে */}
                    {live && o.claim.state !== 'free' && (
                      <div
                        className="mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold"
                        style={{
                          background: CLAIM_STYLE[o.claim.state]!.bg,
                          color: CLAIM_STYLE[o.claim.state]!.color,
                        }}
                      >
                        {o.claim.state === 'mine' ? '✋ ' : o.claim.state === 'held' ? '🔒 ' : '⌛ '}
                        {claimLabel(o.claim)}
                      </div>
                    )}
                    {o.adminNote && (
                      <div className="mt-1 max-w-[130px] text-[11px] text-slate-400">{o.adminNote}</div>
                    )}
                    {o.internalNote && (
                      <div className="mt-1 max-w-[130px] text-[11px] text-amber-400">🔒 {o.internalNote}</div>
                    )}
                  </td>
                  <td data-label="সময়" className="whitespace-nowrap text-xs text-slate-400">
                    {fmtDate(o.createdAt)}
                    {/* ★ SLA অবস্থা (3.9) — সময়ের পাশেই, কারণ
                        দুটো একই প্রশ্নের উত্তর: "কত দেরি হলো?" */}
                    {o.breach.level !== 'ok' && (
                      <div
                        className="mt-1 font-semibold"
                        style={{ color: o.breach.level === 'breached' ? '#e07878' : '#e0a05a' }}
                      >
                        {o.breach.level === 'breached' ? '🚨 ' : '⏰ '}
                        {breachLabel(o.breach)}
                      </div>
                    )}
                  </td>
                  <td className="ctr">
                    {live ? (
                      <div className="tbl-actions">
                        {/* ★ ধরা / ছাড়া (3.7) — টাকা নড়ে না, তাই
                            নিশ্চিতকরণ ছাড়াই; কিন্তু অন্যের claim
                            থাকলে সার্ভার সম্মতি চাইবে */}
                        <button
                          disabled={busy === o.id}
                          onClick={() => claim(o)}
                          title={
                            o.claim.state === 'mine' ? 'ছেড়ে দিন'
                            : o.claim.state === 'held' ? claimBlockMessage(o.claim)
                            : 'আমি এটি দেখছি'
                          }
                          aria-label={
                            o.claim.state === 'mine'
                              ? `অর্ডার ${o.orderNo} ছেড়ে দিন`
                              : `অর্ডার ${o.orderNo} ধরুন`
                          }
                          className="btn-ghost px-2.5 py-1.5 text-xs"
                        >
                          {o.claim.state === 'mine' ? '✋' : '🙋'}
                        </button>
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
                    ) : o.status === 'COMPLETED' && o.refundedAmount < o.price ? (
                      /* ★ আংশিক ফেরত — শুধু সম্পন্ন অর্ডারে, আর
                         তখনই যখন ফেরত দেওয়ার মতো টাকা বাকি আছে (3.14) */
                      <button
                        disabled={busy === o.id}
                        onClick={() => setPartial({ o, amount: '', reason: '' })}
                        className="btn-ghost px-2.5 py-1.5 text-xs"
                        title={`সর্বোচ্চ ৳${round2(o.price - o.refundedAmount).toFixed(2)}`}
                      >
                        ↩️ আংশিক ফেরত
                      </button>
                    ) : (
                      <span className="text-xs text-slate-400">ক্লোজড</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {orders.length === 0 && (
              <tr>
                <td colSpan={9} className="py-14 ctr text-slate-400">কোনো অর্ডার নেই</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ★★★ আংশিক ফেরত (3.14) — টাকা নড়ে, তাই নিশ্চিতকরণ ও
              কারণ দুটোই বাধ্যতামূলক (§3) */}
      <ConfirmDialog
        open={Boolean(partial)}
        title={`অর্ডার #${partial?.o.orderNo} — আংশিক ফেরত`}
        message={
          partial
            ? `মোট মূল্য ৳${partial.o.price.toFixed(2)}${
                partial.o.refundedAmount > 0
                  ? `\nআগে ফেরত দেওয়া হয়েছে ৳${partial.o.refundedAmount.toFixed(2)}`
                  : ''
              }\nসর্বোচ্চ ফেরত দেওয়া যাবে ৳${round2(partial.o.price - partial.o.refundedAmount).toFixed(2)}\n\n⚠️ স্টক ও কুপন ফেরত যাবে না — অর্ডারটি বহাল থাকবে।`
            : undefined
        }
        confirmLabel="ফেরত দিন"
        danger
        onConfirm={runPartialRefund}
        onCancel={() => setPartial(null)}
      >
        <div className="mb-3">
          <label htmlFor="pr-amount" className="label">কত টাকা ফেরত দেবেন</label>
          <input
            id="pr-amount"
            type="number"
            step="0.01"
            min="0.01"
            max={partial ? round2(partial.o.price - partial.o.refundedAmount) : undefined}
            className="input"
            value={partial?.amount ?? ''}
            onChange={(e) => setPartial((p) => (p ? { ...p, amount: e.target.value } : p))}
            placeholder="যেমন 50.00"
          />
        </div>
        <div>
          <label htmlFor="pr-reason" className="label">কারণ (বাধ্যতামূলক — গ্রাহক দেখবে)</label>
          <input
            id="pr-reason"
            className="input"
            value={partial?.reason ?? ''}
            onChange={(e) => setPartial((p) => (p ? { ...p, reason: e.target.value } : p))}
            placeholder="যেমন: ৫০০ এর বদলে ৩০০ ডায়মন্ড পৌঁছেছে"
          />
        </div>
      </ConfirmDialog>

      {/* ★★★ বাল্ক নিশ্চিতকরণ (3.8) — মোট মূল্য সহ।
              §3 অনুযায়ী প্রতিটি সংবেদনশীল কাজেই নিশ্চিতকরণ থাকে;
              বাল্ক বলে সেটি বাদ যায় না, বরং পরিমাণটাও দেখানো হয়। */}
      <ConfirmDialog
        open={Boolean(bulkAct)}
        title={
          bulkAct === 'COMPLETE' ? `${sel.size} টি অর্ডার সম্পন্ন করবেন?`
          : bulkAct === 'PROCESSING' ? `${sel.size} টি অর্ডার প্রসেসিং করবেন?`
          : `${sel.size} টি অর্ডার ধরবেন?`
        }
        message={
          bulkAct === 'COMPLETE'
            ? `মোট ৳${orders.filter((o) => sel.has(o.id)).reduce((s, o) => s + o.price, 0).toFixed(2)}\n\n⚠️ প্রতিটি অর্ডার গেমে ডেলিভারি দিয়েছেন তো? সম্পন্ন করলে গ্রাহক "ডেলিভারি হয়েছে" বার্তা পাবে।\n\nঅন্য অ্যাডমিন যেগুলো ধরে আছেন সেগুলো বাদ পড়বে।`
            : `${sel.size} টি অর্ডার — অন্য অ্যাডমিন যেগুলো ধরে আছেন সেগুলো বাদ পড়বে।`
        }
        confirmLabel="নিশ্চিত"
        onConfirm={runBulk}
        onCancel={() => setBulkAct(null)}
      />

      {/* ★ আংশিক ফলাফল (3.8) — কোনটা হয়নি ও কেন, স্পষ্ট করে */}
      <ConfirmDialog
        open={Boolean(bulkResult)}
        title={`${bulkResult?.okCount} টি হয়েছে, ${bulkResult?.failCount} টি হয়নি`}
        confirmLabel="বুঝেছি"
        onConfirm={() => setBulkResult(null)}
        onCancel={() => setBulkResult(null)}
      >
        <ul className="space-y-1 text-xs">
          {bulkResult?.results.filter((r) => !r.ok).map((r, i) => (
            <li key={i} style={{ color: 'var(--mut)' }}>
              ❌ {r.orderNo ? `#${r.orderNo}` : 'একটি অর্ডার'} — {r.error}
            </li>
          ))}
        </ul>
      </ConfirmDialog>

      {/* ★★★ টেক-ওভার সম্মতি (3.7)
              claim কখনো চূড়ান্ত বাধা নয় — এই ডায়ালগই সেই "সবসময়
              এগোনো যায়" প্রতিশ্রুতির বাস্তবায়ন। কিন্তু ঝুঁকিটা
              স্পষ্ট করে বলা হয়, কারণ ভুল টেক-ওভারের খরচ বাস্তব:
              দুবার ডায়মন্ড পাঠানো হলে সে টাকা আর ফেরত আসে না। */}
      <ConfirmDialog
        open={Boolean(takeoverFor)}
        title={`অর্ডার #${takeoverFor?.o.orderNo} টেক ওভার করবেন?`}
        message={takeoverFor ? claimBlockMessage(takeoverFor.o.claim) : undefined}
        confirmLabel="হ্যাঁ, টেক ওভার করুন"
        danger
        onConfirm={confirmTakeover}
        onCancel={() => setTakeoverFor(null)}
      />

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
        {/* ★ বাতিলের কাঠামোবদ্ধ কারণ — গ্রাহক সুনির্দিষ্ট বার্তা পায় */}
        {dlg?.action === 'FAIL' && (
          <div className="mb-3">
            <label htmlFor="ord-reason" className="label">বাতিলের কারণ</label>
            <select
              id="ord-reason"
              className="input"
              value={failReason}
              onChange={(e) => setFailReason(e.target.value)}
            >
              {failOpts.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <p className="mt-2 rounded-lg border border-[var(--hair)] p-2.5 text-[11px] leading-relaxed"
              style={{ background: 'rgba(230,197,132,.06)', color: 'var(--mut)' }}>
              গ্রাহক যা দেখবে:{' '}
              <span style={{ color: 'var(--ink)' }}>
                {ORDER_FAIL_COPY[failReason as keyof typeof ORDER_FAIL_COPY]?.customerMessage
                  || '(আপনার নোটই বার্তা হিসেবে যাবে)'}
              </span>
            </p>
          </div>
        )}
        <div>
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="ord-note" className="label">
              নোট (কাস্টমার দেখবে){' '}
              {dlg?.action === 'FAIL' && (failNoteRequired ? '— বাধ্যতামূলক' : '— ঐচ্ছিক')}
            </label>
            {/* ★ তৈরি বার্তা (3.15) — খসড়া ঢোকায়, সম্পাদনাযোগ্য */}
            <CannedPicker onPick={(t) => setNote((n) => (n ? `${n} ${t}` : t))} />
          </div>
          <input
            id="ord-note"
            className="input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={
              dlg?.action === 'FAIL'
                ? failNoteRequired ? 'কারণ লিখুন — গ্রাহক এটাই দেখবে' : 'অতিরিক্ত তথ্য (ঐচ্ছিক)'
                : 'ঐচ্ছিক'
            }
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
