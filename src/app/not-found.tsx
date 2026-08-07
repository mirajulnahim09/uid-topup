import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="grid min-h-[100dvh] place-items-center p-6">
      <div className="text-center">
        <p
          className="dsp text-7xl font-black"
          style={{
            background: 'linear-gradient(180deg,var(--gold),rgba(230,197,132,.35))',
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            color: 'transparent',
          }}
        >
          404
        </p>
        <h1 className="mt-4 text-2xl font-bold text-slate-900">পাতাটি পাওয়া যায়নি</h1>
        <p className="mt-2 text-slate-400">
          যে লিংকে এসেছেন সেটি ভুল অথবা পাতাটি সরানো হয়েছে।
        </p>
        <div className="mt-7 flex justify-center gap-3">
          <Link href="/" className="btn-primary px-6">হোমে ফিরুন</Link>
          <Link href="/faq" className="btn-ghost px-6">সাহায্য</Link>
        </div>
      </div>
    </div>
  );
}
