import { prisma } from '../prisma';
import { logger } from '../logger';
import { escapeLike, normalizeQuery, SEARCH_LIMIT, type SearchHit } from '../search';

/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ Group I (১) — পাবলিক স্টোরফ্রন্ট সার্চ (সার্ভার-অংশ)
 *
 *   এতদিন সার্চ কেবল অ্যাডমিন প্যানেলে ছিল। গ্রাহক হোমপেজের
 *   ক্যাটাগরি-গ্রিড স্ক্রল করা ছাড়া কিছু খুঁজে পেতেন না — ক্যাটালগ
 *   বড় হলে যা কার্যত "খুঁজে না পাওয়া"।
 *
 *   ⚠️ এটি `services/` এ, `lib/` এ নয় — কারণ এটি `prisma` ছোঁয়।
 *   ধ্রুবক ও pure ফাংশনগুলো `src/lib/search.ts` এ, যেখান থেকে
 *   ক্লায়েন্ট কম্পোনেন্টও নিরাপদে নিতে পারে (কারণটি ওখানে লেখা)।
 *
 *   ── কী **ফেরত যায় না**, ইচ্ছাকৃতভাবে ──
 *   `costPrice` (মুনাফা), নিষ্ক্রিয় প্রোডাক্ট/ভ্যারিয়েন্ট, নিষ্ক্রিয়
 *   ক্যাটাগরির কিছু, স্টক-সংখ্যা, আর কোনো ব্যবহারকারী-নির্দিষ্ট মান।
 *   এটি একটি **অননুমোদিত** endpoint — যা এখানে যোগ হবে তা পুরো
 *   ইন্টারনেট পড়তে পারবে (§2.1(৪) এর মনোভাব)।
 *
 *   ⚠️ রিসেলার দামও ফেরত যায় না। সার্চ ফলাফল সবার জন্য এক ও
 *   ক্যাশযোগ্য; ব্যক্তি-ভেদে দাম দেখানো মানে সেটি আর সবার জন্য এক
 *   নয় — আর অর্ডারের সময় দাম যেভাবেই হোক **লক করা রো** থেকেই আসে
 *   (H1), তাই এখানে দেখানো দাম কেবল সূচক।
 *
 *   ⚠️ নিজে-গার্ডেড: DB সমস্যা হলে খালি ফল ফেরে, throw নয় — একটি
 *   সার্চ ব্যর্থতা যেন পুরো পাতা ৫০০ না করে।
 * ═══════════════════════════════════════════════════════════
 */
export async function searchProducts(raw: string | null | undefined): Promise<SearchHit[]> {
  const q = normalizeQuery(raw);
  if (!q) return [];

  // ★ যা DB-তে যাবে তা escaped; যা ব্যবহারকারী দেখবেন তা তাঁর নিজের লেখা
  const like = escapeLike(q);

  try {
    const products = await prisma.product.findMany({
      where: {
        isActive: true,
        // ★ ক্যাটাগরি বন্ধ থাকলে তার প্রোডাক্ট হোমপেজেও দেখায় না —
        //   সার্চে দেখালে সেটি একটি লুকানো দরজা হয়ে যেত
        category: { isActive: true },
        OR: [
          { name: { contains: like, mode: 'insensitive' } },
          { description: { contains: like, mode: 'insensitive' } },
          { category: { name: { contains: like, mode: 'insensitive' } } },
        ],
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      take: SEARCH_LIMIT,
      select: {
        id: true,
        name: true,
        slug: true,
        image: true,
        category: { select: { name: true } },
        // ⚠️ কেবল `price` — `costPrice`/`resellerPrice`/`stock` নয়
        variants: {
          where: { isActive: true },
          select: { price: true },
        },
      },
    });

    if (!Array.isArray(products)) return [];

    return products.map((p: (typeof products)[number]) => {
      const prices = p.variants.map((v: { price: unknown }) => Number(v.price)).filter(Number.isFinite);
      return {
        productId: p.id,
        name: p.name,
        slug: p.slug,
        image: p.image,
        categoryName: p.category.name,
        fromPrice: prices.length ? Math.min(...prices) : null,
        variantCount: p.variants.length,
      };
    });
  } catch (e) {
    logger.error('search', 'query failed', { err: e });
    return [];
  }
}
