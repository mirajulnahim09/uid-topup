import { prisma } from '@/lib/prisma';
import { depositSchema } from '@/lib/validation';
import { requireUser, apiError, ApiError, readJson } from '@/lib/guard';
import { rateLimit, LIMITS } from '@/lib/rateLimit';
import { getSettings } from '@/lib/settings';
import { notify, notifyAdmins } from '@/lib/notify';
import { getFulfillmentConfig, decideDepositApproval } from '@/lib/fulfillment/policy';
import { getProvider } from '@/lib/payments/registry';
import { logActivity, requestMeta } from '@/lib/adminLog';

export async function POST(req: Request) {
  try {
    const user = await requireUser();

    const rl = await rateLimit(`dep:${user.id}`, LIMITS.deposit.limit, LIMITS.deposit.window);
    if (!rl.ok) {
      throw new ApiError(`অনেক বেশি রিকোয়েস্ট। ${rl.retryAfter} সেকেন্ড পর চেষ্টা করুন।`, 429);
    }

    const parsed = depositSchema.safeParse(await readJson(req));
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

    // ★★★ Fulfillment policy — ভবিষ্যৎ-প্রস্তুত সংযোগস্থল (future-ready seam)।
    //   ম্যানুয়াল সাব-মেথড (BKASH/NAGAD/…) → 'manual' প্রোভাইডার, যার
    //   autoVerify=false — তাই সিদ্ধান্ত সর্বদা 'manual', এই ব্লক আজ
    //   কিছুই করে না (প্রমাণিত money-model হুবহু অপরিবর্তিত)। ভবিষ্যতে
    //   একটি auto-verify গেটওয়ে configured হলে এখানেই provider.verify()
    //   ডেকে VERIFIED হলে বিদ্যমান approve-logic (creditWallet + ledger)
    //   চালানো হবে — মূল কোড না বদলেই। try/catch: নীতি-স্তর কখনো
    //   money-flow ভাঙবে না।
    try {
      const cfg = await getFulfillmentConfig();
      if (decideDepositApproval(cfg, getProvider('manual')) === 'automatic') {
        // FUTURE: provider.verify(intent) → { VERIFIED } হলে অটো-অনুমোদন।
      }
    } catch { /* policy layer must never break the money flow */ }

    // ★ অডিট: গ্রাহক ডিপোজিট তৈরি করেছে (best-effort)
    {
      const meta = requestMeta(req);
      logActivity({
        actorId: user.id, actorName: user.name, actorType: 'CUSTOMER', role: 'USER',
        action: 'DEPOSIT_CREATE', targetId: deposit.id, amount,
        detail: `${method} · TrxID ${trxId}`, ip: meta.ip, userAgent: meta.userAgent,
      }).catch(() => {});
    }

    // ★ guarded (defense-in-depth) — deposit তৈরি হওয়ার পর notify ব্যর্থ
    //   হলেও ইউজারকে ভুল "ব্যর্থ" দেখানো চলবে না (আবার deposit দিত)।
    notify(
      user.id,
      `ডিপোজিট রিকোয়েস্ট #${deposit.depositNo} জমা হয়েছে`,
      `৳${amount.toFixed(2)} — যাচাইয়ের পর ব্যালেন্স যোগ হবে।`,
      '/account/wallet/deposit'
    ).catch(() => {});

    notifyAdmins('নতুন রিচার্জ রিকোয়েস্ট', `${user.name} — ৳${amount.toFixed(2)} (#${deposit.depositNo})`, '/admin/deposits', 'deposit_new').catch(() => {});

    return Response.json({
      success: true,
      depositNo: deposit.depositNo,
      message: `রিকোয়েস্ট #${deposit.depositNo} জমা হয়েছে। যাচাইয়ের পর ব্যালেন্স যোগ হবে।`,
    });
  } catch (e) {
    return apiError(e);
  }
}
