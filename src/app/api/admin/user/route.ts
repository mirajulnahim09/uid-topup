import { prisma } from '@/lib/prisma';
import { adminAdjustSchema } from '@/lib/validation';
import { requireAdmin, apiError, ApiError, readJson } from '@/lib/guard';
import { cleanText } from '@/lib/sanitize';
import { notify } from '@/lib/notify';
import { adminLog } from '@/lib/adminLog';
import { telegramEvent } from '@/lib/telegram';
import { creditWallet, debitWallet } from '@/lib/services/wallet';
import { getIp } from '@/lib/rateLimit';
import { round2 } from '@/lib/money';

/** ব্যালেন্স সমন্বয় — ledger এ রেকর্ড থাকবে */
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();

    const parsed = adminAdjustSchema.safeParse(await readJson(req));
    if (!parsed.success) throw new ApiError(parsed.error.errors[0].message, 400);

    const { userId, amount, requestId } = parsed.data;
    const note = cleanText(parsed.data.note, 300);

    /**
     * ★★★ idempotency — একই "সমন্বয় করুন" দুবার পৌঁছালে টাকা একবারই।
     *
     *   ⚠️ মাপা (সিমুলেশন, ২০২৬-০৯-২৫): একই অনুরোধ একসাথে N বার পাঠালে
     *   N বার ক্রেডিট হতো — ২ ক্লিকে ৳১০০-এর বদলে ৳২০০, ১০০টিতে ৳১০,০০০।
     *   ডাবল-ক্লিক বা নেট কেটে গিয়ে অ্যাডমিনের "আবার চাপা" — দুটোতেই টাকা
     *   তৈরি হতো। খতিয়ান ঠিকই লিখত, কিন্তু মানুষের উদ্দেশ্য ছিল একটি।
     *
     *   UI প্রতিবার ডায়ালগ খুললে একটি `requestId` বানায়; সেটি এই সমন্বয়ের
     *   খতিয়ান-সারির `refId` হয় — `adj:<adminId>:<requestId>`। অ্যাডমিনের id
     *   **খতিয়ানেই** থাকে (মালিকের রিভিউ: আগের `adj:<id>` সংস্করণে "কে করল" কেবল
     *   best-effort অডিট-লগে থাকত)। User রো `FOR UPDATE` লক করার **পরে** খোঁজা
     *   হয় — একই ইউজারের সব সমন্বয় ওই লকে ক্রমিক, তাই দ্বিতীয় অনুরোধ প্রথমটির
     *   সারি দেখতে পায়। নতুন টেবিল/কলাম লাগেনি।
     *   ⚠️ একই চাবি **ভিন্ন অঙ্কে** এলে 409 — নীরবে "হয়ে গেছে" বলা ভুল হতো।
     *   ⚠️ `requestId` না পাঠালে আচরণ আগের মতোই (refId = অ্যাডমিন id)।
     */
    const refKey = requestId ? `adj:${admin.id}:${requestId}` : null;

    const result = await prisma.$transaction(async (tx) => {
      // ★ Row lock
      const locked = await tx.$queryRaw<Array<{ id: string; balance: string }>>`
        SELECT id, balance FROM "User" WHERE id = ${userId} FOR UPDATE`;

      const row = locked[0];
      if (!row) throw new ApiError('ইউজার পাওয়া যায়নি', 404);

      const current = Number(row.balance);

      if (refKey) {
        const prior = await tx.ledgerEntry.findFirst({
          where: { userId, type: 'ADMIN_ADJUST', refId: refKey },
          select: { amount: true },
        });
        if (prior) {
          // ★ খতিয়ানে ডেবিট ঋণাত্মক — তাই অনুরোধের চিহ্নসহ অঙ্কের সাথেই তুলনা
          if (round2(Number(prior.amount)) !== round2(amount)) {
            throw new ApiError(
              'এই অনুরোধ-আইডি আগে অন্য অঙ্কে ব্যবহার হয়েছে — কিছুই বদলানো হয়নি। ডায়ালগ বন্ধ করে নতুন করে দিন।',
              409,
              'REQUEST_ID_REUSED',
            );
          }
          // ★ আগেই হয়ে গেছে — কিছুই নড়ে না, বর্তমান ব্যালেন্সই ফেরত
          return { balance: current, duplicate: true };
        }
      }

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
              refId: refKey ?? admin.id, note: `অ্যাডমিন সমন্বয়: ${note}`,
            })
          : await debitWallet({
              tx, userId, amount: Math.abs(amount), type: 'ADMIN_ADJUST',
              refId: refKey ?? admin.id, note: `অ্যাডমিন সমন্বয়: ${note}`,
            });

      return { balance: Number(balance), duplicate: false };
    });

    // ★ পুনরাবৃত্তি — অডিট/বিজ্ঞপ্তি/টেলিগ্রাম আবার নয়; স্পষ্ট করে জানানো
    if (result.duplicate) {
      return Response.json({ success: true, duplicate: true, balance: result.balance.toFixed(2) });
    }

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

    // ★ guarded (defense-in-depth): notify নিজে throw করে না (ভেতরে
    //   try/catch), তবু .catch() রাখা — refactor-এ throw এলেও order/money
    //   commit-পরবর্তী ব্যর্থতা যেন ইউজারকে ভুল "ব্যর্থ" না দেখায়।
    notify(
      userId,
      amount > 0 ? `৳${amount.toFixed(2)} যোগ হয়েছে` : `৳${Math.abs(amount).toFixed(2)} কাটা হয়েছে`,
      note,
      '/account'
    ).catch(() => {});

    // ★ অপারেটর-ফিড — ম্যানুয়াল ব্যালেন্স বদল সবচেয়ে সংবেদনশীল কাজ,
    //   তাই দলের সবাই সাথে সাথে দেখতে পায় (ইন-অ্যাপ নয়: অ্যাডমিন নিজেই করেছে)
    telegramEvent(
      'wallet_credit',
      amount >= 0 ? '💵 ব্যালেন্স যোগ' : '💵 ব্যালেন্স কর্তন',
      `৳${Math.abs(amount).toFixed(2)} — ${admin.name} — ${note}`,
      '/admin/users',
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
    const { userId, isBanned, status } = await readJson(req);

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
