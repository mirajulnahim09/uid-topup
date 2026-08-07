/**
 * ★ অ্যাকাউন্ট লোডিং (4.3) — স্পিনারের বদলে কনটেন্ট-আকৃতির skeleton।
 *
 *   কেন skeleton: ভারী, ডেটা-নির্ভর পাতায় খালি স্পিনারের চেয়ে
 *   পাতার আকৃতির shimmer অনেক বেশি "দ্রুত" অনুভব করায় (perceived
 *   performance)। `.skeleton` ক্লাসের shimmer reduced-motion-এ
 *   বৈশ্বিক নিয়মে থেমে যায়।
 *
 *   ⚠️ boundary এখানেই কেন (root-এ নয়): streaming শুরু হলে HTTP
 *   স্ট্যাটাস 200-এ স্থির হয় → পরে notFound() ডাকলেও soft-404 হতো।
 *   অ্যাকাউন্ট/অ্যাডমিন লগইন-গেটেড, তাই সেখানে SEO-ঝুঁকি নেই।
 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl page-x page-y" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">লোড হচ্ছে…</span>
      <div className="skeleton h-8 w-44 rounded-lg" />
      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-28 rounded-2xl" />)}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-24 rounded-2xl" />)}
      </div>
      <div className="skeleton mt-6 h-36 rounded-2xl" />
      <div className="skeleton mt-4 h-52 rounded-2xl" />
    </div>
  );
}
