import { prisma } from '@/lib/prisma';
import { requireAdmin, apiError, ApiError, readJson } from '@/lib/guard';
import { adminLog } from '@/lib/adminLog';
import { getIp } from '@/lib/rateLimit';
import { anonymiseAccount } from '@/lib/services/accountDeletion';

export const dynamic = 'force-dynamic';

/** Admin completes an account deletion: personal data scrubbed, money records kept. */
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();
    const { userId } = await readJson<{ userId?: unknown }>(req);
    const id = String(userId ?? '');
    if (!id) throw new ApiError('ইউজার বেছে নিন', 400);
    if (id === admin.id) throw new ApiError('নিজের অ্যাকাউন্ট এভাবে মোছা যায় না', 400);

    const before = await prisma.user.findUnique({ where: { id }, select: { name: true, email: true } });
    if (!before) throw new ApiError('ইউজার পাওয়া যায়নি', 404);

    await anonymiseAccount(id);

    adminLog({
      adminId: admin.id, adminName: admin.name, action: 'ACCOUNT_ANONYMIZE', targetId: id,
      detail: `${before.name} এর অ্যাকাউন্টের ব্যক্তিগত তথ্য মুছে ফেলা হয়েছে (আর্থিক রেকর্ড অক্ষত)`,
      ip: getIp(req),
    }).catch(() => {});
    return Response.json({ success: true });
  } catch (e) {
    return apiError(e);
  }
}
