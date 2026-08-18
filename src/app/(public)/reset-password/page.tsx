'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useToast } from '@/components/Toast';

function ResetForm() {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const token = params.get('token') || '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');

    if (password !== confirm) {
      setErr('দুইবার একই পাসওয়ার্ড দিন');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error || 'সমস্যা হয়েছে');
        toast.error(data.error || 'সমস্যা হয়েছে');
        return;
      }
      toast.success('পাসওয়ার্ড বদলানো হয়েছে');
      router.push('/login');
    } catch {
      setErr('চেষ্টা করা যায়নি। আবার চেষ্টা করুন।');
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <div className="mx-auto max-w-md px-4 py-16">
        <div className="card p-6 text-center">
          <p className="text-4xl" aria-hidden="true">⚠️</p>
          <h1 className="mt-3 text-xl font-bold text-slate-900">লিংকটি অবৈধ</h1>
          <p className="mt-2 text-slate-600">লিংকটি অসম্পূর্ণ বা মেয়াদোত্তীর্ণ।</p>
          <Link href="/forgot-password" className="btn-primary mt-5">আবার রিসেট করুন</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md page-x page-y">
      <div className="card p-6 sm:p-7">
        <h1 className="mb-1 text-2xl font-bold text-slate-900">নতুন পাসওয়ার্ড</h1>
        <p className="mb-6 text-sm text-slate-400">একটি শক্তিশালী নতুন পাসওয়ার্ড দিন।</p>

        <form onSubmit={submit} noValidate className="space-y-4">
          <div>
            <label htmlFor="pw" className="label">নতুন পাসওয়ার্ড</label>
            <div className="relative">
              <input
                id="pw" className="input pr-11"
                type={show ? 'text' : 'password'}
                value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder="কমপক্ষে ৮ অক্ষর, ১টি সংখ্যা" autoComplete="new-password" required
              />
              <button
                type="button"
                onClick={() => setShow(!show)}
                aria-label={show ? 'পাসওয়ার্ড লুকান' : 'পাসওয়ার্ড দেখান'}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-2 text-slate-400 transition hover:text-slate-900"
              >
                {show ? '🙈' : '👁'}
              </button>
            </div>
          </div>

          <div>
            <label htmlFor="pw2" className="label">আবার লিখুন</label>
            <input
              id="pw2" className="input"
              type={show ? 'text' : 'password'}
              value={confirm} onChange={(e) => setConfirm(e.target.value)}
              placeholder="একই পাসওয়ার্ড" autoComplete="new-password" required
            />
          </div>

          {err && <div role="alert" className="alert-error">{err}</div>}

          <button type="submit" disabled={loading} className="btn-primary w-full py-3">
            {loading ? 'অপেক্ষা করুন...' : 'পাসওয়ার্ড বদলান'}
          </button>
        </form>

        <p className="mt-5 text-center text-sm text-slate-400">
          <Link href="/login" className="inline-flex min-h-[44px] items-center font-bold hover:underline" style={{ color: 'var(--v-volt)' }}>
            লগইনে ফিরুন
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-md p-16"><div className="skeleton h-80 w-full" /></div>}>
      <ResetForm />
    </Suspense>
  );
}
