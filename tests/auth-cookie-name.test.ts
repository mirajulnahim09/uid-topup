/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ সেশন-কুকির নাম — middleware ও NextAuth কোর একমত কি না
 *
 *   ── কোন বাগটি এই ফাইল আটকায় (লাইভ সাইটে মাপা, ২০২৬-০৮-১৪) ──
 *
 *   `https://uid-topup.vercel.app` এ লগইন সফল হতো, কিন্তু `/account`
 *   বা `/admin` এ গেলেই আবার `/login` — ড্যাশবোর্ড কখনো খুলত না।
 *   কারণ কুকির নাম দুই জায়গায় দুইভাবে ঠিক হতো:
 *
 *     · কোর (`auth.ts`)  → `NODE_ENV` দেখে → `__Secure-next-auth.session-token`
 *     · middleware       → `getToken()` এর **অনুমান**, যা
 *                          `NEXTAUTH_URL` এর উপর দাঁড়ানো
 *
 *   লাইভ env-এ `NEXTAUTH_URL` https ছিল না (প্রমাণ:
 *   `/api/auth/providers` উত্তরে
 *   `"callbackUrl":"http://localhost:3000/api/auth/callback/google"`),
 *   তাই middleware খুঁজত `next-auth.session-token` — যে নামের কুকি
 *   কখনো লেখাই হয় না।
 *
 *   ⚠️ এই ফাইলে **`vi.resetModules()` বা `NODE_ENV` স্টাব করা যাবে না।**
 *   স্যুটটি একটিমাত্র fork-এ চলে ও সব ফাইল একই মডিউল-গ্রাফ ভাগ করে;
 *   মাঝপথে গ্রাফ রিসেট করলে পরের ফাইলগুলো ভিন্ন ইনস্ট্যান্স পায়।
 *   প্রথম সংস্করণে ঠিক তাই হয়েছিল — `withdrawal.test.ts` এর ৭টি
 *   **টাকার** টেস্ট মিথ্যাভাবে ব্যর্থ হতো। তাই প্রোডাকশন-নাম যাচাই
 *   করা হয় বিশুদ্ধ ফাংশন `authCookieNames()` দিয়ে।
 * ═══════════════════════════════════════════════════════════
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { encode, getToken } from 'next-auth/jwt';
import { middleware } from '../src/middleware';
import { authOptions } from '../src/lib/auth';
import {
  authCookieNames,
  SESSION_COOKIE_NAME,
  CSRF_COOKIE_NAME,
  CALLBACK_COOKIE_NAME,
  USE_SECURE_AUTH_COOKIES,
} from '../src/lib/authCookies';

const SECRET = process.env.NEXTAUTH_SECRET || 'test-secret-for-cookie-name-checks-0123456789';
const PROD = authCookieNames(true);

function reqWithCookie(path: string, name: string, value: string): NextRequest {
  return new NextRequest(`https://uid-topup.vercel.app${path}`, {
    headers: { cookie: `${name}=${value}` },
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('সেশন-কুকির নাম', () => {
  it('🔴 লাইভ বাগ: NEXTAUTH_URL https না হলে getToken প্রোডাকশন-কুকি খুঁজেই পায় না', async () => {
    // লাইভ ডিপ্লয়মেন্টে ঠিক এই মানটিই ছিল
    vi.stubEnv('NEXTAUTH_URL', 'http://localhost:3000');
    vi.stubEnv('VERCEL', '');

    const jwt = await encode({ token: { id: 'u1', role: 'USER' }, secret: SECRET });
    const req = reqWithCookie('/account', PROD.session, jwt);

    // ── আগে middleware ঠিক এভাবেই ডাকত (নাম না দিয়ে) ──
    expect(await getToken({ req, secret: SECRET })).toBeNull();

    // ── এখন নাম স্পষ্ট করে দেওয়া হয় ──
    const explicit = await getToken({
      req, secret: SECRET, cookieName: PROD.session, secureCookie: true,
    });
    expect(explicit?.id).toBe('u1');
  });

  it('প্রোডাকশনের তিনটি নামই prefix-যুক্ত', () => {
    expect(PROD.session).toBe('__Secure-next-auth.session-token');
    expect(PROD.csrf).toBe('__Host-next-auth.csrf-token');
    expect(PROD.callback).toBe('__Secure-next-auth.callback-url');
  });

  it('NextAuth কনফিগ ওই একই ধ্রুবকগুলোই ব্যবহার করে', () => {
    const c = authOptions.cookies ?? {};
    expect(c.sessionToken?.name).toBe(SESSION_COOKIE_NAME);
    expect(c.csrfToken?.name).toBe(CSRF_COOKIE_NAME);
    expect(c.callbackUrl?.name).toBe(CALLBACK_COOKIE_NAME);

    // `secure` পতাকা তিনটিতেই একই নিয়মে
    expect(c.sessionToken?.options?.secure).toBe(USE_SECURE_AUTH_COOKIES);
    expect(c.csrfToken?.options?.secure).toBe(USE_SECURE_AUTH_COOKIES);
    expect(c.callbackUrl?.options?.secure).toBe(USE_SECURE_AUTH_COOKIES);

    // `__Host-` এর শর্ত — path '/' এবং domain অনুপস্থিত
    expect(c.csrfToken?.options?.path).toBe('/');
    expect(c.csrfToken?.options?.domain).toBeUndefined();
  });

  it('middleware বৈধ সেশন চেনে, কুকি না থাকলে /login, সাধারণ ইউজারকে /admin এ ঢুকতে দেয় না', async () => {
    vi.stubEnv('NEXTAUTH_SECRET', SECRET);
    // ★ ফাঁদটি আবার পাতা: env এমন যাতে getToken-এর নিজস্ব অনুমান ভুল হতো
    vi.stubEnv('NEXTAUTH_URL', 'http://localhost:3000');

    const jwt = await encode({ token: { id: 'u1', role: 'USER' }, secret: SECRET });

    // লগইন করা ব্যবহারকারী → রিডাইরেক্ট নয়
    const ok = await middleware(reqWithCookie('/account', SESSION_COOKIE_NAME, jwt));
    expect(ok.headers.get('location')).toBeNull();

    // কুকিহীন → /login
    const anon = await middleware(new NextRequest('https://uid-topup.vercel.app/account'));
    expect(anon.headers.get('location')).toContain('/login');

    // সাধারণ ইউজার /admin এ → ঢুকতে পারবে না
    const asAdmin = await middleware(reqWithCookie('/admin', SESSION_COOKIE_NAME, jwt));
    expect(asAdmin.headers.get('location')).not.toContain('/admin');
  });
});
