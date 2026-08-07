import { apiError } from '@/lib/guard';
import { assertCronAuth } from '@/lib/cronAuth';
import { runJob } from '@/lib/jobRuns';
import { tick, ensureSchedulerStarted } from '@/lib/telegram/scheduler';
import '@/lib/telegram/handlers';

export const dynamic = 'force-dynamic';

/**
 * ★★★ cron: টেলিগ্রাম শিডিউলার টিক (C2 · প্রতি ১০ মিনিট)
 *
 *   ── কেন এটি দরকার ছিল ──
 *   `ensureSchedulerStarted()` একটি ইন-প্রসেস টাইমার চালায়, যা
 *   দীর্ঘ-চলমান সার্ভারে কাজ করে। কিন্তু Vercel serverless-এ প্রতিটি
 *   অনুরোধের পর প্রসেস মরে যায় — টাইমার টেকে না। ফলে **প্রতিটি
 *   নির্ধারিত ব্রডকাস্ট নীরবে অচল ছিল**: অ্যাডমিন শিডিউল করতেন,
 *   UI "শিডিউলড" দেখাত, কিন্তু কিছুই পাঠানো হতো না।
 *
 *   এখন GitHub Actions বাইরে থেকে ডাকে। **একই `tick()`** চলে, তাই
 *   দুই পথে আচরণ অভিন্ন।
 *
 *   ⚠️ পুরনো `/api/admin/telegram/scheduler/tick` **রাখা হয়েছে** —
 *      অ্যাডমিন প্যানেল থেকে হাতে টিক দেওয়ার পথ, আর কেউ সেটি
 *      বাইরের cron-এ বসিয়ে থাকলে যেন না ভাঙে।
 */
async function handle(req: Request) {
  try {
    assertCronAuth(req, 'telegram-scheduler');

    const r = await runJob('telegram-scheduler', async () => {
      ensureSchedulerStarted();
      const t = await tick();
      // ⚠️ `tick()` এর `ran` একটি **অ্যারে** (কোন কোন জব চলেছে), সংখ্যা নয় —
      //    সরাসরি টেমপ্লেটে বসালে খালি স্ট্রিং হয়ে যেত।
      return {
        result: { ran: t.ran, skipped: t.skipped },
        detail: `${t.ran.length} টি পাঠানো · ${t.skipped} টি বাদ`,
      };
    });

    if (!r.ok) return Response.json({ success: false, error: r.error, ms: r.ms }, { status: 500 });
    return Response.json({ success: true, ...r.result, ms: r.ms, at: new Date().toISOString() });
  } catch (e) {
    return apiError(e);
  }
}

export const POST = handle;
export const GET = handle;
