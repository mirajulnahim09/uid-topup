import { type TimelineEvent } from '@/lib/customerTimeline';
import { bdt } from '@/lib/money';
import { fmtDate } from '@/lib/date';

/**
 * ★ কাস্টমার টাইমলাইন (3.13) — Server Component, কোনো
 *   ইন্টার‌্যাকশন নেই তাই ক্লায়েন্টে পাঠানোর দরকার নেই (§7)।
 */
export default function CustomerTimeline({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) {
    return (
      <p className="text-sm" style={{ color: 'var(--mut)' }}>কোনো কার্যকলাপ নেই</p>
    );
  }

  return (
    <ol className="relative space-y-0">
      {events.map((e, i) => {
        const color =
          e.tone === 'good' ? '#6ec49a'
          : e.tone === 'bad' ? '#e07878'
          : e.tone === 'warn' ? '#e0a05a'
          : 'var(--ink)';
        return (
          <li key={i} className="relative flex gap-3 pb-4">
            {/* ★ উল্লম্ব রেখা — শেষটিতে নয়, নইলে শূন্যে ঝুলে থাকে */}
            {i < events.length - 1 && (
              <span
                aria-hidden="true"
                className="absolute left-[13px] top-7 h-full w-px"
                style={{ background: 'var(--hair)' }}
              />
            )}
            <span
              className="z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs"
              style={{ background: 'var(--bg2)', border: '1px solid var(--hair)' }}
            >
              {e.icon}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="text-sm font-semibold" style={{ color }}>{e.title}</span>
                {e.amount !== undefined && (
                  <span
                    className="font-mono text-sm font-bold"
                    style={{ color: e.positive ? '#6ec49a' : 'var(--ink)' }}
                  >
                    {e.positive ? '+' : e.positive === false ? '−' : ''}{bdt(e.amount)}
                  </span>
                )}
              </div>
              <div className="text-[11px]" style={{ color: 'var(--mut)' }}>{fmtDate(e.at)}</div>
              {e.detail && (
                /**
                 * ⚠️ `break-words` — `e.detail` এ গ্রাহকের নিজের হাতে
                 *   লেখা TrxID বসে ("TrxID: BKASH9F2ABX…"), আর তাতে
                 *   ফাঁকা জায়গা থাকে না। প্যারেন্টে `min-w-0` আছে বলে
                 *   বাক্সটি ছোট হয়, কিন্তু লেখাটি তবু বাইরে বেরিয়ে
                 *   যেত: ব্রাউজারে মাপা — একটি ৬১-অক্ষরের TrxID-তে
                 *   ৩২০px ফোনে পুরো পাতা **৪৯২px** চওড়া হয়ে যেত
                 *   (এই একটি সারি সরালেই ঠিক ৩২০-এ ফিরত)।
                 *   `break-all` নয় — বাক্যের বাকি অংশ স্বাভাবিকভাবেই
                 *   গড়াক, কেবল না-ভাঙা টোকেনটিই ভাঙুক।
                 */
                <div className="mt-0.5 break-words text-xs" style={{ color: 'var(--mut)' }}>{e.detail}</div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
