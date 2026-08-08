import { prisma } from '@/lib/prisma';
import { requireAdmin, apiError, ApiError, readJson } from '@/lib/guard';
import { cleanText } from '@/lib/sanitize';
import { adminLog } from '@/lib/adminLog';
import { getIp } from '@/lib/rateLimit';
import { revalidatePath } from 'next/cache';

/**
 * ★★★ ভ্যারিয়েন্ট = দাম ও স্টক — সরাসরি টাকার ঘটনা (3.3)।
 *   দাম বদলানো মানে ভবিষ্যতের প্রতিটি অর্ডারের অঙ্ক বদলানো।
 *   এই রুটে adminLog **import করা ছিল কিন্তু কখনো ডাকা হয়নি** —
 *   ফলে বাইরে থেকে দেখে মনে হতো লগ হচ্ছে, আসলে হচ্ছিল না।
 */
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();
    const { productId, label, price, costPrice, stock } = await readJson(req);

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

    adminLog({
      adminId: admin.id, adminName: admin.name, action: 'VARIANT_CREATE',
      targetId: String(v.id), amount: p,
      detail: `${lbl} — দাম ৳${p}, স্টক ${st === -1 ? 'আনলিমিটেড' : st}`,
      ip: getIp(req),
    }).catch(() => {});

    revalidatePath('/', 'layout');
    return Response.json({ success: true, id: v.id });
  } catch (e) {
    return apiError(e);
  }
}

export async function PATCH(req: Request) {
  try {
    const admin = await requireAdmin();
    const body = await readJson(req);
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

    // ★★★ Group F — রিসেলার দাম। `oldPrice` এর মতোই null-যোগ্য:
    //   খালি/null পাঠালে ছাড় **তুলে নেওয়া** হয়।
    if (body.resellerPrice !== undefined) {
      if (body.resellerPrice === null || body.resellerPrice === '') {
        data.resellerPrice = null;
      } else {
        const rp = Number(body.resellerPrice);
        // ⚠️ শূন্য ইচ্ছাকৃতভাবে **প্রত্যাখ্যাত**, শুধু ঋণাত্মক নয়।
        //   এই সিস্টেমে ফ্রি অর্ডার সম্ভব নয় (প্রতিটি অর্ডার একটি
        //   ধনাত্মক খতিয়ান-এন্ট্রি লেখে)। ০ বসাতে দিলে অ্যাডমিন ভাবতেন
        //   "রিসেলারদের জন্য ফ্রি করলাম", অথচ অর্ডার-পথ সেটি উপেক্ষা
        //   করে পুরো দাম নিত — নীরব ও ব্যয়বহুল বিভ্রান্তি।
        //   ছাড় তুলতে হলে খালি রাখুন।
        if (isNaN(rp) || rp <= 0) {
          throw new ApiError(
            'রিসেলার দাম ০ এর বেশি হতে হবে। ছাড় তুলে নিতে ঘরটি খালি রাখুন।',
            400,
          );
        }
        data.resellerPrice = rp;
      }
    }

    if (body.stock !== undefined) {
      const st = Number(body.stock);
      if (isNaN(st)) throw new ApiError('সঠিক স্টক দিন', 400);
      data.stock = st;
    }

    if (body.isActive !== undefined) data.isActive = Boolean(body.isActive);
    if (body.isPopular !== undefined) data.isPopular = Boolean(body.isPopular);

    // ★ আগের দাম পড়ে রাখি — "কত থেকে কত" ছাড়া লগের মূল্য কম
    const before = await prisma.variant.findUnique({
      where: { id: Number(id) },
      select: { label: true, price: true, stock: true },
    });

    await prisma.variant.update({ where: { id: Number(id) }, data });

    // ★ দাম বদলালে PRICE_CHANGE — টাকার ঘটনা হিসেবে আলাদা করে চিহ্নিত
    const priceChanged =
      data.price !== undefined && before && Number(data.price) !== Number(before.price);

    const parts: string[] = [];
    if (priceChanged) parts.push(`দাম ৳${Number(before!.price)} → ৳${Number(data.price)}`);
    if (data.stock !== undefined && before && Number(data.stock) !== before.stock) {
      parts.push(`স্টক ${before.stock} → ${data.stock}`);
    }
    if (data.isActive !== undefined) parts.push(data.isActive ? 'চালু' : 'বন্ধ');
    if (parts.length === 0) parts.push(`হালনাগাদ (${Object.keys(data).join(', ')})`);

    adminLog({
      adminId: admin.id,
      adminName: admin.name,
      action: priceChanged ? 'PRICE_CHANGE' : 'VARIANT_UPDATE',
      targetId: String(id),
      amount: priceChanged ? Number(data.price) : undefined,
      detail: `${before?.label ?? `#${id}`} — ${parts.join(', ')}`,
      ip: getIp(req),
    }).catch(() => {});

    // ★ পাবলিক পেজের ক্যাশ সাথে সাথে মুছে দাও — দাম/ছবি তখনই দেখাবে
    revalidatePath('/', 'layout');

    return Response.json({ success: true });
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(req: Request) {
  try {
    const admin = await requireAdmin();
    const { id } = await readJson(req);
    if (!id) throw new ApiError('id প্রয়োজন', 400);

    // ★ অর্ডার থাকলে ডিলিট করা যাবে না
    const orders = await prisma.order.count({ where: { variantId: Number(id) } });
    if (orders > 0) {
      throw new ApiError(
        `এই প্যাকেজে ${orders} টি অর্ডার আছে — ডিলিট করা যাবে না। বন্ধ করে দিন।`,
        400
      );
    }

    const before = await prisma.variant.findUnique({
      where: { id: Number(id) },
      select: { label: true, price: true },
    });

    await prisma.variant.delete({ where: { id: Number(id) } });

    adminLog({
      adminId: admin.id, adminName: admin.name, action: 'VARIANT_DELETE',
      targetId: String(id),
      detail: before ? `${before.label} (৳${Number(before.price)}) মুছে ফেলা হয়েছে` : `#${id} মুছে ফেলা হয়েছে`,
      ip: getIp(req),
    }).catch(() => {});

    // ★ পাবলিক পেজের ক্যাশ সাথে সাথে মুছে দাও — দাম/ছবি তখনই দেখাবে
    revalidatePath('/', 'layout');

    return Response.json({ success: true });
  } catch (e) {
    return apiError(e);
  }
}
