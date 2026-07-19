/**
 * ★ অ্যাকাউন্ট লোডিং (4.3)
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
    <div className="grid min-h-[60vh] place-items-center" role="status" aria-live="polite">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-rose-500 border-t-transparent" />
        <p className="text-sm text-slate-400">লোড হচ্ছে...</p>
      </div>
    </div>
  );
}
