import { prisma } from '@/lib/prisma';
import { requireAdmin, apiError, ApiError } from '@/lib/guard';
import { cleanText } from '@/lib/sanitize';
import { adminLog } from '@/lib/adminLog';
import { getIp } from '@/lib/rateLimit';
import { revalidatePath } from 'next/cache';

export async function POST(req: Request) {
  try {
    await requireAdmin();
    const { productId, label, price, costPrice, stock } = await req.json();

    if (!productId) throw new ApiError('productId প্রয়োজন', 400);

    const lbl = cleanText(String(label || ''), 60);
    if (lbl.length < 1) throw new ApiError('প্যাকেজের নাম দিন', 400);

    const p = Number(price);
    if (isNaN(p) || p <= 0) throw new ApiError('সঠিক বিক্রয় মূল্য দিন', 400);

    const cp = Number(costPrice || 0);
    if (isNaN(cp) || cp < 0) throw new ApiError('সঠিক ক্রয় মূল্য দিন', 400);

    const st = Number(stock ?? -1);
    if (isNaN(st)) throw new ApiError('সঠিক স্টক দিন', 400);

    const count = await prisma.variant.count({ where: { productId: Number(productId) } });

    const v = await prisma.variant.create({
      data: {
        productId: Number(productId),
        label: lbl,
        price: p,
        costPrice: cp,
        stock: st,
        sortOrder: count,
      },
    });

    revalidatePath('/', 'layout');
    return Response.json({ success: true, id: v.id });
  } catch (e) {
    return apiError(e);
  }
}

export async function PATCH(req: Request) {
  try {
    const admin = await requireAdmin();
    const body = await req.json();
    const { id } = body;
    if (!id) throw new ApiError('id প্রয়োজন', 400);

    const data: Record<string, unknown> = {};

    if (body.label !== undefined) {
      const lbl = cleanText(String(body.label), 60);
      if (lbl.length < 1) throw new ApiError('প্যাকেজের নাম দিন', 400);
      data.label = lbl;
    }

    if (body.price !== undefined) {
      const p = Number(body.price);
      if (isNaN(p) || p < 0) throw new ApiError('সঠিক বিক্রয় মূল্য দিন', 400);
      data.price = p;
    }

    if (body.costPrice !== undefined) {
      const cp = Number(body.costPrice);
      if (isNaN(cp) || cp < 0) throw new ApiError('সঠিক ক্রয় মূল্য দিন', 400);
      data.costPrice = cp;
    }

    if (body.oldPrice !== undefined) {
      if (body.oldPrice === null || body.oldPrice === '') {
        data.oldPrice = null;
      } else {
        const op = Number(body.oldPrice);
        if (isNaN(op) || op < 0) throw new ApiError('সঠিক কাটা দাম দিন', 400);
        data.oldPrice = op;
      }
    }

    if (body.stock !== undefined) {
      const st = Number(body.stock);
      if (isNaN(st)) throw new ApiError('সঠিক স্টক দিন', 400);
      data.stock = st;
    }

    if (body.isActive !== undefined) data.isActive = Boolean(body.isActive);
    if (body.isPopular !== undefined) data.isPopular = Boolean(body.isPopular);

    await prisma.variant.update({ where: { id: Number(id) }, data });
    // ★ পাবলিক পেজের ক্যাশ সাথে সাথে মুছে দাও — দাম/ছবি তখনই দেখাবে
    revalidatePath('/', 'layout');

    return Response.json({ success: true });
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(req: Request) {
  try {
    await requireAdmin();
    const { id } = await req.json();
    if (!id) throw new ApiError('id প্রয়োজন', 400);

    // ★ অর্ডার থাকলে ডিলিট করা যাবে না
    const orders = await prisma.order.count({ where: { variantId: Number(id) } });
    if (orders > 0) {
      throw new ApiError(
        `এই প্যাকেজে ${orders} টি অর্ডার আছে — ডিলিট করা যাবে না। বন্ধ করে দিন।`,
        400
      );
    }

    await prisma.variant.delete({ where: { id: Number(id) } });
    // ★ পাবলিক পেজের ক্যাশ সাথে সাথে মুছে দাও — দাম/ছবি তখনই দেখাবে
    revalidatePath('/', 'layout');

    return Response.json({ success: true });
  } catch (e) {
    return apiError(e);
  }
}
