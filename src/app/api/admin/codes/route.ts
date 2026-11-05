import { prisma } from '@/lib/prisma';
import { requireAdmin, apiError, ApiError, readJson } from '@/lib/guard';
import { adminLog } from '@/lib/adminLog';
import { getIp } from '@/lib/rateLimit';
import { cleanText } from '@/lib/sanitize';
import { deliverPendingCodeOrders, parseCodeBlock } from '@/lib/services/voucherCodes';

/** Max codes accepted in one upload — keeps one request bounded. */
const MAX_UPLOAD = 2000;

/**
 * Voucher code stock (admin).
 *
 *   POST  { variantId, codes, batch? }        add codes (one per line)
 *   POST  { variantId, action: 'DELIVER' }   deliver to orders waiting for stock
 *   PATCH { id, action: 'VOID' }             void an unused code
 *
 * Codes never move money. Assigned codes can't be voided or edited — they
 * belong to an order the customer has already been shown.
 */
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();
    const body = await readJson<{ variantId?: unknown; codes?: unknown; batch?: unknown; action?: unknown }>(req);
    const variantId = Number(body.variantId);
    if (!Number.isInteger(variantId) || variantId <= 0) throw new ApiError('প্যাকেজ বেছে নিন', 400);

    const variant = await prisma.variant.findUnique({
      where: { id: variantId },
      select: { id: true, label: true, product: { select: { name: true, deliveryType: true } } },
    });
    if (!variant) throw new ApiError('প্যাকেজ পাওয়া যায়নি', 404);
    if (variant.product.deliveryType !== 'CODE') {
      throw new ApiError('এই প্রোডাক্টের ডেলিভারির ধরন "কোড" নয় — আগে প্রোডাক্ট এডিট করে বদলান', 400);
    }

    const actor = { id: admin.id, name: admin.name };

    if (body.action === 'DELIVER') {
      const r = await deliverPendingCodeOrders(variantId, actor);
      adminLog({
        adminId: admin.id, adminName: admin.name, action: 'VOUCHER_CODE_DELIVER',
        targetId: String(variantId),
        detail: `${variant.product.name} — ${variant.label}: ${r.delivered}টি অপেক্ষমাণ অর্ডারে কোড দেওয়া হয়েছে`,
        ip: getIp(req),
      }).catch(() => {});
      return Response.json({ success: true, ...r });
    }

    const codes = parseCodeBlock(String(body.codes ?? ''));
    if (codes.length === 0) throw new ApiError('অন্তত একটি কোড দিন (প্রতি লাইনে একটি)', 400);
    if (codes.length > MAX_UPLOAD) throw new ApiError(`একবারে সর্বোচ্চ ${MAX_UPLOAD}টি কোড`, 400);
    const batch = body.batch ? cleanText(String(body.batch), 60) || null : null;

    const created = await prisma.voucherCode.createMany({
      data: codes.map((code) => ({
        variantId, code, batch, addedById: admin.id, addedByName: admin.name,
      })),
      skipDuplicates: true,
    });

    adminLog({
      adminId: admin.id, adminName: admin.name, action: 'VOUCHER_CODES_ADD',
      targetId: String(variantId),
      detail: `${variant.product.name} — ${variant.label}: ${created.count}টি কোড যোগ` +
        (codes.length > created.count ? ` (${codes.length - created.count}টি ডুপ্লিকেট বাদ)` : ''),
      ip: getIp(req),
    }).catch(() => {});

    // New stock: serve customers who were waiting first.
    const delivered = await deliverPendingCodeOrders(variantId, actor);

    return Response.json({
      success: true,
      added: created.count,
      duplicates: codes.length - created.count,
      delivered: delivered.delivered,
    });
  } catch (e) {
    return apiError(e);
  }
}

export async function PATCH(req: Request) {
  try {
    const admin = await requireAdmin();
    const body = await readJson<{ id?: unknown; action?: unknown }>(req);
    const id = String(body.id ?? '');
    if (!id || body.action !== 'VOID') throw new ApiError('অবৈধ অনুরোধ', 400);

    // Only an AVAILABLE code can be voided; the WHERE makes it atomic.
    const r = await prisma.voucherCode.updateMany({
      where: { id, status: 'AVAILABLE' },
      data: { status: 'VOID' },
    });
    if (r.count === 0) throw new ApiError('কোডটি ইতিমধ্যে ব্যবহৃত বা বাতিল', 409);

    adminLog({
      adminId: admin.id, adminName: admin.name, action: 'VOUCHER_CODE_VOID',
      targetId: id, detail: 'অব্যবহৃত কোড বাতিল', ip: getIp(req),
    }).catch(() => {});
    return Response.json({ success: true });
  } catch (e) {
    return apiError(e);
  }
}
