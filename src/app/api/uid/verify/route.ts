import { prisma } from '@/lib/prisma';
import { requireUser, apiError, ApiError } from '@/lib/guard';
import { rateLimit, LIMITS, getIp } from '@/lib/rateLimit';
import { uidVerifySchema } from '@/lib/validation';
import { verifyUid } from '@/lib/uidVerify';

export const dynamic = 'force-dynamic';

/**
 * ★ POST /api/uid/verify — Player UID যাচাই করে গেম-নাম ফেরত দেয়।
 *
 *   rate-limit কেন: এটি তৃতীয় পক্ষের সার্ভিসে proxy করে। সীমা না
 *   থাকলে কেউ এটি দিয়ে UID enumerate করতে পারে, বা আমাদের
 *   provider কোটা শেষ করে দিতে পারে।
 *
 *   ⚠️ যাচাই ব্যর্থ হলেও 200 ফেরত যায় ('unavailable' সহ) — কারণ
 *      এটি ব্যর্থতা নয়, বরং "এখন যাচাই করা যাচ্ছে না"। ক্লায়েন্ট
 *      তখন double-entry fallback দেখাবে, বিক্রি থামবে না।
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();

    const rl = rateLimit(`uidverify:${user.id}`, LIMITS.uidVerify.limit, LIMITS.uidVerify.window);
    if (!rl.ok) {
      throw new ApiError(
        `অনেক বেশি চেষ্টা হয়েছে। ${rl.retryAfter} সেকেন্ড পর আবার চেষ্টা করুন।`,
        429
      );
    }

    const parsed = uidVerifySchema.safeParse(await req.json());
    if (!parsed.success) throw new ApiError(parsed.error.errors[0].message, 400);

    const { productId, uid } = parsed.data;

    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, isActive: true, uidValidationProvider: true },
    });
    if (!product || !product.isActive) {
      throw new ApiError('প্রোডাক্ট পাওয়া যায়নি', 404);
    }

    const result = await verifyUid(product.uidValidationProvider, uid);
    return Response.json(result);
  } catch (e) {
    return apiError(e);
  }
}
