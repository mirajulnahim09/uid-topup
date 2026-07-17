import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="grid min-h-screen place-items-center p-6">
      <div className="text-center">
        <p className="bg-gradient-to-r from-rose-600 to-purple-600 bg-clip-text text-7xl font-black text-transparent">
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
