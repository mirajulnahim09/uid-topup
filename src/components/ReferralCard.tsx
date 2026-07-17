'use client';

import { useState } from 'react';
import { useToast } from './Toast';

export default function ReferralCard({
  code, bonus, minDeposit, count,
}: {
  code: string;
  bonus: number;
  minDeposit: number;
  count: number;
}) {
  const toast = useToast();
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);

  const link =
    typeof window !== 'undefined'
      ? `${window.location.origin}/register?ref=${code}`
      : `/register?ref=${code}`;

  function copy(text: string, what: 'code' | 'link') {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(what);
        toast.success(what === 'code' ? 'কোড কপি হয়েছে' : 'লিংক কপি হয়েছে');
        setTimeout(() => setCopied(null), 2000);
      })
      .catch(() => toast.error('কপি করা যায়নি'));
  }

  async function share() {
    const text = `UID TopUp এ জয়েন করুন! আমার রেফারেল কোড: ${code}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'UID TopUp', text, url: link });
        return;
      } catch {
        // user cancelled — fallback
      }
    }
    copy(link, 'link');
  }

  return (
    <section className="card overflow-hidden border-purple-200 bg-gradient-to-br from-purple-50 to-rose-50">
      <div className="p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 font-bold text-slate-900">
              <span aria-hidden="true">🎁</span> রেফার করে আয় করুন
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-slate-600">
              বন্ধুকে আপনার কোড দিন। সে প্রথমবার ৳{minDeposit} বা তার বেশি ডিপোজিট করলে আপনি{' '}
              <strong className="text-emerald-600">৳{bonus}</strong> বোনাস পাবেন।
            </p>
          </div>
          {count > 0 && (
            <div className="shrink-0 rounded-lg border border-purple-200 bg-purple-100 px-3 py-1.5 text-center">
              <p className="text-lg font-bold leading-none text-purple-700">{count}</p>
              <p className="mt-0.5 text-[10px] text-purple-500">রেফার</p>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="flex flex-1 items-center gap-2 rounded-lg border-2 border-dashed border-purple-300 bg-white px-4 py-3">
            <code className="flex-1 select-all font-mono text-lg font-bold tracking-widest text-purple-700">
              {code}
            </code>
            <button
              onClick={() => copy(code, 'code')}
              aria-label="রেফারেল কোড কপি করুন"
              className="shrink-0 rounded-md px-2 py-1 text-xs font-semibold text-purple-600 transition hover:bg-purple-100"
            >
              {copied === 'code' ? '✓' : '📋'}
            </button>
          </div>

          <button onClick={share} className="btn-primary shrink-0 px-5">শেয়ার করুন</button>
        </div>
      </div>
    </section>
  );
}
