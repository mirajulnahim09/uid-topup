import { prisma } from '@/lib/prisma';
import { getSettings } from '@/lib/settings';
import BannerSlider from '@/components/BannerSlider';
import ProductGrid from '@/components/ProductGrid';
import HomeHero from '@/components/HomeHero';

// ★ ৬০ সেকেন্ড ক্যাশ — দাম/প্রোডাক্ট বদলালে সাথে সাথে revalidate হয়
export const revalidate = 60;

export default async function HomePage() {
  let categories: any[] = [];
  let banners: any[] = [];
  let settings: Record<string, string> = {};

  try {
    [categories, banners, settings] = await Promise.all([
      prisma.category.findMany({
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
        include: {
          products: {
            where: { isActive: true },
            orderBy: { sortOrder: 'asc' },
            select: { id: true, name: true, slug: true, image: true, description: true },
          },
        },
      }),
      prisma.banner.findMany({
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
        select: { id: true, image: true, title: true, subtitle: true, link: true },
      }),
      getSettings(),
    ]);
  } catch (e) {
    // ★ DB না পেলেও পেজ ভাঙবে না — খালি দেখাবে
    console.error('[home] db unavailable:', e);
  }

  const notice = settings.site_notice;

  const cats = (categories ?? [])
    .filter((c: (typeof categories)[number]) => (c?.products?.length ?? 0) > 0)
    .map((c: (typeof categories)[number]) => ({
      id: c.id,
      name: c.name,
      icon: c.icon,
      products: c.products,
    }));

  return (
    <>
      {/* Notice bar */}
      {notice && (
        <div className="border-b border-amber-200 bg-amber-50">
          <div className="mx-auto flex max-w-7xl gap-2.5 px-4 py-2.5">
            <span aria-hidden="true">📢</span>
            <p className="text-sm font-medium leading-relaxed text-amber-800">{notice}</p>
          </div>
        </div>
      )}

      {/* ★ চোখ ধাঁধানো হিরো */}
      <HomeHero
        title={settings.hero_title || 'ফ্রি ফায়ার ডায়মন্ড টপ আপ'}
        subtitle={settings.hero_subtitle || 'কম দামে ভালো সার্ভিস'}
      />

      {/* Banner slider */}
      {(banners?.length ?? 0) > 0 && (
        <div className="mx-auto max-w-7xl px-4 pt-5">
          <BannerSlider banners={banners} />
        </div>
      )}

      {/* Products */}
      <div className="mx-auto max-w-7xl px-4 py-10">
        <ProductGrid categories={cats} />
      </div>
    </>
  );
}
