import Link from 'next/link';

/**
 * ═══════════════════════════════════════════════════════════
 * ★ ডেটা লোড করা যায়নি — টাকার পেজের জন্য নিরাপদ fallback
 *
 *   কেন এই কম্পোনেন্ট দরকার:
 *   ডাটাবেস সাময়িকভাবে অকেজো হলে সাধারণ try/catch দিয়ে
 *   ডিফল্ট মান (যেমন ব্যালেন্স ৳0.00) দেখানো **বিপজ্জনক** —
 *   গ্রাহক ভাববে তার টাকা হারিয়ে গেছে। ভুল তথ্যের চেয়ে
 *   "এখন দেখানো যাচ্ছে না" বলা অনেক ভালো।
 *
 *   তাই এখানে কোনো সংখ্যা দেখানো হয় না — শুধু সৎ বার্তা,
 *   আবার চেষ্টা করার উপায়, আর সাপোর্টের পথ।
 *
 *   ⚠️ গুরুত্বপূর্ণ: এই স্ক্রিন দেখা মানে টাকার কোনো ক্ষতি হয়নি —
 *   শুধু পড়া যায়নি। সেটিই গ্রাহককে স্পষ্ট করে বলা হয়।
 * ═══════════════════════════════════════════════════════════
 */
export default function DataUnavailable({
  title = 'তথ্য এখন দেখানো যাচ্ছে না',
  retryHref,
}: {
  title?: string;
  retryHref: string;
}) {
  return (
    <div className="card p-8 text-center sm:p-12">
      <div
        className="mx-auto grid h-14 w-14 place-items-center rounded-full"
        style={{ background: 'rgba(var(--gold-glow),.10)', border: '1px solid var(--hair)' }}
        aria-hidden="true"
      >
        <svg
          width="24" height="24" viewBox="0 0 24 24" fill="none"
          stroke="var(--gold)" strokeWidth="1.8" strokeLinecap="round"
        >
          <path d="M12 9v4" />
          <path d="M12 17h.01" />
          <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
        </svg>
      </div>

      <h2 className="dsp mt-5 text-lg font-medium" style={{ color: 'var(--ink)' }}>
        {title}
      </h2>

      <p
        className="prose-measure mx-auto mt-3 text-sm leading-relaxed"
        style={{ color: 'var(--mut)' }}
      >
        সাময়িক কারিগরি সমস্যার কারণে তথ্য আনা যায়নি। কিছুক্ষণ পর আবার চেষ্টা করুন।
      </p>

      {/* ★ সবচেয়ে জরুরি বার্তা — টাকার কোনো ক্ষতি হয়নি */}
      <p
        className="mx-auto mt-4 max-w-md rounded-lg px-4 py-3 text-sm font-medium"
        style={{
          background: 'var(--v-steel)',
          border: '1px solid var(--hair)',
          color: 'var(--ink)',
        }}
      >
        আপনার ব্যালেন্স ও অর্ডার সম্পূর্ণ নিরাপদ আছে — শুধু এই মুহূর্তে দেখানো যাচ্ছে না।
      </p>

      <div className="mt-7 flex flex-wrap justify-center gap-3">
        <Link href={retryHref} className="btn-primary px-6">
          আবার চেষ্টা করুন
        </Link>
        <Link href="/contact" className="btn-ghost px-6">
          সাপোর্টে যোগাযোগ
        </Link>
      </div>
    </div>
  );
}
