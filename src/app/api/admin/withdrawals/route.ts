import { z } from 'zod';
import { requireAdmin, apiError, ApiError, readJson } from '@/lib/guard';
import { adminLog } from '@/lib/adminLog';
import { listAdminWithdrawals, approveWithdrawal, rejectWithdrawal } from '@/lib/services/withdrawal';

/**
 * ★★★ Group I (৫) — অ্যাডমিনের প্রত্যাহার সারি
 *
 *   GET  ?status= — তালিকা
 *   POST { id, action: 'approve' | 'reject', payoutRef?, reason? }
 *
 *   ⚠️ কোনো স্বয়ংক্রিয় পরিশোধ নেই। অ্যাডমিন হাতে টাকা পাঠিয়ে
 *   লেনদেন নম্বর লেখেন — সেটি ছাড়া অনুমোদন করা যায় না।
 *
 *   ⚠️ প্রতিটি সিদ্ধান্ত `adminLog`-এ যায়। টাকা বাইরে যাওয়ার পথে
 *   "কে অনুমোদন করল" পরে জিজ্ঞেস করা যেতেই হবে।
 */
const actionSchema = z.object({
  id: z.string().trim().min(1).max(40),
  action: z.enum(['approve', 'reject']),
  payoutRef: z.string().trim().max(60).optional(),
  reason: z.string().trim().max(500).optional(),
});

export async function GET(req: Request) {
  try {
    await requireAdmin();
    const raw = new URL(req.url).searchParams.get('status');
    const status =
      raw === 'PENDING' || raw === 'HELD' || raw === 'APPROVED' || raw === 'REJECTED'
        ? raw
        : undefined;
    return Response.json({ withdrawals: await listAdminWithdrawals(status) });
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();
    const parsed = actionSchema.safeParse(await readJson(req));
    if (!parsed.success) throw new ApiError(parsed.error.errors[0].message, 400);

    const { id, action } = parsed.data;

    if (action === 'approve') {
      await approveWithdrawal({
        id,
        payoutRef: parsed.data.payoutRef ?? '',
        adminId: admin.id,
        adminName: admin.name,
        note: parsed.data.reason,
      });
    } else {
      await rejectWithdrawal({
        id,
        reason: parsed.data.reason ?? '',
        adminId: admin.id,
        adminName: admin.name,
      });
    }

    adminLog({
      adminId: admin.id,
      adminName: admin.name,
      // ★ নতুন AdminAction যোগ করিনি — এটি ব্যালেন্স-প্রভাবিত সিদ্ধান্ত,
      //   আর `detail`-এ উপসর্গ থাকায় ফিল্টার করা যায়
      action: 'BALANCE_ADJUST',
      targetId: id,
      detail: `প্রত্যাহার ${action === 'approve' ? 'অনুমোদিত' : 'প্রত্যাখ্যাত'}`,
    }).catch(() => {});

    return Response.json({ success: true });
  } catch (e) {
    return apiError(e);
  }
}
