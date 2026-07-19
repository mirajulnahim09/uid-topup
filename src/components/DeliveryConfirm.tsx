'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { useToast } from '@/components/Toast';

/**
 * ═══════════════════════════════════════════════════════════
 * ★ ডেলিভারি নিশ্চিতকরণ ও রিভিউ (MANUAL_WORKFLOW.md A8)
 *
 *   তিনটি অবস্থা:
 *     ১. এখনো উত্তর দেয়নি  → "পৌঁছেছে কি?" প্রশ্ন
 *     ২. পেয়েছে বলেছে       → রিভিউ চাওয়া (সন্তুষ্টির শীর্ষ মুহূর্ত)
 *     ৩. পায়নি বলেছে        → সাপোর্টের পথ, প্রসঙ্গসহ
 *
 *   ★ "পাইনি" বোতামটি লুকানো বা ছোট করা হয়নি — সৎ প্রশ্নের
 *     দুটো উত্তরই সমান সহজ হতে হবে, নাহলে উত্তরটা অর্থহীন।
 * ═══════════════════════════════════════════════════════════
 */
export default function DeliveryConfirm({
  orderId,
  orderNo,
  confirmed,
  disputed,
  hasReview,
  disputeWindowDays,
}: {
  orderId: string;
  orderNo: number;
  confirmed: boolean;
  disputed: boolean;
  hasReview: boolean;
  disputeWindowDays: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = useTransition();

  const [busy, setBusy] = useState(false);
  const [localConfirmed, setLocalConfirmed] = useState(confirmed);
  const [localDisputed, setLocalDisputed] = useState(disputed);
  const [reviewDone, setReviewDone] = useState(hasReview);
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [body, setBody] = useState('');

  async function answer(arrived: boolean) {
    setBusy(true);
    try {
      const res = await fetch('/api/order/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, arrived }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'জানানো যায়নি');

      if (arrived) setLocalConfirmed(true);
      else setLocalDisputed(true);

      toast.success(d.message);
      startTransition(() => router.refresh());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'জানানো যায়নি');
    } finally {
      setBusy(false);
    }
  }

  async function submitReview() {
    if (rating < 1) {
      toast.error('আগে রেটিং দিন');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, rating, body: body.trim() || undefined }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'রিভিউ জমা হয়নি');
      setReviewDone(true);
      toast.success(d.message);
      startTransition(() => router.refresh());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'রিভিউ জমা হয়নি');
    } finally {
      setBusy(false);
    }
  }

  // ─── ৩. পায়নি বলেছে ───
  if (localDisputed) {
    return (
      <div className="card p-5">
        <h2 className="dsp text-base font-semibold" style={{ color: 'var(--ink)' }}>
          আমরা বিষয়টি দেখছি
        </h2>
        <p className="mt-2 text-sm leading-relaxed" style={{ color: 'var(--mut)' }}>
          আপনি জানিয়েছেন ডেলিভারি পাননি। আমাদের টিমকে খবর দেওয়া হয়েছে —
          তারা গেমের রেকর্ড মিলিয়ে দেখবে। দ্রুত সমাধানের জন্য অর্ডার নাম্বার{' '}
          <span className="font-mono" style={{ color: 'var(--ink)' }}>#{orderNo}</span>{' '}
          উল্লেখ করে সাপোর্টে মেসেজ দিন।
        </p>
        <Link href="/contact" className="btn-primary mt-4 px-5 text-sm">
          সাপোর্টে যোগাযোগ
        </Link>
      </div>
    );
  }

  // ─── ২. পেয়েছে বলেছে → রিভিউ ───
  if (localConfirmed) {
    if (reviewDone) {
      return (
        <div className="card p-5">
          <p className="text-sm" style={{ color: 'var(--mut)' }}>
            ✓ ডেলিভারি নিশ্চিত করা হয়েছে — রিভিউর জন্য ধন্যবাদ।
          </p>
        </div>
      );
    }

    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="card p-5"
      >
        <h2 className="dsp text-base font-semibold" style={{ color: 'var(--ink)' }}>
          অভিজ্ঞতা কেমন ছিল?
        </h2>
        <p className="mt-1 text-xs" style={{ color: 'var(--mut)' }}>
          আপনার মতামত নতুন গ্রাহকদের ভরসা পেতে সাহায্য করে।
        </p>

        {/* রেটিং */}
        <div
          className="mt-4 flex gap-1"
          role="radiogroup"
          aria-label="রেটিং — ১ থেকে ৫"
        >
          {[1, 2, 3, 4, 5].map((n) => {
            const on = (hover || rating) >= n;
            return (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={rating === n}
                aria-label={`${n} তারা`}
                onMouseEnter={() => setHover(n)}
                onMouseLeave={() => setHover(0)}
                onFocus={() => setHover(n)}
                onBlur={() => setHover(0)}
                onClick={() => setRating(n)}
                className="grid h-11 w-11 place-items-center rounded-lg transition"
                style={{ color: on ? 'var(--gold)' : 'var(--line)' }}
              >
                <svg width="26" height="26" viewBox="0 0 24 24" fill={on ? 'currentColor' : 'none'}
                  stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                  <path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z" />
                </svg>
              </button>
            );
          })}
        </div>

        <label htmlFor="review-body" className="label mt-4">
          মন্তব্য (ঐচ্ছিক)
        </label>
        <textarea
          id="review-body"
          className="input"
          rows={3}
          maxLength={500}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="কী ভালো লেগেছে, বা কী আরও ভালো হতে পারত"
        />

        <button
          onClick={submitReview}
          disabled={busy || rating < 1}
          className="btn-primary mt-4 w-full py-3 text-sm font-bold disabled:opacity-50"
        >
          {busy ? 'পাঠানো হচ্ছে…' : 'রিভিউ পাঠান'}
        </button>
      </motion.div>
    );
  }

  // ─── ১. এখনো উত্তর দেয়নি ───
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="card p-5"
        style={{ borderColor: 'rgba(230,197,132,.28)' }}
      >
        <h2 className="dsp text-base font-semibold" style={{ color: 'var(--ink)' }}>
          আপনার অ্যাকাউন্টে পৌঁছেছে তো?
        </h2>
        <p className="mt-1.5 text-xs leading-relaxed" style={{ color: 'var(--mut)' }}>
          গেমে ঢুকে একবার দেখে নিন। কোনো সমস্যা হলে {disputeWindowDays} দিনের
          মধ্যে জানালে আমরা সমাধান করে দেব।
        </p>

        <div className="mt-4 flex flex-wrap gap-3">
          <button
            onClick={() => answer(true)}
            disabled={busy}
            className="btn-primary flex-1 py-3 text-sm font-bold disabled:opacity-50"
          >
            ✓ হ্যাঁ, পেয়েছি
          </button>
          {/* ★ সমান গুরুত্বের বোতাম — সৎ প্রশ্নের দুটো উত্তরই সহজ হতে হবে */}
          <button
            onClick={() => answer(false)}
            disabled={busy}
            className="btn-ghost flex-1 py-3 text-sm font-bold disabled:opacity-50"
          >
            ✕ না, পাইনি
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
