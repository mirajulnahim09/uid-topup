import { prisma } from '@/lib/prisma';
import { adminDepositActionSchema } from '@/lib/validation';
import { requireAdmin, apiError, ApiError, readJson } from '@/lib/guard';
import { payReferralBonus, notifyReferralBonus } from '@/lib/referral';
import { emailDepositApproved, emailDepositRejected } from '@/lib/email';
import { notify } from '@/lib/notify';
import { telegramEvent } from '@/lib/telegram';
import { cleanText } from '@/lib/sanitize';
import { adminLog } from '@/lib/adminLog';
import { getIp } from '@/lib/rateLimit';
import { recordOrderEvent } from '@/lib/orderEvents';
import { creditWallet, debitWallet } from '@/lib/services/wallet';
import { DEPOSIT_REJECT_COPY, buildRejectionMessage } from '@/lib/rejectReasons';
import { deliverVoucherCode } from '@/lib/services/voucherCodes';

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();

    const parsed = adminDepositActionSchema.safeParse(await readJson(req));
    if (!parsed.success) throw new ApiError(parsed.error.errors[0].message, 400);

    const { depositId, action, rejectReason } = parsed.data;
    const adminNote = parsed.data.adminNote ? cleanText(parsed.data.adminNote, 300) : undefined;

    const out = await prisma.$transaction(
      async (tx) => {
        // ★★★ ROW LOCK — সবচেয়ে বড় টাকার ঝুঁকি এখানে।
        //     লক ছাড়া: ৫ জন অ্যাডমিন একসাথে approve চাপলে ৫টা transaction
        //     একসাথে status='PENDING' দেখত, সবাই পাস করত → টাকা ৫ গুণ ঢুকত।
        //     FOR UPDATE দিলে একজনের পর আরেকজন — দ্বিতীয়জন 'APPROVED' দেখবে।
        const locked = await tx.$queryRaw<
          Array<{ id: string; status: string }>
        >`SELECT id, status FROM "Deposit" WHERE id = ${depositId} FOR UPDATE`;

        if (!locked[0]) throw new ApiError('ডিপোজিট পাওয়া যায়নি', 404);

        // ★ লক করা রো থেকে status পড়ি — এটাই আসল, বাসি নয়
        if (locked[0].status !== 'PENDING') {
          throw new ApiError('এই রিকোয়েস্ট আগেই প্রসেস করা হয়েছে', 409);
        }

        const deposit = await tx.deposit.findUnique({
          where: { id: depositId },
          include: { user: { select: { id: true, name: true, email: true } } },
        });
        if (!deposit) throw new ApiError('ডিপোজিট পাওয়া যায়নি', 404);

        const amount = Number(deposit.amount);

        // ★ ডাইরেক্ট-পে হলে যুক্ত অর্ডারটিও লক করি — একই সাথে
        //   দুই দিক থেকে পরিবর্তন হলে যেন race না হয়
        const linkedOrder =
          deposit.intent === 'ORDER_PAYMENT' && deposit.linkedOrderId
            ? (
                await tx.$queryRaw<Array<{ id: string; status: string }>>`
                  SELECT id, status FROM "Order" WHERE id = ${deposit.linkedOrderId} FOR UPDATE`
              )[0] ?? null
            : null;

        if (action === 'REJECT') {
          // ★ কাঠামোবদ্ধ কারণ থেকে সুনির্দিষ্ট ও কাজের বার্তা তৈরি —
          //   গ্রাহক কখনো শুধু "বাতিল" দেখবে না
          const reason = buildRejectionMessage(
            rejectReason ? DEPOSIT_REJECT_COPY[rejectReason] : undefined,
            adminNote,
            'ট্রানজেকশন যাচাই করা যায়নি। পেমেন্টের স্ক্রিনশট নিয়ে সাপোর্টে যোগাযোগ করুন।'
          );
          await tx.deposit.update({
            where: { id: depositId },
            data: {
              status: 'REJECTED',
              adminNote: reason,
              rejectReason: rejectReason ?? null,
              reviewedAt: new Date(),
            },
          });

          // ★ ডাইরেক্ট-পে বাতিল — অর্ডারও বাতিল, স্টক ও কুপন ফেরত।
          //   ⚠️ ব্যালেন্স ফেরত নয় — কারণ কোনো টাকা কখনো যোগই হয়নি।
          if (linkedOrder && linkedOrder.status === 'AWAITING_PAYMENT') {
            const order = await tx.order.findUnique({ where: { id: linkedOrder.id } });
            if (order) {
              const variant = await tx.variant.findUnique({ where: { id: order.variantId } });
              if (variant && variant.stock >= 0) {
                await tx.variant.update({
                  where: { id: variant.id },
                  data: { stock: { increment: 1 } },
                });
              }
              if (order.couponId) {
                await tx.coupon.update({
                  where: { id: order.couponId },
                  data: { usageCount: { decrement: 1 } },
                });
                await tx.couponUse.deleteMany({ where: { orderId: order.id } });
              }
              await tx.order.update({
                where: { id: order.id },
                data: {
                  status: 'FAILED',
                  adminNote: `পেমেন্ট যাচাই করা যায়নি — ${reason}`,
                  completedAt: new Date(),
                },
              });
              await recordOrderEvent(tx, {
                orderId: order.id,
                status: 'FAILED',
                note: `পেমেন্ট যাচাই করা যায়নি — ${reason}`,
                actorType: 'ADMIN',
                actorId: admin.id,
              });
            }
          }

          return {
            kind: 'REJECT' as const,
            user: deposit.user,
            amount,
            reason,
            depositNo: deposit.depositNo,
            balance: 0,
            referral: null,
            linkedOrderNo: null as number | null,
            linkedOrderId: null as string | null,
          };
        }

        // ── APPROVE ──
        // ★ ব্যালেন্স + খতিয়ান একসাথে (4.1)
        const creditedBalance = await creditWallet({
          tx,
          userId: deposit.userId,
          amount: deposit.amount,
          type: 'DEPOSIT',
          refId: deposit.id,
          note: `${deposit.method} — TrxID: ${deposit.trxId}`,
        });

        await tx.deposit.update({
          where: { id: depositId },
          data: { status: 'APPROVED', adminNote, reviewedAt: new Date() },
        });

        // ★★★ ডাইরেক্ট-পে নিষ্পত্তি — টাকা ঢুকল, এখনই অর্ডারের দাম কাটা হয়।
        //     একই transaction এ, একই প্রমাণিত ledger পথে। ফলে ব্যালেন্স
        //     কখনো মাঝপথে আটকে থাকে না — হয় দুটোই হয়, নয় কিছুই হয় না।
        let settledBalance = Number(creditedBalance);
        let linkedOrderNo: number | null = null;
        let linkedOrderId: string | null = null;

        if (linkedOrder && linkedOrder.status === 'AWAITING_PAYMENT') {
          const order = await tx.order.findUnique({ where: { id: linkedOrder.id } });
          if (order) {
            const price = Number(order.price);

            // ★ শেষ রক্ষাকবচ — জমা টাকা অর্ডারের দামের চেয়ে কম হলে
            //   ব্যালেন্স negative হয়ে যেত। DB constraint ও আটকাত,
            //   কিন্তু এখানে পরিষ্কার বার্তা দিয়ে থামানো ভালো।
            if (settledBalance < price) {
              throw new ApiError(
                `জমা টাকা অর্ডারের দামের চেয়ে কম — অর্ডার ৳${price.toFixed(2)}, ব্যালেন্স ৳${settledBalance.toFixed(2)}`,
                400
              );
            }

            settledBalance = Number(
              await debitWallet({
                tx,
                userId: deposit.userId,
                amount: order.price,
                type: 'ORDER',
                refId: order.id,
                note: `${order.productName} — ${order.variantName} (ডাইরেক্ট পে)`,
              })
            );

            await tx.order.update({
              where: { id: order.id },
              data: { status: 'PENDING' },
            });

            await recordOrderEvent(tx, {
              orderId: order.id,
              status: 'PENDING',
              note: 'পেমেন্ট যাচাই সম্পন্ন — ডেলিভারির অপেক্ষায়',
              actorType: 'ADMIN',
              actorId: admin.id,
            });

            linkedOrderNo = order.orderNo;
            linkedOrderId = order.id;
          }
        }

        // ★ রেফারেল বোনাস — প্রথম যোগ্য ডিপোজিটে, একবারই
        const referral = await payReferralBonus(tx, deposit.userId, amount);

        return {
          kind: 'APPROVE' as const,
          user: deposit.user,
          amount,
          balance: settledBalance,
          depositNo: deposit.depositNo,
          reason: '',
          referral,
          linkedOrderNo,
          linkedOrderId,
        };
      },
      { timeout: 15000 }
    );

    // ★ অডিট লগ — কে কখন কত টাকা approve করল
    adminLog({
      adminId: admin.id,
      adminName: admin.name,
      action: out.kind === 'APPROVE' ? 'DEPOSIT_APPROVE' : 'DEPOSIT_REJECT',
      targetId: depositId,
      amount: out.amount,
      detail: `#${out.depositNo} — ${out.user.name}` + (out.reason ? ` (${out.reason})` : ''),
      ip: getIp(req),
    }).catch(() => {});

    // ★ অপারেটর-ফিড — শুধু টেলিগ্রামে (ইন-অ্যাপ নয়: অ্যাডমিন নিজেই করেছে)
    if (out.kind === 'APPROVE') {
      telegramEvent(
        'deposit_approved',
        '✅ ডিপোজিট অনুমোদিত',
        `#${out.depositNo} — ${out.user.name} — ৳${out.amount.toFixed(2)} (${admin.name})`,
        '/admin/deposits',
      );
    } else {
      telegramEvent(
        'deposit_rejected',
        '❌ ডিপোজিট বাতিল',
        `#${out.depositNo} — ${out.user.name} — ৳${out.amount.toFixed(2)} (${admin.name}) — ${out.reason}`,
        '/admin/deposits',
      );
    }

    if (out.kind === 'APPROVE') {
      // ★ guarded (defense-in-depth): notify নিজে throw করে না (ভেতরে
    //   try/catch), তবু .catch() রাখা — refactor-এ throw এলেও order/money
    //   commit-পরবর্তী ব্যর্থতা যেন ইউজারকে ভুল "ব্যর্থ" না দেখায়।
      notify(
        out.user.id,
        out.linkedOrderNo
          ? `পেমেন্ট যাচাই সম্পন্ন — অর্ডার #${out.linkedOrderNo} ✅`
          : `ডিপোজিট #${out.depositNo} অনুমোদিত ✅`,
        out.linkedOrderNo
          ? `৳${out.amount.toFixed(2)} পেমেন্ট নিশ্চিত হয়েছে। এখন ডেলিভারি শুরু হবে।`
          : `৳${out.amount.toFixed(2)} যোগ হয়েছে। বর্তমান ব্যালেন্স ৳${out.balance.toFixed(2)}।`,
        '/account/orders'
      ).catch(() => {});
      emailDepositApproved(
        out.user.email, out.user.name,
        out.amount.toFixed(2), out.balance.toFixed(2)
      ).catch(() => {});

      // Direct-pay order just became PENDING: voucher-code products are
      // delivered from stock now (no money movement; never throws).
      if (out.linkedOrderId) await deliverVoucherCode(out.linkedOrderId);

      if (out.referral) {
        notifyReferralBonus(out.referral.referrerId, out.user.name, out.referral.bonus).catch(
          () => {}
        );
      }
    } else {
      notify(
        out.user.id,
        `ডিপোজিট #${out.depositNo} বাতিল ❌`,
        out.reason,
        '/account/wallet/deposit'
      ).catch(() => {});
      emailDepositRejected(
        out.user.email, out.user.name, out.amount.toFixed(2), out.reason
      ).catch(() => {});
    }

    return Response.json({ success: true });
  } catch (e) {
    return apiError(e);
  }
}
