'use client';

import { useState } from 'react';
import { cannedByCategory } from '@/lib/cannedResponses';

/**
 * ★ তৈরি বার্তা বাছাইকারী (3.15)
 *
 *   ⚠️ `onPick` লেখাটি **ঢোকায়**, পাঠায় না। বাছাইয়ের পর অ্যাডমিন
 *   সম্পাদনা করে তবেই পাঠায় — এক ক্লিকে গ্রাহকের কাছে বার্তা চলে
 *   যাওয়ার পথ ইচ্ছাকৃতভাবে রাখা হয়নি।
 */
export default function CannedPicker({
  onPick,
  className = '',
}: {
  onPick: (text: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const groups = cannedByCategory();

  return (
    <div className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="btn-ghost px-2.5 py-1 text-[11px]"
      >
        💬 তৈরি বার্তা
      </button>

      {open && (
        <div
          className="absolute z-30 mt-1 max-h-64 w-72 overflow-y-auto rounded-xl border p-2 shadow-lg"
          style={{ borderColor: 'var(--hair)', background: 'var(--bg2)' }}
        >
          {groups.map((g) => (
            <div key={g.category} className="mb-2 last:mb-0">
              <div
                className="px-1 pb-1 text-[10px] font-bold uppercase tracking-wide"
                style={{ color: 'var(--mut)' }}
              >
                {g.label}
              </div>
              {g.items.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => { onPick(r.text); setOpen(false); }}
                  title={r.text}
                  className="block w-full rounded-lg px-2 py-1.5 text-left text-xs transition hover:bg-white/5"
                  style={{ color: 'var(--ink)' }}
                >
                  {r.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
