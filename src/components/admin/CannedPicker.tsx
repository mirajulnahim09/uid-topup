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
          /* ★ `right-0` — প্যানেলটি মোড়কের **ডান** প্রান্তে বাঁধা, তাই বাঁ দিকে
               খোলে। আগে বাঁ প্রান্তে বাঁধা ছিল, ফলে বোতামটি কনটেইনারের ডানে
               থাকায় ২৮৮px চওড়া প্যানেল ভিউপোর্ট ছাড়িয়ে যেত — পুরো পাতায়
               অনুভূমিক স্ক্রল আসত (১৪৪০px এ ৮০px, ৩৯০px এ ১৬৮px)।
               `max-w` — সরু পর্দায় প্যানেল কখনো ভিউপোর্টের চেয়ে চওড়া নয়। */
          className="absolute right-0 z-30 mt-1 max-h-64 w-72 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border p-2 shadow-lg"
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
