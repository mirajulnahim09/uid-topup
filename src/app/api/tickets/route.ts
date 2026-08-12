import { z } from 'zod';
import { requireUser, apiError, ApiError, readJson } from '@/lib/guard';
import { rateLimit, getIp, LIMITS } from '@/lib/rateLimit';
import {
  createTicket, listUserTickets, TICKET_BODY_MAX, TICKET_SUBJECT_MAX,
} from '@/lib/services/tickets';

/**
 * ═══════════════════════════════════════════════════════════
 * ★★★ Group I (৪) — গ্রাহকের টিকিট
 *
 *   GET  — নিজের টিকিটের তালিকা
 *   POST — নতুন টিকিট (প্রথম বার্তাসহ)
 *
 *   ⚠️ `requireUser()` — টিকিটে অভিযোগ, অর্ডার নং ও কখনো Player UID
 *   থাকে; অননুমোদিত পাঠ সরাসরি তথ্য ফাঁস।
 *
 *   ⚠️ rate limit fail-open (ডিফল্ট): এটি টাকার পথ নয় আর সাপোর্ট
 *   চাওয়া আটকে দেওয়ার ক্ষতি স্প্যামের ক্ষতির চেয়ে বেশি — কেউ
 *   সত্যিই আটকে থাকলে তার কথা বলার পথ বন্ধ করা যাবে না।
 * ═══════════════════════════════════════════════════════════
 */
const createSchema = z.object({
  subject: z.string().trim().min(3, 'বিষয় কমপক্ষে ৩ অক্ষর').max(TICKET_SUBJECT_MAX),
  body: z.string().trim().min(5, 'একটু বিস্তারিত লিখুন').max(TICKET_BODY_MAX),
  kind: z.enum(['GENERAL', 'DISPUTE']).optional(),
  orderId: z.string().trim().max(40).optional(),
});

export async function GET() {
  try {
    const user = await requireUser();
    return Response.json({ tickets: await listUserTickets(user.id) });
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();

    const rl = await rateLimit(`ticket:${user.id}`, LIMITS.ticket.limit, LIMITS.ticket.window);
    if (!rl.ok) {
      throw new ApiError(
        `অনেকগুলো টিকিট খোলা হয়েছে। ${Math.ceil(rl.retryAfter / 60)} মিনিট পর আবার চেষ্টা করুন।`,
        429,
      );
    }

    const parsed = createSchema.safeParse(await readJson(req));
    if (!parsed.success) throw new ApiError(parsed.error.errors[0].message, 400);

    // ⚠️ DISPUTE হলে অর্ডার থাকা উচিত — নাহলে অ্যাডমিন কী নিয়ে বিরোধ
    //    তা-ই জানবেন না
    if (parsed.data.kind === 'DISPUTE' && !parsed.data.orderId) {
      throw new ApiError('বিরোধের জন্য অর্ডার নির্বাচন করুন', 400);
    }

    try {
      const ticket = await createTicket({
        userId: user.id,
        subject: parsed.data.subject,
        body: parsed.data.body,
        kind: parsed.data.kind,
        orderId: parsed.data.orderId ?? null,
      });
      return Response.json({ success: true, ticket });
    } catch (e) {
      throw new ApiError(e instanceof Error ? e.message : 'টিকিট খোলা যায়নি', 400);
    }
  } catch (e) {
    return apiError(e);
  }
}
