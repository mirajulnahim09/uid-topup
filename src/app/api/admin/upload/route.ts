import { requireAdmin, apiError, ApiError } from '@/lib/guard';
import { rateLimit, LIMITS } from '@/lib/rateLimit';
import { uploadImage, UploadError, isBlobConfigured } from '@/lib/upload';

const FOLDERS = ['products', 'banners', 'payments', 'site', 'categories'];

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();

    const rl = rateLimit(`upl:${admin.id}`, LIMITS.upload.limit, LIMITS.upload.window);
    if (!rl.ok) throw new ApiError('অনেক বেশি আপলোড। একটু পর চেষ্টা করুন।', 429);

    if (!isBlobConfigured()) {
      throw new ApiError(
        'ছবি আপলোড চালু নেই। Vercel → Storage → Blob তৈরি করে BLOB_READ_WRITE_TOKEN বসান।',
        503
      );
    }

    const form = await req.formData();
    const file = form.get('file');
    const folder = String(form.get('folder') || 'site');

    if (!FOLDERS.includes(folder)) throw new ApiError('অবৈধ ফোল্ডার', 400);
    if (!(file instanceof File)) throw new ApiError('কোনো ফাইল পাওয়া যায়নি', 400);

    const res = await uploadImage(file, folder);
    return Response.json({ success: true, url: res.url });
  } catch (e) {
    if (e instanceof UploadError) return Response.json({ error: e.message }, { status: 400 });
    return apiError(e);
  }
}
