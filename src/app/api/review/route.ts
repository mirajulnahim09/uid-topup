import { prisma } from '@/lib/prisma';
import { reviewSchema } from '@/lib/validation';
import { requireUser, apiError, ApiError, readJson } from '@/lib/guard';
import { cleanText } from '@/lib/sanitize';

export const dynamic = 'force-dynamic';

/**
 * ═══════════════════════════════════════════════════════════
 * ★ রিভিউ জমা — শুধুমাত্র প্রকৃত, নিশ্চিত হওয়া কেনাকাটার বিপরীতে
 *
 *   প্রতিযোগী বিশ্লেষণে দেখা গেছে, যে আস্থা-সংকেত সত্যিই কাজ করে
 *   সেটি নির্দিষ্ট ও যাচাইযোগ্য ("৪৭১টি রিভিউ, ৪.৮৮")।
 *   তাই এখানে রিভিউ দেওয়ার শর্ত কঠিন রাখা হয়েছে:
 *
 *     • অর্ডারটি গ্রাহকের নিজের হতে হবে
 *     • অর্ডার COMPLETED হতে হবে
 *     • গ্রাহক নিজে ডেলিভারি নিশ্চিত করে থাকতে হবে
 *     • প্রতি অর্ডারে একটিই রিভিউ (DB level unique)
 *
 *   ফলে প্রতিটি রিভিউর পেছনে একটি আসল, টাকা-দেওয়া, পৌঁছে যাওয়া
 *   অর্ডার থাকে — বানানো রিভিউ ঢোকানোর কোনো পথ নেই।
 * ═══════════════════════════════════════════════════════════
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();

    const parsed = reviewSchema.safeParse(await readJson(req));
    if (!parsed.success) throw new ApiError(parsed.error.errors[0].message, 400);
    const { orderId, rating } = parsed.data;
    const body = parsed.data.body ? cleanText(parsed.data.body, 500) : null;
    const photoUrl = parsed.data.photoUrl || null; // ★ ঐচ্ছিক স্ক্রিনশট

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, userId: true, status: true, deliveryConfirmedAt: true },
    });

    if (!order || order.userId !== user.id) throw new ApiError('অর্ডার পাওয়া যায়নি', 404);
    if (order.status !== 'COMPLETED') throw new ApiError('এই অর্ডারটি এখনো সম্পন্ন হয়নি', 400);
    if (!order.deliveryConfirmedAt) {
      throw new ApiError('আগে নিশ্চিত করুন যে ডেলিভারি পেয়েছেন', 400);
    }

    try {
      await prisma.review.create({
        data: { orderId: order.id, userId: user.id, rating, body, photoUrl },
      });
    } catch (e: unknown) {
      // ★ unique constraint — একই অর্ডারে দ্বিতীয় রিভিউ
      if ((e as { code?: string })?.code === 'P2002') {
        throw new ApiError('এই অর্ডারের রিভিউ আগেই দেওয়া হয়েছে', 409);
      }
      throw e;
    }

    return Response.json({ success: true, message: 'রিভিউর জন্য ধন্যবাদ!' });
  } catch (e) {
    return apiError(e);
  }
}
