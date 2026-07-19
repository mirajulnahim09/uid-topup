import { prisma } from '@/lib/prisma';
import { requireUser, apiError, ApiError } from '@/lib/guard';
import { rateLimit, LIMITS } from '@/lib/rateLimit';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const schema = z.object({
  trxId: z
    .string().trim().toUpperCase()
    .min(6, 'সঠিক ট্রানজেকশন আইডি দিন').max(30, 'ট্রানজেকশন আইডি অনেক বড়'),
});

/**
 * ═══════════════════════════════════════════════════════════
 * ★ TrxID আগে ব্যবহৃত কিনা — ফর্ম ছাড়ার সাথে সাথেই (2.15)
 *
 *   কেন: আগে ডুপ্লিকেট TrxID ধরা পড়ত **সাবমিটের পর**। গ্রাহক
 *   টাকা পাঠিয়ে, ফর্ম ভরে, জমা দিয়ে তবেই জানত যে ভুল হয়েছে —
 *   অথবা আরও খারাপ, ২০ মিনিট অপেক্ষার পর বাতিল হতো।
 *   (MANUAL_WORKFLOW.md A5 — "duplicate-TrxID check on blur")
 *
 *   ⚠️ ইচ্ছাকৃতভাবে সীমিত তথ্য: শুধু "ব্যবহৃত হয়েছে কি না" —
 *      কার, কত টাকার, কবে, কিছুই নয়। নাহলে এটি দিয়ে অন্যের
 *      লেনদেনের অস্তিত্ব যাচাই করা যেত।
 *
 *   ⚠️ rate-limit আছে — নাহলে এটি দিয়ে TrxID enumerate করা যেত।
 * ═══════════════════════════════════════════════════════════
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();

    const rl = rateLimit(`trxcheck:${user.id}`, LIMITS.trxCheck.limit, LIMITS.trxCheck.window);
    if (!rl.ok) {
      throw new ApiError(`অনেক বেশি চেষ্টা। ${rl.retryAfter} সেকেন্ড পর দেখুন।`, 429);
    }

    const parsed = schema.safeParse(await req.json());
    // ★ ফরম্যাট ভুল হলে "ব্যবহৃত" বলি না — এটি শুধু ডুপ্লিকেট পরীক্ষা
    if (!parsed.success) return Response.json({ used: false });

    const existing = await prisma.deposit.findUnique({
      where: { trxId: parsed.data.trxId },
      select: { id: true },
    });

    return Response.json({ used: Boolean(existing) });
  } catch (e) {
    return apiError(e);
  }
}
