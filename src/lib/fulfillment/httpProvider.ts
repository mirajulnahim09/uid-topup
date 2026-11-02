import type { Delivery, FulfillmentJob, FulfillmentProvider } from '../integrations/types';
import { logger } from '../logger';
import { isPreviewDeployment, PREVIEW_OUTBOUND_BLOCKED } from '../deploymentEnv';

/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ Group G — HTTP ফুলফিলমেন্ট অ্যাডাপ্টার
 *
 *   ⚠️⚠️ **কোনো নির্দিষ্ট প্রোভাইডারের ডকুমেন্টেশন পড়ে এটি লেখা হয়নি,
 *   কারণ মালিক এখনো কোনো ডেলিভারি-প্রোভাইডার বেছে নেননি।** RUN.md
 *   §GROUP G এই অবস্থার জন্য স্পষ্ট নির্দেশ দিয়েছে: অ্যাডাপ্টার
 *   ইন্টারফেস ও একটি mock বাস্তবায়ন বানাও, "blocked" চিহ্নিত করো,
 *   এগিয়ে যাও। তাই নিচের চুক্তিটি **আমাদের নিজেদের**, অনুমান করা
 *   কোনো তৃতীয় পক্ষের API নয় — আসল প্রোভাইডার এলে তার API-কে এই
 *   চুক্তিতে ম্যাপ করার জন্য একটি পাতলা স্তর লিখতে হবে, এই ফাইলের
 *   বাকি যুক্তি (retry, timeout, idempotency) অপরিবর্তিত থাকবে।
 *   ⚠️ CLAUDE.md §6: "invent an API contract for a third-party service
 *   you have not read the docs for" — তাই এটি স্পষ্টভাবে **নিজের**
 *   চুক্তি হিসেবে ঘোষিত, কারও API নকল করার দাবি নয়।
 *
 *   ── চুক্তি ──
 *   POST $GAME_API_URL
 *     Authorization: Bearer $GAME_API_KEY
 *     Idempotency-Key: ord_<orderId>
 *     { orderId, product, variant, playerUid, quantity, idempotencyKey }
 *
 *   উত্তর (HTTP 200 বা 409):
 *     { "status": "delivered", "ref": "<প্রোভাইডারের রেফারেন্স>" }
 *     { "status": "failed", "reason": "...", "retryable": true|false }
 *
 *   ── HTTP → Delivery ম্যাপিং, ও কেন ──
 *   | পরিস্থিতি | ফল | কারণ |
 *   |---|---|---|
 *   | 200/409 + delivered | DELIVERED | 409 = "এই কী আগেই দেখেছি" — idempotent retry-র সঠিক উত্তর |
 *   | 200/409 + failed | FAILED (retryable প্রোভাইডার যা বলে) | স্পষ্ট "হয়নি" |
 *   | 5xx / সংযোগ ব্যর্থ | FAILED, retryable | অনুরোধ প্রোভাইডারে পৌঁছায়নি বা সে নিজেই ভেঙেছে |
 *   | 4xx (409 ছাড়া) | FAILED, **retryable নয়** | ভুল কী/ভুল payload — আবার পাঠালে একই ভুল |
 *   | টাইমআউট / abort | **UNKNOWN** | ডেলিভারি হয়ে থাকতে পারে — retry মানে দুবার পাঠানোর ঝুঁকি |
 *   | বিকৃত JSON | UNKNOWN | সার্ভার কী করেছে জানার উপায় নেই |
 *
 *   শেষ তিনটি সারিই এই ফাইলের আসল মূল্য। "সব ব্যর্থতা = আবার চেষ্টা"
 *   ধরে নিলে টাইমআউটের ক্ষেত্রে গ্রাহক দুবার ডায়মন্ড পেতেন এবং
 *   দোকান দ্বিগুণ খরচ করত — ডাটাবেসে যার কোনো চিহ্নই থাকত না।
 * ═══════════════════════════════════════════════════════════
 */

/** ★ অর্ডার-প্রতি স্থির কী — retry-তে হুবহু একই মান যায় */
export function idempotencyKeyFor(orderId: string): string {
  return `ord_${orderId}`;
}

function timeoutMs(): number {
  const raw = Number(process.env.GAME_API_TIMEOUT_MS);
  // ★ ১৫s — এর বেশি ধরে রাখলে অর্ডার-অনুরোধই ঝুলে থাকত
  return Number.isFinite(raw) && raw > 0 ? raw : 15_000;
}

