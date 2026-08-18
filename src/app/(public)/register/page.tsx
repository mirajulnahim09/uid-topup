'use client';

import { Suspense, useEffect, useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useToast } from '@/components/Toast';
import GoogleButton from '@/components/GoogleButton';
import BrandLogo from '@/components/brand/BrandLogo';
import { useLogo } from '@/components/brand/BrandProvider';

function RegisterForm() {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const loginLogo = useLogo('login');

  const [f, setF] = useState({
    name: '', email: '', phone: '', password: '', referralCode: '',
  });
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errs, setErrs] = useState<Record<string, string>>({});

  /**
   * ★★★ Group I (৩) — ইমেইল যাচাই কোড।
   *
   *   ⚠️ দুই-পাতার ধাপ নয়, একই ফর্মেই: "কোড পাঠান" চাপলে কোডের ঘরটি
   *   দেখা যায়। দুই পাতায় ভাগ করলে ব্যবহারকারী প্রথম পাতা পেরিয়ে
   *   এসে দ্বিতীয়টিতে আটকে গেলে আর ফেরার পথ থাকত না, আর অর্ধেক
   *   ভরা ফর্ম হারাত।
   *
   *   ⚠️ কোড ও বাকি তথ্য **একসাথে** `/api/register`-এ যায় — সার্ভারে
   *   যাচাই ও অ্যাকাউন্ট তৈরি এক ট্রানজেকশনে।
   */
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [sending, setSending] = useState(false);
  /** ★ পুনরায় পাঠানোর আগে অপেক্ষা — সার্ভারের সীমার সাথে সঙ্গতিপূর্ণ */
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function sendCode() {
    const email = f.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setErrs((e) => ({ ...e, email: 'আগে সঠিক ইমেইল দিন' }));
      return;
    }
    setSending(true);
    try {
      const res = await fetch('/api/auth/otp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, phone: f.phone.trim() || undefined }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      setCodeSent(true);
      setCooldown(60);
      toast.success(d.message || 'কোড পাঠানো হয়েছে');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'কোড পাঠানো যায়নি');
    } finally {
      setSending(false);
    }
  }

  // ?ref=CODE থেকে auto-fill
  useEffect(() => {
    const ref = params.get('ref');
    if (ref) setF((v) => ({ ...v, referralCode: ref.toUpperCase() }));
  }, [params]);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setF({ ...f, [k]: e.target.value });
    if (errs[k]) setErrs({ ...errs, [k]: '' });
  };

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (f.name.trim().length < 2) e.name = 'নাম কমপক্ষে ২ অক্ষর';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) e.email = 'সঠিক ইমেইল দিন';
    if (!/^01[3-9]\d{8}$/.test(f.phone.trim())) e.phone = 'সঠিক মোবাইল নাম্বার দিন (01712345678)';
    if (f.password.length < 8) e.password = 'পাসওয়ার্ড কমপক্ষে ৮ অক্ষর';
    else if (!/[a-zA-Z\u0980-\u09FF]/.test(f.password))
      e.password = 'অন্তত একটি অক্ষর থাকতে হবে';
    else if (!/[0-9]/.test(f.password))
      e.password = 'অন্তত একটি সংখ্যা থাকতে হবে';
    // ★ কোড না চাইলে/না দিলে সার্ভারও আটকাত, কিন্তু এখানে ধরলে
    //   একটি অকারণ রাউন্ড-ট্রিপ বাঁচে
    if (!/^\d{6}$/.test(code.trim())) e.code = 'ইমেইলে পাঠানো ৬-অঙ্কের কোড দিন';
    setErrs(e);
    return Object.keys(e).length === 0;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    setLoading(true);
    try {
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...f,
          email: f.email.trim().toLowerCase(),
          referralCode: f.referralCode.trim() || undefined,
          code: code.trim(),
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);

      toast.success('অ্যাকাউন্ট তৈরি হয়েছে!');

      await signIn('credentials', {
        email: f.email.trim().toLowerCase(),
        password: f.password,
        redirect: false,
      });

      router.push('/');
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'রেজিস্টার করা যায়নি');
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-md page-x page-y">
      {/* ★ কোনো স্থানীয় লোডার নেই — `/api/register` ও `/api/auth/*`
          দুটোই গ্লোবাল BLOCKING_PATHS-এ, তাই একমাত্র ওভারলেটিই আসে। */}
      <div className="card p-6 sm:p-7">
        {/* ★ অ্যাডমিন-নিয়ন্ত্রিত লগইন লোগো (রেজিস্টারেও একই স্লট) */}
        <div className="mb-4 flex justify-center">
          <BrandLogo logos={loginLogo} slot="login" alt="" height={44} priority />
        </div>
        <h1 className="mb-1 text-center text-2xl font-bold text-slate-900">রেজিস্টার</h1>
        <p className="mb-6 text-center text-sm text-slate-400">নতুন অ্যাকাউন্ট খুলুন</p>

        <form onSubmit={submit} noValidate className="space-y-4">
          <div>
            <label htmlFor="name" className="label">নাম</label>
            <input
              id="name" className="input" value={f.name} onChange={set('name')}
              placeholder="আপনার নাম" autoComplete="name"
              aria-invalid={Boolean(errs.name)}
            />
            {errs.name && <p role="alert" className="mt-1 text-xs text-red-600">{errs.name}</p>}
          </div>

          <div>
            <label htmlFor="email" className="label">ইমেইল</label>
            <input
              id="email" className="input" type="email" value={f.email} onChange={set('email')}
              placeholder="you@example.com" autoComplete="email"
              aria-invalid={Boolean(errs.email)}
            />
            {errs.email && <p role="alert" className="mt-1 text-xs text-red-600">{errs.email}</p>}
          </div>

          {/* ★★★ Group I (৩) — ইমেইল যাচাই। ইমেইলের ঠিক নিচে, কারণ
              এটি ঐ ঘরেরই ধারাবাহিকতা। */}
          <div>
            <div className="flex items-end justify-between gap-3">
              <label htmlFor="otp" className="label mb-0">ইমেইল যাচাই কোড</label>
              <button
                type="button"
                onClick={sendCode}
                disabled={sending || cooldown > 0}
                className="btn-ghost px-3 py-1.5 text-xs disabled:opacity-50"
              >
                {cooldown > 0
                  ? `আবার পাঠান (${cooldown}s)`
                  : sending
                    ? 'পাঠানো হচ্ছে…'
                    : codeSent
                      ? 'আবার পাঠান'
                      : 'কোড পাঠান'}
              </button>
            </div>
            <input
              id="otp"
              className="input mt-1.5 font-mono tracking-[0.4em]"
              inputMode="numeric"
              maxLength={6}
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => {
                setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
                if (errs.code) setErrs({ ...errs, code: '' });
              }}
              placeholder="৬ অঙ্ক"
              aria-invalid={Boolean(errs.code)}
            />
            {errs.code && <p role="alert" className="mt-1 text-xs text-red-600">{errs.code}</p>}
            {codeSent && !errs.code && (
              <p className="mt-1 text-xs" style={{ color: 'var(--v-mut)' }}>
                ইমেইল দেখুন — কোডটি ১০ মিনিট বৈধ। স্প্যাম ফোল্ডারও দেখবেন।
              </p>
            )}
          </div>

          <div>
            <label htmlFor="phone" className="label">মোবাইল নাম্বার</label>
            <input
              id="phone" className="input" type="tel" inputMode="numeric"
              value={f.phone} onChange={set('phone')}
              placeholder="01712345678" autoComplete="tel"
              aria-invalid={Boolean(errs.phone)}
            />
            {errs.phone && <p role="alert" className="mt-1 text-xs text-red-600">{errs.phone}</p>}
          </div>

          <div>
            <label htmlFor="password" className="label">পাসওয়ার্ড</label>
            <div className="relative">
              <input
                id="password" className="input pr-11"
                type={show ? 'text' : 'password'}
                value={f.password} onChange={set('password')}
                placeholder="৮+ অক্ষর, অন্তত ১টি সংখ্যা" autoComplete="new-password"
                aria-invalid={Boolean(errs.password)}
              />
              <button
                type="button" onClick={() => setShow(!show)}
                aria-label={show ? 'পাসওয়ার্ড লুকান' : 'পাসওয়ার্ড দেখান'}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-2 text-slate-400 hover:text-slate-900"
              >
                {show ? '🙈' : '👁'}
              </button>
            </div>
            {errs.password && <p role="alert" className="mt-1 text-xs text-red-600">{errs.password}</p>}
          </div>

          <div>
            <label htmlFor="ref" className="label">
              রেফারেল কোড <span className="normal-case text-slate-400">(ঐচ্ছিক)</span>
            </label>
            <input
              id="ref" className="input font-mono uppercase"
              value={f.referralCode}
              onChange={(e) => setF({ ...f, referralCode: e.target.value.toUpperCase() })}
              placeholder="বন্ধুর কোড থাকলে দিন"
              autoComplete="off"
            />
          </div>

          <button type="submit" disabled={loading} className="btn-primary w-full py-3">
            {loading ? 'অপেক্ষা করুন...' : 'অ্যাকাউন্ট খুলুন'}
          </button>
        </form>

        <GoogleButton callbackUrl="/account" />

        <p className="mt-5 text-center text-sm text-slate-400">
          অ্যাকাউন্ট আছে?{' '}
          <Link href="/login" className="inline-flex min-h-[44px] items-center font-bold hover:underline" style={{ color: 'var(--v-volt)' }}>
            লগইন করুন
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-md p-16"><div className="skeleton h-96 w-full" /></div>}>
      <RegisterForm />
    </Suspense>
  );
}
