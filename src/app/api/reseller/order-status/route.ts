import { prisma } from '@/lib/prisma';
import { apiError, ApiError } from '@/lib/guard';
import { requireResellerRead } from '@/lib/reseller/readGuard';

export const dynamic = 'force-dynamic';

/**
 * GET /api/reseller/order-status?clientRef=… | ?orderNo=… | ?orderIds=a,b
 *
 * Status of the key owner's OWN orders (never anyone else's). Voucher
 * codes are returned only for COMPLETED code orders, to the owner.
 */
export async function GET(req: Request) {
  try {
    const actor = await requireResellerRead(req);
    const url = new URL(req.url);
    const clientRef = url.searchParams.get('clientRef')?.trim() || null;
    const orderNo = Number(url.searchParams.get('orderNo') || '');
    const ids = (url.searchParams.get('orderIds') || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 20);

    const or: Array<Record<string, unknown>> = [];
    if (clientRef) or.push({ clientRef });
    if (Number.isInteger(orderNo) && orderNo > 0) or.push({ orderNo });
    if (ids.length) or.push({ id: { in: ids } });
    // Checked on the built filter: a missing orderNo is Number('') = 0, an
    // integer, so the old pre-check never fired and returned an empty 200.
    if (or.length === 0) {
      throw new ApiError('clientRef, orderNo বা orderIds দিন', 400);
    }

    const orders = await prisma.order.findMany({
      where: { userId: actor.user.id, OR: or },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true, orderNo: true, clientRef: true, status: true, productName: true, variantName: true,
        playerUid: true, price: true, refundedAmount: true, adminNote: true, failReason: true,
        createdAt: true, completedAt: true,
        voucherCode: { select: { code: true, status: true } },
      },
    });

    return Response.json({
      success: true,
      orders: orders.map((o) => ({
        orderId: o.id,
        orderNo: o.orderNo,
        clientRef: o.clientRef,
        status: o.status,
        product: o.productName,
        package: o.variantName,
        playerUid: o.playerUid,
        price: Number(o.price).toFixed(2),
        refunded: Number(o.refundedAmount).toFixed(2),
        note: o.adminNote,
        failReason: o.failReason,
        createdAt: o.createdAt.toISOString(),
        completedAt: o.completedAt?.toISOString() ?? null,
        code: o.status === 'COMPLETED' && o.voucherCode?.status === 'ASSIGNED' ? o.voucherCode.code : null,
      })),
    });
  } catch (e) {
    return apiError(e);
  }
}
