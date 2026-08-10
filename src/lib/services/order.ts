import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { logger } from '../logger';
import { ApiError } from '../guard';
import { round2 } from '../money';
import { validateCoupon, consumeCoupon } from '../coupon';
import { recordOrderEvent } from '../orderEvents';
import { generateTrackToken } from '../tracking';
import { debitWallet } from './wallet';
import { fulfillOrder } from '../fulfillment/service';
import { notify, checkStockAlert } from '../notify';
import { emailOrderPlaced } from '../email';
import { logActivity } from '../adminLog';

/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ অর্ডার সার্ভিস (Group F ৩) — অর্ডারের টাকার পথ, একটিই জায়গায়
 *
 *   ── কেন এটি বানানো হলো ──
 *   এতদিন পুরো money flow `src/app/api/order/route.ts` এর ভেতরে
 *   ছিল। রিসেলারের bulk endpoint-এরও **হুবহু একই** যুক্তি দরকার:
 *   একই লক-ক্রম, একই রিসেলার-দাম নিয়ম, একই কুপন যাচাই, একই খতিয়ান।
 *   কপি করলে দুটি অনুলিপি জন্মাত — আর একদিন কেউ একটিতে বাগ সারিয়ে
 *   অন্যটিতে ভুলে যেত। টাকার যুক্তির দুটি সংস্করণ মানে দুটি সত্য।
 *
 *   তাই যুক্তিটি এখানে **সরিয়ে** আনা হয়েছে, নকল করা হয়নি। রুট
 *   হ্যান্ডলার এখন কেবল HTTP-র কাজ করে: অথ, রেট-লিমিট, পার্সিং।
 *
 *   ⚠️ এটি একটি প্রমাণিত money-পথের refactor। আচরণ **হুবহু**
 *   অপরিবর্তিত রাখা হয়েছে — একই ক্রম, একই বার্তা, একই লক, একই
 *   snapshot। `tests/order.test.ts` (১০) ও `tests/reseller.test.ts` (৯)
 *   ঠিক এই পথটিই ঘিরে আছে, তাই দাবিটি যাচাইযোগ্য।
 *
 *   ── লক-ক্রম (CLAUDE.md §2.1) — অপরিবর্তিত ──
 *   variant → coupon → user, প্রতিটি `SELECT ... FOR UPDATE`।
 * ═══════════════════════════════════════════════════════════
 */

export type OrderChannel = 'WEB' | 'API';

export type PlaceOrderInput = {
  userId: string;
  variantId: number;
  playerUid: string;
  playerName: string | null;
  couponCode?: string | null;
  /** ★ অর্ডারের সময় হিসাব করা ডেলিভারি-ডেডলাইন (snapshot) */
  slaDueAt: Date | null;
  /**
   * ★ কলারের নিজস্ব রেফারেন্স — **idempotency key**।
   *
   *   কেন দরকার: API ক্লায়েন্ট টাইমআউট দেখলে সাধারণত আবার পাঠায়।
   *   ওয়েবে ব্যবহারকারী নিজের চোখে ফল দেখেন, কিন্তু একটি স্ক্রিপ্ট
   *   দেখে না — ফলে একই অর্ডার দুবার বসে যেত ও ওয়ালেট দুবার কাটত।
   *   `(userId, clientRef)` ইউনিক, তাই দ্বিতীয় চেষ্টা নতুন অর্ডার
   *   বানাতে **পারে না**; বিদ্যমানটিই ফেরত যায়।
   */
  clientRef?: string | null;
};

export type PlacedOrder = {
  orderId: string;
  orderNo: number;
  trackToken: string | null;
  productName: string;
  variantName: string;
  /** ★ স্টক-সতর্কতার জন্য */
  variantId: number;
  price: number;
  newBalance: number;
  /** ★ রিসেলার দামে গেছে কি না — রিপোর্ট ও খতিয়ান মেলানোর জন্য */
  reseller: boolean;
  /**
   * ★ এই কলে নতুন অর্ডার তৈরি হয়নি — আগের একটি অর্ডার ফেরত দেওয়া হলো।
   *   কলার একে "সফল" ধরবে, কিন্তু **আবার টাকা কাটেনি** — তাই পার্থক্যটি
   *   স্পষ্টভাবে জানানো হয়, নীরবে নয়।
   */
  duplicate: boolean;
};

/** ★ ইউনিক-সংঘর্ষ (P2002) কি না — Prisma-র নিজস্ব কোড দেখে */
function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}

