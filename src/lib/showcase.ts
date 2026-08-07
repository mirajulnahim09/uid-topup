import { prisma } from '@/lib/prisma';
import { logger } from './logger';

/**
 * ═══════════════════════════════════════════════════════════
 * ★ SHOWCASE DATA — পণ্য-প্রদর্শনীর সৎ, অ্যাডমিন-চালিত ডেটা (Phase 4)
 *
 *   Product Showcase-এর প্রতিটি "সংগ্রহ" (collection/rail) বাস্তব
 *   ডেটা থেকে উদ্ভূত — কিছুই হার্ডকোড নয়, কোনো বানানো র‍্যাঙ্কিং নয়:
 *
 *   • জনপ্রিয় / বেস্ট-সেলার → প্রকৃত COMPLETED অর্ডার সংখ্যা
 *     (Order.variantId → Variant.productId ধরে গোনা)
 *   • বাছাই করা → Variant.isPopular (অ্যাডমিন নিজে টিক দেয়)
 *   • সীমিত অফার → oldPrice > price (স্টকে-থাকা প্যাকেজ ধরে)
 *   • নতুন → Product.createdAt (২১ দিনের মধ্যে)
 *   • সংগ্রহ (collections) → সক্রিয় Category + পণ্য-সংখ্যা
 *
 *   read-only ও নিজে-গার্ডেড: DB সমস্যা হলে খালি ফেরে (throw নয়),
 *   যাতে হোমপেজ কখনও ভাঙে না (page.tsx-এর প্যাটার্ন অনুসরণ করে)।
 * ═══════════════════════════════════════════════════════════
 */

export type ShowcaseProduct = {
  id: number;
  name: string;
  slug: string;
  image: string | null;
  description: string | null;
  categoryId: number;
  categoryName: string;
  soldOut: boolean;
  discountPct: number;
  /** স্টকে-থাকা সক্রিয় প্যাকেজের সর্বনিম্ন দাম ("শুরু" মূল্য) */
  startingPrice: number | null;
  /** অ্যাডমিন-চিহ্নিত (Variant.isPopular) — বাছাই করা প্যাকেজ */
  popular: boolean;
  /** ২১ দিনের মধ্যে যোগ হয়েছে */
  isNew: boolean;
  /** প্রকৃত সম্পন্ন অর্ডার সংখ্যা — বেস্ট-সেলার র‍্যাঙ্কিং */
  orderCount: number;
  /** দ্রুততম প্যাকেজের ডেলিভারি সময় (অ্যাডমিন-সেট) — ট্রাস্ট সূচক */
  deliveryMinutes: number | null;
};

export type ShowcaseCollection = {
  id: number;
  name: string;
  icon: string | null;
  count: number;
};

export type ShowcaseData = {
  products: ShowcaseProduct[];
  collections: ShowcaseCollection[];
  /** কোনো পণ্যে বাস্তব অর্ডার আছে কি — থাকলেই "বেস্ট-সেলার" রেল দেখানো হয় */
  hasSales: boolean;
};

const NEW_WINDOW_MS = 21 * 24 * 60 * 60 * 1000;

export async function getShowcase(): Promise<ShowcaseData> {
  try {
    /**
     * ★ পারফরম্যান্স (২০২৬-০৮-০৫ অডিট): ক্যাটাগরি-গাছ ও বিক্রির গণনা
     *   **সমান্তরালে**। এরা একে অপরের ফলাফল ব্যবহার করে না, অথচ আগে
     *   পরপর চলত — দূরবর্তী DB-তে সেটি একটি বাড়তি রাউন্ড-ট্রিপ।
     *   `groupBy` আগের মতোই নিজে-গার্ডেড: ব্যর্থ হলে খালি Map, তাই
     *   বেস্ট-সেলার রেল বাদ যায় কিন্তু বাকি শোকেস অক্ষত থাকে।
     */
    const [categories, orderByVariant] = await Promise.all([
      prisma.category.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        name: true,
        icon: true,
        products: {
          where: { isActive: true },
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            name: true,
            slug: true,
            image: true,
            description: true,
            createdAt: true,
            variants: {
              where: { isActive: true },
              select: {
                id: true,
                price: true,
                oldPrice: true,
                stock: true,
                isPopular: true,
                deliveryMinutes: true,
              },
            },
          },
        },
      },
      }),
      // ★ প্রকৃত বিক্রি — COMPLETED অর্ডার variant ধরে গোনা, তারপর
      //   variant → product ম্যাপ করে পণ্য-প্রতি যোগফল। বানানো নয়।
      prisma.order
        .groupBy({ by: ['variantId'], where: { status: 'COMPLETED' }, _count: { _all: true } })
        .then((grouped) => new Map(grouped.map((g) => [g.variantId, g._count._all])))
        // অর্ডার ডেটা না পেলে বেস্ট-সেলার রেল বাদ, বাকিটা চলবে
        .catch(() => new Map<number, number>()),
    ]);

    const now = Date.now();
    const products: ShowcaseProduct[] = [];
    const collections: ShowcaseCollection[] = [];

    for (const c of categories) {
      const activeProducts = c.products ?? [];
      if (activeProducts.length === 0) continue;
      collections.push({ id: c.id, name: c.name, icon: c.icon, count: activeProducts.length });

      for (const p of activeProducts) {
        const vs = p.variants ?? [];

        // variant না থাকলে "সব শেষ" বলা যাবে না — এটি ভিন্ন অবস্থা
        const soldOut = vs.length > 0 && vs.every((v) => v.stock === 0);

        let discountPct = 0;
        let startingPrice: number | null = null;
        let deliveryMinutes: number | null = null;
        let popular = false;
        let orderCount = 0;

        for (const v of vs) {
          const price = Number(v.price);
          if (startingPrice === null || price < startingPrice) startingPrice = price;

          // ছাড় ও ডেলিভারি — শুধু স্টকে-থাকা প্যাকেজ ধরে (শেষ হয়ে
          // যাওয়া প্যাকেজের ছাড়/সময় দেখানো বিভ্রান্তিকর)
          if (v.stock !== 0) {
            const old = v.oldPrice == null ? 0 : Number(v.oldPrice);
            if (old > price && old > 0) {
              discountPct = Math.max(discountPct, Math.round(((old - price) / old) * 100));
            }
            if (v.deliveryMinutes != null && (deliveryMinutes === null || v.deliveryMinutes < deliveryMinutes)) {
              deliveryMinutes = v.deliveryMinutes;
            }
          }

          if (v.isPopular) popular = true;
          orderCount += orderByVariant.get(v.id) ?? 0;
        }

        products.push({
          id: p.id,
          name: p.name,
          slug: p.slug,
          image: p.image,
          description: p.description,
          categoryId: c.id,
          categoryName: c.name,
          soldOut,
          discountPct,
          startingPrice,
          popular,
          isNew: now - new Date(p.createdAt).getTime() < NEW_WINDOW_MS,
          orderCount,
          deliveryMinutes,
        });
      }
    }

    const hasSales = products.some((p) => p.orderCount > 0);
    return { products, collections, hasSales };
  } catch (e) {
    logger.error('showcase', 'db unavailable', { err: e });
    return { products: [], collections: [], hasSales: false };
  }
}
