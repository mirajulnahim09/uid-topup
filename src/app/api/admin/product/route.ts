import { prisma } from '@/lib/prisma';
import { requireAdmin, apiError, ApiError, readJson } from '@/lib/guard';
import { adminLog } from '@/lib/adminLog';
import { getIp } from '@/lib/rateLimit';
import { cleanText, safeUrl } from '@/lib/sanitize';
import { deleteImage } from '@/lib/upload';
import { revalidatePath } from 'next/cache';

function slugify(s: string) {
  return (
    s.toLowerCase()
      .replace(/[^a-z0-9\u0980-\u09FF]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'product'
  );
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();
    const { categoryId, name, image, description, uidLabel, uidHint } = await readJson(req);

    if (!categoryId) throw new ApiError('ক্যাটাগরি বেছে নিন', 400);
    const nm = cleanText(String(name || ''), 80);
    if (nm.length < 2) throw new ApiError('প্রোডাক্টের নাম দিন', 400);

    const count = await prisma.product.count({ where: { categoryId: Number(categoryId) } });

    const p = await prisma.product.create({
      data: {
        categoryId: Number(categoryId),
        name: nm,
        slug: slugify(nm),
        image: image ? safeUrl(String(image)) : null,
        description: description ? cleanText(String(description), 300) : null,
        uidLabel: cleanText(String(uidLabel || 'Player UID'), 40),
        uidHint: uidHint ? cleanText(String(uidHint), 160) : null,
        sortOrder: count,
      },
    });

    adminLog({
      adminId: admin.id, adminName: admin.name, action: 'PRODUCT_CREATE',
      targetId: String(p.id), detail: `${nm} তৈরি করা হয়েছে`, ip: getIp(req),
    }).catch(() => {});

    revalidatePath('/', 'layout');
    return Response.json({ success: true, id: p.id });
  } catch (e) {
    return apiError(e);
  }
}

export async function PATCH(req: Request) {
  try {
    const admin = await requireAdmin();
    const { id, isActive, name, image, description, uidLabel, uidHint } = await readJson(req);
    if (!id) throw new ApiError('id প্রয়োজন', 400);

    const current = await prisma.product.findUnique({ where: { id: Number(id) } });
    if (!current) throw new ApiError('প্রোডাক্ট পাওয়া যায়নি', 404);

    const data: Record<string, unknown> = {};

    if (isActive !== undefined) data.isActive = Boolean(isActive);

    if (name !== undefined) {
      const nm = cleanText(String(name), 80);
      if (nm.length < 2) throw new ApiError('প্রোডাক্টের নাম দিন', 400);
      data.name = nm;
      data.slug = slugify(nm);
    }

    if (image !== undefined) {
      const img = image ? safeUrl(String(image)) : null;
      data.image = img;
      // পুরনো ছবি মুছে ফেলা — storage বাঁচাতে
      if (current.image && current.image !== img) {
        deleteImage(current.image).catch(() => {});
      }
    }

    if (description !== undefined) {
      data.description = description ? cleanText(String(description), 300) : null;
    }
    if (uidLabel !== undefined) data.uidLabel = cleanText(String(uidLabel), 40);
    if (uidHint !== undefined) data.uidHint = uidHint ? cleanText(String(uidHint), 160) : null;

    await prisma.product.update({ where: { id: Number(id) }, data });

    adminLog({
      adminId: admin.id, adminName: admin.name, action: 'PRODUCT_UPDATE',
      targetId: String(id),
      detail:
        `${current.name} — ` +
        (data.isActive !== undefined
          ? data.isActive ? 'চালু করা হয়েছে' : 'বন্ধ করা হয়েছে'
          : `${Object.keys(data).join(', ')} হালনাগাদ`),
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

    // ★ অর্ডার থাকলে ডিলিট করা যাবে না — ইতিহাস নষ্ট হবে
    const orders = await prisma.order.count({
      where: { variant: { productId: Number(id) } },
    });
    if (orders > 0) {
      throw new ApiError(
        `এই প্রোডাক্টে ${orders} টি অর্ডার আছে — ডিলিট করা যাবে না। বন্ধ করে দিন।`,
        400
      );
    }

    const p = await prisma.product.findUnique({ where: { id: Number(id) } });
    await prisma.product.delete({ where: { id: Number(id) } });
    if (p?.image) deleteImage(p.image).catch(() => {});

    adminLog({
      adminId: admin.id, adminName: admin.name, action: 'PRODUCT_DELETE',
      targetId: String(id), detail: `${p?.name ?? `#${id}`} মুছে ফেলা হয়েছে`, ip: getIp(req),
    }).catch(() => {});

    // ★ পাবলিক পেজের ক্যাশ সাথে সাথে মুছে দাও — দাম/ছবি তখনই দেখাবে
    revalidatePath('/', 'layout');

    return Response.json({ success: true });
  } catch (e) {
    return apiError(e);
  }
}
