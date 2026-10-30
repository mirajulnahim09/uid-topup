import type { OrderStatus } from '@prisma/client';
import { prisma } from '../prisma';
import { logger } from '../logger';
import { hub } from '../integrations/hub';
import type { Delivery, FulfillmentJob, FulfillmentProvider } from '../integrations/types';
import { getFulfillmentConfig, decideOrderApproval } from './policy';
import { recordOrderEvent } from '../orderEvents';
import { applyOrderStatus } from '../fulfilment';
import { notify } from '../notify';
import { emailOrderCompleted } from '../email';
import { telegramEvent } from '../telegram';
import { AUTO_FULFILL_ACTOR_ID, AUTO_INFLIGHT_MAX_MS } from '../orderClaim';

/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ Group G — অটো-ডেলিভারি অর্কেস্ট্রেশন
 *
 *   RUN.md-এর **অলঙ্ঘনীয় নিয়ম**: প্রোভাইডার ত্রুটি বা টাইমআউট করলে
 *   অর্ডার delivered চিহ্নিত হবে না, **এবং** ওয়ালেট দুবার কাটবে না।
 *
 *   ── দ্বিতীয় অর্ধেকটি কেন এমনিতেই সত্য (এবং তবু লেখা হলো) ──
 *   এই ফাইলের কোনো পথ ওয়ালেট স্পর্শ করে না। অর্ডারের টাকা কাটা হয়
 *   **অর্ডার দেওয়ার সময়** (`services/order.ts`), ডেলিভারির সময় নয়।
 *   তাই ডেলিভারি ব্যর্থ হলে টাকা ফেরত দেওয়ার প্রশ্নও এখানে নেই —
 *   অর্ডারটি কেবল ম্যানুয়াল কিউতে ফিরে যায়, যেখানে অ্যাডমিন হয়
 *   হাতে ডেলিভার করেন, নয়তো বিদ্যমান FAIL→রিফান্ড পথে বাতিল করেন।
 *   অর্থাৎ অটো-ডেলিভারি টাকার মডেলে **কোনো নতুন পথ যোগ করে না** —
 *   এটিই এই নকশার সবচেয়ে গুরুত্বপূর্ণ বৈশিষ্ট্য।
 *
 *   ── ডাবল-ডেলিভারি (গেমের ভেতরে) ঠেকানোর তিন স্তর ──
 *   ১. **claim** (3.7-এর বিদ্যমান ব্যবস্থা) — লক করা রো-তে দেখা হয়
 *      অর্ডারটি PENDING ও মুক্ত কি না; তারপর সিস্টেম সেটি ধরে নেয়।
 *      দুটি সমান্তরাল চেষ্টার একটিই এগোতে পারে।
 *   ২. **idempotency key** — প্রতিটি retry-তে হুবহু একই কী যায়,
 *      তাই প্রোভাইডার সেটি মানলে তার দিকেও ডুপ্লিকেট হয় না।
 *   ৩. **UNKNOWN কখনো retry হয় না** — অনিশ্চয়তায় থেমে যাওয়াই একমাত্র
 *      নিরাপদ আচরণ (`integrations/types.ts` দেখুন)।
 * ═══════════════════════════════════════════════════════════
 */

/** সর্বোচ্চ কত চেষ্টা (প্রথমটি সহ) */
const MAX_ATTEMPTS = 3;
/** ব্যাক-অফ ভিত্তি — ৩০০ms, ৯০০ms (৩^n) */
const BACKOFF_BASE_MS = 300;

/** ★ সিস্টেম যখন অর্ডার ধরে — অ্যাডমিন প্যানেলে এই নামেই দেখাবে */
const SYSTEM_ACTOR = { id: AUTO_FULFILL_ACTOR_ID, name: 'অটো-ডেলিভারি' };

/**
 * ★★★ F1 — claim-এর মুহূর্তেই লেখা "হতাশাবাদী" নোট।
 *
 *   Vercel `maxDuration`-এ ফাংশন মাঝপথে মারা গেলে কোনো `catch` চলে না — আগে
 *   অর্ডারটি PROCESSING-এ কোনো সতর্কতা ছাড়াই পড়ে থাকত, আর ১৫ মিনিট পর claim
 *   "ছেড়ে গেছেন" দেখাত; অ্যাডমিন সরল বিশ্বাসে আবার ডেলিভার করতেন। এখন সতর্কতা
 *   **কাজ শুরুর আগেই** লেখা, আর কেবল সফল/ব্যর্থতার নিশ্চিত ফল এটিকে বদলায়।
 */
