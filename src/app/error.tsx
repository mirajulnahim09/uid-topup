'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { logger } from '@/lib/logger';

/**
 * ★ ইন-অ্যাপ এরর বাউন্ডারি — একটি পাতা ক্র্যাশ করলে সাদা-স্ক্রিন
 *   ঠেকিয়ে বন্ধুসুলভ, on-brand বার্তা দেখায় (ইমোজি নয়, SVG আইকন —
 *   CLAUDE.md §7)। layout-এর ভেতরে রেন্ডার হয়, তাই সাইট-ব্যাকগ্রাউন্ড
 *   অক্ষত থাকে।
 */
export default function ErrorPage({
  error, reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    logger.error('page', 'client error boundary', { digest: error.digest, message: error.message });
  }, [error]);

  return (
    <div className="grid min-h-[80dvh] place-items-center page-x">
      <div className="card max-w-md p-8 text-center sm:p-10">
        <span
          className="mx-auto grid h-16 w-16 place-items-center rounded-2xl"
          style={{ background: 'rgba(251,113,133,.12)', border: '1px solid rgba(251,113,133,.34)', color: 'var(--v-heat)' }}
          aria-hidden="true"
        >
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
            <path d="M12 9v4M12 17h.01" />
          </svg>
        </span>
        <h1 className="mt-5 text-xl font-bold" style={{ color: 'var(--v-ink)' }}>কিছু একটা সমস্যা হয়েছে</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed" style={{ color: 'var(--v-mut)' }}>
          সাময়িক একটি সমস্যা হয়েছে। আবার চেষ্টা করুন — আপনার ব্যালেন্স ও অর্ডার সম্পূর্ণ নিরাপদ আছে।
        </p>
        {error.digest && (
          <p className="mt-3 font-mono text-[11px]" style={{ color: 'var(--v-dim)' }}>Ref: {error.digest}</p>
        )}
        <div className="mt-6 flex flex-wrap justify-center gap-2.5">
          <button onClick={reset} className="btn-primary px-6">আবার চেষ্টা করুন</button>
          <Link href="/" className="btn-ghost px-6">হোমে যান</Link>
        </div>
      </div>
    </div>
  );
}
