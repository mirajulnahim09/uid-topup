'use client';

import { signOut } from 'next-auth/react';
import { useState } from 'react';

/**
 * ═══════════════════════════════════════════════════════════
 * ★ "এই ডিভাইস থেকে লগআউট" — গ্রাহক ও অ্যাডমিন, একটিই কম্পোনেন্ট
 *
 *   ── কেন দরকার হলো ──
 *   লগআউট ছিল কেবল `Navbar` এ। ডেস্কটপে সেটি দৃশ্যমান, কিন্তু —
 *     · **অ্যাডমিন প্যানেলে `Navbar` রেন্ডারই হয় না**
 *       (`admin/layout.tsx` এর নিজস্ব হেডার), আর সেই হেডারে কোনো
 *       লগআউট ছিল না — কেবল "← সাইটে ফিরুন"।
 *     · **ফোনে** ন্যাভবারের লগআউটটি হ্যামবার্গার মেনুর একদম নিচে,
 *       আর মেনুটি ভিউপোর্ট ছাড়িয়ে গিয়ে বটম-বারের আড়ালে পড়ত
 *       (স্ক্রলও লক থাকত) — অর্থাৎ কার্যত পৌঁছানোই যেত না।
 *   ফলে দুই ভূমিকার কারও জন্যই নির্ভরযোগ্য লগআউট ছিল না।
 *
 *   ── কী হয় ──
 *   `signOut()` NextAuth-এর `/api/auth/signout` এ POST করে; সেশন
 *   কুকিটি **সার্ভার** মুছে দেয় (httpOnly, তাই ক্লায়েন্ট মুছতে
 *   পারত না)। কুকি নেই মানে `middleware.ts` এর `getToken()` কিছু
 *   পায় না — তাই Back বোতাম বা সরাসরি URL দিয়েও সুরক্ষিত পাতা
 *   আর খোলে না, `/login` এ ফেরত যায়।
 *
 *   ⚠️ এটি **এই ব্রাউজারের** সেশন শেষ করে। অন্য ডিভাইসও বাদ দিতে
 *   হলে `SignOutAllButton` (sessionEpoch বাড়ায়) — দুটি আলাদা কাজ,
 *   তাই আলাদা বোতাম।
 * ═══════════════════════════════════════════════════════════
 */
export default function LogoutButton({
  /** লগআউটের পর কোথায় — অ্যাডমিন/গ্রাহক দুজনের জন্যই লগইন পাতা */
  callbackUrl = '/login',
  className = '',
  /** কমপ্যাক্ট রূপ — অ্যাডমিন হেডারের মতো সংকীর্ণ জায়গায় */
  compact = false,
}: {
  callbackUrl?: string;
  className?: string;
  compact?: boolean;
}) {
  // ★ দুবার চাপা আটকাই — নাহলে দুটি signout রিকোয়েস্ট যেত
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        signOut({ callbackUrl });
      }}
      /* ★ ছোঁয়ার লক্ষ্য: কমপ্যাক্টেও ৪০px, নাহলে ৪৪px — ফোনে
         নির্ভরযোগ্যভাবে ট্যাপযোগ্য রাখতে। */
      className={
        `inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-bold transition-colors disabled:opacity-60 ` +
        (compact ? 'min-h-[40px] px-2.5 text-sm ' : 'min-h-[44px] px-4 text-sm ') +
        className
      }
      style={{ border: '1px solid var(--hair)', color: 'var(--mut)' }}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
      </svg>
      {busy ? 'বেরোচ্ছে…' : 'লগআউট'}
    </button>
  );
}
