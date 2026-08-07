import { prisma } from '@/lib/prisma';
import { requireAdmin, apiError, ApiError, readJson } from '@/lib/guard';
import { adminLog } from '@/lib/adminLog';
import { getIp } from '@/lib/rateLimit';
import { cleanText, safeUrl } from '@/lib/sanitize';

const PLATFORMS = [
  'facebook', 'messenger', 'youtube', 'whatsapp',
  'telegram', 'tiktok', 'instagram', 'discord', 'x',
];

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();
    const { platform, url, label } = await readJson(req);

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

    adminLog({
      adminId: admin.id, adminName: admin.name, action: 'SOCIAL_CREATE',
      targetId: String(s.id), detail: `${p} — ${u}`, ip: getIp(req),
    }).catch(() => {});

    return Response.json({ success: true, id: s.id });
  } catch (e) {
    return apiError(e);
  }
}

export async function PATCH(req: Request) {
  try {
    const admin = await requireAdmin();
    const { id, url, label, isActive } = await readJson(req);
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

    adminLog({
      adminId: admin.id, adminName: admin.name, action: 'SOCIAL_UPDATE',
      targetId: String(id), detail: `সোশ্যাল লিংক হালনাগাদ (${Object.keys(data).join(', ')})`, ip: getIp(req),
    }).catch(() => {});

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
    await prisma.socialLink.delete({ where: { id: Number(id) } });

    adminLog({
      adminId: admin.id, adminName: admin.name, action: 'SOCIAL_DELETE',
      targetId: String(id), detail: 'সোশ্যাল লিংক মুছে ফেলা হয়েছে', ip: getIp(req),
    }).catch(() => {});

    return Response.json({ success: true });
  } catch (e) {
    return apiError(e);
  }
}
