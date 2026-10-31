import { z } from 'zod';
import { requireUser, apiError, ApiError, readJson } from '@/lib/guard';
import { rateLimit, LIMITS } from '@/lib/rateLimit';
import {
  getThread, replyToTicket, closeTicket, TICKET_BODY_MAX,
} from '@/lib/services/tickets';

/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ Group I (৪) — একটি থ্রেড (গ্রাহক)
 *
 *   GET   — থ্রেড পড়া
 *   POST  — উত্তর
 *   PATCH — বন্ধ করা
 *
 *   ⚠️ তিনটিতেই মালিকানা যাচাই সার্ভিস-স্তরে হয় (`ownerId` পাঠিয়ে),
 *   রুট-হ্যান্ডলারে নয়। ফলে অ্যাডমিন-পথ ও গ্রাহক-পথ একই যুক্তি
 *   ব্যবহার করে — দুটি আলাদা যাচাই থাকলে একদিন একটি শিথিল হতো।
 *
 *   ⚠️ "নেই" ও "আপনার নয়" — দুটিতেই ৪০৪। আলাদা করলে টিকিট আইডি
 *   অনুমান করে অন্যের টিকিটের অস্তিত্ব যাচাই করা যেত।
 * ═══════════════════════════════════════════════════════════
 */
const replySchema = z.object({
  body: z.string().trim().min(1, 'বার্তা লিখুন').max(TICKET_BODY_MAX),
});

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const user = await requireUser();
    const thread = await getThread(id, user.id);
    if (!thread) throw new ApiError('টিকিট পাওয়া যায়নি', 404);
    return Response.json({ ticket: thread });
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const user = await requireUser();

    const rl = await rateLimit(`ticket:reply:${user.id}`, LIMITS.ticketReply.limit, LIMITS.ticketReply.window);
    if (!rl.ok) throw new ApiError('একটু ধীরে লিখুন।', 429);

    const parsed = replySchema.safeParse(await readJson(req));
    if (!parsed.success) throw new ApiError(parsed.error.errors[0].message, 400);

    try {
      const r = await replyToTicket({
        ticketId: id,
        authorId: user.id,
        authorName: user.name,
        isStaff: false,
        body: parsed.data.body,
        ownerId: user.id,
      });
      if (!r) throw new ApiError('টিকিট পাওয়া যায়নি', 404);
      return Response.json({ success: true });
    } catch (e) {
      if (e instanceof ApiError) throw e;
      // ★ কাঁচা `e.message` আর ফরোয়ার্ড করা হয় না — Prisma-র ভেতরের বার্তা
      //   ক্লায়েন্টে চলে যেত (ইনপুট-ফাজে মাপা, ২০২৬-০৯-১৮)। সার্ভিস এখন
      //   নিজেই `ApiError` ছোড়ে, আর অজানা ত্রুটি `apiError()` সামলায়।
      throw e;
    }
  } catch (e) {
    return apiError(e);
  }
}

export async function PATCH(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const user = await requireUser();
    const r = await closeTicket({ ticketId: id, byName: user.name, ownerId: user.id });
    if (!r) throw new ApiError('টিকিট পাওয়া যায়নি', 404);
    return Response.json({ success: true });
  } catch (e) {
    return apiError(e);
  }
}
