import { prisma } from '@/lib/prisma';
import { forgotSchema } from '@/lib/validation';
import { apiError, ApiError, readJson } from '@/lib/guard';
import { rateLimit, getIp, LIMITS, RATE_LIMIT_UNAVAILABLE_MSG } from '@/lib/rateLimit';
import { makeResetToken } from '@/lib/passwordReset';
import { emailPasswordReset } from '@/lib/email';

/** ★ সব পথে একই উত্তর — enumeration ও সীমা-সংকেত বন্ধ */
const SAME_ANSWER = {
  success: true,
  message: 'যদি এই ইমেইলে অ্যাকাউন্ট থাকে, রিসেট লিংক পাঠানো হয়েছে। ইনবক্স (ও স্প্যাম) দেখুন।',
};

export async function POST(req: Request) {
  try {
    // ★ Rate limit — এক IP থেকে ১৫ মিনিটে ৫ বার
    //   C4: অথ-পথ, তাই fail-closed — লিমিটার ব্যর্থ হলে রিসেট-ইমেইল
    //   স্প্যাম/enumeration সীমাহীন হয়ে যেত।
    const rl = await rateLimit(`forgot:${getIp(req)}`, 5, 900, { failClosed: true });
    if (!rl.ok) {
      // ⚠️ লিমিটার ভেঙেছে কিনা বলা হয় না — কেবল সাময়িক সমস্যা
      if (rl.failed) throw new ApiError(RATE_LIMIT_UNAVAILABLE_MSG, 503);
      throw new ApiError(
        `অনেক বেশি চেষ্টা। ${Math.ceil(rl.retryAfter / 60)} মিনিট পর আবার চেষ্টা করুন।`,
        429
      );
    }

    const parsed = forgotSchema.safeParse(await readJson(req));
    if (!parsed.success) throw new ApiError(parsed.error.errors[0].message, 400);

    const { email } = parsed.data;

    // ★★★ AUTH-07 — প্রতি ইমেইলে ঘণ্টায় ৩টি। পেরোলে নীরবে পাঠানো বাদ, উত্তর একই
    //   (অ্যাকাউন্ট আছে কি না বা সীমা ছুঁয়েছে কি না — কিছুই ফাঁস নয়)।
    const destRl = await rateLimit(`forgot:email:${email}`, LIMITS.forgotDest.limit, LIMITS.forgotDest.window, {
      failClosed: true,
    });
    if (destRl.failed) throw new ApiError(RATE_LIMIT_UNAVAILABLE_MSG, 503);
    if (!destRl.ok) return Response.json(SAME_ANSWER);

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, name: true, email: true, password: true, isBanned: true },
    });

    // ★★★ ইমেইল enumeration আটকানো — ইউজার থাকুক বা না থাকুক,
    //     সবসময় একই সফল বার্তা ফেরত যায়। আক্রমণকারী বুঝতে পারবে না
    //     কোন ইমেইল আসল।
    if (user && !user.isBanned) {
      const token = makeResetToken(user.id, user.password);
      const base = process.env.NEXTAUTH_URL || 'http://localhost:3000';
      const url = `${base}/reset-password?token=${encodeURIComponent(token)}`;
      // email fail করলেও flow ভাঙবে না
      emailPasswordReset(user.email, user.name, url).catch(() => {});
    }

    return Response.json(SAME_ANSWER);
  } catch (e) {
    return apiError(e);
  }
}
