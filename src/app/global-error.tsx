'use client';

/**
 * ★ গ্লোবাল এরর বাউন্ডারি (প্রোডাকশন) — root layout সহ যেকোনো
 *   অপ্রত্যাশিত ক্র্যাশ ধরে ফেলে সাদা-স্ক্রিন ঠেকায়। এটি নিজের
 *   <html>/<body> রেন্ডার করে কারণ layout নিজেই ব্যর্থ হতে পারে।
 *
 *   ⚠️ কোনো সংবেদনশীল error বার্তা ব্যবহারকারীকে দেখানো হয় না;
 *   কেবল একটি বন্ধুসুলভ বার্তা + রিট্রাই বোতাম।
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="bn">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          background: '#0a0b11',
          color: '#eef1f6',
          fontFamily: 'system-ui, "Hind Siliguri", sans-serif',
          padding: 24,
        }}
      >
        <div style={{ maxWidth: 420, textAlign: 'center' }}>
          <div
            style={{
              width: 56, height: 56, margin: '0 auto 18px', borderRadius: 16,
              display: 'grid', placeItems: 'center',
              background: 'rgba(139,92,246,.18)', color: '#c4b5fd',
            }}
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
            </svg>
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 8px' }}>কিছু একটা সমস্যা হয়েছে</h1>
          <p style={{ fontSize: 14, color: '#9aa6b8', lineHeight: 1.6, margin: '0 0 20px' }}>
            অপ্রত্যাশিত একটি ত্রুটি ঘটেছে। একটু পরে আবার চেষ্টা করুন। সমস্যা থাকলে সাপোর্টে জানান।
            {error?.digest ? <><br /><span style={{ fontSize: 11, opacity: 0.6 }}>Ref: {error.digest}</span></> : null}
          </p>
          <button
            onClick={() => reset()}
            style={{
              minHeight: 46, padding: '0 22px', border: 'none', borderRadius: 12,
              background: 'linear-gradient(135deg,#7c3aed,#6d28d9)', color: '#fff',
              fontWeight: 800, fontSize: 14, cursor: 'pointer',
            }}
          >
            আবার চেষ্টা করুন
          </button>
        </div>
      </body>
    </html>
  );
}