type ProviderBody = { status?: string; ref?: string; reason?: string; retryable?: boolean };

export const httpFulfillment: FulfillmentProvider = {
  id: 'game-api',
  label: 'গেম প্রোভাইডার API',
  category: 'fulfillment',
  kind: 'GATEWAY',

  // ★ দুটোই লাগে। URL আছে কিন্তু কী নেই — এমন অর্ধেক কনফিগে চালু হলে
  //   প্রতিটি অর্ডার ৪০১ পেয়ে ম্যানুয়াল কিউতে ফিরত, নীরবে।
  isConfigured: () => Boolean(process.env.GAME_API_URL && process.env.GAME_API_KEY),

  async deliver(job: FulfillmentJob): Promise<Delivery> {
    // ★ O-15 — Preview কখনো আসল টপ-আপ পাঠায় না; অর্ডার ম্যানুয়াল কিউতে
    if (isPreviewDeployment()) return { status: 'MANUAL', reason: PREVIEW_OUTBOUND_BLOCKED };
    const url = process.env.GAME_API_URL;
    const key = process.env.GAME_API_KEY;
    if (!url || !key) return { status: 'MANUAL', reason: 'প্রোভাইডার কনফিগার করা নেই' };

    const idem = idempotencyKeyFor(job.orderId);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs());

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
          // ★ প্রোভাইডার এটি মানলে আমাদের retry তার দিকেও নিরাপদ
          'Idempotency-Key': idem,
        },
        body: JSON.stringify({
          orderId: job.orderId,
          product: job.productName,
          variant: job.variantName,
          playerUid: job.playerUid,
          quantity: job.quantity,
          idempotencyKey: idem,
        }),
        signal: controller.signal,
      });
    } catch (e) {
      const aborted = e instanceof Error && e.name === 'AbortError';
      logger.error('fulfill', aborted ? 'provider timeout' : 'provider unreachable', {
        orderId: job.orderId,
      });
      // ★★★ টাইমআউট ≠ ব্যর্থতা। সংযোগ **স্থাপিতই হয়নি** হলে অন্য কথা —
      //   তখন প্রোভাইডার অনুরোধটি দেখেইনি, তাই আবার চেষ্টা নিরাপদ।
      return aborted
        ? { status: 'UNKNOWN', reason: 'প্রোভাইডার সময়মতো উত্তর দেয়নি' }
        : { status: 'FAILED', reason: 'প্রোভাইডারে পৌঁছানো যায়নি', retryable: true };
    } finally {
      clearTimeout(timer);
    }

    let body: ProviderBody = {};
    let parsed = true;
    try {
      body = (await res.json()) as ProviderBody;
    } catch {
      parsed = false;
    }

    if (res.status >= 500) {
      return { status: 'FAILED', reason: `প্রোভাইডার ত্রুটি (${res.status})`, retryable: true };
    }

    if (!parsed) {
      // ★ ২০০ এসেছে কিন্তু বডি পড়া যায়নি — ডেলিভারি হয়েছে কি না অজানা
      return { status: 'UNKNOWN', reason: 'প্রোভাইডারের উত্তর বোঝা যায়নি' };
    }

    // ★ 409 = "এই idempotency key আগেই প্রক্রিয়া করেছি" — বডিতে আসল ফল
    if (res.ok || res.status === 409) {
      if (body.status === 'delivered') {
        return { status: 'DELIVERED', ref: String(body.ref ?? idem) };
      }
      if (body.status === 'failed') {
        return {
          status: 'FAILED',
          reason: String(body.reason ?? 'প্রোভাইডার ডেলিভারি করতে পারেনি'),
          // ★ প্রোভাইডার স্পষ্ট না বললে আবার চেষ্টা **করি না** —
          //   ডিফল্ট নিরাপদ দিক হলো থেমে যাওয়া
          retryable: body.retryable === true,
        };
      }
      return { status: 'UNKNOWN', reason: `অজানা status: ${String(body.status)}` };
    }

    // ★ বাকি 4xx — payload/কী ভুল। আবার পাঠালে হুবহু একই উত্তর আসবে।
    return {
      status: 'FAILED',
      reason: String(body.reason ?? `প্রোভাইডার প্রত্যাখ্যান করেছে (${res.status})`),
      retryable: false,
    };
  },
};
