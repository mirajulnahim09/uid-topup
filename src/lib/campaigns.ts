import { prisma } from './prisma';
import { logger } from './logger';

/**
 * ═══════════════════════════════════════════════════════════
 * ★ হোমপেজ বিপণন — পড়ার স্তর (Option A infra)
 *
 *   অ্যাডমিন যা বসিয়েছে তা হোমপেজ কীভাবে পড়বে — সেই সাহায্যকারী।
 *   এখনো হোমপেজে যুক্ত করা হয়নি (রিডিজাইন পরের ধাপ); এটি অবকাঠামো,
 *   যাতে ডেটা রাউন্ড-ট্রিপ যাচাই করা যায় ও পরের ধাপ পরিষ্কার হয়।
 *
 *   ⚠️ সময়সূচি সম্মান করা হয়: একটি আইটেম তখনই "সক্রিয়" যখন
 *   isActive সত্য **এবং** এখনকার সময় [startsAt, endsAt] জানালার
 *   ভেতরে (null মানে খোলা প্রান্ত)। ফলে অ্যাডমিন আগেভাগে অফার বসিয়ে
 *   রাখতে পারে; সেটি নির্দিষ্ট সময়ে নিজে থেকেই চালু/বন্ধ হয়।
 *
 *   ⚠️ কখনো throw করে না — DB সমস্যা হলে খালি ফল, যাতে হোমপেজ
 *   বিপণন-উপাদান ছাড়াই দাঁড়িয়ে থাকে, ভাঙে না (হোমপেজের বাকি
 *   try/catch নীতির সাথে সঙ্গতিপূর্ণ)।
 * ═══════════════════════════════════════════════════════════
 */

export type CampaignItem = {
  id: number;
  placement: string;
  kind: string;
  title: string | null;
  subtitle: string | null;
  imageUrl: string | null;
  ctaLabel: string | null;
  ctaLink: string | null;
  badge: string | null;
  dismissible: boolean;
  frequency: string;
  sortOrder: number;
  endsAt: string | null;
};

/** নির্দিষ্ট placement এর সক্রিয় ও সময়-উপযুক্ত আইটেম, ক্রমানুসারে */
export async function getCampaigns(placement: string, take = 12): Promise<CampaignItem[]> {
  try {
    const now = new Date();
    const rows = await prisma.campaign.findMany({
      where: {
        placement,
        isActive: true,
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
        ],
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      take,
      select: {
        id: true, placement: true, kind: true, title: true, subtitle: true,
        imageUrl: true, ctaLabel: true, ctaLink: true, badge: true,
        dismissible: true, frequency: true, sortOrder: true, endsAt: true,
      },
    });
    return rows.map((r) => ({ ...r, endsAt: r.endsAt ? r.endsAt.toISOString() : null }));
  } catch (e) {
    logger.error('campaigns', 'read failed', { err: e });
    return [];
  }
}

/** প্রবেশ-পপআপ — সক্রিয় ও সময়-উপযুক্ত সবগুলো (ক্লায়েন্ট অগ্রাধিকার
 *  ও frequency অনুযায়ী একটি বেছে নেয়) */
export async function getPopups(): Promise<CampaignItem[]> {
  return getCampaigns('POPUP', 6);
}

/** প্রচারণা স্লাইডার */
export async function getSlides(): Promise<CampaignItem[]> {
  return getCampaigns('SLIDER', 8);
}

/** ভাসমান ঘোষণা কার্ড */
export async function getFloatingCards(): Promise<CampaignItem[]> {
  return getCampaigns('FLOAT', 3);
}

/** নোটিশ/ঘোষণা বার — একাধিক হতে পারে */
export async function getNotices(): Promise<CampaignItem[]> {
  return getCampaigns('NOTICE', 5);
}

/** হিরো মার্কেটিং কনটেন্ট — সাধারণত একটি */
export async function getHeroCampaign(): Promise<CampaignItem | null> {
  const items = await getCampaigns('HERO', 1);
  return items[0] ?? null;
}
