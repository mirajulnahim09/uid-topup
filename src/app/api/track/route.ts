import { prisma } from '@/lib/prisma';
import { apiError, ApiError, readJson } from '@/lib/guard';
import { rateLimit, LIMITS, getIp } from '@/lib/rateLimit';
import { trackLookupSchema } from '@/lib/validation';
import { maskUid, contactMatches } from '@/lib/tracking';
import { slaFromSettings, slaExplanationForOrder } from '@/lib/sla';
import { getSettings } from '@/lib/settings';

export const dynamic = 'force-dynamic';

/**
 * ★ POST /api/track — লগইন ছাড়া অর্ডারের অবস্থা।
 *
 *   দুটি পথ: গোপন টোকেন, বা অর্ডার নাম্বার + ফোন/ইমেইল।
 *
 *   ⚠️ নিরাপত্তার তিনটি সিদ্ধান্ত:
 *   ১. IP-ভিত্তিক rate limit — brute-force ঠেকাতে (অননুমোদিত
 *      endpoint, তাই ইউজার-ভিত্তিক সীমা সম্ভব নয়)।
 *   ২. একটিই সাধারণ ত্রুটি বার্তা — "অর্ডার নেই" আর "ফোন মেলেনি"
 *      আলাদা করে বললে আক্রমণকারী জানতে পারত কোন অর্ডার নাম্বার
 *      আসল, অর্ধেক কাজ এগিয়ে যেত।
 *   ৩. সীমিত তথ্য — সম্পূর্ণ UID, প্রেরকের নাম্বার, ইমেইল বা
 *      ব্যালেন্স কখনো ফেরত যায় না।
 */
export async function POST(req: Request) {
  try {
    const ip = getIp(req);
    const rl = await rateLimit(`track:${ip}`, LIMITS.track.limit, LIMITS.track.window);
    if (!rl.ok) {
      throw new ApiError(
        `অনেক বেশি চেষ্টা হয়েছে। ${rl.retryAfter} সেকেন্ড পর আবার চেষ্টা করুন।`,
        429
      );
    }

    const parsed = trackLookupSchema.safeParse(await readJson(req));
    if (!parsed.success) throw new ApiError(parsed.error.errors[0].message, 400);

    // ★ একটিই বার্তা — কোনটা ভুল তা জানানো হয় না
    const NOT_FOUND = 'এই তথ্য দিয়ে কোনো অর্ডার পাওয়া যায়নি। অর্ডার নাম্বার ও ফোন/ইমেইল মিলিয়ে দেখুন।';

    const order = parsed.data.token
      ? await prisma.order.findUnique({
          where: { trackToken: parsed.data.token },
          include: {
            user: { select: { phone: true, email: true } },
            events: { orderBy: { createdAt: 'asc' }, select: { status: true, note: true, createdAt: true } },
          },
        })
      : await prisma.order.findUnique({
          where: { orderNo: parsed.data.orderNo! },
          include: {
            user: { select: { phone: true, email: true } },
            events: { orderBy: { createdAt: 'asc' }, select: { status: true, note: true, createdAt: true } },
          },
        });

    if (!order) throw new ApiError(NOT_FOUND, 404);

    // ★ অর্ডার নাম্বার পথে দ্বিতীয় প্রমাণ বাধ্যতামূলক
    if (!parsed.data.token) {
      if (!contactMatches(parsed.data.contact ?? '', order.user)) {
        throw new ApiError(NOT_FOUND, 404);
      }
    }

    const settings = await getSettings();
    const sla = slaFromSettings(settings);

    return Response.json({
      success: true,
      order: {
        orderNo: order.orderNo,
        productName: order.productName,
        variantName: order.variantName,
        // ★ সম্পূর্ণ UID নয় — শুধু চেনার মতো অংশ
        playerUidMasked: maskUid(order.playerUid),
        price: Number(order.price).toFixed(2),
        status: order.status,
        adminNote: order.adminNote,
        createdAt: order.createdAt.toISOString(),
        completedAt: order.completedAt?.toISOString() ?? null,
        slaDueAt: order.slaDueAt?.toISOString() ?? null,
        slaText: slaExplanationForOrder(sla, order.createdAt, order.slaDueAt),
        events: order.events.map((e) => ({
          status: e.status,
          note: e.note,
          at: e.createdAt.toISOString(),
        })),
      },
    });
  } catch (e) {
    return apiError(e);
  }
}
