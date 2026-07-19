import { prisma } from './prisma';
import { countBreaches } from './slaBreach';

/**
 * ★★★ অপারেশনাল মেট্রিক (3.10)
 *
 *   ড্যাশবোর্ডে আগে থেকেই ব্যবসার হিসাব আছে — আয়, লাভ, ওয়ালেট।
 *   কিন্তু সেগুলো বলে না **কাজটা কেমন চলছে**। ৫০ হাজার টাকার
 *   আয়ের পাশে যদি ৭টা অর্ডার ৩ ঘন্টা ধরে পড়ে থাকে, আসল খবরটা
 *   দ্বিতীয়টাই।
 *
 *   ── গড় নয়, মধ্যক (median) ──
 *   একটা অর্ডার ভুলে ২ দিন পড়ে থাকলে গড় ডেলিভারি সময় ঘন্টায়
 *   পৌঁছে যায়, অথচ বাকি ৪৯টা ৫ মিনিটে হয়েছে। গড় তখন মিথ্যা বলে
 *   — দুই দিকেই। মধ্যক সাধারণ অভিজ্ঞতাটা দেখায়।
 *
 *   ── কম ডেটায় সংখ্যা দেখানো হয় না ──
 *   ২টা অর্ডার থেকে "মধ্যক ডেলিভারি ৪ মিনিট" বের করা যায়, কিন্তু
 *   সেটা তথ্য নয়, কাকতাল। 2.9 এর trustMetrics-এর মতোই এখানে
 *   ন্যূনতম নমুনার শর্ত — না মিললে `null`, আর UI সংখ্যার বদলে
 *   "যথেষ্ট তথ্য নেই" দেখায়।
 */

/** এর কম নমুনায় মধ্যক অর্থহীন */
const MIN_SAMPLE = 5;

/** কত দিনের হিসাব */
const WINDOW_DAYS = 7;

export type OpsMetrics = {
  /** এখন সময় পেরিয়ে যাওয়া ও ঘনিয়ে আসা অর্ডার */
  slaBreached: number;
  slaSoon: number;
  /** সবচেয়ে পুরনো অপেক্ষমাণ কাজ কত মিনিট ধরে পড়ে আছে */
  oldestPendingOrderMin: number | null;
  oldestPendingDepositMin: number | null;
  /** মধ্যক — যথেষ্ট নমুনা না থাকলে null */
  medianFulfilMin: number | null;
  medianApprovalMin: number | null;
  /** নমুনার সংখ্যা — UI তে "কিসের ভিত্তিতে" বলার জন্য */
  fulfilSample: number;
  approvalSample: number;
  /** আজকের কাজ */
  todayCompleted: number;
  todayApproved: number;
  windowDays: number;
  minSample: number;
};

function median(xs: number[]): number | null {
  if (xs.length < MIN_SAMPLE) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

const minutesBetween = (a: Date, b: Date) => Math.max(0, Math.round((b.getTime() - a.getTime()) / 60_000));

export async function getOpsMetrics(now: Date = new Date()): Promise<OpsMetrics> {
  const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  // ★ সব কোয়েরি সমান্তরাল — অর্ডার সংখ্যা বাড়লেও রাউন্ড-ট্রিপ একই
  const [openOrders, oldestDeposit, fulfilled, approved, todayCompleted, todayApproved] =
    await Promise.all([
      prisma.order.findMany({
        where: { status: { in: ['PENDING', 'PROCESSING'] } },
        select: { slaDueAt: true, status: true, createdAt: true },
      }),
      prisma.deposit.findFirst({
        where: { status: 'PENDING' },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
      prisma.order.findMany({
        where: { status: 'COMPLETED', completedAt: { not: null, gte: since } },
        select: { createdAt: true, completedAt: true },
      }),
      prisma.deposit.findMany({
        where: { status: 'APPROVED', reviewedAt: { not: null, gte: since } },
        select: { createdAt: true, reviewedAt: true },
      }),
      prisma.order.count({ where: { status: 'COMPLETED', completedAt: { gte: today } } }),
      prisma.deposit.count({ where: { status: 'APPROVED', reviewedAt: { gte: today } } }),
    ]);

  const { breached, soon } = countBreaches(openOrders, now);

  // ★ সবচেয়ে পুরনো অপেক্ষমাণ — "কেউ কতক্ষণ ধরে বসে আছে"
  const oldestOrder = openOrders.reduce<Date | null>(
    (min, o) => (min === null || o.createdAt < min ? o.createdAt : min),
    null
  );

  const fulfilMins = fulfilled.map((o) => minutesBetween(o.createdAt, o.completedAt!));
  const approvalMins = approved.map((d) => minutesBetween(d.createdAt, d.reviewedAt!));

  return {
    slaBreached: breached,
    slaSoon: soon,
    oldestPendingOrderMin: oldestOrder ? minutesBetween(oldestOrder, now) : null,
    oldestPendingDepositMin: oldestDeposit ? minutesBetween(oldestDeposit.createdAt, now) : null,
    medianFulfilMin: median(fulfilMins),
    medianApprovalMin: median(approvalMins),
    fulfilSample: fulfilMins.length,
    approvalSample: approvalMins.length,
    todayCompleted,
    todayApproved,
    windowDays: WINDOW_DAYS,
    minSample: MIN_SAMPLE,
  };
}

/** মিনিটকে পাঠযোগ্য বাংলায় */
export function humanMinutes(m: number): string {
  if (m < 60) return `${m} মিনিট`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h} ঘন্টা ${m % 60} মিনিট` : `${h} ঘন্টা`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d} দিন ${h % 24} ঘন্টা` : `${d} দিন`;
}