/** ★ পুরনো (বা সমান্তরালে জেতা) অর্ডারকে ফলাফলের আকারে ফেরত দেওয়া */
async function existingOrderResult(
  userId: string,
  clientRef: string,
): Promise<PlacedOrder | null> {
  const order = await prisma.order.findFirst({
    where: { userId, clientRef },
    select: {
      id: true, orderNo: true, trackToken: true, productName: true,
      variantName: true, variantId: true, price: true,
    },
  });
  if (!order) return null;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { balance: true },
  });

  return {
    orderId: order.id,
    orderNo: order.orderNo,
    trackToken: order.trackToken,
    productName: order.productName,
    variantName: order.variantName,
    variantId: order.variantId,
    price: Number(order.price),
    newBalance: Number(user?.balance ?? 0),
    // ★ পুরনো অর্ডারে রিসেলার-চিহ্ন আলাদা করে রাখা নেই; এই ফিল্ডটি
    //   কেবল **এই কলে** কী ঘটল তা বলে, আর এই কলে কিছুই ঘটেনি।
    reseller: false,
    duplicate: true,
  };
}

/**
 * ★★★ একটি অর্ডার — পুরোটাই একটি transaction-এ।
 *
 *   ⚠️ সার্ভিস **নিজেই** transaction খোলে (ওয়ালেট সার্ভিসের উল্টো)।
 *   কারণ bulk-এ প্রতিটি আইটেম **স্বতন্ত্র** হতে হবে: ৫ নম্বর আইটেমে
 *   স্টক শেষ হলে ১–৪ নম্বর অর্ডারগুলো বাতিল হয়ে যাওয়া চলবে না।
 *   একটি বড় transaction-এ সবগুলো রাখলে ঠিক তাই হতো।
 */
