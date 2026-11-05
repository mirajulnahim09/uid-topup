'use client';

import { useCallback, useState } from 'react';
import { useResetOnBfcacheRestore } from '@/lib/useBfcacheReset';
import { signIn } from 'next-auth/react';
import InlinePulse from '@/components/loading/InlinePulse';

/**
 * ★ "Google দিয়ে চালিয়ে যান" বাটন — login ও register দুই পেজে।
 *   .env এ GOOGLE_CLIENT_ID/SECRET না থাকলে Google provider থাকবে না,
 *   তখন বাটনে ক্লিক করলে error দেখাবে — তাই key বসানোর পর ব্যবহার করো।
 */
export default function GoogleButton({ callbackUrl = '/account' }: { callbackUrl?: string }) {
  const [loading, setLoading] = useState(false);
  useResetOnBfcacheRestore(useCallback(() => setLoading(false), []));

  return (
    <div>
      {/* ★ Google `signIn` পুরো পাতা রিডাইরেক্ট করে (কোনো fetch নয়),
          তাই গ্লোবাল ওভারলে ধরতে পারে না। এখানে পূর্ণপর্দা লোডার
          বসানোও ভুল হতো — রিডাইরেক্ট এক পলকেই হয়ে যায়। বোতামের
          ভেতরে ছোট ইঙ্গিতই যথেষ্ট ও সৎ। */}
      <div className="my-5 flex items-center gap-3">
        <span className="h-px flex-1" style={{ background: 'var(--line)' }} />
        <span className="text-xs" style={{ color: 'var(--mut)' }}>অথবা</span>
        <span className="h-px flex-1" style={{ background: 'var(--line)' }} />
      </div>

      <button
        type="button"
        onClick={() => {
          setLoading(true);
          // A failed provider/CSRF fetch rejects instead of redirecting: re-enable the button.
          signIn('google', { callbackUrl }).catch(() => setLoading(false));
        }}
        disabled={loading}
        className="flex w-full items-center justify-center gap-3 rounded-lg py-3 text-sm font-bold transition active:scale-[0.98] disabled:opacity-60"
        style={{ background: 'rgba(255,255,255,.95)', color: '#1f2937' }}
      >
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
          <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.5 29.3 4.5 24 4.5 13.2 4.5 4.5 13.2 4.5 24S13.2 43.5 24 43.5 43.5 34.8 43.5 24c0-1.2-.1-2.3-.4-3.5z" />
          <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.5 29.3 4.5 24 4.5 16.3 4.5 9.7 8.9 6.3 14.7z" />
          <path fill="#4CAF50" d="M24 43.5c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.5-4.5 2.4-7.2 2.4-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.6 39 16.2 43.5 24 43.5z" />
          <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.5l6.2 5.2c-.4.4 6.6-4.8 6.6-14.7 0-1.2-.1-2.3-.4-3.5z" />
        </svg>
        {loading
          ? <><InlinePulse size={16} /> <span className="ml-1.5">অপেক্ষা করুন…</span></>
          : 'Google দিয়ে চালিয়ে যান'}
      </button>
    </div>
  );
}
