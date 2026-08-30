import { getProvider, isProviderEnabled } from '@/lib/payments/registry';
import type { WebhookRequest } from '@/lib/payments/types';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ পেমেন্ট Webhook রিসিভার (Phase 4 — webhook-ready design)
 *
 *   একটিই endpoint সব গেটওয়ে সামলায়:
 *     POST /api/webhooks/payment/<provider>   (stripe, sslcommerz, ...)
 *
 *   ── প্রবাহ ──
 *   ১. provider খুঁজে বের করা, enabled কিনা যাচাই
 *   ২. provider.parseWebhook() — **signature যাচাই সহ** raw payload পার্স
 *   ৩. idempotency — একই eventId আগে প্রক্রিয়া হলে skip (double-credit নয়)
 *   ৪. ইভেন্ট অনুযায়ী কাজ (এখন: রেকর্ড; গেটওয়ে চালু হলে deposit approve)
 *
 *   ── কেন এখনই দরকার (গেটওয়ে না থাকলেও) ──
 *   গেটওয়ে integration-এর সময় এই receiver-ই async payment confirmation
 *   ধরবে। এখন কাঠামো থাকলে গেটওয়ে যোগ করা = শুধু provider-এ parseWebhook
 *   পূরণ; receiver/idempotency/security অপরিবর্তিত।
 *
 *   ⚠️ money-safety: signature ছাড়া কোনো ইভেন্ট বিশ্বাস করা হয় না
 *      (নাহলে ভুয়া "succeeded" = ফ্রি টপ-আপ)। idempotency ছাড়া retry =
 *      double-credit। দুটোই এখানে বাধ্যতামূলক।
 * ═══════════════════════════════════════════════════════════
 */