const IN_FLIGHT_NOTE =
  '⏳ অটো-ডেলিভারি চলছে — এই নোট থেকে গেলে প্রক্রিয়াটি মাঝপথে থেমেছে; গেমে পৌঁছেছে কি না যাচাই না করে ডেলিভার বা বাতিল করবেন না';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * ★ ব্যাক-অফসহ চেষ্টা।
 *
 *   ⚠️ retry কেবল `FAILED` **ও** `retryable: true` হলে। `UNKNOWN`
 *   কখনোই নয় — সেটিই এই ফাংশনের একমাত্র সত্যিকারের নিয়ম।
 *   `DELIVERED` পেলে সাথে সাথে ফেরে।
 */
export async function deliverWithRetry(
  provider: FulfillmentProvider,
  job: FulfillmentJob,
  opts: { maxAttempts?: number; backoffMs?: number } = {},
): Promise<{ delivery: Delivery; attempts: number }> {
  const max = opts.maxAttempts ?? MAX_ATTEMPTS;
  const base = opts.backoffMs ?? BACKOFF_BASE_MS;

  let last: Delivery = { status: 'FAILED', reason: 'কোনো চেষ্টা হয়নি', retryable: false };

  for (let attempt = 1; attempt <= max; attempt++) {
    // ★ প্রোভাইডার নিজে throw করলেও সেটি একটি **অনিশ্চিত** ফল, ব্যর্থতা
    //   নয় — কোথায় ভেঙেছে তা জানা নেই, তাই retry করা হয় না।
    let d: Delivery;
    try {
      d = await provider.deliver(job);
    } catch (e) {
      logger.error('fulfill', 'provider threw', { orderId: job.orderId, err: e });
      return { delivery: { status: 'UNKNOWN', reason: 'প্রোভাইডার অপ্রত্যাশিত ত্রুটি দিয়েছে' }, attempts: attempt };
    }

    last = d;
    if (d.status !== 'FAILED' || d.retryable !== true) return { delivery: d, attempts: attempt };

    if (attempt < max) await sleep(base * Math.pow(3, attempt - 1));
  }

  return { delivery: last, attempts: max };
}

type AutoResult = {
  /** MANUAL = অটো চালু নয় বা অর্ডার ধরা যায়নি — মানুষই করবে */
  status: 'MANUAL' | 'DELIVERED' | 'FAILED' | 'UNKNOWN';
  reason?: string;
  attempts?: number;
};

/**
 * ★★★ একটি অর্ডার অটো-ডেলিভার করার চেষ্টা।
 *
 *   এটি অর্ডার-অনুরোধের **commit-পরবর্তী** ধাপে চলে, তাই এখান থেকে
 *   throw করলেও গ্রাহকের অর্ডার সফলই থাকে। তবু ভেতরে সবকিছু guarded —
 *   একটি ব্যর্থ ডেলিভারি যেন কখনো অর্ডারের উত্তরকে "ব্যর্থ" না দেখায়।
 */
