import { prisma } from '@/lib/prisma';
import { requireUser, apiError } from '@/lib/guard';
import { rateLimit } from '@/lib/rateLimit';
import { logActivity, requestMeta } from '@/lib/adminLog';
import { notify } from '@/lib/notify';
import { revokeUserApiKeys } from '@/lib/apiKey';

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

    // ★★★ AUTH-01 — epoch-বৃদ্ধি ও সব সক্রিয় API কী-প্রত্যাহার একই transaction-এ।
    //   "সব ডিভাইস থেকে সাইন-আউট" বলতে গ্রাহক বোঝেন **সব** প্রবেশপথ বন্ধ —
    //   সেশন-নিরপেক্ষ কী খোলা থাকলে বেহাত স্ক্রিপ্ট ওয়ালেট থেকে অর্ডার দিতেই থাকত।
    const revokedKeys = await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { sessionEpoch: { increment: 1 } },
      });
      return revokeUserApiKeys(tx, user.id);
    });

    // ★ AUD-01 — ব্যবহারকারীর নিজের কাজ; আগে `adminLog` সবসময় ADMIN লিখত
    logActivity({
      actorId: user.id, actorName: user.name, actorType: user.role === 'ADMIN' ? 'ADMIN' : 'CUSTOMER', role: user.role,
      action: 'SESSION_REVOKE_ALL', targetId: user.id,
      detail: 'সব ডিভাইস থেকে সাইন-আউট' + (revokedKeys > 0 ? ` · ${revokedKeys}টি API কী প্রত্যাহার` : ''),
      ...requestMeta(req),
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
