import type {
  PaymentProvider, PaymentIntent, VerifyOutcome, RefundOutcome,
  WebhookRequest, WebhookParseResult,
} from '../types';
import { logger } from '../../logger';
import { resolveKey, getProviderConfig } from '../config';
import { isPreviewDeployment } from '../../deploymentEnv';

/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ SSLCommerz — বাংলাদেশের প্রধান পেমেন্ট অ্যাগ্রিগেটর
 *
 *   একটি ইন্টিগ্রেশনেই bKash / Nagad / Rocket / কার্ড — তাই
 *   RUN.md এটিকেই প্রথমে রেখেছে।
 *
 *   ── সবচেয়ে গুরুত্বপূর্ণ নকশা-সিদ্ধান্ত: IPN বিশ্বাস করা হয় না ──
 *
 *   IPN একটি **অননুমোদিত** POST — যে কেউ আমাদের webhook URL-এ
 *   `status=VALID&amount=99999` পাঠাতে পারে। তাই payload-এর কোনো
 *   মান দিয়ে সিদ্ধান্ত নেওয়া হয় না।
 *
 *   ⚠️ SSLCommerz-এর `verify_sign`/`verify_key` ক্ষেত্র দুটি আছে,
 *   কিন্তু তার হ্যাশ-অ্যালগরিদম **অফিসিয়াল ডকুমেন্টেশনে বর্ণিত নেই**
 *   (developer.sslcommerz.com/doc/v4 কেবল ক্ষেত্রের নাম দেয়)। এবং
 *   SSLCommerz-এর **নিজের** WooCommerce প্লাগইন ঐ স্বাক্ষর যাচাই
 *   করেই না — সে সরাসরি ভ্যালিডেশন API-তে ফিরে জিজ্ঞেস করে।
 *   অননুমোদিত সূত্র থেকে পাওয়া অ্যালগরিদম অনুমান করে বসানো মানে
 *   একটি **মিথ্যা নিরাপত্তা** তৈরি করা — CLAUDE.md §6 স্পষ্ট নিষেধ
 *   করে ("invent an API contract … you have not read the docs for")।
 *
 *   তাই সত্যের একমাত্র উৎস **server-to-server ভ্যালিডেশন API**:
 *   IPN থেকে কেবল `val_id` নেওয়া হয় (একটি অস্বচ্ছ handle), তারপর
 *   আমাদের store credentials দিয়ে SSLCommerz-কে সরাসরি জিজ্ঞেস করা
 *   হয় "এই লেনদেনটি আসলে কী?"। টাকার অঙ্ক, মুদ্রা ও tran_id — সব
 *   **ঐ উত্তর থেকেই** আসে, IPN থেকে নয়। ফলে জাল IPN পাঠিয়ে কিছু
 *   করা যায় না: val_id ভুয়া হলে ভ্যালিডেশন INVALID বলে।
 *
 *   ── সূত্র (পঠিত) ──
 *   · https://developer.sslcommerz.com/doc/v4/ — সেশন, IPN, ভ্যালিডেশন
 *   · github.com/sslcommerz/SSLCommerz-Woocommerce — অফিসিয়াল রেফারেন্স
 *     বাস্তবায়ন, যা verify_sign ব্যবহার না করে ভ্যালিডেশন API ডাকে
 * ═══════════════════════════════════════════════════════════
 */

const HOSTS = {
  test: 'https://sandbox.sslcommerz.com',
  live: 'https://securepay.sslcommerz.com',
} as const;

/** ★ ভ্যালিডেশন-উত্তরে এই দুটিই "টাকা সত্যিই এসেছে" বোঝায় */
const VALID_STATUSES = new Set(['VALID', 'VALIDATED']);

export type SslczValidation = {
  status?: string;
  tran_id?: string;
  val_id?: string;
  amount?: string | number;
  currency?: string;
  currency_type?: string;
  bank_tran_id?: string;
  risk_level?: string | number;
  error?: string;
};

/**
 * ★ নেটওয়ার্ক কল আলাদা করে রাখা — টেস্টে mock সার্ভারের দিকে
 *   দেখানো যায় (`SSLCZ_BASE_URL`), তাই ইন্টিগ্রেশন সত্যিকারের HTTP
 *   পথেই পরীক্ষা হয়, ফাংশন stub করে নয়।
 */
