'use client';

import { Suspense, useState } from 'react';
import { signIn, getSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useToast } from '@/components/Toast';
import GoogleButton from '@/components/GoogleButton';
import BrandLogo from '@/components/brand/BrandLogo';
import { useLogo } from '@/components/brand/BrandProvider';

/**
 * ★★★ লগইনের পর ফেরার পথ — কেবল **নিজের origin**।
 *
 *   আগে শর্ত ছিল `startsWith('/') && !startsWith('//')`। এটি স্ট্রিং
 *   দেখে, অথচ গন্তব্য ঠিক করে ব্রাউজারের URL-পার্সার — আর সেটি `\` কে
 *   `/` ধরে এবং TAB/newline মুছে দেয়। ফলে `/\evil.com` ও `/<TAB>/evil.com`
 *   দুটোই শর্ত পার হতো, কিন্তু ব্রাউজারে হয়ে যেত `//evil.com` — অন্য
 *   সাইট। ব্রাউজারে মাপা: লগইনের পর সত্যিই `http://evil.example/x` এ
 *   নামত (`scripts/verify/security-probes.ts`)। অর্থাৎ আসল লগইন-পাতার
 *   লিংক দিয়ে ফিশিং-সাইটে পাঠানো যেত।
 *
 *   এখন পার্সারকেই জিজ্ঞেস করি: resolve করার পর origin কি নিজের? হলে
 *   কেবল path+query+hash ফেরত যায় — যা ব্রাউজার ঠিক যেভাবে বুঝেছে।
 */
