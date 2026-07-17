'use client';

import { useEffect } from 'react';

export default function ErrorPage({
  error, reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[page error]', error);
  }, [error]);

  return (
    <div className="grid min-h-screen place-items-center p-6">
      <div className="card max-w-md p-7 text-center">
        <div className="mb-3 text-4xl" aria-hidden="true">⚠️</div>
        <h1 className="text-xl font-bold text-slate-900">সমস্যা হয়েছে</h1>
        <p className="mt-2 text-sm text-slate-400">সাময়িক সমস্যা। আবার চেষ্টা করুন।</p>
        {error.digest && (
          <p className="mt-3 font-mono text-[11px] text-slate-400">Ref: {error.digest}</p>
        )}
        <div className="mt-6 flex justify-center gap-2">
          <button onClick={reset} className="btn-primary">আবার চেষ্টা করুন</button>
          <a href="/" className="btn-ghost">হোমে যান</a>
        </div>
      </div>
    </div>
  );
}
