import NotFoundBody from '@/components/NotFoundBody';

/**
 * ★ অ্যাডমিনের ৪০৪ — নিজের লেআউটের ভেতরে।
 *
 *   ⚠️ এটি না থাকলে `/admin/users/<ভুল id>` (`page.tsx:42` এ
 *   `notFound()`) রুট-স্তরের ৪০৪-এ নামত, আর সেটি এখন `PublicChrome`
 *   মোড়ায় — অর্থাৎ অ্যাডমিন হঠাৎ **গ্রাহকের** নেভবার ও "টাকা যোগ"
 *   বটম-বার দেখতেন। ভুল প্রসঙ্গ।
 *
 *   এই ফাইলটি থাকায় Next নিকটতম boundary হিসেবে একেই বেছে নেয়,
 *   আর `admin/layout.tsx` (AdminNav · AdminSearch) অক্ষত থাকে।
 *   বার্তাটি এক রাখতে মার্কআপ `NotFoundBody` থেকেই আসে।
 */
export default function AdminNotFound() {
  return <NotFoundBody />;
}
