import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { requireUser, apiError, ApiError, readJson } from '@/lib/guard';
import { rateLimit, RATE_LIMIT_UNAVAILABLE_MSG } from '@/lib/rateLimit';
import { passwordSchema } from '@/lib/validation';
import { notify } from '@/lib/notify';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const schema = z.object({
  current: z.string().min(1, 'বর্তমান পাসওয়ার্ড দিন'),
  next: passwordSchema,
});

export async function POST(req: Request) {
  try {
    const user = await requireUser();

    // ★ পাসওয়ার্ড অনুমান করার চেষ্টা আটকায়
    //   C4: RUN.md-এ `pw:` তালিকাভুক্ত ছিল না, তবু fail-closed করা হলো —
    //   এই endpoint **বর্তমান পাসওয়ার্ড** যাচাই করে, অর্থাৎ ঠিক একই
    //   ব্রুট-ফোর্স ঝুঁকি যা `login:`-এ। ছেড়ে গেলে C4-এর ফাঁকটাই
    //   অন্য দরজা দিয়ে খোলা থাকত।
    const rl = await rateLimit(`pw:${user.id}`, 5, 900, { failClosed: true });
    if (!rl.ok) {
      if (rl.failed) throw new ApiError(RATE_LIMIT_UNAVAILABLE_MSG, 503);
      throw new ApiError('অনেক বেশি চেষ্টা। ১৫ মিনিট পর করুন।', 429);
    }

    const parsed = schema.safeParse(await readJson(req));
    if (!parsed.success) throw new ApiError(parsed.error.errors[0].message, 400);

    const row = await prisma.user.findUnique({
      where: { id: user.id },
      select: { password: true },
    });
    if (!row) throw new ApiError('ইউজার পাওয়া যায়নি', 404);

    const ok = await bcrypt.compare(parsed.data.current, row.password);
    if (!ok) throw new ApiError('বর্তমান পাসওয়ার্ড ভুল', 400);

    if (parsed.data.current === parsed.data.next) {
      throw new ApiError('নতুন পাসওয়ার্ড আগেরটার মতোই', 400);
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { password: await bcrypt.hash(parsed.data.next, 12) },
    });

    // ★ guarded (defense-in-depth): notify নিজে throw করে না (ভেতরে
    //   try/catch), তবু .catch() রাখা — refactor-এ throw এলেও order/money
    //   commit-পরবর্তী ব্যর্থতা যেন ইউজারকে ভুল "ব্যর্থ" না দেখায়।
    notify(
      user.id,
      'পাসওয়ার্ড বদলানো হয়েছে',
      'আপনি না করে থাকলে সাথে সাথে সাপোর্টে জানান।',
      '/account/profile'
    ).catch(() => {});

    return Response.json({ success: true, message: 'পাসওয়ার্ড বদলানো হয়েছে' });
  } catch (e) {
    return apiError(e);
  }
}
