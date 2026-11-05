import type { OrderStatus, Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { logger } from '../logger';
import { applyOrderStatus } from '../fulfilment';
import { recordOrderEvent } from '../orderEvents';
import { notify, notifyAdmins } from '../notify';

/**
 * Voucher-code delivery ("My Codes").
 *
 * For products with `deliveryType = 'CODE'` (gift cards, subscriptions,
 * UniPin vouchers) delivery means handing the customer one stocked code.
 *
 * Money is never touched here. The order's price was already debited when
 * the order was placed (services/order.ts) or confirmed by an approved
 * deposit (direct pay). This module only moves a PENDING order to
 * COMPLETED through the same `applyOrderStatus()` an admin uses, and binds
 * exactly one code to it.
 *
 * Concurrency:
 *  - the order row is locked first (FOR UPDATE) and must be PENDING and
 *    unclaimed, so a code is never assigned to an order an admin is
 *    handling or has already closed;
 *  - the code row is picked with FOR UPDATE SKIP LOCKED, so two orders
 *    racing for the last code each get a different code or none;
 *  - `VoucherCode.orderId` is UNIQUE and a CHECK ties ASSIGNED <-> orderId,
 *    so the database itself refuses a double assignment.
 *
 * If no code is in stock the order simply stays PENDING in the manual
 * queue and admins are alerted; once codes are uploaded the admin can
 * deliver from the Codes page (`deliverPendingCodeOrders`).
 */

export const CODE_ACTOR = { id: 'system:voucher-code', name: 'কোড-ডেলিভারি' };

export type CodeDeliveryResult =
  | { status: 'DELIVERED'; code: string }
  | { status: 'SKIPPED'; reason: 'NOT_CODE_PRODUCT' | 'NOT_PENDING' | 'NOT_FOUND' }
  | { status: 'OUT_OF_STOCK' }
  | { status: 'ERROR' };

type LockedOrder = {
  id: string;
  status: OrderStatus;
  claimedById: string | null;
  variantId: number;
  userId: string;
  orderNo: number;
  productName: string;
  variantName: string;
};

async function assignInTx(
  tx: Prisma.TransactionClient,
  orderId: string,
  actor: { id: string; name: string },
): Promise<CodeDeliveryResult & { order?: LockedOrder }> {
  const rows = await tx.$queryRaw<LockedOrder[]>`
    SELECT o.id, o.status, o."claimedById", o."variantId", o."userId", o."orderNo",
           o."productName", o."variantName"
      FROM "Order" o WHERE o.id = ${orderId} FOR UPDATE`;
  const order = rows[0];
  if (!order) return { status: 'SKIPPED', reason: 'NOT_FOUND' };

  const product = await tx.variant.findUnique({
    where: { id: order.variantId },
    select: { product: { select: { deliveryType: true } } },
  });
  if (product?.product.deliveryType !== 'CODE') return { status: 'SKIPPED', reason: 'NOT_CODE_PRODUCT' };

  // An admin-claimed order is theirs; the system only takes free PENDING ones.
  const claimedByOther = order.claimedById && order.claimedById !== actor.id;
  if (order.status !== 'PENDING' || claimedByOther) return { status: 'SKIPPED', reason: 'NOT_PENDING' };

  const codes = await tx.$queryRaw<Array<{ id: string; code: string }>>`
    SELECT id, code FROM "VoucherCode"
     WHERE "variantId" = ${order.variantId} AND status = 'AVAILABLE'
     ORDER BY "createdAt" ASC
     LIMIT 1
     FOR UPDATE SKIP LOCKED`;
  const picked = codes[0];
  if (!picked) return { status: 'OUT_OF_STOCK', order };

  await tx.voucherCode.update({
    where: { id: picked.id },
    data: { status: 'ASSIGNED', orderId, assignedAt: new Date() },
  });

  await applyOrderStatus(tx, {
    orderId,
    action: 'COMPLETE',
    admin: actor,
    adminNote: 'আপনার কোড প্রস্তুত — "আমার কোড" পাতায় দেখুন',
    internalNote: `voucher code delivered (${picked.id})`,
  });

  return { status: 'DELIVERED', code: picked.code, order };
}

/**
 * Try to deliver a code for one order. Never throws: on any failure the
 * order stays where it was (PENDING) and the manual queue handles it.
 */
export async function deliverVoucherCode(
  orderId: string,
  actor: { id: string; name: string } = CODE_ACTOR,
): Promise<CodeDeliveryResult> {
  let res: CodeDeliveryResult & { order?: LockedOrder };
  try {
    res = await prisma.$transaction((tx) => assignInTx(tx, orderId, actor), { timeout: 10_000 });
  } catch (e) {
    logger.error('voucher', 'code delivery failed', { orderId, err: e });
    return { status: 'ERROR' };
  }

  // post-commit side effects, all best-effort
  if (res.status === 'DELIVERED' && res.order) {
    const o = res.order;
    notify(
      o.userId,
      'আপনার কোড এসে গেছে 🎉',
      `অর্ডার #${o.orderNo} — ${o.productName} (${o.variantName})। কোডটি "আমার কোড" পাতায় আছে।`,
      '/account/codes',
    ).catch(() => {});
    return { status: 'DELIVERED', code: res.code };
  }
  if (res.status === 'OUT_OF_STOCK' && res.order) {
    const o = res.order;
    await prisma.$transaction(async (tx) => {
      await recordOrderEvent(tx, {
        orderId,
        status: 'PENDING',
        note: 'কোড স্টকে নেই — অ্যাডমিন কোড যোগ করলেই ডেলিভারি হবে',
        actorType: 'SYSTEM',
      });
    }).catch(() => {});
    notifyAdmins(
      '⚠️ কোড স্টক শেষ',
      `অর্ডার #${o.orderNo} — ${o.productName} (${o.variantName}) এর জন্য কোনো কোড নেই। Admin → কোড স্টক থেকে কোড যোগ করুন।`,
      '/admin/codes',
    ).catch(() => {});
    return { status: 'OUT_OF_STOCK' };
  }
  return res.status === 'SKIPPED' ? { status: 'SKIPPED', reason: res.reason } : { status: res.status } as CodeDeliveryResult;
}

/**
 * Deliver codes to orders that were waiting for stock (oldest first).
 * Used by the admin Codes page after uploading new codes.
 */
export async function deliverPendingCodeOrders(
  variantId: number,
  actor: { id: string; name: string },
  limit = 50,
): Promise<{ delivered: number; remaining: number }> {
  const waiting = await prisma.order.findMany({
    where: { variantId, status: 'PENDING', claimedById: null, variant: { product: { deliveryType: 'CODE' } } },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
    take: limit,
  });
  let delivered = 0;
  for (const w of waiting) {
    const r = await deliverVoucherCode(w.id, actor);
    if (r.status === 'DELIVERED') delivered++;
    if (r.status === 'OUT_OF_STOCK') break;
  }
  return { delivered, remaining: waiting.length - delivered };
}

/** Normalise a pasted block of codes: one per line, trimmed, de-duplicated. */
export function parseCodeBlock(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const c = line.trim();
    if (!c || c.length > 500 || seen.has(c)) continue;
    seen.add(c);
    out.push(c);
  }
  return out;
}

/** Mask a code for lists: keep the last 4 characters. */
export function maskCode(code: string): string {
  if (code.length <= 4) return '••••';
  return '•'.repeat(Math.min(8, code.length - 4)) + code.slice(-4);
}
