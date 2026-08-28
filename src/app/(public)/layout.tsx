import PublicChrome from '@/components/PublicChrome';

// ★ Maintenance mode এর জন্য প্রতি রিকোয়েস্টে সেটিং/সেশন দেখতে হয়,
//   তাই dynamic। (ছোট সাইটে performance এ প্রভাব নগণ্য।)
export const dynamic = 'force-dynamic';

/**
 * ⚠️ এই লেআউটের শরীরটি ২০২৬-০৮-২৯ এ `@/components/PublicChrome` এ
 *   সরানো হয়েছে — **আচরণ অপরিবর্তিত**, কেবল জায়গা বদল। কারণ রুট-স্তরের
 *   `not-found.tsx` এই লেআউটের বাইরে বসে, তাই প্রতিটি ৪০৪ নেভবার-ফুটার
 *   ছাড়াই রেন্ডার হতো। এখন দুই জায়গাই একই ক্রোম ব্যবহার করে।
 */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return <PublicChrome>{children}</PublicChrome>;
}
