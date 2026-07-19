import { prisma } from '@/lib/prisma';
import { orderSchema } from '@/lib/validation';
import { requireUser, apiError, ApiError } from '@/lib/guard';
import { rateLimit, LIMITS } from '@/lib/rateLimit';
import { validateCoupon, consumeCoupon } from '@/lib/coupon';
import { emailOrderPlaced } from '@/lib/email';
import { notify, notifyAdmins } from '@/lib/notify';
import { round2 } from '@/lib/money';
import { cleanText } from '@/lib/sanitize';
import { getSettings } from '@/lib/settings';
import { computeSlaDueAt, slaFromSettings } from '@/lib/sla';
import { recordOrderEvent } from '@/lib/orderEvents';
import { generateTrackToken } from '@/lib/tracking';
import { debitWallet } from '@/lib/services/wallet';

export async function POST(req: Request) {
  try {
    const user = await requireUser();

    const rl = rateLimit(`order:${user.id}`, LIMITS.order.limit, LIMITS.order.window);
    if (!rl.ok) {
      throw new ApiError(
        `অনেক বেশি অর্ডার হয়ে গেছে। ${rl.retryAfter} সেকেন্ড পর চেষ্টা করুন।`,
        429
      );
    }

    const parsed = orderSchema.safeParse(await req.json());
    if (!parsed.success) throw new ApiError(parsed.error.errors[0].message, 400);

    const { variantId, playerUid, couponCode } = parsed.data;
    const playerName = parsed.data.playerName
      ? cleanText(parsed.data.playerName, 80)
      : null;

    // ★ ডেলিভারির ডেডলাইন — transaction এর বাইরে হিসাব করা হয়
    //   (সেটিংস পড়া, লক লাগে না) কিন্তু অর্ডারে সংরক্ষিত হয়
    const slaDueAt = computeSlaDueAt(slaFromSettings(await getSettings()));

    // ═══════════════════════════════════════════
    // ★★★ পুরো money flow একটাই transaction
    //     double-spend + coupon race — দুটোই বন্ধ
    // ═══════════════════════════════════════════
    const result = await prisma.$transaction(
      async (tx) => {
        // ★★★ ভ্যারিয়েন্ট রো লক — নাহলে stock race:
        //     ৩টা স্টকে ৫ জন একসাথে অর্ডার দিলে সবাই দেখত "stock=3 > 0",
        //     সবাই কিনে ফেলত, stock হয়ে যেত −2।
        //     FOR UPDATE দিলে একজনের পর আরেকজন — সবাই আসল stock দেখে।
        const lockedVariant = await tx.$queryRaw<
          Array<{ id: number; stock: number }>
        >`SELECT id, stock FROM "Variant" WHERE id = ${variantId} FOR UPDATE`;

        if (!lockedVariant[0]) {
          throw new ApiError('এই প্যাকেজটি এখন পাওয়া যাচ্ছে না', 400);
        }

        // ★ দাম সবসময় DB থেকে — client এর পাঠানো price কখনো trust করি না
        const variant = await tx.variant.findUnique({
          where: { id: variantId },
          include: { product: true },
        });

        if (!variant || !variant.isActive || !variant.product.isActive) {
          throw new ApiError('এই প্যাকেজটি এখন পাওয়া যাচ্ছে না', 400);
        }

        // ★ লক করা রো থেকে stock পড়ি — findUnique এর টা বাসি হতে পারে
        const liveStock = lockedVariant[0].stock;
        if (liveStock === 0) throw new ApiError('স্টক শেষ হয়ে গেছে', 400);

        const subtotal = round2(Number(variant.price));

        // ★★★ DEFENSE IN DEPTH — দাম কখনো negative হতে পারে না।
        //     অ্যাডমিন API তে guard আছে, কিন্তু যদি কোনোভাবে DB তে
        //     negative দাম ঢুকে যায় (ম্যানুয়াল SQL, বাগ, migration),
        //     তাহলে অর্ডার করলে ব্যালেন্স *বেড়ে* যেত — টাকা তৈরি হতো!
        if (!Number.isFinite(subtotal) || subtotal < 0) {
          console.error(
            `[order] ⚠️ variant ${variant.id} এর দাম অবৈধ: ${variant.price}`
          );
          throw new ApiError('এই প্যাকেজের দামে সমস্যা আছে — অ্যাডমিনকে জানান', 400);
        }

        // ── কুপন (ঐচ্ছিক) ──
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

        // ★ শেষ রক্ষাকবচ — এখানে কখনো পৌঁছানোর কথা নয়, কিন্তু তবু
        if (!Number.isFinite(finalPrice) || finalPrice < 0) {
          throw new ApiError('মূল্য হিসাবে সমস্যা হয়েছে', 400);
        }

        // ★ Row lock — দুই ট্যাব থেকে একসাথে অর্ডার এলে দ্বিতীয়টা অপেক্ষা করবে
        const locked = await tx.$queryRaw<
          Array<{ id: string; balance: string; isBanned: boolean }>
        >`SELECT id, balance, "isBanned" FROM "User" WHERE id = ${user.id} FOR UPDATE`;

        const row = locked[0];
        if (!row) throw new ApiError('ইউজার পাওয়া যায়নি', 401);
        if (row.isBanned) throw new ApiError('আপনার অ্যাকাউন্ট বন্ধ করা হয়েছে', 403);

        const balance = Number(row.balance);
        if (balance < finalPrice) {
          throw new ApiError(
            `পর্যাপ্ত ব্যালেন্স নেই। প্রয়োজন ৳${finalPrice.toFixed(2)}, আছে ৳${balance.toFixed(2)}। Add Money করুন।`,
            400
          );
        }

        // 1️⃣ ব্যালেন্স কাটা — লেজার সহ, এক ধাপে (4.1)
        //    ⚠️ যথেষ্ট ব্যালেন্স আছে কি না তা উপরে লক করা রো দেখে
        //      ইতিমধ্যে যাচাই হয়েছে; সার্ভিস সেটা আবার করে না।
        //    ⚠️ ordering: অর্ডার তৈরির **পরে** লেজার লিখতে হয় (refId
        //      লাগে), তাই এখানে শুধু ব্যালেন্স আটকে রাখা যায় না —
        //      নিচে অর্ডার তৈরির পর debitWallet ডাকা হয়েছে।

        // 2️⃣ স্টক কমানো
        // 2️⃣ স্টক কমানো — লক করা আসল stock দেখে
        if (liveStock > 0) {
          await tx.variant.update({
            where: { id: variant.id },
            data: { stock: { decrement: 1 } },
          });
        }

        // 3️⃣ অর্ডার (snapshot সহ — পরে দাম বদলালেও পুরনো অর্ডার অক্ষত)
        //    ★ slaDueAt ও snapshot — পরে সেটিংস বদলালেও এই গ্রাহককে
        //      দেওয়া প্রতিশ্রুতি অপরিবর্তিত থাকবে
        const order = await tx.order.create({
          data: {
            userId: user.id,
            variantId: variant.id,
            playerUid: playerUid.trim(),
            playerName,
            subtotal,
            discount,
            price: finalPrice,
            productName: variant.product.name,
            variantName: variant.label,
            couponId,
            status: 'PENDING',
            slaDueAt,
            // ★ লগইন ছাড়া ট্র্যাক করার গোপন টোকেন
            trackToken: generateTrackToken(),
          },
        });

        // 4️⃣ কুপন consume
        if (couponId) await consumeCoupon(tx, couponId, user.id, order.id, discount);

        // 4️⃣.৫ ঘটনাপঞ্জির প্রথম এন্ট্রি — একই transaction এ, তাই
        //      অর্ডার থাকলে তার শুরুর রেকর্ডও নিশ্চিতভাবে থাকবে
        await recordOrderEvent(tx, {
          orderId: order.id,
          status: 'PENDING',
          note: 'অর্ডার গ্রহণ করা হয়েছে — পেমেন্ট ওয়ালেট থেকে কাটা হয়েছে',
          actorType: 'CUSTOMER',
          actorId: user.id,
        });

        // 5️⃣ ব্যালেন্স কাটা + খতিয়ান — একসাথে, আলাদা করা যায় না (4.1)
        const newBalance = await debitWallet({
          tx,
          userId: user.id,
          amount: finalPrice,
          type: 'ORDER',
          refId: order.id,
          note:
            `${variant.product.name} — ${variant.label}` +
            (couponLabel ? ` (কুপন: ${couponLabel}, −৳${discount.toFixed(2)})` : ''),
        });

        return {
          orderId: order.id,
          orderNo: order.orderNo,
          trackToken: order.trackToken,
          productName: order.productName,
          variantName: order.variantName,
          price: finalPrice,
          newBalance: Number(newBalance),
        };
      },
      { timeout: 15000 }
    );

    // ── Transaction এর বাইরে: notify + email (fail করলেও অর্ডার সফল) ──
    await notify(
      user.id,
      `অর্ডার #${result.orderNo} গ্রহণ করা হয়েছে`,
      `${result.productName} — ${result.variantName}। শীঘ্রই প্রসেস করা হবে।`,
      '/account/orders'
    );

    notifyAdmins(
      'নতুন অর্ডার',
      `${user.name} — #${result.orderNo} ${result.productName} (৳${result.price.toFixed(2)})`,
      '/admin/orders'
    ).catch(() => {});

    emailOrderPlaced(
      user.email, user.name, result.orderNo,
      result.productName, result.variantName, result.price.toFixed(2)
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
