import { prisma } from '@/lib/prisma';
import { deliveryConfirmSchema } from '@/lib/validation';
import { requireUser, apiError, ApiError } from '@/lib/guard';
import { recordOrderEvent } from '@/lib/orderEvents';
import { notifyAdmins } from '@/lib/notify';

export const dynamic = 'force-dynamic';

/**
 * ═══════════════════════════════════════════════════════════
 * ★ "জিনিসটা কি পৌঁছেছে?" — গ্রাহকের নিশ্চিতকরণ
 *
 *   কেন এই একটি প্রশ্নই এত গুরুত্বপূর্ণ (MANUAL_WORKFLOW.md A8):
 *
 *   ১. অ্যাডমিন "সম্পন্ন" চাপলেই ডেলিভারি হয়েছে — এটা **অনুমান**।
 *      ভুল UID, গেম সার্ভারের সমস্যা, বা অ্যাডমিনের ভুল — কোনোটাই
 *      অ্যাডমিন নিজে দেখতে পায় না। গ্রাহকই একমাত্র সাক্ষী।
 *
 *   ২. "পাইনি" উত্তর সেই ব্যর্থতা ধরে ফেলে **অভিযোগ আসার আগেই**।
 *
 *   ৩. "পেয়েছি" উত্তরের মুহূর্তটাই রিভিউ চাওয়ার একমাত্র ভালো সময় —
 *      সন্তুষ্টি তখন সর্বোচ্চ।
 * ═══════════════════════════════════════════════════════════
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();

    const parsed = deliveryConfirmSchema.safeParse(await req.json());
    if (!parsed.success) throw new ApiError(parsed.error.errors[0].message, 400);
    const { orderId, arrived } = parsed.data;

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true, orderNo: true, userId: true, status: true,
        productName: true, variantName: true, playerUid: true,
        deliveryConfirmedAt: true, deliveryDisputedAt: true,
      },
    });

    // ★ শুধু নিজের অর্ডার — অন্যের ID দিলে অস্তিত্বই স্বীকার করি না
    if (!order || order.userId !== user.id) {
      throw new ApiError('অর্ডার পাওয়া যায়নি', 404);
    }
    if (order.status !== 'COMPLETED') {
      throw new ApiError('এই অর্ডারটি এখনো সম্পন্ন হয়নি', 400);
    }
    if (order.deliveryConfirmedAt || order.deliveryDisputedAt) {
      throw new ApiError('আপনি ইতিমধ্যে উত্তর দিয়েছেন', 409);
    }

    const now = new Date();

    await prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: order.id },
        data: arrived ? { deliveryConfirmedAt: now } : { deliveryDisputedAt: now },
      });

      await recordOrderEvent(tx, {
        orderId: order.id,
        status: 'COMPLETED',
        note: arrived
          ? 'গ্রাহক নিশ্চিত করেছেন — ডেলিভারি পেয়েছেন'
          : 'গ্রাহক জানিয়েছেন ডেলিভারি পাননি — যাচাই দরকার',
        actorType: 'CUSTOMER',
        actorId: user.id,
      });
    });

    // ★ না পেলে অ্যাডমিনকে সাথে সাথে জানানো — এটাই সেই সংকেত
    //   যা নাহলে ফেসবুকে অভিযোগ হয়ে আসত
    if (!arrived) {
      notifyAdmins(
        '⚠️ ডেলিভারি পাননি বলে জানিয়েছেন',
        `${user.name} — অর্ডার #${order.orderNo} (${order.productName} / ${order.variantName}, UID ${order.playerUid})। যাচাই করুন।`,
        '/admin/orders'
      ).catch(() => {});
    }

    return Response.json({
      success: true,
      arrived,
      message: arrived
        ? 'ধন্যবাদ! জানানোর জন্য কৃতজ্ঞ।'
        : 'জানানোর জন্য ধন্যবাদ — আমরা এখনই দেখছি।',
    });
  } catch (e) {
    return apiError(e);
  }
}
