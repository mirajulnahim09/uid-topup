import { bulkOrderSchema, MAX_BULK_ITEMS } from '@/lib/validation';
import { apiError, ApiError, readJson } from '@/lib/guard';
import { requireApiKey } from '@/lib/apiKey';
import { rateLimit, peekRateLimit, LIMITS, getIp } from '@/lib/rateLimit';
import { notifyAdmins } from '@/lib/notify';
import { cleanText } from '@/lib/sanitize';
import { getSettings } from '@/lib/settings';
import { computeSlaDueAt, slaFromSettings } from '@/lib/sla';
import { placeOrder, afterOrderPlaced, type PlacedOrder } from '@/lib/services/order';
import { requestMeta } from '@/lib/adminLog';
import { logger } from '@/lib/logger';

/**
 * ★★★ F1 — ফাংশনের সময়সীমা স্পষ্ট করে বাঁধা। অর্ডারের পরেই অটো-ডেলিভারি await হয়
 *   (প্রোভাইডার-চেষ্টার সর্বোচ্চ যোগফল ≈ ৪৬s)। প্ল্যানের ডিফল্টের উপর ছেড়ে দিলে
 *   Hobby-র ১০s-এ মাঝপথে কেটে যেত। কাটলেও টাকা নিরাপদ (অর্ডার আগেই commit),
 *   আর অর্ডারটি `sweepStuckAutoFulfill()` "ফল অজানা" হিসেবে কিউতে ফেরায়।
 */
export const maxDuration = 60;

/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ রিসেলার bulk অর্ডার — API কী দিয়ে (Group F ৩)
 *
 *   `POST /api/reseller/orders`
 *   `Authorization: Bearer uidk_…`
 *   `{ "items": [ { "variantId": 7, "playerUid": "12345",
 *                   "clientRef": "my-order-991" } ] }`
 *
 *   ── নকশার তিনটি সিদ্ধান্ত, ও কেন ──
 *
 *   ১. **প্রতিটি আইটেম নিজের transaction।** পঞ্চম আইটেমে স্টক শেষ
 *      হলে আগের চারটি অর্ডার বাতিল হয়ে যাওয়া অগ্রহণযোগ্য — রিসেলার
 *      ইতিমধ্যে তাঁর গ্রাহককে কথা দিয়ে ফেলেছেন। তাই আংশিক সাফল্য
 *      একটি **বৈধ ফলাফল**, এবং প্রতিটি আইটেমের ফল আলাদাভাবে বলা হয়।
 *
 *   ২. **ক্রমিক, সমান্তরাল নয়।** সব আইটেম একই User রো লক করে, তাই
 *      সমান্তরাল চালালে তারা এমনিতেই একে অপরের জন্য অপেক্ষা করত —
 *      কেবল লক-চাপ ও deadlock-এর ঝুঁকি বাড়ত, গতি নয়।
 *
 *   ৩. **idempotency ঐচ্ছিক কিন্তু জোরালোভাবে প্রত্যাশিত।**
 *      `clientRef` দিলে retry নিরাপদ; না দিলে retry মানে সত্যিই
 *      নতুন অর্ডার। উত্তরে `idempotent: false` বলে দেওয়া হয়, যাতে
 *      এটি নীরব বিস্ময় না হয়।
 *
 *   ⚠️ HTTP স্ট্যাটাস: একটিও অর্ডার হলে **200**, একটিও না হলে **400**।
 *   সব ব্যর্থ হওয়ার পরেও 200 দিলে যে ক্লায়েন্ট কেবল স্ট্যাটাস দেখে
 *   (এবং অনেক ক্লায়েন্ট তাই দেখে) সে ভাবত সব ঠিক আছে।
 * ═══════════════════════════════════════════════════════════
 */

type ItemResult = {
  index: number;
  clientRef: string | null;
  status: 'CREATED' | 'DUPLICATE' | 'FAILED';
  orderId?: string;
  orderNo?: number;
  trackToken?: string | null;
  price?: number;
  reseller?: boolean;
  error?: string;
};

