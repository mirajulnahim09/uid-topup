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
            select: {
              id: true, name: true, slug: true, image: true, description: true,
              // ★ ব্যাজের জন্য ন্যূনতম তথ্য (5.11) — গ্রাহক যেন ভেতরে
              //   ঢুকে তবেই "সব শেষ" জানতে না পারে। পুরো variant সারি
              //   আনা হয় না, কেবল তিনটি ফিল্ড (CLAUDE.md §15)।
              variants: {
                where: { isActive: true },
                select: { stock: true, price: true, oldPrice: true },
              },
            },
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
      // ★ ব্যাজ সার্ভারেই হিসাব করে ফেলা হয় (5.11) — ক্লায়েন্টে কেবল
      //   দুটি প্রিমিটিভ যায়, পুরো variant তালিকা নয় (CLAUDE.md §7)।
      products: (c.products ?? []).map((p: any) => {
        const vs: Array<{ stock: number; price: any; oldPrice: any }> = p.variants ?? [];

        // ⚠️ variant না থাকলে "সব শেষ" বলা যাবে না — সেটি ভিন্ন অবস্থা
        //   (এখনো প্যাকেজ যোগ করা হয়নি)। মিথ্যা "Sold Out" দেখানোর
        //   চেয়ে কিছু না দেখানোই ভালো।
        const soldOut = vs.length > 0 && vs.every((v) => v.stock === 0);

        // ★ সর্বোচ্চ ছাড় — শুধু স্টকে আছে এমন প্যাকেজ ধরে, কারণ
        //   শেষ হয়ে যাওয়া প্যাকেজের ছাড় দেখানো বিভ্রান্তিকর।
        let discountPct = 0;
        for (const v of vs) {
          if (v.stock === 0) continue;
          const price = Number(v.price);
          const old = v.oldPrice == null ? 0 : Number(v.oldPrice);
          if (old > price && old > 0) {
            discountPct = Math.max(discountPct, Math.round(((old - price) / old) * 100));
          }
        }

        return {
          id: p.id, name: p.name, slug: p.slug, image: p.image,
          description: p.description, soldOut, discountPct,
        };
      }),
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
