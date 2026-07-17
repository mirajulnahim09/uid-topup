import { prisma } from '@/lib/prisma';
import { adminOrderActionSchema } from '@/lib/validation';
import { requireAdmin, apiError, ApiError } from '@/lib/guard';
import { emailOrderCompleted, emailOrderRefunded } from '@/lib/email';
import { notify } from '@/lib/notify';
import { cleanText } from '@/lib/sanitize';
import { adminLog } from '@/lib/adminLog';
import { getIp } from '@/lib/rateLimit';

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();

    const parsed = adminOrderActionSchema.safeParse(await req.json());
    if (!parsed.success) throw new ApiError(parsed.error.errors[0].message, 400);

    const { orderId, action } = parsed.data;
    const adminNote = parsed.data.adminNote ? cleanText(parsed.data.adminNote, 300) : undefined;
    const playerName = parsed.data.playerName ? cleanText(parsed.data.playerName, 80) : undefined;
    const internalNote = parsed.data.internalNote ? cleanText(parsed.data.internalNote, 500) : undefined;

    const out = await prisma.$transaction(
      async (tx) => {
        // ★★★ ROW LOCK — লক ছাড়া ৫ বার FAIL চাপলে ৫ বারই refund হয়ে যেত।
        //     ৫টা transaction একসাথে status='PENDING' দেখত, সবাই পাস করত,
        //     ৫ বার টাকা ফেরত যেত। FOR UPDATE দিলে একজনের পর আরেকজন।
        const locked = await tx.$queryRaw<
          Array<{ id: string; status: string }>
        >`SELECT id, status FROM "Order" WHERE id = ${orderId} FOR UPDATE`;

        if (!locked[0]) throw new ApiError('অর্ডার পাওয়া যায়নি', 404);

        // ★ লক করা রো থেকে status — এটাই আসল
        const liveStatus = locked[0].status;
        if (liveStatus !== 'PENDING' && liveStatus !== 'PROCESSING') {
          throw new ApiError('এই অর্ডার আর পরিবর্তন করা যাবে না', 409);
        }

        const order = await tx.order.findUnique({
          where: { id: orderId },
          include: { user: { select: { id: true, name: true, email: true } } },
        });
        if (!order) throw new ApiError('অর্ডার পাওয়া যায়নি', 404);

        if (action === 'PROCESSING') {
          await tx.order.update({
            where: { id: orderId },
            data: { status: 'PROCESSING', playerName, adminNote, internalNote },
          });
          return { kind: 'PROCESSING' as const, order, reason: '' };
        }

        if (action === 'COMPLETE') {
          await tx.order.update({
            where: { id: orderId },
            data: {
              status: 'COMPLETED',
              playerName,
              adminNote,
              internalNote,
              completedAt: new Date(),
            },
          });
          return { kind: 'COMPLETE' as const, order, reason: '' };
        }

        // ── FAIL → auto refund ──
        const updatedUser = await tx.user.update({
          where: { id: order.userId },
          data: { balance: { increment: order.price } },
        });

        // স্টক ফেরত
        const variant = await tx.variant.findUnique({ where: { id: order.variantId } });
        if (variant && variant.stock >= 0) {
          await tx.variant.update({
            where: { id: variant.id },
            data: { stock: { increment: 1 } },
          });
        }

        // ★ কুপন ফেরত — বাতিল হলে কুপন আবার ব্যবহারযোগ্য
        if (order.couponId) {
          await tx.coupon.update({
            where: { id: order.couponId },
            data: { usageCount: { decrement: 1 } },
          });
          await tx.couponUse.deleteMany({ where: { orderId: order.id } });
        }

        const reason = adminNote || 'অর্ডার সম্পন্ন করা যায়নি — টাকা ফেরত দেওয়া হয়েছে';

        await tx.order.update({
          where: { id: orderId },
          data: { status: 'REFUNDED', adminNote: reason, completedAt: new Date() },
        });

        await tx.ledgerEntry.create({
          data: {
            userId: order.userId,
            type: 'REFUND',
            amount: order.price,
            balanceAfter: updatedUser.balance,
            refId: order.id,
            note: `অর্ডার #${order.orderNo} বাতিল — রিফান্ড`,
          },
        });

        return { kind: 'REFUND' as const, order, reason };
      },
      { timeout: 15000 }
    );

    const o = out.order;

    // ★ অডিট লগ
    adminLog({
      adminId: admin.id,
      adminName: admin.name,
      action:
        out.kind === 'COMPLETE' ? 'ORDER_COMPLETE'
        : out.kind === 'REFUND' ? 'ORDER_REFUND'
        : 'ORDER_PROCESSING',
      targetId: orderId,
      amount: Number(o.price),
      detail: `#${o.orderNo} — ${o.productName} / ${o.variantName} / UID ${o.playerUid}`,
      ip: getIp(req),
    }).catch(() => {});

    if (out.kind === 'COMPLETE') {
      await notify(
        o.user.id,
        `অর্ডার #${o.orderNo} সম্পন্ন 🎉`,
        `${o.productName} — ${o.variantName} ডেলিভারি হয়েছে।`,
        '/account/orders'
      );
      emailOrderCompleted(
        o.user.email, o.user.name, o.orderNo, o.productName, o.variantName
      ).catch(() => {});
    } else if (out.kind === 'REFUND') {
      const amt = Number(o.price).toFixed(2);
      await notify(
        o.user.id,
        `অর্ডার #${o.orderNo} বাতিল — ৳${amt} ফেরত`,
        out.reason,
        '/account'
      );
      emailOrderRefunded(o.user.email, o.user.name, o.orderNo, amt, out.reason).catch(() => {});
    } else {
      await notify(
        o.user.id,
        `অর্ডার #${o.orderNo} প্রসেসিং ⏳`,
        'আপনার অর্ডার প্রসেস করা হচ্ছে।',
        '/account/orders'
      );
    }

    return Response.json({ success: true });
  } catch (e) {
    return apiError(e);
  }
}