export async function placeOrder(input: PlaceOrderInput): Promise<PlacedOrder> {
  const clientRef = input.clientRef?.trim() || null;

  // ★ সস্তা পথ: আগেই বসানো থাকলে transaction খোলারই দরকার নেই।
  //   (আসল সুরক্ষা এটি নয় — সেটি নিচের ইউনিক ইনডেক্স। এটি কেবল
  //   সাধারণ retry-তে অপ্রয়োজনীয় লক নেওয়া বাঁচায়।)
  if (clientRef) {
    const prior = await existingOrderResult(input.userId, clientRef);
    if (prior) return prior;
  }

  try {
    return await prisma.$transaction(
      async (tx) => {
        // ★★★ ভ্যারিয়েন্ট রো লক — নাহলে stock race:
        //     ৩টা স্টকে ৫ জন একসাথে অর্ডার দিলে সবাই দেখত "stock=3 > 0",
        //     সবাই কিনে ফেলত, stock হয়ে যেত −2।
        //     FOR UPDATE দিলে একজনের পর আরেকজন — সবাই আসল stock দেখে।
        // ★★★ H1 — টাকার প্রতিটি মান **লক করা রো থেকেই** আসে।
        //     আগে লক নিত কেবল `id, stock`, আর `price`/`costPrice`
        //     আসত পরের একটি **লক-বহির্ভূত** `findUnique` থেকে।
        //     CLAUDE.md §2.1(৩) স্পষ্ট: সিদ্ধান্তের মান **লক করা রো
        //     থেকে** নিতে হবে। এখন তাই।
        const lockedVariant = await tx.$queryRaw<
          Array<{
            id: number; stock: number; price: string;
            costPrice: string; isActive: boolean;
            // ★ Group F — রিসেলার দামও money-মান, তাই একই লক করা রো থেকে
            resellerPrice: string | null;
          }>
        >`SELECT id, stock, price, "costPrice", "isActive", "resellerPrice"
            FROM "Variant" WHERE id = ${input.variantId} FOR UPDATE`;

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
          where: { id: input.variantId },
          include: { product: true },
        });

        if (!variant || !variant.product.isActive) {
          throw new ApiError('এই প্যাকেজটি এখন পাওয়া যাচ্ছে না', 400);
        }

        // ★ লক করা রো থেকে stock পড়ি — findUnique এর টা বাসি হতে পারে
        const liveStock = lockedRow.stock;
        if (liveStock === 0) throw new ApiError('স্টক শেষ হয়ে গেছে', 400);

        // ★★★ কুপন রো লক — **লক ক্রম অপরিবর্তিত**: variant → coupon → user।
        //
        //     ⚠️ Group F-এ যা বদলেছে: লক নেওয়া আর কুপন *যাচাই* করা এখন
        //     আলাদা দুই ধাপ। কারণ যাচাইয়ের জন্য `subtotal` লাগে, আর
        //     subtotal এখন ব্যবহারকারীর **tier**-এর উপর নির্ভরশীল, যা
        //     জানা যায় কেবল User রো লক করার পর।
        //
        //     লক **নেওয়ার** ক্রম তবু হুবহু আগের মতোই (coupon তারপর user),
        //     তাই deadlock-নিরাপত্তা অক্ষত।
        const couponCode = input.couponCode?.trim() || null;
        if (couponCode) {
          await tx.$queryRaw`SELECT id FROM "Coupon" WHERE code = ${couponCode.toUpperCase()} FOR UPDATE`;
        }

        // ★ Row lock — দুই ট্যাব থেকে একসাথে অর্ডার এলে দ্বিতীয়টা অপেক্ষা করবে
        // ★ Group F — `tier`-ও **লক করা রো থেকেই** আসে। tier দাম নির্ধারণ
        //   করে, অর্থাৎ এটি একটি money-সিদ্ধান্ত; CLAUDE.md §2.1(৩) অনুযায়ী
        //   সেই মান লক-বহির্ভূত পাঠ থেকে নেওয়া চলবে না।
        const locked = await tx.$queryRaw<
          Array<{ id: string; balance: string; isBanned: boolean; tier: string }>
        >`SELECT id, balance, "isBanned", tier FROM "User" WHERE id = ${input.userId} FOR UPDATE`;

        const row = locked[0];
        if (!row) throw new ApiError('ইউজার পাওয়া যায়নি', 401);
        if (row.isBanned) throw new ApiError('আপনার অ্যাকাউন্ট বন্ধ করা হয়েছে', 403);

        // ★★★ Group F — রিসেলার দাম।
        //
        //   নিয়ম: **কেবল** tier=RESELLER **এবং** ঐ ভ্যারিয়েন্টে
        //   `resellerPrice` স্পষ্টভাবে বসানো থাকলে। `null` = ছাড় নেই →
        //   সাধারণ দাম। ফলে সাধারণ গ্রাহক কখনোই রিসেলার দাম পান না,
        //   আর রিসেলারও এমন প্যাকেজে ছাড় পান না যেখানে সেটি দেওয়া হয়নি।
        //
        //   ⚠️ দুটি মানই **লক করা variant রো** থেকে (H1)।
        const isReseller = row.tier === 'RESELLER';
        const rawReseller = lockedRow.resellerPrice;
        const resellerPrice = rawReseller === null ? null : Number(rawReseller);

        // ★ শেষ রক্ষাকবচ — অবৈধ রিসেলার দাম হলে সেটি **উপেক্ষা** করে
        //   সাধারণ দামে ফিরে যাই।
        //
        //   ⚠️ শূন্যও অবৈধ, এবং এটি একটি **মাপা** সীমাবদ্ধতা: এই
        //   সিস্টেমে "ফ্রি অর্ডার" বলে কিছু নেই, কারণ প্রতিটি অর্ডার
        //   একটি ধনাত্মক খতিয়ান-এন্ট্রি লেখে (`debitWallet` শূন্য বা
        //   ঋণাত্মক অঙ্ক প্রত্যাখ্যান করে)।
        //
        //   ঋণাত্মক দাম আরও বিপজ্জনক: তাতে ব্যালেন্স *বেড়ে* যেত, অর্থাৎ
        //   অর্ডার দিয়ে টাকা তৈরি করা যেত।
        const useReseller =
          isReseller && resellerPrice !== null &&
          Number.isFinite(resellerPrice) && resellerPrice > 0;

        if (isReseller && resellerPrice !== null && !useReseller) {
          logger.error('order', 'invalid resellerPrice — falling back to price', {
            variantId: lockedRow.id,
          });
        }

        const subtotal = round2(useReseller ? resellerPrice! : Number(lockedRow.price));

        // ★★★ DEFENSE IN DEPTH — দাম কখনো negative হতে পারে না।
        //     অ্যাডমিন API তে guard আছে, কিন্তু যদি কোনোভাবে DB তে
        //     negative দাম ঢুকে যায় (ম্যানুয়াল SQL, বাগ, migration),
        //     তাহলে অর্ডার করলে ব্যালেন্স *বেড়ে* যেত — টাকা তৈরি হতো!
        if (!Number.isFinite(subtotal) || subtotal < 0) {
          logger.error('order', 'invalid variant price', {
            variantId: lockedRow.id, price: String(lockedRow.price),
          });
          throw new ApiError('এই প্যাকেজের দামে সমস্যা আছে — অ্যাডমিনকে জানান', 400);
        }

        // ── কুপন যাচাই (ঐচ্ছিক) — রো ইতিমধ্যে লক করা ──
        let discount = 0;
        let couponId: number | null = null;
        let couponLabel: string | null = null;

        if (couponCode) {
          const c = await validateCoupon(tx, couponCode, input.userId, subtotal);
          discount = c.discount;
          couponId = c.couponId;
          couponLabel = c.code;
        }

        const finalPrice = round2(subtotal - discount);

        // ★ শেষ রক্ষাকবচ — এখানে কখনো পৌঁছানোর কথা নয়, কিন্তু তবু
        if (!Number.isFinite(finalPrice) || finalPrice < 0) {
          throw new ApiError('মূল্য হিসাবে সমস্যা হয়েছে', 400);
        }

        const balance = Number(row.balance);
        if (balance < finalPrice) {
          throw new ApiError(
            `পর্যাপ্ত ব্যালেন্স নেই। প্রয়োজন ৳${finalPrice.toFixed(2)}, আছে ৳${balance.toFixed(2)}। Add Money করুন।`,
            400
          );
        }

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
            userId: input.userId,
            variantId: variant.id,
            playerUid: input.playerUid.trim(),
            playerName: input.playerName,
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
            slaDueAt: input.slaDueAt,
            // ★ লগইন ছাড়া ট্র্যাক করার গোপন টোকেন
            trackToken: generateTrackToken(),
            // ★ idempotency — ইউনিক ইনডেক্স `(userId, clientRef)` এখানেই
            //   কার্যকর হয়। দ্বিতীয় চেষ্টা এই লাইনে P2002 পায় ও পুরো
            //   transaction (ব্যালেন্স কাটা সহ) rollback হয়ে যায়।
            clientRef,
          },
        });

        // 4️⃣ কুপন consume
        if (couponId) await consumeCoupon(tx, couponId, input.userId, order.id, discount);

        // 4️⃣.৫ ঘটনাপঞ্জির প্রথম এন্ট্রি — একই transaction এ, তাই
        //      অর্ডার থাকলে তার শুরুর রেকর্ডও নিশ্চিতভাবে থাকবে
        await recordOrderEvent(tx, {
          orderId: order.id,
          status: 'PENDING',
          note: 'অর্ডার গ্রহণ করা হয়েছে — পেমেন্ট ওয়ালেট থেকে কাটা হয়েছে',
          actorType: 'CUSTOMER',
          actorId: input.userId,
        });

        // 5️⃣ ব্যালেন্স কাটা + খতিয়ান — একসাথে, আলাদা করা যায় না (4.1)
        const newBalance = await debitWallet({
          tx,
          userId: input.userId,
          amount: finalPrice,
          type: 'ORDER',
          refId: order.id,
          // ★ Group F — রিসেলার অর্ডার খতিয়ানে **আলাদাভাবে চেনা যায়**।
          //   রিসেলার ও খুচরা বিক্রির মুনাফা আলাদা, তাই পরে খতিয়ান
          //   মিলাতে গিয়ে কোনটি কোন দামে গিয়েছিল তা বোঝা যেতেই হবে।
          note:
            (useReseller ? '[রিসেলার] ' : '') +
            `${variant.product.name} — ${variant.label}` +
            (couponLabel ? ` (কুপন: ${couponLabel}, −৳${discount.toFixed(2)})` : ''),
        });

        return {
          orderId: order.id,
          orderNo: order.orderNo,
          trackToken: order.trackToken,
          productName: order.productName,
          variantName: order.variantName,
          variantId: variant.id,
          price: finalPrice,
          newBalance: Number(newBalance),
          reseller: useReseller,
          duplicate: false,
        };
      },
      { timeout: 15000 }
    );
  } catch (e) {
    // ★★★ সমান্তরাল retry — দুটি অনুরোধ একই `clientRef` নিয়ে একসাথে
    //     এলে উপরের "সস্তা পথ" দুটোতেই খালি দেখে। তখন একটি জেতে,
    //     অন্যটি এখানে P2002 পায় — এবং তার পুরো transaction
    //     **rollback** হয়ে যায়, অর্থাৎ ওয়ালেট দুবার কাটে না।
    //     জেতা অর্ডারটিই ফেরত দিই।
    if (clientRef && isUniqueViolation(e)) {
      const prior = await existingOrderResult(input.userId, clientRef);
      if (prior) return prior;
    }
    throw e;
  }
}

