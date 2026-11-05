'use client';

/**
 * Admin panels that fetch on mount used to keep showing "লোড হচ্ছে…" after
 * the fetch failed (the data stayed null and nothing retried), or rendered
 * nothing at all. This is the shared failure state: what failed + a retry.
 */
export default function LoadFailedCard({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <div role="alert" className="card flex flex-wrap items-center justify-between gap-3 p-5 text-[13px]">
      <span style={{ color: 'var(--v-mut)' }}>{what} আনা যায়নি — সংযোগ দেখে আবার চেষ্টা করুন।</span>
      <button type="button" onClick={onRetry} className="btn-ghost px-3 py-2 text-sm font-bold">
        আবার চেষ্টা
      </button>
    </div>
  );
}
