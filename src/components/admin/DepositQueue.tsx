'use client';

import { useState, useTransition, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import SafeImage from '@/components/fx/SafeImage';
import { useToast, ConfirmDialog } from '@/components/Toast';
import { fmtDate } from '@/lib/date';
import { bdt } from '@/lib/money';
import { depositRejectOptions, DEPOSIT_REJECT_COPY } from '@/lib/rejectReasons';
import CopyButton from '@/components/admin/CopyButton';

/**
 * ═══════════════════════════════════════════════════════════
 * ★ যাচাই কিউ — টেবিল নয়, কার্ড (3.1)
 *
 *   কেন (MANUAL_WORKFLOW.md B1):
 *   অ্যাডমিনের গতি = গ্রাহকের অপেক্ষার সময়। তাই এটি ভেতরের
 *   সুবিধা নয়, **গ্রাহকমুখী পারফরম্যান্স ফিচার**।
 *
 *   বাস্তব কাজের ধাপ:
 *     নোটিফিকেশন → অ্যাডমিন খোলা → ডিপোজিট খোঁজা → bKash অ্যাপ
 *     → TrxID খোঁজা → অঙ্ক মেলানো → প্রেরক মেলানো → ফিরে আসা → অনুমোদন
 *
 *   ব্যয়বহুল অংশ ক্লিক নয় — **অ্যাপ বদলানো ও চোখে মেলানো**।
 *   তাই নকশার লক্ষ্য: সিদ্ধান্ত নিতে **শূন্য স্ক্রল**।
 *
 *   ★ টেবিল মুছে ফেলা হয়নি — ইতিহাস দেখার জন্য সেটিই ভালো।
 *     কিউ শুধু *অপেক্ষমান* কাজের জন্য (CLAUDE.md §18)।
 * ═══════════════════════════════════════════════════════════
 */

export type QueueDeposit = {
  id: string;
  depositNo: number;
  method: string;
  amount: number;
  trxId: string;
  senderNo: string;
  screenshot: string | null;
  createdAt: string;
  user: {
    id: string;
    name: string;
    phone: string;
    balance: number;
    /** আগে কতগুলো ডিপোজিট অনুমোদিত হয়েছে — আস্থার সবচেয়ে সরল সূচক */
    approvedCount: number;
    rejectedCount: number;
  };
  /** ★ সার্ভারে হিসাব করা ঝুঁকির সংকেত (3.5) */
  risk: {
    level: 'trusted' | 'normal' | 'elevated';
    signals: Array<{ tone: 'warn' | 'info' | 'good'; text: string }>;
  };
};

/** সংকেতের রঙ — সতর্কতা, প্রসঙ্গ, আশ্বাস */
const TONE: Record<'warn' | 'info' | 'good', { bg: string; border: string }> = {
  warn: { bg: 'rgba(242,168,196,.08)', border: 'rgba(242,168,196,.28)' },
  info: { bg: 'rgba(230,197,132,.07)', border: 'var(--hair)' },
  good: { bg: 'rgba(127,224,187,.08)', border: 'rgba(127,224,187,.28)' },
};

/**
 * ★★★ আস্থা-স্তর (3.6) — অসম ঘর্ষণ
 *
 *   নীতি (MANUAL_WORKFLOW.md B1 §5):
 *   "প্রতিটি আইটেমে সমান ঘর্ষণ = অ্যাডমিনের সময়ের অপচয়।"
 *   মনোযোগ সেখানেই যাওয়া উচিত যেখানে প্রতারণা আসলে ঘটে।
 *
 *   ⚠️⚠️ কিন্তু "trusted" মানে **নিশ্চিতকরণ বাদ দেওয়া নয়**।
 *   CLAUDE.md §3 বলে প্রতিটি টাকা-সংক্রান্ত অ্যাডমিন অ্যাকশনে
 *   নিশ্চিতকরণ থাকতেই হবে। তাই এখানে ঘর্ষণ **কমানো হয় না** —
 *   শুধু ঝুঁকিপূর্ণ ক্ষেত্রে **বাড়ানো** হয়।
 *
 *   trusted  → স্বাভাবিক নিশ্চিতকরণ, শান্ত ভাষা
 *   normal   → স্বাভাবিক নিশ্চিতকরণ
 *   elevated → প্রতিটি সতর্কতা আলাদা করে স্বীকার না করা পর্যন্ত
 *              অনুমোদন বোতাম নিষ্ক্রিয় থাকে
 */
const TIER: Record<
  'trusted' | 'normal' | 'elevated',
  { label: string; color: string; bg: string; border: string }
> = {
  trusted: {
    label: 'পরিচিত গ্রাহক',
    color: '#7fe0bb',
    bg: 'rgba(127,224,187,.10)',
    border: 'rgba(127,224,187,.32)',
  },
  normal: {
    label: 'স্বাভাবিক',
    color: 'var(--mut)',
    bg: 'var(--glass)',
    border: 'var(--hair)',
  },
  elevated: {
    label: 'বাড়তি যাচাই দরকার',
    color: 'var(--red)',
    bg: 'rgba(242,168,196,.10)',
    border: 'rgba(242,168,196,.34)',
  },
};

/** কত আগে — "৫ মিনিট আগে" */
function ago(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'এইমাত্র';
  if (mins < 60) return `${mins} মিনিট আগে`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h} ঘন্টা আগে`;
  return `${Math.floor(h / 24)} দিন আগে`;
}

/** সারি — লেবেল ও মান পাশাপাশি, চোখে মেলানোর জন্য */
function Row({
  label,
  children,
  mono,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className="shrink-0 text-[11px] uppercase" style={{ letterSpacing: '.1em', color: 'var(--mut)' }}>
        {label}
      </dt>
      <dd
        className={`min-w-0 truncate text-right text-sm font-semibold ${mono ? 'font-mono' : ''}`}
        style={{ color: 'var(--ink)' }}
      >
        {children}
      </dd>
    </div>
  );
}

export default function DepositQueue({ deposits }: { deposits: QueueDeposit[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const toast = useToast();

  const [busy, setBusy] = useState<string | null>(null);
  // ★ elevated ঝুঁকিতে প্রতিটি সতর্কতা আলাদা করে স্বীকার করতে হয় (3.6)।
  //   কী: `${depositId}:${signalIndex}`
  const [acked, setAcked] = useState<Set<string>>(new Set());
  const [dlg, setDlg] = useState<{ d: QueueDeposit; action: 'APPROVE' | 'REJECT' } | null>(null);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('TRX_NOT_FOUND');
  const [zoom, setZoom] = useState<string | null>(null);

  /**
   * ★★★ কীবোর্ড শর্টকাট (3.11) — J/K চলাচল, A অনুমোদন, R বাতিল
   *
   *   ⚠️ **সবচেয়ে জরুরি নিয়ম:** একটা কী চাপলে টাকা নড়ে না।
   *   A চাপলে নিশ্চিতকরণ ডায়ালগ **খোলে** — সরাসরি অনুমোদন হয় না।
   *   §3 এর নিশ্চিতকরণের শর্ত শর্টকাটেও একইভাবে খাটে, আর 3.6 এর
   *   সতর্কতা-টিকও বহাল থাকে। শর্টকাট গতি বাড়ায়, পাহারা কমায় না।
   */
  const [focusIdx, setFocusIdx] = useState<number | null>(null);
  const cardRefs = useRef<(HTMLElement | null)[]>([]);

  const reasonOpts = depositRejectOptions();
  const noteRequired = reasonOpts.find((o) => o.value === reason)?.requiresNote ?? false;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // ★ টাইপ করার সময় শর্টকাট চলবে না — নোট লিখতে গিয়ে "a"
      //   চাপলে অনুমোদনের ডায়ালগ খুলে যাওয়াটা ভয়ংকর হতো
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' ||
          t.isContentEditable)
      ) return;

      // ★ ডায়ালগ খোলা থাকলে শর্টকাট বন্ধ — ডায়ালগের নিজের
      //   কী-হ্যান্ডলিং (Enter/Escape) এর সাথে সংঘর্ষ এড়াতে
      if (dlg || zoom) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const k = e.key.toLowerCase();
      const last = deposits.length - 1;
      if (last < 0) return;

      if (k === 'j' || k === 'arrowdown') {
        e.preventDefault();
        setFocusIdx((i) => (i === null ? 0 : Math.min(last, i + 1)));
      } else if (k === 'k' || k === 'arrowup') {
        e.preventDefault();
        setFocusIdx((i) => (i === null ? 0 : Math.max(0, i - 1)));
      } else if (k === 'escape') {
        setFocusIdx(null);
      } else if (k === 'a' || k === 'r') {
        if (focusIdx === null) return;
        const d = deposits[focusIdx];
        if (!d || busy === d.id) return;

        if (k === 'r') {
          e.preventDefault();
          open(d, 'REJECT');
          return;
        }

        // ★ 3.6 এর সতর্কতা-টিক শর্টকাটেও বাধ্যতামূলক — কীবোর্ড
        //   দিয়ে ঝুঁকির পাহারা পাশ কাটানো যাবে না
        const warnIdx = d.risk.signals
          .map((s, i) => (s.tone === 'warn' ? i : -1))
          .filter((i) => i >= 0);
        const allAcked =
          d.risk.level !== 'elevated' || warnIdx.every((i) => acked.has(`${d.id}:${i}`));
        if (!allAcked) {
          toast.error('আগে সব সতর্কতা দেখে টিক দিন');
          return;
        }
        e.preventDefault();
        open(d, 'APPROVE');
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [deposits, focusIdx, dlg, zoom, busy, acked]); // eslint-disable-line react-hooks/exhaustive-deps

  // ★ ফোকাস করা কার্ড দেখা যাচ্ছে কি না নিশ্চিত করা
  useEffect(() => {
    if (focusIdx === null) return;
    cardRefs.current[focusIdx]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [focusIdx]);

  function open(d: QueueDeposit, action: 'APPROVE' | 'REJECT') {
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
          ? `#${d.depositNo} অনুমোদিত — ${bdt(d.amount)} যোগ হয়েছে`
          : `#${d.depositNo} বাতিল করা হয়েছে`
      );
      startTransition(() => router.refresh());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'কাজটি করা যায়নি');
    } finally {
      setBusy(null);
    }
  }

  if (deposits.length === 0) {
    return (
      <div className="card py-16 text-center">
        <p className="text-3xl" aria-hidden="true">✓</p>
        <p className="mt-3 font-semibold" style={{ color: 'var(--ink)' }}>
          কোনো অপেক্ষমান রিকোয়েস্ট নেই
        </p>
        <p className="mt-1 text-sm" style={{ color: 'var(--mut)' }}>
          সব যাচাই করা হয়ে গেছে।
        </p>
      </div>
    );
  }

  return (
    <>
      {/* ★ শর্টকাট ইঙ্গিত (3.11) — আবিষ্কারযোগ্যতা ছাড়া শর্টকাট
          শুধু যে বানিয়েছে তারই কাজে লাগে */}
      <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px]" style={{ color: 'var(--mut)' }}>
        <kbd className="rounded border px-1.5 py-0.5" style={{ borderColor: 'var(--hair)' }}>J</kbd>
        <kbd className="rounded border px-1.5 py-0.5" style={{ borderColor: 'var(--hair)' }}>K</kbd>
        <span>চলাচল ·</span>
        <kbd className="rounded border px-1.5 py-0.5" style={{ borderColor: 'var(--hair)' }}>A</kbd>
        <span>অনুমোদন ·</span>
        <kbd className="rounded border px-1.5 py-0.5" style={{ borderColor: 'var(--hair)' }}>R</kbd>
        <span>বাতিল ·</span>
        <kbd className="rounded border px-1.5 py-0.5" style={{ borderColor: 'var(--hair)' }}>Esc</kbd>
        <span>বাদ</span>
        <span className="opacity-70">— কী চাপলে নিশ্চিতকরণ খোলে, সরাসরি কিছু হয় না</span>
      </div>

      <div className="space-y-4">
        {deposits.map((d, idx) => {
          const isBusy = busy === d.id;
          // ★ প্রেরকের নাম্বার লাল দেখানোর জন্য — বিস্তারিত সংকেত
          //   সার্ভারে হিসাব হয় (riskSignals.ts)
          const senderMismatch = d.senderNo.replace(/\D/g, '') !== d.user.phone.replace(/\D/g, '');

          // ★ elevated হলে প্রতিটি সতর্কতা স্বীকার করতে হবে (3.6)
          const needsAcks = d.risk.level === 'elevated';
          const warnIdx = d.risk.signals
            .map((s, i) => (s.tone === 'warn' ? i : -1))
            .filter((i) => i >= 0);
          const allAcked = !needsAcks || warnIdx.every((i) => acked.has(`${d.id}:${i}`));

          return (
            <article
              key={d.id}
              ref={(el) => { cardRefs.current[idx] = el; }}
              className="card overflow-hidden"
              aria-label={`ডিপোজিট #${d.depositNo}`}
              // ★ কীবোর্ড ফোকাস দৃশ্যমান না হলে J/K চেপে কেউ বুঝবে
              //   না সে কোথায় আছে — আর ভুল কার্ডে A চেপে বসবে
              data-focused={focusIdx === idx ? 'true' : undefined}
              style={
                focusIdx === idx
                  ? { outline: '2px solid var(--gold)', outlineOffset: '2px' }
                  : undefined
              }
            >
              {/* ── শিরোনাম: পরিমাণ ও মাধ্যম, সবচেয়ে বড় করে ── */}
              <div
                className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4"
                style={{ borderColor: 'var(--hair)' }}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-bold" style={{ color: 'var(--gold)' }}>
                      #{d.depositNo}
                    </span>
                    <span
                      className="rounded px-2 py-0.5 text-[10px] font-bold uppercase"
                      style={{ background: 'rgba(255,255,255,.06)', color: 'var(--ink)' }}
                    >
                      {d.method}
                    </span>
                    {/* ★ আস্থা-স্তর — অ্যাডমিন এক নজরেই বোঝে কোথায়
                        মনোযোগ দিতে হবে (3.6) */}
                    <span
                      className="rounded px-2 py-0.5 text-[10px] font-bold"
                      style={{
                        background: TIER[d.risk.level].bg,
                        border: `1px solid ${TIER[d.risk.level].border}`,
                        color: TIER[d.risk.level].color,
                      }}
                    >
                      {TIER[d.risk.level].label}
                    </span>
                  </div>
                  <p className="dsp mt-1 text-2xl font-semibold" style={{ color: 'var(--ink)' }}>
                    {bdt(d.amount)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs" style={{ color: 'var(--mut)' }}>
                    {ago(d.createdAt)}
                  </p>
                  <p className="text-[11px]" style={{ color: 'var(--mut)' }}>
                    {fmtDate(d.createdAt)}
                  </p>
                </div>
              </div>

              {/* ── মেলানোর তথ্য: এক নজরে, স্ক্রল ছাড়াই ── */}
              <div className="px-5 py-3">
                <dl className="divide-y" style={{ borderColor: 'var(--hair)' }}>
                  {/* ★ TrxID — প্রতিবার bKash অ্যাপে পেস্ট করতে হয়,
                      তাই কপি বোতাম এখানেই সবচেয়ে বেশি কাজে লাগে (3.4) */}
                  <Row label="TrxID" mono>
                    <span className="inline-flex items-center gap-2">
                      {d.trxId}
                      <CopyButton value={d.trxId} label="TrxID" />
                    </span>
                  </Row>
                  <Row label="প্রেরক" mono>
                    <span className="inline-flex items-center gap-2">
                      <span style={{ color: senderMismatch ? 'var(--red)' : 'var(--ink)' }}>
                        {d.senderNo}
                      </span>
                      <CopyButton value={d.senderNo} label="প্রেরকের নাম্বার" />
                    </span>
                  </Row>
                  <Row label="গ্রাহক">
                    <Link
                      href={`/admin/users/${d.user.id}`}
                      className="underline decoration-dotted underline-offset-2"
                    >
                      {d.user.name}
                    </Link>
                  </Row>
                  <Row label="নিবন্ধিত নাম্বার" mono>
                    {d.user.phone}
                  </Row>
                  <Row label="ইতিহাস">
                    <span style={{ color: 'var(--mut)' }}>
                      {d.user.approvedCount} অনুমোদিত
                      {d.user.rejectedCount > 0 && ` · ${d.user.rejectedCount} বাতিল`}
                      {' · '}ব্যালেন্স {bdt(d.user.balance)}
                    </span>
                  </Row>
                </dl>

                {/* ★ ঝুঁকির সংকেত — সার্ভারে হিসাব করা, অ্যাডমিনকে
                    খুঁজতে হয় না (3.5)। সতর্কতা আগে, আশ্বাস পরে।
                    ★ elevated হলে প্রতিটি ⚠️ আলাদা করে স্বীকার করতে
                      হয় — নাহলে অনুমোদন বোতাম নিষ্ক্রিয় (3.6) */}
                {d.risk.signals.length > 0 && (
                  <div className="mt-3 space-y-1.5">
                    {d.risk.signals.map((s, i) => {
                      const needsAck = needsAcks && s.tone === 'warn';
                      const key = `${d.id}:${i}`;
                      const isAcked = acked.has(key);

                      const box = (
                        <span className="flex items-start gap-2">
                          <span aria-hidden="true">
                            {s.tone === 'warn' ? '⚠️' : s.tone === 'good' ? '✓' : 'ⓘ'}
                          </span>
                          <span>{s.text}</span>
                        </span>
                      );

                      if (!needsAck) {
                        return (
                          <p
                            key={key}
                            className="rounded-lg px-3 py-2 text-xs font-medium"
                            style={{
                              background: TONE[s.tone].bg,
                              border: `1px solid ${TONE[s.tone].border}`,
                              color: 'var(--ink)',
                            }}
                          >
                            {box}
                          </p>
                        );
                      }

                      return (
                        <label
                          key={key}
                          className="flex cursor-pointer items-start gap-2.5 rounded-lg px-3 py-2 text-xs font-medium"
                          style={{
                            background: TONE.warn.bg,
                            border: `1px solid ${isAcked ? 'rgba(127,224,187,.35)' : TONE.warn.border}`,
                            color: 'var(--ink)',
                          }}
                        >
                          <input
                            type="checkbox"
                            className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer"
                            checked={isAcked}
                            onChange={(e) => {
                              setAcked((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(key);
                                else next.delete(key);
                                return next;
                              });
                            }}
                          />
                          {box}
                        </label>
                      );
                    })}

                    {needsAcks && !allAcked && (
                      <p className="px-1 text-[11px]" style={{ color: 'var(--mut)' }}>
                        অনুমোদনের আগে প্রতিটি সতর্কতা দেখে টিক দিন
                      </p>
                    )}
                  </div>
                )}

                {/* ── প্রমাণ ── */}
                {d.screenshot ? (
                  <button
                    type="button"
                    onClick={() => setZoom(d.screenshot)}
                    className="mt-3 block w-full overflow-hidden rounded-lg"
                    style={{ border: '1px solid var(--hair)' }}
                    aria-label="পেমেন্টের স্ক্রিনশট বড় করে দেখুন"
                  >
                    <span className="relative block h-28 w-full">
                      <SafeImage src={d.screenshot} alt="" sizes="400px" className="object-cover" />
                    </span>
                  </button>
                ) : (
                  <p className="mt-3 text-xs" style={{ color: 'var(--mut)' }}>
                    স্ক্রিনশট দেওয়া হয়নি
                  </p>
                )}
              </div>

              {/* ── সিদ্ধান্ত: অনুমোদন এক ট্যাপ, বাতিলে কারণ লাগে ── */}
              <div
                className="flex gap-3 border-t px-5 py-4"
                style={{ borderColor: 'var(--hair)' }}
              >
                {/* ★ অনুমোদন — elevated হলে সব সতর্কতা স্বীকার না করা
                    পর্যন্ত নিষ্ক্রিয় (3.6)। টাকা ঢোকানোর দিকেই
                    বাড়তি ঘর্ষণ, কারণ ভুল অনুমোদনই ক্ষতিকর। */}
                <button
                  onClick={() => open(d, 'APPROVE')}
                  disabled={isBusy || !allAcked}
                  title={!allAcked ? 'আগে সব সতর্কতা দেখে টিক দিন' : undefined}
                  className="btn-success flex-1 py-3 text-sm font-bold disabled:opacity-50"
                >
                  {isBusy ? '…' : !allAcked ? '🔒 অনুমোদন' : '✓ অনুমোদন'}
                </button>
                {/* ★ বাতিল কখনো আটকানো হয় না — ঝুঁকিপূর্ণ দাবি
                    বাতিল করা নিরাপদ দিক, সেখানে বাধা দেওয়া উল্টো হতো */}
                <button
                  onClick={() => open(d, 'REJECT')}
                  disabled={isBusy}
                  className="btn-ghost flex-1 py-3 text-sm font-bold disabled:opacity-50"
                >
                  ✕ বাতিল
                </button>
              </div>
            </article>
          );
        })}
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
            ? `${bdt(dlg.d.amount)} — ${dlg.d.user.name}\nTrxID: ${dlg.d.trxId}\nপ্রেরক: ${dlg.d.senderNo}\n\n⚠️ bKash/Nagad অ্যাপে TrxID যাচাই করেছেন তো?`
            : undefined
        }
        confirmLabel={dlg?.action === 'APPROVE' ? 'হ্যাঁ, অনুমোদন করুন' : 'হ্যাঁ, বাতিল করুন'}
        danger={dlg?.action === 'REJECT'}
        onConfirm={run}
        onCancel={() => setDlg(null)}
      >
        {dlg?.action === 'REJECT' && (
          <>
            <label htmlFor="q-reason" className="label">বাতিলের কারণ</label>
            <select
              id="q-reason"
              className="input mb-3"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            >
              {reasonOpts.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <p
              className="mb-3 rounded-lg p-2.5 text-[11px] leading-relaxed"
              style={{ background: 'rgba(230,197,132,.06)', border: '1px solid var(--hair)', color: 'var(--mut)' }}
            >
              গ্রাহক যা দেখবে:{' '}
              <span style={{ color: 'var(--ink)' }}>
                {DEPOSIT_REJECT_COPY[reason as keyof typeof DEPOSIT_REJECT_COPY]?.customerMessage
                  || '(আপনার নোটই বার্তা হিসেবে যাবে)'}
              </span>
            </p>
          </>
        )}

        <label htmlFor="q-note" className="label">
          নোট {dlg?.action === 'REJECT' && (noteRequired ? '(বাধ্যতামূলক)' : '(ঐচ্ছিক)')}
        </label>
        <input
          id="q-note"
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
          className="fixed inset-0 z-[95] grid place-items-center p-4"
          style={{ background: 'rgba(3,4,10,.88)' }}
          onClick={() => setZoom(null)}
        >
          {/* ★ ব্লব-হোস্টেড প্রমাণ ছবি, পূর্ণ-পর্দায় — মাপ আগে থেকে জানা
              নেই, তাই next/image নয় (DepositTable এও একই পদ্ধতি) */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoom} alt="পেমেন্টের স্ক্রিনশট" className="max-h-[85vh] max-w-full rounded-xl" />
          <button
            onClick={() => setZoom(null)}
            className="btn-ghost mt-4 px-6"
            aria-label="বন্ধ করুন"
          >
            বন্ধ
          </button>
        </div>
      )}
    </>
  );
}