/**
 * ★ transaction-এর **বাইরের** কাজগুলো — বিজ্ঞপ্তি, ইমেইল, অডিট,
 *   ফুলফিলমেন্ট seam। সবগুলোই guarded: ব্যর্থ হলেও অর্ডার সফলই থাকে
 *   (টাকা ইতিমধ্যে commit হয়ে গেছে, তাই এখানে throw করলে গ্রাহক
 *   ভুল করে "ব্যর্থ" দেখতেন)।
 *
 * ⚠️ চ্যানেল-ভেদে আচরণ আলাদা, ইচ্ছাকৃতভাবে:
 *   `WEB` — গ্রাহক একটি করে অর্ডার করেন; বিজ্ঞপ্তি ও ইমেইল কাম্য।
 *   `API` — রিসেলার দিনে শত শত অর্ডার পাঠান। প্রতিটির জন্য ইন-অ্যাপ
 *   বিজ্ঞপ্তি ও ইমেইল পাঠালে তাঁর নিজের ইনবক্স ও নোটিফিকেশন-তালিকা
 *   অকেজো হয়ে যেত (এবং H4-এর পোলিং-চাপও বাড়ত)। API-তে **উত্তরটাই**
 *   রসিদ। অ্যাডমিন-বিজ্ঞপ্তি bulk রুট একবারে সারাংশ হিসেবে পাঠায়।
 */
