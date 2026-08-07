import { prisma } from '@/lib/prisma';
import { requireUser, apiError } from '@/lib/guard';
import { rateLimit, getIp } from '@/lib/rateLimit';
import { adminLog } from '@/lib/adminLog';
import { notify } from '@/lib/notify';

export const dynamic = 'force-dynamic';

/**
 * ★★★ সব ডিভাইস থেকে সাইন-আউট (Phase 2 — session revocation)
 *
 *   JWT stateless — server কোনো session তালিকা রাখে না, তাই একটি
 *   নির্দিষ্ট ডিভাইস আলাদা করে revoke করা যায় না। কিন্তু `sessionEpoch`
 *   বাড়িয়ে দিলে **সব** পুরনো টোকেন এক ধাক্কায় অকার্যকর হয় (jwt callback
 *   প্রতি refresh এ epoch মিলিয়ে দেখে; না মিললে টোকেন বাতিল)।
 *
 *   ব্যবহার: অ্যাডমিন compromise সন্দেহ, ফোন হারানো, পাসওয়ার্ড বদলের পর।
 *   ⚠️ বর্তমান ব্রাউজারও সাইন-আউট হবে — এটাই উদ্দেশ্য। ইউজার আবার
 *      লগইন করলে নতুন epoch-সহ নতুন টোকেন পাবে।
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();

    const rl = await rateLimit(`signout-all:${user.id}`, 5, 600);
    if (!rl.ok) return apiError(Object.assign(new Error('অনেক বেশি চেষ্টা'), { status: 429 }));

    await prisma.user.update({
      where: { id: user.id },
      data: { sessionEpoch: { increment: 1 } },
    });

    adminLog({
      adminId: user.id, adminName: user.name, action: 'SESSION_REVOKE_ALL',
      detail: 'সব ডিভাইস থেকে সাইন-আউট', ip: getIp(req),
    }).catch(() => {});

    notify(
      user.id, 'সব ডিভাইস সাইন-আউট',
      'আপনার অ্যাকাউন্ট সব ডিভাইস থেকে সাইন-আউট করা হয়েছে।',
      '/login'
    ).catch(() => {});

    return Response.json({ success: true });
  } catch (e) {
    return apiError(e);
  }
}
