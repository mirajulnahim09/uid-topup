'use client';

import { useEffect, useState } from 'react';

/**
 * ★ "কিভাবে অর্ডার করবেন?" — মডাল
 *   ম্যানুয়াল ফ্লো ধাপে ধাপে ব্যাখ্যা করে।
 */
const STEPS = [
  {
    n: 1,
    title: 'ব্যালেন্স যোগ করুন',
    body: '"টাকা যোগ" পেজে যান। bKash / Nagad / Rocket এর যেকোনো একটা বেছে নিয়ে দেখানো নাম্বারে Send Money করুন (Cash Out নয়)।',
  },
  {
    n: 2,
    title: 'TrxID জমা দিন',
    body: 'পেমেন্টের পর যে ট্রানজেকশন আইডি (TrxID) পাবেন সেটা, আর যে নাম্বার থেকে পাঠিয়েছেন সেটা জমা দিন। স্ক্রিনশট দিলে দ্রুত হবে।',
  },
  {
    n: 3,
    title: 'অ্যাডমিন যাচাই করবে',
    body: 'আমরা হাতে TrxID মিলিয়ে দেখব। ঠিক থাকলে ৫–৩০ মিনিটের মধ্যে আপনার ওয়ালেটে টাকা যোগ হবে। নোটিফিকেশন পাবেন।',
  },
  {
    n: 4,
    title: 'প্যাকেজ ও UID দিন',
    body: 'প্রোডাক্ট পেজে প্যাকেজ বেছে নিন, Player UID লিখুন, তারপর অর্ডার কনফার্ম করুন। ওয়ালেট থেকে টাকা কাটা হবে।',
  },
  {
    n: 5,
    title: 'ডেলিভারি',
    body: 'অ্যাডমিন হাতে আপনার UID তে টপ আপ করে দেবে। সাধারণত ৫–৩০ মিনিট। সম্পন্ন হলে নোটিফিকেশন ও ইমেইল পাবেন।',
  },
];

export default function HowToOrder() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <>
      {/* ⚠️ আগে এটি ছিল `bg-white/20 … text-white` — সাদা লেখা ২০%
          সাদা ফিলের উপর। বসানো হয়েছিল যখন প্রোডাক্ট-হেডার একটি গাঢ়
          বেগুনি গ্রেডিয়েন্ট ছিল; হেডার পরে হালকা glass-কার্ডে বদলায়
          আর বোতামটি light থিমে **কার্যত অদৃশ্য** হয়ে যায় (সাদার উপর
          সাদা, ৩৯০px স্ক্রিনশটে ধরা পড়ে)। এখন টোকেন-চালিত
          `.sig-chip--ghost` — যেকোনো পৃষ্ঠতলে ও দুই থিমেই পাঠযোগ্য।
          ★ ট্যাপ-টার্গেট ৪৪px (আগে ৪০) — WCAG 2.5.5। */}
      <button
        onClick={() => setOpen(true)}
        className="sig-chip sig-chip--ghost mt-2 min-h-[44px] px-3.5 transition active:scale-95"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
          <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
          <path d="M15 3h6v6M10 14L21 3" />
        </svg>
        কিভাবে অর্ডার করবেন ?
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="hto-title"
          className="fixed inset-0 z-[95] grid place-items-center bg-slate-900/60 p-4 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="animate-pop max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <h2 id="hto-title" className="text-xl font-extrabold text-slate-900">
                  কিভাবে অর্ডার করবেন?
                </h2>
                <p className="mt-0.5 text-sm text-slate-500">৫টি সহজ ধাপ</p>
              </div>
              <button
                onClick={() => setOpen(false)}
                aria-label="বন্ধ করুন"
                className="shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            <ol className="space-y-4">
              {STEPS.map((s) => (
                <li key={s.n} className="flex gap-3">
                  <span
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[var(--violet)] text-sm font-bold text-white"
                    aria-hidden="true"
                  >
                    {s.n}
                  </span>
                  <div className="min-w-0">
                    <p className="font-bold text-slate-900">{s.title}</p>
                    <p className="mt-0.5 text-sm leading-relaxed text-slate-600">{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>

            <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-xs leading-relaxed text-amber-800">
                ⚠️ <strong>ভুল UID দিলে</strong> ভুল অ্যাকাউন্টে টপ আপ হবে — এটা আর ফেরানো যায় না।
                অর্ডারের আগে UID ভালো করে মিলিয়ে নিন।
              </p>
            </div>

            <button onClick={() => setOpen(false)} className="btn-primary mt-4 w-full py-3">
              বুঝেছি
            </button>
          </div>
        </div>
      )}
    </>
  );
}