async function baseUrl(): Promise<string> {
  // ★ O-15 — Preview সবসময় sandbox; live গেটওয়েতে কখনো নয় (override-ও নয়)
  if (isPreviewDeployment()) return HOSTS.test;
  const override = process.env.SSLCZ_BASE_URL;
  if (override) return override.replace(/\/$/, '');
  const cfg = await getProviderConfig('sslcommerz');
  return HOSTS[cfg.mode === 'live' ? 'live' : 'test'];
}

async function credentials(): Promise<{ storeId: string; storePasswd: string } | null> {
  const [storeId, storePasswd] = await Promise.all([
    resolveKey('sslcommerz', 'SSLCZ_STORE_ID'),
    resolveKey('sslcommerz', 'SSLCZ_STORE_PASSWD'),
  ]);
  if (!storeId || !storePasswd) return null;
  return { storeId, storePasswd };
}

/**
 * ★★★ ভ্যালিডেশন API — সত্যের একমাত্র উৎস।
 *   GET /validator/api/validationserverAPI.php?val_id=…&store_id=…&store_passwd=…&format=json
 */
export async function validateByValId(valId: string): Promise<SslczValidation | null> {
  const creds = await credentials();
  if (!creds) {
    logger.error('sslcommerz', 'validation skipped — credentials missing');
    return null;
  }

  const url = new URL(`${await baseUrl()}/validator/api/validationserverAPI.php`);
  url.searchParams.set('val_id', valId);
  url.searchParams.set('store_id', creds.storeId);
  url.searchParams.set('store_passwd', creds.storePasswd);
  url.searchParams.set('format', 'json');

  try {
    // ★ টাইমআউট — গেটওয়ে ঝুলে গেলে আমাদের webhook হ্যান্ডলারও ঝুলত,
    //   আর SSLCommerz retry পাঠাত (অকারণ চাপ)
    const res = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      logger.error('sslcommerz', 'validation http error', { status: res.status });
      return null;
    }
    return (await res.json()) as SslczValidation;
  } catch (e) {
    // ⚠️ ব্যর্থ হলে `null` — কখনো "সফল" ধরে নেওয়া হয় না।
    //   নেটওয়ার্ক সমস্যায় টাকা জমা হওয়া সবচেয়ে খারাপ ফল।
    logger.error('sslcommerz', 'validation failed', { err: e });
    return null;
  }
}

/** ★ IPN বডি form-encoded আসে (JSON নয়) */
function parseForm(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(raw)) out[k] = v;
  return out;
}

