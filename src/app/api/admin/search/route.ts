import { prisma } from '@/lib/prisma';
import { requireAdmin, apiError, ApiError, readJson } from '@/lib/guard';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const schema = z.object({
  // ★ এক অক্ষরও চলবে — যদি সেটি সংখ্যা হয়।
  //   কারণ নতুন সাইটে অর্ডার/ডিপোজিট নাম্বার এক অঙ্কেরই হয় ("৫"),
  //   আর সেটাই সাপোর্টে সবচেয়ে বেশি জিজ্ঞেস করা হয়।
  //   টেক্সটে ন্যূনতম ২ — নাহলে "a" দিয়ে পুরো ডাটাবেস স্ক্যান হতো।
  q: z
    .string().trim().min(1, 'কিছু লিখুন').max(80)
    .refine((v) => v.length >= 2 || /^\d$/.test(v), 'অন্তত ২ অক্ষর লিখুন (বা একটি সংখ্যা)'),
});

/**
 * ═══════════════════════════════════════════════════════════
 * ★ একটিই সার্চ বাক্স — সব কিছু (3.2)
 *
 *   কেন (MANUAL_WORKFLOW.md B3):
 *   বাস্তবে অ্যাডমিনের প্রশ্নটা আসে গ্রাহকের মেসেজ হিসেবে —
 *   "টাকা পাঠিয়েছি, TrxID 9A7B2C4D1E, কোথায়?"
 *   অ্যাডমিনের দরকার সেই স্ট্রিংটা **একটি বাক্সে পেস্ট করে**
 *   উত্তর পাওয়া — কোন ট্যাবে খুঁজবে তা ভাবা নয়।
 *
 *   তাই এক প্রশ্নেই খোঁজা হয়:
 *     অর্ডার নাম্বার · ডিপোজিট নাম্বার · TrxID · ফোন · ইমেইল ·
 *     Player UID · গ্রাহকের নাম
 *
 *   ⚠️ requireAdmin() — এটি সব গ্রাহকের তথ্য দেখায়, তাই
 *      অ্যাডমিন ছাড়া কেউ ছুঁতে পারবে না।
 * ═══════════════════════════════════════════════════════════
 */
export async function POST(req: Request) {
  try {
    await requireAdmin();

    const parsed = schema.safeParse(await readJson(req));
    if (!parsed.success) throw new ApiError(parsed.error.errors[0].message, 400);

    const q = parsed.data.q;
    const digits = q.replace(/\D/g, '');
    /**
     * ★★★ অর্ডার/ডিপোজিট নম্বর Postgres `INT` (সর্বোচ্চ ২,১৪৭,৪৮৩,৬৪৭)।
     *
     *   ⚠️ মাপা (সিমুলেশন, ২০২৬-০৯-২৫): Free Fire UID ৯–১২ অঙ্কের, অনেকগুলোই
     *   এই সীমার উপরে (যেমন `4149987572`)। সংখ্যাটি `orderNo`-তেও বসানো হতো →
     *   Prisma "INT-এ ধরে না" ত্রুটি → পুরো সার্চ ৪০০ "অনুরোধের ডেটা সঠিক নয়"।
     *   ফলে সাপোর্টের সবচেয়ে সাধারণ প্রশ্ন — "আমার UID এটা" — দিয়ে খোঁজাই যেত না।
     *   সীমার বাইরে হলে সংখ্যাটি কেবল UID/TrxID/ফোন হিসেবে খোঁজা হয়।
     */
    const asNumber = /^\d+$/.test(q) && Number(q) <= 2_147_483_647 ? Number(q) : null;
    const upper = q.toUpperCase();

    // ★ সব খোঁজা সমান্তরালে — একটির জন্য আরেকটি অপেক্ষা করবে না
    const [orders, deposits, users] = await Promise.all([
      prisma.order.findMany({
        where: {
          OR: [
            ...(asNumber !== null ? [{ orderNo: asNumber }] : []),
            { playerUid: { contains: q, mode: 'insensitive' as const } },
            { productName: { contains: q, mode: 'insensitive' as const } },
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true, orderNo: true, status: true, price: true, playerUid: true,
          productName: true, variantName: true, createdAt: true,
          user: { select: { id: true, name: true } },
        },
      }),

      prisma.deposit.findMany({
        where: {
          OR: [
            ...(asNumber !== null ? [{ depositNo: asNumber }] : []),
            { trxId: { contains: upper } },
            ...(digits.length >= 6 ? [{ senderNo: { contains: digits } }] : []),
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true, depositNo: true, status: true, amount: true, trxId: true,
          method: true, senderNo: true, createdAt: true,
          user: { select: { id: true, name: true } },
        },
      }),

      prisma.user.findMany({
        where: {
          OR: [
            { name: { contains: q, mode: 'insensitive' as const } },
            { email: { contains: q, mode: 'insensitive' as const } },
            ...(digits.length >= 6 ? [{ phone: { contains: digits } }] : []),
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
        // ★ password কখনো select করা হয় না (CLAUDE.md §8)
        select: {
          id: true, name: true, email: true, phone: true, balance: true,
          isBanned: true, status: true,
          _count: { select: { orders: true, deposits: true } },
        },
      }),
    ]);

    return Response.json({
      orders: orders.map((o) => ({
        id: o.id, orderNo: o.orderNo, status: o.status,
        price: Number(o.price), playerUid: o.playerUid,
        productName: o.productName, variantName: o.variantName,
        createdAt: o.createdAt.toISOString(),
        userId: o.user.id, userName: o.user.name,
      })),
      deposits: deposits.map((d) => ({
        id: d.id, depositNo: d.depositNo, status: d.status,
        amount: Number(d.amount), trxId: d.trxId, method: d.method,
        senderNo: d.senderNo, createdAt: d.createdAt.toISOString(),
        userId: d.user.id, userName: d.user.name,
      })),
      users: users.map((u) => ({
        id: u.id, name: u.name, email: u.email, phone: u.phone,
        balance: Number(u.balance), isBanned: u.isBanned, status: u.status,
        orderCount: u._count.orders, depositCount: u._count.deposits,
      })),
    });
  } catch (e) {
    return apiError(e);
  }
}