export async function POST(
  req: Request,
  { params }: { params: { provider: string } }
) {
  const providerId = params.provider;

  try {
    const provider = getProvider(providerId);
    if (!provider) {
      return Response.json({ error: 'unknown provider' }, { status: 404 });
    }

    // ★ বন্ধ থাকা প্রোভাইডারের webhook গ্রহণ করা হয় না
    if (!(await isProviderEnabled(provider.id))) {
      return Response.json({ error: 'provider disabled' }, { status: 403 });
    }

    // ★ গেটওয়ে webhook পার্সিং বাস্তবায়ন করেছে কিনা
    if (!provider.parseWebhook) {
      return Response.json(
        { error: 'webhook not implemented for this provider' },
        { status: 501 }
      );
    }

    // raw body — signature যাচাইয়ের জন্য অপরিবর্তিত দরকার
    const rawBody = await req.text();
    const headers: Record<string, string> = {};
    req.headers.forEach((v, k) => { headers[k] = v; });

    const webhookReq: WebhookRequest = { rawBody, headers };
    const result = await provider.parseWebhook(webhookReq);

    if (!result.ok) {
      // ★ signature ভুল → 401 (সন্দেহজনক); নাহলে 400 (গঠন ভুল)
      logger.warn('webhook', 'payment webhook rejected', {
        provider: provider.id, reason: result.reason,
      });
      return Response.json(
        { error: result.reason },
        { status: result.unauthorized ? 401 : 400 }
      );
    }

    const { event, eventId } = result;

    if (event.type === 'IGNORED') {
      return Response.json({ received: true, ignored: true });
    }

    // ═══════ IDEMPOTENCY — একই ইভেন্ট দুবার প্রক্রিয়া নয় ═══════
    // ⚠️ RACE-SAFE: check-then-act নয় (দুটো একসাথে এলে দুটোই null দেখত ও
    //    দুবার handle করত → future gateway-এ double-credit)। বরং atomic
    //    create-first: unique key (PK) constraint-ই lock। create সফল হলে
    //    এই instance-ই একমাত্র owner → handle করবে। create fail (P2002 =
    //    duplicate key) হলে অন্য কেউ আগে নিয়েছে → skip।
    const idemKey = `webhook:${provider.id}:${eventId}`;
    try {
      await prisma.setting.create({
        data: { key: idemKey, value: JSON.stringify({ at: new Date().toISOString(), type: event.type }) },
      });
    } catch (e) {
      // P2002 = unique constraint violation = আগে প্রক্রিয়া হয়েছে
      const code = (e as { code?: string })?.code;
      if (code === 'P2002') {
        return Response.json({ received: true, duplicate: true });
      }
      throw e; // অন্য DB error → 500 → gateway retry
    }

    // ★ opportunistic cleanup — ৭ দিনের বেশি পুরনো marker মুছে ফেলি
    //   (গেটওয়ে retry উইন্ডো দিনখানেক; ৭ দিন যথেষ্ট নিরাপদ)। প্রতি
    //   webhook-এ চালানো সস্তা (indexed key prefix), আলাদা cron লাগে না।
    //   best-effort — ব্যর্থ হলেও মূল প্রবাহ ভাঙে না।
    void (async () => {
      const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      try {
        const old = await prisma.setting.findMany({
          where: { key: { startsWith: `webhook:${provider.id}:` } },
          select: { key: true, value: true },
          take: 200,
        });
        const stale = old
          .filter((s) => {
            try { return (JSON.parse(s.value)?.at ?? '') < cutoff; }
            catch { return false; }
          })
          .map((s) => s.key);
        if (stale.length) {
          await prisma.setting.deleteMany({ where: { key: { in: stale } } });
        }
      } catch { /* cleanup ব্যর্থ হলে উপেক্ষা */ }
    })();

    // ═══════ ইভেন্ট হ্যান্ডলিং ═══════
    // ⚠️ সততা: লাইভ গেটওয়ে এখনো নেই, তাই এখানে শুধু নিরাপদে রেকর্ড ও লগ
    //    করা হয়। গেটওয়ে চালু হলে এখানে deposit auto-approve যুক্ত হবে
    //    (একই wallet service দিয়ে — নতুন money path নয়)।
    //
    // 🔴🔴 যিনি এখানে ক্রেডিট যোগ করবেন, তাঁর জন্য — **ক্রম নিয়ে সাবধান**।
    //
    //    উপরের idempotency marker সাইড-এফেক্টের **আগে** লেখা হয়। আজ
    //    এটি নিরাপদ, কারণ নিচে কোনো সাইড-এফেক্ট নেই — কেবল লগ। কিন্তু
    //    এখানে creditWallet() বসালে একটি নতুন ব্যর্থতা-মোড তৈরি হবে:
    //
    //      marker লেখা হলো → ক্রেডিট ব্যর্থ (DB hiccup/timeout) → গেটওয়ে
    //      retry করল → marker আছে বলে `duplicate` ধরে skip → **গ্রাহকের
    //      টাকা কখনোই জমা হলো না**, অথচ গেটওয়ে বলছে সফল।
    //
    //    এটি double-credit এর চেয়ে ধরা কঠিন, কারণ কোথাও কোনো ত্রুটি
    //    দেখা যায় না — কেবল একজন গ্রাহকের টাকা নেই।
    //
    //    সঠিক রূপ: marker ও ক্রেডিট **একই `prisma.$transaction`-এ**
    //    (marker-এর unique key তখনো lock হিসেবে কাজ করে, আর ক্রেডিট
    //    ব্যর্থ হলে marker-ও rollback হয়, তাই retry সত্যিই কাজ করে)।
    //    `tests/webhook-lifecycle.test.ts` এর শেষ টেস্টটি আজকের
    //    "কিছুই ক্রেডিট হয় না" আচরণ লক করে রেখেছে — ক্রেডিট যোগ করলে
    //    সেটি ইচ্ছাকৃতভাবে ভাঙবে, অর্থাৎ এই মন্তব্যটি তখন পড়া হবে।
    logger.info('webhook', 'payment event received', {
      provider: provider.id, type: event.type,
      reference: 'reference' in event ? event.reference : undefined,
    });

    return Response.json({ received: true, type: event.type });
  } catch (e) {
    logger.error('webhook', 'payment webhook error', { provider: providerId, err: e });
    // ★ 500 → গেটওয়ে সাধারণত retry করবে (idempotency নিরাপদ রাখে)
    return Response.json({ error: 'internal error' }, { status: 500 });
  }
}
