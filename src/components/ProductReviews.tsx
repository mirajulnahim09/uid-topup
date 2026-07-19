import { fmtDate } from '@/lib/date';

/**
 * ═══════════════════════════════════════════════════════════
 * ★ প্রোডাক্টের রিভিউ — প্রকাশ্য অংশ (5.1)
 *
 *   জমা দেওয়ার দিকটি আগেই ছিল (`/api/review` + DeliveryConfirm);
 *   এতদিন রিভিউ জমা হতো কিন্তু **কেউ দেখতে পেত না**, ফলে আস্থা
 *   তৈরির কাজটাই হতো না। এটি সেই বাকি অর্ধেক।
 *
 *   ⚠️ প্রতিটি রিভিউর পেছনে একটি আসল, টাকা-দেওয়া, গ্রাহক-নিশ্চিত
 *   অর্ডার আছে (শর্তগুলো `/api/review` এ প্রয়োগ করা) — তাই এখানে
 *   কোনো "যাচাইকৃত" ব্যাজ আলাদা করে দেখানোর দরকার নেই, অযাচাই
 *   রিভিউ ঢোকার পথই নেই।
 *
 *   ⚠️ গোপনীয়তা: পুরো নাম নয়, কেবল প্রথম নামটুকু দেখানো হয়।
 *   গ্রাহক রিভিউ দেওয়ার সময় নাম প্রকাশের সম্মতি দেননি — তিনি
 *   কেবল মতামত দিয়েছেন।
 *
 *   ⚠️ Server Component — শূন্য ক্লায়েন্ট JS।
 * ═══════════════════════════════════════════════════════════
 */

export type ReviewItem = {
  id: string;
  rating: number;
  body: string | null;
  createdAt: Date;
  name: string;
};

function Stars({ n, label }: { n: number; label?: string }) {
  return (
    <span aria-label={label ?? `৫ এর মধ্যে ${n}`} title={label}>
      <span aria-hidden="true" style={{ color: 'var(--gold)', letterSpacing: '.08em' }}>
        {'★'.repeat(n)}
        <span style={{ color: 'var(--hair)' }}>{'★'.repeat(5 - n)}</span>
      </span>
    </span>
  );
}

export default function ProductReviews({
  items, count, average,
}: {
  items: ReviewItem[];
  count: number;
  average: number | null;
}) {
  // ★ রিভিউ না থাকলে কিছুই দেখানো হয় না।
  //   "এখনো কোনো রিভিউ নেই" লেখা নতুন প্রোডাক্টের ক্ষতি করে,
  //   অথচ কোনো তথ্য দেয় না।
  if (count === 0 || items.length === 0) return null;

  const avg = average === null ? null : Math.round(average * 10) / 10;

  return (
    <section className="mt-10" aria-labelledby="reviews-heading">
      <div className="eyebrow">Verified buyers</div>
      <h2 id="reviews-heading" className="dsp mt-2 text-lg font-medium sm:text-xl">
        গ্রাহকের মতামত
      </h2>
      <div className="rule-gold mt-3" />

      {/* ★ সারসংক্ষেপ — নির্দিষ্ট সংখ্যা, গোল করা দাবি নয় */}
      {avg !== null && (
        <p className="mt-4 flex flex-wrap items-center gap-2 text-sm" style={{ color: 'var(--mut)' }}>
          <Stars n={Math.round(avg)} label={`গড় রেটিং ৫ এর মধ্যে ${avg}`} />
          <span className="font-semibold" style={{ color: 'var(--ink)' }}>{avg}</span>
          <span>·</span>
          <span>{count} টি রিভিউ</span>
        </p>
      )}

      <ul className="mt-5 grid gap-3 sm:grid-cols-2">
        {items.map((r) => (
          <li key={r.id} className="card p-4">
            <div className="flex items-center justify-between gap-3">
              <Stars n={r.rating} />
              <span className="text-[11px]" style={{ color: 'var(--mut)' }}>
                {fmtDate(r.createdAt)}
              </span>
            </div>
            {r.body && (
              <p className="mt-2 text-sm leading-relaxed prose-measure" style={{ color: 'var(--ink)' }}>
                {r.body}
              </p>
            )}
            <p className="mt-2 text-[11px]" style={{ color: 'var(--mut)' }}>
              — {r.name}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
