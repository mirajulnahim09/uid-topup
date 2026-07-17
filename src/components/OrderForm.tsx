'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useToast, ConfirmDialog } from './Toast';
import { motion, AnimatePresence } from 'framer-motion';
import { CountUp, SuccessBurst } from './motion';

type V = {
  id: number; label: string; price: number;
  oldPrice: number | null; stock: number; isPopular: boolean;
};
type Applied = { code: string; label: string; discount: number; finalPrice: number };

/** লাল গোল নাম্বার ব্যাজ — ১ ২ ৩ */
function StepBadge({ n }: { n: number }) {
  return (
    <span
      className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-rose-600 text-sm font-bold text-white shadow-sm"
      aria-hidden="true"
    >
      {n}
    </span>
  );
}

export default function OrderForm({
  productName, uidLabel, uidHint, variants,
}: {
  productName: string;
  uidLabel: string;
  uidHint: string | null;
  variants: V[];
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
  const [playerName, setPlayerName] = useState('');
  const [coupon, setCoupon] = useState('');
  const [applied, setApplied] = useState<Applied | null>(null);
  const [checking, setChecking] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [burst, setBurst] = useState(false);

  const authed = status === 'authenticated';

  const loadBalance = useCallback(async () => {
    if (status !== 'authenticated') return;
    try {
      const res = await fetch('/api/me');
      if (res.ok) setBalance(Number((await res.json()).balance));
    } catch {
      /* silent — ব্যালেন্স না এলেও অর্ডার বোতাম কাজ করবে, সার্ভার যাচাই করবে */
    }
  }, [status]);

  useEffect(() => {
    loadBalance();
  }, [loadBalance]);

  const total = applied ? applied.finalPrice : sel?.price ?? 0;
  const bal = balance ?? 0;
  const short = Math.max(0, total - bal); // আরও কত টাকা লাগবে

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
    setConfirm(false);
    setLoading(true);

    try {
      const res = await fetch('/api/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          variantId: sel!.id,
          playerUid: uid.trim(),
          playerName: playerName.trim() || undefined,
          couponCode: applied?.code || undefined,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'অর্ডার করা যায়নি');

      // ★ সেলিব্রেশন — তারপর অর্ডার পেজে
      setBurst(true);
      toast.success(d.message);
      setUid('');
      setPlayerName('');
      setSel(null);
      setCoupon('');
      setApplied(null);

      setTimeout(() => {
        router.push('/account/orders');
        startTransition(() => router.refresh());
      }, 850);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'অর্ডার করা যায়নি');
    } finally {
      setLoading(false);
    }
  }

  const ready = Boolean(sel && uid.trim() && !uidErr);

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      {/* ═══════ বাম: ১ Select Recharge (২ কলাম জুড়ে) ═══════ */}
      <section className="card overflow-hidden lg:col-span-2" aria-labelledby="s1">
        <div className="flex items-center gap-2.5 border-b border-slate-200 px-5 py-4">
          <StepBadge n={1} />
          <h2 id="s1" className="text-lg font-bold text-slate-900">Select Recharge</h2>
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
                            active ? 'text-rose-600' : 'text-slate-300'
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
                              className="absolute inset-0 rounded-full border-2 border-rose-400"
                            />
                          )}
                        </AnimatePresence>
                      </span>

                      <span className="truncate text-sm font-semibold text-slate-800">
                        {v.label}
                      </span>
                      <span className="shrink-0 text-sm" aria-hidden="true">💎</span>
                    </span>

                    <span className="shrink-0 text-right">
                      <span className="block whitespace-nowrap text-base font-extrabold text-rose-600">
                        {v.price.toFixed(0)} TK
                      </span>
                      {v.oldPrice && v.oldPrice > v.price && (
                        <span className="block text-[10px] text-slate-400 line-through">
                          {v.oldPrice.toFixed(0)} TK
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
            <h2 id="s2" className="text-lg font-bold text-slate-900">Account Info</h2>
          </div>

          <div className="space-y-3 p-5">
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
            {/* ★ দুইটা পেমেন্ট কার্ড — uidtopup এর মতো */}
            <div className="grid grid-cols-2 gap-3">
              {/* Pay With Wallet — সবসময় সিলেক্টেড (একমাত্র উপায়) */}
              <div className="relative overflow-hidden rounded-xl border-2 border-rose-500 bg-white p-3 text-center shadow-sm">
                <span className="absolute right-1.5 top-1.5 text-rose-600" aria-hidden="true">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                </span>

                <div className="mx-auto mb-1.5 flex h-9 items-center justify-center gap-1">
                  <span className="rounded bg-rose-600 px-1.5 py-1 text-[9px] font-black leading-none text-white">
                    TOPUP
                  </span>
                  <span className="text-lg" aria-hidden="true">👛</span>
                </div>

                <p className="text-[11px] font-bold text-slate-800">Pay With Wallet</p>
                <p className="mt-0.5 text-[10px] font-semibold text-emerald-600">
                  ৳{bal.toFixed(2)}
                </p>
              </div>

              {/* Add Money — ম্যানুয়াল ডিপোজিট পেজে নিয়ে যায় */}
              <Link
                href="/account/wallet/deposit"
                className="group rounded-xl border-2 border-slate-200 bg-white p-3 text-center transition hover:-translate-y-0.5 hover:border-rose-300 hover:shadow-md"
              >
                <div className="mx-auto mb-1.5 flex h-9 flex-wrap items-center justify-center gap-1">
                  <span className="rounded bg-[#E2136E] px-1.5 py-0.5 text-[8px] font-black leading-none text-white">
                    bKash
                  </span>
                  <span className="rounded bg-[#EE1C25] px-1.5 py-0.5 text-[8px] font-black leading-none text-white">
                    নগদ
                  </span>
                  <span className="rounded bg-[#8C3494] px-1.5 py-0.5 text-[8px] font-black leading-none text-white">
                    Rocket
                  </span>
                </div>

                <p className="text-[11px] font-bold text-slate-800">Add Money</p>
                <p className="mt-0.5 text-[10px] text-slate-500">ম্যানুয়াল যাচাই</p>
              </Link>
            </div>

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
                      <CountUp
                        value={total}
                        prefix="৳"
                        className="text-lg font-extrabold text-rose-600"
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
                  <Link href="/register" className="font-bold text-rose-600 hover:underline">
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
                  💳 ৳{short.toFixed(0)} টাকা যোগ করুন
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
