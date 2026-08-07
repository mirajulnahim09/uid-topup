import { prisma } from '@/lib/prisma';
import { requireUser, apiError, ApiError, readJson } from '@/lib/guard';
import { cleanName } from '@/lib/sanitize';
import { rateLimit } from '@/lib/rateLimit';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const schema = z.object({
  name: z.string().trim().min(2, 'নাম কমপক্ষে ২ অক্ষর').max(60),
  phone: z.string().trim().regex(/^01[3-9]\d{8}$/, 'সঠিক মোবাইল নাম্বার দিন'),
});

export async function PATCH(req: Request) {
  try {
    const user = await requireUser();

    const rl = await rateLimit(`profile:${user.id}`, 10, 600);
    if (!rl.ok) throw new ApiError('অনেক বেশি চেষ্টা। একটু পর করুন।', 429);

    const parsed = schema.safeParse(await readJson(req));
    if (!parsed.success) throw new ApiError(parsed.error.errors[0].message, 400);

    const name = cleanName(parsed.data.name, 60);
    const { phone } = parsed.data;

    if (name.length < 2) throw new ApiError('সঠিক নাম দিন', 400);

    // ★ অন্য কারো ফোন নাম্বার নয়
    const dupe = await prisma.user.findFirst({
      where: { phone, NOT: { id: user.id } },
      select: { id: true },
    });
    if (dupe) throw new ApiError('এই মোবাইল নাম্বার অন্য অ্যাকাউন্টে ব্যবহৃত', 409);

    try {
      await prisma.user.update({
        where: { id: user.id },
        data: { name, phone },
      });
    } catch (e: unknown) {
      if ((e as { code?: string })?.code === 'P2002') {
        throw new ApiError('এই মোবাইল নাম্বার অন্য অ্যাকাউন্টে ব্যবহৃত', 409);
      }
      throw e;
    }

    return Response.json({ success: true, message: 'প্রোফাইল আপডেট হয়েছে' });
  } catch (e) {
    return apiError(e);
  }
}
