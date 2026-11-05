import { requireUser, apiError, ApiError, readForm } from '@/lib/guard';
import { rateLimit } from '@/lib/rateLimit';
import { uploadImage, UploadError, isBlobConfigured } from '@/lib/upload';

/** ইউজার শুধু ডিপোজিট স্ক্রিনশট আপলোড করতে পারবে — আর কিছু না */
export async function POST(req: Request) {
  try {
    const user = await requireUser();

    const rl = await rateLimit(`upl:${user.id}`, 10, 600);
    if (!rl.ok) throw new ApiError('অনেক বেশি আপলোড। একটু পর চেষ্টা করুন।', 429);

    if (!isBlobConfigured()) throw new ApiError('ছবি আপলোড এখন চালু নেই', 503);

    const form = await readForm(req);
    const file = form.get('file');
    if (!(file instanceof File)) throw new ApiError('কোনো ফাইল পাওয়া যায়নি', 400);

    const res = await uploadImage(file, 'deposits');
    return Response.json({ success: true, url: res.url });
  } catch (e) {
    if (e instanceof UploadError) return Response.json({ error: e.message }, { status: 400 });
    return apiError(e);
  }
}
