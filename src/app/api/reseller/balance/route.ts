import { prisma } from '@/lib/prisma';
import { apiError } from '@/lib/guard';
import { requireResellerRead } from '@/lib/reseller/readGuard';

export const dynamic = 'force-dynamic';

/** GET /api/reseller/balance — the key owner's wallet balance (read-only). */
export async function GET(req: Request) {
  try {
    const actor = await requireResellerRead(req);
    const u = await prisma.user.findUnique({ where: { id: actor.user.id }, select: { balance: true } });
    return Response.json({
      success: true,
      balance: Number(u?.balance ?? 0).toFixed(2),
      currency: 'BDT',
      tier: actor.user.tier,
    });
  } catch (e) {
    return apiError(e);
  }
}
