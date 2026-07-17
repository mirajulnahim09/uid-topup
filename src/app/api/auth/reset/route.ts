import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { resetSchema } from '@/lib/validation';
import { apiError, ApiError } from '@/lib/guard';
import { rateLimit, getIp } from '@/lib/rateLimit';
import { verifyResetToken } from '@/lib/passwordReset';
import { notify } from '@/lib/notify';

export async function POST(req: Request) {
  try {
    // ★ Rate limit — এক IP থেকে ১৫ মিনিটে ১০ বার
    const rl = rateLimit(`reset:${getIp(req)}`, 10, 900);
    if (!rl.ok) {
      throw new ApiError(
        `অনেক বেশি চেষ্টা। ${Math.ceil(rl.retryAfter / 60)} মিনিট পর আবার চেষ্টা করুন।`,
        429
      );
    }

    const parsed = resetSchema.safeParse(await req.json());
    if (!parsed.success) throw new ApiError(parsed.error.errors[0].message, 400);

    const { token, password } = parsed.data;

    // ★ টোকেন যাচাই — বৈধ হলে userId
    const userId = await verifyResetToken(token);
    if (!userId) {
      throw new ApiError('লিংকটি অবৈধ বা মেয়াদ শেষ। আবার রিসেট করুন।', 400);
    }

    const hash = await bcrypt.hash(password, 12);

    // ★ পাসওয়ার্ড আপডেট — এতে হ্যাশ বদলে যায়, তাই এই রিসেট লিংক
    //   আর কখনো কাজ করবে না (single-use)
    await prisma.user.update({
      where: { id: userId },
      data: { password: hash },
    });

    notify(
      userId,
      'পাসওয়ার্ড পরিবর্তন হয়েছে',
      'আপনার পাসওয়ার্ড সফলভাবে রিসেট করা হয়েছে। এটি আপনি না করে থাকলে সাথে সাথে যোগাযোগ করুন।',
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
