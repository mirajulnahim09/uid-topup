import { timingSafeEqual } from 'crypto';
import type {
  PaymentProvider, PaymentIntent, VerifyOutcome, RefundOutcome,
  WebhookRequest, WebhookParseResult,
} from '../types';
import { logger } from '../../logger';
import { computeHmac } from '../webhookSignature';
import { resolveKey } from '../config';

/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ Stripe — কার্ড (আন্তর্জাতিক)
 *
 *   ── SSLCommerz-এর ঠিক বিপরীত অবস্থা ──
 *   SSLCommerz-এ স্বাক্ষর-অ্যালগরিদম ডকুমেন্টেড **নয়**, তাই সেখানে
 *   স্বাক্ষর বাদ দিয়ে ভ্যালিডেশন API-কে সত্য ধরা হয়েছে। Stripe-এ
 *   উল্টো: স্বাক্ষর-স্কিম **সম্পূর্ণ ও স্পষ্টভাবে** ডকুমেন্টেড, তাই
 *   এখানে সঠিকভাবে যাচাই করাই সঠিক পথ — অনুমানের দরকার নেই।
 *
 *   ── স্কিম (docs.stripe.com/webhooks#verify-manually) ──
 *     হেডার:  `Stripe-Signature: t=<ts>,v1=<sig>,v0=<fake>`
 *     payload: `${t}.${rawBody}`
 *     স্বাক্ষর: HMAC-SHA256(payload, whsec_…) → hex
 *
 *   ⚠️⚠️ তিনটি সূক্ষ্ম কিন্তু গুরুত্বপূর্ণ বিষয়, তিনটিই ডকে স্পষ্ট:
 *
 *   ১. **`v0` কখনো গ্রহণ নয়।** Stripe টেস্ট-ইভেন্টে একটি *জাল* `v0`
 *      স্বাক্ষর পাঠায়। "যেকোনো একটি মিললেই হলো" ধরনের কোড লিখলে
 *      downgrade-আক্রমণের পথ খুলে যেত। ডক স্পষ্ট বলে: `v1` ছাড়া
 *      সব স্কিম **উপেক্ষা** করুন।
 *
 *   ২. **একাধিক `v1` থাকতে পারে।** secret roll করার সময় Stripe ২৪
 *      ঘণ্টা পর্যন্ত দুটি secret সক্রিয় রাখে ও প্রতিটির জন্য আলাদা
 *      স্বাক্ষর পাঠায়। কেবল প্রথমটি দেখলে রোলিং-এর সময় বৈধ ইভেন্ট
 *      প্রত্যাখ্যাত হতো।
 *
 *   ৩. **timestamp সহনশীলতা ৩০০s** — replay protection। `t` স্বাক্ষরের
 *      **ভেতরে** আছে, তাই আক্রমণকারী সেটি বদলাতে পারে না; কিন্তু
 *      পুরনো বৈধ payload পুনরায় পাঠাতে পারে। tolerance সেটিই আটকায়।
 *      ⚠️ ডক স্পষ্ট নিষেধ করে tolerance = 0 (তাতে যাচাইটাই নিষ্ক্রিয়)।
 *
 *   ── অঙ্ক ──
 *   ⚠️ Stripe অঙ্ক দেয় **সবচেয়ে ছোট একক**-এ (BDT-তে পয়সা, USD-তে
 *   সেন্ট)। ১০০ দিয়ে ভাগ না করলে গ্রাহক ১০০ গুণ বেশি ক্রেডিট পেতেন।
 * ═══════════════════════════════════════════════════════════
 */

/** ★ ডকুমেন্টেড ডিফল্ট — ৫ মিনিট */
const TOLERANCE_SEC = 300;

/** ★ কোন ইভেন্টগুলো "টাকা এসেছে" বোঝায় */
const SUCCESS_EVENTS = new Set(['payment_intent.succeeded', 'checkout.session.completed']);
const FAILURE_EVENTS = new Set([
  'payment_intent.payment_failed',
  'payment_intent.canceled',
  'checkout.session.expired',
]);

type StripeEvent = {
  id?: string;
  type?: string;
  data?: { object?: Record<string, unknown> };
};

/** ★ `t=…,v1=…,v1=…,v0=…` → timestamp ও **কেবল v1** স্বাক্ষরগুলো */
export function parseStripeSignature(header: string): { t: number; v1: string[] } | null {
  if (!header) return null;
  let t = NaN;
  const v1: string[] = [];

  for (const part of header.split(',')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === 't') t = Number(value);
    // ★ v0 ইচ্ছাকৃতভাবে উপেক্ষিত — এটি টেস্ট-ইভেন্টের জাল স্বাক্ষর
    else if (key === 'v1') v1.push(value);
  }

  if (!Number.isFinite(t) || v1.length === 0) return null;
  return { t, v1 };
}

/** ★ hex স্বাক্ষরের timing-safe তুলনা */
function matchesAny(expected: string, received: string[]): boolean {
  const a = Buffer.from(expected, 'utf8');
  let ok = false;
  for (const sig of received) {
    const b = Buffer.from(sig, 'utf8');
    // ⚠️ শর্ট-সার্কিট নয় — সব স্বাক্ষর যাচাই করি যাতে সময়ের
    //   পার্থক্য থেকে কিছু অনুমান করা না যায়
    if (a.length === b.length && timingSafeEqual(a, b)) ok = true;
  }
  return ok;
}

/** ★ আমাদের নিজস্ব reference (deposit/order নং) কোথায় থাকে */
function extractReference(obj: Record<string, unknown>): string {
  const meta = (obj.metadata ?? {}) as Record<string, unknown>;
  const fromMeta = typeof meta.reference === 'string' ? meta.reference : '';
  const clientRef = typeof obj.client_reference_id === 'string' ? obj.client_reference_id : '';
  return (fromMeta || clientRef).trim();
}

