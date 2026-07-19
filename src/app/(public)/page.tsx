import { prisma } from '@/lib/prisma';
import { getSettings } from '@/lib/settings';
import BannerSlider from '@/components/BannerSlider';
import ProductGrid from '@/components/ProductGrid';
import HomeHero from '@/components/HomeHero';
import { getTrustStats } from '@/lib/trustMetrics';
import { slaFromSettings, slaPromiseText } from '@/lib/sla';
import { getOpsStatus } from '@/lib/opsStatus';
import OpsStatusBanner from '@/components/OpsStatusBanner';

// ★ ৬০ সেকেন্ড ক্যাশ — দাম/প্রোডাক্ট বদলালে সাথে সাথে revalidate হয়
export const revalidate = 60;

export default async function HomePage() {
  let categories: any[] = [];
  let banners: any[] = [];
  let settings: Record<string, string> = {};
  // ★ বাস্তব পরিসংখ্যান — না পেলে খালি, তখন হোমপেজে কিছু দেখানো হয় না
  let trustStats: Awaited<ReturnType<typeof getTrustStats>> = [];

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

  // ★ পরিসংখ্যান আলাদা try তে — এটি ব্যর্থ হলেও প্রোডাক্ট দেখানো চলবে
  trustStats = await getTrustStats(settings.support_hours);

  // ★ প্রকৃত পরিচালন-অবস্থা (2.17) — ব্যর্থ হলে null, ব্যানার দেখানো হয় না
  const opsStatus = await getOpsStatus(slaFromSettings(settings));

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
      {/* ★ প্রকৃত পরিচালন-অবস্থা — সবার আগে, কারণ এটি সিদ্ধান্তে
          প্রভাব ফেলে (এখন অর্ডার দেব, নাকি পরে?) (2.17) */}
      <OpsStatusBanner status={opsStatus} />

      {/* Notice bar */}
      {notice && (
        <div className="border-b border-amber-200 bg-amber-50">
          <div className="mx-auto flex max-w-6xl gap-2.5 page-x py-2.5">
            <span aria-hidden="true">📢</span>
            <p className="text-sm font-medium leading-relaxed text-amber-800">{notice}</p>
          </div>
        </div>
      )}

      {/* ★ চোখ ধাঁধানো হিরো */}
      <HomeHero
        title={settings.hero_title || 'ফ্রি ফায়ার ডায়মন্ড টপ আপ'}
        subtitle={settings.hero_subtitle || 'কম দামে ভালো সার্ভিস'}
        stats={trustStats}
        tagline={slaPromiseText(slaFromSettings(settings))}
      />

      {/* Banner slider */}
      {(banners?.length ?? 0) > 0 && (
        <div className="mx-auto max-w-6xl page-x pt-6">
          <BannerSlider banners={banners} />
        </div>
      )}

      {/* Products */}
      <div className="mx-auto max-w-6xl page-x page-y">
        <ProductGrid categories={cats} />
      </div>
    </>
  );
}
