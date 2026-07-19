import { prisma } from './prisma';
import { formatDuration } from './sla';

/**
 * ═══════════════════════════════════════════════════════════
 * ★ আস্থার পরিসংখ্যান — শুধুমাত্র বাস্তব তথ্য থেকে
 *
 *   কেন এটা বদলানো হলো:
 *   হোমপেজে লেখা ছিল "৫২,০০০+ Orders", "৯৯% Satisfaction",
 *   "১০ Sec Delivery" — কোনোটাই সত্য নয়, কোনোটাই যাচাইযোগ্য নয়।
 *
 *   যে বাজারে মানুষ নিয়মিত প্রতারিত হয়, সেখানে গোল-গোল
 *   অযাচাইযোগ্য সংখ্যা উল্টো সন্দেহ বাড়ায় — প্রতিযোগী বিশ্লেষণে
 *   দেখা গেছে যেসব দাবি কাজ করে সেগুলো নির্দিষ্ট ও যাচাইযোগ্য
 *   ("৪৭১টি রিভিউ", "৪.৮৮", "২০ মিনিট")।
 *
 *   ★★★ মূল নীতি: সৎ সংখ্যা, নয়তো কিছুই নয়।
 *   নতুন সাইটে অর্ডার কম — তখন "৩টি অর্ডার" দেখানো দুর্বল, আর
 *   বানানো সংখ্যা দেখানো প্রতারণা। তাই যথেষ্ট তথ্য না জমা পর্যন্ত
 *   ঐ পরিসংখ্যান **দেখানোই হয় না**। বদলে যা সত্যিই সত্য
 *   (সাপোর্টের সময়, পেমেন্ট মাধ্যম) সেটাই দেখানো হয়।
 * ═══════════════════════════════════════════════════════════
 */

/** এর নিচে হলে সংখ্যাটি অর্থবহ নয় — দেখানো হবে না */
const MIN_ORDERS_TO_SHOW_COUNT = 50;
const MIN_ORDERS_TO_SHOW_DELIVERY = 10;
const MIN_ORDERS_TO_SHOW_RATE = 20;
/** ★ কম রিভিউয়ে গড় অর্থহীন — ২টি রিভিউতে "৫.০" কেউ বিশ্বাস করে না */
const MIN_REVIEWS_TO_SHOW_RATING = 10;

/** ক্যাশ কতক্ষণ — প্রতি রিকোয়েস্টে ভারী query চালানো যাবে না */
const CACHE_TTL_MS = 10 * 60 * 1000; // ১০ মিনিট

export type TrustStat = { value: string; label: string };

const CACHE_KEY = 'homepage_stats_v1';

/** বাংলা সংখ্যায় রূপান্তর — বাকি সাইটের সাথে মিল রাখতে */
function toBn(n: number | string): string {
  const bn = '০১২৩৪৫৬৭৮৯';
  return String(n).replace(/\d/g, (d) => bn[Number(d)]);
}

