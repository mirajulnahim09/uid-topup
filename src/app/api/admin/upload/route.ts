import { requireAdmin, apiError, ApiError, readForm } from '@/lib/guard';
import { rateLimit, LIMITS } from '@/lib/rateLimit';
import { uploadImage, UploadError, storageReady, storageReason, storageName } from '@/lib/upload';
import { prisma } from '@/lib/prisma';

/**
 * ★ ফর্ম-আপলোড এন্ডপয়েন্ট (ProductManager/BannerManager ইত্যাদি ব্যবহার করে)।
 *   এখন প্রতিটি আপলোড কেন্দ্রীয় Media লাইব্রেরিতেও রেকর্ড হয় — তাই যেকোনো
 *   ফর্ম থেকে দেওয়া ছবি /admin/media-তে দেখা যায় ও পুনঃব্যবহারযোগ্য।
 */
const FOLDERS = ['products', 'banners', 'payments', 'site', 'categories', 'campaigns', 'popups', 'media', 'brand'];

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();

    const rl = await rateLimit(`upl:${admin.id}`, LIMITS.upload.limit, LIMITS.upload.window);
    if (!rl.ok) throw new ApiError('অনেক বেশি আপলোড। একটু পর চেষ্টা করুন।', 429);

    if (!storageReady()) throw new ApiError(storageReason() || 'ছবি আপলোড চালু নেই।', 503);

    const form = await readForm(req);
    const file = form.get('file');
    const folder = String(form.get('folder') || 'site');

    if (!FOLDERS.includes(folder)) throw new ApiError('অবৈধ ফোল্ডার', 400);
    if (!(file instanceof File)) throw new ApiError('কোনো ফাইল পাওয়া যায়নি', 400);

    const res = await uploadImage(file, folder);

    // কেন্দ্রীয় লাইব্রেরিতে রেকর্ড — best-effort (আপলোড সফল হলেই যথেষ্ট)
    const cw = Number(form.get('width')); const ch = Number(form.get('height'));
    prisma.media.create({
      data: {
        url: res.url, key: res.key, storage: storageName(), folder, type: 'IMAGE',
        mime: res.mime, bytes: res.size,
        width: res.width ?? (Number.isFinite(cw) && cw > 0 ? cw : null),
        height: res.height ?? (Number.isFinite(ch) && ch > 0 ? ch : null),
      },
    }).catch(() => {});

    return Response.json({ success: true, url: res.url });
  } catch (e) {
    if (e instanceof UploadError) return Response.json({ error: e.message }, { status: 400 });
    return apiError(e);
  }
}
