import { prisma } from '@/lib/prisma';
import { depositSchema } from '@/lib/validation';
import { requireUser, apiError, ApiError } from '@/lib/guard';
import { rateLimit, LIMITS } from '@/lib/rateLimit';
import { getSettings } from '@/lib/settings';
import { notify, notifyAdmins } from '@/lib/notify';

export async function POST(req: Request) {
  try {
    const user = await requireUser();

    const rl = rateLimit(`dep:${user.id}`, LIMITS.deposit.limit, LIMITS.deposit.window);
    if (!rl.ok) {
      throw new ApiError(`অনেক বেশি রিকোয়েস্ট। ${rl.retryAfter} সেকেন্ড পর চেষ্টা করুন।`, 429);
    }

    const parsed = depositSchema.safeParse(await req.json());
    if (!parsed.success) throw new ApiError(parsed.error.errors[0].message, 400);

    const { method, amount, trxId, senderNo, screenshot } = parsed.data;

    const s = await getSettings();
    const min = Number(s.min_deposit || 20);
    const max = Number(s.max_deposit || 25000);

    if (amount < min) throw new ApiError(`সর্বনিম্ন ডিপোজিট ৳${min}`, 400);
    if (amount > max) throw new ApiError(`সর্বোচ্চ ডিপোজিট ৳${max}`, 400);

    // ★ একই TrxID দিয়ে বারবার claim আটকানো
    const dupe = await prisma.deposit.findUnique({
      where: { trxId },
      select: { id: true },
    });
    if (dupe) throw new ApiError('এই ট্রানজেকশন আইডি আগে ব্যবহার করা হয়েছে', 409);

    // ★ Spam guard
    const pending = await prisma.deposit.count({
      where: { userId: user.id, status: 'PENDING' },
    });
    if (pending >= 5) {
      throw new ApiError('আপনার ৫টি রিকোয়েস্ট পেন্ডিং আছে। অনুমোদনের অপেক্ষা করুন।', 429);
    }

    let deposit;
    try {
      deposit = await prisma.deposit.create({
        data: {
          userId: user.id,
          method,
          amount,
          trxId,
          senderNo,
          screenshot: screenshot || null,
          status: 'PENDING',
        },
      });
    } catch (e: unknown) {
      // ★ Race — দুইজন একসাথে একই TrxID পাঠালে unique constraint ধরবে
      if ((e as { code?: string })?.code === 'P2002') {
        throw new ApiError('এই ট্রানজেকশন আইডি আগে ব্যবহার করা হয়েছে', 409);
      }
      throw e;
    }

    await notify(
      user.id,
      `ডিপোজিট রিকোয়েস্ট #${deposit.depositNo} জমা হয়েছে`,
      `৳${amount.toFixed(2)} — যাচাইয়ের পর ব্যালেন্স যোগ হবে।`,
      '/account/wallet/deposit'
    );

    notifyAdmins('নতুন রিচার্জ রিকোয়েস্ট', `${user.name} — ৳${amount.toFixed(2)} (#${deposit.depositNo})`, '/admin/deposits').catch(() => {});

    return Response.json({
      success: true,
      depositNo: deposit.depositNo,
      message: `রিকোয়েস্ট #${deposit.depositNo} জমা হয়েছে। যাচাইয়ের পর ব্যালেন্স যোগ হবে।`,
    });
  } catch (e) {
    return apiError(e);
  }
}
