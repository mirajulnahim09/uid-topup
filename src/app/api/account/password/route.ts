import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';
import { decode, encode } from 'next-auth/jwt';
import { prisma } from '@/lib/prisma';
import { revokeUserApiKeys } from '@/lib/apiKey';
import { authOptions } from '@/lib/auth';
import { SESSION_COOKIE_NAME, USE_SECURE_AUTH_COOKIES } from '@/lib/authCookies';
import { requireUser, apiError, ApiError, readJson } from '@/lib/guard';
import { rateLimit, RATE_LIMIT_UNAVAILABLE_MSG } from '@/lib/rateLimit';
import { passwordSchema } from '@/lib/validation';
import { notify } from '@/lib/notify';
import { logActivity, requestMeta } from '@/lib/adminLog';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const schema = z.object({
  current: z.string().min(1, 'বর্তমান পাসওয়ার্ড দিন'),
  next: passwordSchema,
});

export async function POST(req: Request) {
  try {
    const user = await requireUser();

    // ★ পাসওয়ার্ড অনুমান করার চেষ্টা আটকায়
    //   C4: RUN.md-এ `pw:` তালিকাভুক্ত ছিল না, তবু fail-closed করা হলো —
    //   এই endpoint **বর্তমান পাসওয়ার্ড** যাচাই করে, অর্থাৎ ঠিক একই
    //   ব্রুট-ফোর্স ঝুঁকি যা `login:`-এ। ছেড়ে গেলে C4-এর ফাঁকটাই
    //   অন্য দরজা দিয়ে খোলা থাকত।
    const rl = await rateLimit(`pw:${user.id}`, 5, 900, { failClosed: true });
    if (!rl.ok) {
      if (rl.failed) throw new ApiError(RATE_LIMIT_UNAVAILABLE_MSG, 503);
      throw new ApiError('অনেক বেশি চেষ্টা। ১৫ মিনিট পর করুন।', 429);
    }

    const parsed = schema.safeParse(await readJson(req));
    if (!parsed.success) throw new ApiError(parsed.error.errors[0].message, 400);

    const row = await prisma.user.findUnique({
      where: { id: user.id },
      select: { password: true },
    });
    if (!row) throw new ApiError('ইউজার পাওয়া যায়নি', 404);

    const ok = await bcrypt.compare(parsed.data.current, row.password);
    if (!ok) throw new ApiError('বর্তমান পাসওয়ার্ড ভুল', 400);

    if (parsed.data.current === parsed.data.next) {
      throw new ApiError('নতুন পাসওয়ার্ড আগেরটার মতোই', 400);
    }

    /**
     * ★★★ AUTH-04 — পাসওয়ার্ড বদলালে **অন্য সব সেশন বাতিল**।
     *
     *   মানুষ পাসওয়ার্ড বদলায় সাধারণত সন্দেহ হলে ("কেউ ঢুকেছে?")। আগে কেবল
     *   hash বদলাত, `sessionEpoch` নয় — ফলে আক্রমণকারীর চুরি করা কুকি ৩০ দিন
     *   বেঁচে থাকত। এখন একই লেখায় epoch বাড়ে (রিসেট/সব-ডিভাইস-সাইন-আউটের মতোই),
     *   তাই পুরনো epoch-এর প্রতিটি কুকি — এই কুকির কপিসহ — `requireUser` ও
     *   পাতা-গার্ডে সাথে সাথে বাতিল।
     */
    const hash = await bcrypt.hash(parsed.data.next, 12);
    /**
     * ★★★ পাসওয়ার্ড বদলে **API কী-ও বাতিল** (মালিকের সিদ্ধান্ত, ২০২৬-০৯-২৬) —
     *   রিসেট ও সব-ডিভাইস-সাইন-আউটের (AUTH-01) সাথে এক নিয়ম: অ্যাকাউন্ট সুরক্ষিত
     *   করার কাজ সেশন-নিরপেক্ষ শংসাপত্রও বন্ধ করে। একই transaction-এ — পাসওয়ার্ড
     *   বদলাল কিন্তু কী রয়ে গেল, এমন আধা-অবস্থা হয় না। কী মোছা হয় না (`revokedAt`)।
     */
    const { updated, revokedKeys } = await prisma.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id: user.id },
        data: { password: hash, sessionEpoch: { increment: 1 } },
        select: { sessionEpoch: true },
      });
      return { updated: u, revokedKeys: await revokeUserApiKeys(tx, user.id) };
    });

    /**
     * ★ যিনি এইমাত্র বর্তমান পাসওয়ার্ড প্রমাণ করলেন, কেবল তাঁর ব্রাউজারকে নতুন
     *   epoch-এর কুকি **সার্ভার থেকে** দেওয়া হয় — তিনি লগইনেই থাকেন।
     *   ⚠️ ক্লায়েন্টের `update()` দিয়ে এটি করা হয়নি: `update()` যেকোনো সেশন
     *   ডাকতে পারে, তাতে চুরি করা সেশনও নতুন epoch নিয়ে নিত — revocation বৃথা।
     *   কুকি পড়া/লেখা না গেলে (যেমন খণ্ডিত কুকি) কিছু জোর করা হয় না: এই
     *   সেশনও বাতিল থাকে আর ব্যবহারকারী নতুন পাসওয়ার্ডে আবার লগইন করেন।
     */
    let keptSignedIn = false;
    try {
      const secret = process.env.NEXTAUTH_SECRET!;
      const jar = cookies();
      const raw = jar.get(SESSION_COOKIE_NAME)?.value;
      const token = raw ? await decode({ token: raw, secret }) : null;
      if (token && token.id === user.id) {
        const maxAge = authOptions.session?.maxAge ?? 30 * 24 * 60 * 60;
        const fresh = await encode({
          token: { ...token, epoch: updated.sessionEpoch, lastChecked: Date.now() },
          secret,
          maxAge,
        });
        jar.set(SESSION_COOKIE_NAME, fresh, {
          httpOnly: true, sameSite: 'lax', path: '/', secure: USE_SECURE_AUTH_COOKIES,
          expires: new Date(Date.now() + maxAge * 1000),
        });
        keptSignedIn = true;
      }
    } catch {
      keptSignedIn = false;
    }

    // ★ guarded (defense-in-depth): notify নিজে throw করে না (ভেতরে
    //   try/catch), তবু .catch() রাখা — refactor-এ throw এলেও order/money
    //   commit-পরবর্তী ব্যর্থতা যেন ইউজারকে ভুল "ব্যর্থ" না দেখায়।
    notify(
      user.id,
      'পাসওয়ার্ড বদলানো হয়েছে',
      'আপনি না করে থাকলে সাথে সাথে সাপোর্টে জানান।',
      '/account/profile'
    ).catch(() => {});

    // ★ অডিট — রিসেট (`PASSWORD_RESET`) লগ হয়, অথচ লগইন-অবস্থায় বদল হতো না;
    //   "আমার পাসওয়ার্ড কে বদলাল" প্রশ্নে দুটোই দরকার। পাসওয়ার্ড কখনো লগে নয়।
    logActivity({
      actorId: user.id, actorName: user.name, actorType: 'CUSTOMER', role: user.role,
      action: 'PASSWORD_CHANGE', targetId: user.id,
      detail: revokedKeys > 0 ? `${revokedKeys}টি API কী প্রত্যাহার` : undefined,
      ...requestMeta(req),
    }).catch(() => {});

    return Response.json({
      success: true,
      message: keptSignedIn
        ? 'পাসওয়ার্ড বদলানো হয়েছে — অন্য সব ডিভাইস থেকে সাইন-আউট করা হয়েছে'
        : 'পাসওয়ার্ড বদলানো হয়েছে — নতুন পাসওয়ার্ড দিয়ে আবার লগইন করুন',
      signedOutOthers: true,
      revokedApiKeys: revokedKeys,
      keptSignedIn,
    });
  } catch (e) {
    return apiError(e);
  }
}
