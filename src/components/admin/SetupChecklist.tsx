'use client';

import Link from 'next/link';
import { useState } from 'react';

type Item = { done: boolean; label: string; href: string; hint: string };

/**
 * ★ নতুন অ্যাডমিনের জন্য — কী কী করা বাকি, স্পষ্ট করে দেখায়।
 *   সব হয়ে গেলে কার্ডটা আর দেখাবে না।
 *
 * ⚠️ ২০২৬-০৮-১৯ (২.৫): কার্ডটি **কিছুই হারায়নি**, কেবল ডিফল্ট
 *   উপস্থাপনা শান্ত হয়েছে। আগে পাঁচটি আইটেম, প্রতিটির ২–৩ লাইন
 *   ব্যাখ্যাসহ, পুরোটা হলুদ রিং-এ মোড়া — আর সেটি বসত অ্যাডমিনের
 *   আসল কাজের (ডিপোজিট/অর্ডার কিউ) **উপরে**, প্রতিদিন, চিরকাল।
 *   একবার সেটআপের প্রথম ধাপগুলো হয়ে গেলে এটি আর তথ্য নয়, শব্দ।
 *
 *   নতুন নিয়ম:
 *     • একটিও কাজ না হলে (একদম নতুন সাইট) — আগের মতোই খোলা,
 *       কারণ তখন এটিই সবচেয়ে জরুরি জিনিস।
 *     • কিছু হয়ে থাকলে — এক সারিতে গুটিয়ে থাকে, পরের কাজটির নাম
 *       দেখায়, আর "বিস্তারিত" চাপলে পুরো তালিকা হুবহু ফিরে আসে।
 */
export default function SetupChecklist({ items }: { items: Item[] }) {
  const pending = items.filter((i) => !i.done);
  const done = items.length - pending.length;
  // ★ hook সবসময় একই ক্রমে ডাকতে হয়, তাই early-return এর **আগে**
  const [open, setOpen] = useState(done === 0);

  if (pending.length === 0) return null;

  const next = pending[0];

  return (
    <section className="card border-2 border-amber-300 bg-amber-50 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-bold text-amber-900 sm:text-lg">
            সাইট চালু করার আগে
            <span className="ml-2 rounded-md bg-white px-2 py-0.5 text-xs font-bold text-amber-700">
              {done}/{items.length}
            </span>
          </h2>
          {open ? (
            <p className="mt-0.5 text-sm text-amber-700">
              এই কাজগুলো শেষ করুন — তারপর কাস্টমারদের লিংক দিন।
            </p>
          ) : (
            /* ★ গুটানো অবস্থায়ও একটি কাজের কথা থাকে — নাহলে সারিটি
                 কেবল একটি সতর্কবার্তা হয়ে যেত, দিকনির্দেশ নয়। */
            <p className="mt-0.5 truncate text-xs text-amber-700">
              পরের কাজ: {next.label}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {!open && (
            <Link
              href={next.href}
              className="inline-flex min-h-[40px] items-center rounded-lg bg-amber-600 px-3 text-[13px] font-bold text-white"
            >
              এখনই করুন
            </Link>
          )}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="inline-flex min-h-[40px] items-center rounded-lg border border-amber-300 bg-white px-3 text-[13px] font-bold text-amber-800"
          >
            {open ? 'গুটিয়ে রাখুন' : `বিস্তারিত (${pending.length})`}
          </button>
        </div>
      </div>

      {open && (
        <ul className="mt-4 space-y-2">
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
      )}
    </section>
  );
}
