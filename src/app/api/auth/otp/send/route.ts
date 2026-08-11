import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { apiError, ApiError, readJson } from '@/lib/guard';
import { rateLimit, getIp, LIMITS, RATE_LIMIT_UNAVAILABLE_MSG } from '@/lib/rateLimit';
import { issueOtp, OTP_TTL_MINUTES } from '@/lib/otp/core';
import { signupChannels } from '@/lib/otp/channels';
import { logger } from '@/lib/logger';

/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ Group I (৩) — রেজিস্ট্রেশনের যাচাই-কোড চাওয়া
 *
 *   `POST /api/auth/otp/send`  { email, phone? }
 *
 *   ⚠️ ইচ্ছাকৃতভাবে **অননুমোদিত** — ইউজার তো এখনো তৈরিই হয়নি।
 *   সুরক্ষা দুটি স্তরে: IP rate-limit (fail-closed) ও গন্তব্য-ভিত্তিক
 *   চেষ্টা-গণনা (`Otp.attempts`)।
 *
 *   ⚠️⚠️ **অ্যাকাউন্ট-গণনা (enumeration) ফাঁস করা যাবে না।** ইমেইলটি
 *   ইতিমধ্যে নিবন্ধিত হোক বা না হোক, উত্তর **হুবহু এক**। নাহলে যে কেউ
 *   এই endpoint দিয়ে জেনে নিতে পারত কোন ইমেইলগুলোর অ্যাকাউন্ট আছে।
 *   নিবন্ধিত ইমেইলের ক্ষেত্রে আমরা কোড পাঠাই **না** (অকারণ বার্তা ও
 *   spam হতো), কিন্তু উত্তর একই থাকে।
 *
 *   ⚠️ fail-closed rate limit: C4 এর মতোই। DB পড়া না গেলে থেমে যাই —
 *   কারণ এই পথটি আসল ইমেইল পাঠায়, অর্থাৎ খরচ ও spam-ঝুঁকি।
 * ═══════════════════════════════════════════════════════════
 */
const bodySchema = z.object({
  email: z.string().trim().toLowerCase().email('সঠিক ইমেইল দিন').max(120),
  phone: z.string().trim().max(20).optional(),
});

/** ★ সব পথে একই উত্তর — enumeration বন্ধ রাখার একমাত্র উপায় */
const SAME_ANSWER = {
  success: true,
  message: `কোড পাঠানো হয়েছে। ${OTP_TTL_MINUTES} মিনিটের মধ্যে ব্যবহার করুন।`,
  ttlMinutes: OTP_TTL_MINUTES,
};

export async function POST(req: Request) {
  try {
    const ip = getIp(req);
    const rl = await rateLimit(`otp:send:${ip}`, LIMITS.otpSend.limit, LIMITS.otpSend.window, {
      failClosed: true,
    });
    if (!rl.ok) {
      throw new ApiError(
        rl.failed
          ? RATE_LIMIT_UNAVAILABLE_MSG
          : `অনেকবার কোড চাওয়া হয়েছে। ${Math.ceil(rl.retryAfter / 60)} মিনিট পর আবার চেষ্টা করুন।`,
        rl.failed ? 503 : 429,
      );
    }

    const parsed = bodySchema.safeParse(await readJson(req));
    if (!parsed.success) throw new ApiError(parsed.error.errors[0].message, 400);
    const { email, phone } = parsed.data;

    const channels = await signupChannels();
    if (channels.length === 0) {
      // ★ কনফিগ ভুল — এটি ব্যবহারকারীর দোষ নয়, তাই ৫০৩ ও পরিষ্কার লগ
      logger.error('otp', 'সাইনআপে কোনো চ্যানেল available নয় — কনফিগ দেখুন');
      throw new ApiError('যাচাই ব্যবস্থা সাময়িকভাবে বন্ধ। একটু পরে চেষ্টা করুন।', 503);
    }

    // ★ ইতিমধ্যে অ্যাকাউন্ট থাকলে কোড পাঠাই না — কিন্তু উত্তর একই
    const exists = await prisma.user.findFirst({
      where: { email },
      select: { id: true },
    });
    if (exists) return Response.json(SAME_ANSWER);

    for (const ch of channels) {
      const destination =
        ch.id === 'EMAIL' ? ch.normalize(email) : phone ? ch.normalize(phone) : null;
      if (!destination) continue;

      const { code } = await issueOtp({
        channel: ch.id,
        purpose: 'REGISTER',
        destination,
        ip,
      });

      const sent = await ch.deliver(destination, code);
      if (!sent.ok) {
        // ⚠️ "পাঠানো হয়েছে" বলে মিথ্যা বলা যাবে না — গ্রাহক তাহলে
        //    অনন্তকাল অপেক্ষা করতেন। ব্যর্থতা স্পষ্টভাবে জানাই।
        logger.error('otp', 'কোড পাঠানো যায়নি', { channel: ch.id, reason: sent.reason });
        throw new ApiError('কোড পাঠানো যায়নি। একটু পরে আবার চেষ্টা করুন।', 502);
      }
    }

    return Response.json(SAME_ANSWER);
  } catch (e) {
    return apiError(e);
  }
}