export async function autoFulfillOrder(orderId: string): Promise<AutoResult> {
  try {
    const cfg = await getFulfillmentConfig();
    if (decideOrderApproval(cfg) !== 'automatic') return { status: 'MANUAL' };

    const provider = await hub.fulfillment();
    // ★ ম্যানুয়াল প্রোভাইডারও একটি বৈধ "প্রোভাইডার" — সে MANUAL ফেরে,
    //   অর্থাৎ কনফিগ automatic হলেও কেউ সক্রিয়ভাবে না বেছে থাকলে
    //   আচরণ আগের মতোই থাকে।
    if (!provider) return { status: 'MANUAL', reason: 'কোনো প্রোভাইডার সক্রিয় নেই' };

    // ── ধাপ ১: অর্ডার ধরা (claim) ──
    //    লক করা রো-তেই সিদ্ধান্ত: PENDING ও কেউ ধরেনি।
    const claimed = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{
          id: string; status: string; productName: string;
          variantName: string; playerUid: string; claimedById: string | null;
        }>
      >`SELECT id, status, "productName", "variantName", "playerUid", "claimedById"
          FROM "Order" WHERE id = ${orderId} FOR UPDATE`;

      const row = rows[0];
      if (!row) return null;
      // ★ ইতিমধ্যে কেউ (মানুষ বা আগের একটি চেষ্টা) ধরে ফেলেছে বা
      //   অর্ডার আর PENDING নেই — অটো-ডেলিভারি চুপচাপ সরে দাঁড়ায়।
      if (row.status !== 'PENDING' || row.claimedById) return null;

      await tx.order.update({
        where: { id: orderId },
        data: {
          status: 'PROCESSING',
          claimedById: SYSTEM_ACTOR.id,
          claimedByName: SYSTEM_ACTOR.name,
          claimedAt: new Date(),
          internalNote: IN_FLIGHT_NOTE,
        },
      });
      await recordOrderEvent(tx, {
        orderId,
        status: 'PROCESSING',
        note: 'অটো-ডেলিভারি শুরু হয়েছে',
        actorType: 'SYSTEM',
      });

      return row;
    });

    if (!claimed) return { status: 'MANUAL', reason: 'অর্ডারটি ইতিমধ্যে ধরা বা প্রক্রিয়াধীন' };

    const job: FulfillmentJob = {
      orderId,
      productName: claimed.productName,
      variantName: claimed.variantName,
      playerUid: claimed.playerUid,
      quantity: 1,
    };

    // ── ধাপ ২: প্রোভাইডারকে ডাকা ──
    const { delivery, attempts } = await deliverWithRetry(provider, job);

    if (delivery.status === 'DELIVERED') {
      await completeOrder(orderId, delivery.ref);
      return { status: 'DELIVERED', attempts };
    }

    // ── ধাপ ৩: হয়নি → ম্যানুয়াল কিউতে ফেরত ──
    await releaseToManualQueue(orderId, delivery, attempts);
    return { status: delivery.status === 'UNKNOWN' ? 'UNKNOWN' : 'FAILED', reason: delivery.reason, attempts };
  } catch (e) {
    // ★ অর্কেস্ট্রেশন নিজেই ভাঙলে অর্ডারটি যেন PROCESSING-এ আটকে
    //   না থাকে — best-effort মুক্ত করি, তারপরও ব্যর্থতা লগ হয়।
    logger.error('fulfill', 'auto-fulfill orchestration failed', { orderId, err: e });
    await releaseToManualQueue(
      orderId,
      { status: 'UNKNOWN', reason: 'অভ্যন্তরীণ ত্রুটি' },
      0,
    ).catch(() => {});
    return { status: 'UNKNOWN', reason: 'অভ্যন্তরীণ ত্রুটি' };
  }
}

/**
 * ★ সফল ডেলিভারি — বিদ্যমান `applyOrderStatus()` **পুনঃব্যবহার**।
 *
 *   অ্যাডমিন যে কোডপথে অর্ডার COMPLETE করেন, অটো-ডেলিভারিও হুবহু
 *   সেটিই ব্যবহার করে। আলাদা করে লিখলে একদিন দুটি ভিন্ন আচরণ
 *   হতো — যেমন একটিতে `completedAt` বসত, অন্যটিতে নয়।
 */
