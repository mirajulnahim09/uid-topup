import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { prisma } from '../prisma';
import { ApiError } from '../guard';
import { revokeUserApiKeys } from '../apiKey';

/**
 * Account deletion.
 *
 * Customers *request* deletion (required for the Play Store listing); an
 * admin completes it by anonymising the account. Orders, deposits, ledger
 * entries and withdrawals are financial records and are never deleted —
 * they stay attached to an anonymous user row so the books still balance.
 *
 * Anonymisation is refused while money is still in play: a non-zero
 * wallet balance, or any open order / deposit / withdrawal. The admin
 * settles those first (refund, withdrawal) through the normal flows.
 */

export const DELETION_CONFIRM_WORD = 'DELETE';

export async function requestAccountDeletion(userId: string, reason: string | null): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { deletionRequestedAt: new Date(), deletionReason: reason },
  });
}

export async function cancelAccountDeletion(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { deletionRequestedAt: null, deletionReason: null },
  });
}

export type AnonymiseBlocker = { balance: number; openOrders: number; openDeposits: number; openWithdrawals: number };

/** What still stops this account from being anonymised (all zero = ready). */
export async function deletionBlockers(userId: string): Promise<AnonymiseBlocker> {
  const [user, openOrders, openDeposits, openWithdrawals] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { balance: true } }),
    prisma.order.count({ where: { userId, status: { in: ['AWAITING_PAYMENT', 'PENDING', 'PROCESSING'] } } }),
    prisma.deposit.count({ where: { userId, status: 'PENDING' } }),
    prisma.withdrawal.count({ where: { userId, status: { in: ['PENDING', 'HELD'] } } }),
  ]);
  return { balance: Number(user?.balance ?? 0), openOrders, openDeposits, openWithdrawals };
}

/**
 * Scrub personal data and lock the account. The user row is locked first
 * and every blocker is re-checked from inside the same transaction, so a
 * deposit approved a moment earlier can't slip past the check.
 */
export async function anonymiseAccount(userId: string): Promise<void> {
  const lockedPassword = await bcrypt.hash(randomBytes(32).toString('hex'), 12);

  await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string; role: string; balance: string }>>`
      SELECT id, role, balance::text AS balance FROM "User" WHERE id = ${userId} FOR UPDATE`;
    const u = rows[0];
    if (!u) throw new ApiError('ইউজার পাওয়া যায়নি', 404);
    if (u.role === 'ADMIN') throw new ApiError('অ্যাডমিন অ্যাকাউন্ট এভাবে মোছা যায় না', 400);
    if (Number(u.balance) !== 0) {
      throw new ApiError(`ওয়ালেটে ৳${Number(u.balance).toFixed(2)} আছে — আগে টাকা ফেরত/উইথড্র সম্পন্ন করুন`, 409);
    }

    const [orders, deposits, withdrawals] = await Promise.all([
      tx.order.count({ where: { userId, status: { in: ['AWAITING_PAYMENT', 'PENDING', 'PROCESSING'] } } }),
      tx.deposit.count({ where: { userId, status: 'PENDING' } }),
      tx.withdrawal.count({ where: { userId, status: { in: ['PENDING', 'HELD'] } } }),
    ]);
    if (orders + deposits + withdrawals > 0) {
      throw new ApiError('চলমান অর্ডার/ডিপোজিট/উইথড্র আছে — আগে সেগুলো শেষ করুন', 409);
    }

    const tag = userId.slice(-10);
    await tx.user.update({
      where: { id: userId },
      data: {
        name: 'মুছে ফেলা অ্যাকাউন্ট',
        email: `deleted-${userId}@deleted.invalid`,
        phone: `deleted-${tag}-${randomBytes(3).toString('hex')}`,
        password: lockedPassword,
        isBanned: true,
        status: 'BLOCKED',
        emailVerified: false,
        phoneVerified: false,
        twoFactorEnabled: false,
        twoFactorSecret: null,
        twoFactorRecovery: null,
        sessionEpoch: { increment: 1 },
        deletionReason: null,
      },
    });
    await revokeUserApiKeys(tx, userId);
    // Personal content that isn't a financial record.
    await tx.notification.deleteMany({ where: { userId } });
  });
}
