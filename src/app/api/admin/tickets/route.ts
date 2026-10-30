import { z } from 'zod';
import { requireAdmin, apiError, ApiError, readJson } from '@/lib/guard';
import {
  listAdminTickets, getThread, replyToTicket, closeTicket, TICKET_BODY_MAX,
} from '@/lib/services/tickets';

/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ Group I (৪) — অ্যাডমিনের টিকিট সারি
 *
 *   GET   ?status=OPEN  — সারি, অথবা ?id=… দিলে একটি থ্রেড
 *   POST  { id, body }  — উত্তর (স্ট্যাটাস স্বয়ংক্রিয়ভাবে ANSWERED)
 *   PATCH { id }        — বন্ধ
 *
 *   ⚠️ `ownerId: null` পাঠানো হয় — অ্যাডমিন যেকোনো থ্রেড দেখতে ও
 *   লিখতে পারেন। এটি একটি **স্পষ্ট** সিদ্ধান্ত; সার্ভিসে প্যারামিটারটি
 *   বাধ্যতামূলক, তাই ভুলে বাদ পড়ার উপায় নেই।
 *
 *   ⚠️ এখানে টাকা ফেরত দেওয়ার কোনো পথ নেই, ইচ্ছাকৃতভাবে। রিফান্ড
 *   আগের মতোই অর্ডার-পথ দিয়েই হবে — টাকার দুটি দরজা মানে একদিন
 *   একটিতে লক ভুল।
 * ═══════════════════════════════════════════════════════════
 */
const replySchema = z.object({
  id: z.string().trim().min(1).max(40),
  body: z.string().trim().min(1, 'বার্তা লিখুন').max(TICKET_BODY_MAX),
});

export async function GET(req: Request) {
  try {
    await requireAdmin();
    const url = new URL(req.url);

    const id = url.searchParams.get('id');
    if (id) {
      const thread = await getThread(id, null);
      if (!thread) throw new ApiError('টিকিট পাওয়া যায়নি', 404);
      return Response.json({ ticket: thread });
    }

    const raw = url.searchParams.get('status');
    const status =
      raw === 'OPEN' || raw === 'ANSWERED' || raw === 'CLOSED' ? raw : undefined;
    return Response.json({ tickets: await listAdminTickets(status) });
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();
    const parsed = replySchema.safeParse(await readJson(req));
    if (!parsed.success) throw new ApiError(parsed.error.errors[0].message, 400);

    try {
      const r = await replyToTicket({
        ticketId: parsed.data.id,
        authorId: admin.id,
        authorName: admin.name,
        isStaff: true,
        body: parsed.data.body,
        ownerId: null,
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

export async function PATCH(req: Request) {
  try {
    const admin = await requireAdmin();
    const body = (await readJson(req)) as { id?: string } | null;
    const id = String(body?.id || '');
    if (!id) throw new ApiError('আইডি নেই', 400);

    const r = await closeTicket({ ticketId: id, byName: admin.name, ownerId: null });
    if (!r) throw new ApiError('টিকিট পাওয়া যায়নি', 404);
    return Response.json({ success: true });
  } catch (e) {
    return apiError(e);
  }
}
