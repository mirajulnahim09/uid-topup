import { prisma } from '@/lib/prisma';
import { requireAdmin, apiError, ApiError } from '@/lib/guard';
import { cleanText, safeUrl } from '@/lib/sanitize';
import { deleteImage } from '@/lib/upload';
import { revalidatePath } from 'next/cache';

export async function POST(req: Request) {
  try {
    await requireAdmin();
    const { image, title, subtitle, link } = await req.json();

    const img = safeUrl(String(image || ''));
    if (!img) throw new ApiError('ছবি আপলোড করুন', 400);

    const l = link ? safeUrl(String(link)) : null;
    if (link && !l) throw new ApiError('লিংকটি অবৈধ', 400);

    const count = await prisma.banner.count();
    const b = await prisma.banner.create({
      data: {
        image: img,
        title: title ? cleanText(String(title), 120) : null,
        subtitle: subtitle ? cleanText(String(subtitle), 200) : null,
        link: l,
        sortOrder: count,
      },
    });

    revalidatePath('/', 'layout');
    return Response.json({ success: true, id: b.id });
  } catch (e) {
    return apiError(e);
  }
}

export async function PATCH(req: Request) {
  try {
    await requireAdmin();
    const { id, isActive, title, subtitle, link, sortOrder } = await req.json();
    if (!id) throw new ApiError('id প্রয়োজন', 400);

    const data: Record<string, unknown> = {};
    if (isActive !== undefined) data.isActive = Boolean(isActive);
    if (sortOrder !== undefined) {
      const n = Number(sortOrder);
      if (isNaN(n)) throw new ApiError('অবৈধ ক্রম', 400);
      data.sortOrder = n;
    }
    if (title !== undefined) data.title = title ? cleanText(String(title), 120) : null;
    if (subtitle !== undefined) {
      data.subtitle = subtitle ? cleanText(String(subtitle), 200) : null;
    }
    if (link !== undefined) {
      const l = link ? safeUrl(String(link)) : null;
      if (link && !l) throw new ApiError('লিংকটি অবৈধ', 400);
      data.link = l;
    }

    await prisma.banner.update({ where: { id: Number(id) }, data });
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

    const b = await prisma.banner.findUnique({ where: { id: Number(id) } });
    if (!b) throw new ApiError('ব্যানার পাওয়া যায়নি', 404);

    await prisma.banner.delete({ where: { id: Number(id) } });
    deleteImage(b.image).catch(() => {});

    // ★ পাবলিক পেজের ক্যাশ সাথে সাথে মুছে দাও — দাম/ছবি তখনই দেখাবে
    revalidatePath('/', 'layout');

    return Response.json({ success: true });
  } catch (e) {
    return apiError(e);
  }
}