export async function afterOrderPlaced(
  result: PlacedOrder,
  ctx: {
    channel: OrderChannel;
    user: { id: string; name: string; email: string };
    playerUid: string;
    ip?: string;
    userAgent?: string;
  },
): Promise<void> {
  // ★ পুনরাবৃত্ত অনুরোধে কিছুই ঘটেনি — তাই কোনো বিজ্ঞপ্তি, ইমেইল বা
  //   অডিট-এন্ট্রিও নয়। নাহলে একটি retry দেখতে ঠিক নতুন অর্ডারের
  //   মতো লাগত এবং অ্যাডমিন দুবার ডেলিভারি দিতেন।
  if (result.duplicate) return;

  // ★★★ Fulfillment interface seam (future-ready) — অর্ডার সার্ভিস কেবল
  //   `fulfillOrder()` ইন্টারফেসের সাথে কথা বলে, কোনো concrete প্রোভাইডার
  //   নয় (DIP)। আজ MANUAL ফেরে (config ও active provider দুটোই manual) →
  //   এই ব্লক কিছুই করে না, বর্তমান অর্ডার-প্রবাহ অপরিবর্তিত।
  try {
    const d = await fulfillOrder({
      orderId: result.orderId, productName: result.productName,
      variantName: result.variantName, playerUid: ctx.playerUid.trim(), quantity: 1,
    });
    if (d.status === 'DELIVERED') {
      // FUTURE: বিদ্যমান order-complete logic (admin/order route-এর মতো)।
    }
  } catch { /* fulfillment layer must never break the order flow */ }

  // ★ অডিট: গ্রাহক অর্ডার তৈরি করেছে (best-effort)
  logActivity({
    actorId: ctx.user.id, actorName: ctx.user.name, actorType: 'CUSTOMER', role: 'USER',
    action: 'ORDER_CREATE', targetId: result.orderId, amount: result.price,
    detail:
      `${result.productName} — ${result.variantName}` +
      (ctx.channel === 'API' ? ' (API)' : ''),
    ip: ctx.ip, userAgent: ctx.userAgent,
  }).catch(() => {});

  // ★ ফিচার ১৪ — এই অর্ডারে স্টক 0-এ নামলে অ্যাডমিনকে সতর্ক করি
  checkStockAlert(result.variantId).catch(() => {});

  if (ctx.channel !== 'WEB') return;

  // ★ guarded (defense-in-depth): notify নিজে throw করে না (ভেতরে
  //   try/catch), তবু .catch() রাখা — refactor-এ throw এলেও order/money
  //   commit-পরবর্তী ব্যর্থতা যেন ইউজারকে ভুল "ব্যর্থ" না দেখায়।
  notify(
    ctx.user.id,
    `অর্ডার #${result.orderNo} গ্রহণ করা হয়েছে`,
    `${result.productName} — ${result.variantName}। শীঘ্রই প্রসেস করা হবে।`,
    '/account/orders'
  ).catch(() => {});

  emailOrderPlaced(
    ctx.user.email, ctx.user.name, result.orderNo,
    result.productName, result.variantName, result.price.toFixed(2)
  ).catch(() => {});
}
