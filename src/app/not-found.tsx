import PublicChrome from '@/components/PublicChrome';
import NotFoundBody from '@/components/NotFoundBody';

/**
 * ★ রুট-স্তরের ৪০৪ — অমিল URL, আর `(public)`/`account` থেকে ডাকা
 *   `notFound()` — সবই এখানে নামে।
 *
 *   ⚠️ আগে এটি ক্রোম-হীন ছিল: নেভবার/ফুটার/বটম-বার সবই
 *   `(public)/layout.tsx` এ, আর এই ফাইলটি সেই লেআউটের **বাইরে**।
 *   ফলে ভাঙা লিংকে আসা গ্রাহক পেতেন কেবল দুটি বোতাম — মেনু নেই,
 *   সার্চ নেই, বটম-বার নেই। §১.১ প্রমাণ করেছিল সাইটে সত্যিই এমন
 *   একটি ভাঙা লিংক ছিল (`/account/wallet`), অর্থাৎ পর্দাটি বাস্তবেই
 *   দেখা যেত। এখন `PublicChrome` মোড়ানোয় গলিপথটি আর নেই।
 *
 *   ★ `account/layout.tsx`-ও একই Navbar/Footer/MobileTabBar ব্যবহার
 *   করে, তাই `/account/orders/<ভুল id>` ধরনের ৪০৪-এও এটি **ঠিক
 *   প্রসঙ্গ**। অ্যাডমিনের প্রসঙ্গ আলাদা — তাই
 *   `src/app/admin/not-found.tsx` নিজের লেআউটেই বসে।
 */
export default function NotFound() {
  return (
    <PublicChrome>
      <NotFoundBody />
    </PublicChrome>
  );
}