/**
 * ★ ক্ষুদ্রতম একক → প্রধান একক।
 *   ⚠️ zero-decimal মুদ্রা (JPY ইত্যাদি) Stripe-এ ভাগ হয় না, কিন্তু
 *   এই দোকান কেবল BDT নেয় — তাই সরল ও সঠিক রাখা হলো।
 */
function toMajorUnit(minor: unknown): number {
  const n = Number(minor ?? 0);
  return Number.isFinite(n) ? Math.round(n) / 100 : 0;
}

export function stripeProvider(): PaymentProvider {
  return {
    id: 'stripe',
    label: 'Stripe',
    kind: 'GATEWAY',
    capabilities: { autoVerify: true, autoRefund: true, hostedCheckout: true },
    keyFields: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'],

    isConfigured: () =>
      Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET),

    /**
     * ⚠️ সিঙ্ক্রোনাস verify এখনো নেই — Stripe-এ সত্যের উৎস webhook
     *   (`payment_intent.succeeded`), গ্রাহকের ফিরে আসা নয়। গ্রাহক
     *   ব্রাউজার বন্ধ করে দিলেও webhook আসে, তাই সেটিই নির্ভরযোগ্য।
     */
    async verify(_intent: PaymentIntent): Promise<VerifyOutcome> {
      return { status: 'PENDING_MANUAL' };
    },

    /**
     * ⚠️ Stripe রিফান্ড API আছে ও ডকুমেন্টেড, কিন্তু এটি টাকা **বের
     *   করে** — একটি নতুন money path। বিদ্যমান ম্যানুয়াল রিফান্ড
     *   প্রবাহ প্রমাণিত ও পরীক্ষিত; সেটিকে অটোমেট করার আগে আসল
     *   ক্রেডেনশিয়ালে end-to-end যাচাই দরকার।
     */
    async refund(): Promise<RefundOutcome> {
      return { status: 'MANUAL' };
    },

    async parseWebhook(req: WebhookRequest): Promise<WebhookParseResult> {
      const secret = await resolveKey('stripe', 'STRIPE_WEBHOOK_SECRET');
      if (!secret) {
        // ⚠️ secret ছাড়া যাচাই অসম্ভব → কখনো গ্রহণ নয়
        logger.error('stripe', 'webhook secret missing — rejecting');
        return { ok: false, reason: 'webhook secret কনফিগার করা নেই', unauthorized: true };
      }

      const header =
        req.headers['stripe-signature'] || req.headers['Stripe-Signature'] || '';
      const parsed = parseStripeSignature(String(header));
      if (!parsed) {
        return { ok: false, reason: 'Stripe-Signature হেডার নেই বা ভুল', unauthorized: true };
      }

      // ★★★ replay protection — স্বাক্ষর বৈধ হলেও পুরনো হলে বাতিল
      const ageSec = Math.abs(Math.floor(Date.now() / 1000) - parsed.t);
      if (ageSec > TOLERANCE_SEC) {
        logger.warn('stripe', 'webhook rejected — timestamp outside tolerance', { ageSec });
        return { ok: false, reason: 'ইভেন্টটি অনেক পুরনো (replay?)', unauthorized: true };
      }

      // ★★★ স্বাক্ষর — payload হলো `${t}.${rawBody}`, কাঁচা বডি দিয়ে
      const expected = computeHmac(`${parsed.t}.${req.rawBody}`, secret, 'sha256');
      if (!matchesAny(expected, parsed.v1)) {
        return { ok: false, reason: 'স্বাক্ষর মেলেনি', unauthorized: true };
      }

      // ── স্বাক্ষর বৈধ; এখন বডি পড়া নিরাপদ ──
      let event: StripeEvent;
      try {
        event = JSON.parse(req.rawBody) as StripeEvent;
      } catch {
        return { ok: false, reason: 'JSON পার্স হয়নি' };
      }

      const eventId = String(event.id ?? '');
      const type = String(event.type ?? '');
      if (!eventId) return { ok: false, reason: 'event id নেই' };

      const obj = (event.data?.object ?? {}) as Record<string, unknown>;

      if (SUCCESS_EVENTS.has(type)) {
        const reference = extractReference(obj);
        if (!reference) {
          // ⚠️ কোন ডিপোজিটের টাকা তা না জানলে ক্রেডিট করা অসম্ভব —
          //   নীরবে ফেলে না দিয়ে স্পষ্ট ত্রুটি, যাতে ধরা পড়ে
          logger.error('stripe', 'success event without reference', { eventId, type });
          return { ok: false, reason: 'reference (metadata) নেই' };
        }

        // ★ checkout.session → amount_total; payment_intent → amount_received/amount
        const minor =
          type === 'checkout.session.completed'
            ? obj.amount_total
            : (obj.amount_received ?? obj.amount);

        return {
          ok: true,
          eventId, // ★ Stripe event id — idempotency-র জন্য ডকেই সুপারিশকৃত
          event: {
            type: 'PAYMENT_SUCCEEDED',
            reference,
            providerRef: String(obj.id ?? eventId),
            amount: toMajorUnit(minor),
          },
        };
      }

      if (FAILURE_EVENTS.has(type)) {
        const reference = extractReference(obj);
        return {
          ok: true,
          eventId,
          event: {
            type: 'PAYMENT_FAILED',
            reference: reference || String(obj.id ?? eventId),
            reason: type,
          },
        };
      }

      // ★ Stripe বহু ধরনের ইভেন্ট পাঠায় — বাকিগুলো নিরাপদে উপেক্ষা
      return { ok: true, eventId, event: { type: 'IGNORED' } };
    },
  };
}
