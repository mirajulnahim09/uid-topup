import type { ReactNode } from 'react';

/**
 * ★ অ্যাডমিন পেজ হেডার — একটিই সামঞ্জস্যপূর্ণ প্যাটার্ন।
 *
 *   ── কেন ──
 *   আগে প্রতিটি অ্যাডমিন পেজ নিজের মতো হেডার লিখত: কোথাও
 *   `text-2xl font-extrabold`, কোথাও `lux-text font-medium`, ভিন্ন
 *   মার্জিন — ফলে শিরোনাম ও নিচের কনটেন্টের ভিজ্যুয়াল সম্পর্ক এক-এক
 *   পেজে এক-এক রকম দেখাত। এই কম্পোনেন্ট সেই ছন্দ ঠিক করে: অভিন্ন
 *   টাইপোগ্রাফি, অভিন্ন শিরোনাম↔সাবটাইটেল ফাঁক, অভিন্ন নিচের মার্জিন।
 *   টোকেন-ভিত্তিক, তাই light/dark দুই থিমেই সঠিক কনট্রাস্ট।
 */
export default function AdminPageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  /** ডান পাশে ঐচ্ছিক অ্যাকশন (বোতাম ইত্যাদি) */
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        {/* ★ প্রভাবশালী অ্যাডমিন-হেডার প্যাটার্নের হুবহু রূপ (১৫টির ১৩টি
            পেজ এটিই ব্যবহার করত) — যাতে সব পেজ একই দেখায়। */}
        <h1 className="lux-text text-2xl font-medium sm:text-[27px]">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1 max-w-2xl text-sm leading-relaxed" style={{ color: 'var(--v-mut)' }}>
            {subtitle}
          </p>
        )}
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </div>
  );
}
