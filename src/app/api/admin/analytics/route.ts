import { requireAdmin, apiError } from '@/lib/guard';
import { periodSummary, revenueTrend, customerInsights } from '@/lib/analytics';
import { dhakaDayStart } from '@/lib/date';

export const dynamic = 'force-dynamic';

/**
 * ★★★ Business Analytics (Phase 5) — অ্যাডমিন
 *
 *   GET /api/admin/analytics?days=30
 *   ফেরায়: আজ/৭দিন/৩০দিন সারসংক্ষেপ (revenue/cost/profit/refund),
 *   দিন-প্রতি trend (চার্ট), গ্রাহক অন্তর্দৃষ্টি।
 *
 *   ⚠️ সব stat COMPLETED অর্ডার ও APPROVED ডিপোজিট থেকে — বাস্তব টাকা,
 *      অনুমান নয়। profit-এ costPrice snapshot ব্যবহৃত (পুরনো অর্ডারে 0)।
 */
export async function GET(req: Request) {
  try {
    await requireAdmin();

    const url = new URL(req.url);
    const days = Math.min(Math.max(parseInt(url.searchParams.get('days') || '30', 10) || 30, 7), 90);

    // ★ "আজ" = ঢাকার আজ; ৭/৩০ দিন চলমান জানালা (দিন-সীমা নয়), তাই অপরিবর্তিত
    const today = dhakaDayStart();
    const d7 = new Date(); d7.setDate(d7.getDate() - 7);
    const d30 = new Date(); d30.setDate(d30.getDate() - 30);

    const [todaySum, week, month, trend, insights] = await Promise.all([
      periodSummary(today),
      periodSummary(d7),
      periodSummary(d30),
      revenueTrend(days),
      customerInsights(),
    ]);

    return Response.json({
      summary: { today: todaySum, week, month },
      trend,
      insights,
      checkedAt: new Date().toISOString(),
    });
  } catch (e) {
    return apiError(e);
  }
}
