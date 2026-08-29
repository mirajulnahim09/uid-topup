'use client';

import { fetchMe, invalidateMe } from '@/lib/clientFetch';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useToast, ConfirmDialog } from './Toast';
import { motion, AnimatePresence } from 'framer-motion';
import { CountUp, SuccessBurst } from './motion';
import { formatDuration } from '@/lib/sla';
import Icon from '@/components/fx/Icon';

/**
 * ★ প্রতি-ইউনিট দাম (2.16) — "৳0.69 / ডায়মন্ড"
 *
 *   কেন: বড় প্যাকেজ সত্যিই সাশ্রয়ী কি না, গ্রাহক মাথায় হিসাব করে
 *   বুঝতে পারে না। প্রতি-ইউনিট দাম দেখালে বড় প্যাকেজ **নিজেই**
 *   নিজেকে ন্যায্যতা দেয় — কোনো বিপণনের দাবি ছাড়াই
 *   (MANUAL_WORKFLOW.md A3)।
 *
 *   ⚠️ শুধু তখনই দেখানো হয় যখন লেবেল থেকে প্রকৃত সংখ্যা বের করা
 *   যায় (যেমন "240 Diamond")। "Weekly lite" এর মতো লেবেলে কোনো
 *   একক নেই — সেখানে কিছু দেখানো হয় না, বানানো হয় না।
 */
function unitHint(v: { label: string; price: number }): string | null {
  const m = v.label.match(/^(\d[\d,]*)\s*(Diamond|ডায়মন্ড|Like|UC)/i);
  if (!m) return null;
  const qty = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(qty) || qty <= 0 || v.price <= 0) return null;
  const per = v.price / qty;
  // খুব ছোট প্যাকেজে প্রতি-ইউনিট দাম অর্থবহ নয়
  if (qty < 25) return null;
  return `৳${per.toFixed(2)} / ${m[2]}`;
}

type V = {
  id: number; label: string; price: number;
  oldPrice: number | null; stock: number; isPopular: boolean;
  /** ★ এই প্যাকেজের সাধারণ ডেলিভারি সময় (মিনিট) — null হলে সাইটের SLA */
  deliveryMinutes?: number | null;
};
type Applied = { code: string; label: string; discount: number; finalPrice: number };

/** লাল গোল নাম্বার ব্যাজ — ১ ২ ৩ */
function StepBadge({ n }: { n: number }) {
  return (
    <span
      className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[var(--violet)] text-sm font-bold text-white shadow-sm"
      aria-hidden="true"
    >
      {n}
    </span>
  );
}

export type PayChannel = {
  id: number;
  method: string;
  accountNo: string;
  accountType: string;
  instruction: string;
};

