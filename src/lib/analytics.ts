import { prisma } from './prisma';

/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ ব্যবসায়িক পরিসংখ্যান (Phase 5) — একক সত্যের উৎস
 *
 *   admin reports পেজ ও `/api/admin/analytics` endpoint দুটোই এখান
 *   থেকে ডেটা নেয় (কোনো ডুপ্লিকেট query যুক্তি নয়)।
 *
 *   ── মুনাফা (profit) কীভাবে ──
 *   revenue = COMPLETED অর্ডারের price যোগফল
 *   cost    = সেই অর্ডারগুলোর costPrice (snapshot) যোগফল
 *   profit  = revenue − cost − refunded
 *   ⚠️ costPrice অর্ডারের সময় snapshot করা (order route)। পুরনো অর্ডারে
 *      0 থাকতে পারে (তখন cost জানা ছিল না) — তাই profit কিছুটা বেশি
 *      দেখাবে; রিপোর্টে এটি স্পষ্ট করা হয়।
 * ═══════════════════════════════════════════════════════════
 */

export type RevenuePoint = { date: string; revenue: number; cost: number; profit: number; orders: number };
export type PeriodSummary = {
  revenue: number; cost: number; profit: number; refunded: number;
  orders: number; deposits: number;
};

const num = (v: unknown): number => (v == null ? 0 : Number(v));

/** একটি সময়সীমার সারসংক্ষেপ (revenue/cost/profit/refund) */
export async function periodSummary(since: Date): Promise<PeriodSummary> {
  const [ordAgg, depAgg, ordCount] = await Promise.all([
    prisma.order.aggregate({
      where: { status: 'COMPLETED', completedAt: { gte: since } },
      _sum: { price: true, costPrice: true, refundedAmount: true },
    }),
    prisma.deposit.aggregate({
      where: { status: 'APPROVED', reviewedAt: { gte: since } },
      _sum: { amount: true },
    }),
    prisma.order.count({ where: { createdAt: { gte: since } } }),
  ]);

  const revenue = num(ordAgg._sum.price);
  const cost = num(ordAgg._sum.costPrice);
  const refunded = num(ordAgg._sum.refundedAmount);
  return {
    revenue,
    cost,
    profit: Math.round((revenue - cost - refunded) * 100) / 100,
    refunded,
    orders: ordCount,
    deposits: num(depAgg._sum.amount),
  };
}

/**
 * ★ দিন-প্রতি revenue/profit trend (ডিফল্ট শেষ ৩০ দিন) — চার্টের জন্য।
 *   একটি query-তে সব COMPLETED অর্ডার এনে JS-এ দিন অনুযায়ী গোছানো হয়।
 *
 *   ⚠️ TIMEZONE: দোকান Bangladesh (UTC+6)। UTC তারিখ ব্যবহার করলে রাত
 *      ৬টার পরের অর্ডার পরদিনে পড়ত (ভুল দিনের হিসাব)। তাই সময়ে +৬ ঘণ্টা
 *      যোগ করে "Bangladesh দিন" বের করা হয় — চার্ট স্থানীয় দিনে সঠিক।
 */
const BD_OFFSET_MS = 6 * 60 * 60 * 1000; // UTC+6

/** একটি Date → Bangladesh দিনের 'YYYY-MM-DD' */
function bdDayKey(d: Date): string {
  return new Date(d.getTime() + BD_OFFSET_MS).toISOString().slice(0, 10);
}

export async function revenueTrend(days = 30): Promise<RevenuePoint[]> {
  // ★ Bangladesh আজকের দিন থেকে পিছিয়ে গণনা
  const nowBd = new Date(Date.now() + BD_OFFSET_MS);
  const sinceBdMidnight = new Date(nowBd);
  sinceBdMidnight.setUTCHours(0, 0, 0, 0);
  sinceBdMidnight.setUTCDate(sinceBdMidnight.getUTCDate() - (days - 1));
  // UTC-তে সেই মুহূর্ত (query filter-এর জন্য) = BD-মধ্যরাত − ৬ঘণ্টা
  const since = new Date(sinceBdMidnight.getTime() - BD_OFFSET_MS);

  const orders = await prisma.order.findMany({
    where: { status: 'COMPLETED', completedAt: { gte: since } },
    select: { completedAt: true, price: true, costPrice: true, refundedAmount: true },
  });

  // দিন-বাকেট প্রস্তুত (শূন্য সহ — ফাঁকা দিনও চার্টে থাকবে), BD দিনে
  const buckets = new Map<string, RevenuePoint>();
  for (let i = 0; i < days; i++) {
    const d = new Date(sinceBdMidnight);
    d.setUTCDate(sinceBdMidnight.getUTCDate() + i);
    const key = d.toISOString().slice(0, 10);
    buckets.set(key, { date: key, revenue: 0, cost: 0, profit: 0, orders: 0 });
  }

  for (const o of orders) {
    if (!o.completedAt) continue;
    const key = bdDayKey(o.completedAt); // ★ BD দিন
    const b = buckets.get(key);
    if (!b) continue;
    const rev = num(o.price);
    const cost = num(o.costPrice);
    const refund = num(o.refundedAmount);
    b.revenue += rev;
    b.cost += cost;
    b.profit += rev - cost - refund;
    b.orders += 1;
  }

  // দুই দশমিকে round
  return [...buckets.values()].map((b) => ({
    ...b,
    revenue: Math.round(b.revenue * 100) / 100,
    cost: Math.round(b.cost * 100) / 100,
    profit: Math.round(b.profit * 100) / 100,
  }));
}

export type CustomerInsight = {
  totalCustomers: number;
  newThisMonth: number;
  repeatCustomers: number;   // ১টির বেশি COMPLETED অর্ডার
  avgOrderValue: number;
};

/** গ্রাহক অন্তর্দৃষ্টি — নতুন/ফিরতি/গড় অর্ডার-মূল্য */
export async function customerInsights(): Promise<CustomerInsight> {
  const monthAgo = new Date();
  monthAgo.setDate(monthAgo.getDate() - 30);

  const [totalCustomers, newThisMonth, repeatGroups, ordAgg] = await Promise.all([
    prisma.user.count({ where: { role: 'USER' } }),
    prisma.user.count({ where: { role: 'USER', createdAt: { gte: monthAgo } } }),
    // ১টির বেশি সম্পন্ন অর্ডার আছে এমন ইউজার (repeat customer)
    //   ⚠️ having-এ যে field count করি (userId) সেটিই _count-এ select করা —
    //      _all আর নির্দিষ্ট-field count মেশালে কিছু Prisma version runtime
    //      error দেয়। তাই দুটোই userId।
    prisma.order.groupBy({
      by: ['userId'],
      where: { status: 'COMPLETED' },
      _count: { userId: true },
      having: { userId: { _count: { gt: 1 } } },
    }),
    prisma.order.aggregate({
      where: { status: 'COMPLETED' },
      _avg: { price: true },
    }),
  ]);

  return {
    totalCustomers,
    newThisMonth,
    repeatCustomers: repeatGroups.length,
    avgOrderValue: Math.round(num(ordAgg._avg.price) * 100) / 100,
  };
}
