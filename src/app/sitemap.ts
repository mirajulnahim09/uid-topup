import type { MetadataRoute } from 'next';
import { prisma } from '@/lib/prisma';

/**
 * ★ sitemap.xml (SEO) — সার্চ ইঞ্জিনকে সব পাবলিক পেজ ও সক্রিয়
 *   প্রোডাক্টের তালিকা দেয়, যাতে দ্রুত ইনডেক্স হয়।
 *
 *   ডাটাবেস অচল হলেও অন্তত স্ট্যাটিক পেজগুলো ফেরে (ভাঙে না)।
 */
export const revalidate = 3600; // ঘণ্টায় একবার রিফ্রেশ

function baseUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXTAUTH_URL || 'http://localhost:3000').replace(/\/$/, '');
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = baseUrl();
  const now = new Date();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${base}/`, lastModified: now, changeFrequency: 'daily', priority: 1 },
    { url: `${base}/track`, lastModified: now, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${base}/faq`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${base}/contact`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${base}/terms`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${base}/privacy`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${base}/refund`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${base}/login`, lastModified: now, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${base}/register`, lastModified: now, changeFrequency: 'yearly', priority: 0.2 },
  ];

  let productRoutes: MetadataRoute.Sitemap = [];
  try {
    const products = await prisma.product.findMany({
      where: { isActive: true },
      select: { id: true, slug: true },
    });
    productRoutes = products.map((p: { id: number; slug: string }) => ({
      url: `${base}/product/${p.id}/${p.slug}`,
      lastModified: now,
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    }));
  } catch {
    // DB অচল হলেও স্ট্যাটিক অংশ ফেরে
  }

  return [...staticRoutes, ...productRoutes];
}
