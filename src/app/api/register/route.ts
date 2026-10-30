import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { registerSchema } from '@/lib/validation';
import { apiError, ApiError, readJson } from '@/lib/guard';
import { rateLimit, getIp, LIMITS } from '@/lib/rateLimit';
import { uniqueReferralCode } from '@/lib/referral';
import { emailWelcome } from '@/lib/email';
import { cleanText } from '@/lib/sanitize';
import { consumeOtp } from '@/lib/otp/core';
import { getOtpConfig } from '@/lib/otp/settings';

import { notifyAdmins } from '@/lib/notify';
import { logActivity, requestMeta } from '@/lib/adminLog';

/** ★ AUTH-02 — OTP ব্যর্থতার সব কারণে একই বার্তা (enumeration রোধ) */
const OTP_FAIL_MSG = 'কোডটি সঠিক নয় বা মেয়াদ শেষ — প্রয়োজনে নতুন কোড চেয়ে আবার দিন।';

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

    /**
     * ★★★ AUTH-02 — অ্যাকাউন্ট-গণনা (enumeration) বন্ধ।
     *
     *   আগে কোড যাচাইয়ের **আগেই** এখানে বলা হতো "এই ইমেইল/মোবাইল দিয়ে অ্যাকাউন্ট
     *   আছে" — অর্থাৎ কোড ছাড়াই যে কেউ যেকোনো ইমেইল/ফোনের অস্তিত্ব জেনে নিতে
     *   পারত। এখন OTP বাধ্যতামূলক থাকলে (ডিফল্ট) এই আগাম যাচাই হয় না: আগে কোড
     *   মেলে, তারপর তৈরির সময় DB-র @unique (P2002, নিচে) সংঘর্ষ ধরে। নিবন্ধিত
     *   ইমেইলে `otp/send` কখনো কোড দেয় না, তাই সেখানে উত্তর সবসময় "কোড সঠিক নয়" —
     *   অনিবন্ধিত ইমেইলের সাথে হুবহু এক (বার্তাও, নিচের `OTP_FAIL_MSG`)।
     *   ⚠️ অ্যাডমিন OTP বন্ধ রাখলে ইমেইল-মালিকানার কোনো প্রমাণ থাকে না — তখন
     *   আগের স্পষ্ট বার্তাই থাকে (সেই মোডে এটি জানা সীমাবদ্ধতা)।
     */
    const otpCfg = await getOtpConfig();
    if (!otpCfg.requireAtSignup) {
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
    const passwordHash = await bcrypt.hash(password, 12); // ★ cost 12

    /**
     * ═══════════════════════════════════════════════════════════
     * ★★★ Group I (৩) — ইমেইল যাচাই, সাইনআপে **বাধ্যতামূলক**
     *
     *   ⚠️ কোড যাচাই ও ইউজার তৈরি **একই ট্রানজেকশনে** (`consumeOtp`
     *   কলারের কাজটি নিজের tx-এর ভেতরে চালায়)। আলাদা করলে দুটি
     *   ফাঁক তৈরি হতো:
     *     · কোড খরচ হয়ে গেছে কিন্তু ইউজার তৈরি ব্যর্থ → গ্রাহক আটকা,
     *       কোডও নষ্ট
     *     · যাচাই ও তৈরির মাঝে একই কোড দ্বিতীয়বার ব্যবহার
     *
     *   ⚠️ `emailVerified: true` **কেবল** এই পথে বসে। মাইগ্রেশনে
     *   ডিফল্ট `false` রাখা হয়েছে ইচ্ছাকৃতভাবে — OTP পথ কখনো ভাঙলে
     *   অ্যাকাউন্ট "যাচাইকৃত" দেখানোর চেয়ে "যাচাই হয়নি" দেখানো ভালো।
     * ═══════════════════════════════════════════════════════════
     */
    const createUser = async (
      tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
      emailVerified: boolean,
    ) =>
      tx.user.create({
        data: {
          name,
          email,
          phone,
          password: passwordHash,
          role: 'USER',
          referralCode: myCode,
          referredById,
          emailVerified,
        },
        select: { id: true, email: true, name: true, referralCode: true },
      });

    let user;
    try {
      if (otpCfg.requireAtSignup) {
        const code = parsed.data.code?.trim();
        if (!code) throw new ApiError('ইমেইলে পাঠানো ৬-অঙ্কের কোডটি দিন', 400);

        const r = await consumeOtp(
          { purpose: 'REGISTER', destination: email, code },
          (tx) => createUser(tx, true),
        );

        // ★ AUTH-02 — কারণ যাই হোক (কোড নেই/ভুল/মেয়াদ শেষ/অনেকবার) একই বার্তা:
        //   নিবন্ধিত ইমেইলে কারণ সবসময় "কোড নেই" হতো, তাই আলাদা বার্তা = ফাঁস।
        if (!r.ok) throw new ApiError(OTP_FAIL_MSG, 400);
        user = r.result;
      } else {
        // ★ অ্যাডমিন যাচাই বন্ধ রেখেছেন — তখন অ্যাকাউন্ট **যাচাই-হীন**
        user = await prisma.$transaction((tx) => createUser(tx, false));
      }
    } catch (e: unknown) {
      if (e instanceof ApiError) throw e;
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
    // ★ অডিট — `REGISTER` অ্যাকশন আগে থেকেই সংজ্ঞায়িত ও লগ-পাতায় লেবেলসহ ছিল,
    //   কিন্তু কোথাও লেখা হতো না (চূড়ান্ত মাস্টার অডিট, ২০২৬-০৯-১৭)। ভুয়া-অ্যাকাউন্টের
    //   ঢেউ তদন্তে "কোন IP/ডিভাইস থেকে কখন" জানা দরকার।
    logActivity({
      actorId: user.id, actorName: user.name, actorType: 'CUSTOMER', role: 'USER',
      action: 'REGISTER', targetId: user.id, ...requestMeta(req),
    }).catch(() => {});

    return Response.json({ success: true, referralCode: user.referralCode });
  } catch (e) {
    return apiError(e);
  }
}
