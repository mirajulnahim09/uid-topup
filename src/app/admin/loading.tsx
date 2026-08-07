/**
 * ★ অ্যাডমিন লোডিং (4.3)
 *
 *   আগে এটি root-এ (`src/app/loading.tsx`) ছিল, ফলে **প্রতিটি**
 *   পাতা streaming-এ যেত। streaming শুরু হলেই HTTP স্ট্যাটাস 200
 *   হিসেবে স্থির হয়ে যায়, তাই পরে `notFound()` ডাকলেও কেবল
 *   দেখতে 404 পাতা আসত — স্ট্যাটাস 200-ই থাকত (soft-404)।
 *
 *   ⚠️ তাই boundary-টি সেই জায়গাগুলোতে নামানো হলো যেখানে এর
 *   আসল দরকার — অ্যাডমিন ও অ্যাকাউন্টের ভারী, ডেটা-নির্ভর পাতা।
 *   এগুলো লগইন-গেটেড, তাই সার্চ ইঞ্জিন কখনো এদের ইনডেক্সই করে না;
 *   সেখানে স্ট্যাটাস কোড নিয়ে SEO-ঝুঁকি নেই।
 */
export default function Loading() {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">লোড হচ্ছে…</span>
      <div className="skeleton h-8 w-40 rounded-lg" />
      <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="skeleton h-24 rounded-2xl" />)}
      </div>
      <div className="skeleton mt-5 h-64 rounded-2xl" />
    </div>
  );
}