/** ★ প্রকৃত ডেটা থেকে হিসাব — খরচসাপেক্ষ, তাই ক্যাশ করা হয় */
async function computeStats(supportHours: string | undefined): Promise<TrustStat[]> {
  const stats: TrustStat[] = [];

  const [completed, refunded, failed] = await Promise.all([
    prisma.order.count({ where: { status: 'COMPLETED' } }),
    prisma.order.count({ where: { status: 'REFUNDED' } }),
    prisma.order.count({ where: { status: 'FAILED' } }),
  ]);

  // ── ১. সম্পন্ন অর্ডার — যথেষ্ট হলে তবেই ──
  if (completed >= MIN_ORDERS_TO_SHOW_COUNT) {
    // নিচের দিকে রাউন্ড — কখনো বাড়িয়ে বলা নয়
    const rounded = Math.floor(completed / 100) * 100;
    stats.push({
      value: rounded >= 100 ? `${toBn(rounded)}+` : toBn(completed),
      label: 'সম্পন্ন অর্ডার',
    });
  }

  // ── ২. প্রকৃত গড় ডেলিভারি সময় ──
  if (completed >= MIN_ORDERS_TO_SHOW_DELIVERY) {
    const rows = await prisma.order.findMany({
      where: { status: 'COMPLETED', completedAt: { not: null } },
      select: { createdAt: true, completedAt: true },
      orderBy: { completedAt: 'desc' },
      take: 200, // সাম্প্রতিক কর্মক্ষমতা, চিরকালের গড় নয়
    });
    const mins = rows
      .map((r) => (r.completedAt!.getTime() - r.createdAt.getTime()) / 60000)
      .filter((m) => m >= 0 && Number.isFinite(m))
      .sort((a, b) => a - b);

    if (mins.length > 0) {
      // ★ মধ্যক (median), গড় নয় — একটি অস্বাভাবিক দেরি
      //   পুরো সংখ্যাটাকে বিকৃত করতে পারে
      const median = mins[Math.floor(mins.length / 2)];
      // ★ বাংলা অঙ্কে — এই সারির বাকি সংখ্যাগুলোর সাথে মিল রাখতে
      stats.push({ value: toBn(formatDuration(median)), label: 'সাধারণ ডেলিভারি' });
    }
  }

  // ── ৩. সফলতার হার ──
  const totalFinal = completed + refunded + failed;
  if (totalFinal >= MIN_ORDERS_TO_SHOW_RATE) {
    const rate = Math.floor((completed / totalFinal) * 100);
    stats.push({ value: `${toBn(rate)}%`, label: 'সফল ডেলিভারি' });
  }

  // ── ৪. প্রকৃত গড় রেটিং — যাচাইযোগ্য কেনাকাটার রিভিউ থেকে ──
  //    প্রতিযোগীদের মধ্যে সবচেয়ে শক্তিশালী আস্থা-সংকেত এটিই
  //    ("৪.৮৮ — ৪৭১টি রিভিউ")। সংখ্যাটি রিভিউ-সংখ্যাসহ দেখানো হয়,
  //    কারণ গড় একা বিভ্রান্তিকর (২টি রিভিউতে ৫.০ অর্থহীন)।
  const agg = await prisma.review.aggregate({
    where: { isPublished: true },
    _avg: { rating: true },
    _count: true,
  });
  if (agg._count >= MIN_REVIEWS_TO_SHOW_RATING && agg._avg.rating) {
    const avg = Math.round(agg._avg.rating * 10) / 10;
    stats.push({
      value: toBn(avg.toFixed(1)),
      label: `${toBn(agg._count)} রিভিউয়ের গড়`,
    });
  }

  // ── ৪. সাপোর্টের সময় — সবসময় সত্য, সেটিংস থেকে ──
  //    "২৪/৭" দাবি করা হয় না; বাস্তব সময়ই দেখানো হয়
  if (supportHours?.trim()) {
    stats.push({ value: supportHours.trim(), label: 'সাপোর্ট' });
  }

  return stats;
}

/**
 * ★ হোমপেজের জন্য পরিসংখ্যান — ক্যাশসহ, কখনো throw করে না।
 *   DB সমস্যা হলে খালি অ্যারে — হোমপেজ তখন পরিসংখ্যান ছাড়াই
 *   দেখাবে, ভুল সংখ্যা নয়।
 */
export async function getTrustStats(
  supportHours?: string
): Promise<TrustStat[]> {
  try {
    const cached = await prisma.trustMetric.findUnique({ where: { key: CACHE_KEY } });
    if (cached && Date.now() - cached.computedAt.getTime() < CACHE_TTL_MS) {
      return JSON.parse(cached.value) as TrustStat[];
    }

    const stats = await computeStats(supportHours);

    await prisma.trustMetric.upsert({
      where: { key: CACHE_KEY },
      update: { value: JSON.stringify(stats), computedAt: new Date() },
      create: { key: CACHE_KEY, value: JSON.stringify(stats) },
    });

    return stats;
  } catch (e) {
    console.error('[trustMetrics] compute failed:', e);
    return []; // ভুল সংখ্যা দেখানোর চেয়ে কিছু না দেখানো ভালো
  }
}
