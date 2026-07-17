'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useToast } from '@/components/Toast';

export default function ForgotPasswordPage() {
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/forgot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error || 'সমস্যা হয়েছে');
        toast.error(data.error || 'সমস্যা হয়েছে');
        return;
      }
      setSent(true);
      toast.success('রিসেট লিংক পাঠানো হয়েছে');
    } catch {
      setErr('চেষ্টা করা যায়নি। আবার চেষ্টা করুন।');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-md px-4 py-12 sm:py-16">
      <div className="card p-6 sm:p-7">
        <h1 className="mb-1 text-2xl font-bold text-slate-900">পাসওয়ার্ড ভুলে গেছেন?</h1>
        <p className="mb-6 text-sm text-slate-400">
          আপনার ইমেইল দিন — রিসেট লিংক পাঠিয়ে দেব।
        </p>

        {sent ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
              ✅ যদি এই ইমেইলে অ্যাকাউন্ট থাকে, রিসেট লিংক পাঠানো হয়েছে।
              <br />
              <span className="text-emerald-600">ইনবক্স ও স্প্যাম ফোল্ডার দেখুন। লিংক ৩০ মিনিট কাজ করবে।</span>
            </div>
            <Link href="/login" className="btn-primary w-full py-3">লগইনে ফিরুন</Link>
          </div>
        ) : (
          <form onSubmit={submit} noValidate className="space-y-4">
            <div>
              <label htmlFor="email" className="label">ইমেইল</label>
              <input
                id="email" className="input" type="email"
                value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com" autoComplete="email" required
              />
            </div>

            {err && <div role="alert" className="alert-error">{err}</div>}

            <button type="submit" disabled={loading} className="btn-primary w-full py-3">
              {loading ? 'পাঠানো হচ্ছে...' : 'রিসেট লিংক পাঠান'}
            </button>
          </form>
        )}

        <p className="mt-5 text-center text-sm text-slate-400">
          মনে পড়েছে?{' '}
          <Link href="/login" className="font-semibold text-rose-600 hover:underline">
            লগইন করুন
          </Link>
        </p>
      </div>
    </div>
  );
}
