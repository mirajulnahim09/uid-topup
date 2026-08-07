import { apiError, ApiError } from '@/lib/guard';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
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
export async function POST(req: Request) {
  try {
    // ★ C2 — Bearer যাচাই এখন শেয়ার্ড `verifyCronSecret()` করে।
    //   আগে এখানে `bearer === secret` ছিল: (ক) constant-time নয়,
    //   (খ) অথেন্টিকেশন যুক্তির দ্বিতীয় কপি — একটিতে ঠিক করলে
    //   অন্যটি পিছিয়ে থাকত। অ্যাডমিন-সেশন fallback অপরিবর্তিত।
    let allowed = false;
    if (verifyCronSecret(req)) {
      allowed = true;
    } else {
      const session = await getServerSession(authOptions);
      if (session?.user?.id) {
        const u = await prisma.user.findUnique({
          where: { id: session.user.id }, select: { role: true },
        });
        allowed = u?.role === 'ADMIN';
      }
    }
    if (!allowed) throw new ApiError('অনুমতি নেই', 401);

    ensureSchedulerStarted();
    const r = await tick();
    return Response.json({ success: true, ran: r.ran, skipped: r.skipped, at: new Date().toISOString() });
  } catch (e) {
    return apiError(e);
  }
}

/** GET — সুবিধার জন্য (কিছু cron শুধু GET পাঠায়) */
export async function GET(req: Request) {
  return POST(req);
}
