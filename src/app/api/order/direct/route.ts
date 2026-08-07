import { prisma } from '@/lib/prisma';
import { directOrderSchema } from '@/lib/validation';
import { requireUser, apiError, ApiError, readJson } from '@/lib/guard';
import { rateLimit, LIMITS } from '@/lib/rateLimit';
import { validateCoupon, consumeCoupon } from '@/lib/coupon';
import { notify, notifyAdmins, checkStockAlert } from '@/lib/notify';
import { round2 } from '@/lib/money';
import { cleanText } from '@/lib/sanitize';
import { getSettings } from '@/lib/settings';
import { computeSlaDueAt, slaFromSettings } from '@/lib/sla';
import { recordOrderEvent } from '@/lib/orderEvents';
import { generateTrackToken } from '@/lib/tracking';

/**
 * ═══════════════════════════════════════════════════════════
 * ★ ডাইরেক্ট পে — ওয়ালেটে আগে টাকা না রেখেই সরাসরি অর্ডার
 *
 *   কেন দরকার: নতুন গ্রাহককে ৭৮ টাকার প্যাকেজ কিনতে আগে
 *   ওয়ালেটে টাকা ভরতে বলা মানে — অচেনা সাইটে আগে টাকা জমা
 *   দিতে বলা। বেশিরভাগ মানুষ ওখানেই চলে যায়
 *   (COMPETITOR_ANALYSIS.md — first-purchase conversion tax)।
 *
 *   ★★★ নিরাপত্তার মূল নকশা:
 *   এখানে **কোনো নতুন টাকার পথ তৈরি করা হয়নি**। অর্ডার তৈরি হয়
 *   AWAITING_PAYMENT অবস্থায় — কোনো ব্যালেন্স নড়ে না, কোনো
 *   ledger এন্ট্রি হয় না। টাকা নড়ে শুধু তখনই, যখন অ্যাডমিন
 *   ডিপোজিট অনুমোদন করে — এবং সেটি ইতিমধ্যে প্রমাণিত, row-locked
 *   ledger পথেই হয় (api/admin/deposit)।
 *
 *   ⚠️ AWAITING_PAYMENT অর্ডার কখনো ফুলফিল করা যাবে না —
 *      অ্যাডমিন কিউ এটিকে বাদ দেয়। টাকা না এলে ডেলিভারি নয়।
 *
 *   ★ স্টক ও কুপন এখনই সংরক্ষিত হয় — নাহলে পেমেন্ট যাচাইয়ের
 *     ২০ মিনিটে স্টক শেষ হয়ে গেলে গ্রাহক টাকা দিয়েও পণ্য পেত না।
 *     ডিপোজিট বাতিল হলে দুটোই ফেরত যায়।
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

    const parsed = directOrderSchema.safeParse(await readJson(req));
    if (!parsed.success) throw new ApiError(parsed.error.errors[0].message, 400);

    const { variantId, playerUid, couponCode, method, trxId, senderNo, screenshot } = parsed.data;
    const playerName = parsed.data.playerName ? cleanText(parsed.data.playerName, 80) : null;

    // ★ একই TrxID পুনরায় ব্যবহার আটকানো — transaction এর আগেই দ্রুত ব্যর্থ
    const dupe = await prisma.deposit.findUnique({ where: { trxId }, select: { id: true } });
    if (dupe) throw new ApiError('এই ট্রানজেকশন আইডি আগে ব্যবহার করা হয়েছে', 409);

    // ★ Spam guard — অনেক অপেক্ষমান দাবি জমতে দেওয়া যাবে না
    const pendingCount = await prisma.deposit.count({
      where: { userId: user.id, status: 'PENDING' },
    });
    if (pendingCount >= 5) {
      throw new ApiError('আপনার ৫টি রিকোয়েস্ট পেন্ডিং আছে। অনুমোদনের অপেক্ষা করুন।', 429);
    }

    const slaDueAt = computeSlaDueAt(slaFromSettings(await getSettings()));

    const result = await prisma.$transaction(
      async (tx) => {
        // ★ স্টক race আটকাতে row lock — ওয়ালেট পথের মতোই
        const lockedVariant = await tx.$queryRaw<Array<{ id: number; stock: number }>>`
          SELECT id, stock FROM "Variant" WHERE id = ${variantId} FOR UPDATE`;
        if (!lockedVariant[0]) throw new ApiError('এই প্যাকেজটি এখন পাওয়া যাচ্ছে না', 400);

        const variant = await tx.variant.findUnique({
          where: { id: variantId },
          include: { product: true },
        });
        if (!variant || !variant.isActive || !variant.product.isActive) {
          throw new ApiError('এই প্যাকেজটি এখন পাওয়া যাচ্ছে না', 400);
        }

        const liveStock = lockedVariant[0].stock;
        if (liveStock === 0) throw new ApiError('স্টক শেষ হয়ে গেছে', 400);

        // ★ দাম সবসময় DB থেকে — client কখনো দাম ঠিক করে না
        const subtotal = round2(Number(variant.price));
        if (!Number.isFinite(subtotal) || subtotal < 0) {
          throw new ApiError('এই প্যাকেজের দামে সমস্যা আছে — অ্যাডমিনকে জানান', 400);
        }

        let discount = 0;
        let couponId: number | null = null;
        let couponLabel: string | null = null;
        if (couponCode) {
          const c = await validateCoupon(tx, couponCode, user.id, subtotal);
          discount = c.discount;
          couponId = c.couponId;
          couponLabel = c.code;
        }

        const finalPrice = round2(subtotal - discount);
        if (!Number.isFinite(finalPrice) || finalPrice < 0) {
          throw new ApiError('মূল্য হিসাবে সমস্যা হয়েছে', 400);
        }

        // ★ পাঠানো টাকার অঙ্ক অবশ্যই অর্ডারের দামের সমান হতে হবে
        if (round2(parsed.data.amount) !== finalPrice) {
          throw new ApiError(
            `পাঠানো টাকার অঙ্ক মিলছে না — অর্ডারের মূল্য ৳${finalPrice.toFixed(2)}`,
            400
          );
        }

        // স্টক সংরক্ষণ
        if (liveStock > 0) {
          await tx.variant.update({ where: { id: variant.id }, data: { stock: { decrement: 1 } } });
        }

        // ★ অর্ডার — AWAITING_PAYMENT, কোনো টাকা নড়েনি
        const order = await tx.order.create({
          data: {
            userId: user.id,
            variantId: variant.id,
            playerUid: playerUid.trim(),
            playerName,
            subtotal,
            discount,
            price: finalPrice,
            // ★ Phase 5 — cost snapshot (মুনাফা রিপোর্ট)
            costPrice: round2(Number(variant.costPrice) || 0),
            productName: variant.product.name,
            variantName: variant.label,
            couponId,
            status: 'AWAITING_PAYMENT',
            slaDueAt,
            // ★ লগইন ছাড়া ট্র্যাক করার গোপন টোকেন
            trackToken: generateTrackToken(),
          },
        });

        if (couponId) await consumeCoupon(tx, couponId, user.id, order.id, discount);

        await recordOrderEvent(tx, {
          orderId: order.id,
          status: 'AWAITING_PAYMENT',
          note: 'অর্ডার তৈরি — পেমেন্ট যাচাইয়ের অপেক্ষায়',
          actorType: 'CUSTOMER',
          actorId: user.id,
        });

        // ★ পেমেন্ট দাবি — অর্ডারের সাথে যুক্ত
        let deposit;
        try {
          deposit = await tx.deposit.create({
            data: {
              userId: user.id,
              method,
              amount: finalPrice,
              trxId,
              senderNo,
              screenshot: screenshot || null,
              status: 'PENDING',
              intent: 'ORDER_PAYMENT',
              linkedOrderId: order.id,
            },
          });
        } catch (e: unknown) {
          if ((e as { code?: string })?.code === 'P2002') {
            throw new ApiError('এই ট্রানজেকশন আইডি আগে ব্যবহার করা হয়েছে', 409);
          }
          throw e;
        }

        return {
          orderId: order.id,
          orderNo: order.orderNo,
          depositNo: deposit.depositNo,
          productName: order.productName,
          variantName: order.variantName,
          price: finalPrice,
          couponLabel,
        };
      },
      { timeout: 20000 }
    );

    // ★ guarded (defense-in-depth) — notify নিজে throw করে না, তবু commit-
    //   পরবর্তী ব্যর্থতা যেন order সফল হওয়ার পরও ইউজারকে ভুল "ব্যর্থ" না দেখায়।
    notify(
      user.id,
      `অর্ডার #${result.orderNo} — পেমেন্ট যাচাই হচ্ছে`,
      `${result.productName} — ${result.variantName}। TrxID মিলিয়ে দেখার পর ডেলিভারি শুরু হবে।`,
      `/account/orders/${result.orderId}`
    ).catch(() => {});

    notifyAdmins(
      'নতুন ডাইরেক্ট-পে অর্ডার',
      `${user.name} — #${result.orderNo} ${result.productName} (৳${result.price.toFixed(2)}) — পেমেন্ট যাচাই দরকার`,
      '/admin/deposits',
      'order_new'
    ).catch(() => {});

    // ★ ফিচার ১৪ — স্টক 0-এ নামলে অ্যাডমিনকে সতর্ক করি (রিজার্ভড হয়ে গেছে)
    checkStockAlert(variantId).catch(() => {});

    return Response.json({
      success: true,
      orderId: result.orderId,
      orderNo: result.orderNo,
      depositNo: result.depositNo,
      message: `অর্ডার #${result.orderNo} জমা হয়েছে। পেমেন্ট যাচাইয়ের পর ডেলিভারি শুরু হবে।`,
    });
  } catch (e) {
    return apiError(e);
  }
}
