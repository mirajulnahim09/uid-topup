import { prisma } from './prisma';
import { logger } from './logger';

/**
 * ═══════════════════════════════════════════════════════════
 * ★ লাইভ অ্যাক্টিভিটি — সাম্প্রতিক প্রকৃত ডেলিভারি (Option A infra)
 *
 *   প্রতিযোগী rrrtopup এর সবচেয়ে শক্তিশালী কনভার্শন-উপাদান হলো
 *   "Latest Orders" ফিড — কিন্তু সেটি **প্রকৃত** অর্ডার থেকে, বানানো
 *   নয়। এই সাইটে আমাদের কাছে প্রকৃত অর্ডার আছে, তাই সৎভাবে সেটাই
 *   দেখানো যায়।
 *
 *   ⚠️ গোপনীয়তা: শুধু গ্রাহকের **প্রথম নাম** যায়, তা-ও আংশিক মুখোশ
 *   পরানো (যেমন "Sordar" → "Sord•••")। কোনো ইমেইল, ফোন, UID, বা
 *   পূর্ণ নাম নয়। পরিমাণ দেখানো হয় না ডিফল্টে (স্পর্শকাতর) — কেবল
 *   কী কেনা হয়েছে ও কখন। এটি সামাজিক-প্রমাণ, নজরদারি নয়।
 *
 *   ⚠️ শুধুমাত্র COMPLETED অর্ডার — "কেউ এইমাত্র পেয়েছে" সেটাই আস্থা
 *   বাড়ায়; PENDING দেখানো উল্টো দুশ্চিন্তা তৈরি করত।
 *
 *   ⚠️ read-only; কোনো লেখা নয়। DB সমস্যা হলে খালি অ্যারে (throw নয়)।
 * ═══════════════════════════════════════════════════════════
 */

export type Delivery = {
  id: string;
  name: string;        // মুখোশ-পরানো প্রথম নাম
  productName: string;
  variantName: string;
  at: string;          // ISO — ক্লায়েন্টে "৩ মিনিট আগে" তে রূপ নেয়
};

/** প্রথম নাম নিয়ে আংশিক মুখোশ — "Abdullah Rahman" → "Abdu•••" */
function maskName(full: string | null | undefined): string {
  const first = (full || '').trim().split(/\s+/)[0] || 'গ্রাহক';
  if (first.length <= 3) return first + '•••';
  return first.slice(0, 4) + '•••';
}

export async function getRecentDeliveries(limit = 8): Promise<Delivery[]> {
  const take = Math.min(Math.max(1, limit), 20);
  try {
    const rows = await prisma.order.findMany({
      where: { status: 'COMPLETED', completedAt: { not: null } },
      orderBy: { completedAt: 'desc' },
      take,
      select: {
        id: true,
        productName: true,
        variantName: true,
        completedAt: true,
        // ★ শুধু নাম — পুরো User সারি নয় (CLAUDE.md §8: select, include নয়)
        user: { select: { name: true } },
      },
    });

    return rows.map((r) => ({
      id: r.id,
      name: maskName(r.user?.name),
      productName: r.productName,
      variantName: r.variantName,
      at: (r.completedAt as Date).toISOString(),
    }));
  } catch (e) {
    logger.error('liveActivity', 'read failed', { err: e });
    return [];
  }
}
