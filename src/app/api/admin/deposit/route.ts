import { prisma } from '@/lib/prisma';
import { adminDepositActionSchema } from '@/lib/validation';
import { requireAdmin, apiError, ApiError } from '@/lib/guard';
import { payReferralBonus, notifyReferralBonus } from '@/lib/referral';
import { emailDepositApproved, emailDepositRejected } from '@/lib/email';
import { notify } from '@/lib/notify';
import { cleanText } from '@/lib/sanitize';
import { adminLog } from '@/lib/adminLog';
import { getIp } from '@/lib/rateLimit';

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();

    const parsed = adminDepositActionSchema.safeParse(await req.json());
    if (!parsed.success) throw new ApiError(parsed.error.errors[0].message, 400);

    const { depositId, action } = parsed.data;
    const adminNote = parsed.data.adminNote ? cleanText(parsed.data.adminNote, 300) : undefined;

    const out = await prisma.$transaction(
      async (tx) => {
        // ★★★ ROW LOCK — সবচেয়ে বড় টাকার ঝুঁকি এখানে।
        //     লক ছাড়া: ৫ জন অ্যাডমিন একসাথে approve চাপলে ৫টা transaction
        //     একসাথে status='PENDING' দেখত, সবাই পাস করত → টাকা ৫ গুণ ঢুকত।
        //     FOR UPDATE দিলে একজনের পর আরেকজন — দ্বিতীয়জন 'APPROVED' দেখবে।
        const locked = await tx.$queryRaw<
          Array<{ id: string; status: string }>
        >`SELECT id, status FROM "Deposit" WHERE id = ${depositId} FOR UPDATE`;

        if (!locked[0]) throw new ApiError('ডিপোজিট পাওয়া যায়নি', 404);

        // ★ লক করা রো থেকে status পড়ি — এটাই আসল, বাসি নয়
        if (locked[0].status !== 'PENDING') {
          throw new ApiError('এই রিকোয়েস্ট আগেই প্রসেস করা হয়েছে', 409);
        }

        const deposit = await tx.deposit.findUnique({
          where: { id: depositId },
          include: { user: { select: { id: true, name: true, email: true } } },
        });
        if (!deposit) throw new ApiError('ডিপোজিট পাওয়া যায়নি', 404);

        const amount = Number(deposit.amount);

        if (action === 'REJECT') {
          const reason = adminNote || 'ট্রানজেকশন যাচাই করা যায়নি';
          await tx.deposit.update({
            where: { id: depositId },
            data: { status: 'REJECTED', adminNote: reason, reviewedAt: new Date() },
          });
          return {
            kind: 'REJECT' as const,
            user: deposit.user,
            amount,
            reason,
            depositNo: deposit.depositNo,
            balance: 0,
            referral: null,
          };
        }

        // ── APPROVE ──
        const updatedUser = await tx.user.update({
          where: { id: deposit.userId },
          data: { balance: { increment: deposit.amount } },
        });

        await tx.deposit.update({
          where: { id: depositId },
          data: { status: 'APPROVED', adminNote, reviewedAt: new Date() },
        });

        await tx.ledgerEntry.create({
          data: {
            userId: deposit.userId,
            type: 'DEPOSIT',
            amount: deposit.amount,
            balanceAfter: updatedUser.balance,
            refId: deposit.id,
            note: `${deposit.method} — TrxID: ${deposit.trxId}`,
          },
        });

        // ★ রেফারেল বোনাস — প্রথম যোগ্য ডিপোজিটে, একবারই
        const referral = await payReferralBonus(tx, deposit.userId, amount);

        return {
          kind: 'APPROVE' as const,
          user: deposit.user,
          amount,
          balance: Number(updatedUser.balance),
          depositNo: deposit.depositNo,
          reason: '',
          referral,
        };
      },
      { timeout: 15000 }
    );

    // ★ অডিট লগ — কে কখন কত টাকা approve করল
    adminLog({
      adminId: admin.id,
      adminName: admin.name,
      action: out.kind === 'APPROVE' ? 'DEPOSIT_APPROVE' : 'DEPOSIT_REJECT',
      targetId: depositId,
      amount: out.amount,
      detail: `#${out.depositNo} — ${out.user.name}` + (out.reason ? ` (${out.reason})` : ''),
      ip: getIp(req),
    }).catch(() => {});

    if (out.kind === 'APPROVE') {
      await notify(
        out.user.id,
        `ডিপোজিট #${out.depositNo} অনুমোদিত ✅`,
        `৳${out.amount.toFixed(2)} যোগ হয়েছে। বর্তমান ব্যালেন্স ৳${out.balance.toFixed(2)}।`,
        '/account'
      );
      emailDepositApproved(
        out.user.email, out.user.name,
        out.amount.toFixed(2), out.balance.toFixed(2)
      ).catch(() => {});

      if (out.referral) {
        notifyReferralBonus(out.referral.referrerId, out.user.name, out.referral.bonus).catch(
          () => {}
        );
      }
    } else {
      await notify(
        out.user.id,
        `ডিপোজিট #${out.depositNo} বাতিল ❌`,
        out.reason,
        '/account/wallet/deposit'
      );
      emailDepositRejected(
        out.user.email, out.user.name, out.amount.toFixed(2), out.reason
      ).catch(() => {});
    }

    return Response.json({ success: true });
  } catch (e) {
    return apiError(e);
  }
}
