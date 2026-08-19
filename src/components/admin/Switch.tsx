'use client';

/**
 * ═══════════════════════════════════════════════════════════
 * ★ টগল সুইচ — অ্যাডমিনের চালু/বন্ধ নিয়ন্ত্রণ
 *
 *   কেন আলাদা কম্পোনেন্ট: হুবহু একই মার্কআপ দুই জায়গায় নকল করা ছিল
 *   (`IntegrationsManager` ও `PaymentProviders`) — অর্থাৎ একটিতে ঠিক
 *   করলে অন্যটি পিছিয়ে থাকত। অডিটে ঠিক তা-ই দেখা গেছে: **দশটি**
 *   সুইচ, প্রতিটিই ২৮×৪৮ — ৪০px-এর নিচে।
 *
 *   ★★★ ফিক্সটি "ট্র্যাক বড় করা" নয়। ট্র্যাক ২৮px থাকলেই দেখতে ঠিক
 *   লাগে; বড় করলে অ্যাডমিন প্যানেলের ঘনত্ব নষ্ট হতো। তাই **বোতামটি**
 *   ৪০px উঁচু, আর ট্র্যাকটি তার ভিতরে ২৮px উচ্চতায় কেন্দ্রে বসে।
 *   চোখে আগের মতোই, আঙুলের জন্য পূর্ণ লক্ষ্য — আর `getBoundingClientRect()`
 *   এও তা সত্যি (ছদ্ম-উপাদানের ক্লিক-এলাকা অডিট মাপতে পারে না,
 *   তাই সেই কৌশল এখানে নেওয়া হয়নি)।
 * ═══════════════════════════════════════════════════════════
 */
export default function Switch({
  on,
  onClick,
  label,
  disabled,
}: {
  on: boolean;
  onClick: () => void;
  /** স্ক্রিন-রিডারের জন্য — পাশে দৃশ্যমান লেখা থাকলেও সুইচের নিজের পরিচয় লাগে */
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="grid h-10 w-12 shrink-0 place-items-center disabled:opacity-50"
    >
      <span
        className="relative block h-7 w-12 rounded-full transition-colors"
        style={{ background: on ? 'var(--violet)' : 'var(--v-edge2)' }}
      >
        <span
          className="absolute top-1 h-5 w-5 rounded-full bg-white transition-all"
          style={{ left: on ? 26 : 4 }}
        />
      </span>
    </button>
  );
}
