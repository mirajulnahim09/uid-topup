import { requireAdmin, apiError } from '@/lib/guard';
import { getAnalytics, getAllBots } from '@/lib/telegram';

export const dynamic = 'force-dynamic';

/**
 * ★ ডেলিভারি লগ ও বিশ্লেষণ।
 *
 *   সব সংখ্যা `TelegramMessageLog` থেকে **হিসাব করে** আসে, কোনো
 *   আলাদা কাউন্টার নেই — তাই "মোট" আর "দৈনিক ভাঙা" কখনো একে অপরের
 *   সাথে অমিল হতে পারে না।
 *
 *   ⚠️ লগে কোনো টোকেন নেই; ত্রুটি-বার্তা লেখার সময়েই scrub করা হয়েছে।
 */
export async function GET() {
  try {
    await requireAdmin();
    const [analytics, bots] = await Promise.all([getAnalytics(), getAllBots()]);

    // botId → পড়ার মতো নাম (লগে শুধু id থাকে)
    const names = Object.fromEntries(bots.map((b) => [b.id, b.label]));

    return Response.json({
      ...analytics,
      perBot: analytics.perBot.map((p) => ({ ...p, label: names[p.botId] ?? p.botId })),
      recent: analytics.recent.map((r) => ({ ...r, botLabel: names[r.botId] ?? r.botId })),
    });
  } catch (e) {
    return apiError(e);
  }
}
