import { apiError, requireAdmin } from '@/lib/guard';
import { verifyCronSecret } from '@/lib/cronAuth';
import { tick, ensureSchedulerStarted } from '@/lib/telegram/scheduler';
import '@/lib/telegram/handlers';

export const dynamic = 'force-dynamic';

/**
 * ★★★ বাহ্যিক টিক — serverless / Windows Task Scheduler / Vercel Cron
 *
 *   ── কেন আলাদা endpoint ──
 *   ইন-প্রসেস টাইমার (`ensureSchedulerStarted`) দীর্ঘ-চলমান সার্ভারে
 *   (EXE, VPS, `next start`) কাজ করে। কিন্তু serverless-এ প্রতিটি
 *   অনুরোধের পর প্রসেস মরে যায়, তাই টাইমার টেকে না। সেখানে বাইরের
 *   কেউ এই endpoint ডাকবে। **একই `tick()`** চলে, তাই দুই পথে আচরণ অভিন্ন।
 *
 *   ── প্রবেশাধিকার ──
 *   `CRON_SECRET` সেট থাকলে `Authorization: Bearer <secret>` লাগে।
 *   না থাকলে শুধু লগইন-করা অ্যাডমিন পারবে — অর্থাৎ ডিফল্টে endpoint
 *   উন্মুক্ত নয়। (একটি অরক্ষিত টিক-endpoint বাইরের যে কাউকে বারবার
 *   জব চালানোর সুযোগ দিত।)
 */
async function runTick() {
  ensureSchedulerStarted();
  const r = await tick();
  return Response.json({ success: true, ran: r.ran, skipped: r.skipped, at: new Date().toISOString() });
}

export async function POST(req: Request) {
  try {
    // ★ C2 — Bearer যাচাই শেয়ার্ড `verifyCronSecret()` (constant-time)।
    // ★★★ SEC-05 — কুকি-পথ এখন `requireAdmin()`: DB-র role **এবং** ban ও
    //   `sessionEpoch`। আগে কেবল DB-role দেখা হতো, তাই বাতিল/ব্যান করা
    //   অ্যাডমিন-সেশন দিয়েও জব চালানো যেত।
    if (!verifyCronSecret(req)) await requireAdmin();
    return await runTick();
  } catch (e) {
    return apiError(e);
  }
}

/**
 * ★★★ SEC-05 — GET কেবল Bearer-secret দিয়ে (কিছু বাইরের cron শুধু GET পাঠায়)।
 *   কুকি দিয়ে GET আর চলে না: আগে GET → POST ছিল, ফলে অ্যাডমিনের ব্রাউজারে
 *   অন্য সাইটের একটি লিংক/রিডাইরেক্ট (top-level GET, SameSite=lax কুকি যায়)
 *   জব চালিয়ে দিত — CSRF। লিংকে `Authorization` হেডার বসানো যায় না, তাই
 *   Bearer-GET নিরাপদ।
 */
export async function GET(req: Request) {
  try {
    if (!verifyCronSecret(req)) {
      return Response.json({ error: 'কেবল POST (বা Bearer secret সহ GET)' }, { status: 405, headers: { Allow: 'POST' } });
    }
    return await runTick();
  } catch (e) {
    return apiError(e);
  }
}
