'use client';

import { Suspense, useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useToast } from '@/components/Toast';
import GoogleButton from '@/components/GoogleButton';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    setLoading(true);

    try {
      const res = await signIn('credentials', {
        email: email.trim().toLowerCase(),
        password,
        redirect: false,
      });

      if (res?.error) {
        const msg = 'ইমেইল বা পাসওয়ার্ড ভুল';
        setErr(msg);
        toast.error(msg);
        return;
      }

      toast.success('লগইন সফল');
      const back = params.get('callbackUrl');
      // ★ Open redirect আটকানো — শুধু relative path
      router.push(back && back.startsWith('/') ? back : '/');
      router.refresh();
    } catch {
      const msg = 'লগইন করা যায়নি। আবার চেষ্টা করুন।';
      setErr(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-md px-4 py-12 sm:py-16">
      <div className="card p-6 sm:p-7">
        <h1 className="mb-1 text-2xl font-bold text-slate-900">লগইন</h1>
        <p className="mb-6 text-sm text-slate-400">অ্যাকাউন্টে প্রবেশ করুন</p>

        <form onSubmit={submit} noValidate className="space-y-4">
          <div>
            <label htmlFor="email" className="label">ইমেইল</label>
            <input
              id="email" className="input" type="email"
              value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com" autoComplete="email" required
            />
          </div>

          <div>
            <label htmlFor="pw" className="label">পাসওয়ার্ড</label>
            <div className="relative">
              <input
                id="pw" className="input pr-11"
                type={show ? 'text' : 'password'}
                value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••" autoComplete="current-password" required
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

          <div className="text-right">
            <Link href="/forgot-password" className="text-sm font-semibold text-rose-600 hover:underline">
              পাসওয়ার্ড ভুলে গেছেন?
            </Link>
          </div>

          {err && <div role="alert" className="alert-error">{err}</div>}

          <button type="submit" disabled={loading} className="btn-primary w-full py-3">
            {loading ? 'অপেক্ষা করুন...' : 'লগইন'}
          </button>
        </form>

        <GoogleButton callbackUrl="/account" />

        <p className="mt-5 text-center text-sm text-slate-400">
          অ্যাকাউন্ট নেই?{' '}
          <Link href="/register" className="font-semibold text-rose-600 hover:underline">
            রেজিস্টার করুন
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-md p-16"><div className="skeleton h-80 w-full" /></div>}>
      <LoginForm />
    </Suspense>
  );
}