async function completeOrder(orderId: string, ref?: string): Promise<void> {
  const out = await prisma.$transaction(async (tx) => {
    // ★★★ আবার লক — প্রোভাইডারকে ডাকার সময়টুকুতে অ্যাডমিন হাতে
    //     অর্ডারটি সম্পন্ন বা বাতিল করে ফেলতে পারেন। তখন আমাদের
    //     লেখা অবস্থাটি তাঁরটিকে চাপা দিয়ে দিত।
    const rows = await tx.$queryRaw<Array<{ id: string; status: OrderStatus; orderNo: number }>>`
      SELECT id, status, "orderNo" FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
    if (!rows[0]) return null;

    // ★★★ D1-1 (খ) — ডেলিভারি পৌঁছেছে, কিন্তু অর্ডার ইতিমধ্যে বন্ধ (যেমন পুরনো
    //     claim-এ বাতিল-রিফান্ড)। আগে এখানে **নীরবে** ফেরত যেত — গ্রাহক ডায়মন্ড
    //     ও টাকা দুটোই রাখতেন, আর খতিয়ান মেলায় কেউ কখনো জানত না। এখন অর্ডারের
    //     ঘটনাপঞ্জি ও অভ্যন্তরীণ নোটে স্থায়ীভাবে লেখা হয় এবং অপারেটরকে সতর্ক করা হয়।
    //     ⚠️ টাকা স্বয়ংক্রিয়ভাবে কাটা হয় **না** — ফেরত নেওয়া মানুষের সিদ্ধান্ত।
    if (rows[0].status !== 'PROCESSING') {
      const warn = `🚨 অর্ডার "${rows[0].status}" হওয়ার পরে প্রোভাইডার ডেলিভারি নিশ্চিত করেছে (ref: ${ref ?? 'নেই'}) — গ্রাহক পণ্য পেয়েছেন; ফেরত দেওয়া টাকা সমন্বয় বিবেচনা করুন`;
      await tx.order.update({ where: { id: orderId }, data: { internalNote: warn } });
      await recordOrderEvent(tx, {
        orderId,
        status: rows[0].status,
        note: 'বন্ধ অর্ডারে দেরিতে ডেলিভারি নিশ্চিত হয়েছে — অ্যাডমিনের পর্যালোচনা দরকার',
        actorType: 'SYSTEM',
      });
      return { lateAfterClose: true as const, orderNo: rows[0].orderNo, status: rows[0].status };
    }

    await applyOrderStatus(tx, {
      orderId,
      action: 'COMPLETE',
      admin: SYSTEM_ACTOR,
      adminNote: 'অটো-ডেলিভারি সম্পন্ন হয়েছে',
      // ★ F1 — সবসময় লেখা, যাতে claim-এর "⏳ চলছে" নোট সফলতার পরে থেকে না যায়
      internalNote: ref ? `provider ref: ${ref}` : 'অটো-ডেলিভারি সম্পন্ন',
    });

    const done = await tx.order.findUnique({
      where: { id: orderId },
      select: {
        orderNo: true, productName: true, variantName: true,
        user: { select: { id: true, name: true, email: true } },
      },
    });
    return done ? { lateAfterClose: false as const, ...done } : null;
  });

  if (!out) return;

  if (out.lateAfterClose) {
    logger.error('fulfill', 'delivered after order was closed', { orderId, status: out.status });
    telegramEvent(
      'fulfillment_failed',
      '🚨 বন্ধ অর্ডারে ডেলিভারি পৌঁছেছে',
      `#${out.orderNo} — অর্ডার ${out.status} হওয়ার পরে প্রোভাইডার ডেলিভারি নিশ্চিত করেছে। গ্রাহক পণ্য ও ফেরত দুটোই পেয়ে থাকতে পারেন — এখনই যাচাই করুন।`,
      '/admin/orders',
    ).catch(() => {});
    return;
  }

  // ── commit-পরবর্তী, সবই guarded ──
  notify(
    out.user.id,
    `অর্ডার #${out.orderNo} সম্পন্ন 🎉`,
    `${out.productName} — ${out.variantName} ডেলিভারি হয়েছে।`,
    '/account/orders',
  ).catch(() => {});

  emailOrderCompleted(
    out.user.email, out.user.name, out.orderNo, out.productName, out.variantName,
  ).catch(() => {});

  telegramEvent(
    'order_completed',
    '🤖 অটো-ডেলিভারি সম্পন্ন',
    `#${out.orderNo} — ${out.productName} / ${out.variantName} — ${out.user.name}`,
    '/admin/orders',
  ).catch(() => {});
}

/**
 * ★★★ ব্যর্থ বা অনিশ্চিত → অর্ডার আবার PENDING, claim মুক্ত।
 *
 *   অর্ডারটি PROCESSING-এ ফেলে রাখলে সেটি "কেউ একজন কাজ করছে" বলে
 *   দেখাত এবং কার্যত হারিয়ে যেত। PENDING-এ ফেরানো মানেই ম্যানুয়াল
 *   কিউতে ফেরা — অ্যাডমিনের তালিকায় আবার উপরে।
 *
 *   ⚠️ গ্রাহককে কিছু জানানো হয় **না**। তাঁর দিক থেকে অর্ডারটি এখনো
 *   প্রক্রিয়াধীন, আর "অটো-ডেলিভারি ব্যর্থ" বার্তা কেবল অকারণ আতঙ্ক
 *   তৈরি করত — অ্যাডমিন কয়েক মিনিটেই হাতে ডেলিভার করবেন।
 */
