import { prisma } from '@/lib/prisma';
import { requireAdmin, apiError, ApiError, readJson } from '@/lib/guard';
import { adminLog } from '@/lib/adminLog';
import { getIp } from '@/lib/rateLimit';
import { notify } from '@/lib/notify';

/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ গ্রাহক-স্তর পরিবর্তন (Group F)
 *
 *   `NORMAL` ⇄ `RESELLER`। এটি একটি **দামের** সিদ্ধান্ত, তাই
 *   ব্যান/আনব্যানের মতো আলাদা endpoint ও আলাদা অডিট-অ্যাকশন —
 *   "কে কাকে কখন রিসেলার বানাল" পরে খুঁজে বের করা যেতেই হবে।
 *
 *   ⚠️ এখানে কোনো টাকা নড়ে না। স্তর কেবল **পরবর্তী** অর্ডারের দাম
 *   নির্ধারণ করে; পুরনো অর্ডার/খতিয়ান সম্পূর্ণ অপরিবর্তিত থাকে
 *   (অর্ডারে দাম snapshot হিসেবে সংরক্ষিত)।
 * ═══════════════════════════════════════════════════════════
 */
const TIERS = ['NORMAL', 'RESELLER'] as const;
type Tier = (typeof TIERS)[number];

export async function PATCH(req: Request) {
  try {
    const admin = await requireAdmin();
    const { userId, tier } = await readJson(req);

    if (!userId || typeof userId !== 'string') throw new ApiError('userId প্রয়োজন', 400);
    if (!TIERS.includes(tier as Tier)) {
      throw new ApiError(`স্তর হতে হবে: ${TIERS.join(' বা ')}`, 400);
    }

    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, tier: true },
    });
    if (!target) throw new ApiError('ইউজার পাওয়া যায়নি', 404);

    // ★ কিছুই বদলায়নি — নীরবে সফল, কিন্তু অডিট লগ দূষিত করি না
    if (target.tier === tier) {
      return Response.json({ success: true, tier: target.tier, unchanged: true });
    }

    await prisma.user.update({
      where: { id: userId },
      data: { tier: tier as Tier },
    });

    adminLog({
      adminId: admin.id,
      adminName: admin.name,
      action: 'USER_TIER_CHANGE',
      targetId: userId,
      detail: `${target.name}: ${target.tier} → ${tier}`,
      ip: getIp(req),
    }).catch(() => {});

    // ★ গ্রাহককে জানাই — দাম বদলে যাচ্ছে, না জানালে বিভ্রান্তি হতো
    notify(
      userId,
      tier === 'RESELLER' ? 'রিসেলার অ্যাকাউন্ট চালু হয়েছে 🎉' : 'অ্যাকাউন্টের স্তর বদলেছে',
      tier === 'RESELLER'
        ? 'এখন থেকে নির্ধারিত প্যাকেজে রিসেলার দাম প্রযোজ্য হবে।'
        : 'আপনার অ্যাকাউন্ট এখন সাধারণ স্তরে আছে।',
      '/account',
    ).catch(() => {});

    return Response.json({ success: true, tier });
  } catch (e) {
    return apiError(e);
  }
}