export function sslcommerzProvider(): PaymentProvider {
  return {
    id: 'sslcommerz',
    label: 'SSLCommerz',
    kind: 'GATEWAY',
    capabilities: { autoVerify: true, autoRefund: false, hostedCheckout: true },
    keyFields: ['SSLCZ_STORE_ID', 'SSLCZ_STORE_PASSWD'],

    isConfigured: () =>
      Boolean(process.env.SSLCZ_STORE_ID && process.env.SSLCZ_STORE_PASSWD),

    /**
     * ★ গ্রাহক ফিরে আসার পর (success_url) যাচাই।
     *   `customerTrxId` এখানে SSLCommerz-এর `val_id`।
     */
    async verify(intent: PaymentIntent): Promise<VerifyOutcome> {
      const valId = intent.customerTrxId;
      if (!valId) return { status: 'PENDING_MANUAL' };

      const v = await validateByValId(valId);
      if (!v) return { status: 'FAILED', reason: 'যাচাই করা যায়নি — পরে আবার চেষ্টা হবে' };

      if (!VALID_STATUSES.has(String(v.status || '').toUpperCase())) {
        return { status: 'FAILED', reason: `গেটওয়ে status=${v.status ?? 'অজানা'}` };
      }

      // ★★★ tran_id মিলতেই হবে — নাহলে একজনের val_id দিয়ে
      //   অন্যের অর্ডার "পরিশোধিত" দেখানো যেত
      if (String(v.tran_id ?? '') !== intent.reference) {
        return { status: 'FAILED', reason: 'লেনদেন আইডি মেলেনি' };
      }

      return {
        status: 'VERIFIED',
        providerRef: String(v.bank_tran_id || v.val_id || valId),
        // ★ অঙ্ক **ভ্যালিডেশন উত্তর** থেকে — গ্রাহক/IPN থেকে নয়
        amount: Number(v.amount ?? 0),
      };
    },

    /**
     * ⚠️ SSLCommerz-এর রিফান্ড API আলাদা merchant অনুমোদন চায় এবং
     *   তার চুক্তি আমরা পড়িনি। অনুমান করে বসানোর চেয়ে ম্যানুয়াল
     *   পথে ফেরত দেওয়াই সৎ — বিদ্যমান রিফান্ড প্রবাহ অক্ষত থাকে।
     */
    async refund(): Promise<RefundOutcome> {
      return { status: 'MANUAL' };
    },

    /**
     * ★★★ IPN → যাচাইকৃত ইভেন্ট।
     *
     *   payload-এর `status`/`amount` **উপেক্ষিত**; কেবল `val_id`
     *   নেওয়া হয় ও ভ্যালিডেশন API-র উত্তরই চূড়ান্ত।
     */
    async parseWebhook(req: WebhookRequest): Promise<WebhookParseResult> {
      const body = parseForm(req.rawBody);
      const valId = body.val_id?.trim();
      const tranId = body.tran_id?.trim();

      if (!tranId) return { ok: false, reason: 'tran_id নেই' };

      // ★ val_id ছাড়া যাচাইয়ের কোনো উপায় নেই → বিশ্বাস করা যাবে না।
      //   ব্যর্থ/বাতিল IPN-এ val_id থাকে না, সেটিই স্বাভাবিক।
      if (!valId) {
        const st = String(body.status || '').toUpperCase();
        if (st && st !== 'VALID') {
          return {
            ok: true,
            eventId: `${tranId}:${st}`,
            event: { type: 'PAYMENT_FAILED', reference: tranId, reason: `গেটওয়ে status=${st}` },
          };
        }
        // ★ status=VALID অথচ val_id নেই — জাল IPN-এর চেনা রূপ
        return { ok: false, reason: 'val_id নেই — যাচাই অসম্ভব', unauthorized: true };
      }

      const v = await validateByValId(valId);
      if (!v) {
        // ⚠️ ৪০০/৫০০ ফেরত দিলে SSLCommerz আবার পাঠাবে — সেটাই কাম্য,
        //   কারণ এটি সাময়িক ব্যর্থতা হতে পারে। "সফল" ধরা যাবে না।
        return { ok: false, reason: 'ভ্যালিডেশন API সাড়া দেয়নি' };
      }

      const status = String(v.status || '').toUpperCase();
      if (!VALID_STATUSES.has(status)) {
        return {
          ok: true,
          eventId: `${valId}:${status}`,
          event: { type: 'PAYMENT_FAILED', reference: tranId, reason: `status=${status}` },
        };
      }

      // ★★★ ভ্যালিডেশনের tran_id-ই আসল; IPN-এর টা নয়
      const authoritativeRef = String(v.tran_id ?? '');
      if (!authoritativeRef) return { ok: false, reason: 'ভ্যালিডেশনে tran_id নেই' };
      if (tranId && authoritativeRef !== tranId) {
        // ★ IPN আর ভ্যালিডেশন আলাদা লেনদেন বলছে — সরাসরি প্রত্যাখ্যান
        logger.error('sslcommerz', 'IPN/validation tran_id mismatch', {
          ipn: tranId, validated: authoritativeRef,
        });
        return { ok: false, reason: 'tran_id অমিল', unauthorized: true };
      }

      return {
        ok: true,
        // ★ val_id প্রতি-লেনদেনে অনন্য → idempotency key হিসেবে সঠিক।
        //   receiver এটি দিয়েই replay আটকায়।
        eventId: valId,
        event: {
          type: 'PAYMENT_SUCCEEDED',
          reference: authoritativeRef,
          providerRef: String(v.bank_tran_id || valId),
          amount: Number(v.amount ?? 0),
        },
      };
    },
  };
}

/** ★ O-15 টেস্টের জন্য — কোন হোস্টে কল যায় */
export const sslcommerzBaseUrl = baseUrl;
