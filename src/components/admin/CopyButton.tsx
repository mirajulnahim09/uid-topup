'use client';

import { useState } from 'react';

/**
 * ★ এক-ট্যাপে কপি (3.4)
 *
 *   কেন (MANUAL_WORKFLOW.md B1/B2):
 *   TrxID প্রতিবারই bKash অ্যাপে পেস্ট করতে হয়, আর UID প্রতিবারই
 *   গেমে পেস্ট করতে হয়। হাতে সিলেক্ট করা মোবাইলে ধীর ও ভুলপ্রবণ —
 *   অর্ধেক সিলেক্ট হলে ভুল TrxID খোঁজা হয়, অথবা ভুল UID তে টপ-আপ।
 *
 *   ★ কপির পর দৃশ্যমান নিশ্চিতকরণ থাকে — নাহলে অ্যাডমিন জানে না
 *     কপি হয়েছে কিনা, আর দুইবার চাপে।
 */
export default function CopyButton({
  value,
  label,
  className = '',
}: {
  value: string;
  /** স্ক্রিনরিডারে কী কপি হচ্ছে */
  label: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // ★ clipboard API ব্লক থাকলে (http, permission) — fallback
      try {
        const ta = document.createElement('textarea');
        ta.value = value;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      } catch {
        /* নীরব — কপি না হলেও টেক্সট হাতে সিলেক্ট করা যায় */
      }
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      // ★ ৩২px — মোবাইলে আঙুলে ধরার মতো, কিন্তু সারির উচ্চতা বাড়ায় না
      className={`inline-grid h-8 w-8 shrink-0 place-items-center rounded-md transition ${className}`}
      style={{
        border: '1px solid var(--hair)',
        background: copied ? 'rgba(127,224,187,.14)' : 'var(--glass)',
        color: copied ? '#7fe0bb' : 'var(--mut)',
      }}
      aria-label={copied ? `${label} কপি হয়েছে` : `${label} কপি করুন`}
      title={copied ? 'কপি হয়েছে' : `${label} কপি করুন`}
    >
      {copied ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20 6L9 17l-5-5" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="9" y="9" width="12" height="12" rx="2" />
          <path d="M5 15V5a2 2 0 0 1 2-2h10" />
        </svg>
      )}
    </button>
  );
}
