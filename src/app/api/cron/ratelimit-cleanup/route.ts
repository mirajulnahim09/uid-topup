import { apiError } from '@/lib/guard';
import { assertCronAuth } from '@/lib/cronAuth';
import { runJob } from '@/lib/jobRuns';
import { cleanupRateLimitBuckets } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

/**
 * ★★★ cron: মেয়াদোত্তীর্ণ RateLimitBucket পরিষ্কার (C2 · দিনে একবার)
 *
 *   আগে পরিষ্কার হতো কেবল ২% সম্ভাবনায়, `rateLimit()` কলের ভেতরে —
 *   কম ট্রাফিকে কার্যত কখনোই না। টেবিল বাড়লে প্রতিটি লগইন/অর্ডারের
 *   rate-limit লেখা ধীর হতো (Neon-এ বাড়তি I/O)।
 */
async function handle(req: Request) {
  try {
    assertCronAuth(req, 'ratelimit-cleanup');

    const r = await runJob('ratelimit-cleanup', async () => {
      const deleted = await cleanupRateLimitBuckets();
      return { result: { deleted }, detail: `${deleted} টি মেয়াদোত্তীর্ণ সারি মুছেছে` };
    });

    if (!r.ok) return Response.json({ success: false, error: r.error, ms: r.ms }, { status: 500 });
    return Response.json({ success: true, ...r.result, ms: r.ms, at: new Date().toISOString() });
  } catch (e) {
    return apiError(e);
  }
}

export const POST = handle;
/** GET — কিছু cron ক্লায়েন্ট কেবল GET পাঠায় */
export const GET = handle;
