'use client';

import Link from 'next/link';

type Item = { done: boolean; label: string; href: string; hint: string };

/**
 * ★ নতুন অ্যাডমিনের জন্য — কী কী করা বাকি, স্পষ্ট করে দেখায়।
 *   সব হয়ে গেলে কার্ডটা আর দেখাবে না।
 */
export default function SetupChecklist({ items }: { items: Item[] }) {
  const pending = items.filter((i) => !i.done);
  if (pending.length === 0) return null;

  const done = items.length - pending.length;

  return (
    <section className="card border-2 border-amber-300 bg-amber-50 p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold text-amber-900">
            <span aria-hidden="true">🚀</span> সাইট চালু করার আগে
          </h2>
          <p className="mt-0.5 text-sm text-amber-700">
            এই কাজগুলো শেষ করুন — তারপর কাস্টমারদের লিংক দিন।
          </p>
        </div>

        <div className="rounded-lg bg-white px-3 py-1.5 text-center shadow-sm">
          <p className="text-lg font-bold leading-none text-amber-700">
            {done}<span className="text-sm text-slate-400">/{items.length}</span>
          </p>
          <p className="mt-0.5 text-[10px] text-slate-500">শেষ</p>
        </div>
      </div>

      <ul className="space-y-2">
        {items.map((i) => (
          <li key={i.label}>
            <Link
              href={i.href}
              className={`flex items-start gap-3 rounded-lg border p-3 transition ${
                i.done
                  ? 'border-emerald-200 bg-white'
                  : 'border-amber-200 bg-white hover:-translate-y-0.5 hover:border-amber-400 hover:shadow-md'
              }`}
            >
              <span
                className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-xs font-bold ${
                  i.done ? 'bg-emerald-500 text-white' : 'border-2 border-amber-400 bg-white'
                }`}
                aria-hidden="true"
              >
                {i.done ? '✓' : ''}
              </span>

              <div className="min-w-0 flex-1">
                <p className={`text-sm font-semibold ${i.done ? 'text-slate-400 line-through' : 'text-slate-900'}`}>
                  {i.label}
                </p>
                {!i.done && <p className="mt-0.5 text-xs text-slate-500">{i.hint}</p>}
              </div>

              {!i.done && (
                <span className="shrink-0 self-center text-sm font-bold text-amber-600" aria-hidden="true">
                  →
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
