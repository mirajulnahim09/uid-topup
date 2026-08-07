import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { orderSchema } from '@/lib/validation';
import { requireUser, apiError, ApiError, readJson } from '@/lib/guard';
import { rateLimit, LIMITS } from '@/lib/rateLimit';
import { validateCoupon, consumeCoupon } from '@/lib/coupon';
import { emailOrderPlaced } from '@/lib/email';
import { notify, notifyAdmins, checkStockAlert } from '@/lib/notify';
import { round2 } from '@/lib/money';
import { cleanText } from '@/lib/sanitize';
import { getSettings } from '@/lib/settings';
import { computeSlaDueAt, slaFromSettings } from '@/lib/sla';
import { recordOrderEvent } from '@/lib/orderEvents';
import { generateTrackToken } from '@/lib/tracking';
import { debitWallet } from '@/lib/services/wallet';
import { fulfillOrder } from '@/lib/fulfillment/service';
import { logActivity, requestMeta } from '@/lib/adminLog';

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
        // ★★★ H1 — টাকার প্রতিটি মান **লক করা রো থেকেই** আসে।
        //     আগে লক নিত কেবল `id, stock`, আর `price`/`costPrice`
        //     আসত পরের একটি **লক-বহির্ভূত** `findUnique` থেকে।
        //     বাস্তবে Postgres-এ ওই দ্বিতীয় পাঠও নিরাপদ ছিল (রো-লক
        //     ধরে রাখায় অন্য কেউ UPDATE করতে পারত না), কিন্তু সেই
        //     নিরাপত্তা নির্ভর করত সূক্ষ্ম lock-semantics-এর উপর —
        //     কেউ পরে `findUnique` লকের আগে সরালে, বা `FOR SHARE`-এ
        //     বদলালে, নীরবে ভেঙে যেত। CLAUDE.md §2.1(৩) স্পষ্ট:
        //     সিদ্ধান্তের মান **লক করা রো থেকে** নিতে হবে। এখন তাই।
        const lockedVariant = await tx.$queryRaw<
          Array<{
            id: number; stock: number; price: string;
            costPrice: string; isActive: boolean;
          }>
        >`SELECT id, stock, price, "costPrice", "isActive"
            FROM "Variant" WHERE id = ${variantId} FOR UPDATE`;

        const lockedRow = lockedVariant[0];
        if (!lockedRow) {
          throw new ApiError('এই প্যাকেজটি এখন পাওয়া যাচ্ছে না', 400);
        }
        if (!lockedRow.isActive) {
          throw new ApiError('এই প্যাকেজটি এখন পাওয়া যাচ্ছে না', 400);
        }

        // ★ কেবল **অ-আর্থিক** ক্ষেত্র — নাম/লেবেল/প্রোডাক্টের অবস্থা।
        //   এগুলোর কোনোটিই টাকার হিসাবে ব্যবহৃত হয় না।
        const variant = await tx.variant.findUnique({
          where: { id: variantId },
          include: { product: true },
        });

        if (!variant || !variant.product.isActive) {
          throw new ApiError('এই প্যাকেজটি এখন পাওয়া যাচ্ছে না', 400);
        }

        // ★ লক করা রো থেকে stock পড়ি — findUnique এর টা বাসি হতে পারে
        const liveStock = lockedRow.stock;
        if (liveStock === 0) throw new ApiError('স্টক শেষ হয়ে গেছে', 400);

        // ★ দাম লক করা রো থেকে — client এর পাঠানো price কখনো trust করি না
        const subtotal = round2(Number(lockedRow.price));

        // ★★★ DEFENSE IN DEPTH — দাম কখনো negative হতে পারে না।
        //     অ্যাডমিন API তে guard আছে, কিন্তু যদি কোনোভাবে DB তে
        //     negative দাম ঢুকে যায় (ম্যানুয়াল SQL, বাগ, migration),
        //     তাহলে অর্ডার করলে ব্যালেন্স *বেড়ে* যেত — টাকা তৈরি হতো!
        if (!Number.isFinite(subtotal) || subtotal < 0) {
          logger.error('order', 'invalid variant price', { variantId: lockedRow.id, price: String(lockedRow.price) });
          throw new ApiError('এই প্যাকেজের দামে সমস্যা আছে — অ্যাডমিনকে জানান', 400);
        }

        // ── কুপন (ঐচ্ছিক) ──
        let discount = 0;
        let couponId: number | null = null;
        let couponLabel: string | null = null;

        if (couponCode) {
          // ★★★ H1 fix — কুপন রো লক (Variant/User এর মতোই FOR UPDATE)।
          //     আগে validateCoupon কুপন ও per-user গণনা **লক ছাড়া** পড়ত,
          //     তাই দুটি সমান্তরাল অর্ডার (আলাদা variant/user, ফলে ঐ লকগুলো
          //     ক্রমিক করত না) দুজনেই usageCount = limit−1 দেখে পাস করে
          //     ফেলত — usageLimit / perUserLimit পেরিয়ে যেত। কুপন রো লক
          //     নেওয়ায় একই কুপন ব্যবহারকারী সব লেনদেন ক্রমিক হয়; পরেরটি
          //     সদ্য-হালনাগাদ গণনা দেখে। lock ক্রম variant → coupon → user,
          //     সর্বত্র অভিন্ন — deadlock হয় না। কোড না মিললে ০ রো লক হয়,
          //     validateCoupon নিজেই "কুপন সঠিক নয়" দেয়।
          await tx.$queryRaw`SELECT id FROM "Coupon" WHERE code = ${couponCode.trim().toUpperCase()} FOR UPDATE`;
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
            // ★ Phase 5 — অর্ডারের সময়কার cost snapshot (মুনাফা রিপোর্ট)।
            //   Variant.costPrice পরে বদলালেও এই মান অপরিবর্তিত থাকে।
            //   H1: এটিও **লক করা রো** থেকে — মুনাফার হিসাব টাকার হিসাব।
            costPrice: round2(Number(lockedRow.costPrice) || 0),
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
          variantId: variant.id, // ★ স্টক-সতর্কতার জন্য
          price: finalPrice,
          newBalance: Number(newBalance),
        };
      },
      { timeout: 15000 }
    );

    // ★★★ Fulfillment interface seam (future-ready) — Order Service কেবল
    //   `fulfillOrder()` ইন্টারফেসের সাথে কথা বলে, কোনো concrete প্রোভাইডার
    //   নয় (DIP)। আজ MANUAL ফেরে (config ও active provider দুটোই manual) →
    //   এই ব্লক কিছুই করে না, বর্তমান অর্ডার-প্রবাহ অপরিবর্তিত। ভবিষ্যতে
    //   configured fulfillment gateway + order_approval=automatic হলে
    //   এখানেই অটো-ডেলিভারি → order-complete চালানো হবে। tx-এর বাইরে ও
    //   guarded, তাই money-flow কখনো ভাঙে না।
    try {
      const d = await fulfillOrder({
        orderId: result.orderId, productName: result.productName,
        variantName: result.variantName, playerUid: playerUid.trim(), quantity: 1,
      });
      if (d.status === 'DELIVERED') {
        // FUTURE: বিদ্যমান order-complete logic (admin/order route-এর মতো)।
      }
    } catch { /* fulfillment layer must never break the order flow */ }

    // ★ অডিট: গ্রাহক অর্ডার তৈরি করেছে (best-effort)
    {
      const meta = requestMeta(req);
      logActivity({
        actorId: user.id, actorName: user.name, actorType: 'CUSTOMER', role: 'USER',
        action: 'ORDER_CREATE', targetId: result.orderId, amount: result.price,
        detail: `${result.productName} — ${result.variantName}`, ip: meta.ip, userAgent: meta.userAgent,
      }).catch(() => {});
    }

    // ── Transaction এর বাইরে: notify + email (fail করলেও অর্ডার সফল) ──
    // ★ guarded (defense-in-depth): notify নিজে throw করে না (ভেতরে
    //   try/catch), তবু .catch() রাখা — refactor-এ throw এলেও order/money
    //   commit-পরবর্তী ব্যর্থতা যেন ইউজারকে ভুল "ব্যর্থ" না দেখায়।
    notify(
      user.id,
      `অর্ডার #${result.orderNo} গ্রহণ করা হয়েছে`,
      `${result.productName} — ${result.variantName}। শীঘ্রই প্রসেস করা হবে।`,
      '/account/orders'
    ).catch(() => {});

    notifyAdmins(
      'নতুন অর্ডার',
      `${user.name} — #${result.orderNo} ${result.productName} (৳${result.price.toFixed(2)})`,
      '/admin/orders',
      'order_new'
    ).catch(() => {});

    // ★ ফিচার ১৪ — এই অর্ডারে স্টক 0-এ নামলে অ্যাডমিনকে সতর্ক করি
    checkStockAlert(result.variantId).catch(() => {});

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
