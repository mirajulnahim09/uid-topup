import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdmin, apiError, ApiError, readJson } from '@/lib/guard';
import { rateLimit, getIp, RATE_LIMIT_UNAVAILABLE_MSG } from '@/lib/rateLimit';
import { makeResetToken, RESET_TTL_MINUTES } from '@/lib/passwordReset';
import { notify } from '@/lib/notify';

export const dynamic = 'force-dynamic';

/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ জরুরি অ্যাকাউন্ট-রিকভারি — অ্যাডমিন-অনুমোদিত, এক-বারের রিসেট-লিংক
 *     (চূড়ান্ত মাস্টার অডিট, ২০২৬-০৯-১৭, মালিকের অনুমোদনে)
 *
 *   কেন দরকার: গ্রাহক পাসওয়ার্ড ভুলে গেলে একমাত্র পথ ইমেইল-রিসেট। ইমেইল
 *   না পৌঁছালে (স্যান্ডবক্স প্রেরক, স্প্যাম, ভুল ঠিকানা) তিনি স্থায়ীভাবে
 *   আটকে যেতেন — অথচ ওয়ালেটে তাঁর টাকা আছে।
 *
 *   ⚠️ এটি **master password নয়** — কোনো সার্বজনীন চাবি, লুকানো bypass বা
 *   স্থায়ী শংসাপত্র এখানে নেই:
 *     · লিংক একটি নির্দিষ্ট অ্যাকাউন্টের, ৩০ মিনিট মেয়াদি
 *     · স্বাক্ষর গ্রাহকের **বর্তমান পাসওয়ার্ড-হ্যাশে** বাঁধা — একবার ব্যবহার
 *       হলেই (বা গ্রাহক নিজে পাসওয়ার্ড বদলালে) অকেজো; পুনর্ব্যবহার অসম্ভব
 *     · টোকেন কোথাও সংরক্ষিত হয় না, পাসওয়ার্ড কখনো দেখানো/জমা হয় না
 *     · গ্রাহক নিজেই নতুন পাসওয়ার্ড দেন; 2FA চালু থাকলে লগইনে সেটিও লাগে
 *     · রিসেট হলে `sessionEpoch` বাড়ে — অন্য সব ডিভাইস বেরিয়ে যায়
 *
 *   ⚠️ ADMIN অ্যাকাউন্টের জন্য বানানো **নিষিদ্ধ**: চুরি যাওয়া অ্যাডমিন-সেশন
 *   নাহলে নিজের জন্য লিংক বানিয়ে বর্তমান পাসওয়ার্ড ছাড়াই অ্যাকাউন্ট স্থায়ীভাবে
 *   দখল করতে পারত। মালিক নিজের পাসওয়ার্ড প্রোফাইল থেকে বদলান।
 *
 *   ⚠️ অডিট-সারি **আগে** লেখা হয় এবং ব্যর্থ হলে লিংক দেওয়া হয় না —
 *   `adminLog()` ব্যর্থতা গিলে ফেলে, তাই এখানে সরাসরি লেখা।
 * ═══════════════════════════════════════════════════════════
 */
const schema = z.object({ userId: z.string().trim().min(1).max(40) });

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();

    // ★ ঘণ্টায় ১০টি — ভুল করে/চুরি-করা সেশনে গণহারে লিংক বানানো আটকায়
    const rl = await rateLimit(`recovery:${admin.id}`, 10, 3600, { failClosed: true });
    if (!rl.ok) {
      throw new ApiError(
        rl.failed ? RATE_LIMIT_UNAVAILABLE_MSG : 'অনেক বেশি রিকভারি-লিংক তৈরি হয়েছে — কিছুক্ষণ পর চেষ্টা করুন।',
        rl.failed ? 503 : 429,
      );
    }

    const parsed = schema.safeParse(await readJson(req));
    if (!parsed.success) throw new ApiError('userId প্রয়োজন', 400);

    const user = await prisma.user.findUnique({
      where: { id: parsed.data.userId },
      select: { id: true, name: true, email: true, role: true, isBanned: true, password: true },
    });
    if (!user) throw new ApiError('ইউজার পাওয়া যায়নি', 404);
    if (user.role === 'ADMIN') {
      throw new ApiError('অ্যাডমিন অ্যাকাউন্টের জন্য রিকভারি-লিংক তৈরি করা যায় না — প্রোফাইল থেকে পাসওয়ার্ড বদলান।', 403);
    }
    if (user.isBanned) {
      // ★ রিসেট-যাচাই বন্ধ অ্যাকাউন্টের টোকেন এমনিতেই প্রত্যাখ্যান করে — ভুয়া আশা নয়
      throw new ApiError('বন্ধ অ্যাকাউন্টের রিকভারি হয় না — আগে সক্রিয় করুন।', 409);
    }

    const expiresAt = new Date(Date.now() + RESET_TTL_MINUTES * 60_000);

    await prisma.adminLog.create({
      data: {
        adminId: admin.id,
        adminName: admin.name,
        actorType: 'ADMIN',
        role: 'ADMIN',
        action: 'ACCOUNT_RECOVERY_LINK',
        targetId: user.id,
        detail: `${user.name} (${user.email}) — ${RESET_TTL_MINUTES} মিনিট মেয়াদি এক-বারের রিসেট-লিংক তৈরি`,
        ip: getIp(req),
        userAgent: (req.headers.get('user-agent') || '').slice(0, 300) || null,
      },
    });

    const token = makeResetToken(user.id, user.password, 'admin');
    const base = (process.env.NEXTAUTH_URL || new URL(req.url).origin).replace(/\/$/, '');

    // ★ গ্রাহককে জানানো — আসল মালিক অনুরোধ না করে থাকলে সাথে সাথে টের পান
    notify(
      user.id,
      'পাসওয়ার্ড-রিসেট লিংক তৈরি হয়েছে',
      `সাপোর্ট আপনার অ্যাকাউন্টের জন্য একটি রিসেট-লিংক তৈরি করেছে (${RESET_TTL_MINUTES} মিনিট মেয়াদ)। আপনি অনুরোধ না করে থাকলে এখনই সাপোর্টে জানান।`,
      '/account/profile',
    ).catch(() => {});

    return Response.json(
      {
        success: true,
        url: `${base}/reset-password?token=${encodeURIComponent(token)}`,
        expiresAt: expiresAt.toISOString(),
      },
      // ★ লিংকটি একটি শংসাপত্র — কোনো ক্যাশে থাকবে না
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return apiError(e);
  }
}
