import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { resetSchema } from '@/lib/validation';
import { apiError, ApiError, readJson } from '@/lib/guard';
import { rateLimit, getIp, RATE_LIMIT_UNAVAILABLE_MSG } from '@/lib/rateLimit';
import { verifyResetToken, resetTokenSource } from '@/lib/passwordReset';
import { notify } from '@/lib/notify';
import { logActivity, requestMeta } from '@/lib/adminLog';
import { revokeUserApiKeys } from '@/lib/apiKey';

export async function POST(req: Request) {
  try {
    // ★ Rate limit — এক IP থেকে ১৫ মিনিটে ১০ বার
    //   C4: fail-closed — এই endpoint রিসেট-টোকেন যাচাই করে, অর্থাৎ
    //   সীমা না থাকলে টোকেন brute-force করা যেত।
    const rl = await rateLimit(`reset:${getIp(req)}`, 10, 900, { failClosed: true });
    if (!rl.ok) {
      if (rl.failed) throw new ApiError(RATE_LIMIT_UNAVAILABLE_MSG, 503);
      throw new ApiError(
        `অনেক বেশি চেষ্টা। ${Math.ceil(rl.retryAfter / 60)} মিনিট পর আবার চেষ্টা করুন।`,
        429
      );
    }

    const parsed = resetSchema.safeParse(await readJson(req));
    if (!parsed.success) throw new ApiError(parsed.error.errors[0].message, 400);

    const { token, password } = parsed.data;

    // ★ টোকেন যাচাই — বৈধ হলে userId
    const userId = await verifyResetToken(token);
    if (!userId) {
      throw new ApiError('লিংকটি অবৈধ বা মেয়াদ শেষ। আবার রিসেট করুন।', 400);
    }

    const current = await prisma.user.findUnique({
      where: { id: userId },
      select: { password: true, name: true },
    });
    if (!current) throw new ApiError('লিংকটি অবৈধ বা মেয়াদ শেষ। আবার রিসেট করুন।', 400);

    const hash = await bcrypt.hash(password, 12);

    // ★ পাসওয়ার্ড আপডেট — এতে হ্যাশ বদলে যায়, তাই এই রিসেট লিংক
    //   আর কখনো কাজ করবে না (single-use)
    // ★★★ একই লেখায় `sessionEpoch` বাড়ানো — অন্য সব ডিভাইসের সেশন বাতিল।
    //   মানুষ পাসওয়ার্ড রিসেট করেন প্রায়ই অ্যাকাউন্ট বেহাত হয়েছে সন্দেহে।
    //   আগে রিসেটের পরও আক্রমণকারীর হাতের সেশন ৩০ দিন বৈধ থাকত (মাপা:
    //   epoch 0 → 0)। "সব ডিভাইস থেকে সাইন-আউট" বোতামের ঠিক একই প্রক্রিয়া
    //   (`auth.ts` jwt callback epoch মেলায়) — নতুন কোনো পথ নয়।
    //   ⚠️ রিসেটকারী নিজে এই মুহূর্তে লগইন-করা নন, তাই তাঁর কিছু হারায় না।
    // ★★★ compare-and-set — **যে হ্যাশ দেখে টোকেন যাচাই হলো, সেটিই এখনো
    //   থাকলে** তবেই লেখা। আগে একই লিংকে দুটি সমান্তরাল অনুরোধ দুটোই যাচাই
    //   পেরিয়ে পাসওয়ার্ড লিখতে পারত — "এক-বারের" লিংক দুবার চলত। bcrypt-এর
    //   ~২০০ms জানালায় এটি বাস্তব। এখন দ্বিতীয়টি ০ সারি পায় ও প্রত্যাখ্যাত।
    // ★★★ AUTH-01 — একই transaction-এ সব সক্রিয় API কী-ও প্রত্যাহার। কী
    //   সেশন-নিরপেক্ষ, তাই epoch বাড়ালেও বেহাত কী দিয়ে ওয়ালেট থেকে অর্ডার
    //   চলতেই থাকত। CAS ব্যর্থ হলে throw → কী-প্রত্যাহারও rollback।
    const revokedKeys = await prisma.$transaction(async (tx) => {
      const written = await tx.user.updateMany({
        where: { id: userId, password: current.password },
        data: { password: hash, sessionEpoch: { increment: 1 } },
      });
      if (written.count !== 1) {
        throw new ApiError('লিংকটি অবৈধ বা মেয়াদ শেষ। আবার রিসেট করুন।', 400);
      }
      return revokeUserApiKeys(tx, userId);
    });

    // ★ অডিট — কে, কখন, কোন পথে (ইমেইল-লিংক বনাম অ্যাডমিনের রিকভারি-লিংক)
    logActivity({
      actorId: userId, actorName: current.name, actorType: 'CUSTOMER', role: 'USER',
      action: 'PASSWORD_RESET', targetId: userId,
      detail: (resetTokenSource(token) === 'admin'
        ? 'অ্যাডমিনের রিকভারি-লিংক দিয়ে পাসওয়ার্ড বদল · অন্য সব সেশন বাতিল'
        : 'ইমেইল-লিংক দিয়ে পাসওয়ার্ড বদল · অন্য সব সেশন বাতিল')
        + (revokedKeys > 0 ? ` · ${revokedKeys}টি API কী প্রত্যাহার` : ''),
      ...requestMeta(req),
    }).catch(() => {});

    notify(
      userId,
      'পাসওয়ার্ড পরিবর্তন হয়েছে',
      'আপনার পাসওয়ার্ড বদলানো হয়েছে। এটা আপনি না করে থাকলে এখনই আমাদের জানান।',
      '/account'
    ).catch(() => {});

    return Response.json({
      success: true,
      message: 'পাসওয়ার্ড বদলানো হয়েছে। এবার নতুন পাসওয়ার্ড দিয়ে লগইন করুন।',
    });
  } catch (e) {
    return apiError(e);
  }
}
