import { prisma } from '@/lib/prisma';
import { adminOrderActionSchema } from '@/lib/validation';
import { requireAdmin, apiError, ApiError } from '@/lib/guard';
import { emailOrderCompleted, emailOrderRefunded } from '@/lib/email';
import { notify } from '@/lib/notify';
import { cleanText } from '@/lib/sanitize';
import { adminLog } from '@/lib/adminLog';
import { getIp } from '@/lib/rateLimit';
import { recordOrderEvent } from '@/lib/orderEvents';
import { ORDER_FAIL_COPY, buildRejectionMessage } from '@/lib/rejectReasons';
import { claimState, isBlockedByOther, claimBlockMessage } from '@/lib/orderClaim';
import { applyOrderStatus } from '@/lib/fulfilment';
import { creditWallet } from '@/lib/services/wallet';

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();

    const parsed = adminOrderActionSchema.safeParse(await req.json());
    if (!parsed.success) throw new ApiError(parsed.error.errors[0].message, 400);

    const { orderId, action, failReason, takeover } = parsed.data;
    const adminNote = parsed.data.adminNote ? cleanText(parsed.data.adminNote, 300) : undefined;
    const playerName = parsed.data.playerName ? cleanText(parsed.data.playerName, 80) : undefined;
    const internalNote = parsed.data.internalNote ? cleanText(parsed.data.internalNote, 500) : undefined;

    const out = await prisma.$transaction(
      async (tx) => {
        // ★★★ ROW LOCK — লক ছাড়া ৫ বার FAIL চাপলে ৫ বারই refund হয়ে যেত।
        //     ৫টা transaction একসাথে status='PENDING' দেখত, সবাই পাস করত,
        //     ৫ বার টাকা ফেরত যেত। FOR UPDATE দিলে একজনের পর আরেকজন।
        const locked = await tx.$queryRaw<
          Array<{
            id: string;
            status: string;
            claimedById: string | null;
            claimedByName: string | null;
            claimedAt: Date | null;
          }>
        >`SELECT id, status, "claimedById", "claimedByName", "claimedAt"
            FROM "Order" WHERE id = ${orderId} FOR UPDATE`;

        if (!locked[0]) throw new ApiError('অর্ডার পাওয়া যায়নি', 404);

        // ★ লক করা রো থেকে status — এটাই আসল
        const liveStatus = locked[0].status;
        if (liveStatus !== 'PENDING' && liveStatus !== 'PROCESSING') {
          throw new ApiError('এই অর্ডার আর পরিবর্তন করা যাবে না', 409);
        }

        // ★★★ claim পাহারা (3.7) — অন্য অ্যাডমিন সক্রিয়ভাবে কাজ করলে
        //     ভুলবশত একই অর্ডারে হাত দেওয়া আটকায়।
        //
        //     ⚠️ উপরের row-lock এর **পরিবর্ত নয়, অতিরিক্ত**। লক ঠেকায়
        //     ডাবল-রিফান্ড (ডাটাবেসের ভেতর); এটি ঠেকায় ডাবল-ডেলিভারি
        //     (গেমের ভেতর, যা ডাটাবেস দেখতেই পায় না)।
        //
        //     ⚠️ কখনো চূড়ান্ত বাধা নয় — `takeover: true` দিলেই কাজ চলে,
        //     আর ১৫ মিনিট পর claim এমনিতেই মেয়াদোত্তীর্ণ। তাই এটি
        //     অর্ডার আটকে যাওয়ার নতুন কারণ হতে পারে না।
        const claim = claimState(locked[0], admin.id);
        if (isBlockedByOther(claim) && !takeover) {
          throw new ApiError(claimBlockMessage(claim), 409, 'CLAIM_HELD');
        }

        const order = await tx.order.findUnique({
          where: { id: orderId },
          include: { user: { select: { id: true, name: true, email: true } } },
        });
        if (!order) throw new ApiError('অর্ডার পাওয়া যায়নি', 404);

        // ★ টাকা-না-নড়া পথ দুটি শেয়ার্ড হেল্পারে (3.8) — একক ও বাল্ক
        //   দুই জায়গাতেই হুবহু একই কোড, দুটো আলাদা বাস্তবায়ন নয়
        if (action === 'PROCESSING' || action === 'COMPLETE') {
          await applyOrderStatus(tx, {
            orderId,
            action,
            admin,
            playerName,
            adminNote,
            internalNote,
          });
          return { kind: action as 'PROCESSING' | 'COMPLETE', order, reason: '' };
        }

        // ── FAIL → auto refund ──
        // ★ ব্যালেন্স + খতিয়ান একসাথে (4.1)। খতিয়ানের নোট আগের
        //   মতোই — ঐতিহাসিক এন্ট্রির সাথে সামঞ্জস্য রাখতে।
        await creditWallet({
          tx,
          userId: order.userId,
          amount: order.price,
          type: 'REFUND',
          refId: order.id,
          note: `অর্ডার #${order.orderNo} বাতিল — রিফান্ড`,
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

        // ★ কাঠামোবদ্ধ কারণ → গ্রাহকের জন্য সুনির্দিষ্ট বার্তা
        const reason = buildRejectionMessage(
          failReason ? ORDER_FAIL_COPY[failReason] : undefined,
          adminNote,
          'অর্ডার সম্পন্ন করা যায়নি — সম্পূর্ণ টাকা আপনার ওয়ালেটে ফেরত দেওয়া হয়েছে।'
        );

        await tx.order.update({
          where: { id: orderId },
          data: {
            status: 'REFUNDED',
            adminNote: reason,
            failReason: failReason ?? null,
            completedAt: new Date(),
            // ★ কাজ শেষ — claim ছেড়ে দেওয়া (3.7)
            claimedById: null,
            claimedByName: null,
            claimedAt: null,
            // ★★★ পুরো টাকা ফেরত গেছে — এটি লিখে রাখাই আংশিক
            //     রিফান্ড এন্ডপয়েন্টকে (3.14) আটকায়। ওখানে নিয়ম
            //     `refundedAmount + অঙ্ক <= price`, তাই এখানে price
            //     বসালে ওখানে আর কিছুই ফেরত দেওয়া যায় না।
            refundedAmount: order.price,
          },
        });

        await recordOrderEvent(tx, {
          orderId,
          status: 'REFUNDED',
          note: reason,
          actorType: 'ADMIN',
          actorId: admin.id,
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
