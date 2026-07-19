import { prisma } from '@/lib/prisma';
import { adminAdjustSchema } from '@/lib/validation';
import { requireAdmin, apiError, ApiError } from '@/lib/guard';
import { cleanText } from '@/lib/sanitize';
import { notify } from '@/lib/notify';
import { adminLog } from '@/lib/adminLog';
import { creditWallet, debitWallet } from '@/lib/services/wallet';
import { getIp } from '@/lib/rateLimit';

/** ব্যালেন্স সমন্বয় — ledger এ রেকর্ড থাকবে */
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();

    const parsed = adminAdjustSchema.safeParse(await req.json());
    if (!parsed.success) throw new ApiError(parsed.error.errors[0].message, 400);

    const { userId, amount } = parsed.data;
    const note = cleanText(parsed.data.note, 300);

    const result = await prisma.$transaction(async (tx) => {
      // ★ Row lock
      const locked = await tx.$queryRaw<Array<{ id: string; balance: string }>>`
        SELECT id, balance FROM "User" WHERE id = ${userId} FOR UPDATE`;

      const row = locked[0];
      if (!row) throw new ApiError('ইউজার পাওয়া যায়নি', 404);

      const current = Number(row.balance);

      // ★ ব্যালেন্স কখনো negative হবে না
      if (current + amount < 0) {
        throw new ApiError(
          `ব্যালেন্স negative হয়ে যাবে (বর্তমান ৳${current.toFixed(2)})`,
          400
        );
      }

      // ★ সমন্বয় দুদিকেই হতে পারে — তাই চিহ্ন দেখে দিক বাছা (4.1)
      const balance =
        amount >= 0
          ? await creditWallet({
              tx, userId, amount, type: 'ADMIN_ADJUST',
              refId: admin.id, note: `অ্যাডমিন সমন্বয়: ${note}`,
            })
          : await debitWallet({
              tx, userId, amount: Math.abs(amount), type: 'ADMIN_ADJUST',
              refId: admin.id, note: `অ্যাডমিন সমন্বয়: ${note}`,
            });

      return { balance: Number(balance) };
    });

    // ★ অডিট লগ — ম্যানুয়াল ব্যালেন্স সমন্বয় সবচেয়ে সংবেদনশীল
    adminLog({
      adminId: admin.id,
      adminName: admin.name,
      action: 'BALANCE_ADJUST',
      targetId: userId,
      amount,
      detail: note,
      ip: getIp(req),
    }).catch(() => {});

    await notify(
      userId,
      amount > 0 ? `৳${amount.toFixed(2)} যোগ হয়েছে` : `৳${Math.abs(amount).toFixed(2)} কাটা হয়েছে`,
      note,
      '/account'
    );

    return Response.json({ success: true, balance: result.balance.toFixed(2) });
  } catch (e) {
    return apiError(e);
  }
}

/** স্ট্যাটাস: ACTIVE / SUSPENDED / BLOCKED (backward compat: isBanned ও চলে) */
export async function PATCH(req: Request) {
  try {
    const admin = await requireAdmin();
    const { userId, isBanned, status } = await req.json();

    if (!userId) throw new ApiError('userId প্রয়োজন', 400);

    // ★ status নির্ধারণ (নতুন), না দিলে পুরনো isBanned থেকে
    const VALID = ['ACTIVE', 'SUSPENDED', 'BLOCKED'];
    let newStatus: string;
    let newBanned: boolean;
    if (status && VALID.includes(status)) {
      newStatus = status;
      newBanned = status !== 'ACTIVE'; // SUSPENDED/BLOCKED → লগইন বন্ধ
    } else {
      newBanned = Boolean(isBanned);
      newStatus = newBanned ? 'BLOCKED' : 'ACTIVE';
    }

    // ★ নিজেকে ব্লক করা যাবে না — নাহলে অ্যাডমিন lockout
    if (userId === admin.id && newBanned) throw new ApiError('নিজেকে ব্লক করা যাবে না', 400);

    const target = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!target) throw new ApiError('ইউজার পাওয়া যায়নি', 404);

    // ★ অন্য অ্যাডমিনকে ব্লক করা যাবে না
    if (target.role === 'ADMIN' && newBanned) throw new ApiError('অ্যাডমিনকে ব্লক করা যাবে না', 400);

    await prisma.user.update({
      where: { id: userId },
      data: { isBanned: newBanned, status: newStatus as 'ACTIVE' | 'SUSPENDED' | 'BLOCKED' },
    });

    adminLog({
      adminId: admin.id,
      adminName: admin.name,
      action: newBanned ? 'USER_BAN' : 'USER_UNBAN',
      targetId: userId,
      detail: `স্ট্যাটাস: ${newStatus}`,
      ip: getIp(req),
    }).catch(() => {});

    return Response.json({ success: true, status: newStatus });
  } catch (e) {
    return apiError(e);
  }
}
