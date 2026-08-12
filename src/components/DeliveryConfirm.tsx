'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { useToast } from '@/components/Toast';
import InlinePulse from '@/components/loading/InlinePulse';

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
  referralCode,
}: {
  orderId: string;
  orderNo: number;
  confirmed: boolean;
  disputed: boolean;
  hasReview: boolean;
  disputeWindowDays: number;
  /** ★ 5.4 — না থাকলে রেফারেল অংশটি দেখানো হয় না */
  referralCode?: string | null;
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
  const [photoUrl, setPhotoUrl] = useState<string | null>(null); // ★ ঐচ্ছিক স্ক্রিনশট
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [refCopied, setRefCopied] = useState(false);

  // ★ রেফারেল লিংক কপি (5.4) — ReferralCard এর মতোই origin-ভিত্তিক
  async function copyReferral() {
    if (!referralCode) return;
    const link = `${window.location.origin}/register?ref=${referralCode}`;
    try {
      await navigator.clipboard.writeText(link);
      setRefCopied(true);
      toast.success('রেফারেল লিংক কপি হয়েছে');
      setTimeout(() => setRefCopied(false), 2000);
    } catch {
      toast.error('কপি করা যায়নি');
    }
  }

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

  // ★ ঐচ্ছিক স্ক্রিনশট আপলোড — গ্রাহক চাইলে দেবে; বাধ্যতামূলক নয়
  async function uploadPhoto(file: File) {
    if (!file.type.startsWith('image/')) {
      toast.error('শুধু ছবি আপলোড করা যাবে');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('ছবি ৫MB এর কম হতে হবে');
      return;
    }
    setUploadingPhoto(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('folder', 'reviews');
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'আপলোড ব্যর্থ');
      setPhotoUrl(d.url);
      toast.success('ছবি যোগ হয়েছে');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'আপলোড ব্যর্থ');
    } finally {
      setUploadingPhoto(false);
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
        body: JSON.stringify({ orderId, rating, body: body.trim() || undefined, photoUrl: photoUrl || undefined }),
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
          তারা গেমের রেকর্ড মিলিয়ে দেখবে। অর্ডার নাম্বার{' '}
          <span className="font-mono" style={{ color: 'var(--ink)' }}>#{orderNo}</span>।
        </p>

        {/* ★★★ Group I (৪) — এখান থেকেই বিরোধ-থ্রেড।
            ⚠️ আগে এটি `/contact` (Tawk.to) এ পাঠাত — সাইটের বাইরে, কোনো
            ইতিহাস থাকত না, আর অর্ডারের সাথে সংযোগও না। টাকার বিরোধে
            "কে কী দাবি করেছিল" রেকর্ড না থাকাই সবচেয়ে বড় ফাঁক ছিল।
            টিকিটে অর্ডারটি আগেই বাছা থাকে, তাই গ্রাহককে নম্বর মনে
            রেখে টাইপ করতে হয় না। */}
        <Link
          href={`/account/tickets?order=${orderId}`}
          className="btn-primary mt-4 px-5 text-sm"
        >
          সমস্যা বিস্তারিত জানান
        </Link>
        <p className="mt-2 text-xs" style={{ color: 'var(--mut)' }}>
          পুরো কথোপকথন এখানেই সংরক্ষিত থাকবে।
        </p>
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

          {/* ★★★ রেফারেল আমন্ত্রণ — ঠিক এই মুহূর্তে (5.4)
              গ্রাহক এইমাত্র জিনিস পেয়েছেন এবং ভালো রেটিং দিয়েছেন।
              সন্তুষ্টি এখানেই সর্বোচ্চ, তাই বন্ধুকে বলার অনুরোধের
              জন্য এটিই একমাত্র সৎ মুহূর্ত।

              ⚠️ অর্ডারের আগে বা ডেলিভারির অপেক্ষার সময় এটি দেখানো
              হয় না — তখন গ্রাহক জানেনই না জিনিসটা পাবেন কি না,
              আর তখন সুপারিশ চাওয়া মানে ভরসা নষ্ট করা। */}
          {referralCode && (
            <div className="mt-4 border-t pt-4" style={{ borderColor: 'var(--hair)' }}>
              <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
                বন্ধুকে জানাবেন?
              </p>
              <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--mut)' }}>
                আপনার কোড দিয়ে কেউ প্রথম টপ-আপ করলে আপনি বোনাস পাবেন।
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <code
                  className="rounded-md px-3 py-2 font-mono text-sm"
                  style={{ background: 'var(--glass)', border: '1px solid var(--hair)', color: 'var(--gold)' }}
                >
                  {referralCode}
                </code>
                <button
                  type="button"
                  onClick={copyReferral}
                  className="btn-ghost min-h-[40px] px-4 text-sm"
                  aria-label="রেফারেল লিংক কপি করুন"
                >
                  {refCopied ? '✓ কপি হয়েছে' : 'লিংক কপি'}
                </button>
              </div>
            </div>
          )}
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

        {/* ★ ঐচ্ছিক স্ক্রিনশট — বাধ্যতামূলক নয়। যার ইচ্ছা দেবে,
            যার ইচ্ছা নয় সে ছাড়াই রিভিউ পাঠাতে পারবে। */}
        <label className="label mt-4">স্ক্রিনশট (ঐচ্ছিক)</label>
        {photoUrl ? (
          <div className="relative mt-1 inline-block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photoUrl} alt="রিভিউ ছবি" className="h-24 w-24 rounded-lg border object-cover" style={{ borderColor: 'var(--v-edge2)' }} />
            <button
              type="button"
              onClick={() => setPhotoUrl(null)}
              aria-label="ছবি সরান"
              className="absolute -right-2 -top-2 grid h-6 w-6 place-items-center rounded-full text-white shadow"
              style={{ background: 'var(--v-heat)' }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>
        ) : (
          <label
            className="mt-1 flex min-h-[72px] cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed p-3 text-center transition"
            style={{ borderColor: 'var(--v-edge2)', color: 'var(--v-mut)' }}
          >
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              disabled={uploadingPhoto}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPhoto(f); e.target.value = ''; }}
            />
            {uploadingPhoto ? (
              /* ★ আগে এখানে সাধারণ `animate-spin` বৃত্ত ছিল — কোডবেসের
                 একমাত্র অবশিষ্ট জেনেরিক স্পিনার। এখন সবখানে একই
                 শক্তি-কেন্দ্র (কোনো নকল লোডিং বাস্তবায়ন নেই)। */
              <InlinePulse size={18} />
            ) : (
              <>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 16l5-5 4 4 3-3 4 4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" /></svg>
                <span className="text-xs font-semibold">ছবি যোগ করুন (চাইলে)</span>
              </>
            )}
          </label>
        )}

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
