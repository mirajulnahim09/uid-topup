import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

/**
 * ═══════════════════════════════════════════════════════
 * দুইটা কাজ:
 *   1. রুট সুরক্ষা — /admin ও /account
 *   2. নিরাপত্তা হেডার — প্রতিটা response এ
 * ═══════════════════════════════════════════════════════
 */

const isProd = process.env.NODE_ENV === 'production';

const CSP = [
  "default-src 'self'",

  // Next.js এর inline script দরকার হয় (hydration)। dev এ eval ও লাগে।
  // ★ Tawk.to লাইভ চ্যাট — embed.tawk.to থেকে স্ক্রিপ্ট
  isProd
    ? "script-src 'self' 'unsafe-inline' https://embed.tawk.to https://*.tawk.to"
    : "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://embed.tawk.to https://*.tawk.to",

  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://*.tawk.to",
  "font-src 'self' https://fonts.gstatic.com https://*.tawk.to data:",
  "img-src 'self' data: blob: https://*.public.blob.vercel-storage.com https:",
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

function secure(res: NextResponse): NextResponse {
  res.headers.set('Content-Security-Policy', CSP);

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

  const withId = (res: NextResponse): NextResponse => {
    res.headers.set('x-request-id', requestId);
    return secure(res);
  };

  const isAdmin = pathname.startsWith('/admin');
  const isAccount = pathname.startsWith('/account');

  if (isAdmin || isAccount) {
    const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });

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

  return withId(NextResponse.next());
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
