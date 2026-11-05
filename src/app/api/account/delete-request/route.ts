import { requireUser, apiError, ApiError, readJson } from '@/lib/guard';
import { rateLimit } from '@/lib/rateLimit';
import { cleanText } from '@/lib/sanitize';
import { logActivity, requestMeta } from '@/lib/adminLog';
import { notify, notifyAdmins } from '@/lib/notify';
import {
  DELETION_CONFIRM_WORD, requestAccountDeletion, cancelAccountDeletion,
} from '@/lib/services/accountDeletion';

export const dynamic = 'force-dynamic';

/** Customer asks for their account to be deleted (an admin completes it). */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    if (user.role === 'ADMIN') throw new ApiError('অ্যাডমিন অ্যাকাউন্টে এটি প্রযোজ্য নয়', 400);

    const rl = await rateLimit(`delete-req:${user.id}`, 5, 3600);
    if (!rl.ok) throw new ApiError('অনেক বেশি চেষ্টা — পরে আবার চেষ্টা করুন', 429);

    const body = await readJson<{ confirm?: unknown; reason?: unknown }>(req);
    if (String(body.confirm ?? '').trim().toUpperCase() !== DELETION_CONFIRM_WORD) {
      throw new ApiError(`নিশ্চিত করতে ${DELETION_CONFIRM_WORD} লিখুন`, 400);
    }
    const reason = body.reason ? cleanText(String(body.reason), 300) || null : null;

    await requestAccountDeletion(user.id, reason);

    logActivity({
      actorId: user.id, actorName: user.name, actorType: 'CUSTOMER', role: user.role,
      action: 'ACCOUNT_DELETION_REQUEST', targetId: user.id,
      detail: reason ? `অ্যাকাউন্ট মোছার অনুরোধ — ${reason}` : 'অ্যাকাউন্ট মোছার অনুরোধ',
      ...requestMeta(req),
    }).catch(() => {});
    notify(user.id, 'অ্যাকাউন্ট মোছার অনুরোধ পেয়েছি',
      'আপনার অনুরোধ যাচাই করে সর্বোচ্চ ৭ দিনের মধ্যে অ্যাকাউন্ট মুছে ফেলা হবে। চাইলে প্রোফাইল থেকে অনুরোধ বাতিল করতে পারেন।',
      '/account/profile').catch(() => {});
    notifyAdmins('🗑️ অ্যাকাউন্ট মোছার অনুরোধ', `${user.name} (${user.email}) অ্যাকাউন্ট মুছতে চান।`,
      `/admin/users/${user.id}`).catch(() => {});

    return Response.json({ success: true });
  } catch (e) {
    return apiError(e);
  }
}

/** Customer withdraws the request. */
export async function DELETE() {
  try {
    const user = await requireUser();
    await cancelAccountDeletion(user.id);
    return Response.json({ success: true });
  } catch (e) {
    return apiError(e);
  }
}
