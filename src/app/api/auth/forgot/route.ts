import { prisma } from '@/lib/prisma';
import { forgotSchema } from '@/lib/validation';
import { apiError, ApiError, readJson } from '@/lib/guard';
import { rateLimit, getIp } from '@/lib/rateLimit';
import { makeResetToken } from '@/lib/passwordReset';
import { emailPasswordReset } from '@/lib/email';

export async function POST(req: Request) {
  try {
    // ★ Rate limit — এক IP থেকে ১৫ মিনিটে ৫ বার
    const rl = await rateLimit(`forgot:${getIp(req)}`, 5, 900);
    if (!rl.ok) {
      throw new ApiError(
        `অনেক বেশি চেষ্টা। ${Math.ceil(rl.retryAfter / 60)} মিনিট পর আবার চেষ্টা করুন।`,
        429
      );
    }

    const parsed = forgotSchema.safeParse(await readJson(req));
    if (!parsed.success) throw new ApiError(parsed.error.errors[0].message, 400);

    const { email } = parsed.data;

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

    return Response.json({
      success: true,
      message:
        'যদি এই ইমেইলে অ্যাকাউন্ট থাকে, রিসেট লিংক পাঠানো হয়েছে। ইনবক্স (ও স্প্যাম) দেখুন।',
    });
  } catch (e) {
    return apiError(e);
  }
}
