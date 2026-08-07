import type { MetadataRoute } from 'next';

/**
 * ★ robots.txt (SEO) — সার্চ ইঞ্জিনকে বলে কোথায় যাওয়া যাবে।
 *   অ্যাকাউন্ট/অ্যাডমিন/API ব্লক (গোপনীয়তা + ক্রল-বাজেট বাঁচানো)।
 */
function baseUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXTAUTH_URL || 'http://localhost:3000').replace(/\/$/, '');
}

export default function robots(): MetadataRoute.Robots {
  const base = baseUrl();
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/admin', '/account', '/api/', '/reset-password', '/forgot-password'],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
