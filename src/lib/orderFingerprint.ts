import { createHash } from 'crypto';
import { prisma } from './prisma';

/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ SCL-02 — অর্ডার-পাতার "কিছু বদলেছে কি?" ছাপ
 *
 *   `AutoRefresh` আগে প্রতি ৩০ সেকেন্ডে `router.refresh()` করত — প্রতিটি খোলা
 *   অর্ডার-পাতায় পুরো সার্ভার-রেন্ডার (লেআউট, গার্ড, অর্ডার, প্রোডাক্ট…), যদিও
 *   প্রায় সবসময় কিছুই বদলায় না। এখন সে এই ছোট ছাপটি চায় (একটি কোয়েরি) আর
 *   ছাপ বদলালে **তবেই** পুরো রিফ্রেশ। ৩০s ব্যবধান অপরিবর্তিত — স্ট্যাটাস আগের
 *   মতোই দ্রুত আসে, কেবল অকারণ রেন্ডার বাদ।
 *
 *   ছাপে কেবল গ্রাহক যা **দেখেন ও যা বদলাতে পারে**: status, অ্যাডমিন-নোট,
 *   সম্পন্ন/ব্যর্থ/ডেলিভারি-নিশ্চিতকরণ, রিফান্ড, SLA, দাবি — আর একক অর্ডারে
 *   ঘটনার (OrderEvent) সংখ্যা। নতুন অর্ডার এলে id-তালিকাই বদলে যায়।
 * ═══════════════════════════════════════════════════════════
 */
export const SMM_CATEGORY_SLUG = 'like-follow-subscribe';
const LIST_TAKE = 50; // তালিকা-পাতার `take`-এর সাথে এক

export type OrderScope = { kind: 'recent' } | { kind: 'smm' } | { kind: 'one'; orderId: string };

const FIELDS = {
  id: true, status: true, adminNote: true, completedAt: true, verifiedPlayerName: true,
  failReason: true, deliveryConfirmedAt: true, deliveryDisputedAt: true, refundedAmount: true,
  slaDueAt: true, claimedAt: true,
} as const;

export async function orderFingerprint(userId: string, scope: OrderScope): Promise<string> {
  let rows: unknown[];
  if (scope.kind === 'one') {
    const o = await prisma.order.findFirst({
      where: { id: scope.orderId, userId },
      select: { ...FIELDS, _count: { select: { events: true } } },
    });
    rows = o ? [o] : [];
  } else {
    rows = await prisma.order.findMany({
      where: scope.kind === 'smm'
        ? { userId, variant: { product: { category: { slug: SMM_CATEGORY_SLUG } } } }
        : { userId },
      orderBy: { createdAt: 'desc' },
      take: LIST_TAKE,
      select: FIELDS,
    });
  }
  return createHash('sha1').update(JSON.stringify(rows)).digest('hex').slice(0, 16);
}
