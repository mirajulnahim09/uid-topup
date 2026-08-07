import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { registerSchema } from '@/lib/validation';
import { apiError, ApiError, readJson } from '@/lib/guard';
import { rateLimit, getIp, LIMITS } from '@/lib/rateLimit';
import { uniqueReferralCode } from '@/lib/referral';
import { emailWelcome } from '@/lib/email';
import { cleanText } from '@/lib/sanitize';

import { notifyAdmins } from '@/lib/notify';

export async function POST(req: Request) {
  try {
    // ★ Rate limit — bot spam registration আটকায়
    const rl = await rateLimit(`reg:${getIp(req)}`, LIMITS.register.limit, LIMITS.register.window);
    if (!rl.ok) {
      throw new ApiError(
        `অনেক বেশি চেষ্টা। ${Math.ceil(rl.retryAfter / 60)} মিনিট পর আবার চেষ্টা করুন।`,
        429
      );
    }

    const parsed = registerSchema.safeParse(await readJson(req));
    if (!parsed.success) throw new ApiError(parsed.error.errors[0].message, 400);

    const { email, phone, password } = parsed.data;
    const name = cleanText(parsed.data.name, 60); // ★ XSS guard
    const refCode = parsed.data.referralCode?.trim().toUpperCase();

    const dupe = await prisma.user.findFirst({
      where: { OR: [{ email }, { phone }] },
      select: { email: true },
    });
    if (dupe) {
      throw new ApiError(
        dupe.email === email
          ? 'এই ইমেইল দিয়ে অ্যাকাউন্ট আছে'
          : 'এই মোবাইল নাম্বার দিয়ে অ্যাকাউন্ট আছে',
        409
      );
    }

    let referredById: string | null = null;
    if (refCode) {
      const r = await prisma.user.findUnique({
        where: { referralCode: refCode },
        select: { id: true, isBanned: true },
      });
      if (!r || r.isBanned) throw new ApiError('রেফারেল কোডটি সঠিক নয়', 400);
      referredById = r.id;
    }

    const myCode = await uniqueReferralCode();

    let user;
    try {
      user = await prisma.user.create({
        data: {
          name,
          email,
          phone,
          password: await bcrypt.hash(password, 12), // ★ cost 12
          role: 'USER',
          referralCode: myCode,
          referredById,
        },
        select: { email: true, name: true, referralCode: true },
      });
    } catch (e: unknown) {
      // ★★★ RACE: উপরের dupe-check আর এই INSERT এর মাঝে
      //     আরেকজন একই ইমেইল/ফোন দিয়ে ঢুকে যেতে পারে।
      //     DB এর @unique ধরবে — কিন্তু কাঁচা DB error দেখানো যাবে না
      //     (টেবিলের নাম leak করে, আর ইউজার বুঝবে না)।
      const err = e as { code?: string; meta?: { target?: string[] } };
      if (err?.code === 'P2002') {
        const field = err.meta?.target?.[0];
        throw new ApiError(
          field === 'phone'
            ? 'এই মোবাইল নাম্বার দিয়ে অ্যাকাউন্ট আছে'
            : field === 'referralCode'
            ? 'আবার চেষ্টা করুন' // অত্যন্ত বিরল — কোড collision
            : 'এই ইমেইল দিয়ে অ্যাকাউন্ট আছে',
          409
        );
      }
      throw e;
    }

    emailWelcome(user.email, user.name, user.referralCode).catch(() => {});
    notifyAdmins('নতুন রেজিস্ট্রেশন', `${name} নতুন অ্যাকাউন্ট খুলেছে।`, '/admin/users', 'user_registered').catch(() => {});

    return Response.json({ success: true, referralCode: user.referralCode });
  } catch (e) {
    return apiError(e);
  }
}
