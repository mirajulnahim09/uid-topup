'use client';

import { useEffect } from 'react';

/**
 * ★ বুট-পর্দা সরানো — অ্যাপ হাইড্রেট হওয়ার সাথে সাথে।
 *
 *   `#v-boot` সার্ভার-রেন্ডার করা HTML এ থাকে (layout.tsx), তাই সেটি
 *   JS চালু হওয়ার আগেই দেখা যায়। এই কম্পোনেন্টটি মাউন্ট হওয়া মানেই
 *   React জীবিত ও পাতা ইন্টার‍্যাক্টিভ — তখনই পর্দা মিলিয়ে যায়।
 *
 *   ⚠️ কেন inline style দিয়ে, CSS ক্লাস দিয়ে নয়:
 *   পর্দাটি হয়তো তখনো **ফেড-ইন এর মাঝপথে** (grace .18s + .28s)।
 *   সরাসরি ক্লাস বদলালে opacity হঠাৎ ১ এ লাফিয়ে তারপর মিলাত —
 *   অর্থাৎ দ্রুত লোডে একটি **ঝলকানি**। তাই বর্তমান computed opacity
 *   হিমায়িত করে সেখান থেকেই ফেড করা হয়।
 */
export default function BootDismiss() {
  useEffect(() => {
    const el = document.getElementById('v-boot');
    if (!el) return;

    const current = getComputedStyle(el).opacity; // যেখানে আছে, সেখান থেকেই
    el.style.animation = 'none';
    el.style.opacity = current;
    void el.offsetHeight; // reflow — নাহলে ব্রাউজার দুটি পরিবর্তন একসাথে করে ফেলে
    el.style.transition = 'opacity .22s cubic-bezier(.2,.8,.2,1)';
    el.style.opacity = '0';

    const t = setTimeout(() => el.remove(), 260);
    return () => clearTimeout(t);
  }, []);

  return null;
}