function safeCallbackPath(raw: string | null): string | null {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return null;
  try {
    const u = new URL(raw, window.location.origin);
    if (u.origin !== window.location.origin) return null;
    return u.pathname + u.search + u.hash;
  } catch {
    return null;
  }
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const loginLogo = useLogo('login');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  // ★ 2FA — password ঠিক হলে সার্ভার '2FA_REQUIRED' দেয়; তখন কোড চাই
  const [needsTotp, setNeedsTotp] = useState(false);
  const [totp, setTotp] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    setLoading(true);

    // ★ সফল হলে ম্যাসকট **রেখে দেওয়া হয়** — `router.push()` নেভিগেশন
    //   শেষ হওয়ার আগেই ফেরত আসে, তাই এখানে loading বন্ধ করলে ম্যাসকট
    //   এক পলকের জন্য মিলিয়ে গিয়ে তারপর রুট-ওভারলে আসত — ঝাঁকুনি।
    //   পাতা বদলালে কম্পোনেন্টই unmount হয়, তাই আলাদা করে বন্ধ করার
    //   দরকার নেই।
    let ok = false;
    // ★ AUTH-03 — প্রি-চেক নিজেই পাসওয়ার্ড ভুল পেলে (চেষ্টাটি তখনই গোনা হয়েছে)
    //   `signIn` আর ডাকা হয় না — নাহলে একটি ভুল চেষ্টা দুবার গোনা হতো
    let precheckRejected = false;
    try {
      // ★★★ 2FA প্রি-চেক — throw-এর উপর নির্ভর না করে deterministic ভাবে
      //   জানি 2FA লাগবে কিনা (NextAuth v4 throw-message নির্ভরযোগ্য নয়)।
      //   কোড এখনো না দিলে ও 2FA লাগলে — কোড-ইনপুট দেখাই, signIn ডাকি না।
      if (!needsTotp && !totp.trim()) {
        try {
          const chk = await fetch('/api/auth/2fa-check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
          });
          if (chk.ok) {
            const { needsTotp: need, credentialsOk } = await chk.json();
            if (need) {
              setNeedsTotp(true);
              setErr('');
              toast.success('আপনার Authenticator অ্যাপের ৬-অঙ্কের কোডটি দিন');
              setLoading(false);
              return;
            }
            if (credentialsOk === false) precheckRejected = true;
          }
        } catch {
          // প্রি-চেক ব্যর্থ হলেও থামি না — signIn নিজেই 2FA যাচাই করবে
        }
      }

      // ★ প্রি-চেক-প্রত্যাখ্যাত হলে ব্যর্থ `signIn`-এর মতোই নিচের বার্তা-পথে যাই
      //   ("ভুল" বনাম "সাময়িক বন্ধ" — `login-status` দিয়ে, আগের মতোই)
      const res = precheckRejected
        ? { error: 'CredentialsSignin', ok: false, status: 401, url: null }
        : await signIn('credentials', {
          email: email.trim().toLowerCase(),
          password,
          totp: totp.trim(),
          redirect: false,
        });

      if (res?.error) {
        // ★ fallback: NextAuth যদি 2FA_REQUIRED পাঠায় (throw পৌঁছালে)
        if (res.error.includes('2FA_REQUIRED')) {
          setNeedsTotp(true);
          setErr('');
          toast.success('আপনার Authenticator অ্যাপের ৬-অঙ্কের কোডটি দিন');
          return;
        }
        // ★★★ "ভুল পাসওয়ার্ড" বলার আগে নিশ্চিত হই যে সেটাই কারণ।
        //   `authorize()` রেট-লিমিটেও `null` দেয়, আর NextAuth সব
        //   কারণকে একই `CredentialsSignin`-এ মেলায়। আগে তাই সঠিক
        //   পাসওয়ার্ড দিয়েও "ইমেইল বা পাসওয়ার্ড ভুল" দেখাত — ব্যবহারকারী
        //   অকারণে পাসওয়ার্ড রিসেট করতে যেতেন। এখন সত্যিটা জেনে বলি।
        //   (endpoint কেবল বাকেট **পড়ে**, গণনা বাড়ায় না।)
        let msg = needsTotp
          ? 'কোড ভুল বা মেয়াদোত্তীর্ণ — আবার দিন'
          : 'ইমেইল বা পাসওয়ার্ড ভুল';
        let throttled = false;
        try {
          const st = await fetch('/api/auth/login-status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email.trim().toLowerCase() }),
          });
          if (st.ok) {
            const { limited, retryAfter, serverIssue } = await st.json();
            // ★ C4 — লিমিটার নিজেই পড়া যায়নি: লগইন আটকেছে সার্ভার
            //   সমস্যার কারণে, পাসওয়ার্ড ভুল বলে নয়। ⚠️ বার্তায় কখনো
            //   বলা হয় না ঠিক কী ভেঙেছে।
            if (serverIssue) {
              throttled = true;
              msg = 'সার্ভারে সাময়িক সমস্যা হচ্ছে, একটু পরে আবার চেষ্টা করুন';
            } else if (limited) {
              throttled = true;
              const mins = Math.max(1, Math.ceil((retryAfter || 0) / 60));
              // বাকি অ্যাপের মতো বাংলা অঙ্ক
              const bn = String(mins).replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[Number(d)]);
              msg = `নিরাপত্তার জন্য লগইন সাময়িকভাবে বন্ধ — অনেকবার চেষ্টা হয়েছে। ${bn} মিনিট পর আবার চেষ্টা করুন। (পাসওয়ার্ড বদলানোর দরকার নেই)`;
            }
          }
        } catch {
          // status জানা না গেলে আগের বার্তাই থাক
        }
        setErr(msg);
        if (throttled) toast.warning(msg);
        else toast.error(msg);
        return;
      }

      ok = true;
      toast.success('লগইন সফল');

      /**
       * ★★★ গন্তব্য এখন **role-সচেতন**।
       *
       *   ── আগে কী হতো ──
       *   `router.push(back ?? '/')` — অর্থাৎ ভূমিকা যাই হোক, সবাই
       *   স্টোরফ্রন্টের হোমপেজে নামত। অ্যাডমিন লগইন করলে সেশনে
       *   `role: 'ADMIN'` ঠিকই থাকত (ব্রাউজারে মাপা), কিন্তু তিনি
       *   গ্রাহকের পাতায় গ্রাহকের ন্যাভবার ও বটম-বার দেখতেন —
       *   ব্যবহারিকভাবে "অ্যাডমিনকে গ্রাহক হিসেবে দেখানো"।
       *   ফোনে ব্যাপারটা আরও খারাপ ছিল: `/admin`-এ যাওয়ার একমাত্র
       *   লিংকটি হ্যামবার্গার মেনুর নিচে, আর সেটি বটম-বারের নিচে
       *   ঢাকা পড়ে থাকত (নিচে Navbar/globals.css এর ঠিক করা হয়েছে)।
       *
       *   ── এখন ──
       *   স্পষ্ট `callbackUrl` থাকলে সেটিই সর্বোচ্চ অগ্রাধিকার পায়
       *   (যেমন middleware `/account/orders` থেকে ফেরত পাঠিয়েছিল)।
       *   না থাকলে সেশন থেকে ভূমিকা পড়ে গন্তব্য ঠিক হয়।
       *
       *   ⚠️ ভূমিকা **সার্ভারের সেশন থেকেই** আসে (`getSession()` →
       *   `/api/auth/session`), ক্লায়েন্টের কোনো অনুমান থেকে নয়।
       *   এটি কেবল **গন্তব্য** ঠিক করে — কোনো অনুমতি দেয় না।
       *   `/admin`-এর আসল পাহারা আগের মতোই তিন স্তরে: `middleware.ts`,
       *   `admin/layout.tsx` ও প্রতিটি রুটের `requireAdmin()`। তাই
       *   গ্রাহক এখানে যা-ই ঘটাক, `/admin` তার জন্য বন্ধই থাকে।
       */
      const back = params.get('callbackUrl');
      // ★ Open redirect আটকানো — শুধু নিজের origin (বিস্তারিত `safeCallbackPath`)
      const safeBack = safeCallbackPath(back);

      let dest = safeBack;
      if (!dest) {
        // ★ সেশন না পড়া গেলে (নেটওয়ার্ক সমস্যা) হোমপেজই নিরাপদ ডিফল্ট
        const s = await getSession().catch(() => null);
        dest = s?.user?.role === 'ADMIN' ? '/admin' : '/';
      }

      router.push(dest);
      router.refresh();
    } catch {
      const msg = 'লগইন করা যায়নি। আবার চেষ্টা করুন।';
      setErr(msg);
      toast.error(msg);
    } finally {
      if (!ok) setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-md page-x page-y">
      {/* ★ এখানে কোনো লোডার মাউন্ট করা হয় না — ইচ্ছাকৃত।
          `/api/auth/callback` গ্লোবাল `LoadingProvider`-এর BLOCKING_PATHS
          এ আছে, তাই লগইনের সময় প্ল্যাটফর্মের একমাত্র ওভারলেটিই আসে।
          আগে এখানে আলাদা একটি ম্যাসকট ছিল — দুটি সমান্তরাল ব্যবস্থা। */}
      <div className="card p-6 sm:p-7">
        {/* ★ অ্যাডমিনের "লগইন লোগো" — না থাকলে প্রধান লোগো, তাও না
            থাকলে VoltMark (BrandLogo নিজেই সামলায়) */}
        <div className="mb-4 flex justify-center">
          <BrandLogo logos={loginLogo} slot="login" alt="" height={44} priority />
        </div>
        <h1 className="mb-1 text-center text-2xl font-bold text-slate-900">লগইন</h1>
        <p className="mb-6 text-center text-sm text-slate-400">অ্যাকাউন্টে প্রবেশ করুন</p>

        <form onSubmit={submit} noValidate className="space-y-4">
          <div>
            <label htmlFor="email" className="label">ইমেইল</label>
            <input
              id="email" className="input" type="email"
              value={email} onChange={(e) => { setEmail(e.target.value); if (needsTotp) { setNeedsTotp(false); setTotp(""); } }}
              placeholder="you@example.com" autoComplete="email" required
            />
          </div>

          <div>
            <label htmlFor="pw" className="label">পাসওয়ার্ড</label>
            <div className="relative">
              <input
                id="pw" className="input pr-11"
                type={show ? 'text' : 'password'}
                value={password} onChange={(e) => { setPassword(e.target.value); if (needsTotp) { setNeedsTotp(false); setTotp(""); } }}
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

          {/* ★ 2FA — password যাচাই হয়ে গেলে কেবল তখনই দেখায় */}
          {needsTotp && (
            <div>
              <label htmlFor="totp" className="label">
                Authenticator কোড
              </label>
              <input
                id="totp"
                className="input tracking-[0.4em] text-center text-lg font-bold"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={totp}
                onChange={(e) => setTotp(e.target.value.replace(/[^\d]/g, '').slice(0, 6))}
                placeholder="••••••"
                autoFocus
                required
              />
              <p className="mt-1.5 text-xs text-slate-500">
                Google Authenticator / Authy অ্যাপের ৬-অঙ্কের কোড, অথবা একটি recovery কোড দিন।
              </p>
            </div>
          )}

          <div className="text-right">
            <Link
              href="/forgot-password"
              className="inline-flex min-h-[40px] items-center text-sm font-bold hover:underline" style={{ color: 'var(--v-volt)' }}
            >
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
          <Link href="/register" className="inline-flex min-h-[44px] items-center font-bold hover:underline" style={{ color: 'var(--v-volt)' }}>
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
