import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAdmin, apiError, ApiError, readJson } from '@/lib/guard';
import { rateLimit, LIMITS } from '@/lib/rateLimit';
import { uploadImage, deleteImage, UploadError, storageName } from '@/lib/upload';
import { referencedUrls } from '@/lib/mediaRefs';
import { cleanText } from '@/lib/sanitize';
import { logActivity, requestMeta } from '@/lib/adminLog';

/** ★ কেন্দ্রীয় মিডিয়া লাইব্রেরি API — তালিকা / আপলোড / মেটাডেটা / delete */

const FOLDERS = ['products', 'banners', 'payments', 'site', 'categories', 'campaigns', 'popups', 'media'];

// ── তালিকা: search / filter(type,folder) / sort / unused ──
export async function GET(req: Request) {
  try {
    await requireAdmin();
    const u = new URL(req.url);
    const q = (u.searchParams.get('q') || '').trim();
    const folder = u.searchParams.get('folder') || '';
    const type = u.searchParams.get('type') || '';
    const sort = u.searchParams.get('sort') || 'new';
    const onlyUnused = u.searchParams.get('unused') === '1';
    const limit = Math.min(120, Math.max(1, Number(u.searchParams.get('limit') || 60)));
    const offset = Math.max(0, Number(u.searchParams.get('offset') || 0));

    const where: Prisma.MediaWhereInput = {};
    if (folder && FOLDERS.includes(folder)) where.folder = folder;
    if (type === 'IMAGE') where.type = 'IMAGE';
    if (q) {
      where.OR = [
        { title: { contains: q, mode: 'insensitive' } },
        { alt: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { url: { contains: q, mode: 'insensitive' } },
        { key: { contains: q, mode: 'insensitive' } },
      ];
    }

    const orderBy: Prisma.MediaOrderByWithRelationInput =
      sort === 'old' ? { createdAt: 'asc' }
        : sort === 'big' ? { bytes: 'desc' }
          : sort === 'small' ? { bytes: 'asc' }
            : { createdAt: 'desc' };

    // ★ সব DB রাউন্ড-ট্রিপ সমান্তরাল (Neon latency কমাতে) —
    //   ছোট ডেটাসেট (অ্যাডমিন আপলোড), তাই এক পাসেই।
    const [rows, refs, folderCounts] = await Promise.all([
      prisma.media.findMany({ where, orderBy, take: 500 }),
      referencedUrls(),
      prisma.media.groupBy({ by: ['folder'], _count: { _all: true } }),
    ]);

    let annotated = rows.map((m) => ({ ...m, inUse: refs.has(m.url), bytes: m.bytes }));
    if (onlyUnused) annotated = annotated.filter((m) => !m.inUse);

    const total = annotated.length;
    const items = annotated.slice(offset, offset + limit);

    return Response.json({
      items,
      total,
      folders: folderCounts.map((f) => ({ folder: f.folder, count: f._count._all })),
      storage: storageName(),
    });
  } catch (e) {
    return apiError(e);
  }
}

// ── আপলোড: multipart → storage + Media রেকর্ড ──
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();
    const rl = await rateLimit(`media:${admin.id}`, LIMITS.upload.limit, LIMITS.upload.window);
    if (!rl.ok) throw new ApiError('অনেক বেশি আপলোড। একটু পর চেষ্টা করুন।', 429);

    const form = await req.formData();
    const file = form.get('file');
    const folder = String(form.get('folder') || 'media');
    if (!FOLDERS.includes(folder)) throw new ApiError('অবৈধ ফোল্ডার', 400);
    if (!(file instanceof File)) throw new ApiError('কোনো ফাইল পাওয়া যায়নি', 400);

    const res = await uploadImage(file, folder);

    // ক্লায়েন্ট মাপ পাঠালে (processImage) — server parse ব্যর্থ হলে fallback
    const cw = Number(form.get('width')); const ch = Number(form.get('height'));
    const width = res.width ?? (Number.isFinite(cw) && cw > 0 ? cw : null);
    const height = res.height ?? (Number.isFinite(ch) && ch > 0 ? ch : null);

    const media = await prisma.media.create({
      data: {
        url: res.url,
        key: res.key,
        storage: storageName(),
        folder,
        type: 'IMAGE',
        mime: res.mime,
        bytes: res.size,
        width, height,
        alt: cleanText(String(form.get('alt') || ''), 160) || null,
        title: cleanText(String(form.get('title') || ''), 160) || null,
        description: cleanText(String(form.get('description') || ''), 400) || null,
      },
    });

    const meta = requestMeta(req);
    logActivity({ actorId: admin.id, actorName: admin.name, actorType: 'ADMIN', role: 'ADMIN',
      action: 'MEDIA_UPLOAD', targetId: media.id, detail: `${folder} · ${Math.round(res.size / 1024)}KB`,
      ip: meta.ip, userAgent: meta.userAgent }).catch(() => {});

    return Response.json({ success: true, media, url: res.url });
  } catch (e) {
    if (e instanceof UploadError) return Response.json({ error: e.message }, { status: 400 });
    return apiError(e);
  }
}

// ── মেটাডেটা সম্পাদনা (SEO: alt/title/description) ──
export async function PATCH(req: Request) {
  try {
    await requireAdmin();
    const body = await readJson(req);
    const id = String(body.id || '');
    if (!id) throw new ApiError('id দরকার', 400);
    const media = await prisma.media.update({
      where: { id },
      data: {
        alt: body.alt !== undefined ? cleanText(String(body.alt), 160) || null : undefined,
        title: body.title !== undefined ? cleanText(String(body.title), 160) || null : undefined,
        description: body.description !== undefined ? cleanText(String(body.description), 400) || null : undefined,
      },
    });
    return Response.json({ success: true, media });
  } catch (e) {
    return apiError(e);
  }
}

// ── delete (ব্যবহৃত হলে force ছাড়া আটকায়) ──
export async function DELETE(req: Request) {
  try {
    const admin = await requireAdmin();
    const body = await req.json().catch(() => ({}));
    const id = String(body.id || '');
    const force = body.force === true;
    if (!id) throw new ApiError('id দরকার', 400);

    const media = await prisma.media.findUnique({ where: { id } });
    if (!media) throw new ApiError('মিডিয়া পাওয়া যায়নি', 404);

    if (!force) {
      const refs = await referencedUrls();
      if (refs.has(media.url)) {
        throw new ApiError('এই ছবিটি এখনো কোথাও ব্যবহৃত হচ্ছে — আগে সরান, নয়তো force দিন।', 409, 'IN_USE');
      }
    }

    await deleteImage(media.url);
    await prisma.media.delete({ where: { id } });
    logActivity({ actorId: admin.id, actorName: admin.name, actorType: 'ADMIN', role: 'ADMIN',
      action: 'MEDIA_DELETE', targetId: id, detail: media.folder }).catch(() => {});
    return Response.json({ success: true });
  } catch (e) {
    return apiError(e);
  }
}
