import Link from 'next/link';

/**
 * ★ ৪০৪ পর্দার ভেতরের অংশ — ক্রোম ছাড়া, কেবল বার্তা।
 *
 *   দুই জায়গা থেকে ব্যবহৃত হয়, আর ক্রোম দুটি ভিন্ন জায়গা থেকে আসে:
 *     · `src/app/not-found.tsx`       → `PublicChrome` মোড়ায় (গ্রাহক)
 *     · `src/app/admin/not-found.tsx` → অ্যাডমিন লেআউটই ক্রোম দেয়
 *
 *   মার্কআপটি এখানে একবারই থাকে — নাহলে দুই ফাইলে নকল হয়ে ধীরে
 *   ধীরে দুই রকম হয়ে যেত।
 */
export default function NotFoundBody() {
  /* ⚠️ আগে ছিল `min-h-[100dvh]` — তখন পাতাটি ক্রোম-হীন ছিল, তাই
     সেটি ঠিক ছিল। এখন উপরে নেভবার ও নিচে ফুটার/বটম-বার যোগ হওয়ায়
     ১০০dvh রাখলে প্রতিটি ৪০৪-এ **নিশ্চিতভাবে স্ক্রল** তৈরি হতো —
     অথচ স্ক্রল করে দেখার কিছু নেই। ৬০dvh বাকি জায়গাটুকুতে
     কেন্দ্রে বসায়। */
  return (
    <div className="grid min-h-[60dvh] place-items-center p-6">
      <div className="text-center">
        {/**
         * ⚠️ আগে এখানে ছিল
         *   `linear-gradient(180deg, var(--gold), rgba(230,197,132,.35))`
         * — দ্বিতীয় স্টপটি টোকেন নয়, pre-VOLT যুগের বালি-সোনালি
         * `#e6c584`, JSX-এ হার্ডকোড। ফলে থিম বা `data-accent` প্রিসেট
         * কোনোটাই একে ছুঁত না, আর সংখ্যাটির নিচের অর্ধেক মিলিয়ে যেত।
         *
         * ব্রাউজারে মাপা (৭২px = large text, WCAG চায় ≥৩:১):
         *   ডার্ক  ১৫.০৪:১ → **২.৩৪:১**
         *   লাইট   ৩.৮৬:১  → **১.১৬:১**   ← কার্যত সাদায় সাদা
         *
         * নিরেট `--gold` এ দুই থিমেই উপরের মানটিই থাকে, আর রঙটি
         * টোকেন-ব্যবস্থায় ফিরে আসে (CLAUDE.md §১)।
         */}
        <p className="dsp text-7xl font-black" style={{ color: 'var(--gold)' }}>
          404
        </p>
        <h1 className="mt-4 text-2xl font-bold text-slate-900">পাতাটি পাওয়া যায়নি</h1>
        <p className="mt-2 text-slate-400">
          যে লিংকে এসেছেন সেটি ভুল অথবা পাতাটি সরানো হয়েছে।
        </p>
        <div className="mt-7 flex justify-center gap-3">
          <Link href="/" className="btn-primary px-6">হোমে ফিরুন</Link>
          <Link href="/faq" className="btn-ghost px-6">সাহায্য</Link>
        </div>
      </div>
    </div>
  );
}