export default function OrderForm({
  productId, productName, uidLabel, uidHint, variants, channels = [],
}: {
  productId: number;
  productName: string;
  uidLabel: string;
  uidHint: string | null;
  variants: V[];
  /** ম্যানুয়াল পেমেন্টের নাম্বার — ডাইরেক্ট পে এর জন্য */
  channels?: PayChannel[];
}) {
  const { status } = useSession();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const toast = useToast();

  // ★ ব্যালেন্স ক্লায়েন্ট-সাইডে আনা হয় — তাই পেজটা ক্যাশ করা যায় (দ্রুত লোড)
  const [balance, setBalance] = useState<number | null>(null);
  const [sel, setSel] = useState<V | null>(null);
  const [uid, setUid] = useState('');
  const [uidErr, setUidErr] = useState('');
  // ★ double-entry নিশ্চিতকরণ — ভুল UID ঠেকানোর প্রধান সুরক্ষা
  const [uidConfirm, setUidConfirm] = useState('');
  const [pasteBlocked, setPasteBlocked] = useState(false);
  // ★ আগে ব্যবহৃত UID — এক ট্যাপে বসে (2.12)
  const [recentUids, setRecentUids] = useState<Array<{ uid: string; name: string | null }>>([]);
  const [playerName, setPlayerName] = useState('');
  // ★ পেমেন্টের পথ — ওয়ালেট (ফেরত আসা গ্রাহক) বা ডাইরেক্ট পে (নতুন গ্রাহক)
  const [payMode, setPayMode] = useState<'wallet' | 'direct'>('wallet');
  const [dpMethod, setDpMethod] = useState<string>(channels[0]?.method ?? 'BKASH');
  const [dpTrxId, setDpTrxId] = useState('');
  const [dpSender, setDpSender] = useState('');
  const [coupon, setCoupon] = useState('');
  const [applied, setApplied] = useState<Applied | null>(null);
  const [checking, setChecking] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [loading, setLoading] = useState(false);

  /**
   * ★★★ দুইবার-জমা প্রতিরোধ — **দুই স্তরে**।
   *
   *   ⚠️ কেন `loading` state যথেষ্ট নয় (ব্রাউজারে মাপা, ২০২৬-০৮-১৪):
   *   `setLoading(true)` পরের রেন্ডারে কার্যকর হয়, কিন্তু দ্রুত দুটি
   *   ক্লিকের মাঝে React রেন্ডার করার সময়ই পায় না — দুটি কলই
   *   `loading === false` দেখে ঢুকে পড়ত, দুটি অর্ডার হতো, ওয়ালেট
   *   থেকে **দুইবার** টাকা কাটত।
   *
   *   স্তর ১ — `submittingRef`: ref সাথে সাথেই বদলায়, রেন্ডারের
   *            অপেক্ষা করে না। তাই দ্বিতীয় ক্লিক এখানেই থামে।
   *   স্তর ২ — `clientRef`: একটি অর্ডার-চেষ্টার জন্য একটিই কী।
   *            নেটওয়ার্কে দুটি অনুরোধ পৌঁছালেও সার্ভার
   *            `(userId, clientRef)` ইউনিক ইনডেক্স দিয়ে দ্বিতীয়টিকে
   *            আগের অর্ডারই ফেরত দেয়। ক্লায়েন্টের সদিচ্ছার উপর
   *            টাকার নিরাপত্তা ছেড়ে দেওয়া যায় না।
   */
  const submittingRef = useRef(false);
  const clientRefRef = useRef<string>('');
  const [burst, setBurst] = useState(false);

  const authed = status === 'authenticated';

  const loadBalance = useCallback(async () => {
    if (status !== 'authenticated') return;
    try {
      // ★ শেয়ার্ড de-dup (4.5)
      const d = await fetchMe<{ balance: string }>();
      setBalance(Number(d.balance));
    } catch {
      /* silent — ব্যালেন্স না এলেও অর্ডার বোতাম কাজ করবে, সার্ভার যাচাই করবে */
    }
  }, [status]);

  useEffect(() => {
    loadBalance();
  }, [loadBalance]);

  /**
   * ★ "আবার অর্ডার" থেকে আসা প্রি-ফিল (2.13)।
   *
   *   ⚠️ useSearchParams() ইচ্ছাকৃতভাবে ব্যবহার করা হয়নি — এই পেজ
   *   generateStaticParams + revalidate দিয়ে প্রি-রেন্ডার হয়, আর
   *   useSearchParams পুরো রুটকে ডায়নামিক করে দিত (অথবা Suspense
   *   লাগত)। window.location একবার পড়লে SSG অক্ষত থাকে।
   */
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const vRaw = q.get('v');
    const uidRaw = q.get('uid');

    if (vRaw) {
      const vId = Number(vRaw);
      const match = variants.find((x) => x.id === vId);
      // স্টক শেষ হলে প্রি-সিলেক্ট করি না — ভুল আশা তৈরি হতো
      if (match && match.stock !== 0) setSel(match);
    }
    if (uidRaw && /^[a-zA-Z0-9._@+\-]{3,80}$/.test(uidRaw)) {
      // ★ আগের অর্ডারে সফলভাবে ব্যবহৃত UID — দুই ঘরেই বসে,
      //   ঠিক recent-chip এর মতোই যুক্তিতে
      setUid(uidRaw);
      setUidConfirm(uidRaw);
    }
    // শুধু একবার — mount এ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ★ আগে ব্যবহৃত UID আনি — শুধু লগইন করা থাকলে
  useEffect(() => {
    if (status !== 'authenticated') return;
    let alive = true;
    fetch(`/api/uid/recent?productId=${productId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d?.recent) setRecentUids(d.recent);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [status, productId]);

  const total = applied ? applied.finalPrice : sel?.price ?? 0;
  const bal = balance ?? 0;
  const short = Math.max(0, total - bal); // আরও কত টাকা লাগবে
  // ★ ডাইরেক্ট পে তে যত টাকা পাঠাতে হবে — অর্ডারের দামের ঠিক সমান
  const payable = Number(total.toFixed(2));

  function pick(v: V) {
    if (v.stock === 0) return;
    setSel(v);
    if (applied) {
      setApplied(null);
      setCoupon('');
      toast.info('প্যাকেজ বদলানোয় কুপন আবার প্রয়োগ করতে হবে');
    }
  }

  function validateUid(v: string): boolean {
    const t = v.trim();
    if (t.length < 3) {
      setUidErr(`সঠিক ${uidLabel} দিন`);
      return false;
    }
    if (!/^[\w.@+\-]+$/.test(t)) {
      setUidErr('অবৈধ অক্ষর আছে');
      return false;
    }
    setUidErr('');
    return true;
  }

  async function applyCoupon() {
    if (!sel) return toast.error('আগে একটি প্যাকেজ বেছে নিন');
    if (!coupon.trim()) return;

    setChecking(true);
    try {
      const res = await fetch('/api/coupon/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: coupon.trim().toUpperCase(), variantId: sel.id }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);

      setApplied({
        code: d.code,
        label: d.label,
        discount: Number(d.discount),
        finalPrice: Number(d.finalPrice),
      });
      toast.success(`কুপন প্রয়োগ হয়েছে — ৳${d.discount} ছাড়`);
    } catch (e) {
      setApplied(null);
      toast.error(e instanceof Error ? e.message : 'কুপন যাচাই করা যায়নি');
    } finally {
      setChecking(false);
    }
  }

  async function submit() {
    // ★★★ BUG-fix: re-entrancy গার্ড — ConfirmDialog-এর বাটন busy-state
    //   ছাড়া, তাই দ্রুত ডাবল-ক্লিকে submit() দুবার ঢুকে দুটো অর্ডার যেতে
    //   পারত (order route-এ per-request idempotency নেই)। loading already
    //   true হলে দ্বিতীয় কল এখানেই থামে।
    // ★ ref — সিঙ্ক্রোনাস, তাই একই টিকে আসা দ্বিতীয় ক্লিকও ধরা পড়ে
    if (submittingRef.current || loading) return;
    submittingRef.current = true;

    // ★ এই চেষ্টার idempotency key — সফল না হওয়া পর্যন্ত একই থাকে,
    //   তাই রিট্রাই করলেও নতুন অর্ডার নয়, আগেরটিই ফিরে আসে
    if (!clientRefRef.current) {
      clientRefRef.current =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    }

    setConfirm(false);
    setLoading(true);

    try {
      // ★ ডাইরেক্ট পে হলে আলাদা endpoint — ওখানে অর্ডার AWAITING_PAYMENT
      //   অবস্থায় তৈরি হয়, টাকা নড়ে শুধু অ্যাডমিন যাচাইয়ের পর
      const isDirect = payMode === 'direct';
      const res = await fetch(isDirect ? '/api/order/direct' : '/api/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          variantId: sel!.id,
          playerUid: uid.trim(),
          playerName: playerName.trim() || undefined,
          couponCode: applied?.code || undefined,
          clientRef: clientRefRef.current,
          ...(isDirect
            ? {
                method: dpMethod,
                amount: payable,
                trxId: dpTrxId.trim().toUpperCase(),
                senderNo: dpSender.trim(),
              }
            : {}),
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'অর্ডার করা যায়নি');

      // ★★★ ক্যাশ বাতিল (4.5) — টাকা কাটা হয়েছে, তাই পুরনো ব্যালেন্স
      //     এক মুহূর্তও দেখানো চলবে না। এটি না থাকলে Navbar/OrderForm
      //     ৫ সেকেন্ড পর্যন্ত কাটার আগের টাকা দেখাত, আর গ্রাহক ভুল
      //     অঙ্ক দেখে পরের সিদ্ধান্ত নিত।
      invalidateMe();

      // ★ অর্ডার সফল — পরের অর্ডারের জন্য নতুন idempotency key দরকার,
      //   নাহলে দ্বিতীয় অর্ডারে সার্ভার আগেরটিই ফেরত দিত
      clientRefRef.current = '';

      // ★ সেলিব্রেশন — তারপর অর্ডার পেজে
      setBurst(true);
      toast.success(d.message);
      setUid('');
      setUidConfirm('');
      setPasteBlocked(false);
      setPlayerName('');
      setSel(null);
      setCoupon('');
      setApplied(null);

      // ★ রসিদ পেজে পাঠাই — তালিকায় নয় (2.11)।
      //   টাকা পাঠানোর পর গ্রাহকের দরকার একটি স্থায়ী, লিংকযোগ্য
      //   প্রমাণ — মিলিয়ে যাওয়া toast নয় (MANUAL_WORKFLOW.md A6)।
      setTimeout(() => {
        router.push(d.orderId ? `/account/orders/${d.orderId}?placed=1` : '/account/orders');
        startTransition(() => router.refresh());
      }, 850);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'অর্ডার করা যায়নি');
      /**
       * ⚠️ ব্যর্থ হলে `clientRefRef` **মুছি না** — ইচ্ছাকৃত। নেটওয়ার্ক
       *   টাইমআউটে অর্ডারটি সার্ভারে তৈরি হয়ে থাকতে পারে; একই কী নিয়ে
       *   আবার চেষ্টা করলে সার্ভার সেই আগের অর্ডারটিই ফেরত দেবে, নতুন
       *   একটি বানাবে না।
       */
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  }

  // ★ দুইটি UID মিলছে কিনা — ট্রিম করে তুলনা (স্পেস ছাড়া)
  const uidTrim = uid.trim();
  const uidConfirmTrim = uidConfirm.trim();
  const uidMatched = Boolean(uidTrim && uidTrim === uidConfirmTrim);
  const uidMismatch = Boolean(uidConfirmTrim && uidTrim !== uidConfirmTrim);

  // ★ ডাইরেক্ট পে হলে পেমেন্টের তথ্যও লাগবে
  const dpTrxValid = /^[A-Z0-9]{6,30}$/.test(dpTrxId.trim().toUpperCase());
  const dpSenderValid = /^01[3-9]\d{8}$/.test(dpSender.trim());
  const directReady = payMode !== 'direct' || (dpTrxValid && dpSenderValid);

  // ★ নিশ্চিতকরণ না মিললে অর্ডার করা যাবে না — এটাই আসল সুরক্ষা,
  //   শুধু সতর্কবার্তা দেখিয়ে ছেড়ে দিলে ভুল ঠেকানো যেত না
  const ready = Boolean(sel && uidTrim && !uidErr && uidMatched && directReady);

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      {/* ═══════ বাম: ১ Select Recharge (২ কলাম জুড়ে) ═══════ */}
      <section className="card overflow-hidden lg:col-span-2" aria-labelledby="s1">
        <div className="flex items-center gap-2.5 border-b border-slate-200 px-5 py-4">
          <StepBadge n={1} />
          {/* ★ পুরো পাতাটি বাংলায়, অথচ দুটি ধাপের শিরোনামই ইংরেজিতে
              ছিল — গ্রাহকের পড়ার ছন্দ ভাঙত। কম্পোনেন্টটি i18n
              ব্যবহার করে না (বাকি প্রতিটি লেখাও হার্ডকোড বাংলা),
              তাই এটিও বাংলায় আনা সঙ্গতিপূর্ণ। */}
          <h2 id="s1" className="text-lg font-bold text-slate-900">প্যাকেজ বেছে নিন</h2>
        </div>

        <div className="p-4 sm:p-5">
          {variants.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-400">কোনো প্যাকেজ নেই</p>
          ) : (
            <div
              role="radiogroup"
              aria-label="প্যাকেজ বেছে নিন"
              className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
            >
              {variants.map((v: (typeof variants)[number], i: number) => {
                const out = v.stock === 0;
                const active = sel?.id === v.id;

                return (
                  <motion.button
                    key={v.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    disabled={out}
                    onClick={() => pick(v)}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: Math.min(i * 0.025, 0.4) }}
                    whileHover={out ? {} : { scale: 1.02, y: -2 }}
                    whileTap={out ? {} : { scale: 0.97 }}
                    className={`pkg-card relative ${
                      out ? 'cursor-not-allowed opacity-40 hover:border-slate-200 hover:shadow-none' : ''
                    }`}
                  >
                    {v.isPopular && !out && (
                      <motion.span
                        animate={{ scale: [1, 1.08, 1] }}
                        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                        className="absolute -top-2 right-3 rounded-full bg-amber-400 px-2 py-0.5 text-[9px] font-bold text-amber-950 shadow"
                      >
                        জনপ্রিয়
                      </motion.span>
                    )}

                    <span className="flex min-w-0 items-center gap-2">
                      {/* ✓ চেক আইকন — সিলেক্ট করলে আঁকা হয় */}
                      <span className="relative grid h-[18px] w-[18px] shrink-0 place-items-center">
                        <svg
                          width="18" height="18" viewBox="0 0 24 24" fill="none"
                          stroke="currentColor" strokeWidth="2"
                          className={`transition-colors duration-200 ${
                            active ? 'text-[color:var(--v-volt)]' : 'text-slate-300'
                          }`}
                          aria-hidden="true"
                        >
                          <circle cx="12" cy="12" r="10" />
                          <AnimatePresence>
                            {active && (
                              <motion.path
                                d="M8 12l3 3 5-6"
                                strokeWidth="2.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                initial={{ pathLength: 0 }}
                                animate={{ pathLength: 1 }}
                                exit={{ pathLength: 0 }}
                                transition={{ duration: 0.22, ease: 'easeOut' }}
                              />
                            )}
                          </AnimatePresence>
                        </svg>

                        {/* সিলেক্ট করলে রিং ছড়ায় */}
                        <AnimatePresence>
                          {active && (
                            <motion.span
                              initial={{ scale: 0.6, opacity: 0.7 }}
                              animate={{ scale: 2.2, opacity: 0 }}
                              transition={{ duration: 0.5, ease: 'easeOut' }}
                              className="absolute inset-0 rounded-full border-2 border-[var(--violet)]"
                            />
                          )}
                        </AnimatePresence>
                      </span>

                      <span className="min-w-0">
                        {/* ★ আর ellipsis নয় — গ্রাহক এখানেই প্যাকেজ বাছেন,
                            তাই নামটি দুই লাইনে মুড়ে গেলেও পুরো দেখা যায়
                            ("৩৫৫ ডায়মন্ড" আর "৩৫৫ Dia…" নয়)। */}
                        <span className="block text-sm font-semibold leading-tight text-slate-800" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                          {v.label}
                        </span>
                        {/* ★ প্যাকেজভিত্তিক সৎ ডেলিভারি সময় (2.14)।
                            "Instant" নয় — বাস্তব সময়, প্যাকেজ অনুযায়ী। */}
                        {v.deliveryMinutes != null && (
                          <span
                            className="mt-0.5 block text-[10px] font-medium"
                            style={{ color: 'var(--mut)' }}
                          >
                            ⏱ ~{formatDuration(v.deliveryMinutes)}
                          </span>
                        )}
                        {/* ★ প্রতি ইউনিটের দাম (2.16) — বড় প্যাকেজের
                            সাশ্রয় নিজে থেকেই বোঝা যায়। এটি হিসাব করা
                            সত্য, বিপণনের দাবি নয়। */}
                        {unitHint(v) && (
                          <span
                            className="mt-0.5 block text-[10px]"
                            style={{ color: 'var(--mut)' }}
                          >
                            {unitHint(v)}
                          </span>
                        )}
                      </span>
                      <Icon name="gem" size={14} className="shrink-0" />
                    </span>

                    {/* ★ "355 TK" → "৳355"।
                        দুটি কারণ: (১) বাকি পুরো সাইট `bdt()` দিয়ে
                        ৳-চিহ্ন লেখে (ওয়ালেট, খতিয়ান, চালান) — এই
                        একটি জায়গাতেই "TK" ছিল; (২) সরু কলামে
                        "TK" শব্দটি দামের চেয়ে বেশি জায়গা নিত, ফলে
                        বাঁয়ের নামটি বেশি লাইনে ভেঙে একই সারির
                        কার্ডগুলোর উচ্চতা অসমান দেখাত। */}
                    <span className="shrink-0 text-right">
                      <span className="v-dsp block whitespace-nowrap text-base font-extrabold" style={{ color: 'var(--v-ink)' }}>
                        ৳{v.price.toFixed(0)}
                      </span>
                      {v.oldPrice && v.oldPrice > v.price && (
                        <span className="block whitespace-nowrap text-[10px] text-slate-400 line-through">
                          ৳{v.oldPrice.toFixed(0)}
                        </span>
                      )}
                      {out && <span className="block text-[10px] text-red-500">স্টক শেষ</span>}
                      {v.stock > 0 && v.stock <= 5 && (
                        <span className="block text-[10px] text-amber-600">{v.stock} টি বাকি</span>
                      )}
                    </span>
                  </motion.button>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* ═══════ ডান sidebar ═══════ */}
      <div className="space-y-5 lg:sticky lg:top-20 lg:self-start">
        {/* ── ২ Account Info ── */}
        <section className="card overflow-hidden" aria-labelledby="s2">
          <div className="flex items-center gap-2.5 border-b border-slate-200 px-5 py-4">
            <StepBadge n={2} />
            <h2 id="s2" className="text-lg font-bold text-slate-900">অ্যাকাউন্টের তথ্য</h2>
          </div>

          <div className="space-y-3 p-5">
            {/* ★ আগে ব্যবহৃত UID — এক ট্যাপে বসে (2.12)।
                বেশিরভাগ গ্রাহক নিজের একই অ্যাকাউন্টেই বারবার টপ-আপ করে,
                তাই প্রতিবার দুইবার টাইপ করানো অপ্রয়োজনীয় ঘর্ষণ ও
                নতুন টাইপোর সুযোগ। */}
            {recentUids.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-semibold text-slate-500">
                  আগে ব্যবহার করেছেন
                </p>
                <div className="flex flex-wrap gap-2">
                  {recentUids.map((r) => (
                    <button
                      key={r.uid}
                      type="button"
                      onClick={() => {
                        // ★ দুই ঘরেই বসাই — এটি যাচাইকৃত পুরনো UID,
                        //   টাইপো হওয়ার সুযোগ নেই, তাই দ্বিতীয়বার
                        //   লিখতে বলা অর্থহীন ঘর্ষণ হতো
                        setUid(r.uid);
                        setUidConfirm(r.uid);
                        setUidErr('');
                      }}
                      className="rounded-lg border px-3 py-1.5 text-xs font-semibold transition"
                      style={{
                        // ★ নির্বাচিত চিপের বর্ডার **নিরেট** `--gold` —
                        //   `aria-pressed` ছাড়া এটিই একমাত্র দৃশ্যমান
                        //   ইঙ্গিত যে কোন UID বাছা হয়েছে। মাপা: .6 আভায়
                        //   লাইটে ছিল **১.৩৫:১**, অর্থাৎ সাদা কার্ডে
                        //   ক্রিম দাগ — নির্বাচন দেখাই যেত না। নিরেটে
                        //   ৪.১৪:১ (লাইট) ও ১৩.৪:১ (ডার্ক)।
                        borderColor: uid === r.uid ? 'var(--gold)' : 'var(--hair)',
                        background: uid === r.uid ? 'rgba(var(--gold-glow),.10)' : 'var(--glass)',
                        color: 'var(--ink)',
                      }}
                      aria-pressed={uid === r.uid}
                    >
                      <span className="font-mono">{r.uid}</span>
                      {r.name && (
                        <span className="ml-1.5 font-normal" style={{ color: 'var(--mut)' }}>
                          {r.name}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div>
              <label htmlFor="uid" className="mb-1.5 block text-sm font-semibold text-slate-700">
                {uidLabel}
              </label>
              <input
                id="uid"
                className="input"
                placeholder={uidLabel}
                value={uid}
                onChange={(e) => {
                  setUid(e.target.value);
                  if (uidErr) validateUid(e.target.value);
                }}
                onBlur={(e) => e.target.value && validateUid(e.target.value)}
                aria-invalid={Boolean(uidErr)}
                aria-describedby={uidErr ? 'uid-err' : 'uid-hint'}
                autoComplete="off"
              />
              {uidErr && (
                <p id="uid-err" role="alert" className="mt-1 text-xs text-red-600">{uidErr}</p>
              )}
            </div>

            {/* ★★★ UID নিশ্চিতকরণ — ভুল অ্যাকাউন্টে টপ-আপ ঠেকানোর মূল সুরক্ষা।
                লাইভ যাচাই (provider) না থাকায় double-entry ব্যবহার করা হয়:
                একই টাইপো দুইবার হয় না, তাই ভুল ধরা পড়ে। */}
            <div>
              <label htmlFor="uid2" className="mb-1.5 block text-sm font-semibold text-slate-700">
                {uidLabel} আবার লিখুন
              </label>
              <input
                id="uid2"
                className="input"
                placeholder={`নিশ্চিত করতে আবার লিখুন`}
                value={uidConfirm}
                onChange={(e) => setUidConfirm(e.target.value)}
                onPaste={(e) => {
                  // ★ পেস্ট আটকানো হয় — কপি-পেস্ট করলে double-entry এর
                  //   পুরো উদ্দেশ্যই নষ্ট, একই ভুল দুইবার বসে যায়
                  e.preventDefault();
                  setPasteBlocked(true);
                }}
                aria-invalid={uidMismatch}
                aria-describedby="uid2-msg"
                autoComplete="off"
                spellCheck={false}
              />
              <p id="uid2-msg" className="mt-1 text-xs" role={uidMismatch ? 'alert' : undefined}>
                {uidMismatch ? (
                  <span className="text-red-600">
                    ✕ দুইটি {uidLabel} মিলছে না — ভালো করে দেখে নিন
                  </span>
                ) : uidMatched ? (
                  <span className="text-emerald-600">✓ {uidLabel} মিলে গেছে</span>
                ) : pasteBlocked ? (
                  <span className="text-amber-600">
                    পেস্ট করা যাবে না — নিরাপত্তার জন্য হাতে লিখুন
                  </span>
                ) : (
                  <span className="text-slate-500">
                    ভুল ঠেকাতে {uidLabel} দুইবার লিখতে হবে
                  </span>
                )}
              </p>
            </div>

            <div>
              <label htmlFor="pname" className="mb-1.5 block text-sm font-semibold text-slate-700">
                প্লেয়ার নাম <span className="font-normal text-slate-400">(ঐচ্ছিক)</span>
              </label>
              <input
                id="pname"
                className="input"
                placeholder="গেমে যে নাম দেখায়"
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                autoComplete="off"
              />
              <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
                নাম দিলে অ্যাডমিন UID মিলিয়ে দেখতে পারবে — ভুল টপ আপ হওয়ার ঝুঁকি কমে।
              </p>
            </div>

            <p id="uid-hint" className="rounded-lg bg-amber-50 p-2.5 text-[11px] leading-relaxed text-amber-800">
              {uidHint && <>{uidHint}<br /></>}
              ⚠️ ভুল {uidLabel} দিলে ভুল অ্যাকাউন্টে টপ আপ হবে — ফেরত পাওয়া যাবে না।
            </p>
          </div>
        </section>

        {/* ── ৩ Payment Methods ── */}
        <section className="card overflow-hidden" aria-labelledby="s3">
          <div className="flex items-center gap-2.5 border-b border-slate-200 px-5 py-4">
            <StepBadge n={3} />
            <h2 id="s3" className="text-lg font-bold text-slate-900">Payment Methods</h2>
          </div>

          <div className="space-y-4 p-5">
            {/* ★ দুইটা পেমেন্ট পথ — ওয়ালেট (ফেরত আসা গ্রাহক) বা
                ডাইরেক্ট পে (নতুন গ্রাহক, আগে টাকা জমা রাখতে হয় না) */}
            <div
              className="grid grid-cols-2 gap-3"
              role="radiogroup"
              aria-label="পেমেন্টের মাধ্যম"
            >
              {/* Pay With Wallet */}
              <button
                type="button"
                role="radio"
                aria-checked={payMode === 'wallet'}
                onClick={() => setPayMode('wallet')}
                className={`relative overflow-hidden rounded-xl border-2 bg-white p-3 text-center transition ${
                  payMode === 'wallet'
                    ? 'border-[var(--violet)] shadow-sm'
                    : 'border-slate-200 hover:border-[var(--violet)]'
                }`}
              >
                {payMode === 'wallet' && (
                  <span className="absolute right-1.5 top-1.5" style={{ color: 'var(--v-volt)' }} aria-hidden="true">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                  </span>
                )}

                <div className="mx-auto mb-1.5 flex h-9 items-center justify-center gap-1">
                  <span className="rounded bg-[var(--violet)] px-1.5 py-1 text-[9px] font-black leading-none text-white">
                    TOPUP
                  </span>
                  <Icon name="wallet" size={20} />
                </div>

                <p className="text-[11px] font-bold text-slate-800">Pay With Wallet</p>
                <p className="mt-0.5 text-[10px] font-semibold text-emerald-600">
                  ৳{bal.toFixed(2)}
                </p>
              </button>

              {/* ★ ডাইরেক্ট পে — ওয়ালেটে আগে টাকা না রেখেই কেনা যায়।
                  নতুন গ্রাহকের জন্য এটাই ডিফল্ট পছন্দ হওয়া উচিত। */}
              <button
                type="button"
                role="radio"
                aria-checked={payMode === 'direct'}
                onClick={() => setPayMode('direct')}
                disabled={channels.length === 0}
                className={`relative rounded-xl border-2 bg-white p-3 text-center transition disabled:cursor-not-allowed disabled:opacity-50 ${
                  payMode === 'direct'
                    ? 'border-[var(--violet)] shadow-sm'
                    : 'border-slate-200 hover:border-[var(--violet)]'
                }`}
              >
                {payMode === 'direct' && (
                  <span className="absolute right-1.5 top-1.5" style={{ color: 'var(--v-volt)' }} aria-hidden="true">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                  </span>
                )}
                {/* ⚠️ এই দুটি চিপ আগে ব্র্যান্ড-রঙে ভরাট ছিল, উপরে সাদা
                    লেখা। Nagad এর অফিসিয়াল লালে (#EE1C25) সেই জোড়ার
                    মাপা কনট্রাস্ট ৪.৩৫:১ — WCAG চায় ৪.৫:১। প্রকল্পে এটি
                    দীর্ঘদিন "স্বীকৃত বিচ্যুতি" হিসেবে নথিভুক্ত ছিল
                    (POLISH_REPORT §6.3), এই যুক্তিতে যে ব্র্যান্ডের রঙ
                    বদলানো যায় না।

                    আপসটা আসলে অপ্রয়োজনীয় ছিল: রঙটি **পাশ-দণ্ডে ও আভায়**
                    সরিয়ে দিলে মাধ্যমটি ঠিক আগের মতোই চেনা যায়, অথচ লেখা
                    পুরো ১৯.৪:১ এ ওঠে। ব্র্যান্ড অক্ষত, বিচ্যুতি শেষ। */}
                <div className="mx-auto mb-1.5 flex h-9 flex-wrap items-center justify-center gap-1.5">
                  {[
                    { n: 'bKash', t: '#E2136E' },
                    { n: 'নগদ', t: '#EE1C25' },
                  ].map((b) => (
                    <span
                      key={b.n}
                      className="px-1.5 py-1 text-[9px] font-black leading-none"
                      style={{
                        color: 'var(--v-ink)',
                        background: 'var(--v-void)',
                        boxShadow: `inset 2px 0 0 ${b.t}`,
                      }}
                    >
                      {b.n}
                    </span>
                  ))}
                </div>

                <p className="text-[11px] font-bold text-slate-800">সরাসরি পেমেন্ট</p>
                <p className="mt-0.5 text-[10px] text-slate-500">
                  {channels.length === 0 ? 'এখন বন্ধ' : 'ওয়ালেট লাগবে না'}
                </p>
              </button>
            </div>

            {/* ★ ডাইরেক্ট পে এর তথ্য — শুধু নির্বাচিত হলে */}
            {payMode === 'direct' && sel && (
              <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-bold text-slate-700">
                  ১. নিচের নাম্বারে ঠিক{' '}
                  <span className="v-dsp font-extrabold" style={{ color: 'var(--v-volt)' }}>৳{payable.toFixed(2)}</span> Send Money করুন
                </p>

                <div
                  className="flex flex-wrap gap-2"
                  role="radiogroup"
                  aria-label="পেমেন্ট মাধ্যম"
                >
                  {channels.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      role="radio"
                      aria-checked={dpMethod === c.method}
                      onClick={() => setDpMethod(c.method)}
                      className={`rounded-lg border-2 px-3 py-1.5 text-xs font-bold transition ${
                        dpMethod === c.method
                          ? 'border-[color:var(--v-volt)] text-[color:var(--v-volt)]'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-[var(--violet)]'
                      }`}
                    >
                      {c.method}
                    </button>
                  ))}
                </div>

                {channels
                  .filter((c) => c.method === dpMethod)
                  .map((c) => (
                    <div key={c.id} className="rounded-lg border border-slate-200 bg-white p-3">
                      <p className="text-[11px] font-semibold text-slate-500">
                        {c.method} — {c.accountType}
                      </p>
                      <p className="font-mono text-lg font-bold text-slate-900">{c.accountNo}</p>
                      {c.instruction && (
                        <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                          {c.instruction}
                        </p>
                      )}
                    </div>
                  ))}

                <p className="text-xs font-bold text-slate-700">২. পেমেন্টের তথ্য দিন</p>

                <div>
                  <label htmlFor="dp-trx" className="mb-1 block text-xs font-semibold text-slate-600">
                    ট্রানজেকশন আইডি (TrxID)
                  </label>
                  <input
                    id="dp-trx"
                    className="input"
                    placeholder="যেমন: 9A7B2C4D1E"
                    value={dpTrxId}
                    onChange={(e) => setDpTrxId(e.target.value.toUpperCase())}
                    autoComplete="off"
                  />
                </div>

                <div>
                  <label htmlFor="dp-sender" className="mb-1 block text-xs font-semibold text-slate-600">
                    যে নাম্বার থেকে পাঠিয়েছেন
                  </label>
                  <input
                    id="dp-sender"
                    className="input"
                    placeholder="01XXXXXXXXX"
                    value={dpSender}
                    onChange={(e) => setDpSender(e.target.value)}
                    autoComplete="off"
                  />
                </div>

                <p className="rounded-lg bg-amber-50 p-2.5 text-[11px] leading-relaxed text-amber-800">
                  ⚠️ <strong>Send Money</strong> করুন, <strong>Cash Out</strong> নয়। অ্যাডমিন TrxID
                  মিলিয়ে দেখার পরেই ডেলিভারি শুরু হবে।
                </p>
              </div>
            )}

            {/* কুপন */}
            {applied ? (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex items-center justify-between gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="font-mono text-sm font-bold text-emerald-700">{applied.code}</p>
                  <p className="text-[11px] text-emerald-600">−৳{applied.discount.toFixed(2)} ছাড়</p>
                </div>
                <button
                  onClick={() => {
                    setApplied(null);
                    setCoupon('');
                    toast.info('কুপন সরানো হয়েছে');
                  }}
                  className="shrink-0 rounded-md px-2 py-1 text-xs font-bold text-emerald-700 hover:bg-emerald-100"
                >
                  ✕
                </button>
              </motion.div>
            ) : (
              <div className="flex gap-2">
                <label htmlFor="coupon" className="sr-only">কুপন কোড</label>
                <input
                  id="coupon"
                  className="input font-mono uppercase"
                  placeholder="কুপন কোড (ঐচ্ছিক)"
                  value={coupon}
                  onChange={(e) => setCoupon(e.target.value.toUpperCase())}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      applyCoupon();
                    }
                  }}
                  autoComplete="off"
                />
                <button
                  onClick={applyCoupon}
                  disabled={checking || !coupon.trim() || !sel}
                  className="btn-ghost shrink-0 px-3"
                >
                  {checking ? '...' : 'প্রয়োগ'}
                </button>
              </div>
            )}

            {/* সারাংশ */}
            <AnimatePresence>
              {sel && (
                <motion.dl
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.25 }}
                  className="space-y-1.5 overflow-hidden rounded-lg bg-slate-50 p-3 text-sm"
                >
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500">প্যাকেজ</dt>
                    <dd className="truncate text-right font-semibold text-slate-800">{sel.label}</dd>
                  </div>

                  {applied && (
                    <>
                      <div className="flex justify-between">
                        <dt className="text-slate-500">সাবটোটাল</dt>
                        <dd className="text-slate-600">৳{sel.price.toFixed(2)}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-emerald-600">ছাড়</dt>
                        <dd className="font-semibold text-emerald-600">−৳{applied.discount.toFixed(2)}</dd>
                      </div>
                    </>
                  )}
                  <div className="flex justify-between border-t border-slate-200 pt-1.5">
                    <dt className="font-bold text-slate-700">মোট</dt>
                    <dd>
                      {/* ⚠️ CountUp কোনো `style` prop নেয় না — রঙটি
                          Tailwind এর arbitrary-value সিনট্যাক্সে টোকেন
                          থেকেই আসে, যাতে হার্ডকোড হেক্স না ঢোকে। */}
                      <CountUp
                        value={total}
                        prefix="৳"
                        className="v-dsp text-lg font-extrabold text-[color:var(--v-volt)]"
                      />
                    </dd>
                  </div>
                </motion.dl>
              )}
            </AnimatePresence>

            {/* ★ ব্যালেন্স চেক + বোতাম */}
            {status === 'loading' ? (
              <div className="skeleton h-12 w-full" />
            ) : !authed ? (
              /* ── লগইন করা নেই ── */
              <>
                <p className="flex items-center gap-1.5 text-xs font-semibold text-rose-600">
                  <span aria-hidden="true">ⓘ</span> অর্ডার করতে লগইন করুন
                </p>
                <Link
                  href="/login"
                  className="btn-primary shimmer-btn w-full py-3.5 text-base font-bold uppercase tracking-widest"
                >
                  LOGIN
                </Link>
                <p className="text-center text-xs text-slate-500">
                  অ্যাকাউন্ট নেই?{' '}
                  <Link href="/register" className="inline-flex min-h-[44px] items-center font-bold hover:underline" style={{ color: 'var(--v-volt)' }}>
                    রেজিস্টার করুন
                  </Link>
                </p>
              </>
            ) : !sel ? (
              /* ── প্যাকেজ বাছাই করেনি ── */
              <button disabled className="btn-primary w-full py-3.5 text-base font-bold">
                ← আগে একটি প্যাকেজ বেছে নিন
              </button>
            ) : balance === null ? (
              /* ── ব্যালেন্স আসছে ── */
              <div className="skeleton h-12 w-full" />
            ) : payMode === 'direct' ? (
              /* ── ডাইরেক্ট পে — ব্যালেন্স লাগে না ── */
              !uidTrim ? (
                <button disabled className="btn-primary w-full py-3.5 text-base font-bold">
                  ↑ {uidLabel} লিখুন
                </button>
              ) : !uidMatched ? (
                <button disabled className="btn-primary w-full py-3.5 text-base font-bold">
                  {uidMismatch
                    ? `↑ দুইটি ${uidLabel} মিলছে না`
                    : `↑ ${uidLabel} আবার লিখে নিশ্চিত করুন`}
                </button>
              ) : !dpTrxValid ? (
                <button disabled className="btn-primary w-full py-3.5 text-base font-bold">
                  ↑ ট্রানজেকশন আইডি দিন
                </button>
              ) : !dpSenderValid ? (
                <button disabled className="btn-primary w-full py-3.5 text-base font-bold">
                  ↑ প্রেরকের নাম্বার দিন
                </button>
              ) : (
                <>
                  <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-2.5">
                    <span aria-hidden="true">✓</span>
                    <p className="text-xs font-semibold text-emerald-700">
                      পেমেন্ট যাচাইয়ের পর ডেলিভারি শুরু হবে
                    </p>
                  </div>
                  <button
                    onClick={() => setConfirm(true)}
                    disabled={loading}
                    className="btn-primary shimmer-btn w-full py-3.5 text-base font-bold"
                  >
                    {loading ? 'পাঠানো হচ্ছে…' : `৳${payable.toFixed(2)} — অর্ডার করুন`}
                  </button>
                </>
              )
            ) : short > 0 ? (
              /* ── ★ ব্যালেন্স কম — সরাসরি Add Money বোতাম ── */
              <>
                <div className="rounded-lg border-2 border-rose-300 bg-rose-50 p-3">
                  <p className="text-sm font-bold text-rose-800">
                    ৳{short.toFixed(2)} টাকা কম আছে
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-rose-600">
                    দাম ৳{total.toFixed(2)} · আপনার আছে ৳{bal.toFixed(2)}
                  </p>
                </div>

                <Link
                  href="/account/wallet/deposit"
                  className="btn-primary w-full py-3.5 text-base font-bold"
                >
                  ৳{short.toFixed(0)} টাকা যোগ করুন
                </Link>

                <p className="text-center text-[11px] leading-relaxed text-slate-500">
                  bKash / Nagad এ Send Money করে TrxID দিন — অ্যাডমিন যাচাই করে ব্যালেন্স যোগ
                  করবে (৫–৩০ মিনিট)।
                </p>
              </>
            ) : !uid.trim() ? (
              /* ── UID দেয়নি ── */
              <button disabled className="btn-primary w-full py-3.5 text-base font-bold">
                ↑ {uidLabel} লিখুন
              </button>
            ) : !uidMatched ? (
              /* ── UID নিশ্চিত করেনি বা মিলছে না ── */
              <button disabled className="btn-primary w-full py-3.5 text-base font-bold">
                {uidMismatch
                  ? `↑ দুইটি ${uidLabel} মিলছে না`
                  : `↑ ${uidLabel} আবার লিখে নিশ্চিত করুন`}
              </button>
            ) : (
              /* ── সব ঠিক আছে ── */
              <>
                <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-2.5">
                  <span aria-hidden="true">✓</span>
                  <p className="text-xs font-semibold text-emerald-700">
                    সব ঠিক আছে — অর্ডার করতে পারবেন
                  </p>
                </div>

                <button
                  onClick={() => setConfirm(true)}
                  disabled={loading || Boolean(uidErr)}
                  className="btn-primary w-full py-3.5 text-base font-bold uppercase tracking-wide"
                >
                  {loading ? 'প্রসেস হচ্ছে...' : `৳${total.toFixed(2)} — অর্ডার করুন`}
                </button>
              </>
            )}
          </div>
        </section>
      </div>

      {/* ★ অর্ডার প্রসেস হচ্ছে — এখন **বৈশ্বিক** LoadingProvider দেখায়
          (`POST /api/order` ধরা পড়ে স্বয়ংক্রিয়ভাবে, লেবেল `load.order`)।
          এখানকার স্থানীয় লোডারটি সরানো হয়েছে, নাহলে একই সময়ে দুটি
          ওভারলে চড়ত। ⚠️ `!burst` শর্তটিরও আর দরকার নেই: বৈশ্বিক ওভারলে
          fetch শেষ হলেই সরে যায়, অর্থাৎ SuccessBurst এর ঠিক আগে। */}

      {/* ★ অর্ডার সফল — টিক মার্ক + রিং */}
      <SuccessBurst show={burst} />

      <ConfirmDialog
        open={confirm}
        title="অর্ডার নিশ্চিত করবেন?"
        message={`${productName}\n${sel?.label}\n\n${uidLabel}: ${uid}${
          playerName ? `\nপ্লেয়ার নাম: ${playerName}` : ''
        }\nমোট: ৳${total.toFixed(2)}\n\n⚠️ UID ভালো করে মিলিয়ে নিন — ভুল হলে ফেরত পাওয়া যাবে না।`}
        confirmLabel="হ্যাঁ, অর্ডার করুন"
        onConfirm={submit}
        onCancel={() => setConfirm(false)}
      />
    </div>
  );
}
