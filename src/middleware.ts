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
  isProd
    ? "script-src 'self' 'unsafe-inline'"
    : "script-src 'self' 'unsafe-inline' 'unsafe-eval'",

  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: https://*.public.blob.vercel-storage.com https:",
  "connect-src 'self' https://*.public.blob.vercel-storage.com",
  "media-src 'none'",
  "object-src 'none'",           // Flash/plugin — সম্পূর্ণ বন্ধ
  "frame-src 'none'",            // কোনো iframe নয়
  "frame-ancestors 'none'",      // clickjacking — আমাদের সাইট iframe এ বসানো যাবে না
  "form-action 'self'",          // ফর্ম শুধু নিজের সাইটে submit হবে
  "base-uri 'self'",             // <base> ট্যাগ দিয়ে হাইজ্যাক নয়
  "manifest-src 'self'",
  "worker-src 'self' blob:",
  isProd ? 'upgrade-insecure-requests' : '',
].filter(Boolean).join('; ');

function secure(res: NextResponse): NextResponse {
  res.headers.set('Content-Security-Policy', CSP);

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

  const isAdmin = pathname.startsWith('/admin');
  const isAccount = pathname.startsWith('/account');

  if (isAdmin || isAccount) {
    const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });

    if (!token?.id) {
      const url = new URL('/login', req.url);
      // ★ open redirect গার্ড — শুধু নিজের সাইটের path
      url.searchParams.set('callbackUrl', pathname);
      return secure(NextResponse.redirect(url));
    }

    // ★ অ্যাডমিন গার্ড — non-admin কখনো /admin এ ঢুকবে না
    if (isAdmin && token.role !== 'ADMIN') {
      return secure(NextResponse.redirect(new URL('/', req.url)));
    }
  }

  return secure(NextResponse.next());
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
