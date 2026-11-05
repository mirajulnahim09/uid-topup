import { prisma, boundLockWait } from './prisma';
import { getSetting } from './settings';
import { recordOrderEvent } from './orderEvents';
import { notify } from './notify';
import { logger } from './logger';

/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ F2 — ডাইরেক্ট-পে অর্ডারের মেয়াদ (sla-breach ক্রন থেকে, ১৫ মিনিট অন্তর)
 *
 *   সমস্যা (মাপা): ডাইরেক্ট-পে অর্ডার তৈরিতেই স্টক কাটে। পেমেন্ট যাচাই না
 *   হলে স্টক **চিরকাল** আটকে থাকত — ১০টি ভুয়া TrxID-তে ১০টি স্টক শেষ।
 *
 *   ── অপরিবর্তনীয় শর্ত ──
 *   ১. কেবল **অর্ডার** বাতিল হয় (FAILED) + স্টক ও কুপন ফেরত।
 *   ২. যুক্ত ডিপোজিট **PENDING-ই থাকে** — গ্রাহক সত্যিই টাকা পাঠিয়ে থাকলে
 *      অ্যাডমিন পরে অনুমোদন করলে টাকা ওয়ালেটে যায়
 *      (`api/admin/deposit` দেখে অর্ডার আর AWAITING_PAYMENT নেই → কেবল ক্রেডিট)।
 *      অর্থাৎ এই মডিউল কখনো টাকা নড়ায় না, কারও টাকা হারানোর পথও খোলে না।
 *
 *   ── লক-ক্রম (deadlock-মুক্তির প্রমাণ) ──
 *   Deposit → Order → Variant → Coupon — `api/admin/deposit`-এর হুবহু একই।
 *   ফলে অনুমোদন ও মেয়াদ একই মিলিসেকেন্ডে এলে দুজনেই আগে Deposit রো চায়;
 *   যে পায় সে পুরো কাজ শেষ করে, অন্যজন তার ফল **লক করা রো থেকে** দেখে:
 *     · অনুমোদন আগে → অর্ডার PENDING → এখানে `status !== AWAITING` → কিছুই নয়
 *     · মেয়াদ আগে → অর্ডার FAILED → অনুমোদন কেবল ওয়ালেটে ক্রেডিট করে
 *   তৃতীয় কোনো অবস্থা সম্ভব নয়।
 * ═══════════════════════════════════════════════════════════
 */

export const DIRECT_PAY_EXPIRY_DEFAULT_MIN = 120;
/** ★ ভুল সেটিং (যেমন ১ মিনিট) দিলে সৎ গ্রাহকের অর্ডার যাচাইয়ের আগেই বাতিল হতো */
const MIN_EXPIRY_MIN = 30;

export async function directPayExpiryMinutes(): Promise<number> {
  const raw = Number(await getSetting('direct_pay_expiry_min', String(DIRECT_PAY_EXPIRY_DEFAULT_MIN)));
  return Number.isFinite(raw) && raw >= MIN_EXPIRY_MIN ? raw : DIRECT_PAY_EXPIRY_DEFAULT_MIN;
}

export async function expireDirectPayOrders(limit = 50): Promise<number> {
  const minutes = await directPayExpiryMinutes();
  const cutoff = new Date(Date.now() - minutes * 60_000);

  // ★ প্রার্থী-তালিকা লক ছাড়া — সিদ্ধান্ত নিচে লক করা রো থেকেই
  const candidates = await prisma.order.findMany({
    where: { status: 'AWAITING_PAYMENT', createdAt: { lt: cutoff } },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });

  let expired = 0;
  for (const { id } of candidates) {
    try {
      // ★ `linkedOrderId` তৈরির সময় বসে, আর কখনো বদলায় না — লক ছাড়া পড়া নিরাপদ
      const dep = await prisma.deposit.findFirst({ where: { linkedOrderId: id }, select: { id: true } });

      const out = await prisma.$transaction(
        async (tx) => {
          await boundLockWait(tx);
          // ★★★ লক-ক্রম ১: Deposit (অ্যাডমিন-অনুমোদনের সাথে একই)
          if (dep) await tx.$queryRaw`SELECT id FROM "Deposit" WHERE id = ${dep.id} FOR UPDATE`;
          // ★★★ লক-ক্রম ২: Order — সিদ্ধান্ত এই রো থেকেই
          const rows = await tx.$queryRaw<
            Array<{ status: string; variantId: number; couponId: number | null; userId: string; orderNo: number }>
          >`SELECT status::text AS status, "variantId", "couponId", "userId", "orderNo"
              FROM "Order" WHERE id = ${id} FOR UPDATE`;
          const o = rows[0];
          if (!o || o.status !== 'AWAITING_PAYMENT') return null; // অনুমোদন/বাতিল আগে জিতেছে

          // ★ লক-ক্রম ৩: Variant — সীমাহীন (-1) স্টক কখনো ছোঁয়া হয় না
          await tx.variant.updateMany({
            where: { id: o.variantId, stock: { gte: 0 } },
            data: { stock: { increment: 1 } },
          });
          // ★ লক-ক্রম ৪: Coupon — অ্যাডমিন-বাতিল পথের হুবহু
          if (o.couponId) {
            await tx.coupon.update({ where: { id: o.couponId }, data: { usageCount: { decrement: 1 } } });
            await tx.couponUse.deleteMany({ where: { orderId: id } });
          }

          const note = `পেমেন্ট ${Math.round(minutes / 60 * 10) / 10} ঘণ্টার মধ্যে যাচাই হয়নি — অর্ডার বাতিল। টাকা পাঠিয়ে থাকলে যাচাইয়ের পর তা আপনার ওয়ালেটে যোগ হবে।`;
          await tx.order.update({
            where: { id },
            data: { status: 'FAILED', adminNote: note, completedAt: new Date() },
          });
          await recordOrderEvent(tx, { orderId: id, status: 'FAILED', note, actorType: 'SYSTEM' });
          return { userId: o.userId, orderNo: o.orderNo, note };
        },
        { timeout: 15000 },
      );

      if (out) {
        expired++;
        notify(out.userId, `অর্ডার #${out.orderNo} — সময় পেরিয়ে গেছে`, out.note, '/account/orders').catch(() => {});
      }
    } catch (e) {
      // ★ একটির ব্যর্থতা (লক-টাইমআউট ইত্যাদি) বাকিগুলো থামায় না — পরের রানে আবার
      logger.error('direct-pay', 'expiry failed', { orderId: id, err: e });
    }
  }
  return expired;
}
