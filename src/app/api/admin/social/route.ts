import { prisma } from '@/lib/prisma';
import { requireAdmin, apiError, ApiError } from '@/lib/guard';
import { cleanText, safeUrl } from '@/lib/sanitize';

const PLATFORMS = [
  'facebook', 'messenger', 'youtube', 'whatsapp',
  'telegram', 'tiktok', 'instagram', 'discord', 'x',
];

export async function POST(req: Request) {
  try {
    await requireAdmin();
    const { platform, url, label } = await req.json();

    const p = String(platform || '').toLowerCase();
    if (!PLATFORMS.includes(p)) throw new ApiError('অবৈধ প্ল্যাটফর্ম', 400);

    const u = safeUrl(String(url || ''));
    if (!u) throw new ApiError('সঠিক লিংক দিন (https:// দিয়ে শুরু)', 400);

    const count = await prisma.socialLink.count();
    const s = await prisma.socialLink.create({
      data: {
        platform: p,
        url: u,
        label: label ? cleanText(String(label), 40) : null,
        sortOrder: count,
      },
    });

    return Response.json({ success: true, id: s.id });
  } catch (e) {
    return apiError(e);
  }
}

export async function PATCH(req: Request) {
  try {
    await requireAdmin();
    const { id, url, label, isActive } = await req.json();
    if (!id) throw new ApiError('id প্রয়োজন', 400);

    const data: Record<string, unknown> = {};
    if (url !== undefined) {
      const u = safeUrl(String(url));
      if (!u) throw new ApiError('সঠিক লিংক দিন', 400);
      data.url = u;
    }
    if (label !== undefined) data.label = label ? cleanText(String(label), 40) : null;
    if (isActive !== undefined) data.isActive = Boolean(isActive);

    await prisma.socialLink.update({ where: { id: Number(id) }, data });
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
    await prisma.socialLink.delete({ where: { id: Number(id) } });
    return Response.json({ success: true });
  } catch (e) {
    return apiError(e);
  }
}