async function releaseToManualQueue(
  orderId: string,
  delivery: Delivery,
  attempts: number,
): Promise<void> {
  const uncertain = delivery.status === 'UNKNOWN';

  const out = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string; status: string; claimedById: string | null }>>`
      SELECT id, status, "claimedById" FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
    const row = rows[0];
    // ★ কেবল **আমাদের নিজের** claim ছাড়ি। ইতিমধ্যে অ্যাডমিন ধরে
    //   ফেললে বা অর্ডার এগিয়ে গেলে কিছুই করি না।
    if (!row || row.status !== 'PROCESSING' || row.claimedById !== SYSTEM_ACTOR.id) return null;

    await tx.order.update({
      where: { id: orderId },
      data: {
        status: 'PENDING',
        claimedById: null,
        claimedByName: null,
        claimedAt: null,
        // ★★★ অনিশ্চয়তা অ্যাডমিনের চোখে পড়তেই হবে — internalNote
        //     অর্ডার পাতায় দেখা যায়, গ্রাহক দেখেন না।
        internalNote: uncertain
          ? `⚠️ অটো-ডেলিভারির ফল অজানা (${delivery.reason ?? ''}) — গেমে পৌঁছেছে কি না নিজে যাচাই করে তবেই ডেলিভার করুন`
          : `অটো-ডেলিভারি ব্যর্থ (${attempts} চেষ্টা): ${delivery.reason ?? 'কারণ অজানা'}`,
      },
    });

    await recordOrderEvent(tx, {
      orderId,
      status: 'PENDING',
      note: uncertain
        ? 'অটো-ডেলিভারির ফল নিশ্চিত হওয়া যায়নি — ম্যানুয়াল যাচাই দরকার'
        : `অটো-ডেলিভারি ব্যর্থ — ম্যানুয়াল কিউতে ফেরত (${attempts} চেষ্টা)`,
      actorType: 'SYSTEM',
    });

    return tx.order.findUnique({ where: { id: orderId }, select: { orderNo: true } });
  });

  if (!out) return;

  telegramEvent(
    'fulfillment_failed',
    uncertain ? '⚠️ অটো-ডেলিভারির ফল অজানা' : '🔁 অটো-ডেলিভারি ব্যর্থ',
    uncertain
      ? `#${out.orderNo} — প্রোভাইডার উত্তর দেয়নি। গেমে পৌঁছেছে কি না **যাচাই করে** তবেই ডেলিভার করুন, নাহলে দুবার চলে যেতে পারে।`
      : `#${out.orderNo} — ${attempts} চেষ্টার পরেও হয়নি (${delivery.reason ?? 'কারণ অজানা'})। ম্যানুয়াল কিউতে ফেরত এসেছে।`,
    '/admin/orders',
  ).catch(() => {});
}

/**
 * ★★★ F1 — মাঝপথে মরে যাওয়া অটো-ডেলিভারির ঝাড়ু (sla-breach ক্রন থেকে ডাকা)।
 *
 *   `AUTO_INFLIGHT_MAX_MS` পেরোনো system-claim মানে ফাংশনটি নিশ্চিতভাবে মৃত
 *   (`maxDuration` ৬০s)। অর্ডারটি ম্যানুয়াল কিউতে ফেরে **UNKNOWN** হিসেবে —
 *   "গেমে যাচাই করে তবেই" নোট ও টেলিগ্রাম সতর্কতাসহ। কখনো নিজে ডেলিভার বা
 *   রিফান্ড করে না: ফল অজানা হলে মানুষই একমাত্র নিরাপদ বিচারক।
 *
 *   ⚠️ প্রার্থী-তালিকা লক ছাড়া পড়া, কিন্তু সিদ্ধান্ত `releaseToManualQueue`-এর
 *   ভেতরে **লক করা রো** আবার দেখে নেয় (PROCESSING + এখনো আমাদের claim)।
 *   ফলে এর মধ্যে সফল হওয়া বা অ্যাডমিনের হাতে যাওয়া অর্ডার অস্পৃশ্য থাকে।
 */
export async function sweepStuckAutoFulfill(limit = 50): Promise<number> {
  const cutoff = new Date(Date.now() - AUTO_INFLIGHT_MAX_MS);
  const stuck = await prisma.order.findMany({
    where: { status: 'PROCESSING', claimedById: SYSTEM_ACTOR.id, claimedAt: { lt: cutoff } },
    select: { id: true },
    orderBy: { claimedAt: 'asc' },
    take: limit,
  });
  let released = 0;
  for (const { id } of stuck) {
    // ★ একটির ব্যর্থতা বাকিগুলো আটকাবে না — পরের ক্রন-রানে আবার চেষ্টা হবে
    try {
      await releaseToManualQueue(
        id,
        { status: 'UNKNOWN', reason: 'সার্ভার-ফাংশন সময়সীমায় থেমে গেছে — প্রোভাইডারের ফল অজানা' },
        0,
      );
      released++;
    } catch (e) {
      logger.error('fulfill', 'stuck auto-fulfill sweep failed', { orderId: id, err: e });
    }
  }
  return released;
}