export async function POST(req: Request) {
  try {
    const ip = getIp(req);

    // ★ ধাপ ১ — ব্যর্থ-যাচাইয়ের বাকেট **আগে পড়ে দেখি** (সস্তা SELECT,
    //   গণনা বাড়ায় না)। এতে বৈধ রিসেলারের প্রতিটি কলে বাড়তি লেখা হয় না,
    //   অথচ কী-অনুমানকারী নির্দিষ্টসংখ্যক ব্যর্থতার পর আটকে যায়।
    const authGate = await peekRateLimit(`rslauth:${ip}`, LIMITS.resellerAuth.limit);
    if (authGate.limited) {
      throw new ApiError(
        `অনেকবার ভুল কী দেওয়া হয়েছে। ${authGate.retryAfter} সেকেন্ড পর চেষ্টা করুন।`,
        429,
      );
    }

    let actor;
    try {
      actor = await requireApiKey(req);
    } catch (e) {
      // ★ কেবল **ব্যর্থ** চেষ্টা গোনা হয় — সফল কল বাকেট ছোঁয় না,
      //   তাই বৈধ ব্যবহারকারী নিজের ট্রাফিক দিয়ে নিজেকে আটকাতে পারেন না
      //   (লগইন-পথে ঠিক এই বাগটিই একবার হয়েছিল)।
      await rateLimit(`rslauth:${ip}`, LIMITS.resellerAuth.limit, LIMITS.resellerAuth.window);
      throw e;
    }

    // ★ ধাপ ২ — কী-ভিত্তিক নিজস্ব সীমা। IP নয়, কারণ একই রিসেলারের
    //   সার্ভার বদলাতে পারে, আর একই IP-তে একাধিক রিসেলার থাকতে পারে।
    const rl = await rateLimit(
      `rsl:${actor.keyId}`,
      LIMITS.resellerBulk.limit,
      LIMITS.resellerBulk.window,
    );
    if (!rl.ok) {
      throw new ApiError(
        `অনেক বেশি অনুরোধ। ${rl.retryAfter} সেকেন্ড পর চেষ্টা করুন।`,
        429,
      );
    }

    const parsed = bulkOrderSchema.safeParse(await readJson(req));
    if (!parsed.success) throw new ApiError(parsed.error.errors[0].message, 400);

    const items = parsed.data.items;

    // ★ একই অনুরোধে একই clientRef দুবার — **পুরো অনুরোধ প্রত্যাখ্যান**।
    //   নাহলে দ্বিতীয়টি নীরবে "DUPLICATE" ফিরত এবং রিসেলার ভাবতেন
    //   দুটি অর্ডার হয়েছে, অথচ হয়েছে একটি। এটি টাইপো ধরার জায়গা,
    //   অনুমান করার জায়গা নয়।
    const refs = items.map((i) => i.clientRef).filter(Boolean) as string[];
    if (new Set(refs).size !== refs.length) {
      throw new ApiError('একই clientRef একাধিকবার পাঠানো হয়েছে', 400);
    }

    // ★ ডেলিভারির ডেডলাইন — পুরো ব্যাচে **একটিই** হিসাব। ব্যাচের
    //   প্রতিটি অর্ডার একই মুহূর্তে গৃহীত, তাই প্রতিশ্রুতিও এক।
    const slaDueAt = computeSlaDueAt(slaFromSettings(await getSettings()));
    const meta = requestMeta(req);

    const results: ItemResult[] = [];
    const placed: Array<{ result: PlacedOrder; playerUid: string }> = [];
    let latestBalance: number | null = null;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const clientRef = item.clientRef ?? null;

      try {
        const result = await placeOrder({
          userId: actor.user.id,
          variantId: item.variantId,
          playerUid: item.playerUid,
          playerName: item.playerName ? cleanText(item.playerName, 80) : null,
          couponCode: item.couponCode,
          slaDueAt,
          clientRef,
        });

        latestBalance = result.newBalance;
        if (!result.duplicate) placed.push({ result, playerUid: item.playerUid });

        results.push({
          index: i,
          clientRef,
          status: result.duplicate ? 'DUPLICATE' : 'CREATED',
          orderId: result.orderId,
          orderNo: result.orderNo,
          trackToken: result.trackToken,
          price: result.price,
          reseller: result.reseller,
        });
      } catch (e) {
        // ★ একটি আইটেমের ব্যর্থতা পরেরটিকে থামায় না — ব্যালেন্স ফুরিয়ে
        //   গেলেও পরের সস্তা আইটেমটি সফল হতে পারে, আর রিসেলারের সেটা
        //   জানা দরকার। ⚠️ কেবল `ApiError`-এর বার্তা বাইরে যায়;
        //   অপ্রত্যাশিত ত্রুটির ভেতরকার কথা কখনো নয়।
        if (e instanceof ApiError) {
          results.push({ index: i, clientRef, status: 'FAILED', error: e.message });
        } else {
          logger.error('resellerBulk', 'unexpected item failure', {
            userId: actor.user.id, index: i, err: e,
          });
          results.push({
            index: i, clientRef, status: 'FAILED',
            error: 'সার্ভারে সমস্যা হয়েছে। আবার চেষ্টা করুন।',
          });
        }
      }
    }

    // ── commit-পরবর্তী কাজ — টাকা ইতিমধ্যে নিরাপদে বসে গেছে ──
    for (const p of placed) {
      await afterOrderPlaced(p.result, {
        channel: 'API',
        user: actor.user,
        playerUid: p.playerUid,
        ...meta,
      });
    }

    // ★ অ্যাডমিনকে **একটিই** সারাংশ, প্রতি অর্ডারে একটি নয়। ২০টি
    //   অর্ডারে ২০টি টেলিগ্রাম বার্তা মানে গুরুত্বপূর্ণ সতর্কতাগুলো
    //   ঐ বন্যায় হারিয়ে যাওয়া।
    if (placed.length > 0) {
      const total = placed.reduce((s, p) => s + p.result.price, 0);
      notifyAdmins(
        'রিসেলার অর্ডার',
        `${actor.user.name} — ${placed.length}টি অর্ডার (৳${total.toFixed(2)}) · কী: ${actor.keyLabel}`,
        '/admin/orders',
        'order_new',
      ).catch(() => {});
    }

    const created = results.filter((r) => r.status === 'CREATED').length;
    const duplicate = results.filter((r) => r.status === 'DUPLICATE').length;
    const failed = results.filter((r) => r.status === 'FAILED').length;

    return Response.json(
      {
        success: created + duplicate > 0,
        summary: { total: results.length, created, duplicate, failed, maxItems: MAX_BULK_ITEMS },
        // ★ ব্যাচ শেষের ব্যালেন্স — রিসেলার পরের ব্যাচের আগে জানতে চান
        //   আর কত বাকি। কোনো অর্ডারই না হলে অজানা, তাই `null`।
        balance: latestBalance === null ? null : latestBalance.toFixed(2),
        // ★ idempotency ব্যবহৃত হয়েছে কি না — স্পষ্ট করে বলা, যাতে
        //   "retry নিরাপদ" ধরে নেওয়া কখনো নীরব অনুমান না হয়
        idempotent: refs.length === items.length,
        results,
      },
      { status: created + duplicate > 0 ? 200 : 400 },
    );
  } catch (e) {
    return apiError(e);
  }
}
