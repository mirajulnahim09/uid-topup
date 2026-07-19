import { prisma } from '@/lib/prisma';
import { requireUser, apiError } from '@/lib/guard';

export const dynamic = 'force-dynamic';

/**
 * ═══════════════════════════════════════════════════════════
 * ★ সম্প্রতি ব্যবহৃত Player UID — এক ট্যাপে বসানোর জন্য
 *
 *   কেন: বেশিরভাগ গ্রাহক বারবার **নিজের একই অ্যাকাউন্টেই**
 *   টপ-আপ করে (MANUAL_WORKFLOW.md A4/A9)। প্রতিবার ৯–১১ সংখ্যার
 *   UID দুইবার করে টাইপ করানো অর্থহীন ঘর্ষণ — এবং প্রতিবারই
 *   টাইপো করার নতুন সুযোগ।
 *
 *   ★ আলাদা টেবিল বানানো হয়নি — অর্ডারের ইতিহাসই সত্যের উৎস।
 *     ফলে কোনো তথ্য দুই জায়গায় থাকে না, আর ইতিহাস মুছলে
 *     পরামর্শও আপনাআপনি মুছে যায়।
 *
 *   ⚠️ শুধুমাত্র নিজের অর্ডার থেকে — requireUser() এর কারণে
 *      অন্য কারো UID কখনো ফাঁস হয় না।
 * ═══════════════════════════════════════════════════════════
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser();

    const url = new URL(req.url);
    const productIdRaw = url.searchParams.get('productId');
    const productId = productIdRaw ? Number(productIdRaw) : NaN;

    // ★ একই প্রোডাক্টের UID সবচেয়ে প্রাসঙ্গিক (Free Fire এর UID
    //   Netflix এ কাজে লাগে না), তাই productId দিলে সেটিতেই সীমিত
    const orders = await prisma.order.findMany({
      where: {
        userId: user.id,
        ...(Number.isFinite(productId)
          ? { variant: { productId } }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: { playerUid: true, playerName: true, createdAt: true },
    });

    // ★ সাম্প্রতিকতম ব্যবহার অনুসারে ইউনিক করি
    const seen = new Set<string>();
    const recent: Array<{ uid: string; name: string | null }> = [];
    for (const o of orders) {
      const uid = o.playerUid.trim();
      if (!uid || seen.has(uid)) continue;
      seen.add(uid);
      recent.push({ uid, name: o.playerName });
      if (recent.length >= 5) break;
    }

    return Response.json({ recent });
  } catch (e) {
    return apiError(e);
  }
}
