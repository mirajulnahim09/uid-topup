import { orderSchema } from '@/lib/validation';
import { requireUser, apiError, ApiError, readJson } from '@/lib/guard';
import { rateLimit, LIMITS } from '@/lib/rateLimit';
import { notifyAdmins } from '@/lib/notify';
import { cleanText } from '@/lib/sanitize';
import { getSettings } from '@/lib/settings';
import { computeSlaDueAt, slaFromSettings } from '@/lib/sla';
import { placeOrder, afterOrderPlaced } from '@/lib/services/order';
import { requestMeta } from '@/lib/adminLog';

/**
 * ═══════════════════════════════════════════════════════════
 * ★ ওয়েব অর্ডার — গ্রাহকের ব্রাউজার থেকে, একটি করে।
 *
 *   ⚠️ টাকার যুক্তি এখানে **নেই**। লক-ক্রম, রিসেলার দাম, কুপন,
 *   খতিয়ান — সবকিছু `src/lib/services/order.ts` এ (Group F ৩)।
 *   কারণ রিসেলারের bulk endpoint-এরও হুবহু একই যুক্তি দরকার, আর
 *   টাকার যুক্তির দুটি অনুলিপি মানে একদিন দুটি ভিন্ন আচরণ।
 *
 *   এই ফাইলের কাজ কেবল HTTP-র: অথ, রেট-লিমিট, পার্সিং, উত্তর।
 * ═══════════════════════════════════════════════════════════
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();

    const rl = await rateLimit(`order:${user.id}`, LIMITS.order.limit, LIMITS.order.window);
    if (!rl.ok) {
      throw new ApiError(
        `অনেক বেশি অর্ডার হয়ে গেছে। ${rl.retryAfter} সেকেন্ড পর চেষ্টা করুন।`,
        429
      );
    }

    const parsed = orderSchema.safeParse(await readJson(req));
    if (!parsed.success) throw new ApiError(parsed.error.errors[0].message, 400);

    const { variantId, playerUid, couponCode } = parsed.data;
    const playerName = parsed.data.playerName
      ? cleanText(parsed.data.playerName, 80)
      : null;

    // ★ ডেলিভারির ডেডলাইন — transaction এর বাইরে হিসাব করা হয়
    //   (সেটিংস পড়া, লক লাগে না) কিন্তু অর্ডারে সংরক্ষিত হয়
    const slaDueAt = computeSlaDueAt(slaFromSettings(await getSettings()));

    const result = await placeOrder({
      userId: user.id,
      variantId,
      playerUid,
      playerName,
      couponCode,
      slaDueAt,
      // ★ ওয়েবে idempotency key নেই — ব্যবহারকারী নিজের চোখে ফল দেখেন
      //   এবং UI দ্বিতীয় ক্লিক আটকায়। এটি API চ্যানেলের ব্যাপার।
      clientRef: null,
    });

    // ── Transaction এর বাইরে: notify + email (fail করলেও অর্ডার সফল) ──
    await afterOrderPlaced(result, {
      channel: 'WEB',
      user,
      playerUid,
      ...requestMeta(req),
    });

    notifyAdmins(
      'নতুন অর্ডার',
      `${user.name} — #${result.orderNo} ${result.productName} (৳${result.price.toFixed(2)})`,
      '/admin/orders',
      'order_new'
    ).catch(() => {});

    return Response.json({
      success: true,
      // ★ রসিদ পেজে নিয়ে যেতে orderId দরকার (2.11)
      orderId: result.orderId,
      orderNo: result.orderNo,
      balance: result.newBalance.toFixed(2),
      message: `অর্ডার #${result.orderNo} গ্রহণ করা হয়েছে। শীঘ্রই প্রসেস করা হবে।`,
    });
  } catch (e) {
    return apiError(e);
  }
}
