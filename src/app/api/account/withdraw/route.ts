import { z } from 'zod';
import { requireUser, apiError, ApiError, readJson } from '@/lib/guard';
import { rateLimit, getIp, LIMITS } from '@/lib/rateLimit';
import { consumeOtp, otpMessage, issueOtp } from '@/lib/otp/core';
import { signupChannels } from '@/lib/otp/channels';
import {
  requestWithdrawal, listUserWithdrawals, getWithdrawalConfig, withdrawableAmount,
} from '@/lib/services/withdrawal';
import { assessOneDeposit, toDbRisk, summarizeSignals } from '@/lib/riskSignals';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';

/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ Group I (৫) — গ্রাহকের প্রত্যাহার
 *
 *   GET  — কনফিগ, তোলার যোগ্য অঙ্ক, নিজের ইতিহাস
 *   PUT  — যাচাই কোড পাঠাও (OTP মডিউল পুনঃব্যবহার)
 *   POST — অনুরোধ (কোডসহ)
 *
 *   ⚠️ OTP **বাধ্যতামূলক**: এটিই একমাত্র পথ যেখানে গ্রাহকের নির্দেশে
 *   টাকা বাইরে যায়। সেশন-কুকি চুরি হলে আক্রমণকারী যেন কেবল সেটি দিয়েই
 *   ওয়ালেট খালি করতে না পারে।
 * ═══════════════════════════════════════════════════════════
 */
const reqSchema = z.object({
  amount: z.coerce.number().positive('সঠিক পরিমাণ দিন').max(1_000_000),
  method: z.string().trim().min(2).max(20),
  accountNumber: z.string().trim().min(11).max(20),
  code: z.string().trim().regex(/^\d{6}$/, 'কোড ৬ অঙ্কের হতে হবে'),
});

export async function GET() {
  try {
    const user = await requireUser();
    const cfg = await getWithdrawalConfig();

    const me = await prisma.user.findUnique({
      where: { id: user.id },
      select: { balance: true },
    });
    const usable = await withdrawableAmount(prisma, user.id, me?.balance ?? 0, cfg.holdHours);

    return Response.json({
      config: {
        enabled: cfg.enabled, min: cfg.min, dailyCap: cfg.dailyCap,
        holdHours: cfg.holdHours, methods: cfg.methods,
      },
      balance: Number(me?.balance ?? 0),
      withdrawable: usable,
      withdrawals: await listUserWithdrawals(user.id),
    });
  } catch (e) {
    return apiError(e);
  }
}

/** ★ অনুরোধের আগে যাচাই কোড */
export async function PUT(req: Request) {
  try {
    const user = await requireUser();
    const cfg = await getWithdrawalConfig();
    if (!cfg.enabled) throw new ApiError('টাকা তোলার সুবিধা এখন বন্ধ আছে', 403);

    const rl = await rateLimit(`wd:otp:${user.id}`, LIMITS.otpSend.limit, LIMITS.otpSend.window, {
      failClosed: true,
    });
    if (!rl.ok) throw new ApiError('অনেকবার কোড চাওয়া হয়েছে। একটু পরে চেষ্টা করুন।', 429);

    const channels = await signupChannels();
    if (channels.length === 0) {
      logger.error('withdraw', 'OTP চ্যানেল নেই — প্রত্যাহার আটকে গেল');
      throw new ApiError('যাচাই ব্যবস্থা সাময়িকভাবে বন্ধ। একটু পরে চেষ্টা করুন।', 503);
    }

    const { code } = await issueOtp({
      channel: 'EMAIL', purpose: 'WITHDRAW', destination: user.email, ip: getIp(req),
    });
    const sent = await channels[0].deliver(user.email, code);
    if (!sent.ok) throw new ApiError('কোড পাঠানো যায়নি। একটু পরে চেষ্টা করুন।', 502);

    return Response.json({ success: true });
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();

    const rl = await rateLimit(`wd:${user.id}`, LIMITS.withdraw.limit, LIMITS.withdraw.window);
    if (!rl.ok) throw new ApiError('অনেকবার চেষ্টা হয়েছে। একটু পরে আবার দেখুন।', 429);

    const parsed = reqSchema.safeParse(await readJson(req));
    if (!parsed.success) throw new ApiError(parsed.error.errors[0].message, 400);

    /**
     * ★★★ ঝুঁকি — Group H এর একই মূল্যায়ন এখানে পুনঃব্যবহার।
     *   সীমার উপরে হলে অনুরোধটি `HELD` হয়ে যায়, স্বাভাবিক সারিতে
     *   ঢোকে না। **কখনো auto-ban নয়** — শুধু মানুষের চোখে পাঠানো।
     */
    let elevated = false;
    let riskNote: string | null = null;
    try {
      const me = await prisma.user.findUnique({
        where: { id: user.id },
        select: { phone: true, createdAt: true },
      });
      if (me) {
        /**
         * ⚠️ সৎ কথা: `riskSignals` ডিপোজিটের জন্য লেখা, তাই এর সব
         *   সংকেত এখানে প্রযোজ্য নয়। যেগুলো প্রযোজ্য সেগুলোই আসল —
         *   "নাম্বার নিবন্ধিত ফোনের সাথে মেলে না" ও "অ্যাকাউন্ট
         *   একদম নতুন" প্রত্যাহারেও ঠিক ততটাই সন্দেহজনক।
         *   `id` এখনো নেই (সারি পরে তৈরি হয়), তাই একটি স্থানধারক।
         */
        const a = await assessOneDeposit(
          {
            id: 'withdraw-preview',
            userId: user.id,
            amount: parsed.data.amount,
            senderNo: parsed.data.accountNumber,
            createdAt: new Date(),
          },
          { phone: me.phone, createdAt: me.createdAt },
        );
        elevated = toDbRisk(a.level) === 'ELEVATED';
        riskNote = elevated ? summarizeSignals(a) : null;
      }
    } catch (e) {
      // ⚠️ হিসাব ব্যর্থ হলে অনুরোধ আটকাই না, কিন্তু নীরবও থাকি না
      logger.error('withdraw', 'risk assessment failed', { err: e });
    }

    // ★★★ কোড যাচাই — সফল হলেই কেবল এগোয়
    const r = await consumeOtp(
      { purpose: 'WITHDRAW', destination: user.email, code: parsed.data.code },
      async () => true,
    );
    if (!r.ok) throw new ApiError(otpMessage(r.reason), 400);

    const w = await requestWithdrawal({
      userId: user.id,
      amount: parsed.data.amount,
      method: parsed.data.method,
      accountNumber: parsed.data.accountNumber,
      elevatedRisk: elevated,
      riskNote,
    });

    return Response.json({ success: true, withdrawal: w });
  } catch (e) {
    return apiError(e);
  }
}
